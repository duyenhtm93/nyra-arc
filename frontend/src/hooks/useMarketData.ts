"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { ABIs, Addresses } from "@/abi/contracts";
import { formatUnits } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";

// Hook để lấy thông tin từ PriceOracle
const chainId = 5042002 as const;

function getAddress(map: Record<string, { address: string }>, label: string) {
  const entry = map[String(chainId)];
  if (!entry) {
    throw new Error(`Missing ${label} address for chain ${chainId}`);
  }
  return entry.address as `0x${string}`;
}

export function useTokenPrice(tokenAddress: string) {
  const { data: price, isLoading, error } = useReadContract({
    address: getAddress(Addresses.ManualPriceOracle, "ManualPriceOracle"),
    abi: ABIs.ManualPriceOracle,
    functionName: "getPrice",
    args: [tokenAddress as `0x${string}`],
  });

  return {
    price: price ? Number(formatUnits(price, 8)) : 0, // PriceOracle returns 8 decimals
    isLoading,
    error,
  };
}

// Hook để lấy interest rates từ LoanManager
export function useInterestRates(tokenAddress: string) {
  const { data: rates, isLoading, error } = useReadContract({
    address: getAddress(Addresses.LoanManager, "LoanManager"),
    abi: ABIs.LoanManager,
    functionName: "ratesByToken",
    args: [tokenAddress as `0x${string}`],
  });

  return {
    borrowRate: rates ? Number(rates[0]) / 100 : 0, // Convert from bps to %
    lendRate: rates ? Number(rates[1]) / 100 : 0,
    isLoading,
    error,
  };
}

// Hook để lấy treasury stats từ LoanManager
export function useTreasuryStats(tokenAddress: string) {
  const { data: treasury, isLoading, error } = useReadContract({
    address: getAddress(Addresses.LoanManager, "LoanManager"),
    abi: ABIs.LoanManager,
    functionName: "treasury",
    args: [tokenAddress as `0x${string}`],
  });

  // Hook để lấy available liquidity từ LoanManager
  const { data: availableLiquidity, isLoading: liquidityLoading, error: liquidityError } = useReadContract({
    address: getAddress(Addresses.LoanManager, "LoanManager"),
    abi: ABIs.LoanManager,
    functionName: "getAvailableLiquidity",
    args: [tokenAddress as `0x${string}`],
  });


  // Get token info to determine correct decimals
  const tokenInfo = getTokenInfo(tokenAddress);
  
  // Convert raw data to numbers, with correct decimals
  // treasury can be either array [totalDeposits, totalBorrows, totalRepayments] or object
  const totalDeposits = treasury 
    ? Number(formatUnits((Array.isArray(treasury) ? treasury[0] : (treasury as any).totalDeposits) ?? BigInt(0), tokenInfo.decimals))
    : 0;
  const totalBorrows = treasury 
    ? Number(formatUnits((Array.isArray(treasury) ? treasury[1] : (treasury as any).totalBorrows) ?? BigInt(0), tokenInfo.decimals))
    : 0;
  const totalRepayments = treasury 
    ? Number(formatUnits((Array.isArray(treasury) ? treasury[2] : (treasury as any).totalRepayments) ?? BigInt(0), tokenInfo.decimals))
    : 0;
  
  // Available liquidity từ contract
  const availableLiquidityAmount = availableLiquidity ? Number(formatUnits(availableLiquidity, tokenInfo.decimals)) : 0;

  return {
    totalDeposits,
    totalBorrows,
    totalRepayments,
    availableLiquidity: availableLiquidityAmount,
    isLoading: isLoading || liquidityLoading,
    error: error || liquidityError,
  };
}

// Hook để lấy LTV từ CollateralManager
export function useTokenLTV(tokenAddress: string) {
  const { data: config, isLoading, error } = useReadContract({
    address: getAddress(Addresses.CollateralManager, "CollateralManager"),
    abi: ABIs.CollateralManager,
    functionName: "tokenConfig",
    args: [tokenAddress as `0x${string}`],
  });

  return {
    ltv: config ? Number((config as any).ltv ?? (Array.isArray(config) ? config[1] : 0)) : 0,
    liquidationThreshold: config ? Number((config as any).liquidationThreshold ?? (Array.isArray(config) ? config[2] : 0)) : 0,
    allowed: config ? Boolean((config as any).allowed ?? (Array.isArray(config) ? config[0] : false)) : false,
    isLoading,
    error,
  };
}

// Hook tổng hợp cho Market data (OPTIMIZED - 1 batch query thay vì 25 queries)
export function useMarketData() {
  const tokenAddresses = [
    getAddress(Addresses.BTC, "BTC"),
    getAddress(Addresses.ETH, "ETH"),
    getAddress(Addresses.BNB, "BNB"),
    getAddress(Addresses.USDC, "USDC"),
    getAddress(Addresses.EURC, "EURC"),
    getAddress(Addresses.NYRA, "NYRA"),
  ];

  // Batch tất cả queries thành 1 call duy nhất (25 queries → 1 batch)
  const { data, isLoading, error } = useReadContracts({
    contracts: tokenAddresses.flatMap((tokenAddress) => [
      // Price from PriceOracle
      {
        address: getAddress(Addresses.ManualPriceOracle, "ManualPriceOracle"),
        abi: ABIs.ManualPriceOracle,
        functionName: "getPrice",
        args: [tokenAddress as `0x${string}`],
        chainId,
      },
      // Rates from LoanManager
      {
        address: getAddress(Addresses.LoanManager, "LoanManager"),
        abi: ABIs.LoanManager,
        functionName: "ratesByToken",
        args: [tokenAddress as `0x${string}`],
        chainId,
      },
      // Treasury from LoanManager
      {
        address: getAddress(Addresses.LoanManager, "LoanManager"),
        abi: ABIs.LoanManager,
        functionName: "treasury",
        args: [tokenAddress as `0x${string}`],
        chainId,
      },
      // Available Liquidity from LoanManager
      {
        address: getAddress(Addresses.LoanManager, "LoanManager"),
        abi: ABIs.LoanManager,
        functionName: "getAvailableLiquidity",
        args: [tokenAddress as `0x${string}`],
        chainId,
      },
      // LTV from CollateralManager
      {
        address: getAddress(Addresses.CollateralManager, "CollateralManager"),
        abi: ABIs.CollateralManager,
        functionName: "tokenConfig",
        args: [tokenAddress as `0x${string}`],
        chainId,
      },
    ]),
  });

  // Parse results (mỗi token có 5 results liên tiếp)
  const marketData = tokenAddresses.map((tokenAddress, tokenIndex) => {
    const baseIndex = tokenIndex * 5;
    const tokenInfo = getTokenInfo(tokenAddress);
    
    const priceRaw = data?.[baseIndex]?.result as bigint | undefined;
    const ratesRaw = data?.[baseIndex + 1]?.result as readonly [bigint, bigint] | undefined;
    const treasuryRaw = data?.[baseIndex + 2]?.result as readonly [bigint, bigint, bigint] | undefined;
    const liquidityRaw = data?.[baseIndex + 3]?.result as bigint | undefined;
    const configRaw = data?.[baseIndex + 4]?.result as { ltv: bigint; liquidationThreshold: bigint; allowed: boolean } | undefined;

    const price = priceRaw ? Number(formatUnits(priceRaw, 8)) : 0;
    const borrowRate = ratesRaw ? Number(ratesRaw[0]) / 100 : 0;
    const lendRate = ratesRaw ? Number(ratesRaw[1]) / 100 : 0;
    const totalDeposits = treasuryRaw ? Number(formatUnits(treasuryRaw[0], tokenInfo.decimals)) : 0;
    const totalBorrowed = treasuryRaw ? Number(formatUnits(treasuryRaw[1], tokenInfo.decimals)) : 0;
    const availableLiquidity = liquidityRaw ? Number(formatUnits(liquidityRaw, tokenInfo.decimals)) : 0;
    const ltv = configRaw?.ltv ? Number(configRaw.ltv) : 0;

    return {
      tokenAddress,
      asset: tokenInfo.symbol,
      icon: tokenInfo.icon,
      price,
      borrowRate,
      lendRate,
      totalSupplied: availableLiquidity,
      totalBorrowed,
      ltv,
      utilization: totalDeposits > 0 ? (totalBorrowed / totalDeposits) * 100 : 0,
      isLoading: false,
      error: null,
    };
  });

  return marketData;
}
