import { Addresses } from "@/abi/contracts";

export const ARC_CHAIN_ID = 5042002 as const;
export const ARC_CHAIN_KEY = ARC_CHAIN_ID.toString();

type AddressEntry = { address: `0x${string}` };
type AddressRegistry = Record<string, AddressEntry | undefined>;

export function getAddress<K extends keyof typeof Addresses>(key: K): `0x${string}` {
  const registry = Addresses[key] as AddressRegistry;
  const entry = registry?.[ARC_CHAIN_KEY];

  if (!entry) {
    throw new Error(`Missing address for ${String(key)} on chain ${ARC_CHAIN_ID}`);
  }

  return entry.address;
}


