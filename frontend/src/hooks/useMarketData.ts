"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { ABIs, Addresses } from "@/abi/contracts";
import { formatUnits } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { useMemo, useEffect } from "react";

// Hook để lấy thông tin từ PriceOracle
const chainId = 5042002 as const;

function getAddress(map: Record<string, { address: string }>, label: string) {
  const entry = map[String(chainId)];
  if (!entry) {
    throw new Error(`Missing ${label} address for chain ${chainId}`);
  }
  return entry.address as `0x${string}`;
}

// RAY precision for interest index calculations
const RAY = BigInt(1e27);

export function useTokenPrice(tokenAddress: string) {
  const { data: price, isLoading, error } = useReadContract({
    address: getAddress(Addresses.ManualPriceOracle, "ManualPriceOracle"),
    abi: ABIs.ManualPriceOracle,
    functionName: "getPrice",
    args: [tokenAddress as `0x${string}`],
  });

  return {
    price: price ? Number(formatUnits(price as bigint, 8)) : undefined,
    isLoading,
    error,
  };
}

// Optimized Market data hook
export function useMarketData(refreshKey?: number) {
  const tokenAddresses = useMemo(() => [
    getAddress(Addresses.BTC, "BTC"),
    getAddress(Addresses.ETH, "ETH"),
    getAddress(Addresses.BNB, "BNB"),
    getAddress(Addresses.USDC, "USDC"),
    getAddress(Addresses.EURC, "EURC"),
  ], []);

  const { data, isLoading: contractsLoading, error: contractsError, refetch } = useReadContracts({
    contracts: tokenAddresses.flatMap((tokenAddress) => [
      // 0: Price from PriceOracle
      {
        address: getAddress(Addresses.ManualPriceOracle, "ManualPriceOracle"),
        abi: ABIs.ManualPriceOracle,
        functionName: "getPrice",
        args: [tokenAddress as `0x${string}`],
        chainId,
      },
      // 1: Borrow Rate (bps)
      {
        address: getAddress(Addresses.LoanManager, "LoanManager"),
        abi: ABIs.LoanManager,
        functionName: "getBorrowRate",
        args: [tokenAddress as `0x${string}`],
        chainId,
      },
      // 2: Supply Rate (bps)
      {
        address: getAddress(Addresses.LoanManager, "LoanManager"),
        abi: ABIs.LoanManager,
        functionName: "getSupplyRate",
        args: [tokenAddress as `0x${string}`],
        chainId,
      },
      // 3: Utilization (bps)
      {
        address: getAddress(Addresses.LoanManager, "LoanManager"),
        abi: ABIs.LoanManager,
        functionName: "getUtilizationRate",
        args: [tokenAddress as `0x${string}`],
        chainId,
      },
      // 4: Treasury Statistics (includes scales and indexes)
      {
        address: getAddress(Addresses.LoanManager, "LoanManager"),
        abi: ABIs.LoanManager,
        functionName: "treasury",
        args: [tokenAddress as `0x${string}`],
        chainId,
      },
      // 5: Token LTV Config (from CollateralManager)
      {
        address: getAddress(Addresses.CollateralManager, "CollateralManager"),
        abi: ABIs.CollateralManager,
        functionName: "tokenConfig",
        args: [tokenAddress as `0x${string}`],
        chainId,
      },
    ]),
    query: {
      staleTime: 15000,
      refetchOnWindowFocus: false,
      refetchInterval: false,
    },
  });

  // Trigger refetch when refreshKey changes (Immediate update)
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refetch();
    }
  }, [refreshKey, refetch]);

  const marketData = useMemo(() => {
    return tokenAddresses.map((tokenAddress, tokenIndex) => {
      const baseIndex = tokenIndex * 6;
      const tokenInfo = getTokenInfo(tokenAddress);

      const priceResult = data?.[baseIndex];
      const borrowRateResult = data?.[baseIndex + 1];
      const supplyRateResult = data?.[baseIndex + 2];
      const utilResult = data?.[baseIndex + 3];
      const treasuryResult = data?.[baseIndex + 4];
      const configResult = data?.[baseIndex + 5];

      const priceRaw = priceResult?.result as bigint | undefined;
      const borrowRateBps = borrowRateResult?.result as bigint | undefined;
      const supplyRateBps = supplyRateResult?.result as bigint | undefined;
      const utilBps = utilResult?.result as bigint | undefined;
      const treasuryRaw = treasuryResult?.result as any;
      const configRaw = configResult?.result as any;

      // Extract from treasury struct: totalDeposits, totalBorrows, lastUpdate, borrowIndex, supplyIndex, reserveFactor
      const scaledDeposits = BigInt(treasuryRaw?.[0] || 0);
      const scaledBorrows = BigInt(treasuryRaw?.[1] || 0);
      const borrowIndex = BigInt(treasuryRaw?.[3] || RAY);
      const supplyIndex = BigInt(treasuryRaw?.[4] || RAY);

      // Calculate actual amounts: (scaled * index) / RAY
      const actualDeposits = (scaledDeposits * supplyIndex) / RAY;
      const actualBorrows = (scaledBorrows * borrowIndex) / RAY;

      const price = priceRaw ? Number(formatUnits(priceRaw, 8)) : 0;
      const borrowRate = borrowRateBps ? Number(borrowRateBps) / 100 : 0;
      const lendRate = supplyRateBps ? Number(supplyRateBps) / 100 : 0;
      const utilization = utilBps ? Number(utilBps) / 100 : 0;

      const totalSupplied = Number(formatUnits(actualDeposits, tokenInfo.decimals));
      const totalBorrowed = Number(formatUnits(actualBorrows, tokenInfo.decimals));

      const ltv = configRaw?.ltv ? Number(configRaw.ltv) : (Array.isArray(configRaw) ? Number(configRaw[1]) : 0);
      const liquidationThreshold = configRaw?.liquidationThreshold ? Number(configRaw.liquidationThreshold) : (Array.isArray(configRaw) ? Number(configRaw[2]) : 0);

      const hasError = priceResult?.status === 'failure';

      return {
        tokenAddress,
        asset: tokenInfo.symbol,
        icon: tokenInfo.icon,
        price: price === 0 && contractsLoading ? undefined : price,
        borrowRate,
        lendRate,
        totalSupplied,
        totalBorrowed,
        ltv: ltv || 75,
        liquidationThreshold: liquidationThreshold || 80,
        utilization,
        isLoading: contractsLoading,
        error: hasError || contractsError,
      };
    });
  }, [data, tokenAddresses, contractsLoading, contractsError]);

  return marketData;
}
