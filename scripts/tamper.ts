import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

/**
 * A verifier never shown to fail is not a verifier. Each mutation below is a
 * lie the README could tell; every one must make `verify` exit non-zero.
 */
const mutations: Array<{ name: string; apply: (c: any) => void }> = [
  { name: "wallet address off by one nibble", apply: (c) => { c.wallet = c.wallet.slice(0, -1) + (c.wallet.at(-1) === "3" ? "4" : "3"); } },
  { name: "burn amount inflated by one unit", apply: (c) => { c.burn.amount = String(BigInt(c.burn.amount) + 1n); } },
  { name: "claims the mint has not executed", apply: (c) => { c.expectMinted = false; } },
  { name: "probes the permitted caller, expecting a refusal", apply: (c) => { c.probeCallers = [c.wallet]; } },
  { name: "wrong inner selector for the burn", apply: (c) => { c.burn.innerSelector = "0xdeadbeef"; } },
];

const base = JSON.parse(readFileSync(new URL("../claims.json", import.meta.url), "utf8"));
const dir = mkdtempSync(join(tmpdir(), "berth-tamper-"));
const _unused = tmpdir;
const root = new URL("..", import.meta.url).pathname;

let caught = 0;
for (const m of mutations) {
  const mutated = structuredClone(base);
  m.apply(mutated);
  const file = join(dir, `${m.name.replace(/\W+/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(mutated, null, 2));

  let exitCode = 0;
  try {
    execFileSync(process.execPath, ["--experimental-strip-types", "scripts/verify.ts"], {
      cwd: root, stdio: "pipe", env: { ...process.env, BERTH_CLAIMS: file },
    });
  } catch (err: any) {
    exitCode = err.status ?? 1;
  }

  const detected = exitCode === 1;
  if (detected) caught++;
  console.log(`${detected ? "[ok]  " : "[FAIL]"} detected: ${m.name}${detected ? "" : `  (exit ${exitCode}, expected 1)`}`);
}

console.log(`\n${caught}/${mutations.length} lies detected`);
process.exit(caught === mutations.length ? 0 : 1);
