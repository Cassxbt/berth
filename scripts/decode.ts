import { createPublicClient, http } from "viem";
import { CHAINS, type ChainKey } from "../src/config/chains.ts";
import { decodeSponsoredExecution, explain } from "../src/keeperhub/decode.ts";

const [chainKey, txHash] = process.argv.slice(2) as [ChainKey, `0x${string}`];
if (!chainKey || !txHash) {
  console.error("usage: npm run decode -- <baseSepolia|ethSepolia> <txHash>");
  process.exit(2);
}

const chain = CHAINS[chainKey];
const client = createPublicClient({ transport: http(chain.rpcUrls[0]) });
const tx = await client.getTransaction({ hash: txHash });

console.log(`${chain.name}  ${txHash}`);
console.log(explain(decodeSponsoredExecution({ to: tx.to, input: tx.input })));
