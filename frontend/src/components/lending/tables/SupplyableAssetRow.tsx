"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useMarketData } from "@/hooks/useMarketData";
import { useWriteContract, useAccount, useWaitForTransactionReceipt } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { parseUnits, encodeFunctionData } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { useToast } from "@/hooks/useToast";
import { ARC_CHAIN_ID, getAddress } from "@/utils/addresses";
import { useTokenPrice } from "@/hooks/useMarketData";

interface SupplyableAssetRowProps {
  asset: {
    tokenAddress: string;
    symbol: string;
    icon: string;
    name: string;
    balance: number;
    isLoading: boolean;
    error: Error | null;
  };
  formatBalance: (amount: number) => string;
  onTransactionSuccess?: () => void;
  currentSupplied?: number;
  market?: any;
}

export default function SupplyableAssetRow({
  asset,
  formatBalance,
  onTransactionSuccess,
  currentSupplied = 0,
  market
}: SupplyableAssetRowProps) {
  const toast = useToast();

  const { price: oraclePrice } = useTokenPrice(asset.tokenAddress);
  const tokenPrice = useMemo(() => {
    if (oraclePrice !== undefined && oraclePrice > 0) return oraclePrice;
    if (market?.price && market.price > 0) return market.price;
    return 1.00;
  }, [oraclePrice, market?.price]);

  // Lấy rates và LTV từ market data (passed from parent)
  const supplyRate = market?.lendRate || 0;

  // Format balance with 2 decimal places
  const formatBalanceFixed = (amount: number) => {
    if (amount === 0) return "0.00";
    return amount.toFixed(2);
  };

  const [showModal, setShowModal] = useState(false);
  const [amount, setAmount] = useState("");
  const [usingPrivyFlow, setUsingPrivyFlow] = useState(false);
  const supplyCalledRef = useRef(false);
  const currentLoadingToastRef = useRef<string | number | null>(null);
  const successToastShownRef = useRef(false);

  const { isConnected, address } = useAccount();
  const { wallets } = useWallets();

  const isWalletConnected = isConnected || wallets.length > 0;
  const walletAddress = address || wallets[0]?.address;

  const { writeContractAsync: approveToken, data: approveHash } = useWriteContract();
  const { writeContractAsync: supplyToken, data: supplyHash } = useWriteContract();

  // Wait for transaction confirmations
  const { isLoading: isApprovePending, isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({
    hash: approveHash,
  });

  const { isLoading: isSupplyPending, isSuccess: isSupplySuccess } = useWaitForTransactionReceipt({
    hash: supplyHash,
  });

  // Auto-handle transaction flow (wagmi only)
  useEffect(() => {
    if (isApproveSuccess && !usingPrivyFlow) {
      handleSupplyAfterApproval();
    }
  }, [isApproveSuccess, usingPrivyFlow]);

  // Auto-refresh data and close modal on supply success (wagmi only)
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

      const timer = setTimeout(() => {
        if (onTransactionSuccess) {
          onTransactionSuccess();
        }
      }, 2000);

      const closeTimer = setTimeout(() => {
        setShowModal(false);
        setAmount("");
        supplyCalledRef.current = false;
      }, 2500);

      return () => {
        clearTimeout(timer);
        clearTimeout(closeTimer);
      };
    }
  }, [isSupplySuccess, walletAddress, usingPrivyFlow, onTransactionSuccess, supplyHash, toast]);

  const handleSupplyAfterApproval = async () => {
    if (!amount) return;

    if (supplyCalledRef.current) {
      return;
    }

    supplyCalledRef.current = true;

    try {
      const tokenInfo = getTokenInfo(asset.tokenAddress);
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
          args: [asset.tokenAddress as `0x${string}`, amountWei],
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
                // Wait for contract state to update
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Dismiss loading toast before showing success
                if (currentLoadingToastRef.current !== null) {
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
                  setShowModal(false);
                  setAmount("");
                  setUsingPrivyFlow(false);
                  supplyCalledRef.current = false;
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
            toast.showTransactionError("Transaction confirmation timeout", "Supply Assets");
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
        await supplyToken({
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
          args: [asset.tokenAddress as `0x${string}`, amountWei],
          chainId: ARC_CHAIN_ID,
        });
      }
    } catch (error) {
      console.error("Supply failed:", error);
      toast.showTransactionError(
        error instanceof Error ? error.message : 'Unknown error',
        "Supply Asset"
      );
      supplyCalledRef.current = false;
    }
  };

  const handleSupply = async () => {
    if (!isWalletConnected) {
      toast.showError("Please connect your wallet first");
      return;
    }

    if (!amount) return;

    supplyCalledRef.current = false;

    // Only show loading toast when we're about to start a real transaction
    let loadingToast: string | number | null = null;

    try {
      const tokenInfo = getTokenInfo(asset.tokenAddress);
      const amountWei = parseUnits(amount, tokenInfo.decimals);

      // Show loading toast when we start the actual transaction
      loadingToast = toast.showTransactionPending("Supply Asset");
      currentLoadingToastRef.current = loadingToast;
      successToastShownRef.current = false; // Reset flag for new transaction

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
            to: asset.tokenAddress,
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
                await new Promise(resolve => setTimeout(resolve, 100));
                await handleSupplyAfterApproval();
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
            setUsingPrivyFlow(false);
          }
        } catch (waitError) {
          console.error("Error waiting for approve tx:", waitError);
          if (currentLoadingToastRef.current) {
            toast.dismiss(currentLoadingToastRef.current);
            currentLoadingToastRef.current = null;
          }
          toast.showTransactionError(waitError instanceof Error ? waitError.message : String(waitError), "Approve Assets");
          setUsingPrivyFlow(false);
          supplyCalledRef.current = false;
        }
      } else {
        await approveToken({
          address: asset.tokenAddress as `0x${string}`,
          abi: [
            {
              name: "approve",
              type: "function",
              stateMutability: "nonpayable",
              inputs: [
                { name: "spender", type: "address" },
                { name: "amount", type: "uint256" }
              ],
              outputs: [{ name: "", type: "bool" }]
            }
          ],
          functionName: "approve",
          args: [getAddress("LoanManager"), amountWei],
          chainId: ARC_CHAIN_ID,
        });
      }
    } catch (error) {
      console.error("Approve or Supply failed:", error);
      if (loadingToast) {
        toast.dismiss(loadingToast);
        currentLoadingToastRef.current = null;
      }
      toast.showTransactionError(
        error instanceof Error ? error.message : 'Unknown error',
        "Supply Asset"
      );
      setUsingPrivyFlow(false);
      supplyCalledRef.current = false;
    }
  };

  const parsedAmount = parseFloat(amount || "0");

  return (
    <tr>
      {/* Asset */}
      <td className="px-6 py-3 whitespace-nowrap">
        <div className="flex items-center">
          <div className="relative w-8 h-8 mr-3">
            <Image
              src={asset.icon}
              alt={asset.symbol}
              fill
              className="rounded-full object-contain"
            />
          </div>
          <div>
            <div className="text-base" style={{ color: 'var(--text-primary)' }}>{asset.symbol}</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{asset.name}</div>
          </div>
        </div>
      </td>

      {/* Wallet Balance */}
      <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{ color: 'var(--text-primary)' }}>
        {asset.isLoading ? "..." : (
          <div>
            <div>{formatBalance(asset.balance)}</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>${(asset.balance * tokenPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
        )}
      </td>

      {/* APY */}
      <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{ color: 'var(--text-primary)' }}>
        {market?.isLoading ? "..." : `${supplyRate.toFixed(2)}%`}
      </td>

      {/* Actions */}
      <td className="px-3 py-3 whitespace-nowrap text-center">
        <button
          disabled={asset.balance === 0}
          onClick={() => setShowModal(true)}
          className={`
            px-3 py-1 text-base rounded transition-colors
            ${asset.balance > 0
              ? 'text-white cursor-pointer hover:bg-[var(--button-hover)]'
              : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }
          `}
          style={asset.balance > 0 ? {
            backgroundColor: 'var(--button-active)'
          } : {}}
        >
          Supply
        </button>
      </td>

      {showModal && createPortal(
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div
            className="rounded-lg p-6 w-full max-w-[26rem] shadow-2xl border border-gray-700 bg-[#111827]"
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-white">
                Supply {asset.symbol}
              </h3>
              <button
                onClick={() => {
                  setShowModal(false);
                  setAmount("");
                  setUsingPrivyFlow(false);
                  supplyCalledRef.current = false;
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
                    Wallet: {formatBalance(asset.balance)} {asset.symbol}
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
                          src={asset.icon}
                          alt={asset.symbol}
                          fill
                          className="object-contain"
                        />
                      </div>
                      <span className="text-sm font-semibold text-white">{asset.symbol}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-4">
                    <div className="text-xs font-medium text-gray-500">
                      ${(parsedAmount * tokenPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <button
                      onClick={() => setAmount(asset.balance.toString())}
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
                  <span className="text-sm text-gray-400">Supply APY</span>
                  <span className="text-sm font-medium text-green-400">{supplyRate.toFixed(2)}%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">Already Supplied</span>
                  <span className="text-sm font-medium text-white">{currentSupplied.toFixed(2)} {asset.symbol}</span>
                </div>
                {amount && parseFloat(amount) > 0 && (
                  <div className="flex justify-between items-center pt-2 border-t border-gray-700/30">
                    <span className="text-sm text-gray-400 font-bold uppercase tracking-tight text-xs">Total After Supply</span>
                    <span className="text-sm font-medium text-white">{(currentSupplied + parseFloat(amount)).toFixed(2)} {asset.symbol}</span>
                  </div>
                )}
              </div>

              {/* Action Button */}
              <button
                onClick={handleSupply}
                disabled={!amount || isApprovePending || isSupplyPending || parsedAmount > asset.balance || parsedAmount <= 0}
                className="w-full px-4 py-3 rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed text-white hover:opacity-90 active:scale-[0.98] mt-4 shadow-lg shadow-orange-500/10"
                style={{ backgroundColor: 'var(--button-active)' }}
              >
                {isApprovePending ? (
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span>Approving...</span>
                  </div>
                ) : isSupplyPending ? (
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span>Supplying...</span>
                  </div>
                ) : `Supply ${asset.symbol}`}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </tr>
  );
}

