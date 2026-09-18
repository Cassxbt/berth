import type { Hex } from "viem";

const SANDBOX = "https://iris-api-sandbox.circle.com";

export type AttestationStatus = "pending_confirmations" | "complete";

export interface AttestedMessage {
  status: AttestationStatus;
  eventNonce: Hex;
  cctpVersion: number;
  message: Hex;
  attestation: Hex;
}

export class IrisUnavailable extends Error {}

/**
 * Circle serves the attested copy of a burn. `complete` means attested, not
 * minted: the two are routinely conflated and they are not the same claim.
 */
export async function fetchAttestation(
  sourceDomain: number,
  burnTxHash: Hex,
  baseUrl = SANDBOX,
): Promise<AttestedMessage> {
  const url = `${baseUrl}/v2/messages/${sourceDomain}?transactionHash=${burnTxHash}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (cause) {
    throw new IrisUnavailable(`Circle's API is unreachable: ${String(cause)}`);
  }
  if (!res.ok) throw new IrisUnavailable(`Circle returned HTTP ${res.status} for ${burnTxHash}`);

  const body = (await res.json()) as { messages?: AttestedMessage[] };
  const found = body.messages?.[0];
  if (!found) throw new Error(`Circle knows no message for burn ${burnTxHash}`);
  return found;
}

export const isAttested = (m: AttestedMessage): boolean =>
  m.status === "complete" && m.attestation !== "0x" && m.attestation.length > 2;
