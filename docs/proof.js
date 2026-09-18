"use strict";

const RPC = {
  base: "https://sepolia.base.org",
  eth: "https://ethereum-sepolia-rpc.publicnode.com",
};

const A = {
  wallet: "0x3db6f359d9219f0c7348e20481c08e8440220cb2",
  forwarder: "0x5af5194b4b0909eb978e3cf1e25333852277f07d",
  transmitter: "0xe737e5cebeeba77efe34d4aa090756590b1ce275",
  tokenMessenger: "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
  usdcEth: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  multicall3: "0xca11bde05977b3631167028862be2a173976ca11",
  sink: "0x000000000000000000000000000000000000dead",
};

const TX = {
  burn1: "0xd1a6fe7e3d3f4e945e5c03d3911dcb678c6ba1eedad2e574b4eb2ce5df026414",
  mint1: "0xf69a9b4f4b8e685c7ed2e6d693358bcfdb2fab57521bf1b247d3b75ecaa6690a",
  burn2: "0xedb9bce11388cb44fd92f76f75da7077d6e4d7595ff8040058d76299ef7b8594",
  mint2: "0x7c3d7cc67e6c9c71366615e54f4507600f545688dd73aa4d59ff2198c60dd2db",
  hook2: "0x87262bb14d9bf60244762c8528421ee884e8466fda5b46332e0aa4026ede644c",
};

const SELECTOR = {
  execute: "9aefaff8",
  depositForBurnWithHook: "779b432d",
  receiveMessage: "57ecfd28",
  transfer: "a9059cbb",
};

let rpcId = 0;
async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const body = await res.json();
  if (body.error) {
    const err = new Error(body.error.message || "rpc error");
    err.data = body.error.data;
    throw err;
  }
  return body.result;
}

const strip = (h) => (h || "").replace(/^0x/, "").toLowerCase();
const word = (args, i) => args.slice(i * 64, (i + 1) * 64);
const addrOf = (w) => "0x" + w.slice(24);
const same = (a, b) => strip(a) === strip(b);

/**
 * The forwarder wraps the real call in an authorisation blob inside the fourth
 * argument of execute(address,address,uint256,bytes). The offset word has to be
 * dereferenced; assuming a fixed position decodes garbage.
 */
function decodeExecution(tx) {
  const input = strip(tx.input);
  if (!same(tx.to, A.forwarder)) throw new Error("not the KeeperHub forwarder");
  if (input.slice(0, 8) !== SELECTOR.execute) throw new Error("not execute()");
  const args = input.slice(8);
  const blobAt = parseInt(word(args, 3), 16) * 2;
  const blobLen = parseInt(args.slice(blobAt, blobAt + 64), 16) * 2;
  const blob = args.slice(blobAt + 64, blobAt + 64 + blobLen);
  return {
    account: addrOf(word(args, 0)),
    target: addrOf(word(args, 1)),
    inner: blob.slice(85 * 2),
    innerSelector: blob.slice(85 * 2, 85 * 2 + 8),
  };
}

/** destinationCaller sits at byte 108 of a CCTP V2 message. */
const destinationCallerOf = (msg) => "0x" + strip(msg).slice(108 * 2 + 24, 140 * 2);

function revertStringOf(err) {
  const d = strip(err && err.data);
  if (!d.startsWith("08c379a0")) return null;
  const body = d.slice(8);
  const len = parseInt(body.slice(64, 128), 16);
  const hex = body.slice(128, 128 + len * 2);
  return decodeURIComponent(hex.replace(/../g, "%$&"));
}

async function attestation(burnTx) {
  const res = await fetch(`https://iris-api-sandbox.circle.com/v2/messages/6?transactionHash=${burnTx}`);
  const body = await res.json();
  return body.messages && body.messages[0];
}

function receiveCalldata(message, att) {
  const m = strip(message), a = strip(att);
  const pad = (h) => h + "0".repeat((64 - (h.length % 64)) % 64);
  const len = (h) => (h.length / 2).toString(16).padStart(64, "0");
  const offB = (128 + len(m).length * 0).toString();
  void offB;
  const head = (64).toString(16).padStart(64, "0");
  const msgBlock = len(m) + pad(m);
  const attOffset = (64 + msgBlock.length / 2).toString(16).padStart(64, "0");
  return "0x" + SELECTOR.receiveMessage + head + attOffset + msgBlock + len(a) + pad(a);
}

// ---- assertions -------------------------------------------------------------

const rowsEl = document.getElementById("rows");
const tallyEl = document.getElementById("tally");
const checks = [];

function define(id, label, fn) { checks.push({ id, label, fn }); }

define("A01", "burn executed through the KeeperHub forwarder", async () => {
  const tx = await rpc(RPC.base, "eth_getTransactionByHash", [TX.burn1]);
  const e = decodeExecution(tx);
  if (!same(e.account, A.wallet)) throw new Error(`acting wallet ${e.account}`);
  if (e.innerSelector !== SELECTOR.depositForBurnWithHook) throw new Error(`inner ${e.innerSelector}`);
  return "depositForBurnWithHook";
});

define("A02", "burn transaction succeeded", async () => {
  const r = await rpc(RPC.base, "eth_getTransactionReceipt", [TX.burn1]);
  if (r.status !== "0x1") throw new Error(`status ${r.status}`);
  return "status 0x1";
});

define("A03", "Circle attested the burn", async () => {
  const m = await attestation(TX.burn1);
  if (!m || m.status !== "complete") throw new Error(`status ${m && m.status}`);
  return m.status;
});

define("A04", "the message names our wallet as the only permitted caller", async () => {
  const m = await attestation(TX.burn1);
  const dc = destinationCallerOf(m.message);
  if (strip(dc) === "0".repeat(40)) throw new Error("bytes32(0) — anyone may mint");
  if (!same(dc, A.wallet)) throw new Error(dc);
  return dc.slice(0, 10) + "…";
});

define("A05", "an unrelated address is refused by Circle's contract", async () => {
  const m = await attestation(TX.burn1);
  const data = receiveCalldata(m.message, m.attestation);
  try {
    await rpc(RPC.eth, "eth_call", [{ from: A.sink, to: A.transmitter, data }, "latest"]);
    throw new Error("the call succeeded, which it must not");
  } catch (err) {
    const reason = revertStringOf(err);
    if (reason !== "Invalid caller for message") throw new Error(reason || err.message);
    return reason;
  }
});

define("A06", "mint executed through the KeeperHub forwarder", async () => {
  const tx = await rpc(RPC.eth, "eth_getTransactionByHash", [TX.mint1]);
  const e = decodeExecution(tx);
  if (!same(e.target, A.transmitter)) throw new Error(`target ${e.target}`);
  if (e.innerSelector !== SELECTOR.receiveMessage) throw new Error(`inner ${e.innerSelector}`);
  return "receiveMessage";
});

define("A07", "the minted USDC is present on the destination", async () => {
  const data = "0x70a08231" + "0".repeat(24) + strip(A.wallet);
  const bal = await rpc(RPC.eth, "eth_call", [{ to: A.usdcEth, data }, "latest"]);
  const v = BigInt(bal);
  if (v < 1000000n) throw new Error(`${v}`);
  return `${Number(v) / 1e6} USDC`;
});

define("A08", "the second message carried an instruction Circle did not run", async () => {
  const m = await attestation(TX.burn2);
  if (!m || m.status !== "complete") throw new Error("not attested");
  const body = strip(m.message).slice(148 * 2);
  const hook = body.slice(228 * 2);
  if (!hook.length) throw new Error("no hookData");
  if (strip(hook).indexOf(SELECTOR.transfer) === -1) throw new Error("instruction not found in hookData");
  return `${hook.length / 2} bytes`;
});

define("A09", "Berth executed that instruction through KeeperHub", async () => {
  const tx = await rpc(RPC.eth, "eth_getTransactionByHash", [TX.hook2]);
  const e = decodeExecution(tx);
  if (!same(e.target, A.usdcEth)) throw new Error(`target ${e.target}`);
  if (e.innerSelector !== SELECTOR.transfer) throw new Error(`inner ${e.innerSelector}`);
  return "transfer(address,uint256)";
});

define("A10", "the named recipient received exactly the hooked amount", async () => {
  const r = await rpc(RPC.eth, "eth_getTransactionReceipt", [TX.hook2]);
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const log = r.logs.find((l) => same(l.address, A.usdcEth) && same(l.topics[0], TRANSFER) && same("0x" + strip(l.topics[2]).slice(24), A.sink));
  if (!log) throw new Error("no matching Transfer");
  if (BigInt(log.data) !== 500000n) throw new Error(`${BigInt(log.data)}`);
  return "500000";
});

define("A11", "the permitted wallet holds no native balance on either chain", async () => {
  const [b, e] = await Promise.all([
    rpc(RPC.base, "eth_getBalance", [A.wallet, "latest"]),
    rpc(RPC.eth, "eth_getBalance", [A.wallet, "latest"]),
  ]);
  if (BigInt(b) !== 0n || BigInt(e) !== 0n) throw new Error(`${b} / ${e}`);
  return "0 on both";
});

define("A12", "batching through Multicall3 breaks the gate", async () => {
  const m = await attestation(TX.burn1);
  const inner = strip(receiveCalldata(m.message, m.attestation));
  const len = (inner.length / 2).toString(16).padStart(64, "0");
  const pad = inner + "0".repeat((64 - (inner.length % 64)) % 64);
  const tuple =
    "0".repeat(24) + strip(A.transmitter) +
    "1".padStart(64, "0") +
    (96).toString(16).padStart(64, "0") + len + pad;
  const data = "0x82ad56cb" + (32).toString(16).padStart(64, "0") + (1).toString(16).padStart(64, "0") +
    (32).toString(16).padStart(64, "0") + tuple;
  const res = await rpc(RPC.eth, "eth_call", [{ from: A.wallet, to: A.multicall3, data }, "latest"]);
  const reason = revertStringOf({ data: "0x" + strip(res).slice(strip(res).indexOf("08c379a0")) });
  if (reason !== "Invalid caller for message") throw new Error(reason || "gate did not refuse");
  return reason;
});

function render() {
  if (!rowsEl) return;
  rowsEl.innerHTML = checks.map((c) =>
    `<tr id="r-${c.id}"><td>${c.id}</td><td>${c.label}</td><td><span class="state pending" id="s-${c.id}">—</span></td></tr>`
  ).join("");
}

const statusEl = () => document.getElementById("status");
const barEl = () => document.querySelector("#progress > i");

function setStatus(cls, text) {
  const el = statusEl();
  if (!el) return;
  el.className = `status ${cls}`;
  el.querySelector("span").textContent = text;
}

async function runAll() {
  const btn = document.getElementById("run");
  btn.disabled = true;
  btn.textContent = "Verifying…";

  // Put the work on screen. A check nobody watches is a check nobody believes.
  document.getElementById("assertions-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (tallyEl) { tallyEl.textContent = ""; tallyEl.className = "tally mono"; }
  checks.forEach((c) => {
    const el = document.getElementById(`s-${c.id}`);
    if (el) { el.textContent = "—"; el.className = "state pending"; }
  });

  let ok = 0, bad = 0, done = 0;
  setStatus("busy", `0 / ${checks.length}`);

  for (const c of checks) {
    const row = document.getElementById(`r-${c.id}`);
    const el = document.getElementById(`s-${c.id}`);
    row?.classList.add("live");
    if (el) { el.textContent = "running"; el.className = "state pending"; }
    setStatus("busy", `${c.id} · ${done} / ${checks.length}`);

    try {
      const detail = await c.fn();
      if (el) { el.textContent = detail || "ok"; el.className = "state pass"; }
      ok++;
    } catch (err) {
      if (el) { el.textContent = (err.message || "failed").slice(0, 44); el.className = "state fail"; }
      bad++;
    }

    done++;
    row?.classList.remove("live");
    const bar = barEl();
    if (bar) bar.style.width = `${(done / checks.length) * 100}%`;
    await new Promise((r) => setTimeout(r, 90));
  }

  if (tallyEl) {
    tallyEl.textContent = `${ok} ok   ${bad} failed`;
    tallyEl.className = `tally mono ${bad ? "fail" : "pass"}`;
  }
  setStatus(bad ? "bad" : "ok", bad ? `${bad} failed` : `${ok} / ${checks.length} verified`);
  btn.disabled = false;
  btn.textContent = bad ? "Re-run" : "Run again";
}

async function runProbe() {
  const btn = document.getElementById("probe");
  btn.disabled = true; btn.textContent = "Calling…";

  for (const id of ["out-outsider", "out-permitted"]) {
    const el = document.getElementById(id);
    el.innerHTML = '<span class="state pending">calling…</span>';
    el.parentElement.classList.add("hit");
  }

  const m = await attestation(TX.burn1);
  const data = receiveCalldata(m.message, m.attestation);

  for (const [who, from, id] of [["outsider", A.sink, "out-outsider"], ["permitted", A.wallet, "out-permitted"]]) {
    const el = document.getElementById(id);
    await new Promise((r) => setTimeout(r, 260));
    try {
      const res = await rpc(RPC.eth, "eth_call", [{ from, to: A.transmitter, data }, "latest"]);
      el.innerHTML = `<span class="state pass">returned</span> <span class="t-green">${BigInt(res) === 1n ? "true" : res}</span>`;
    } catch (err) {
      const reason = revertStringOf(err) || err.message;
      // A refusal of the caller is red; a spent nonce is amber. They mean
      // different things and should not look the same.
      const isGate = reason === "Invalid caller for message";
      const cls = isGate ? "fail" : "spent";
      const tone = isGate ? "t-red" : "t-yellow";
      el.innerHTML = `<span class="state ${cls}">reverted</span> <span class="${tone}">${reason}</span>`;
    }
    el.parentElement.classList.remove("hit");
  }
  btn.disabled = false; btn.textContent = "Run both again";
}

function facts() {
  const el = document.getElementById("facts");
  if (!el) return;
  const rows = [
    ["Burn, Base Sepolia", TX.burn1, "https://sepolia.basescan.org/tx/"],
    ["Mint, Ethereum Sepolia", TX.mint1, "https://sepolia.etherscan.io/tx/"],
    ["Second burn, with instruction", TX.burn2, "https://sepolia.basescan.org/tx/"],
    ["Second mint", TX.mint2, "https://sepolia.etherscan.io/tx/"],
    ["Instruction executed", TX.hook2, "https://sepolia.etherscan.io/tx/"],
  ];
  el.innerHTML = rows.map(([k, v, base]) =>
    `<div><dt>${k}</dt><dd class="mono"><a href="${base}${v}">${v.slice(0, 18)}…${v.slice(-6)}</a></dd></div>`
  ).join("");
}

render();
facts();
const runBtn = document.getElementById("run");
const probeBtn = document.getElementById("probe");
if (runBtn) runBtn.addEventListener("click", runAll);
if (probeBtn) probeBtn.addEventListener("click", runProbe);
