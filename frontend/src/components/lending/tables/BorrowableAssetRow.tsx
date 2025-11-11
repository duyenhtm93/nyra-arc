"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useAvailableToBorrow, useUserBorrow } from "@/hooks/useUserBorrow";
import { useCollateralDetails } from "@/hooks/useCollateral";
import { useWriteContract, useAccount, useWaitForTransactionReceipt } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { parseUnits, encodeFunctionData } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { useToast } from "@/hooks/useToast";
import { useMarketData } from "@/hooks/useMarketData";
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
}

export default function BorrowableAssetRow({ token, formatBalance, onTransactionSuccess, refreshKey, borrowedAmount = 0 }: BorrowableAssetRowProps) {
  const { isConnected, address } = useAccount();
  const { wallets } = useWallets();
  const toast = useToast();
  
  // ✅ Fallback: nếu wagmi chưa sync thì lấy từ Privy
  const isWalletConnected = isConnected || wallets.length > 0;
  const walletAddress = address || wallets[0]?.address;
  
  const available = useAvailableToBorrow(token.tokenAddress, walletAddress, refreshKey);
  const marketData = useMarketData();
  const { healthFactor } = useUserBorrow();
  const collateralDetails = useCollateralDetails(walletAddress, refreshKey);
  
  // Lấy borrow rate từ market data
  const market = marketData.find(m => m.tokenAddress === token.tokenAddress);
  const borrowRate = market?.borrowRate || 0;
  
  
  const getTokenPrice = (tokenAddress: string) => {
    const market = marketData.find(m => m.tokenAddress === tokenAddress);
    return market?.price || 1.00;
  };

  const [showModal, setShowModal] = useState(false);
  const [amount, setAmount] = useState("");
  const [duration, setDuration] = useState("30"); // 30 days default
  const [usingPrivyFlow, setUsingPrivyFlow] = useState(false);
  const pendingToastRef = useRef<string | number | null>(null);

  const { writeContractAsync: requestLoan, data: borrowHash } = useWriteContract();

  // Wait for borrow transaction
  const { isLoading: isBorrowing, isSuccess: isBorrowSuccess } = useWaitForTransactionReceipt({
    hash: borrowHash,
  });

  // Auto-refresh and close modal on success (wagmi only)
  useEffect(() => {
    if (isBorrowSuccess && walletAddress && !usingPrivyFlow) {
      if (pendingToastRef.current !== null) {
        toast.dismiss(pendingToastRef.current);
        pendingToastRef.current = null;
      }
      // Show success toast
      toast.showTransactionSuccess(borrowHash || "", "Borrow Asset");
      
      // Wait for contract state to update before triggering refresh
      setTimeout(() => {
        if (onTransactionSuccess) {
          onTransactionSuccess();
        }
      }, 2000);
      
      setTimeout(() => {
        setShowModal(false);
        setAmount("");
        setDuration("30");
        setUsingPrivyFlow(false);
      }, 2500);
    }
  }, [isBorrowSuccess, walletAddress, usingPrivyFlow, onTransactionSuccess, borrowHash]);

  // Calculate projected health factor after borrowing
  const calculateProjectedHealthFactor = () => {
    if (!amount || !healthFactor.healthFactor) return null;
    
    // Amount is in token units, convert to USD
    const borrowAmount = parseFloat(amount);
    const tokenPrice = getTokenPrice(token.tokenAddress);
    const borrowAmountUSD = borrowAmount * tokenPrice;
    
    // Current health factor calculation: Total Collateral * LTV / Total Debt
    // After borrowing: Total Collateral * LTV / (Total Debt + New Borrow Amount)
    const currentHealthFactor = healthFactor.healthFactor;
    
    // Use data from useHealthFactor hook (unified logic)
    
    // If current health factor is very high (2196), it means debt is very low
    // Let's calculate based on the assumption that we have substantial collateral
    // and the current debt is minimal
    
    // Current debt = (Collateral * LTV) / Health Factor
    // If HF = 2196, and LTV = 75%, then Debt = Collateral * 0.75 / 2196
    // This means debt is very small compared to collateral
    
    // Lấy dữ liệu từ useCollateralDetails (đã có logic đúng)
    const collateralUSD = collateralDetails.totalCollateralValue || 0;
    const currentDebtUSD = collateralDetails.outstandingLoan || 0;
    
    const newDebtUSD = currentDebtUSD + borrowAmountUSD;
    const projectedHealthFactor = newDebtUSD > 0 ? (collateralUSD * 75) / (newDebtUSD * 100) : 999;
    
    return projectedHealthFactor;
  };

  const projectedHealthFactor = calculateProjectedHealthFactor();

  const handleBorrow = async () => {
    if (!isWalletConnected) {
      toast.showError("Please connect your wallet first");
      return;
    }

    if (!amount || !duration) return;

    // Only show loading toast when we start the actual transaction
    try {
      // Show loading toast when we start the actual transaction
      if (pendingToastRef.current !== null) {
        toast.dismiss(pendingToastRef.current);
      }
      pendingToastRef.current = toast.showTransactionPending("Borrow Asset");
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
                
                toast.showTransactionSuccess(txHash, "Borrow Asset");
                
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
            } catch (e) {}
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
          }
          
          if (attempts >= maxAttempts) {
            if (pendingToastRef.current !== null) {
              toast.dismiss(pendingToastRef.current);
              pendingToastRef.current = null;
            }
            setUsingPrivyFlow(false);
          }
        } catch (waitError) {
          console.error("Error waiting for borrow tx:", waitError);
          if (pendingToastRef.current !== null) {
            toast.dismiss(pendingToastRef.current);
            pendingToastRef.current = null;
          }
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

  return (
    <>
      <tr className="hover:bg-gray-750">
        {/* Asset */}
        <td className="px-6 py-3 whitespace-nowrap">
          <div className="flex items-center">
            <img 
              src={token.icon} 
              alt={token.symbol}
              className="w-8 h-8 mr-3 rounded-full"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <div>
              <div className="text-base" style={{color: 'var(--text-primary)'}}>{token.symbol}</div>
              <div className="text-xs" style={{color: 'var(--text-secondary)'}}>{token.name}</div>
            </div>
          </div>
        </td>

        {/* Available */}
        <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
          {available.isLoading ? "..." : (
            <div>
              <div>{formatBalance(available.available)}</div>
              <div className="text-xs" style={{color: 'var(--text-secondary)'}}>${(available.available * getTokenPrice(token.tokenAddress)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
          )}
        </td>

        {/* APY */}
        <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
          {market?.isLoading ? "..." : borrowRate > 0 ? `${borrowRate.toFixed(2)}%` : "N/A"}
        </td>

        {/* Actions */}
        <td className="px-6 py-3 whitespace-nowrap text-center">
          <button
            disabled={available.available === 0}
            onClick={() => setShowModal(true)}
            className={`
              px-3 py-1 text-base rounded transition-colors
              ${available.available > 0 
                ? 'text-white cursor-pointer' 
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }
            `}
            style={available.available > 0 ? {
              backgroundColor: 'var(--button-active)'
            } : {}}
            onMouseEnter={(e) => {
              if (available.available > 0) {
                e.currentTarget.style.backgroundColor = 'var(--button-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (available.available > 0) {
                e.currentTarget.style.backgroundColor = 'var(--button-active)';
              }
            }}
          >
            Borrow
          </button>
        </td>
      </tr>

      {/* Borrow Modal - Render using Portal to avoid hydration issues */}
      {showModal && createPortal(
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="rounded-lg p-6 w-[25.9rem] max-w-[25.9rem] mx-4 border border-gray-600" style={{backgroundColor: 'var(--background)'}}>
            <div className="flex justify-between items-center mb-4">
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
                className="text-gray-400 hover:text-white text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-sm" style={{color: 'var(--text-secondary)'}}>Amount</label>
                </div>
                
                <div className="relative bg-gray-700 rounded-lg p-3 border border-gray-600">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full text-2xl font-semibold text-white bg-transparent border-none outline-none placeholder-gray-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <img 
                        src={token.icon} 
                        alt={token.symbol}
                        className="w-8 h-8"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const nextElement = e.currentTarget.nextElementSibling as HTMLElement;
                          if (nextElement) {
                            nextElement.style.display = 'flex';
                          }
                        }}
                      />
                      <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center hidden">
                        <span className="text-xs font-bold text-gray-800">{token.symbol.charAt(0)}</span>
                      </div>
                      <span className="font-semibold text-gray-300">{token.symbol}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between mt-3">
                    <div className="text-xs text-gray-400">
                      ${(parseFloat(amount || "0") * getTokenPrice(token.tokenAddress)).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">
                        Available {available.available.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      </span>
                      <button
                        onClick={() => setAmount(available.available.toFixed(6))}
                        className="text-xs font-semibold text-gray-300 hover:text-white"
                      >
                        MAX
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Risk Information */}
              <h4 className="text-sm mb-1" style={{color: 'var(--text-secondary)'}}>Risk Information</h4>
              <div className="bg-gray-700 p-3 rounded-lg text-base border border-gray-600">
                <div className="flex justify-between mb-1">
                  <span className="text-gray-300">Borrowed:</span>
                  <span className="text-white">{borrowedAmount.toFixed(2)} {token.symbol}</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-300">Current Health factor:</span>
                  <span className="text-white">
                    {healthFactor.isLoading ? "..." : 
                     projectedHealthFactor ? 
                     `${healthFactor.healthFactor.toFixed(2)} > ` :
                     healthFactor.healthFactor.toFixed(2)}
                    {projectedHealthFactor && (
                      <span className={`${projectedHealthFactor >= 1.5 ? 'text-green-400' : projectedHealthFactor >= 1.1 ? 'text-orange-400' : 'text-red-400'}`}>
                        {projectedHealthFactor.toFixed(2)}
                      </span>
                    )}
                  </span>
                </div>
                <div className="text-right text-xs">
                  <span className="text-gray-300">Liquidation at: </span>
                  <span className="text-white">&lt;1.0</span>
                </div>
              </div>


              <div className="flex space-x-3">
                <button
                  onClick={handleBorrow}
                  disabled={!amount || isBorrowing || parseFloat(amount) > available.available}
                  className="w-full px-4 py-2 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors border border-gray-600 mt-8"
                  style={{backgroundColor: 'var(--button-active)'}}
                  onMouseEnter={(e) => {
                    if (!e.currentTarget.disabled) {
                      e.currentTarget.style.backgroundColor = 'var(--button-hover)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!e.currentTarget.disabled) {
                      e.currentTarget.style.backgroundColor = 'var(--button-active)';
                    }
                  }}
                >
                  {isBorrowing ? "Borrowing..." : `Borrow ${token.symbol}`}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
