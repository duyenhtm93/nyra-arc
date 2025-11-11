import { useReadContract, useReadContracts, useWriteContract, useAccount } from "wagmi";
import { useEffect } from "react";
import { useWallets } from "@privy-io/react-auth";
import { formatUnits, parseUnits } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { ARC_CHAIN_ID, getAddress } from "@/utils/addresses";

// Hook để lấy balance của một token
export function useTokenBalance(tokenAddress: string, userAddress?: string) {
  const { data: balance, isLoading, error, refetch } = useReadContract({
    address: tokenAddress as `0x${string}`,
    abi: [
      {
        name: "balanceOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
    functionName: "balanceOf",
    args: userAddress ? [userAddress as `0x${string}`] : undefined,
    chainId: ARC_CHAIN_ID,
  });

  const tokenInfo = getTokenInfo(tokenAddress);
  const formattedBalance = balance ? parseFloat(formatUnits(balance, tokenInfo.decimals)) : 0;

  return { balance: formattedBalance, isLoading, error, refetch };
}

// Hook để lấy user collateral balances từ CollateralManager
export function useUserCollaterals(userAddress?: string, refreshKey?: number) {
  
  // Danh sách token được support làm collateral
  const supportedTokens = [getAddress("BTC"), getAddress("ETH"), getAddress("BNB")];

  // Batch query tất cả collateral balances cùng lúc
  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: supportedTokens.map((tokenAddress) => ({
      address: getAddress("CollateralManager"),
      abi: [
        {
          name: "collateralBalances",
          type: "function" as const,
          stateMutability: "view" as const,
          inputs: [
            { name: "user", type: "address" },
            { name: "token", type: "address" }
          ],
          outputs: [{ name: "", type: "uint256" }],
        },
      ] as const,
      functionName: "collateralBalances",
      args: userAddress ? [userAddress as `0x${string}`, tokenAddress as `0x${string}`] : undefined,
      chainId: ARC_CHAIN_ID,
    })),
    query: {
      enabled: !!userAddress,
      staleTime: 0, // Luôn cho phép refetch
      refetchOnWindowFocus: false,
    },
  });

  // Trigger refetch when refreshKey changes
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refetch();
    }
  }, [refreshKey, refetch]);

  if (isLoading) {
    return { collaterals: [], isLoading: true, error: null };
  }

  // Format collaterals data
  const formattedCollaterals = data?.map((result, index) => {
    const collateral = result.result as bigint | undefined;
    
    if (!collateral || collateral === BigInt(0)) {
      return null;
    }

    const tokenInfo = getTokenInfo(supportedTokens[index]);
    return {
      tokenAddress: supportedTokens[index],
      symbol: tokenInfo.symbol,
      icon: tokenInfo.icon,
      name: tokenInfo.name,
      amount: parseFloat(formatUnits(collateral, tokenInfo.decimals)),
    };
  }).filter((item): item is NonNullable<typeof item> => item !== null) || [];

  return { collaterals: formattedCollaterals, isLoading: false, error: null };
}

// Hook để lấy wallet balances (tái sử dụng từ useUserSupply)
export function useWalletBalances(userAddress?: string, refreshKey?: number) {
  const tokenAddresses = [getAddress("BTC"), getAddress("ETH"), getAddress("BNB")];

  // Batch query tất cả balances cùng lúc
  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: tokenAddresses.map((tokenAddress) => ({
      address: tokenAddress as `0x${string}`,
      abi: [
        {
          name: "balanceOf",
          type: "function" as const,
          stateMutability: "view" as const,
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
        },
      ] as const,
      functionName: "balanceOf",
      args: userAddress ? [userAddress as `0x${string}`] : undefined,
      chainId: ARC_CHAIN_ID,
    })),
    query: {
      enabled: !!userAddress,
      staleTime: 0, // Luôn cho phép refetch
      refetchOnWindowFocus: false,
    },
  });

  // Trigger refetch when refreshKey changes
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refetch();
    }
  }, [refreshKey, refetch]);

  const balances = tokenAddresses.map((tokenAddress, index) => {
    const tokenInfo = getTokenInfo(tokenAddress);
    const balance = data?.[index]?.result as bigint | undefined;
    const formattedBalance = balance ? parseFloat(formatUnits(balance, tokenInfo.decimals)) : 0;

    return {
      tokenAddress,
      symbol: tokenInfo.symbol,
      icon: tokenInfo.icon,
      name: tokenInfo.name,
      balance: formattedBalance,
      isLoading: false,
      error: data?.[index]?.error,
    };
  });

  return { balances, isLoading, error: null };
}

// Hook để lấy thông tin chi tiết về collateral (tổng giá trị, health factor, etc.)
export function useCollateralDetails(userAddress?: string, refreshKey?: number) {

  // Sử dụng function getUserCollateralData() mới để lấy tất cả dữ liệu trong 1 call
  const { data: collateralData, isLoading, error } = useReadContract({
    address: getAddress("CollateralManager"),
    abi: [
      {
        name: "getUserCollateralData",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "user", type: "address" }],
        outputs: [
          { name: "totalCollateralUSD", type: "uint256" },
          { name: "maxLoanUSD", type: "uint256" },
          { name: "debtUSD", type: "uint256" },
          { name: "healthFactor", type: "uint256" }
        ],
      },
    ],
    functionName: "getUserCollateralData",
    args: userAddress ? [userAddress as `0x${string}`] : undefined,
    chainId: ARC_CHAIN_ID,
    query: {
      enabled: !!userAddress,
      staleTime: refreshKey ? 0 : 30000, // Force refresh when refreshKey changes
      refetchOnWindowFocus: false,
    },
  });

  // Parse dữ liệu từ contract (tất cả đều là USD với 8 decimals)
  const totalCollateralValue = collateralData?.[0] ? parseFloat(formatUnits(collateralData[0], 8)) : 0;
  const maxLoanUSD = collateralData?.[1] ? parseFloat(formatUnits(collateralData[1], 8)) : 0;
  const debtUSD = collateralData?.[2] ? parseFloat(formatUnits(collateralData[2], 8)) : 0;
  
  // Health Factor từ contract (18 decimals)
  let healthFactor = 999; // Default khi chưa có loan
  if (collateralData?.[3]) {
    const rawHealthFactor = parseFloat(formatUnits(collateralData[3], 18));
    // Nếu health factor quá lớn (vô cực từ contract), set về 999
    healthFactor = rawHealthFactor > 1e10 ? 999 : rawHealthFactor;
  }
  
  // Available to Borrow = Max Loan Allowed - Outstanding Debt
  const availableToBorrow = Math.max(0, maxLoanUSD - debtUSD);

  return {
    totalCollateralValue,
    outstandingLoan: debtUSD,
    healthFactor,
    availableToBorrow,
    maxLoanUSD, // Thêm field mới
    isLoading,
    error
  };
}

// Hook để lấy giá trị USD của một token cụ thể từ contract
export function useCollateralValueByToken(userAddress?: string, tokenAddress?: string) {
  const { data: tokenValueUSD, isLoading, error } = useReadContract({
    address: getAddress("CollateralManager"),
    abi: [
      {
        name: "getCollateralValueUSDByToken",
        type: "function",
        stateMutability: "view",
        inputs: [
          { name: "user", type: "address" },
          { name: "token", type: "address" }
        ],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
    functionName: "getCollateralValueUSDByToken",
    args: userAddress && tokenAddress ? [userAddress as `0x${string}`, tokenAddress as `0x${string}`] : undefined,
    chainId: ARC_CHAIN_ID,
    query: {
      enabled: !!userAddress && !!tokenAddress,
      staleTime: 30000,
      refetchOnWindowFocus: false,
    },
  });

  const valueUSD = tokenValueUSD ? parseFloat(formatUnits(tokenValueUSD, 8)) : 0; // Oracle trả về 8 decimals

  return {
    valueUSD,
    isLoading,
    error
  };
}

// Hook để đọc Health Factor của một user cụ thể
export function useHealthFactor(userAddress?: string) {
  const { data: healthFactor, isLoading, error, refetch } = useReadContract({
    address: getAddress("CollateralManager"),
    abi: [
      {
        name: "getHealthFactor",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "user", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
    functionName: "getHealthFactor",
    args: userAddress ? [userAddress as `0x${string}`] : undefined,
    chainId: ARC_CHAIN_ID,
    query: {
      enabled: !!userAddress,
      staleTime: 10000, // Refresh every 10s
      refetchOnWindowFocus: false,
    },
  });

  // Convert 1e18 to human readable number
  // Contract trả về với 18 decimals: 1.0 = 1e18, 2.0 = 2e18
  let hf = healthFactor 
    ? parseFloat(formatUnits(healthFactor, 18))
    : 0;

  // Cap at 999 for display (khi không có debt, contract trả về giá trị rất lớn)
  if (hf > 999 || !isFinite(hf)) {
    hf = 999;
  }

  // Determine status
  let status: 'safe' | 'warning' | 'liquidatable' = 'safe';
  if (hf === 0 || hf >= 999) {
    // No debt or very high health factor
    status = 'safe';
  } else if (hf < 1) {
    status = 'liquidatable';
  } else if (hf < 1.2) {
    status = 'warning';
  }

  return {
    healthFactor: hf,
    status,
    isLoading,
    error,
    refetch,
  };
}

// Hook để thực hiện liquidation
export function useLiquidation() {
  const { writeContract, data: hash, error, isPending } = useWriteContract();
  const { address } = useAccount();
  const { wallets } = useWallets();
  
  // Dùng address từ wallets nếu useAccount không có
  const userAddress = address || wallets[0]?.address;

  const liquidate = async (
    borrower: string,
    repayToken: string,
    repayAmount: string,
    collateralToken: string
  ) => {
    if (!userAddress) {
      throw new Error("No wallet connected");
    }

    const repayTokenInfo = getTokenInfo(repayToken);
    if (!repayTokenInfo) {
      throw new Error("Repay token not supported");
    }

    try {
      const amountWei = parseUnits(repayAmount, repayTokenInfo.decimals);
      
      await writeContract({
        address: getAddress("CollateralManager"),
        abi: [
          {
            name: "liquidate",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "borrower", type: "address" },
              { name: "repayToken", type: "address" },
              { name: "repayAmount", type: "uint256" },
              { name: "collateralToken", type: "address" }
            ],
            outputs: [],
          },
        ],
        functionName: "liquidate",
        args: [
          borrower as `0x${string}`,
          repayToken as `0x${string}`,
          amountWei,
          collateralToken as `0x${string}`
        ],
        chainId: ARC_CHAIN_ID,
      });
    } catch (err) {
      console.error("Liquidation failed:", err);
      throw err;
    }
  };

  return {
    liquidate,
    hash,
    error,
    isPending,
  };
}