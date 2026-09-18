export type ChainKey = "baseSepolia" | "ethSepolia";

export interface ChainConfig {
  key: ChainKey;
  chainId: number;
  cctpDomain: number;
  name: string;
  rpcUrls: readonly string[];
  explorerTx: string;
  usdc: `0x${string}`;
}

/**
 * CCTP V2 and the KeeperHub forwarder share the same addresses across both
 * chains, so they are pinned once. The verifier asserts the deployed codehash
 * matches across chains at runtime rather than against a frozen literal, which
 * catches an upgrade instead of hiding one.
 */
export const CCTP = {
  tokenMessengerV2: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  messageTransmitterV2: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
} as const;

export const KEEPERHUB = {
  forwarder: "0x5aF5194B4b0909eB978e3Cf1e25333852277f07D",
  delegate: "0x955d84139E7621bC571b117d8Eb5D28A4A222c6F",
  executeSelector: "0x9aefaff8",
} as const;

export const CHAINS: Record<ChainKey, ChainConfig> = {
  baseSepolia: {
    key: "baseSepolia",
    chainId: 84532,
    cctpDomain: 6,
    name: "Base Sepolia",
    rpcUrls: ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"],
    explorerTx: "https://sepolia.basescan.org/tx/",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
  ethSepolia: {
    key: "ethSepolia",
    chainId: 11155111,
    cctpDomain: 0,
    name: "Ethereum Sepolia",
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com", "https://rpc.sepolia.org"],
    explorerTx: "https://sepolia.etherscan.io/tx/",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  },
};

export const byDomain = (domain: number): ChainConfig => {
  const hit = Object.values(CHAINS).find((c) => c.cctpDomain === domain);
  if (!hit) throw new Error(`no configured chain for CCTP domain ${domain}`);
  return hit;
};
