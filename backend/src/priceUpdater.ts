import "dotenv/config";
import fetch from "node-fetch";
import { ethers } from "ethers";

const {
  ARC_RPC_URL,
  PRIVATE_KEY,
  MANUAL_ORACLE_ADDRESS,
  PRICE_UPDATE_INTERVAL_SECONDS,
  COINGECKO_API_BASE = "https://api.coingecko.com/api/v3",
} = process.env;

function requireEnv(variable: string): string {
  const value = process.env[variable];
  if (!value || value.trim() === "") {
    throw new Error(`Missing ${variable} in environment variables`);
  }
  return value;
}

if (!ARC_RPC_URL) {
  throw new Error("Missing ARC_RPC_URL in environment variables");
}

if (!PRIVATE_KEY) {
  throw new Error("Missing PRIVATE_KEY in environment variables");
}

if (!MANUAL_ORACLE_ADDRESS) {
  throw new Error("Missing MANUAL_ORACLE_ADDRESS in environment variables");
}

const rpcUrl = ARC_RPC_URL!;
const privateKey = PRIVATE_KEY!;
const manualOracleAddress = MANUAL_ORACLE_ADDRESS!;

const manualOracleAbi = [
  "function setPrices(address[] tokens, uint256[] prices) external",
];

type TokenConfig = {
  name: string;
  address: string;
  coingeckoId: string;
  decimals: number;
};

const TOKENS: TokenConfig[] = [
  {
    name: "EURC",
    address: requireEnv("EURC_ADDRESS"),
    coingeckoId: "",
    decimals: 6,
  },
  {
    name: "BTC",
    address: requireEnv("BTC_ADDRESS"),
    coingeckoId: "bitcoin",
    decimals: 8,
  },
  {
    name: "ETH",
    address: requireEnv("ETH_ADDRESS"),
    coingeckoId: "ethereum",
    decimals: 18,
  },
  {
    name: "BNB",
    address: requireEnv("BNB_ADDRESS"),
    coingeckoId: "binancecoin",
    decimals: 18,
  },
];

type PriceMap = Record<string, number>;

async function fetchPrices(): Promise<PriceMap> {
  const coingeckoTokens = TOKENS.filter((token) => token.coingeckoId);
  const ids = coingeckoTokens.map((token) => token.coingeckoId).join(",");
  const url = `${COINGECKO_API_BASE}/simple/price?ids=${ids}&vs_currencies=usd`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch prices: ${response.status} ${response.statusText}`);
  }

  const data = ids
    ? ((await response.json()) as Record<
        string,
        {
          usd: number;
        }
      >)
    : {};

  const result: PriceMap = {};
  for (const token of TOKENS) {
    if (!token.coingeckoId) {
      continue;
    }
    const entry = data[token.coingeckoId];
    if (!entry || typeof entry.usd !== "number") {
      throw new Error(`Missing price data for ${token.coingeckoId}`);
    }
    result[token.name] = entry.usd;
  }

  // EURC is designed to track exactly 1 USD on Arc → hardcode to 1.0
  result.EURC = 1.0;

  return result;
}

function usdToOraclePrice(value: number): bigint {
  return BigInt(Math.round(value * 1e8));
}

async function updatePrices() {
  console.log(`[${new Date().toISOString()}] Fetching prices from CoinGecko...`);
  const prices = await fetchPrices();

  TOKENS.forEach((token) => {
    console.log(`  ${token.name}: $${prices[token.name].toFixed(4)}`);
  });

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const normalizedPrivateKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const wallet = new ethers.Wallet(normalizedPrivateKey, provider);
  const oracle = new ethers.Contract(manualOracleAddress, manualOracleAbi, wallet);

  const tokenAddresses = TOKENS.map((token) => token.address);
  const oraclePrices = TOKENS.map((token) => usdToOraclePrice(prices[token.name]));

  const tx = await oracle.setPrices(tokenAddresses, oraclePrices);
  console.log(`⏳ Submitted price update tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`✅ Prices updated. Gas used: ${receipt?.gasUsed?.toString() ?? "n/a"}`);
}

async function main() {
  const interval = Number(PRICE_UPDATE_INTERVAL_SECONDS ?? "0");

  if (interval > 0) {
    console.log(`Starting price updater with interval ${interval} seconds...`);
    await updatePrices();
    setInterval(() => {
      updatePrices().catch((err) => {
        console.error(`[${new Date().toISOString()}] Price update failed:`, err);
      });
    }, interval * 1000);
  } else {
    await updatePrices();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});

