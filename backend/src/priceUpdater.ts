import "dotenv/config";
import fetch from "node-fetch";
import { ethers } from "ethers";

const {
  ARC_RPC_URL,
  PRIVATE_KEY,
  MANUAL_ORACLE_ADDRESS,
  PRICE_UPDATE_INTERVAL_SECONDS = "60",
  COINGECKO_API_BASE = "https://api.coingecko.com/api/v3",
} = process.env;

const DEVIATION_THRESHOLD = 0.005; // 0.5%
const HEARTBEAT_INTERVAL = 9 * 60; // 9 minutes (Contract stale time is 10 mins)

function requireEnv(variable: string): string {
  const value = process.env[variable];
  if (!value || value.trim() === "") {
    throw new Error(`Missing ${variable} in environment variables`);
  }
  return value;
}

const manualOracleAbi = [
  "function setPrices(address[] tokens, uint256[] prices) external",
  "function getPrice(address token) external view returns (uint256)",
  "function usdc() external view returns (address)"
];

type TokenConfig = {
  name: string;
  address: string;
  coingeckoId: string;
  binanceSymbol?: string;
};

const TOKENS: TokenConfig[] = [
  {
    name: "BTC",
    address: requireEnv("BTC_ADDRESS"),
    coingeckoId: "bitcoin",
    binanceSymbol: "BTCUSDT"
  },
  {
    name: "ETH",
    address: requireEnv("ETH_ADDRESS"),
    coingeckoId: "ethereum",
    binanceSymbol: "ETHUSDT"
  },
  {
    name: "BNB",
    address: requireEnv("BNB_ADDRESS"),
    coingeckoId: "binancecoin",
    binanceSymbol: "BNBUSDT"
  },
  {
    name: "EURC",
    address: requireEnv("EURC_ADDRESS"),
    coingeckoId: "euro-coin",
    binanceSymbol: "EURCUSDT"
  }
];

type PriceMap = Record<string, number>;

// Store last update time per token to handle heartbeat
const lastUpdateTime: Record<string, number> = {};

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal as any,
      headers: { "user-agent": "nyra-price-bot/1.0" }
    });
    if (!response.ok) throw new Error(`Fetch error: ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFromCoinGecko(ids: string): Promise<PriceMap> {
  try {
    const url = `${COINGECKO_API_BASE}/simple/price?ids=${ids}&vs_currencies=usd`;
    const data = await fetchWithTimeout(url, 5000);

    const result: PriceMap = {};
    for (const token of TOKENS) {
      if (token.coingeckoId && data[token.coingeckoId]) {
        result[token.name] = data[token.coingeckoId].usd;
      }
    }
    return result;
  } catch (e) {
    throw new Error(`CoinGecko fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function fetchFromBinance(): Promise<PriceMap> {
  const result: PriceMap = {};
  for (const token of TOKENS) {
    if (token.binanceSymbol) {
      try {
        const url = `https://api.binance.com/api/v3/ticker/price?symbol=${token.binanceSymbol}`;
        const data = await fetchWithTimeout(url, 3000);
        if (data.price) result[token.name] = parseFloat(data.price);
      } catch (e) {
        console.warn(`[NYRA-BOT] Failed to fetch ${token.name} from Binance: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return result;
}

async function getPrices(): Promise<PriceMap> {
  const ids = TOKENS.filter(t => t.coingeckoId).map(t => t.coingeckoId).join(",");
  let prices: PriceMap = {};

  // Try CoinGecko First
  try {
    prices = await fetchFromCoinGecko(ids);
    console.log("[NYRA-BOT] Fetched prices from CoinGecko");
  } catch (e) {
    console.warn("[NYRA-BOT] CoinGecko failed, trying Binance...");
    prices = await fetchFromBinance();
  }

  return prices;
}

// Initialize Provider and Wallet once to avoid overhead
const provider = new ethers.JsonRpcProvider(ARC_RPC_URL, undefined, {
  staticNetwork: true, // Speeds up startup by skipping detectNetwork
});
const wallet = new ethers.Wallet(PRIVATE_KEY!, provider);

async function updatePrices() {
  const oracle = new ethers.Contract(MANUAL_ORACLE_ADDRESS!, manualOracleAbi, wallet);

  let usdcAddr: string;
  let currentPrices: PriceMap;

  try {
    console.log(`[NYRA-BOT] Checking connectivity and fetching data...`);
    // Check if network is reachable with a simple call
    usdcAddr = await oracle.usdc();
    currentPrices = await getPrices();

    // Log the actual prices fetched
    console.log("[NYRA-BOT] Current Market Prices:");
    for (const [name, val] of Object.entries(currentPrices)) {
      console.log(`  • ${name}: $${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`);
    }
  } catch (e) {
    console.error(`[NYRA-BOT] Connectivity error (check your ARC_RPC_URL):`, e instanceof Error ? e.message : String(e));
    return; // Skip this loop if RPC is down
  }

  const tokensToUpdate: string[] = [];
  const pricesToUpdate: bigint[] = [];

  for (const token of TOKENS) {
    if (token.address.toLowerCase() === usdcAddr.toLowerCase()) continue;

    const newPrice = currentPrices[token.name];
    if (!newPrice) continue;

    let shouldUpdate = false;
    const now = Math.floor(Date.now() / 1000);

    try {
      // 1. Check Deviation
      const onChainPriceRaw = await oracle.getPrice(token.address).catch(() => BigInt(0));
      const onChainPrice = Number(onChainPriceRaw) / 1e8;

      if (onChainPrice === 0) {
        shouldUpdate = true;
        console.log(`[NYRA-BOT] ${token.name} price not set on-chain, initial update.`);
      } else {
        const deviation = Math.abs(newPrice - onChainPrice) / onChainPrice;
        if (deviation >= DEVIATION_THRESHOLD) {
          shouldUpdate = true;
          console.log(`[NYRA-BOT] ${token.name} deviated ${(deviation * 100).toFixed(2)}% (Limit: ${DEVIATION_THRESHOLD * 100}%).`);
        }
      }

      // 2. Check Heartbeat (must update every 9 mins even if no deviation)
      if (!shouldUpdate && (!lastUpdateTime[token.name] || (now - lastUpdateTime[token.name] > HEARTBEAT_INTERVAL))) {
        shouldUpdate = true;
        console.log(`[NYRA-BOT] ${token.name} heartbeat active.`);
      }

      if (shouldUpdate) {
        tokensToUpdate.push(token.address);
        pricesToUpdate.push(BigInt(Math.round(newPrice * 1e8)));
        lastUpdateTime[token.name] = now;
      }
    } catch (e) {
      console.error(`[NYRA-BOT] Error processing ${token.name}:`, e);
    }
  }

  if (tokensToUpdate.length > 0) {
    console.log(`[NYRA-BOT] Updating ${tokensToUpdate.length} tokens...`);
    try {
      const tx = await oracle.setPrices(tokensToUpdate, pricesToUpdate);
      console.log(`[NYRA-BOT] Tx hash: ${tx.hash}`);
      await tx.wait();
      console.log(`[NYRA-BOT] Successfully updated prices.`);
    } catch (e) {
      console.error(`[NYRA-BOT] Transaction failed:`, e);
    }
  } else {
    console.log(`[NYRA-BOT] No updates needed.`);
  }
}

async function main() {
  const intervalSetting = PRICE_UPDATE_INTERVAL_SECONDS || "60";
  let intervalMs = parseInt(intervalSetting) * 1000;

  if (isNaN(intervalMs)) {
    console.warn("[NYRA-BOT] Warning: Invalid PRICE_UPDATE_INTERVAL_SECONDS. Defaulting to 60s.");
    intervalMs = 60000;
  }

  console.log("===============================================");
  console.log("🚀 Nyra Optimized Price Keeper Started");
  console.log(`  RPC: ${ARC_RPC_URL}`);
  console.log(`  Oracle: ${MANUAL_ORACLE_ADDRESS}`);
  console.log(`  Deviation Threshold: ${DEVIATION_THRESHOLD * 100}%`);
  console.log(`  Heartbeat: ${HEARTBEAT_INTERVAL / 60} mins`);
  console.log(`  Mode: ${intervalMs === 0 ? "One-time Update" : "Scheduler (" + intervalMs / 1000 + "s)"}`);
  console.log("===============================================");

  // Initial run
  console.log("[NYRA-BOT] Running price update...");
  await updatePrices().catch(console.error);

  if (intervalMs > 0) {
    console.log(`[NYRA-BOT] Scheduler started. Next check in ${intervalMs / 1000}s.`);
    setInterval(() => {
      updatePrices().catch(err => console.error("[NYRA-BOT] Fatal loop error:", err));
    }, intervalMs);
  } else {
    console.log("[NYRA-BOT] One-time update completed. Exiting.");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
