"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useReadContract } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { parseUnits, formatUnits, encodeFunctionData } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { useWithdrawAll } from "@/hooks/useUserSupply";
import { useToast } from "@/hooks/useToast";
import { ARC_CHAIN_ID, getAddress } from "@/utils/addresses";
import { useTokenPrice } from "@/hooks/useMarketData";

interface SupplyManagementRowProps {
  supply: {
    tokenAddress: string;
    symbol: string;
    icon: string;
    name: string;
    amount: number;
    interestEarned: number;
  };
  walletBalance: number; // Add wallet balance for supply action
  formatBalance: (amount: number) => string;
  onTransactionSuccess?: () => void;
  market?: any;
}

export default function SupplyManagementRow({ supply, walletBalance, formatBalance, onTransactionSuccess, market }: SupplyManagementRowProps) {
  const [showModal, setShowModal] = useState(false);
  const [action, setAction] = useState<'supply' | 'withdraw'>('withdraw');
  const [amount, setAmount] = useState("");
  const [isSupplying, setIsSupplying] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [isWithdrawAll, setIsWithdrawAll] = useState(false);
  const [usingPrivyFlow, setUsingPrivyFlow] = useState(false);

  const supplyCalledRef = useRef(false);
  const currentLoadingToastRef = useRef<string | number | null>(null);
  const successToastShownRef = useRef(false);

  const { isConnected, address } = useAccount();
  const { wallets } = useWallets();
  const toast = useToast();

  const isWalletConnected = isConnected || wallets.length > 0;
  const walletAddress = address || wallets[0]?.address;

  const { writeContract: writeToken, data: tokenHash } = useWriteContract();
  const { writeContract: writeSupply, data: supplyHash } = useWriteContract();

  // Hook để withdraw all
  const { withdrawAll, isPending: isWithdrawAllPending, hash: withdrawAllHash } = useWithdrawAll();

  // PRIORITIZE PRICE FROM ORACLE
  const { price: oraclePrice } = useTokenPrice(supply.tokenAddress);
  const tokenPrice = useMemo(() => {
    if (oraclePrice !== undefined && oraclePrice > 0) return oraclePrice;
    if (market?.price && market.price > 0) return market.price;
    return 1.00;
  }, [oraclePrice, market?.price]);

  const supplyRate = market?.lendRate || 0;

  // Lấy available liquidity từ contract
  const { data: availableLiquidity } = useReadContract({
    address: getAddress("LoanManager"),
    abi: [
      {
        name: "getAvailableLiquidity",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "token", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
    functionName: "getAvailableLiquidity",
    args: [supply.tokenAddress as `0x${string}`],
    chainId: ARC_CHAIN_ID,
    query: {
      staleTime: 10000,
      refetchOnWindowFocus: true,
    },
  });

  // Wait for withdraw all transaction confirmation
  const { isLoading: isWithdrawAllConfirming, isSuccess: isWithdrawAllSuccess } = useWaitForTransactionReceipt({
    hash: withdrawAllHash,
  });

  // Transaction receipts
  const { isLoading: isTokenPending, isSuccess: isTokenSuccess } = useWaitForTransactionReceipt({
    hash: tokenHash,
  });

  const { isLoading: isSupplyPending, isSuccess: isSupplySuccess } = useWaitForTransactionReceipt({
    hash: supplyHash,
  });

  const isLoading = isTokenPending || isSupplyPending;

  // Handle approve success - automatically proceed to supply (wagmi only)
  useEffect(() => {
    if (isTokenSuccess && isApproving && !usingPrivyFlow) {
      setIsApproving(false);
      setIsApproved(true);
      handleSupplyAfterApproval({ reuseExistingToast: true }); // Don't create new loading toast, use existing one
    }
  }, [isTokenSuccess, isApproving, usingPrivyFlow]);

  // Handle supply success (wagmi only)
  useEffect(() => {
    if (isSupplySuccess && walletAddress && !usingPrivyFlow && !successToastShownRef.current) {
      // Dismiss loading toast before showing success
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }

      // Show success toast only once
      successToastShownRef.current = true;
      toast.showTransactionSuccess(supplyHash || "", "Supply Asset");

      setTimeout(() => {
        if (onTransactionSuccess) {
          onTransactionSuccess();
        }
      }, 2000);

      setTimeout(() => {
        handleClose();
        supplyCalledRef.current = false;
      }, 2500);
    }
  }, [isSupplySuccess, walletAddress, usingPrivyFlow, onTransactionSuccess, supplyHash]);

  // Handle withdraw all success (wagmi only)
  useEffect(() => {
    if (isWithdrawAllSuccess && walletAddress && !usingPrivyFlow && !successToastShownRef.current) {
      // Dismiss loading toast before showing success
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }

      // Show success toast only once
      successToastShownRef.current = true;
      toast.showTransactionSuccess(withdrawAllHash || "", "Withdraw All");

      setTimeout(() => {
        if (onTransactionSuccess) {
          onTransactionSuccess();
        }
      }, 2000);

      setTimeout(() => handleClose(), 2500);
    }
  }, [isWithdrawAllSuccess, walletAddress, usingPrivyFlow, onTransactionSuccess, withdrawAllHash]);

  const handleWithdraw = async () => {
    if (!isWalletConnected) {
      toast.showError("Please connect your wallet first");
      return;
    }

    if (!amount) return;

    setIsSupplying(true);

    // Show loading toast when we start the actual transaction
    const loadingToast = toast.showTransactionPending("Withdraw");
    currentLoadingToastRef.current = loadingToast;
    successToastShownRef.current = false; // Reset flag for new transaction

    try {
      const tokenInfo = getTokenInfo(supply.tokenAddress);
      const amountWei = parseUnits(amount, tokenInfo.decimals);

      // Kiểm tra liquidity
      const availableLiquidityAmount = availableLiquidity
        ? parseFloat(formatUnits(availableLiquidity, tokenInfo.decimals))
        : 0;

      // Cảnh báo nếu không đủ liquidity
      if (parseFloat(amount) > availableLiquidityAmount) {
        if (currentLoadingToastRef.current) {
          toast.dismiss(currentLoadingToastRef.current);
          currentLoadingToastRef.current = null;
        }
        toast.showError(`⚠️ Insufficient liquidity!\n\nYou want to withdraw: ${amount} ${supply.symbol}\nAvailable liquidity: ${availableLiquidityAmount.toFixed(6)} ${supply.symbol}\n\nPlease wait for borrowers to repay or reduce your withdrawal amount.`);
        setIsSupplying(false);
        return;
      }

      // Withdraw from LoanManager - NO APPROVAL NEEDED
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
            outputs: []
          }],
          functionName: "withdraw",
          args: [supply.tokenAddress as `0x${string}`, amountWei],
        });

        const provider = await privyWallet.getEthereumProvider();
        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: walletAddress,
            to: getAddress("LoanManager"),
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
                await new Promise(resolve => setTimeout(resolve, 2000));

                if (currentLoadingToastRef.current) {
                  toast.dismiss(currentLoadingToastRef.current);
                  currentLoadingToastRef.current = null;
                }

                if (!successToastShownRef.current) {
                  successToastShownRef.current = true;
                  toast.showTransactionSuccess(txHash, "Withdraw Assets");
                }

                if (onTransactionSuccess) {
                  onTransactionSuccess();
                }

                setTimeout(() => handleClose(), 500);
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
            toast.showTransactionError("Transaction confirmation timeout", "Withdraw Assets");
            setUsingPrivyFlow(false);
            setIsSupplying(false);
          }
        } catch (waitError) {
          console.error("Error waiting for withdraw tx:", waitError);
          if (currentLoadingToastRef.current) {
            toast.dismiss(currentLoadingToastRef.current);
            currentLoadingToastRef.current = null;
          }
          toast.showTransactionError(waitError instanceof Error ? waitError.message : String(waitError), "Withdraw Assets");
          setIsSupplying(false);
          setUsingPrivyFlow(false);
        }
      } else {
        writeSupply({
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
              outputs: []
            }
          ],
          functionName: "withdraw",
          args: [supply.tokenAddress as `0x${string}`, amountWei],
        });
      }

    } catch (error: unknown) {
      console.error("❌ Withdraw failed:", error);

      // Dismiss loading toast and show error
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.showTransactionError(errorMessage, "Withdraw");
      setIsSupplying(false);
      setUsingPrivyFlow(false);
    }
  };

  const handleSupplyAfterApproval = async ({ reuseExistingToast = false }: { reuseExistingToast?: boolean } = {}) => {
    if (!amount) return;

    if (supplyCalledRef.current) {
      return;
    }

    supplyCalledRef.current = true;

    // Show loading toast only when we aren't reusing the existing one
    if (!reuseExistingToast) {
      const loadingToast = toast.showTransactionPending("Supply Asset");
      currentLoadingToastRef.current = loadingToast;
      successToastShownRef.current = false; // Reset flag for new transaction
    }

    try {
      const tokenInfo = getTokenInfo(supply.tokenAddress);
      const amountWei = parseUnits(amount, tokenInfo.decimals);

      if (!isConnected && wallets.length > 0) {
        const privyWallet = wallets[0];

        const supplyData = encodeFunctionData({
          abi: [{
            name: "depositToPool",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" }
            ],
            outputs: []
          }],
          functionName: "depositToPool",
          args: [supply.tokenAddress as `0x${string}`, amountWei],
        });

        const provider = await privyWallet.getEthereumProvider();
        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: walletAddress,
            to: getAddress("LoanManager"),
            data: supplyData,
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
                  toast.showTransactionSuccess(txHash, "Supply Asset");
                }

                if (onTransactionSuccess) {
                  onTransactionSuccess();
                }

                setTimeout(() => {
                  handleClose();
                  supplyCalledRef.current = false;
                }, 500);
                setUsingPrivyFlow(false);
                setIsSupplying(false);
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
            toast.showTransactionError("Transaction confirmation timeout", "Supply Assets");
            setIsSupplying(false);
            setUsingPrivyFlow(false);
          }
        } catch (waitError) {
          console.error("Error waiting for supply tx:", waitError);
          if (currentLoadingToastRef.current) {
            toast.dismiss(currentLoadingToastRef.current);
            currentLoadingToastRef.current = null;
          }
          toast.showTransactionError(waitError instanceof Error ? waitError.message : String(waitError), "Supply Assets");
          supplyCalledRef.current = false;
        }
      } else {
        writeSupply({
          address: getAddress("LoanManager"),
          abi: [
            {
              name: "depositToPool",
              type: "function",
              stateMutability: "nonpayable",
              inputs: [
                { name: "token", type: "address" },
                { name: "amount", type: "uint256" }
              ],
              outputs: []
            }
          ],
          functionName: "depositToPool",
          args: [supply.tokenAddress as `0x${string}`, amountWei],
        });
      }

    } catch (error) {
      console.error("❌ Supply failed:", error);

      // Dismiss loading toast and show error only if we created one
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }

      toast.showTransactionError(
        error instanceof Error ? error.message : 'Supply failed. Please try again.',
        "Supply Asset"
      );

      setIsSupplying(false);
      supplyCalledRef.current = false;
      setUsingPrivyFlow(false);
    }
  };

  const handleSupply = async () => {
    if (!isWalletConnected) {
      toast.showError("Please connect your wallet first");
      return;
    }

    if (!amount) return;

    // If already approved, go directly to supply
    if (isApproved) {
      handleSupplyAfterApproval();
      return;
    }

    supplyCalledRef.current = false;
    setIsSupplying(true);
    setIsApproving(true);

    // Show loading toast when we start the actual transaction
    const loadingToast = toast.showTransactionPending("Supply Asset");
    currentLoadingToastRef.current = loadingToast;
    successToastShownRef.current = false; // Reset flag for new transaction

    try {
      const tokenInfo = getTokenInfo(supply.tokenAddress);
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
          args: [getAddress("LoanManager"), amountWei],
        });

        const provider = await privyWallet.getEthereumProvider();
        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: walletAddress,
            to: supply.tokenAddress,
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
                setIsApproving(false);
                setIsApproved(true);
                await new Promise(resolve => setTimeout(resolve, 100));
                await handleSupplyAfterApproval({ reuseExistingToast: true });
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
            setIsSupplying(false);
            setUsingPrivyFlow(false);
          }
        } catch (waitError) {
          console.error("Error waiting for approve tx:", waitError);
          setIsApproving(false);
          setIsSupplying(false);
          setUsingPrivyFlow(false);
          supplyCalledRef.current = false;
        }
      } else {
        writeToken({
          address: supply.tokenAddress as `0x${string}`,
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
            getAddress("LoanManager"),
            amountWei
          ],
        });
      }

    } catch (error) {
      console.error("❌ Approve failed:", error);

      // Dismiss loading toast and show error
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }

      toast.showTransactionError(
        error instanceof Error ? error.message : 'Approve failed. Please try again.',
        "Supply Asset"
      );

      setIsSupplying(false);
      setIsApproving(false);
      setUsingPrivyFlow(false);
      supplyCalledRef.current = false;
    }
  };

  const handleWithdrawAll = async () => {
    if (!isWalletConnected) {
      toast.showError("Please connect your wallet first");
      return;
    }

    if (supply.amount === 0) {
      toast.showError("No funds to withdraw");
      return;
    }

    // Kiểm tra liquidity
    const tokenInfo = getTokenInfo(supply.tokenAddress);
    const availableLiquidityAmount = availableLiquidity
      ? parseFloat(formatUnits(availableLiquidity, tokenInfo.decimals))
      : 0;

    // Cảnh báo nếu không đủ liquidity
    const totalWithdrawAmount = supply.amount + (supply.interestEarned || 0);
    if (totalWithdrawAmount > availableLiquidityAmount) {
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }
      toast.showError(`⚠️ Insufficient liquidity!\n\nYou want to withdraw: ${totalWithdrawAmount.toFixed(2)} ${supply.symbol}\nAvailable liquidity: ${availableLiquidityAmount.toFixed(6)} ${supply.symbol}\n\nPlease wait for borrowers to repay or withdraw a smaller amount.`);
      return;
    }

    // Show loading toast when we start the actual transaction
    const loadingToast = toast.showTransactionPending("Withdraw All");
    currentLoadingToastRef.current = loadingToast;
    successToastShownRef.current = false; // Reset flag for new transaction

    try {
      if (!isConnected && wallets.length > 0) {
        setUsingPrivyFlow(true);
        const privyWallet = wallets[0];

        await privyWallet.switchChain(ARC_CHAIN_ID);

        const withdrawAllData = encodeFunctionData({
          abi: [{
            name: "withdrawAll",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "token", type: "address" }
            ],
            outputs: []
          }],
          functionName: "withdrawAll",
          args: [supply.tokenAddress as `0x${string}`],
        });

        const provider = await privyWallet.getEthereumProvider();
        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: walletAddress,
            to: getAddress("LoanManager"),
            data: withdrawAllData,
          }]
        });

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
                  toast.showTransactionSuccess(txHash, "Withdraw All");
                }

                setTimeout(() => {
                  if (onTransactionSuccess) {
                    onTransactionSuccess();
                  }
                }, 2000);

                setTimeout(() => handleClose(), 2500);
                break;
              }
            } catch (e) { }

            await new Promise((resolve) => setTimeout(resolve, 1000));
            attempts++;
          }

          if (attempts >= maxAttempts) {
            if (currentLoadingToastRef.current) {
              toast.dismiss(currentLoadingToastRef.current);
              currentLoadingToastRef.current = null;
            }
            setUsingPrivyFlow(false);
          }
        } catch (waitError) {
          console.error("Error waiting for withdraw all tx:", waitError);
          setUsingPrivyFlow(false);
        }
      } else {
        await withdrawAll(supply.tokenAddress);
        // Không đóng modal ngay lập tức, chờ transaction confirmation
      }
    } catch (error: unknown) {
      console.error("❌ Withdraw All failed:", error);

      // Dismiss loading toast and show error
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }

      setUsingPrivyFlow(false);

      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.showTransactionError(errorMessage, "Withdraw All");
    }
  };

  const handleClose = useCallback(() => {
    setShowModal(false);
    setAmount("");
    setIsSupplying(false);
    setIsApproving(false);
    setIsApproved(false);
    setIsWithdrawAll(false);
    setUsingPrivyFlow(false);
    supplyCalledRef.current = false;
  }, []);

  return (
    <>
      <button
        onClick={() => {
          setAction('withdraw');
          setShowModal(true);
        }}
        className="px-3 py-1 text-base rounded transition-colors text-white cursor-pointer"
        style={{ backgroundColor: 'var(--button-active)' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--button-hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--button-active)';
        }}
      >
        Manage
      </button>

      {/* Supply/Withdraw Modal - Render using Portal to avoid hydration issues */}
      {showModal && createPortal(
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div
            className="rounded-lg p-6 w-full max-w-[26rem] shadow-2xl border border-gray-700 bg-[#111827]"
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-white">
                Manage {supply.symbol}
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
                onClick={() => setAction('supply')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-all ${action === 'supply'
                  ? 'text-white shadow-lg bg-[#F87813]'
                  : 'text-gray-400 hover:text-white'
                  }`}
              >
                Supply
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
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium text-gray-400">Amount</label>
                  <span className="text-xs text-gray-500">
                    {action === 'supply'
                      ? `Wallet: ${walletBalance.toFixed(2)} ${supply.symbol}`
                      : `Supplied: ${(supply.amount + (supply.interestEarned || 0)).toFixed(2)} ${supply.symbol}`
                    }
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
                        disabled={action === 'withdraw' && isWithdrawAll}
                        className="w-full text-2xl font-bold text-white bg-transparent border-none outline-none placeholder-gray-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50"
                      />
                    </div>

                    <div className="flex items-center gap-2 px-2 py-1 bg-gray-700/50 rounded-md border border-gray-600/50">
                      <div className="relative w-5 h-5 border-none">
                        <Image
                          src={supply.icon}
                          alt={supply.symbol}
                          fill
                          className="object-contain"
                        />
                      </div>
                      <span className="text-sm font-semibold text-white">{supply.symbol}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-4">
                    <div className="text-xs font-medium text-gray-500">
                      ${(parseFloat(amount || "0") * (market?.price || 1.00)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    {action === 'supply' ? (
                      <button
                        onClick={() => setAmount(walletBalance.toString())}
                        className="text-xs font-bold text-gray-300 hover:text-white transition-colors uppercase tracking-widest bg-gray-700/50 px-2 py-1 rounded"
                      >
                        MAX
                      </button>
                    ) : (
                      !isWithdrawAll && (
                        <button
                          onClick={() => {
                            setIsWithdrawAll(true);
                            setAmount((supply.amount + (supply.interestEarned || 0)).toString());
                          }}
                          className="text-xs font-bold text-gray-300 hover:text-white transition-colors uppercase tracking-widest bg-gray-700/50 px-2 py-1 rounded"
                        >
                          MAX
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>

              {/* Info Section */}
              <div className="p-4 rounded-lg border border-gray-700/50 bg-gray-800/30 space-y-3">
                {action === 'supply' ? (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-400">Supply APY</span>
                      <span className="text-sm font-medium text-green-400">{market?.lendRate?.toFixed(2) || '0.00'}%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-400">Already Supplied</span>
                      <span className="text-sm font-medium text-white">{supply.amount?.toFixed(2) || '0.00'} {supply.symbol}</span>
                    </div>
                    {amount && parseFloat(amount) > 0 && (
                      <div className="flex justify-between items-center pt-2 border-t border-gray-700/30">
                        <span className="text-sm text-gray-400 font-bold uppercase tracking-tight text-xs">Total After Supply</span>
                        <span className="text-sm font-medium text-white">{((supply.amount || 0) + parseFloat(amount)).toFixed(2)} {supply.symbol}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-400">Total Supplied</span>
                      <span className="text-sm font-medium text-white">{supply.amount?.toFixed(2) || '0.00'} {supply.symbol}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-400">Interest Earned</span>
                      <span className="text-sm font-medium text-green-400">{supply.interestEarned?.toFixed(5) || '0.00000'} {supply.symbol}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Action Button */}
              {action === 'supply' ? (
                <button
                  onClick={handleSupply}
                  disabled={!amount || isLoading || parseFloat(amount || "0") > walletBalance}
                  className="w-full px-4 py-3 rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed text-white hover:opacity-90 active:scale-[0.98] mt-4 shadow-lg shadow-orange-500/10"
                  style={{ backgroundColor: 'var(--button-active)' }}
                >
                  {isLoading ? (
                    <div className="flex items-center justify-center gap-2 text-sm">
                      <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      <span>Supplying...</span>
                    </div>
                  ) : `Supply ${supply.symbol}`}
                </button>
              ) : (
                <button
                  onClick={isWithdrawAll ? handleWithdrawAll : handleWithdraw}
                  disabled={
                    isWithdrawAll
                      ? (supply.amount === 0 || isWithdrawAllPending || isWithdrawAllConfirming)
                      : (!amount || isLoading)
                  }
                  className="w-full px-4 py-3 rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed text-white hover:opacity-90 active:scale-[0.98] mt-4 shadow-lg shadow-orange-500/10"
                  style={{ backgroundColor: 'var(--button-active)' }}
                >
                  {isWithdrawAll
                    ? (isWithdrawAllPending || isWithdrawAllConfirming ? (
                      <div className="flex items-center justify-center gap-2 text-sm">
                        <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        <span>Withdrawing All...</span>
                      </div>
                    ) : `Withdraw All ${supply.symbol}`)
                    : (isLoading ? (
                      <div className="flex items-center justify-center gap-2 text-sm">
                        <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        <span>Withdrawing...</span>
                      </div>
                    ) : `Withdraw ${supply.symbol}`)
                  }
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}


