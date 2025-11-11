"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useReadContract } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { parseUnits, formatUnits, encodeFunctionData } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { useWithdrawAll } from "@/hooks/useUserSupply";
import { useMarketData } from "@/hooks/useMarketData";
import { useToast } from "@/hooks/useToast";
import { ARC_CHAIN_ID, getAddress } from "@/utils/addresses";

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
}

export default function SupplyManagementRow({ supply, walletBalance, formatBalance, onTransactionSuccess }: SupplyManagementRowProps) {
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
  
  // Hook để lấy market data (APY)
  const marketData = useMarketData();
  const market = marketData.find(m => m.tokenAddress === supply.tokenAddress);
  
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
                
                if (onTransactionSuccess) {
                  onTransactionSuccess();
                }
                
                setTimeout(() => handleClose(), 500);
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
            setIsSupplying(false);
          }
        } catch (waitError) {
          console.error("Error waiting for withdraw tx:", waitError);
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
            } catch (e) {}
            
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
          console.error("Error waiting for supply tx:", waitError);
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
            } catch (e) {}
            
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

                successToastShownRef.current = true;
                toast.showTransactionSuccess(txHash, "Withdraw All");

                setTimeout(() => {
                  if (onTransactionSuccess) {
                    onTransactionSuccess();
                  }
                }, 2000);

                setTimeout(() => handleClose(), 2500);
                break;
              }
            } catch (e) {}

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

  const handleClose = () => {
    setShowModal(false);
    setAmount("");
    setIsSupplying(false);
    setIsApproving(false);
    setIsApproved(false);
    setIsWithdrawAll(false);
    setUsingPrivyFlow(false);
    supplyCalledRef.current = false;
  };

  return (
    <>
      <button 
        onClick={() => {
          setAction('withdraw');
          setShowModal(true);
        }}
        className="px-3 py-1 text-base rounded transition-colors text-white cursor-pointer"
        style={{backgroundColor: 'var(--button-active)'}}
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
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="rounded-lg p-6 w-[25.9rem] max-w-[25.9rem] mx-4 border border-gray-600" style={{backgroundColor: 'var(--background)'}}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white">
                Manage {supply.symbol}
              </h3>
              <button
                onClick={handleClose}
                className="text-gray-400 hover:text-white text-xl font-bold"
              >
                ✕
              </button>
            </div>

            {/* Action Toggle */}
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setAction('supply')}
                className={`flex-1 py-2 px-4 rounded-lg text-base font-medium transition-colors border border-gray-600 ${
                  action === 'supply'
                    ? 'text-white'
                    : 'text-gray-300 hover:text-white'
                }`}
                style={action === 'supply' ? {backgroundColor: 'var(--button-active)'} : {}}
              >
                Supply
              </button>
              <button
                onClick={() => setAction('withdraw')}
                className={`flex-1 py-2 px-4 rounded-lg text-base font-medium transition-colors border border-gray-600 ${
                  action === 'withdraw'
                    ? 'text-white'
                    : 'text-gray-300 hover:text-white'
                }`}
                style={action === 'withdraw' ? {backgroundColor: 'var(--button-danger)'} : {}}
              >
                Withdraw
              </button>
            </div>


            <div className="space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-sm" style={{color: 'var(--text-secondary)'}}>Amount</label>
                </div>
                
                <div className="relative rounded-lg p-3 border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        disabled={action === 'withdraw' && isWithdrawAll}
                        className="w-full text-2xl font-semibold text-white bg-transparent border-none outline-none placeholder-gray-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <img 
                        src={supply.icon} 
                        alt={supply.symbol}
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
                        <span className="text-xs font-bold text-gray-800">{supply.symbol.charAt(0)}</span>
                      </div>
                      <span className="font-semibold text-gray-300">{supply.symbol}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between mt-3">
                    <div className="text-xs text-gray-400">
                      ${(parseFloat(amount || "0") * 1).toFixed(2)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">
                        {action === 'supply' 
                          ? `Wallet balance ${walletBalance.toFixed(2)}` 
                          : isWithdrawAll
                            ? `Will withdraw: ${(supply.amount + (supply.interestEarned || 0)).toFixed(2)} ${supply.symbol}`
                            : `Supply balance ${(supply.amount + (supply.interestEarned || 0)).toFixed(2)}`
                        }
                      </span>
                      {action === 'supply' ? (
                        <button
                          onClick={() => setAmount(walletBalance.toString())}
                          className="text-xs font-semibold text-gray-300 hover:text-white"
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
                            className="text-xs font-semibold text-gray-300 hover:text-white"
                          >
                            MAX
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Transaction Overview */}
              <h4 className="text-sm mb-1" style={{color: 'var(--text-secondary)'}}>Transaction overview</h4>
              <div className="p-3 rounded-lg text-base border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
                {action === 'supply' ? (
                  <>
                    <div className="flex justify-between mb-1">
                      <span className="text-gray-300">Supply APY:</span>
                      <span className="text-green-400">{market?.lendRate?.toFixed(2) || '0.00'}%</span>
                    </div>
                    <div className="flex justify-between mb-1">
                      <span className="text-gray-300">Supplied:</span>
                      <span className="text-white">{supply.amount?.toFixed(2) || '0.00'} {supply.symbol}</span>
                    </div>
                    {amount && parseFloat(amount) > 0 && (
                      <>
                        <div className="border-t border-gray-600 my-2"></div>
                        <div className="flex justify-between mb-1">
                          <span className="text-gray-300">Supply amount:</span>
                          <span className="text-green-400">{parseFloat(amount).toFixed(2)} {supply.symbol}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-300">Total after supply:</span>
                          <span className="text-white">{((supply.amount || 0) + parseFloat(amount)).toFixed(2)} {supply.symbol}</span>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex justify-between mb-1">
                      <span className="text-gray-300">Supplied:</span>
                      <span className="text-white">{supply.amount?.toFixed(2) || '0.00'} {supply.symbol}</span>
                    </div>
                    <div className="flex justify-between mb-1">
                      <span className="text-gray-300">Interest earned:</span>
                      <span className="text-white">{supply.interestEarned?.toFixed(5) || '0.00000'} {supply.symbol}</span>
                    </div>
                  </>
                )}
              </div>


              {action === 'supply' ? (
                <button
                  onClick={handleSupply}
                  disabled={!amount || isLoading || parseFloat(amount || "0") > walletBalance}
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
                  {isLoading ? "Supplying..." : `Supply ${supply.symbol}`}
                </button>
              ) : (
                <button
                  onClick={isWithdrawAll ? handleWithdrawAll : handleWithdraw}
                  disabled={
                    isWithdrawAll 
                      ? (supply.amount === 0 || isWithdrawAllPending || isWithdrawAllConfirming)
                      : (!amount || isLoading)
                  }
                  className="w-full px-4 py-2 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors border border-gray-600 mt-8"
                  style={{backgroundColor: 'var(--button-danger)'}}
                  onMouseEnter={(e) => {
                    if (!e.currentTarget.disabled) {
                      e.currentTarget.style.backgroundColor = 'var(--button-danger-hover)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!e.currentTarget.disabled) {
                      e.currentTarget.style.backgroundColor = 'var(--button-danger)';
                    }
                  }}
                >
                  {isWithdrawAll 
                    ? (isWithdrawAllPending ? "Confirming..." : isWithdrawAllConfirming ? "Withdrawing All..." : `Withdraw All ${supply.symbol}`)
                    : (isLoading ? "Withdrawing..." : `Withdraw ${supply.symbol}`)
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


