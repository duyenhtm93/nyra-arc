import { Addresses } from "@/abi/contracts";
import { ARC_CHAIN_KEY, getAddress as getChainAddress } from "@/utils/addresses";

export interface TokenInfo {
  symbol: string;
  icon: string;
  name: string;
  decimals: number;
}

// Token metadata mapping
type AddressMap = Record<string, { address: string; chainId: number; chainName: string }>;

function getAddress(contract: keyof typeof Addresses): string {
  if (contract in Addresses) {
    const map = Addresses[contract] as AddressMap;
    const entry = map[ARC_CHAIN_KEY];
    if (!entry) {
      throw new Error(`Missing ${contract} address for chain ${ARC_CHAIN_KEY}`);
    }
    return entry.address;
  }
  return getChainAddress(contract);
}

const TOKEN_METADATA: Record<string, TokenInfo> = {
  [getAddress("BTC")]: {
    symbol: "BTC",
    icon: "/btc.svg",
    name: "Bitcoin",
    decimals: 8,
  },
  [getAddress("ETH")]: {
    symbol: "ETH",
    icon: "/eth.svg",
    name: "Ethereum",
    decimals: 18,
  },
  [getAddress("EURC")]: {
    symbol: "EURC",
    icon: "/eurc.svg",
    name: "Euro Coin",
    decimals: 6,
  },
  [getAddress("USDC")]: {
    symbol: "USDC",
    icon: "/usdc.svg",
    name: "US Dollar Coin",
    decimals: 6,
  },
  [getAddress("BNB")]: {
    symbol: "BNB",
    icon: "/bnb.svg",
    name: "Binance Coin",
    decimals: 18,
  },
};

/**
 * Get token information by contract address
 */
export function getTokenInfo(address: string): TokenInfo {
  return TOKEN_METADATA[address] || {
    symbol: "Unknown",
    icon: "/next.svg", // Fallback to existing logo
    name: "Unknown Token",
    decimals: 18,
  };
}

/**
 * Get token symbol by contract address
 */
export function getTokenSymbol(address: string): string {
  return getTokenInfo(address).symbol;
}

/**
 * Get token icon by contract address
 */
export function getTokenIcon(address: string): string {
  return getTokenInfo(address).icon;
}


/**
 * Get token name by contract address
 */
export function getTokenName(address: string): string {
  return getTokenInfo(address).name;
}

/**
 * Get token decimals by contract address
 */
export function getTokenDecimals(address: string): number {
  return getTokenInfo(address).decimals;
}

/**
 * Get all supported token addresses
 */
export function getSupportedTokenAddresses(): string[] {
  return Object.keys(TOKEN_METADATA);
}

/**
 * Get all token info objects
 */
export function getAllTokenInfo(): TokenInfo[] {
  return Object.values(TOKEN_METADATA);
}
