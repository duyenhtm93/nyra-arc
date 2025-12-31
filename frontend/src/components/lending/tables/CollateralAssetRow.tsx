"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useWriteContract, useAccount, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { parseUnits, encodeFunctionData, formatUnits } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { useInvalidateQueries } from "@/hooks/useInvalidateQueries";
import { useToast } from "@/hooks/useToast";
import { ARC_CHAIN_ID, getAddress } from "@/utils/addresses";
import { useTokenPrice } from "@/hooks/useMarketData";

interface CollateralAssetRowProps {
  token: {
    tokenAddress: string;
    symbol: string;
    icon: string;
    name: string;
    balance: number;
    isLoading: boolean;
    error: Error | null | undefined;
  };
  formatBalance: (amount: number) => string;
  onTransactionSuccess?: () => void;
  market?: any;
  collateralDetails?: any;
}

export default function CollateralAssetRow({ token, formatBalance, onTransactionSuccess, market, collateralDetails }: CollateralAssetRowProps) {
  const [showModal, setShowModal] = useState(false);
  const [amount, setAmount] = useState("");
  const [isDepositing, setIsDepositing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const toast = useToast();

  const currentLoadingToastRef = useRef<string | number | null>(null);
  const successToastShownRef = useRef(false);

  const { isConnected, address } = useAccount();
  const { wallets } = useWallets();

  // ✅ Fallback: nếu wagmi chưa sync thì lấy từ Privy
  const isWalletConnected = isConnected || wallets.length > 0;
  const walletAddress = address || wallets[0]?.address;

  const { writeContractAsync: depositCollateral, data: depositHash } = useWriteContract();
  const { writeContractAsync: approveToken, data: approveHash } = useWriteContract();
  const { invalidateAllUserData } = useInvalidateQueries();

  // PRIORITIZE PRICE FROM ORACLE
  const { price: oraclePrice } = useTokenPrice(token.tokenAddress);
  const tokenPrice = useMemo(() => {
    if (oraclePrice !== undefined && oraclePrice > 0) return oraclePrice;
    if (market?.price && market.price > 0) return market.price;
    return 1.00;
  }, [oraclePrice, market?.price]);

  const ltv = market?.ltv || 75;

  // Get current collateral balance for this token
  const { data: collateralBalance } = useReadContract({
    address: getAddress("CollateralManager"),
    abi: [
      {
        name: "collateralBalances",
        type: "function",
        stateMutability: "view",
        inputs: [
          { name: "user", type: "address" },
          { name: "token", type: "address" }
        ],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
    functionName: "collateralBalances",
    args: walletAddress ? [walletAddress as `0x${string}`, token.tokenAddress as `0x${string}`] : undefined,
    chainId: ARC_CHAIN_ID,
    query: {
      enabled: !!walletAddress,
    },
  });

  const tokenInfo = useMemo(() => getTokenInfo(token.tokenAddress), [token.tokenAddress]);
  const depositedAmount = useMemo(() => collateralBalance ? parseFloat(formatUnits(collateralBalance, tokenInfo.decimals)) : 0, [collateralBalance, tokenInfo.decimals]);

  // Calculate projected health factor after deposit
  const projectedHealthFactor = useMemo(() => {
    if (!amount || !collateralDetails || isNaN(collateralDetails.healthFactor)) return null;

    // Amount is in token units, convert to USD
    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount)) return null;

    const depositAmountUSD = depositAmount * tokenPrice;

    const collateralUSD = collateralDetails.totalCollateralValue || 0;
    const currentDebtUSD = collateralDetails.outstandingLoan || 0;

    // Deposit increases collateral
    const newCollateralUSD = collateralUSD + depositAmountUSD;
    return currentDebtUSD > 0 ? (newCollateralUSD * ltv) / (currentDebtUSD * 100) : 999;
  }, [amount, collateralDetails, tokenPrice, ltv]);

  // Wait for transaction receipts
  const { isLoading: isApprovePending, isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({
    hash: approveHash,
  });

  const { isLoading: isDepositPending, isSuccess: isDepositSuccess } = useWaitForTransactionReceipt({
    hash: depositHash,
  });

  const handleDepositAfterApproval = useCallback(async () => {
    if (!amount) return;

    setIsDepositing(true);
    if (!currentLoadingToastRef.current) {
      currentLoadingToastRef.current = toast.showTransactionPending("Deposit Collateral");
    }
    successToastShownRef.current = false; // Reset flag for new transaction

    try {
      const amountWei = parseUnits(amount, tokenInfo.decimals);

      // ✅ Dùng Privy wallet nếu không có wagmi connector
      if (!isConnected && wallets.length > 0) {
        const privyWallet = wallets[0];

        // Encode deposit function call
        const depositData = encodeFunctionData({
          abi: [{
            name: "deposit",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" }
            ],
            outputs: []
          }],
          functionName: "deposit",
          args: [token.tokenAddress as `0x${string}`, amountWei],
        });

        // Send transaction using Privy wallet via EIP-1193 provider
        const provider = await privyWallet.getEthereumProvider();
        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: walletAddress,
            to: getAddress("CollateralManager"),
            data: depositData,
          }]
        });

        // Wait for transaction confirmation
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

                setIsDepositing(false);
                setTimeout(() => {
                  setShowModal(false);
                  setAmount("");
                }, 500);
                break;
              }
            } catch (e) {
              // Receipt not found yet
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
          }

          if (attempts >= maxAttempts) {
            if (currentLoadingToastRef.current) {
              toast.dismiss(currentLoadingToastRef.current);
              currentLoadingToastRef.current = null;
            }
            toast.showTransactionError("Transaction confirmation timeout", "Deposit Collateral");
            setIsDepositing(false);
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
          setIsDepositing(false);
        }
      } else {
        // Use wagmi if connector available
        await depositCollateral({
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
              outputs: []
            }
          ],
          functionName: "deposit",
          args: [token.tokenAddress as `0x${string}`, amountWei],
          chainId: ARC_CHAIN_ID,
        });

        // Wagmi useEffect will handle refresh
      }
    } catch (error) {
      console.error("Deposit collateral failed:", error);
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }
      toast.showTransactionError(
        error instanceof Error ? error.message : 'Deposit failed. Please try again.',
        "Deposit Collateral"
      );
      setIsDepositing(false);
    }
  }, [amount, tokenInfo, isConnected, wallets, walletAddress, depositCollateral, token.tokenAddress, onTransactionSuccess, toast]);

  // Auto-proceed to deposit after approval success
  useEffect(() => {
    if (isApproveSuccess && isApproving) {
      // Dismiss loading toast
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }

      setIsApproving(false);
      handleDepositAfterApproval();
    }
  }, [isApproveSuccess, isApproving, approveHash, toast, handleDepositAfterApproval]);

  // Auto-close modal and refresh data after deposit success
  useEffect(() => {
    if (isDepositSuccess && walletAddress && !successToastShownRef.current) {
      // Dismiss loading toast
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }

      successToastShownRef.current = true;
      toast.showTransactionSuccess(depositHash!, "Deposit Collateral");

      if (onTransactionSuccess) {
        onTransactionSuccess();
      }

      setIsDepositing(false);
      const timer = setTimeout(() => {
        setShowModal(false);
        setAmount("");
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isDepositSuccess, walletAddress, depositHash, toast, onTransactionSuccess]);

  const handleDeposit = async () => {
    if (!isWalletConnected) {
      toast.showError("Please connect your wallet first");
      return;
    }

    if (!amount) return;

    setIsApproving(true);
    currentLoadingToastRef.current = toast.showTransactionPending("Approve Token");
    successToastShownRef.current = false; // Reset flag for new transaction

    try {
      const amountWei = parseUnits(amount, tokenInfo.decimals);

      // ✅ Dùng Privy wallet thay vì wagmi nếu không có connector
      if (!isConnected && wallets.length > 0) {
        const privyWallet = wallets[0];

        // Switch to Arc Testnet nếu cần
        await privyWallet.switchChain(ARC_CHAIN_ID);

        // Encode approve function call
        const approveData = encodeFunctionData({
          abi: [{
            name: "approve",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "spender", type: "address" },
              { name: "amount", type: "uint256" }
            ],
            outputs: [{ name: "", type: "bool" }]
          }],
          functionName: "approve",
          args: [getAddress("CollateralManager"), amountWei],
        });

        // Send transaction using Privy wallet via EIP-1193 provider
        const provider = await privyWallet.getEthereumProvider();
        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: walletAddress,
            to: token.tokenAddress,
            data: approveData,
          }]
        });

        // Wait for transaction confirmation
        try {
          // Poll for transaction receipt
          let attempts = 0;
          const maxAttempts = 30; // 30 seconds max

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
                await new Promise(resolve => setTimeout(resolve, 2000));
                await handleDepositAfterApproval();
                break;
              }
            } catch (e) {
              // Receipt not found yet, continue polling
            }

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
            handleDepositAfterApproval();
          }
        } catch (waitError) {
          console.error("Error waiting for tx:", waitError);
          if (currentLoadingToastRef.current) {
            toast.dismiss(currentLoadingToastRef.current);
            currentLoadingToastRef.current = null;
          }
          toast.showTransactionError(
            waitError instanceof Error ? waitError.message : 'Transaction failed. Please try again.',
            "Approve Token"
          );
          // Fallback: proceed after 3s
          setTimeout(() => {
            setIsApproving(false);
            handleDepositAfterApproval();
          }, 3000);
        }
      } else {
        // Use wagmi if connector available
        await approveToken({
          address: token.tokenAddress as `0x${string}`,
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
          args: [getAddress("CollateralManager"), amountWei],
          chainId: ARC_CHAIN_ID,
        });
      }

      // Note: handleDepositAfterApproval will be called automatically via useEffect when approval succeeds
    } catch (error) {
      console.error("Approve failed:", error);
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }
      toast.showTransactionError(
        error instanceof Error ? error.message : 'Approve failed. Please try again.',
        "Approve Token"
      );
      setIsApproving(false);
    }
  };

  const parsedAmount = parseFloat(amount || "0");

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

        {/* Wallet Balance */}
        <td className="px-6 py-3 whitespace-nowrap text-right">
          <div className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>{token.isLoading ? "..." : formatBalance(token.balance)}</div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            ${(token.balance * tokenPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </td>

        {/* LTV */}
        <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{ color: 'var(--text-primary)' }}>
          {ltv}%
        </td>

        {/* Actions */}
        <td className="px-3 py-3 whitespace-nowrap text-center">
          <button
            disabled={token.balance === 0}
            onClick={() => setShowModal(true)}
            className="px-3 py-1 text-base rounded transition-colors text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            style={{ backgroundColor: 'var(--button-active)' }}
          >
            Deposit
          </button>
        </td>
      </tr>

      {showModal && createPortal(
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div
            className="rounded-lg p-6 w-full max-w-[26rem] shadow-2xl border border-gray-700 bg-[#111827]"
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-white">
                Deposit {token.symbol}
              </h3>
              <button
                onClick={() => {
                  setShowModal(false);
                  setAmount("");
                  setIsDepositing(false);
                  setIsApproving(false);
                }}
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
                  <span className="text-xs text-gray-500">Wallet: {formatBalance(token.balance)}</span>
                </div>

                <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50">
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full text-2xl font-bold text-white bg-transparent border-none outline-none placeholder-gray-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
                      onClick={() => setAmount(token.balance.toString())}
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
                  <span className="text-sm font-medium text-white">{depositedAmount.toFixed(2)} {token.symbol}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400">New Health Factor</span>
                  <span className="text-sm font-medium">
                    {collateralDetails?.isLoading ? "..." :
                      projectedHealthFactor ?
                        <div className="flex items-center gap-2">
                          <span className={`${projectedHealthFactor >= 1.5 ? 'text-green-400' : projectedHealthFactor >= 1.1 ? 'text-orange-400' : 'text-red-400'}`}>
                            {projectedHealthFactor === 999 ? "∞" : projectedHealthFactor.toFixed(2)}
                          </span>
                        </div> :
                        <span className="text-white">{collateralDetails?.healthFactor ? (collateralDetails.healthFactor === 999 ? "∞" : collateralDetails.healthFactor.toFixed(2)) : "N/A"}</span>}
                  </span>
                </div>
                <div className="pt-2 border-t border-gray-700/50 flex justify-between items-center">
                  <span className="text-xs text-gray-400 italic">Liquidation threshold</span>
                  <span className="text-xs font-medium text-gray-500">HF &lt; 1.0</span>
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={handleDeposit}
                disabled={!amount || isDepositing || isApproving || isApprovePending || isDepositPending || parsedAmount > token.balance || parsedAmount <= 0}
                className="w-full px-4 py-3 rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed text-white hover:opacity-90 active:scale-[0.98] mt-4 shadow-lg shadow-orange-500/10"
                style={{ backgroundColor: 'var(--button-active)' }}
              >
                {isApproving || isApprovePending ? (
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span>Approving...</span>
                  </div>
                ) : isDepositing || isDepositPending ? (
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span>Depositing...</span>
                  </div>
                ) : `Deposit ${token.symbol}`}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
