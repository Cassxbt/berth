import { createPublicClient, http, slice, size, keccak256, encodeFunctionData, type Hex } from "viem";
import { readFileSync } from "node:fs";
import { CHAINS, CCTP, KEEPERHUB, byDomain } from "../src/config/chains.ts";
import { decodeSponsoredExecution } from "../src/keeperhub/decode.ts";
import { decodeMessage, addressFromBytes32, ANY_CALLER } from "../src/cctp/message.ts";
import { fetchAttestation, isAttested, IrisUnavailable } from "../src/cctp/iris.ts";

const claimsPath = process.env.BERTH_CLAIMS
  ? new URL(`file://${process.env.BERTH_CLAIMS}`)
  : new URL("../claims.json", import.meta.url);
const claims = JSON.parse(readFileSync(claimsPath, "utf8"));

const RECEIVE_ABI = [{
  inputs: [{ name: "message", type: "bytes" }, { name: "attestation", type: "bytes" }],
  name: "receiveMessage", outputs: [{ name: "", type: "bool" }],
  stateMutability: "nonpayable", type: "function",
}] as const;

const clients = {
  baseSepolia: createPublicClient({ transport: http(CHAINS.baseSepolia.rpcUrls[0]) }),
  ethSepolia: createPublicClient({ transport: http(CHAINS.ethSepolia.rpcUrls[0]) }),
};

interface Failure {
  claim: string;
  observed: string;
  source: string;
  means: string;
}
let passed = 0;
const failures: Array<{ id: string; label: string; detail: Failure }> = [];

function check(id: string, label: string, fn: () => Failure | null) {
  let detail: Failure | null;
  try {
    detail = fn();
  } catch (err) {
    if (err instanceof IrisUnavailable) throw err;
    detail = { claim: label, observed: String(err), source: "assertion threw", means: "the check could not complete" };
  }
  if (detail) {
    failures.push({ id, label, detail });
    console.log(`[FAIL] ${id}  ${label}`);
    console.log(`         claim     ${detail.claim}`);
    console.log(`         observed  ${detail.observed}`);
    console.log(`         source    ${detail.source}`);
    console.log(`         means     ${detail.means}`);
  } else {
    passed++;
    console.log(`[ok]   ${id}  ${label}`);
  }
}

const eq = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
const fail = (claim: string, observed: string, source: string, means: string): Failure => ({ claim, observed, source, means });

const lower = (h: string) => h.toLowerCase() as Hex;

try {
  const burnChain = CHAINS[claims.burn.chain as "baseSepolia"];
  const mintChain = CHAINS[claims.mint.chain as "ethSepolia"];
  const burnClient = clients[claims.burn.chain as "baseSepolia"];
  const mintClient = clients[claims.mint.chain as "ethSepolia"];

  const [burnHead, mintHead] = await Promise.all([burnClient.getBlockNumber(), mintClient.getBlockNumber()]);
  console.log(`berth verify — claims ${claimsPath.pathname.split("/").pop()}`);
  console.log(`${burnChain.name.padEnd(17)} head=${burnHead}`);
  console.log(`${mintChain.name.padEnd(17)} head=${mintHead}\n`);

  // Group 1 — the executions were KeeperHub executions and did what we claim
  const burnTx = await burnClient.getTransaction({ hash: claims.burn.tx });
  const burnRcpt = await burnClient.getTransactionReceipt({ hash: claims.burn.tx });
  const burnExec = decodeSponsoredExecution({ to: burnTx.to, input: burnTx.input });

  check("A01", "burn transaction succeeded", () =>
    burnRcpt.status === "success" ? null : fail("status 1", burnRcpt.status, `${burnChain.name} receipt`, "the burn did not land"));

  check("A02", "burn routed through the KeeperHub forwarder", () =>
    eq(burnTx.to, KEEPERHUB.forwarder) ? null
      : fail(KEEPERHUB.forwarder, String(burnTx.to), "tx.to", "this was not a KeeperHub sponsored execution"));

  check("A03", "forwarder selector is execute(address,address,uint256,bytes)", () => {
    const derived = slice(keccak256(new TextEncoder().encode("execute(address,address,uint256,bytes)")), 0, 4);
    return eq(derived, KEEPERHUB.executeSelector) && eq(slice(burnTx.input, 0, 4), KEEPERHUB.executeSelector)
      ? null : fail(KEEPERHUB.executeSelector, slice(burnTx.input, 0, 4), "recomputed keccak of the signature", "the forwarder ABI is not what we assume");
  });

  check("A04", "burn was executed for the KeeperHub wallet against TokenMessengerV2", () =>
    eq(burnExec.account, claims.wallet) && eq(burnExec.target, CCTP.tokenMessengerV2) ? null
      : fail(`${claims.wallet} -> ${CCTP.tokenMessengerV2}`, `${burnExec.account} -> ${burnExec.target}`, "decoded blob", "the execution targeted something else"));

  check("A05", "inner call is depositForBurnWithHook", () =>
    eq(burnExec.innerSelector, claims.burn.innerSelector) ? null
      : fail(claims.burn.innerSelector, burnExec.innerSelector, "blob offset 85", "a different function ran"));

  const burnBlock = await burnClient.getBlock({ blockNumber: burnRcpt.blockNumber });
  check("A06", "sponsored authorisation had not expired when it executed", () =>
    BigInt(burnExec.expiry) > burnBlock.timestamp ? null
      : fail(`expiry > ${burnBlock.timestamp}`, String(burnExec.expiry), "blob offset 81, burn block timestamp", "the relayer executed a stale authorisation"));

  // Group 2 — the gate, read straight out of the raw CCTP message
  const MESSAGE_SENT = keccak256(new TextEncoder().encode("MessageSent(bytes)"));
  const log = burnRcpt.logs.find((l) => eq(l.address, CCTP.messageTransmitterV2) && eq(l.topics[0] ?? "", MESSAGE_SENT));

  check("A07", "burn emitted exactly one MessageSent", () =>
    log ? null : fail("one MessageSent log", "none found", "burn receipt logs", "no CCTP message was produced"));

  const onchainMessage = (() => {
    if (!log) return null;
    const raw = slice(log.data, 32);
    const len = Number(BigInt(slice(raw, 0, 32)));
    return slice(raw, 32, 32 + len) as Hex;
  })();

  check("A08", "destinationCaller in the on-chain message is the KeeperHub wallet", () => {
    if (!onchainMessage) return fail("a message", "none", "MessageSent", "nothing to read");
    const m = decodeMessage(onchainMessage);
    if (m.destinationCaller === ANY_CALLER)
      return fail(claims.wallet, "bytes32(0)", "message[108:140]", "the burn was open to any caller, which is the default Berth exists to avoid");
    return eq(addressFromBytes32(m.destinationCaller), claims.wallet) ? null
      : fail(claims.wallet, addressFromBytes32(m.destinationCaller), "message[108:140]", "a different address holds the exclusive right to mint");
  });

  check("A09", "burn body matches the claimed amount and recipient", () => {
    if (!onchainMessage) return fail("a message", "none", "MessageSent", "nothing to read");
    const b = decodeMessage(onchainMessage).body;
    return b.amount === BigInt(claims.burn.amount) && eq(addressFromBytes32(b.mintRecipient), claims.wallet)
      ? null : fail(`${claims.burn.amount} to ${claims.wallet}`, `${b.amount} to ${addressFromBytes32(b.mintRecipient)}`, "burn body", "the transfer is not the one described");
  });

  check("A10", "message carries a hook Circle does not execute", () => {
    if (!onchainMessage) return fail("a message", "none", "MessageSent", "nothing to read");
    const h = decodeMessage(onchainMessage).body.hookData;
    return size(h) > 0 && eq(slice(h, 0, 4), claims.hookSelector) ? null
      : fail(claims.hookSelector, size(h) ? slice(h, 0, 4) : "empty", "burn body hookData", "there is no hook to execute");
  });

  // Group 3 — Circle's attested copy, and the refusal anyone can reproduce
  const attested = await fetchAttestation(byDomain(decodeMessage(onchainMessage!).sourceDomain).cctpDomain, claims.burn.tx);

  check("A11", "Circle has attested the burn", () =>
    isAttested(attested) ? null : fail("complete", attested.status, "Circle sandbox API", "the transfer cannot be minted yet"));

  check("A12", "Circle rewrote only the nonce and executed finality threshold", () => {
    const on = decodeMessage(onchainMessage!), ir = decodeMessage(attested.message);
    const same = on.destinationCaller === ir.destinationCaller && on.sender === ir.sender
      && on.recipient === ir.recipient && on.body.amount === ir.body.amount && on.body.hookData === ir.body.hookData;
    return same ? null : fail("gate and body byte-identical", "a committed field changed", "on-chain vs attested", "attestation altered the transfer");
  });

  const receiveCalldata = encodeFunctionData({
    abi: RECEIVE_ABI, functionName: "receiveMessage", args: [attested.message, attested.attestation],
  });

  /**
   * Decodes Error(string) out of the raw revert data on the cause chain rather
   * than matching the provider's prose, which differs between RPC vendors.
   */
  const revertStringOf = (err: unknown): string | null => {
    for (let cur: any = err, hops = 0; cur && hops < 6; cur = cur.cause, hops++) {
      const data: string | undefined = cur.data;
      if (typeof data === "string" && data.startsWith("0x08c379a0")) {
        const body = data.slice(10);
        const len = Number(BigInt("0x" + body.slice(64, 128)));
        return Buffer.from(body.slice(128, 128 + len * 2), "hex").toString("utf8");
      }
    }
    return null;
  };

  for (const [i, caller] of (claims.probeCallers as string[]).entries()) {
    let observed: string;
    try {
      await mintClient.call({ account: lower(caller), to: CCTP.messageTransmitterV2 as Hex, data: receiveCalldata });
      observed = "call succeeded";
    } catch (err) {
      observed = revertStringOf(err) ?? "reverted without a decodable reason";
    }
    check(`A13.${i + 1}`, `any other caller is refused: ${caller}`, () =>
      observed === "Invalid caller for message" ? null
        : fail("Invalid caller for message", observed, `eth_call from ${caller}`, "the gate did not refuse this caller, so exclusivity is not enforced"));
  }

  // Group 4 — destination state
  const usedNonces = await mintClient.readContract({
    address: CCTP.messageTransmitterV2 as Hex,
    abi: [{ inputs: [{ name: "", type: "bytes32" }], name: "usedNonces", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" }],
    functionName: "usedNonces", args: [claims.eventNonce as Hex],
  });

  check("A14", claims.expectMinted ? "nonce is spent, so the mint executed" : "nonce is unspent, so the mint has not executed", () =>
    (claims.expectMinted ? usedNonces === 1n : usedNonces === 0n) ? null
      : fail(claims.expectMinted ? "1" : "0", String(usedNonces), `usedNonces(${claims.eventNonce})`, claims.expectMinted ? "the README claims a mint that did not happen" : "a mint happened that the README does not claim"));

  const minted = await mintClient.readContract({
    address: mintChain.usdc, abi: [{ inputs: [{ name: "", type: "address" }], name: "balanceOf", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" }],
    functionName: "balanceOf", args: [lower(claims.wallet)],
  });

  check("A15", "minted USDC is present on the destination", () =>
    !claims.expectMinted || minted >= BigInt(claims.burn.amount) ? null
      : fail(`>= ${claims.burn.amount}`, String(minted), `USDC.balanceOf on ${mintChain.name}`, "the USDC was never minted"));

  const mintTx = await mintClient.getTransaction({ hash: claims.mint.tx });
  const mintExec = decodeSponsoredExecution({ to: mintTx.to, input: mintTx.input });
  check("A16", "mint was also a KeeperHub sponsored execution", () =>
    eq(mintExec.account, claims.wallet) && eq(mintExec.target, CCTP.messageTransmitterV2) && eq(mintExec.innerSelector, claims.mint.innerSelector)
      ? null : fail(`${claims.wallet} -> receiveMessage`, `${mintExec.account} -> ${mintExec.innerSelector}`, "decoded mint blob", "the mint did not go through KeeperHub"));

  // Group 5 — the custody claims the README makes
  const [codeBase, codeEth] = await Promise.all([
    clients.baseSepolia.getCode({ address: lower(claims.wallet) }),
    clients.ethSepolia.getCode({ address: lower(claims.wallet) }),
  ]);
  check("A17", "wallet is an EIP-7702 delegated account on both chains", () => {
    const ok = (c?: Hex) => !!c && c.startsWith("0xef0100") && size(c) === 23 && eq(slice(c, 3), KEEPERHUB.delegate);
    return ok(codeBase) && ok(codeEth) ? null
      : fail(`0xef0100${KEEPERHUB.delegate.slice(2)}`, `${codeBase} / ${codeEth}`, "eth_getCode on both chains", "the wallet is not the delegated account we describe");
  });

  const [fwdBase, fwdEth] = await Promise.all([
    clients.baseSepolia.getCode({ address: KEEPERHUB.forwarder as Hex }),
    clients.ethSepolia.getCode({ address: KEEPERHUB.forwarder as Hex }),
  ]);
  check("A18", "forwarder is the same deployed code on both chains", () =>
    fwdBase && fwdEth && keccak256(fwdBase) === keccak256(fwdEth) ? null
      : fail("identical codehash", `${fwdBase && keccak256(fwdBase)} vs ${fwdEth && keccak256(fwdEth)}`, "keccak of eth_getCode", "one chain runs a different forwarder, so the decoder may not apply to both"));

  // A19 — a second, independent proof that the gate is real: routing the very
  // same call through Multicall3 changes msg.sender and the gate refuses it.
  const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Hex;
  const aggregate3 = encodeFunctionData({
    abi: [{
      inputs: [{ components: [
        { name: "target", type: "address" }, { name: "allowFailure", type: "bool" }, { name: "callData", type: "bytes" },
      ], name: "calls", type: "tuple[]" }],
      name: "aggregate3",
      outputs: [{ components: [{ name: "success", type: "bool" }, { name: "returnData", type: "bytes" }], name: "returnData", type: "tuple[]" }],
      stateMutability: "payable", type: "function",
    }] as const,
    functionName: "aggregate3",
    args: [[{ target: CCTP.messageTransmitterV2 as Hex, allowFailure: true, callData: receiveCalldata }]],
  });

  let batchInner = "call unexpectedly succeeded";
  try {
    const res = await mintClient.call({ account: lower(claims.wallet), to: MULTICALL3, data: aggregate3 });
    const hex = res.data ?? "0x";
    const m = /08c379a0([0-9a-fA-F]+)/.exec(hex);
    if (m?.[1]) {
      const len = Number(BigInt("0x" + m[1].slice(64, 128)));
      batchInner = Buffer.from(m[1].slice(128, 128 + len * 2), "hex").toString("utf8");
    }
  } catch (err) {
    batchInner = revertStringOf(err) ?? "reverted without a decodable reason";
  }

  check("A19", "batching through Multicall3 breaks the gate, so atomic mint-plus-hook is not available", () =>
    batchInner === "Invalid caller for message" ? null
      : fail("Invalid caller for message", batchInner, "aggregate3 from the permitted wallet",
             "Multicall3 no longer rewrites msg.sender, which would change the delivery design"));

  console.log(`\n${passed} ok   ${failures.length} FAILED`);
  process.exit(failures.length ? 1 : 0);
} catch (err) {
  if (err instanceof IrisUnavailable) {
    console.error(`\ntransport failure, not an evidence failure: ${err.message}`);
    process.exit(2);
  }
  throw err;
}
