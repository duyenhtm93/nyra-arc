"use client";

import { useState, useEffect } from "react";
import { useHealthFactor, useLiquidation, useCollateralDetails } from "@/hooks/useCollateral";
import { useAllBorrowers } from "@/hooks/useUserBorrow";
import { useWallets } from "@privy-io/react-auth";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { useToast } from "@/hooks/useToast";
import { Addresses } from "@/abi/contracts";
import { ARC_CHAIN_ID, getAddress } from "@/utils/addresses";

type AddressKey = keyof typeof Addresses;

const REPAY_TOKEN_KEYS: AddressKey[] = ["USDC", "EURC", "BTC", "ETH", "BNB", "NYRA"];
const COLLATERAL_TOKEN_KEYS: AddressKey[] = ["BTC", "ETH", "BNB"];

// Component để filter và hiển thị chỉ accounts có HF < 1.2
function FilteredAccountHealthRow({ 
  address, 
  isCurrentUser, 
  onRemove, 
  onLiquidate 
}: { 
  address: string;
  isCurrentUser: boolean;
  onRemove: () => void;
  onLiquidate: (borrower: string) => void;
}) {
  const { healthFactor } = useCollateralDetails(address);
  
  // Chỉ render nếu HF < 1.2 và > 0 và < 999
  if (healthFactor >= 1.2 || healthFactor <= 0 || healthFactor >= 999) {
    return null;
  }

  return (
    <AccountHealthRow 
      address={address}
      isCurrentUser={isCurrentUser}
      onRemove={onRemove}
      onLiquidate={onLiquidate}
    />
  );
}

// Component để hiển thị Health Factor của một account
function AccountHealthRow({ 
  address, 
  isCurrentUser, 
  onRemove, 
  onLiquidate 
}: { 
  address: string;
  isCurrentUser: boolean;
  onRemove: () => void;
  onLiquidate: (borrower: string) => void;
}) {
  const { healthFactor, isLoading } = useCollateralDetails(address);

  // Determine status based on health factor
  const getStatus = () => {
    if (healthFactor === 0 || healthFactor >= 999) return 'safe';
    if (healthFactor < 1) return 'liquidatable';
    if (healthFactor < 1.2) return 'warning';
    return 'safe';
  };

  const status = getStatus();

  const getStatusDisplay = () => {
    if (status === 'safe') {
      return { color: 'text-green-400', icon: '🟢', label: 'Safe' };
    } else if (status === 'warning') {
      return { color: 'text-orange-400', icon: '🟠', label: 'Warning' };
    } else {
      return { color: 'text-red-400', icon: '🔴', label: 'Liquidatable' };
    }
  };

  const statusDisplay = getStatusDisplay();
  const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <div className={`bg-gray-700/50 p-2 rounded border ${
      status === 'liquidatable' 
        ? 'border-red-500/50' 
        : status === 'warning'
          ? 'border-orange-500/50'
          : 'border-gray-600'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-gray-300 font-mono">
              {shortAddress}
            </span>
            {isCurrentUser && (
              <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                You
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400">HF:</span>
              {isLoading ? (
                <span className="text-sm text-gray-400">...</span>
              ) : (
                <span className={`text-sm font-bold ${statusDisplay.color}`}>
                  {healthFactor.toFixed(2)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <span className={`text-xs ${statusDisplay.color}`}>
                {statusDisplay.icon} {statusDisplay.label}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {status === 'liquidatable' && (
            <button
              onClick={() => onLiquidate(address)}
              className="px-3 py-1 text-xs bg-red-500 hover:bg-red-600 text-white rounded transition-colors font-semibold"
            >
              💥 Liquidate
            </button>
          )}
          {!isCurrentUser && (
            <button
              onClick={onRemove}
              className="text-gray-400 hover:text-red-400 text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LiquidationAlert() {
  const { address } = useAccount();
  const { wallets } = useWallets();
  const userAddress = address || wallets[0]?.address;

  // Auto load borrowers from contract
  const { borrowers: contractBorrowers, isLoading: borrowersLoading, refetch: refetchBorrowers } = useAllBorrowers();
  const [manualAddresses, setManualAddresses] = useState<string[]>([]);
  const [newAddress, setNewAddress] = useState("");
  
  // Combine contract borrowers + manual addresses
  const monitoredAddresses = [...new Set([...contractBorrowers, ...manualAddresses])];
  
  const { liquidate, isPending: isLiquidating, hash: liquidationHash } = useLiquidation();
  const { writeContractAsync: approveToken } = useWriteContract();
  const toast = useToast();

  const [showLiquidateModal, setShowLiquidateModal] = useState(false);
  const [borrowerAddress, setBorrowerAddress] = useState("");
  const [repayAmount, setRepayAmount] = useState("");
  const [repayToken, setRepayToken] = useState<string>(getAddress("USDC"));
  const [collateralToken, setCollateralToken] = useState<string>(getAddress("BTC"));
  const [isApproving, setIsApproving] = useState(false);

  // Auto add current user to manual list if not in contract borrowers
  useEffect(() => {
    if (userAddress && !contractBorrowers.includes(userAddress as `0x${string}`) && !manualAddresses.includes(userAddress)) {
      setManualAddresses([userAddress]);
    }
  }, [userAddress, contractBorrowers]);

  // Wait for liquidation transaction
  const { isLoading: isLiquidationConfirming, isSuccess: isLiquidationSuccess } = useWaitForTransactionReceipt({
    hash: liquidationHash,
  });

  // Auto close modal on success
  useEffect(() => {
    if (isLiquidationSuccess && showLiquidateModal) {
      setShowLiquidateModal(false);
      setBorrowerAddress("");
      setRepayAmount("");
    }
  }, [isLiquidationSuccess]);

  const handleAddAddress = () => {
    if (!newAddress) return;
    if (monitoredAddresses.includes(newAddress)) {
      alert("Address already monitored");
      return;
    }
    setManualAddresses([...manualAddresses, newAddress]);
    setNewAddress("");
  };

  const handleRemoveAddress = (addressToRemove: string) => {
    // Chỉ cho phép remove manual addresses, không remove contract borrowers
    if (contractBorrowers.includes(addressToRemove as `0x${string}`)) {
      alert("Cannot remove contract borrowers. They are automatically tracked.");
      return;
    }
    setManualAddresses(manualAddresses.filter(addr => addr !== addressToRemove));
  };

  const handleLiquidate = async () => {
    if (!borrowerAddress || !repayAmount) {
      toast.showError("Please fill in all fields");
      return;
    }

    const loadingToast = toast.showTransactionPending("Liquidation");
    
    try {
      // Step 1: Approve repay token
      setIsApproving(true);
      const repayTokenInfo = getTokenInfo(repayToken);
      const amountWei = parseUnits(repayAmount, repayTokenInfo.decimals);

      await approveToken({
        address: repayToken as `0x${string}`,
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

      setIsApproving(false);

      // Step 2: Call liquidate
      await liquidate(borrowerAddress, repayToken, repayAmount, collateralToken);

      if (loadingToast !== null) {
        toast.dismiss(loadingToast);
      }
      toast.showTransactionSuccess(liquidationHash || "", "Liquidation");

    } catch (error: unknown) {
      console.error("❌ Liquidation failed:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (loadingToast !== null) {
        toast.dismiss(loadingToast);
      }
      toast.showTransactionError(errorMessage, "Liquidation");
      setIsApproving(false);
    }
  };

  return (
    <>
      <div className="rounded-lg border border-gray-600 p-6" style={{backgroundColor: 'var(--background-secondary)'}}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-white">🔍 Liquidation Monitor</h3>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => refetchBorrowers()}
              disabled={borrowersLoading}
              className="px-3 py-1 text-sm bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 text-white rounded transition-colors"
            >
              🔄 {borrowersLoading ? "..." : "Refresh"}
            </button>
            <button
              onClick={() => setShowLiquidateModal(true)}
              className="px-3 py-1 text-sm bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
            >
              💥 Liquidate
            </button>
          </div>
        </div>

        {/* Add Address Input */}
        <div className="mb-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="Add address to monitor (0x...)"
              className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
            />
            <button
              onClick={handleAddAddress}
              disabled={!newAddress}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors text-sm"
            >
              + Add
            </button>
          </div>
        </div>

        {/* Monitored Accounts List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-300">Monitored Accounts:</h4>
            <div className="text-xs text-gray-400 flex items-center gap-3">
              <span className="text-green-400">🟢 ≥1.2 Safe</span>
              <span className="text-orange-400">🟠 1.0-1.2 Warning</span>
              <span className="text-red-400">🔴 &lt;1.0 Liquidatable</span>
            </div>
          </div>
          {borrowersLoading ? (
            <div className="text-xs text-gray-400 text-center py-4">
              Loading borrowers...
            </div>
          ) : monitoredAddresses.length === 0 ? (
            <div className="text-xs text-gray-400 text-center py-4">
              No accounts monitored yet. Add addresses above.
            </div>
          ) : (
            <div className="space-y-2">
              {monitoredAddresses.map((addr) => (
                <FilteredAccountHealthRow 
                  key={addr}
                  address={addr}
                  isCurrentUser={addr === userAddress}
                  onRemove={() => handleRemoveAddress(addr)}
                  onLiquidate={(borrower) => {
                    setBorrowerAddress(borrower);
                    setShowLiquidateModal(true);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Liquidation Modal */}
      {showLiquidateModal && (
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="rounded-lg p-6 w-[28.8rem] max-w-[28.8rem] mx-4 border border-gray-600" style={{backgroundColor: 'var(--background)'}}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white">
                Liquidate Account
              </h3>
              <button
                onClick={() => {
                  setShowLiquidateModal(false);
                  setBorrowerAddress("");
                  setRepayAmount("");
                }}
                className="text-gray-400 hover:text-white text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* Borrower Address */}
              <div>
                <label className="text-sm text-gray-300 mb-2 block">Borrower Address</label>
                <input
                  type="text"
                  value={borrowerAddress}
                  onChange={(e) => setBorrowerAddress(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                />
              </div>

              {/* Repay Token */}
              <div>
                <label className="text-sm text-gray-300 mb-2 block">Repay Token</label>
                <select
                  value={repayToken}
                  onChange={(e) => setRepayToken(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-orange-500"
                >
                  {REPAY_TOKEN_KEYS.map((key) => {
                    const address = getAddress(key);
                    const info = getTokenInfo(address);
                    return (
                      <option key={key} value={address}>
                        {info.symbol}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Repay Amount */}
              <div>
                <label className="text-sm text-gray-300 mb-2 block">Repay Amount</label>
                <input
                  type="number"
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>

              {/* Collateral Token */}
              <div>
                <label className="text-sm text-gray-300 mb-2 block">Collateral Token to Seize</label>
                <select
                  value={collateralToken}
                  onChange={(e) => setCollateralToken(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-orange-500"
                >
                  {COLLATERAL_TOKEN_KEYS.map((key) => {
                    const address = getAddress(key);
                    const info = getTokenInfo(address);
                    return (
                      <option key={key} value={address}>
                        {info.symbol}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Info Box */}
              <div className="bg-orange-500/10 border border-orange-500/30 p-3 rounded">
                <p className="text-xs text-orange-400">
                  💡 You will repay the borrower&apos;s debt and receive their collateral + 5% bonus.
                  Make sure to approve the repay token first!
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleLiquidate}
                  disabled={!borrowerAddress || !repayAmount || isApproving || isLiquidating || isLiquidationConfirming}
                  className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors border border-gray-600 font-semibold"
                >
                  {isApproving 
                    ? "Approving..." 
                    : isLiquidating 
                      ? "Confirming..." 
                      : isLiquidationConfirming 
                        ? "Liquidating..." 
                        : "💥 Liquidate Now"
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

