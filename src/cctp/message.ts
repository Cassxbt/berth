import { slice, size, hexToBigInt, hexToNumber, type Hex } from "viem";

/**
 * Byte offsets taken from Circle's contracts, not from documentation:
 * header from MessageV2.sol, body from BurnMessage.sol and BurnMessageV2.sol.
 */
const HEADER = {
  version: 0,
  sourceDomain: 4,
  destinationDomain: 8,
  nonce: 12,
  sender: 44,
  recipient: 76,
  destinationCaller: 108,
  minFinalityThreshold: 140,
  finalityThresholdExecuted: 144,
  body: 148,
} as const;

const BODY = {
  version: 0,
  burnToken: 4,
  mintRecipient: 36,
  amount: 68,
  messageSender: 100,
  maxFee: 132,
  feeExecuted: 164,
  expirationBlock: 196,
  hookData: 228,
} as const;

export interface BurnBody {
  version: number;
  burnToken: Hex;
  mintRecipient: Hex;
  amount: bigint;
  messageSender: Hex;
  maxFee: bigint;
  feeExecuted: bigint;
  expirationBlock: bigint;
  hookData: Hex;
}

export interface CctpMessage {
  version: number;
  sourceDomain: number;
  destinationDomain: number;
  nonce: Hex;
  sender: Hex;
  recipient: Hex;
  destinationCaller: Hex;
  minFinalityThreshold: number;
  finalityThresholdExecuted: number;
  body: BurnBody;
}

export const ANY_CALLER = `0x${"0".repeat(64)}` as Hex;

/** bytes32 fields hold left-padded addresses; the padding must be asserted, not skipped. */
export function addressFromBytes32(value: Hex): Hex {
  if (slice(value, 0, 12) !== `0x${"0".repeat(24)}`) {
    throw new Error(`bytes32 ${value} is not a left-padded address`);
  }
  return slice(value, 12) as Hex;
}

export function decodeMessage(message: Hex): CctpMessage {
  if (size(message) < HEADER.body) {
    throw new Error(`message is ${size(message)} bytes, shorter than the ${HEADER.body}-byte header`);
  }
  const body = slice(message, HEADER.body);
  if (size(body) < BODY.hookData) {
    throw new Error(`burn body is ${size(body)} bytes, shorter than the ${BODY.hookData}-byte header`);
  }

  return {
    version: hexToNumber(slice(message, HEADER.version, HEADER.sourceDomain)),
    sourceDomain: hexToNumber(slice(message, HEADER.sourceDomain, HEADER.destinationDomain)),
    destinationDomain: hexToNumber(slice(message, HEADER.destinationDomain, HEADER.nonce)),
    nonce: slice(message, HEADER.nonce, HEADER.sender),
    sender: slice(message, HEADER.sender, HEADER.recipient),
    recipient: slice(message, HEADER.recipient, HEADER.destinationCaller),
    destinationCaller: slice(message, HEADER.destinationCaller, HEADER.minFinalityThreshold),
    minFinalityThreshold: hexToNumber(slice(message, HEADER.minFinalityThreshold, HEADER.finalityThresholdExecuted)),
    finalityThresholdExecuted: hexToNumber(slice(message, HEADER.finalityThresholdExecuted, HEADER.body)),
    body: {
      version: hexToNumber(slice(body, BODY.version, BODY.burnToken)),
      burnToken: slice(body, BODY.burnToken, BODY.mintRecipient),
      mintRecipient: slice(body, BODY.mintRecipient, BODY.amount),
      amount: hexToBigInt(slice(body, BODY.amount, BODY.messageSender)),
      messageSender: slice(body, BODY.messageSender, BODY.maxFee),
      maxFee: hexToBigInt(slice(body, BODY.maxFee, BODY.feeExecuted)),
      feeExecuted: hexToBigInt(slice(body, BODY.feeExecuted, BODY.expirationBlock)),
      expirationBlock: hexToBigInt(slice(body, BODY.expirationBlock, BODY.hookData)),
      hookData: size(body) > BODY.hookData ? slice(body, BODY.hookData) : "0x",
    },
  };
}

/**
 * True when the burn named a specific caller. A zero value means Circle lets
 * any address mint, which is the default almost every integration ships.
 */
export const isGated = (m: CctpMessage): boolean => m.destinationCaller !== ANY_CALLER;
