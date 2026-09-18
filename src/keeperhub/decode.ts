import { decodeAbiParameters, parseAbiParameters, slice, size, toHex, hexToBigInt, hexToNumber } from "viem";
import { KEEPERHUB } from "../config/chains.ts";

export interface SponsoredExecution {
  account: `0x${string}`;
  target: `0x${string}`;
  value: bigint;
  relayNonce: bigint;
  expiry: number;
  innerSelector: `0x${string}`;
  innerCalldata: `0x${string}`;
}

/**
 * Offsets inside the forwarder's authorisation blob. Derived by observation
 * across executions on two chains; KeeperHub publishes no schema for it, so a
 * forwarder upgrade would invalidate these and the verifier is expected to fail
 * loudly rather than decode garbage.
 */
const SIG_BYTES = 65;
const NONCE_BYTES = 16;
const EXPIRY_BYTES = 4;
const INNER_OFFSET = SIG_BYTES + NONCE_BYTES + EXPIRY_BYTES;

export class NotASponsoredExecution extends Error {}

/**
 * Reconstructs the call a KeeperHub sponsored execution actually performed.
 * Chain-agnostic and protocol-agnostic: it knows nothing about CCTP.
 */
export function decodeSponsoredExecution(tx: {
  to: `0x${string}` | null;
  input: `0x${string}`;
}): SponsoredExecution {
  if (!tx.to || tx.to.toLowerCase() !== KEEPERHUB.forwarder.toLowerCase()) {
    throw new NotASponsoredExecution(`to ${tx.to} is not the KeeperHub forwarder`);
  }
  const selector = slice(tx.input, 0, 4);
  if (selector.toLowerCase() !== KEEPERHUB.executeSelector) {
    throw new NotASponsoredExecution(`selector ${selector} is not execute(address,address,uint256,bytes)`);
  }

  const [account, target, value, blob] = decodeAbiParameters(
    parseAbiParameters("address, address, uint256, bytes"),
    slice(tx.input, 4),
  );

  if (size(blob) < INNER_OFFSET) {
    throw new NotASponsoredExecution(`blob is ${size(blob)} bytes, shorter than the ${INNER_OFFSET}-byte header`);
  }

  const relayNonce = hexToBigInt(slice(blob, SIG_BYTES, SIG_BYTES + NONCE_BYTES));
  const expiry = hexToNumber(slice(blob, SIG_BYTES + NONCE_BYTES, INNER_OFFSET));
  const innerCalldata = slice(blob, INNER_OFFSET);

  return {
    account,
    target,
    value,
    relayNonce,
    expiry,
    innerSelector: slice(innerCalldata, 0, 4),
    innerCalldata,
  };
}

export const explain = (e: SponsoredExecution): string =>
  [
    `account       ${e.account}`,
    `target        ${e.target}`,
    `value         ${e.value}`,
    `relay nonce   ${e.relayNonce}`,
    `expiry        ${e.expiry} (${new Date(e.expiry * 1000).toISOString()})`,
    `inner call    ${e.innerSelector} (${size(e.innerCalldata)} bytes)`,
  ].join("\n");
