"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useMarketData } from "@/hooks/useMarketData";
import { useWriteContract, useAccount, useWaitForTransactionReceipt } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { parseUnits, encodeFunctionData } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { useToast } from "@/hooks/useToast";
import { ARC_CHAIN_ID, getAddress } from "@/utils/addresses";

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
}

export default function SupplyableAssetRow({ asset, formatBalance, onTransactionSuccess, currentSupplied = 0 }: SupplyableAssetRowProps) {
  const marketData = useMarketData();
  const toast = useToast();
  
  // Lấy rates và LTV từ market data
  const market = marketData.find(m => m.tokenAddress === asset.tokenAddress);
  const supplyRate = market?.lendRate || 0;
  const ltv = market?.ltv || 0;
  
  
  const getTokenPrice = (tokenAddress: string) => {
    const market = marketData.find(m => m.tokenAddress === tokenAddress);
    return market?.price || 1.00;
  };

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
      
      setTimeout(() => {
        if (onTransactionSuccess) {
          onTransactionSuccess();
        }
      }, 2000);
      
      setTimeout(() => {
        setShowModal(false);
        setAmount("");
        supplyCalledRef.current = false;
      }, 2500);
    }
  }, [isSupplySuccess, walletAddress, usingPrivyFlow, onTransactionSuccess, supplyHash]);

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
                
                toast.showTransactionSuccess(txHash, "Supply Asset");
                
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
            } catch (e) {}
            
            await new Promise(resolve => setTimeout(resolve, 1000));
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
          console.error("Error waiting for supply tx:", waitError);
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
            } catch (e) {}
            
            await new Promise(resolve => setTimeout(resolve, 1000));
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
          console.error("Error waiting for approve tx:", waitError);
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

  return (
    <tr className="hover:bg-gray-750">
      {/* Asset */}
      <td className="px-6 py-3 whitespace-nowrap">
        <div className="flex items-center">
          <img 
            src={asset.icon} 
            alt={asset.symbol}
            className="w-8 h-8 mr-3 rounded-full"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <div>
            <div className="text-base" style={{color: 'var(--text-primary)'}}>{asset.symbol}</div>
            <div className="text-xs" style={{color: 'var(--text-secondary)'}}>{asset.name}</div>
          </div>
        </div>
      </td>

      {/* Wallet Balance */}
      <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
        {asset.isLoading ? "..." : (
          <div>
            <div>{formatBalance(asset.balance)}</div>
            <div className="text-xs" style={{color: 'var(--text-secondary)'}}>${(asset.balance * getTokenPrice(asset.tokenAddress)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
        )}
      </td>

      {/* APY */}
      <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
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
              ? 'text-white cursor-pointer' 
              : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }
          `}
          style={asset.balance > 0 ? {
            backgroundColor: 'var(--button-active)'
          } : {}}
          onMouseEnter={(e) => {
            if (asset.balance > 0) {
              e.currentTarget.style.backgroundColor = 'var(--button-hover)';
            }
          }}
          onMouseLeave={(e) => {
            if (asset.balance > 0) {
              e.currentTarget.style.backgroundColor = 'var(--button-active)';
            }
          }}
        >
          Supply
        </button>
      </td>

      {/* Supply/Withdraw Modal - Render using Portal to avoid hydration issues */}
      {showModal && createPortal(
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="rounded-lg p-6 w-[28.8rem] max-w-[28.8rem] mx-4 border border-gray-600" style={{backgroundColor: 'var(--background)'}}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white">
                Manage {asset.symbol}
              </h3>
              <button
                onClick={() => {
                  setShowModal(false);
                  setAmount("");
                  setUsingPrivyFlow(false);
                  supplyCalledRef.current = false;
                }}
                className="text-gray-400 hover:text-white text-xl font-bold"
              >
                ✕
              </button>
            </div>

            {/* No action toggle needed - only Supply available */}
            
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
                        src={asset.icon} 
                        alt={asset.symbol}
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
                        <span className="text-xs font-bold text-gray-800">{asset.symbol.charAt(0)}</span>
                      </div>
                      <span className="font-semibold text-gray-300">{asset.symbol}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between mt-3">
                    <div className="text-xs text-gray-400">
                      ${(parseFloat(amount || "0") * 1).toFixed(2)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">
                        Wallet balance ${formatBalanceFixed(asset.balance)}
                      </span>
                      <button
                        onClick={() => setAmount(asset.balance.toString())}
                        className="text-xs font-semibold text-gray-300 hover:text-white"
                      >
                        MAX
                      </button>
                    </div>
                  </div>
                </div>
              </div>


              {/* Transaction Overview */}
              <h4 className="text-sm mb-1" style={{color: 'var(--text-secondary)'}}>Transaction overview</h4>
              <div className="bg-gray-700 p-3 rounded-lg text-base border border-gray-600">
                <div className="flex justify-between mb-1">
                  <span className="text-gray-300">Supply APY:</span>
                  <span className="text-green-400 font-semibold">{market?.lendRate?.toFixed(2) || '0.00'}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Supplied:</span>
                  <span className="text-white">{currentSupplied.toFixed(2)} {asset.symbol}</span>
                </div>
              </div>

              <button
                onClick={handleSupply}
                disabled={!amount || isApprovePending || isSupplyPending || parseFloat(amount || "0") > asset.balance}
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
                {isApprovePending ? "Approving..." : isSupplyPending ? "Supplying..." : `Supply ${asset.symbol}`}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </tr>
  );
}
