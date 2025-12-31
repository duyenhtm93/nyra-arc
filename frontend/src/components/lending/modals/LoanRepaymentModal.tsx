"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Image from "next/image";
import { useRepayLoan } from "@/hooks/useRepayLoan";
import { formatUnits, parseUnits, encodeFunctionData } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { useTokenBalance } from "@/hooks/useCollateral";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { useCollateralDetails } from "@/hooks/useCollateral";
import { useMarketData, useTokenPrice } from "@/hooks/useMarketData";
import { useToast } from "@/hooks/useToast";
import { ARC_CHAIN_ID, getAddress } from "@/utils/addresses";

interface LoanRepaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  loanToRepay: {
    tokenAddress: string;
    symbol: string;
    icon: string;
    name: string;
    principal: number;
    interestOwed: number;
    totalDebt: number;
    rawPrincipal: bigint;
    rawTotalDebt: bigint;
  };
  formatBalance: (amount: number) => string;
  onTransactionSuccess?: () => void;
}

export default function LoanRepaymentModal({
  isOpen,
  onClose,
  loanToRepay,
  formatBalance,
  onTransactionSuccess
}: LoanRepaymentModalProps) {
  const [amount, setAmount] = useState("");
  const [isRepaying, setIsRepaying] = useState(false);
  const [isRepayAll, setIsRepayAll] = useState(false);
  const [usingPrivyFlow, setUsingPrivyFlow] = useState(false);

  const repayCalledRef = useRef(false);
  const successToastShownRef = useRef(false);

  const { repayLoanAmount, repayAllLoan } = useRepayLoan();
  const { address, isConnected } = useAccount();
  const { wallets } = useWallets();

  const isWalletConnected = isConnected || wallets.length > 0;
  const walletAddress = address || wallets[0]?.address;

  const collateralDetails = useCollateralDetails(walletAddress);
  const marketData = useMarketData();
  const toast = useToast();

  const market = useMemo(() => marketData.find(m => m.tokenAddress === loanToRepay.tokenAddress), [marketData, loanToRepay.tokenAddress]);

  // PRIORITIZE PRICE FROM ORACLE
  const { price: oraclePrice } = useTokenPrice(loanToRepay.tokenAddress);
  const tokenPrice = useMemo(() => {
    if (oraclePrice !== undefined && oraclePrice > 0) return oraclePrice;
    if (market?.price && market.price > 0) return market.price;
    return 1.00;
  }, [oraclePrice, market?.price]);

  // Calculate projected health factor after repayment
  const projectedHealthFactor = useMemo(() => {
    if (!collateralDetails.healthFactor) return null;

    // If repay all, health factor will be infinite (no debt)
    if (isRepayAll) return 999;

    if (!amount) return null;

    // Amount is in token units (repayment amount)
    const repayAmountVal = parseFloat(amount);
    if (isNaN(repayAmountVal)) return null;
    const repayAmountUSD = repayAmountVal * tokenPrice;

    // Use current health factor and calculate new one after repayment
    const currentHealthFactor = collateralDetails.healthFactor;

    const currentDebtUSD = loanToRepay.totalDebt * tokenPrice;
    const newDebtUSD = Math.max(0, currentDebtUSD - repayAmountUSD);

    const projectedHF = newDebtUSD > 0 ? (currentHealthFactor * currentDebtUSD) / newDebtUSD : 999;

    return projectedHF;
  }, [collateralDetails, isRepayAll, amount, tokenPrice, loanToRepay.totalDebt]);

  // Kiểm tra balance của user
  const { balance: userBalance, isLoading: balanceLoading } = useTokenBalance(
    loanToRepay?.tokenAddress || "",
    walletAddress
  );

  // Hook để gọi getOutstandingLoan khi cần
  const { refetch: getOutstandingLoan } = useReadContract({
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
    args: walletAddress ? [walletAddress as `0x${string}`] : undefined,
    chainId: ARC_CHAIN_ID,
    query: {
      enabled: false, // Chỉ gọi khi cần thiết
    },
  });

  // Helper function để wait for transaction confirmation
  const waitForTxConfirmation = useCallback(async (provider: any, txHash: string) => {
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      try {
        const receipt = await provider.request({
          method: "eth_getTransactionReceipt",
          params: [txHash]
        });

        if (receipt && receipt.status) {
          return receipt;
        }
      } catch (e) { }

      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    throw new Error("Transaction timeout after 30s");
  }, []);

  // Helper function để repay all với Privy wallet
  const handleRepayAllWithPrivy = async (): Promise<string> => {
    const privyWallet = wallets[0];
    await privyWallet.switchChain(ARC_CHAIN_ID);

    const provider = await privyWallet.getEthereumProvider();

    // Thêm buffer 0.5% để đảm bảo đủ cho lãi phát sinh
    const buffer = (loanToRepay.rawTotalDebt * BigInt(1005)) / BigInt(1000);

    // Step 1: Approve
    const approveData = encodeFunctionData({
      abi: [{
        name: "approve",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" }
        ],
        outputs: [{ name: "", type: "bool" }],
      }],
      functionName: "approve",
      args: [getAddress("LoanManager"), buffer],
    });

    const approveTxHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        from: walletAddress,
        to: loanToRepay.tokenAddress,
        data: approveData,
      }]
    });

    // Wait for approve
    await waitForTxConfirmation(provider, approveTxHash);

    // Step 2: RepayAll
    const repayAllData = encodeFunctionData({
      abi: [{
        name: "repayAll",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [{ name: "token", type: "address" }],
        outputs: [],
      }],
      functionName: "repayAll",
      args: [loanToRepay.tokenAddress as `0x${string}`],
    });

    const repayTxHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        from: walletAddress,
        to: getAddress("LoanManager"),
        data: repayAllData,
      }]
    });

    // Wait for repay
    await waitForTxConfirmation(provider, repayTxHash);

    // Wait for contract state to update
    await new Promise(resolve => setTimeout(resolve, 2000));

    return repayTxHash;
  };

  // Helper để repay amount với Privy
  const handleRepayWithPrivy = async (repayAmount: number): Promise<string> => {
    const privyWallet = wallets[0];
    await privyWallet.switchChain(ARC_CHAIN_ID);

    const provider = await privyWallet.getEthereumProvider();
    const tokenInfo = getTokenInfo(loanToRepay.tokenAddress);
    const amountWei = parseUnits(repayAmount.toString(), tokenInfo.decimals);

    // Step 1: Approve
    const approveData = encodeFunctionData({
      abi: [{
        name: "approve",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" }
        ],
        outputs: [{ name: "", type: "bool" }],
      }],
      functionName: "approve",
      args: [getAddress("LoanManager"), amountWei],
    });

    const approveTxHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        from: walletAddress,
        to: loanToRepay.tokenAddress,
        data: approveData,
      }]
    });

    await waitForTxConfirmation(provider, approveTxHash);

    // Step 2: Repay
    const repayData = encodeFunctionData({
      abi: [{
        name: "repay",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" }
        ],
        outputs: [],
      }],
      functionName: "repay",
      args: [loanToRepay.tokenAddress as `0x${string}`, amountWei],
    });

    const repayTxHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        from: walletAddress,
        to: getAddress("LoanManager"),
        data: repayData,
      }]
    });

    await waitForTxConfirmation(provider, repayTxHash);

    // Wait for contract state to update
    await new Promise(resolve => setTimeout(resolve, 2000));

    return repayTxHash;
  };

  const handleClose = useCallback(() => {
    setAmount("");
    setIsRepayAll(false);
    setUsingPrivyFlow(false);
    repayCalledRef.current = false;
    onClose();
  }, [onClose]);

  const handleRepayAll = async () => {
    if (!loanToRepay) {
      toast.showError("No loan to repay");
      return;
    }

    // Kiểm tra balance
    if (userBalance < loanToRepay.totalDebt) {
      toast.showError(
        "Insufficient balance",
        `You have ${formatBalance(userBalance)} ${loanToRepay.symbol}, but need ${formatBalance(loanToRepay.totalDebt)} ${loanToRepay.symbol} to repay all.`
      );
      return;
    }

    setIsRepaying(true);

    // Only show loading toast when we start the actual transaction
    let loadingToast: string | number | null = null;
    successToastShownRef.current = false;

    try {
      // Show loading toast when we start the actual transaction
      loadingToast = toast.showTransactionPending("Repay All Loan");
      let txHash: string;

      if (!isConnected && wallets.length > 0) {
        setUsingPrivyFlow(true);
        // Dùng Privy wallet - flow approve + repayAll
        txHash = await handleRepayAllWithPrivy();
      } else {
        // Dùng wagmi hook
        txHash = await repayAllLoan(loanToRepay.tokenAddress);

        // Wait for contract state to update
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Dismiss loading toast
      if (loadingToast !== null) {
        toast.dismiss(loadingToast);
      }

      // Show success toast
      if (!successToastShownRef.current) {
        successToastShownRef.current = true;
        toast.showTransactionSuccess(txHash, "Repay All");
      }

      if (onTransactionSuccess) {
        onTransactionSuccess();
      }

      setTimeout(() => {
        handleClose();
      }, 500);
    } catch (error) {
      console.error("Repay All failed:", error);
      if (loadingToast !== null) {
        toast.dismiss(loadingToast);
      }
      toast.showTransactionError(
        error instanceof Error ? error.message : 'Unknown error',
        "Repay All"
      );
      setUsingPrivyFlow(false);
    } finally {
      setIsRepaying(false);
    }
  };

  const handleRepay = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.showError("Please enter a valid amount");
      return;
    }

    if (parseFloat(amount) > loanToRepay.totalDebt) {
      toast.showError("Amount cannot exceed total debt");
      return;
    }

    // Kiểm tra balance
    if (userBalance < parseFloat(amount)) {
      toast.showError(
        "Insufficient balance",
        `You have ${formatBalance(userBalance)} ${loanToRepay.symbol}, but trying to repay ${amount} ${loanToRepay.symbol}`
      );
      return;
    }

    setIsRepaying(true);

    // Only show loading toast when we start the actual transaction
    let loadingToast: string | number | null = null;

    try {
      // Show loading toast when we start the actual transaction
      loadingToast = toast.showTransactionPending("Repay Loan");
      // Nếu user đang trả max amount, gọi contract để lấy exact current amount
      let repayAmountVal = parseFloat(amount);

      if (parseFloat(amount) >= loanToRepay.totalDebt * 0.99) { // Nếu trả gần như toàn bộ
        const { data: currentOutstanding } = await getOutstandingLoan();
        if (currentOutstanding) {
          const tokenInfo = getTokenInfo(loanToRepay.tokenAddress);
          const exactAmount = parseFloat(formatUnits(currentOutstanding, tokenInfo.decimals));

          // Nếu exact amount nhỏ hơn balance, dùng exact amount
          if (exactAmount <= userBalance) {
            repayAmountVal = exactAmount;
          }
        }
      }

      let txHash: string;

      if (!isConnected && wallets.length > 0) {
        setUsingPrivyFlow(true);
        txHash = await handleRepayWithPrivy(repayAmountVal);
      } else {
        txHash = await repayLoanAmount(loanToRepay.tokenAddress, repayAmountVal);

        // Wait for contract state to update
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Dismiss loading toast
      if (loadingToast !== null) {
        toast.dismiss(loadingToast);
      }

      // Show success toast
      if (!successToastShownRef.current) {
        successToastShownRef.current = true;
        toast.showTransactionSuccess(txHash, "Repay Loan");
      }

      if (onTransactionSuccess) {
        onTransactionSuccess();
      }

      setTimeout(() => {
        handleClose();
      }, 500);
    } catch (error) {
      console.error("Repay failed:", error);
      if (loadingToast !== null) {
        toast.dismiss(loadingToast);
      }
      toast.showTransactionError(
        error instanceof Error ? error.message : 'Unknown error',
        "Repay Loan"
      );
      setUsingPrivyFlow(false);
    } finally {
      setIsRepaying(false);
    }
  };

  const handleMaxAmount = async () => {
    try {
      // Gọi contract để lấy exact outstanding loan amount tại thời điểm hiện tại

      const { data: outstandingLoan } = await getOutstandingLoan();

      if (outstandingLoan) {
        const tokenInfo = getTokenInfo(loanToRepay.tokenAddress);
        const maxAmountVal = parseFloat(formatUnits(outstandingLoan, tokenInfo.decimals));

        setAmount(maxAmountVal.toString());
      } else {
        console.warn("⚠️ No outstanding loan data, using cached value");
        setAmount(loanToRepay.totalDebt.toString());
      }
    } catch (error) {
      console.error("❌ Error getting max amount:", error);
      // Fallback to cached value
      setAmount(loanToRepay.totalDebt.toString());
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        className="rounded-lg p-6 w-full max-w-[26rem] shadow-2xl border border-gray-700 bg-[#111827]"
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold text-white">
            Repay {loanToRepay.symbol}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* Amount Input */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium text-gray-400">Amount</label>
              <span className="text-xs text-gray-500">
                Wallet: {balanceLoading ? "..." : formatBalance(userBalance)}
              </span>
            </div>

            <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setIsRepayAll(false);
                    }}
                    placeholder="0.00"
                    disabled={isRepaying}
                    className="w-full text-2xl font-bold text-white bg-transparent border-none outline-none placeholder-gray-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50"
                  />
                </div>

                <div className="flex items-center gap-2 px-2 py-1 bg-gray-700/50 rounded-md border border-gray-600/50">
                  <div className="relative w-5 h-5">
                    <Image
                      src={loanToRepay.icon}
                      alt={loanToRepay.symbol}
                      fill
                      className="object-contain"
                    />
                  </div>
                  <span className="text-sm font-semibold text-white">{loanToRepay.symbol}</span>
                </div>
              </div>

              <div className="flex items-center justify-between mt-4">
                <div className="text-xs font-medium text-gray-500">
                  ${(parseFloat(amount || "0") * tokenPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <button
                  onClick={() => {
                    handleMaxAmount();
                    setIsRepayAll(true);
                  }}
                  className="text-xs font-bold text-gray-300 hover:text-white transition-colors uppercase tracking-widest bg-gray-700/50 px-2 py-1 rounded"
                >
                  MAX
                </button>
              </div>
            </div>
          </div>

          {/* Info Section */}
          <div className="p-4 rounded-lg border border-gray-700/50 bg-gray-800/30 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Borrowed</span>
              <span className="text-sm font-medium text-white">{loanToRepay.principal.toFixed(2)} {loanToRepay.symbol}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">New Health Factor</span>
              <span className="text-sm font-medium">
                {collateralDetails.isLoading ? "..." :
                  projectedHealthFactor ?
                    <div className="flex items-center gap-2">
                      <span className={`${projectedHealthFactor >= 1.5 ? 'text-green-400' : projectedHealthFactor >= 1.1 ? 'text-orange-400' : 'text-red-400'}`}>
                        {projectedHealthFactor >= 999 ? '∞' : projectedHealthFactor.toFixed(2)}
                      </span>
                    </div> :
                    <span className="text-white">{collateralDetails.healthFactor >= 999 ? '∞' : collateralDetails.healthFactor.toFixed(2)}</span>}
              </span>
            </div>
            <div className="pt-2 border-t border-gray-700/50 flex justify-between items-center">
              <span className="text-xs text-gray-400 italic">Liquidation threshold</span>
              <span className="text-xs font-medium text-gray-500">HF &lt; 1.0</span>
            </div>
          </div>

          {/* Action Button */}
          <button
            onClick={isRepayAll ? handleRepayAll : handleRepay}
            disabled={
              isRepayAll
                ? (isRepaying || userBalance < loanToRepay.totalDebt)
                : (isRepaying || !amount || parseFloat(amount) <= 0)
            }
            className="w-full px-4 py-3 rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed text-white hover:opacity-90 active:scale-[0.98] mt-4 shadow-lg shadow-orange-500/10"
            style={{ backgroundColor: 'var(--button-active)' }}
          >
            {isRepaying
              ? "Repaying..."
              : isRepayAll
                ? `Repay All ${loanToRepay.symbol}`
                : `Repay ${loanToRepay.symbol}`
            }
          </button>
        </div>
      </div>
    </div>
  );
}

