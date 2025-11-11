"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useWriteContract, useAccount, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { parseUnits, encodeFunctionData, formatUnits } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { useMarketData } from "@/hooks/useMarketData";
import { useCollateralDetails, useCollateralValueByToken } from "@/hooks/useCollateral";
import { useInvalidateQueries } from "@/hooks/useInvalidateQueries";
import { useToast } from "@/hooks/useToast";
import { ARC_CHAIN_ID, getAddress } from "@/utils/addresses";

interface CollateralAssetRowProps {
  token: {
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
}

export default function CollateralAssetRow({ token, formatBalance, onTransactionSuccess }: CollateralAssetRowProps) {
  const [showModal, setShowModal] = useState(false);
  const [amount, setAmount] = useState("");
  const [isDepositing, setIsDepositing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const toast = useToast();
  
  const currentLoadingToastRef = useRef<string | number | null>(null);
  const successToastShownRef = useRef(false);

  const { isConnected, address, connector } = useAccount();
  const { wallets } = useWallets();
  
  // ✅ Fallback: nếu wagmi chưa sync thì lấy từ Privy
  const isWalletConnected = isConnected || wallets.length > 0;
  const walletAddress = address || wallets[0]?.address;
  
  const { writeContractAsync: depositCollateral, data: depositHash } = useWriteContract();
  const { writeContractAsync: approveToken, data: approveHash } = useWriteContract();
  const marketData = useMarketData();
  const collateralDetails = useCollateralDetails(walletAddress);
  const { valueUSD: tokenValueUSD, isLoading: valueLoading } = useCollateralValueByToken(walletAddress, token.tokenAddress);
  const { invalidateAllUserData } = useInvalidateQueries();
  
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
  
  const tokenInfo = getTokenInfo(token.tokenAddress);
  const depositedAmount = collateralBalance ? parseFloat(formatUnits(collateralBalance, tokenInfo.decimals)) : 0;

  // Calculate projected health factor after deposit
  const calculateProjectedHealthFactor = () => {
    if (!amount || !collateralDetails.healthFactor) return null;
    
    // Amount is in token units, convert to USD
    const depositAmount = parseFloat(amount);
    const tokenPrice = getTokenPrice(token.tokenAddress);
    const depositAmountUSD = depositAmount * tokenPrice;
    
    // Lấy dữ liệu từ useCollateralDetails (đã có logic đúng)
    const collateralUSD = collateralDetails.totalCollateralValue || 0;
    const currentDebtUSD = collateralDetails.outstandingLoan || 0;
    
    // Deposit increases collateral
    const newCollateralUSD = collateralUSD + depositAmountUSD;
    const projectedHealthFactor = currentDebtUSD > 0 ? (newCollateralUSD * 75) / (currentDebtUSD * 100) : 999;
    
    return projectedHealthFactor;
  };

  // Wait for transaction receipts
  const { isLoading: isApprovePending, isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({
    hash: approveHash,
  });

  const { isLoading: isDepositPending, isSuccess: isDepositSuccess } = useWaitForTransactionReceipt({
    hash: depositHash,
  });

  // Get token price from market data
  const getTokenPrice = (tokenAddress: string) => {
    const market = marketData.find(m => m.tokenAddress === tokenAddress);
    return market?.price || 1.00;
  };

  // Auto-proceed to deposit after approval success
  useEffect(() => {
    if (isApproveSuccess && isApproving && !successToastShownRef.current) {
      // Dismiss loading toast before showing success
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }
      
      successToastShownRef.current = true;
      toast.showTransactionSuccess(approveHash!, "Approve Token");
      setIsApproving(false);
      handleDepositAfterApproval();
    }
  }, [isApproveSuccess, isApproving, approveHash]);

  // Auto-close modal and refresh data after deposit success
  useEffect(() => {
    if (isDepositSuccess && walletAddress && !successToastShownRef.current) {
      // Dismiss loading toast before showing success
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }
      
      successToastShownRef.current = true;
      toast.showTransactionSuccess(depositHash!, "Deposit Collateral");
      invalidateAllUserData(walletAddress);
      setTimeout(() => {
        setShowModal(false);
        setAmount("");
        setIsDepositing(false);
      }, 1000);
    }
  }, [isDepositSuccess, walletAddress, depositHash]);

  const handleDepositAfterApproval = async () => {
    if (!amount) return;

    setIsDepositing(true);
    currentLoadingToastRef.current = toast.showTransactionPending("Deposit Collateral");
    successToastShownRef.current = false; // Reset flag for new transaction
    
    try {
      const tokenInfo = getTokenInfo(token.tokenAddress);
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
                successToastShownRef.current = true;
                toast.showTransactionSuccess(txHash, "Deposit Collateral");
                
                if (onTransactionSuccess) {
                  onTransactionSuccess();
                }
                
                setTimeout(() => {
                  setShowModal(false);
                  setAmount("");
                  setIsDepositing(false);
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

        setShowModal(false);
        setAmount("");
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
    } finally {
      if (isConnected) {
        setIsDepositing(false);
      }
    }
  };

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
      const tokenInfo = getTokenInfo(token.tokenAddress);
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
                toast.showTransactionSuccess(txHash, "Approve Token");
                
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

        {/* Wallet Balance */}
        <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
          <div>{token.isLoading ? "..." : formatBalance(token.balance)}</div>
          <div className="text-xs" style={{color: 'var(--text-secondary)'}}>
            ${(token.balance * getTokenPrice(token.tokenAddress)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </td>

        {/* LTV */}
        <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
          75%
        </td>

        {/* Actions */}
        <td className="px-3 py-3 whitespace-nowrap text-center">
          <button
            disabled={token.balance === 0}
            onClick={() => setShowModal(true)}
            className="px-3 py-1 text-base rounded transition-colors text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
            Deposit
          </button>
        </td>
      </tr>

      {/* Deposit Collateral Modal - Render using Portal to avoid hydration issues */}
      {showModal && createPortal(
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50">
          <div 
            className="rounded-lg p-6 w-[25.9rem] max-w-[25.9rem] mx-4 border border-gray-600"
            style={{backgroundColor: 'var(--background)'}}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white">
                Deposit {token.symbol} as Collateral
              </h3>
              <button
                onClick={() => {
                  setShowModal(false);
                  setAmount("");
                  setIsDepositing(false);
                  setIsApproving(false);
                }}
                className="text-gray-400 hover:text-white text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-6">
              {/* Amount Input */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-sm" style={{color: 'var(--text-secondary)'}}>Amount</label>
                </div>
                
                <div className="p-3 rounded-lg border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
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
                        }}
                      />
                      <span className="font-semibold text-gray-300">{token.symbol}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between mt-3">
                    <div className="text-xs text-gray-400">
                      ${(parseFloat(amount || "0") * getTokenPrice(token.tokenAddress)).toFixed(2)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">
                        Wallet balance: {formatBalance(token.balance)}
                      </span>
                      <button
                        onClick={() => setAmount(token.balance.toString())}
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
              <div className="p-3 rounded-lg text-base border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-300">Deposited:</span>
                  <span className="text-white">{depositedAmount.toFixed(2)} {token.symbol}</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-300">Current Health factor:</span>
                  <span className="text-white">
                    {collateralDetails.isLoading ? "..." : 
                     calculateProjectedHealthFactor() ? 
                     `${collateralDetails.healthFactor.toFixed(2)} > ` :
                     collateralDetails.healthFactor.toFixed(2)}
                    {calculateProjectedHealthFactor() && (
                      <span className={`${(calculateProjectedHealthFactor() ?? 0) >= 1.5 ? 'text-green-400' : (calculateProjectedHealthFactor() ?? 0) >= 1.1 ? 'text-orange-400' : 'text-red-400'}`}>
                        {calculateProjectedHealthFactor()?.toFixed(2)}
                      </span>
                    )}
                  </span>
                </div>
                <div className="text-right text-xs">
                  <span className="text-gray-300">Liquidation at: </span>
                  <span className="text-white">&lt;1.0</span>
                </div>
              </div>

              {/* Buttons */}
              <button
                onClick={handleDeposit}
                disabled={!amount || isDepositing || isApproving || isApprovePending || isDepositPending}
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
                {isApproving || isApprovePending ? "Approving..." : isDepositing || isDepositPending ? "Depositing..." : `Deposit ${token.symbol}`}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
