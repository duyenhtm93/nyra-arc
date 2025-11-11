"use client";

import { useWriteContract, useReadContract } from "wagmi";
import { useAccount } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { formatUnits, parseUnits } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { readContract, waitForTransactionReceipt } from "@wagmi/core";
import { wagmiConfig } from "@/config/wagmi";
import { ARC_CHAIN_ID, getAddress } from "@/utils/addresses";

// Helper function để tính interest hiện tại (giống như contract)
function calculateCurrentInterest(principal: bigint, rateBps: bigint, createdAt: bigint): bigint {
  const now = BigInt(Math.floor(Date.now() / 1000)); // Current timestamp in seconds
  const elapsed = now - createdAt;
  
  if (elapsed <= BigInt(0)) return BigInt(0);
  
  // Formula: (principal * rate * elapsed) / (10000 * 365 days)
  const numerator = principal * rateBps * elapsed;
  const denominator = BigInt(10000) * BigInt(365) * BigInt(24) * BigInt(60) * BigInt(60); // 365 days in seconds
  
  return numerator / denominator;
}

// Hook để lấy thông tin loan cần trả
export function useLoanToRepay() {
  const { address } = useAccount();
  const { wallets } = useWallets();
  
  // Dùng address từ wallets nếu useAccount không có
  const userAddress = address || wallets[0]?.address;
  
  const { data: loan, isLoading: loanLoading, error: loanError } = useReadContract({
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
      staleTime: 30000,
      refetchOnWindowFocus: true,
    },
  });

  // Lấy outstanding loan amount
  const { data: outstandingLoan, isLoading: outstandingLoading, error: outstandingError } = useReadContract({
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
      staleTime: 30000,
      refetchOnWindowFocus: true,
    },
  });

  const isLoading = loanLoading || outstandingLoading;
  const error = loanError || outstandingError;

  if (isLoading) {
    return { loanToRepay: null, isLoading: true, error };
  }

  // Nếu không có loan active, trả về null
  if (!loan || !loan.active || loan.principal === BigInt(0)) {
    return { loanToRepay: null, isLoading: false, error };
  }

  // Lấy token address từ loan struct (contract mới đã lưu)
  const tokenAddress = loan.token || getAddress("USDC"); // Fallback to USDC nếu null
  const tokenInfo = getTokenInfo(tokenAddress);
  
  // Dùng hàm contract để lấy exact outstanding loan amount
  const totalDebtWei = outstandingLoan || BigInt(0);
  const currentInterest = totalDebtWei > loan.principal ? totalDebtWei - loan.principal : BigInt(0);

  const loanToRepay = {
    tokenAddress,
    symbol: tokenInfo.symbol,
    icon: tokenInfo.icon,
    name: tokenInfo.name,
    principal: parseFloat(formatUnits(loan.principal, tokenInfo.decimals)),
    interestOwed: parseFloat(formatUnits(currentInterest, tokenInfo.decimals)),
    totalDebt: parseFloat(formatUnits(totalDebtWei, tokenInfo.decimals)),
    rate: parseFloat(loan.rate.toString()) / 100, // Convert bps to percentage
    createdAt: loan.createdAt,
    duration: loan.duration,
    rawPrincipal: loan.principal,
    rawTotalDebt: totalDebtWei,
  };

  return { loanToRepay, isLoading: false, error };
}

// Hook để thực hiện repay loan
export function useRepayLoan() {
  const { writeContractAsync: repayLoan } = useWriteContract();
  const { address } = useAccount();
  const { wallets } = useWallets();
  
  const userAddress = address || wallets[0]?.address;

  const repayLoanAmount = async (tokenAddress: string, amount: number) => {
    if (!userAddress) {
      throw new Error("No wallet connected");
    }

    const tokenInfo = getTokenInfo(tokenAddress);
    const amountInWei = parseUnits(amount.toString(), tokenInfo.decimals);

    try {
      // Bước 1: Approve token trước
      const approveTxHash = await repayLoan({
        address: tokenAddress as `0x${string}`,
        abi: [
          {
            name: "approve",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "spender", type: "address" },
              { name: "amount", type: "uint256" }
            ],
            outputs: [{ name: "", type: "bool" }],
          },
        ],
        functionName: "approve",
        args: [getAddress("LoanManager"), amountInWei],
      });

      // Bước 2: Đợi approve được confirm (có thể cần đợi)
      // Trong môi trường testnet, có thể cần đợi một chút
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Bước 3: Gọi repay
      const repayTxHash = await repayLoan({
        address: getAddress("LoanManager"),
        abi: [
          {
            name: "repay",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" }
            ],
            outputs: [],
          },
        ],
        functionName: "repay",
        args: [tokenAddress as `0x${string}`, amountInWei],
      });

      return repayTxHash;
    } catch (error) {
      console.error("❌ Repay failed:", error);
      throw error;
    }
  };

  const repayAllLoan = async (tokenAddress: string) => {
    if (!userAddress) {
      throw new Error("No wallet connected");
    }

    try {
      // 1️⃣ Lấy tổng nợ hiện tại của user
      const totalDebt = await readContract(wagmiConfig, {
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
        args: [userAddress as `0x${string}`],
      });

      if (!totalDebt || totalDebt === BigInt(0)) {
        throw new Error("No outstanding loan to repay");
      }

      // 2️⃣ Approve token cho LoanManager với buffer +0.5% để chắc chắn đủ cho lãi phát sinh
      const buffer = (totalDebt * BigInt(1005)) / BigInt(1000); // +0.5% buffer
      const approveTxHash = await repayLoan({
        address: tokenAddress as `0x${string}`,
        abi: [
          {
            name: "approve",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "spender", type: "address" },
              { name: "amount", type: "uint256" }
            ],
            outputs: [{ name: "", type: "bool" }],
          },
        ],
        functionName: "approve",
        args: [getAddress("LoanManager"), buffer],
      });

      // 3️⃣ Đợi approve tx thành công
      await waitForTransactionReceipt(wagmiConfig, {
        hash: approveTxHash,
        timeout: 60000, // 60 giây timeout
      });

      // 4️⃣ Gọi repayAll
      const repayAllTxHash = await repayLoan({
        address: getAddress("LoanManager"),
        abi: [
          {
            name: "repayAll",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "token", type: "address" }
            ],
            outputs: [],
          },
        ],
        functionName: "repayAll",
        args: [tokenAddress as `0x${string}`],
      });

      return repayAllTxHash;
    } catch (error) {
      console.error("❌ Repay All failed:", error);
      throw error;
    }
  };

  return {
    repayLoanAmount,
    repayAllLoan, // Thêm function mới
    userAddress,
  };
}
