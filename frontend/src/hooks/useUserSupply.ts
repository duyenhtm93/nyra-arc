"use client";

import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useAccount } from "wagmi";
import { useEffect } from "react";
import { useWallets, usePrivy } from "@privy-io/react-auth";
import { formatUnits, parseUnits } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { ARC_CHAIN_ID, getAddress } from "@/utils/addresses";

const SUPPORTED_TOKEN_KEYS = ["USDC", "EURC"] as const;
const SUPPORTED_TOKENS = SUPPORTED_TOKEN_KEYS.map((key) => getAddress(key));

// Hook để lấy user supplies từ LoanManager
export function useUserSupplies(userAddress?: string, refreshKey?: number) {
  // Danh sách token được support
  const supportedTokens = SUPPORTED_TOKENS;

  // Batch query lenders và rewards cùng lúc
  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: [
      // Lenders queries
      ...supportedTokens.map((tokenAddress) => ({
        address: getAddress("LoanManager"),
        abi: [
          {
            name: "lenders",
            type: "function" as const,
            stateMutability: "view" as const,
            inputs: [
              { name: "user", type: "address" },
              { name: "token", type: "address" }
            ],
            outputs: [
              {
                name: "",
                type: "tuple",
                components: [
                  { name: "deposited", type: "uint256" },
                  { name: "depositTime", type: "uint256" },
                  { name: "rewardClaimed", type: "uint256" }
                ]
              }
            ],
          },
        ] as const,
        functionName: "lenders",
        args: userAddress ? [userAddress as `0x${string}`, tokenAddress as `0x${string}`] : undefined,
        chainId: ARC_CHAIN_ID,
      })),
      // Rewards queries
      ...supportedTokens.map((tokenAddress) => ({
        address: getAddress("LoanManager"),
        abi: [
          {
            name: "calculateLenderReward",
            type: "function" as const,
            stateMutability: "view" as const,
            inputs: [
              { name: "user", type: "address" },
              { name: "token", type: "address" }
            ],
            outputs: [{ name: "", type: "uint256" }],
          },
        ] as const,
        functionName: "calculateLenderReward",
        args: userAddress ? [userAddress as `0x${string}`, tokenAddress as `0x${string}`] : undefined,
        chainId: ARC_CHAIN_ID,
      })),
    ],
    query: {
      enabled: !!userAddress,
      staleTime: 0,
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
    return { supplies: [], isLoading: true, error: null };
  }

  // Format supplies data
  const formattedSupplies = supportedTokens
    .map((tokenAddress, index) => {
      const lender = data?.[index]?.result as any;
      const reward = data?.[index + 6]?.result as bigint | undefined;
      
      if (!lender || lender.deposited === BigInt(0)) {
        return null;
      }

      const tokenInfo = getTokenInfo(tokenAddress);
      return {
        tokenAddress,
        symbol: tokenInfo.symbol,
        icon: tokenInfo.icon,
        name: tokenInfo.name,
        amount: parseFloat(formatUnits(lender.deposited, tokenInfo.decimals)),
        interestEarned: reward ? parseFloat(formatUnits(reward, tokenInfo.decimals)) : 0,
      };
    })
    .filter(Boolean);

  return { supplies: formattedSupplies, isLoading: false, error: null };
}

// Hook để lấy wallet balances
export function useWalletBalances(userAddress?: string, refreshKey?: number) {
  const tokenAddresses = SUPPORTED_TOKENS;

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
      staleTime: 0,
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

  return balances;
}

// Hook để lấy supply APY rates
export function useSupplyRates(tokenAddress: string) {
  const { data: rates, isLoading, error } = useReadContract({
    address: getAddress("LoanManager"),
    abi: [
      {
        name: "ratesByToken",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "token", type: "address" }],
        outputs: [
          {
            name: "",
            type: "tuple",
            components: [
              { name: "borrowRate", type: "uint256" },
              { name: "lendRate", type: "uint256" }
            ]
          }
        ],
      },
    ],
      functionName: "ratesByToken",
      args: [tokenAddress as `0x${string}`],
      chainId: ARC_CHAIN_ID,
      query: {
        staleTime: 60000,
        refetchOnWindowFocus: true,
      },
  });

  // Handle both array and object return types
  let lendRate = 0;
  if (rates) {
    if (Array.isArray(rates)) {
      // rates = [borrowRate, lendRate]
      lendRate = rates[1] ? parseFloat(formatUnits(rates[1], 2)) : 0;
    } else if (rates.lendRate) {
      // rates = {borrowRate, lendRate}
      lendRate = parseFloat(formatUnits(rates.lendRate, 2));
    }
  }

  return { lendRate, isLoading, error };
}

// Hook để lấy LTV rates
export function useLTVRates(tokenAddress: string) {
  const { data: ltv, isLoading, error } = useReadContract({
    address: getAddress("CollateralManager"),
    abi: [
      {
        name: "ltvByToken",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "token", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
      functionName: "ltvByToken",
      args: [tokenAddress as `0x${string}`],
      chainId: ARC_CHAIN_ID,
      query: {
        staleTime: 60000,
        refetchOnWindowFocus: true,
      },
  });

  return { ltv: ltv ? Number(ltv) : 0, isLoading, error };
}

// Main hook tổng hợp cho SupplyCard
export function useUserSupply(refreshKey?: number) {
  const { ready, authenticated } = usePrivy();
  const { address } = useAccount();
  const { wallets } = useWallets();
  
  // ✅ Chỉ lấy address khi Privy ready
  const userAddress = (ready && authenticated) ? (address || wallets[0]?.address) : undefined;
  
  const userSupplies = useUserSupplies(userAddress, refreshKey);
  const walletBalances = useWalletBalances(userAddress, refreshKey);

  return {
    userSupplies,
    walletBalances,
    isLoading: userSupplies.isLoading || walletBalances.some(b => b.isLoading),
  };
}

// Hook để lấy thông tin lender cho một token cụ thể
export function useLenderInfo(tokenAddress: string) {
  const { ready, authenticated } = usePrivy();
  const { address } = useAccount();
  const { wallets } = useWallets();
  
  // Dùng address từ wallets nếu useAccount không có
  const userAddress = (ready && authenticated) ? (address || wallets[0]?.address) : undefined;
  
  // Sử dụng cùng logic với useUserSupplies để đảm bảo consistency
  const { data, isLoading: lenderLoading, error: lenderError } = useReadContracts({
    contracts: [
      // Lender query
      {
        address: getAddress("LoanManager"),
        abi: [
          {
            name: "lenders",
            type: "function" as const,
            stateMutability: "view" as const,
            inputs: [
              { name: "user", type: "address" },
              { name: "token", type: "address" }
            ],
            outputs: [
              {
                name: "",
                type: "tuple",
                components: [
                  { name: "deposited", type: "uint256" },
                  { name: "depositTime", type: "uint256" },
                  { name: "rewardClaimed", type: "uint256" }
                ]
              }
            ],
          },
        ],
        functionName: "lenders",
        args: userAddress ? [userAddress as `0x${string}`, tokenAddress as `0x${string}`] : undefined,
        chainId: ARC_CHAIN_ID,
      },
      // Reward query
      {
        address: getAddress("LoanManager"),
        abi: [
          {
            name: "calculateLenderReward",
            type: "function" as const,
            stateMutability: "view" as const,
            inputs: [
              { name: "user", type: "address" },
              { name: "token", type: "address" }
            ],
            outputs: [{ name: "", type: "uint256" }],
          },
        ],
        functionName: "calculateLenderReward",
        args: userAddress ? [userAddress as `0x${string}`, tokenAddress as `0x${string}`] : undefined,
        chainId: ARC_CHAIN_ID,
      },
    ],
    query: {
      enabled: !!userAddress && !!tokenAddress,
      staleTime: 30000,
      refetchOnWindowFocus: true,
    },
  });

  const lender = data?.[0]?.result;
  const currentReward = data?.[1]?.result;

  const tokenInfo = getTokenInfo(tokenAddress);
  
  if (!lender || !currentReward || !tokenInfo) {
    return {
      deposited: "0",
      depositedUSD: "0.00",
      currentReward: "0",
      currentRewardUSD: "0.00",
      totalWithdraw: "0",
      totalWithdrawUSD: "0.00",
      isLoading: lenderLoading,
      error: lenderError,
    };
  }

  const deposited = formatUnits(lender.deposited, tokenInfo.decimals);
  const reward = formatUnits(currentReward, tokenInfo.decimals);
  const totalWithdraw = formatUnits(lender.deposited + currentReward, tokenInfo.decimals);

  // Sử dụng giá mặc định 1.0 cho USD, các token khác sẽ cần market data
  const tokenPrice = tokenInfo.symbol === 'USDC' ? 1.0 : 1.0;

  return {
    deposited,
    depositedUSD: (parseFloat(deposited) * tokenPrice).toFixed(2),
    currentReward: reward,
    currentRewardUSD: (parseFloat(reward) * tokenPrice).toFixed(2),
    totalWithdraw,
    totalWithdrawUSD: (parseFloat(totalWithdraw) * tokenPrice).toFixed(2),
    isLoading: lenderLoading,
    error: lenderError,
  };
}

// Hook để withdraw all
export function useWithdrawAll() {
  const { writeContract, data: hash, error, isPending } = useWriteContract();
  const { address } = useAccount();
  const { wallets } = useWallets();
  
  // Dùng address từ wallets nếu useAccount không có
  const userAddress = address || wallets[0]?.address;

  const withdrawAll = async (tokenAddress: string) => {
    if (!userAddress) {
      throw new Error("No wallet connected");
    }

    try {
      await writeContract({
        address: getAddress("LoanManager"),
        abi: [
          {
            name: "withdrawAll",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [{ name: "token", type: "address" }],
            outputs: [],
          },
        ],
        functionName: "withdrawAll",
        args: [tokenAddress as `0x${string}`],
        chainId: ARC_CHAIN_ID,
      });
    } catch (err) {
      console.error("Withdraw All failed:", err);
      throw err;
    }
  };

  return {
    withdrawAll,
    hash,
    error,
    isPending,
  };
}

// Hook để withdraw một phần
export function useWithdraw() {
  const { writeContract, data: hash, error, isPending } = useWriteContract();
  const { address } = useAccount();
  const { wallets } = useWallets();
  
  // Dùng address từ wallets nếu useAccount không có
  const userAddress = address || wallets[0]?.address;

  const withdraw = async (tokenAddress: string, amount: string) => {
    if (!userAddress) {
      throw new Error("No wallet connected");
    }

    const tokenInfo = getTokenInfo(tokenAddress);
    if (!tokenInfo) {
      throw new Error("Token not supported");
    }

    try {
      const amountWei = parseUnits(amount, tokenInfo.decimals);
      
      await writeContract({
        address: getAddress("LoanManager"),
        abi: [
          {
            name: "withdraw",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" }
            ],
            outputs: [],
          },
        ],
        functionName: "withdraw",
        args: [tokenAddress as `0x${string}`, amountWei],
        chainId: ARC_CHAIN_ID,
      });
    } catch (err) {
      console.error("Withdraw failed:", err);
      throw err;
    }
  };

  return {
    withdraw,
    hash,
    error,
    isPending,
  };
}
