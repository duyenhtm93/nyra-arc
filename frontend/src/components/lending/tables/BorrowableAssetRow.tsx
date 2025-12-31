"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useWriteContract, useAccount, useWaitForTransactionReceipt } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { parseUnits, encodeFunctionData } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { useToast } from "@/hooks/useToast";
import { ARC_CHAIN_ID, getAddress } from "@/utils/addresses";

interface BorrowableAssetRowProps {
  token: {
    tokenAddress: string;
    symbol: string;
    icon: string;
    name: string;
  };
  formatBalance: (amount: number) => string;
  onTransactionSuccess?: () => void;
  refreshKey?: number;
  borrowedAmount?: number;
  market?: any;
  collateralDetails?: any;
  userBorrows?: any;
}

export default function BorrowableAssetRow({
  token,
  formatBalance,
  onTransactionSuccess,
  refreshKey,
  borrowedAmount = 0,
  market,
  collateralDetails,
  userBorrows
}: BorrowableAssetRowProps) {
  const { isConnected, address } = useAccount();
  const { wallets } = useWallets();
  const toast = useToast();

  // ✅ Fallback: nếu wagmi chưa sync thì lấy từ Privy
  const isWalletConnected = isConnected || wallets.length > 0;
  const walletAddress = address || wallets[0]?.address;

  // Constants from passed props
  const borrowRate = market?.borrowRate || 0;
  const tokenPrice = market?.price || 1.00;
  const liquidationThreshold = market?.liquidationThreshold || 75;

  // Calculate available amount centerally
  const availableAmount = useMemo(() => {
    if (!collateralDetails || !tokenPrice) return 0;
    return collateralDetails.availableToBorrow / tokenPrice;
  }, [collateralDetails, tokenPrice]);

  const [showModal, setShowModal] = useState(false);
  const [amount, setAmount] = useState("");
  const [duration, setDuration] = useState("30"); // 30 days default
  const [usingPrivyFlow, setUsingPrivyFlow] = useState(false);
  const pendingToastRef = useRef<string | number | null>(null);
  const successToastShownRef = useRef(false);

  const { writeContractAsync: requestLoan, data: borrowHash } = useWriteContract();

  // Wait for borrow transaction
  const { isLoading: isBorrowing, isSuccess: isBorrowSuccess } = useWaitForTransactionReceipt({
    hash: borrowHash,
  });

  // Auto-refresh and close modal on success (wagmi only)
  useEffect(() => {
    if (isBorrowSuccess && walletAddress && !usingPrivyFlow && !successToastShownRef.current) {
      if (pendingToastRef.current !== null) {
        toast.dismiss(pendingToastRef.current);
        pendingToastRef.current = null;
      }
      // Show success toast
      successToastShownRef.current = true;
      toast.showTransactionSuccess(borrowHash || "", "Borrow Asset");

      // Wait for contract state to update before triggering refresh
      const timer = setTimeout(() => {
        if (onTransactionSuccess) {
          onTransactionSuccess();
        }
      }, 2000);

      const closeTimer = setTimeout(() => {
        setShowModal(false);
        setAmount("");
        setDuration("30");
        setUsingPrivyFlow(false);
      }, 2500);

      return () => {
        clearTimeout(timer);
        clearTimeout(closeTimer);
      };
    }
  }, [isBorrowSuccess, walletAddress, usingPrivyFlow, onTransactionSuccess, borrowHash, toast]);

  // Calculate projected health factor after borrowing
  const projectedHealthFactor = useMemo(() => {
    if (!amount || !collateralDetails) return null;

    // Amount is in token units, convert to USD
    const borrowAmount = parseFloat(amount);
    if (isNaN(borrowAmount)) return null;

    const borrowAmountUSD = borrowAmount * tokenPrice;

    // Lấy dữ liệu từ collateralDetails (đã có logic đúng)
    const collateralUSD = collateralDetails.totalCollateralValue || 0;
    const currentDebtUSD = collateralDetails.outstandingLoan || 0;

    const newDebtUSD = currentDebtUSD + borrowAmountUSD;
    return newDebtUSD > 0 ? (collateralUSD * liquidationThreshold) / (newDebtUSD * 100) : 999;
  }, [amount, tokenPrice, collateralDetails, liquidationThreshold]);

  const handleBorrow = async () => {
    if (!isWalletConnected) {
      toast.showError("Please connect your wallet first");
      return;
    }

    if (!amount || !duration) return;

    try {
      if (pendingToastRef.current !== null) {
        toast.dismiss(pendingToastRef.current);
      }
      pendingToastRef.current = toast.showTransactionPending("Borrow Asset");
      successToastShownRef.current = false; // Reset flag for new transaction
      const tokenInfo = getTokenInfo(token.tokenAddress);
      const amountWei = parseUnits(amount, tokenInfo.decimals);
      const durationSeconds = parseInt(duration) * 24 * 60 * 60; // Convert days to seconds

      if (!isConnected && wallets.length > 0) {
        setUsingPrivyFlow(true);
        const privyWallet = wallets[0];

        await privyWallet.switchChain(ARC_CHAIN_ID);

        const borrowData = encodeFunctionData({
          abi: [{
            name: "requestLoan",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "token", type: "address" },
              { name: "principal", type: "uint256" },
              { name: "duration", type: "uint256" }
            ],
            outputs: []
          }],
          functionName: "requestLoan",
          args: [token.tokenAddress as `0x${string}`, amountWei, BigInt(durationSeconds)],
        });

        const provider = await privyWallet.getEthereumProvider();
        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: walletAddress,
            to: getAddress("LoanManager"),
            data: borrowData,
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
                // Wait for contract state to update before triggering refresh
                await new Promise(resolve => setTimeout(resolve, 2000));

                if (pendingToastRef.current !== null) {
                  toast.dismiss(pendingToastRef.current);
                  pendingToastRef.current = null;
                }

                if (!successToastShownRef.current) {
                  successToastShownRef.current = true;
                  toast.showTransactionSuccess(txHash, "Borrow Asset");
                }

                if (onTransactionSuccess) {
                  onTransactionSuccess();
                }

                setTimeout(() => {
                  setShowModal(false);
                  setAmount("");
                  setDuration("30");
                  setUsingPrivyFlow(false);
                }, 500);
                break;
              }
            } catch (e) { }

            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
          }

          if (attempts >= maxAttempts) {
            if (pendingToastRef.current !== null) {
              toast.dismiss(pendingToastRef.current);
              pendingToastRef.current = null;
            }
            toast.showTransactionError("Transaction confirmation timeout", "Borrow Assets");
            setUsingPrivyFlow(false);
          }
        } catch (waitError) {
          console.error("Error waiting for borrow tx:", waitError);
          if (pendingToastRef.current !== null) {
            toast.dismiss(pendingToastRef.current);
            pendingToastRef.current = null;
          }
          toast.showTransactionError(waitError instanceof Error ? waitError.message : String(waitError), "Borrow Assets");
          setUsingPrivyFlow(false);
        }
      } else {
        await requestLoan({
          address: getAddress("LoanManager"),
          abi: [
            {
              name: "requestLoan",
              type: "function",
              stateMutability: "nonpayable",
              inputs: [
                { name: "token", type: "address" },
                { name: "principal", type: "uint256" },
                { name: "duration", type: "uint256" }
              ],
              outputs: []
            }
          ],
          functionName: "requestLoan",
          args: [token.tokenAddress as `0x${string}`, amountWei, BigInt(durationSeconds)],
          chainId: ARC_CHAIN_ID,
        });
      }
    } catch (error) {
      console.error("❌ Borrow failed:", error);
      if (pendingToastRef.current !== null) {
        toast.dismiss(pendingToastRef.current);
        pendingToastRef.current = null;
      }
      toast.showTransactionError(
        error instanceof Error ? error.message : 'Unknown error',
        "Borrow Asset"
      );
      setUsingPrivyFlow(false);
    }
  };

  const parsedAmount = parseFloat(amount || "0");
  const healthFactorValue = userBorrows?.healthFactor?.healthFactor || 0;
  const isHealthFactorLoading = userBorrows?.healthFactor?.isLoading || collateralDetails?.isLoading;

  return (
    <>
      <tr>
        {/* Asset */}
        <td className="px-6 py-3 whitespace-nowrap">
          <div className="flex items-center">
            <div className="relative w-8 h-8 mr-3">
              <Image
                src={token.icon}
                alt={token.symbol}
                fill
                className="rounded-full object-contain"
              />
            </div>
            <div>
              <div className="text-base" style={{ color: 'var(--text-primary)' }}>{token.symbol}</div>
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{token.name}</div>
            </div>
          </div>
        </td>

        {/* Available */}
        <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{ color: 'var(--text-primary)' }}>
          {collateralDetails?.isLoading ? "..." : (
            <div>
              <div>{formatBalance(availableAmount)}</div>
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>${(availableAmount * tokenPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
          )}
        </td>

        {/* APY */}
        <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{ color: 'var(--text-primary)' }}>
          {market?.isLoading ? "..." : borrowRate > 0 ? `${borrowRate.toFixed(2)}%` : "N/A"}
        </td>

        {/* Actions */}
        <td className="px-6 py-3 whitespace-nowrap text-center">
          <button
            disabled={availableAmount === 0}
            onClick={() => setShowModal(true)}
            className={`
              px-3 py-1 text-base rounded transition-colors
              ${availableAmount > 0
                ? 'text-white cursor-pointer hover:bg-[var(--button-hover)]'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }
            `}
            style={availableAmount > 0 ? {
              backgroundColor: 'var(--button-active)'
            } : {}}
          >
            Borrow
          </button>
        </td>
      </tr>

      {/* Borrow Modal - Render using Portal to avoid hydration issues */}
      {showModal && createPortal(
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div
            className="rounded-lg p-6 w-full max-w-[26rem] shadow-2xl border border-gray-700 bg-[#111827]"
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-white">
                Borrow {token.symbol}
              </h3>
              <button
                onClick={() => {
                  setShowModal(false);
                  setAmount("");
                  setDuration("30");
                  setUsingPrivyFlow(false);
                }}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium text-gray-400">Amount</label>
                  <span className="text-xs text-gray-500">
                    Available: {availableAmount.toFixed(4)} {token.symbol}
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
                          src={token.icon}
                          alt={token.symbol}
                          fill
                          className="object-contain"
                        />
                      </div>
                      <span className="text-sm font-semibold text-white">{token.symbol}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-4">
                    <div className="text-xs font-medium text-gray-500">
                      ${(parsedAmount * tokenPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <button
                      onClick={() => setAmount(availableAmount.toFixed(6))}
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
                  <span className="text-sm text-gray-400">Borrow APY</span>
                  <span className="text-sm font-medium text-red-400">{borrowRate.toFixed(2)}%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Current Borrowed</span>
                  <span className="text-sm font-medium text-white">{borrowedAmount.toFixed(2)} {token.symbol}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">New Health Factor</span>
                  <span className="text-sm font-medium">
                    {isHealthFactorLoading ? "..." :
                      projectedHealthFactor ?
                        <div className="flex items-center gap-2">
                          <span className={`${projectedHealthFactor >= 1.5 ? 'text-green-400' : projectedHealthFactor >= 1.1 ? 'text-orange-400' : 'text-red-400'}`}>
                            {projectedHealthFactor.toFixed(2)}
                          </span>
                        </div> :
                        <span className="text-white">{healthFactorValue.toFixed(2)}</span>}
                  </span>
                </div>
                <div className="pt-2 border-t border-gray-700/50 flex justify-between items-center">
                  <span className="text-xs text-gray-400 italic">Liquidation threshold</span>
                  <span className="text-xs font-medium text-gray-500">HF &lt; 1.0</span>
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={handleBorrow}
                disabled={!amount || isBorrowing || parsedAmount > availableAmount || parsedAmount <= 0}
                className="w-full px-4 py-3 rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed text-white hover:opacity-90 active:scale-[0.98] mt-4 shadow-lg shadow-orange-500/10"
                style={{ backgroundColor: 'var(--button-active)' }}
              >
                {isBorrowing ? (
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span>Borrowing...</span>
                  </div>
                ) : `Borrow ${token.symbol}`}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
