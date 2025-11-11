"use client";

import { useReadContract } from "wagmi";
import { useAccount } from "wagmi";
import { useEffect } from "react";
import { useWallets, usePrivy } from "@privy-io/react-auth";
import { ABIs } from "@/abi/contracts";
import { formatUnits } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { useMarketData } from "@/hooks/useMarketData";
import { ARC_CHAIN_ID, getAddress } from "@/utils/addresses";

// Hook để lấy danh sách tất cả active borrowers
export function useAllBorrowers() {
  const { data: borrowers, isLoading, error, refetch } = useReadContract({
    address: getAddress("LoanManager"),
    abi: [
      {
        name: "getActiveBorrowers",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "address[]" }],
      },
    ],
    functionName: "getActiveBorrowers",
    chainId: ARC_CHAIN_ID,
    query: {
      staleTime: 10000, // Refresh every 10s
      refetchOnWindowFocus: true,
    },
  });

  return {
    borrowers: borrowers || [],
    isLoading,
    error,
    refetch,
  };
}

// Hook để lấy user borrows từ LoanManager
export function useUserBorrows(userAddress?: string, refreshKey?: number) {
  // Lấy thông tin loan từ mapping loans[user]
  const { data: loan, isLoading: loanLoading, error: loanError, refetch: refetchLoan } = useReadContract({
    address: getAddress("LoanManager"),
    abi: [
      {
        name: "loans",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "user", type: "address" }],
        outputs: [
          {
            name: "",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "principal", type: "uint256" },
              { name: "rate", type: "uint256" },
              { name: "totalInterest", type: "uint256" },
              { name: "createdAt", type: "uint256" },
              { name: "duration", type: "uint256" },
              { name: "active", type: "bool" }
            ]
          }
        ],
      },
    ],
    functionName: "loans",
    args: userAddress ? [userAddress as `0x${string}`] : undefined,
    chainId: ARC_CHAIN_ID,
    query: {
      enabled: !!userAddress,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  });

  // Lấy outstanding loan amount
  const { data: outstandingLoan, isLoading: outstandingLoading, error: outstandingError, refetch: refetchOutstanding } = useReadContract({
    address: getAddress("LoanManager"),
    abi: [
      {
        name: "getOutstandingLoan",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "user", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
    functionName: "getOutstandingLoan",
    args: userAddress ? [userAddress as `0x${string}`] : undefined,
    chainId: ARC_CHAIN_ID,
    query: {
      enabled: !!userAddress,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  });

  // Trigger refetch when refreshKey changes
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refetchLoan();
      refetchOutstanding();
    }
  }, [refreshKey, refetchLoan, refetchOutstanding]);

  const isLoading = loanLoading || outstandingLoading;
  const error = loanError || outstandingError;

  if (isLoading) {
    return { borrows: [], isLoading: true, error };
  }


  // Nếu không có loan active, trả về array rỗng
  if (!loan || !loan.active || loan.principal === BigInt(0)) {
    return { borrows: [], isLoading: false, error };
  }

  // Lấy token address từ loan struct (contract mới đã lưu)
  const tokenAddress = loan.token || getAddress("USDC"); // Fallback to USDC nếu null
  const tokenInfo = getTokenInfo(tokenAddress);
  
  const formattedBorrows = [{
    tokenAddress,
    symbol: tokenInfo.symbol,
    icon: tokenInfo.icon,
    name: tokenInfo.name,
    amount: parseFloat(formatUnits(loan.principal, tokenInfo.decimals)),
    interestOwed: outstandingLoan ? parseFloat(formatUnits(outstandingLoan - loan.principal, tokenInfo.decimals)) : 0,
    totalDebt: outstandingLoan ? parseFloat(formatUnits(outstandingLoan, tokenInfo.decimals)) : 0,
    rate: parseFloat(loan.rate.toString()) / 100, // Convert bps to percentage
    createdAt: loan.createdAt,
    duration: loan.duration,
  }];

  return { borrows: formattedBorrows, isLoading: false, error };
}

// Hook để lấy health factor từ CollateralManager contract
export function useHealthFactor(userAddress?: string, refreshKey?: number) {
  // Lấy full data để debug
  const { data: collateralData, refetch: refetchHealthFactor } = useReadContract({
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
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  });

  // Trigger refetch when refreshKey changes
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refetchHealthFactor();
    }
  }, [refreshKey, refetchHealthFactor]);

  // Get health factor from contract (already calculated with proper formula)
  const healthFactorRaw = collateralData?.[3];

  // Convert 1e18 to human readable number
  let hf = healthFactorRaw 
    ? parseFloat(formatUnits(healthFactorRaw, 18))
    : 0;

  // Cap at 999 for display (khi không có debt, contract trả về giá trị rất lớn)
  if (hf > 999 || !isFinite(hf)) {
    hf = 999;
  }

  // Determine status
  let status: 'safe' | 'warning' | 'liquidatable' = 'safe';
  if (hf === 0 || hf >= 999) {
    status = 'safe';
  } else if (hf < 1) {
    status = 'liquidatable';
  } else if (hf < 1.2) {
    status = 'warning';
  }

  return { 
    healthFactor: hf,
    status,
    isLoading: false, 
    error: undefined 
  };
}

// Hook để lấy available to borrow cho từng token
export function useAvailableToBorrow(tokenAddress: string, userAddress?: string, refreshKey?: number) {
  // Lấy total collateral value USD
  const { data: totalCollateralUSD, isLoading: collateralLoading, error: collateralError, refetch: refetchCollateral } = useReadContract({
    address: getAddress("CollateralManager"),
    abi: [
      {
        name: "getCollateralValueUSD",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "user", type: "address" }],
        outputs: [{ name: "totalValue", type: "uint256" }]
      }
    ],
    functionName: "getCollateralValueUSD",
    args: userAddress ? [userAddress as `0x${string}`] : undefined,
    chainId: ARC_CHAIN_ID,
    query: {
      enabled: !!userAddress,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  });

  // Lấy max loan amount (USD value) từ CollateralManager
  const { data: maxLoanUSD, isLoading: maxLoanLoading, error: maxLoanError, refetch: refetchMaxLoan } = useReadContract({
    address: getAddress("CollateralManager"),
    abi: [
      {
        name: "getMaxLoanAllowedUSD",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "user", type: "address" }],
        outputs: [{ name: "totalUSD", type: "uint256" }],
      },
    ],
    functionName: "getMaxLoanAllowedUSD",
    args: userAddress ? [userAddress as `0x${string}`] : undefined,
    chainId: ARC_CHAIN_ID,
    query: {
      enabled: !!userAddress,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  });

  // Lấy outstanding loan (USD value)
  const { data: outstandingLoanUSD, isLoading: outstandingLoading, error: outstandingError, refetch: refetchOutstanding } = useReadContract({
    address: getAddress("LoanManager"),
    abi: [
      {
        name: "getOutstandingLoanUSD",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "user", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
    functionName: "getOutstandingLoanUSD",
    args: userAddress ? [userAddress as `0x${string}`] : undefined,
    chainId: ARC_CHAIN_ID,
    query: {
      enabled: !!userAddress,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  });

  // Trigger refetch when refreshKey changes
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refetchCollateral();
      refetchMaxLoan();
      refetchOutstanding();
    }
  }, [refreshKey, refetchCollateral, refetchMaxLoan, refetchOutstanding]);

  const isLoading = collateralLoading || maxLoanLoading || outstandingLoading;
  const error = collateralError || maxLoanError || outstandingError;

  // Sử dụng giá trị từ contract thay vì tính toán frontend
  const maxLoanAllowed = maxLoanUSD ? parseFloat(formatUnits(maxLoanUSD, 8)) : 0; // Oracle 8 decimals
  const loanAmount = outstandingLoanUSD ? parseFloat(formatUnits(outstandingLoanUSD, 8)) : 0; // Oracle 8 decimals
  
  const availableUSDValue = Math.max(0, maxLoanAllowed - loanAmount);
  
  // Convert USD sang token amount theo giá thực tế từ market data
  const tokenInfo = getTokenInfo(tokenAddress);
  
  // Sử dụng giá từ market data thực tế (giống như BorrowableAssetRow)
  const marketData = useMarketData();
  const getTokenPrice = (tokenAddress: string) => {
    const market = marketData.find(m => m.tokenAddress === tokenAddress);
    return market?.price || 0; // ✅ Return 0 thay vì 1.00 nếu không có giá
  };
  
  const tokenPrice = getTokenPrice(tokenAddress);
  
  // ✅ Chỉ tính nếu có giá hợp lệ (> 0)
  const availableTokenAmount = tokenPrice > 0 ? availableUSDValue / tokenPrice : 0;

  return { available: availableTokenAmount, isLoading, error };
}

// Hook để tính lãi phải trả từ contract
export function useCalculateInterest(userAddress?: string) {
  const { data: interest, isLoading, error } = useReadContract({
    address: getAddress("LoanManager"),
    abi: [
      {
        name: "calculateInterest",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "user", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
    functionName: "calculateInterest",
    args: userAddress ? [userAddress as `0x${string}`] : undefined,
    chainId: ARC_CHAIN_ID,
    query: {
      enabled: !!userAddress,
      staleTime: 30000,
      refetchOnWindowFocus: true,
    },
  });

  // Parse interest amount (giả sử USDC có 6 decimals)
  const interestAmount = interest ? parseFloat(formatUnits(interest, 6)) : 0;

  return {
    interestAmount,
    isLoading,
    error
  };
}



// Hook để lấy supported borrow tokens
export function useSupportedBorrowTokens() {
  const tokenAddresses = [getAddress("USDC"), getAddress("EURC")];

  return tokenAddresses.map((tokenAddress) => {
    const tokenInfo = getTokenInfo(tokenAddress);
    return {
      tokenAddress,
      symbol: tokenInfo.symbol,
      icon: tokenInfo.icon,
      name: tokenInfo.name,
    };
  });
}

// Main hook tổng hợp cho BorrowCard
export function useUserBorrow(refreshKey?: number) {
  const { ready, authenticated } = usePrivy();
  const { address } = useAccount();
  const { wallets } = useWallets();
  
  // ✅ Chỉ lấy address khi Privy ready
  const userAddress = (ready && authenticated) ? (address || wallets[0]?.address) : undefined;
  
  const userBorrows = useUserBorrows(userAddress, refreshKey);
  const healthFactor = useHealthFactor(userAddress, refreshKey);
  const supportedTokens = useSupportedBorrowTokens();
  const interest = useCalculateInterest(userAddress);

  return {
    userBorrows,
    healthFactor,
    supportedTokens,
    interest, // Thêm interest data
    isLoading: userBorrows.isLoading || healthFactor.isLoading || interest.isLoading,
  };
}
