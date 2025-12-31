"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Image from "next/image";
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { parseUnits, encodeFunctionData } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { useMarketData } from "@/hooks/useMarketData";
import { useWalletBalances, useCollateralDetails } from "@/hooks/useCollateral";
import { useToast } from "@/hooks/useToast";
import { ARC_CHAIN_ID, getAddress } from "@/utils/addresses";
import { useTokenPrice } from "@/hooks/useMarketData";

interface CollateralManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  collateral: {
    tokenAddress: string;
    symbol: string;
    icon: string;
    name: string;
    amount: number;
    ltv?: number;
  };
  formatBalance: (amount: number) => string;
  onTransactionSuccess?: () => void;
}

export default function CollateralManagementModal({
  isOpen,
  onClose,
  collateral,
  formatBalance,
  onTransactionSuccess
}: CollateralManagementModalProps) {
  const [action, setAction] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [isApproving, setIsApproving] = useState(false);
  const [usingPrivyFlow, setUsingPrivyFlow] = useState(false);

  const depositCalledRef = useRef(false);
  const currentLoadingToastRef = useRef<string | number | null>(null);
  const successToastShownRef = useRef(false);
  const toast = useToast();

  const tokenInfo = useMemo(() => getTokenInfo(collateral.tokenAddress), [collateral.tokenAddress]);
  const marketData = useMarketData();
  const { address, isConnected } = useAccount();
  const { wallets } = useWallets();

  // ✅ Fallback: nếu wagmi chưa sync thì lấy từ Privy
  const isWalletConnected = isConnected || wallets.length > 0;
  const walletAddress = address || wallets[0]?.address;

  const { balances } = useWalletBalances(walletAddress);
  const collateralDetails = useCollateralDetails(walletAddress);

  const market = useMemo(() => marketData.find(m => m.tokenAddress === collateral.tokenAddress), [marketData, collateral.tokenAddress]);

  // PRIORITIZE PRICE FROM ORACLE
  const { price: oraclePrice } = useTokenPrice(collateral.tokenAddress);
  const tokenPrice = useMemo(() => {
    if (oraclePrice !== undefined && oraclePrice > 0) return oraclePrice;
    if (market?.price && market.price > 0) return market.price;
    return 1.00;
  }, [oraclePrice, market?.price]);

  // Calculate projected health factor after deposit/withdraw
  const projectedHealthFactor = useMemo(() => {
    if (!amount || !collateralDetails.healthFactor) return null;

    // Lấy dữ liệu từ useCollateralDetails
    const collateralUSD = collateralDetails.totalCollateralValue || 0;
    const currentDebtUSD = collateralDetails.outstandingLoan || 0;

    let newCollateralUSD;
    const transactionAmount = parseFloat(amount);
    if (isNaN(transactionAmount)) return null;

    const transactionAmountUSD = transactionAmount * tokenPrice;

    if (action === 'deposit') {
      newCollateralUSD = collateralUSD + transactionAmountUSD;
    } else {
      newCollateralUSD = Math.max(0, collateralUSD - transactionAmountUSD);
    }

    // Sử dụng cùng logic như useCollateralDetails
    const maxLTV = 0.75; // 75% LTV
    const projectedHF = currentDebtUSD > 0 ? (newCollateralUSD * maxLTV) / currentDebtUSD : 999;

    return projectedHF <= 0 ? null : projectedHF;
  }, [amount, collateralDetails, action, tokenPrice]);

  // Get wallet balance for this token
  const walletBalanceValue = useMemo(() => {
    const walletBalance = balances.find(b => b.tokenAddress === collateral.tokenAddress);
    return walletBalance?.balance || 0;
  }, [balances, collateral.tokenAddress]);

  // Calculate max safe withdraw amount (keep HF >= 1.2)
  const maxSafeWithdraw = useMemo(() => {
    const currentCollateralUSD = collateralDetails.totalCollateralValue || 0;
    const debtUSD = collateralDetails.outstandingLoan || 0;
    const currentHF = collateralDetails.healthFactor || 0;

    // Nếu không có debt, có thể rút hết
    if (debtUSD === 0) {
      return collateral.amount;
    }

    // Tính weighted threshold từ current health factor
    const weightedThreshold = currentCollateralUSD > 0
      ? (currentHF * debtUSD) / currentCollateralUSD
      : 0.75;

    // Tính collateral USD cần thiết để maintain HF >= 1.2
    const targetHF = 1.2;
    const minCollateralUSD = (debtUSD * targetHF) / weightedThreshold;

    // Max có thể withdraw (USD)
    const maxWithdrawUSD = Math.max(0, currentCollateralUSD - minCollateralUSD);

    // Convert sang token amount
    const maxWithdrawToken = tokenPrice > 0 ? maxWithdrawUSD / tokenPrice : 0;

    // Không được vượt quá collateral balance hiện tại
    return Math.min(maxWithdrawToken, collateral.amount);
  }, [collateralDetails, collateral.amount, tokenPrice]);

  // Contract writes
  const { writeContract: writeCollateral, data: collateralHash } = useWriteContract();
  const { writeContract: writeToken, data: approveHash } = useWriteContract();

  // Transaction receipts
  const { isSuccess: isCollateralSuccess } = useWaitForTransactionReceipt({
    hash: collateralHash,
  });

  const { isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({
    hash: approveHash,
  });

  const handleClose = useCallback(() => {
    setAmount('');
    setAction('deposit');
    setIsApproving(false);
    setUsingPrivyFlow(false);
    depositCalledRef.current = false;
    onClose();
  }, [onClose]);

  const handleDepositAfterApproval = useCallback(async () => {
    if (!amount || parseFloat(amount) <= 0) return;

    if (depositCalledRef.current) {
      return;
    }

    depositCalledRef.current = true;
    currentLoadingToastRef.current = toast.showTransactionPending("Deposit Collateral");
    successToastShownRef.current = false; // Reset flag for new transaction

    try {
      const amountWei = parseUnits(amount, tokenInfo.decimals);

      if (!isConnected && wallets.length > 0) {
        const privyWallet = wallets[0];

        const depositData = encodeFunctionData({
          abi: [{
            name: "deposit",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" }
            ],
            outputs: [],
          }],
          functionName: "deposit",
          args: [collateral.tokenAddress as `0x${string}`, amountWei],
        });

        const provider = await privyWallet.getEthereumProvider();
        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: walletAddress,
            to: getAddress("CollateralManager"),
            data: depositData,
          }]
        });

        // Wait for confirmation
        try {
          let attempts = 0;
          const maxAttempts = 30;

          while (attempts < maxAttempts) {
            try {
              const receipt = await provider.request({
                method: "eth_getTransactionReceipt",
                params: [txHash]
              });

              if (receipt && receipt.status) {
                if (currentLoadingToastRef.current) {
                  toast.dismiss(currentLoadingToastRef.current);
                  currentLoadingToastRef.current = null;
                }
                if (!successToastShownRef.current) {
                  successToastShownRef.current = true;
                  toast.showTransactionSuccess(txHash, "Deposit Collateral");
                }

                if (onTransactionSuccess) {
                  onTransactionSuccess();
                }

                setTimeout(() => {
                  handleClose();
                }, 500);
                break;
              }
            } catch (e) { }

            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
          }

          if (attempts >= maxAttempts) {
            if (currentLoadingToastRef.current) {
              toast.dismiss(currentLoadingToastRef.current);
              currentLoadingToastRef.current = null;
            }
            toast.showTransactionError("Transaction confirmation timeout", "Deposit Collateral");
            depositCalledRef.current = false;
          }
        } catch (waitError) {
          console.error("Error waiting for deposit tx:", waitError);
          if (currentLoadingToastRef.current) {
            toast.dismiss(currentLoadingToastRef.current);
            currentLoadingToastRef.current = null;
          }
          toast.showTransactionError(
            waitError instanceof Error ? waitError.message : 'Transaction failed. Please try again.',
            "Deposit Collateral"
          );
          depositCalledRef.current = false;
        }
      } else {
        writeCollateral({
          address: getAddress("CollateralManager"),
          abi: [
            {
              name: "deposit",
              type: "function",
              stateMutability: "nonpayable",
              inputs: [
                { name: "token", type: "address" },
                { name: "amount", type: "uint256" }
              ],
              outputs: [],
            },
          ],
          functionName: "deposit",
          args: [
            collateral.tokenAddress as `0x${string}`,
            amountWei
          ],
        });
      }
    } catch (error) {
      console.error("Error depositing collateral after approval:", error);
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }
      toast.showTransactionError(
        error instanceof Error ? error.message : 'Deposit failed. Please try again.',
        "Deposit Collateral"
      );
      depositCalledRef.current = false;
    }
  }, [amount, collateral.tokenAddress, tokenInfo.decimals, isConnected, wallets, walletAddress, toast, onTransactionSuccess, handleClose, writeCollateral]);

  // Auto-refresh data when transaction succeeds
  useEffect(() => {
    if (isCollateralSuccess && walletAddress && !usingPrivyFlow && !successToastShownRef.current) {
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }

      successToastShownRef.current = true;
      toast.showTransactionSuccess(collateralHash!, "Deposit Collateral");
      if (onTransactionSuccess) {
        onTransactionSuccess();
      }
      setTimeout(() => {
        handleClose();
      }, 500);
    }
  }, [isCollateralSuccess, walletAddress, usingPrivyFlow, onTransactionSuccess, collateralHash, toast, handleClose]);

  // Handle approve success
  useEffect(() => {
    if (isApproveSuccess && isApproving && !usingPrivyFlow && !successToastShownRef.current) {
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }

      successToastShownRef.current = true;
      setIsApproving(false);
      handleDepositAfterApproval();
    }
  }, [isApproveSuccess, isApproving, usingPrivyFlow, approveHash, toast, handleDepositAfterApproval]);

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0) return;

    depositCalledRef.current = false;
    setIsApproving(true);
    currentLoadingToastRef.current = toast.showTransactionPending("Approve Token");
    successToastShownRef.current = false;

    try {
      const amountWei = parseUnits(amount, tokenInfo.decimals);

      if (!isConnected && wallets.length > 0) {
        setUsingPrivyFlow(true);
        const privyWallet = wallets[0];

        await privyWallet.switchChain(ARC_CHAIN_ID);

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
          args: [getAddress("CollateralManager"), amountWei],
        });

        const provider = await privyWallet.getEthereumProvider();
        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: walletAddress,
            to: collateral.tokenAddress,
            data: approveData,
          }]
        });

        // Wait for approve confirmation
        try {
          let attempts = 0;
          const maxAttempts = 30;

          while (attempts < maxAttempts) {
            try {
              const receipt = await provider.request({
                method: "eth_getTransactionReceipt",
                params: [txHash]
              });

              if (receipt && receipt.status) {
                if (currentLoadingToastRef.current) {
                  toast.dismiss(currentLoadingToastRef.current);
                  currentLoadingToastRef.current = null;
                }
                successToastShownRef.current = true;
                // Success toast removed as per request

                setIsApproving(false);
                await new Promise(resolve => setTimeout(resolve, 100));
                await handleDepositAfterApproval();
                break;
              }
            } catch (e) { }

            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
          }

          if (attempts >= maxAttempts) {
            if (currentLoadingToastRef.current) {
              toast.dismiss(currentLoadingToastRef.current);
              currentLoadingToastRef.current = null;
            }
            toast.showTransactionError("Transaction confirmation timeout", "Approve Assets");
            setIsApproving(false);
            await handleDepositAfterApproval();
          }
        } catch (waitError) {
          console.error("Error waiting for approve tx:", waitError);
          if (currentLoadingToastRef.current) {
            toast.dismiss(currentLoadingToastRef.current);
            currentLoadingToastRef.current = null;
          }
          toast.showTransactionError(
            waitError instanceof Error ? waitError.message : 'Transaction failed. Please try again.',
            "Approve Token"
          );
          setIsApproving(false);
          setUsingPrivyFlow(false);
          depositCalledRef.current = false;
        }
      } else {
        writeToken({
          address: collateral.tokenAddress as `0x${string}`,
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
          args: [
            getAddress("CollateralManager"),
            amountWei
          ],
        });
      }
    } catch (error) {
      console.error("Error approving token:", error);
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }
      toast.showTransactionError(
        error instanceof Error ? error.message : 'Approve failed. Please try again.',
        "Approve Token"
      );
      setIsApproving(false);
      setUsingPrivyFlow(false);
      depositCalledRef.current = false;
    }
  };

  const handleWithdraw = async () => {
    if (!amount || parseFloat(amount) <= 0) return;

    currentLoadingToastRef.current = toast.showTransactionPending("Withdraw Collateral");
    successToastShownRef.current = false;

    try {
      const amountWei = parseUnits(amount, tokenInfo.decimals);

      if (!isConnected && wallets.length > 0) {
        setUsingPrivyFlow(true);
        const privyWallet = wallets[0];

        await privyWallet.switchChain(ARC_CHAIN_ID);

        const withdrawData = encodeFunctionData({
          abi: [{
            name: "withdraw",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" }
            ],
            outputs: [],
          }],
          functionName: "withdraw",
          args: [collateral.tokenAddress as `0x${string}`, amountWei],
        });

        const provider = await privyWallet.getEthereumProvider();
        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: walletAddress,
            to: getAddress("CollateralManager"),
            data: withdrawData,
          }]
        });

        // Wait for confirmation
        try {
          let attempts = 0;
          const maxAttempts = 30;

          while (attempts < maxAttempts) {
            try {
              const receipt = await provider.request({
                method: "eth_getTransactionReceipt",
                params: [txHash]
              });

              if (receipt && receipt.status) {
                if (currentLoadingToastRef.current) {
                  toast.dismiss(currentLoadingToastRef.current);
                  currentLoadingToastRef.current = null;
                }
                if (!successToastShownRef.current) {
                  successToastShownRef.current = true;
                  toast.showTransactionSuccess(txHash, "Withdraw Collateral");
                }

                if (onTransactionSuccess) {
                  onTransactionSuccess();
                }

                setTimeout(() => {
                  handleClose();
                }, 500);
                break;
              }
            } catch (e) { }

            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
          }

          if (attempts >= maxAttempts) {
            if (currentLoadingToastRef.current) {
              toast.dismiss(currentLoadingToastRef.current);
              currentLoadingToastRef.current = null;
            }
            toast.showTransactionError("Transaction confirmation timeout", "Withdraw Collateral");
            setUsingPrivyFlow(false);
          }
        } catch (waitError) {
          console.error("Error waiting for withdraw tx:", waitError);
          if (currentLoadingToastRef.current) {
            toast.dismiss(currentLoadingToastRef.current);
            currentLoadingToastRef.current = null;
          }
          toast.showTransactionError(
            waitError instanceof Error ? waitError.message : 'Transaction failed. Please try again.',
            "Withdraw Collateral"
          );
          setUsingPrivyFlow(false);
        }
      } else {
        writeCollateral({
          address: getAddress("CollateralManager"),
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
          args: [
            collateral.tokenAddress as `0x${string}`,
            amountWei
          ],
        });
      }
    } catch (error) {
      console.error("Error withdrawing collateral:", error);
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }
      toast.showTransactionError(
        error instanceof Error ? error.message : 'Withdraw failed. Please try again.',
        "Withdraw Collateral"
      );
      setUsingPrivyFlow(false);
    }
  };

  const handleSubmit = () => {
    if (action === 'deposit') {
      handleDeposit();
    } else {
      handleWithdraw();
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
            Manage {collateral.symbol}
          </h3>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Action Toggle */}
        <div className="flex gap-2 mb-6 p-1 bg-gray-900/50 rounded-lg border border-gray-700/30">
          <button
            onClick={() => setAction('deposit')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-all ${action === 'deposit'
              ? 'text-white shadow-lg bg-[#F87813]'
              : 'text-gray-400 hover:text-white'
              }`}
          >
            Deposit
          </button>
          <button
            onClick={() => setAction('withdraw')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-all ${action === 'withdraw'
              ? 'text-white shadow-lg bg-[#F87813]'
              : 'text-gray-400 hover:text-white'
              }`}
          >
            Withdraw
          </button>
        </div>

        <div className="space-y-4">
          {/* Amount Input */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium text-gray-400">Amount</label>
              <span className="text-xs text-gray-500">
                {action === 'deposit' ? 'Wallet' : 'Collateral'}: {formatBalance(action === 'deposit' ? walletBalanceValue : collateral.amount)}
              </span>
            </div>

            <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full text-2xl font-bold text-white bg-transparent border-none outline-none placeholder-gray-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>

                <div className="flex items-center gap-2 px-2 py-1 bg-gray-700/50 rounded-md border border-gray-600/50">
                  <div className="relative w-5 h-5">
                    <Image
                      src={collateral.icon}
                      alt={collateral.symbol}
                      fill
                      className="object-contain"
                    />
                  </div>
                  <span className="text-sm font-semibold text-white">{collateral.symbol}</span>
                </div>
              </div>

              <div className="flex items-center justify-between mt-4">
                <div className="text-xs font-medium text-gray-500">
                  ${(parseFloat(amount || "0") * tokenPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <button
                  onClick={() => setAmount((action === 'deposit' ? walletBalanceValue : maxSafeWithdraw).toString())}
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
              <span className="text-sm text-gray-400">Current Deposited</span>
              <span className="text-sm font-medium text-white">{collateral.amount.toFixed(2)} {collateral.symbol}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">New Health Factor</span>
              <span className="text-sm font-medium">
                {collateralDetails.isLoading ? "..." :
                  projectedHealthFactor ?
                    <div className="flex items-center gap-2">
                      <span className={`${projectedHealthFactor >= 1.5 ? 'text-green-400' : projectedHealthFactor >= 1.1 ? 'text-orange-400' : 'text-red-400'}`}>
                        {projectedHealthFactor === 999 ? "∞" : projectedHealthFactor.toFixed(2)}
                      </span>
                    </div> :
                    <span className="text-white">{collateralDetails.healthFactor === 999 ? "∞" : collateralDetails.healthFactor.toFixed(2)}</span>}
              </span>
            </div>
            <div className="pt-2 border-t border-gray-700/50 flex justify-between items-center">
              <span className="text-xs text-gray-400 italic">Liquidation threshold</span>
              <span className="text-xs font-medium text-gray-500">HF &lt; 1.0</span>
            </div>
          </div>

          {/* Action Button */}
          <button
            onClick={handleSubmit}
            disabled={
              !amount ||
              parseFloat(amount) <= 0 ||
              (action === 'withdraw' && projectedHealthFactor !== null && projectedHealthFactor < 1.0) ||
              (action === 'withdraw' && parseFloat(amount || "0") > collateral.amount) ||
              (action === 'deposit' && parseFloat(amount || "0") > walletBalanceValue)
            }
            className="w-full px-4 py-3 rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed text-white hover:opacity-90 active:scale-[0.98] mt-4 shadow-lg shadow-orange-500/10"
            style={{
              backgroundColor: 'var(--button-active)'
            }}
          >
            {`${action === 'deposit' ? 'Deposit' : 'Withdraw'} ${collateral.symbol}`}
          </button>
        </div>
      </div>
    </div>
  );
}

