import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeMessage, addressFromBytes32, isGated, ANY_CALLER } from "../src/cctp/message.ts";
import type { Hex } from "viem";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/berth-transfer.json", import.meta.url), "utf8"));
const decoded = decodeMessage(fixture.message as Hex);

const WALLET = "0x3db6f359d9219f0c7348e20481c08e8440220cb2";

test("decodes the CCTP V2 header", () => {
  assert.equal(decoded.version, 1);
  assert.equal(decoded.sourceDomain, 6);
  assert.equal(decoded.destinationDomain, 0);
  assert.equal(decoded.minFinalityThreshold, 2000);
});

test("names the KeeperHub wallet as the only permitted caller", () => {
  assert.notEqual(decoded.destinationCaller, ANY_CALLER);
  assert.equal(isGated(decoded), true);
  assert.equal(addressFromBytes32(decoded.destinationCaller).toLowerCase(), WALLET);
});

test("decodes the burn body", () => {
  assert.equal(decoded.body.amount, 1_000_000n);
  assert.equal(decoded.body.maxFee, 0n);
  assert.equal(addressFromBytes32(decoded.body.mintRecipient).toLowerCase(), WALLET);
});

test("carries a hook Circle does not execute", () => {
  assert.equal(decoded.body.hookData.slice(0, 10), "0x3a537b0c");
});

test("Circle rewrites only the nonce and the executed finality threshold", () => {
  const onchain = decodeMessage(fixture.onchainMessage as Hex);

  assert.equal(onchain.nonce, `0x${"0".repeat(64)}`, "the MessageSent log carries an empty nonce");
  assert.equal(decoded.nonce.toLowerCase(), fixture.eventNonce.toLowerCase(), "Circle assigns it off chain");
  assert.equal(onchain.finalityThresholdExecuted, 0);
  assert.equal(decoded.finalityThresholdExecuted, 2000);

  // Everything the burner committed to survives attestation untouched.
  assert.equal(onchain.destinationCaller, decoded.destinationCaller);
  assert.equal(onchain.sender, decoded.sender);
  assert.equal(onchain.recipient, decoded.recipient);
  assert.equal(onchain.body.amount, decoded.body.amount);
  assert.equal(onchain.body.maxFee, decoded.body.maxFee);
  assert.equal(onchain.body.mintRecipient, decoded.body.mintRecipient);
  assert.equal(onchain.body.hookData, decoded.body.hookData);
});

test("rejects a bytes32 that is not a left-padded address", () => {
  assert.throws(() => addressFromBytes32(`0x${"ff".repeat(32)}` as Hex), /not a left-padded address/);
});
