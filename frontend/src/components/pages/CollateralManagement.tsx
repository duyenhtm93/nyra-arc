"use client";

import { useState, useCallback, useEffect } from "react";
import { useWallets, usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { useUserCollaterals, useWalletBalances, useCollateralDetails } from "@/hooks/useCollateral";
import { useMarketData } from "@/hooks/useMarketData";
import CollateralAssetRow from "../lending/tables/CollateralAssetRow";
import CollateralManagementModal from "../lending/modals/CollateralManagementModal";
import LiquidationAlert from "../lending/cards/LiquidationAlert";

export default function CollateralManagement() {
  
  const [showManageModal, setShowManageModal] = useState(false);
  const [selectedCollateral, setSelectedCollateral] = useState<{
    tokenAddress: string;
    symbol: string;
    icon: string;
    name: string;
    amount: number;
    ltv?: number;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Callback to refresh data after successful transaction
  const handleTransactionSuccess = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);
  
  // All hooks must be called at top level (outside try-catch)
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { address } = useAccount();
  
  // ✅ Đợi Privy ready và lấy address từ cả 2 sources
  const userAddress = (ready && authenticated) ? (address || wallets[0]?.address) : undefined;
  
  const marketData = useMarketData();

  // Conditional hooks based on userAddress
  const { collaterals, isLoading: collateralsLoading } = useUserCollaterals(userAddress, refreshKey);
  const { balances, isLoading: balancesLoading } = useWalletBalances(userAddress, refreshKey);
  
  const { 
    totalCollateralValue, 
    healthFactor, 
    outstandingLoan, 
    availableToBorrow,
    isLoading: detailsLoading 
  } = useCollateralDetails(userAddress, refreshKey);

  const isLoading = collateralsLoading || balancesLoading || detailsLoading;

  // Auto-refresh when wallet address ready after reload
  useEffect(() => {
    if (ready && authenticated && userAddress && refreshKey === 0) {
      setTimeout(() => {
        setRefreshKey(prev => prev + 1);
      }, 1000);
    }
  }, [ready, authenticated, userAddress]);

  const formatBalance = (amount: number) => {
    if (amount === 0) return "0";
    if (amount < 0.0001) return amount.toExponential(2);
    if (amount < 1) return amount.toFixed(4);
    if (amount < 1000) return amount.toFixed(2);
    return amount.toLocaleString();
  };

  const formatUSD = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  // Get token price from market data
  const getTokenPrice = (tokenAddress: string) => {
    const market = marketData.find(m => m.tokenAddress === tokenAddress);
    return market?.price || 1.00;
  };

  try {

    return (
      <div className="space-y-6">
        {/* Collateral Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Total Collateral Value */}
          <div className="rounded-lg overflow-hidden border border-gray-600 p-6" style={{backgroundColor: 'var(--background-secondary)'}}>
            <div className="text-2xl font-bold mb-1 text-center" style={{color: 'var(--text-primary)'}}>
              {isLoading ? "..." : formatUSD(totalCollateralValue)}
            </div>
            <div className="text-sm text-center" style={{color: 'var(--text-secondary)'}}>Total Collateral</div>
          </div>

          {/* Outstanding Loan */}
          <div className="rounded-lg overflow-hidden border border-gray-600 p-6" style={{backgroundColor: 'var(--background-secondary)'}}>
            <div className="text-2xl font-bold mb-1 text-center" style={{color: 'var(--text-primary)'}}>
              {isLoading ? "..." : formatUSD(outstandingLoan)}
            </div>
            <div className="text-sm text-center" style={{color: 'var(--text-secondary)'}}>Outstanding Loan</div>
          </div>

          {/* Available to Borrow */}
          <div className="rounded-lg overflow-hidden border border-gray-600 p-6" style={{backgroundColor: 'var(--background-secondary)'}}>
            <div className="text-2xl font-bold mb-1 text-center" style={{color: 'var(--text-primary)'}}>
              {isLoading ? "..." : formatUSD(availableToBorrow)}
            </div>
            <div className="text-sm text-center" style={{color: 'var(--text-secondary)'}}>Available to Borrow</div>
          </div>

          {/* Health Factor */}
          <div className="rounded-lg overflow-hidden border border-gray-600 p-6" style={{backgroundColor: 'var(--background-secondary)'}}>
            <div className="text-2xl font-bold mb-1 text-center" style={{color: 'var(--text-primary)'}}>
              {isLoading ? "..." : healthFactor.toFixed(2)}
            </div>
            <div className="text-sm text-center" style={{color: 'var(--text-secondary)'}}>Health Factor</div>
          </div>
        </div>

        {/* 2x2 Grid Layout - 2 separate cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Your Collaterals */}
          <div className="space-y-6">
            <div className="rounded-lg overflow-hidden border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
              <div className="px-6 py-4 border-b border-gray-700">
                <h3 className="text-lg font-semibold" style={{color: 'var(--text-primary)'}}>Your collaterals</h3>
              </div>
          
              {isLoading ? (
                <div className="animate-pulse">
                  <div className="h-4 bg-gray-700 rounded w-3/4 mb-2"></div>
                  <div className="h-4 bg-gray-700 rounded w-1/2"></div>
                </div>
              ) : collaterals.length === 0 ? (
                <div className="text-gray-400 text-center py-8">
                  No collateral deposited yet
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-700">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Asset</th>
                        <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Amount</th>
                        <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>LTV</th>
                        <th className="px-6 py-3 text-center text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
                      {collaterals.map((collateral, index) => (
                        <tr key={index} className="hover:bg-gray-750">
                          <td className="px-6 py-3 whitespace-nowrap">
                            <div className="flex items-center">
                              <img 
                                src={collateral.icon} 
                                alt={collateral.symbol}
                                className="w-8 h-8 mr-3 rounded-full"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                              <div>
                                <div className="text-base" style={{color: 'var(--text-primary)'}}>{collateral.symbol}</div>
                                <div className="text-xs" style={{color: 'var(--text-secondary)'}}>{collateral.name}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
                            <div>{formatBalance(collateral.amount)}</div>
                            <div className="text-xs" style={{color: 'var(--text-secondary)'}}>${(collateral.amount * getTokenPrice(collateral.tokenAddress)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                          </td>
                          <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
                            75%
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-center">
                            <button 
                              onClick={() => {
                                setSelectedCollateral(collateral);
                                setShowManageModal(true);
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
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Liquidation Monitor below Your collaterals */}
            <LiquidationAlert />
          </div>

          {/* Right Column - Assets to Supply as Collateral */}
          <div className="space-y-6">
            <div className="rounded-lg overflow-hidden border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
              <div className="px-6 py-4 border-b border-gray-700">
                <h3 className="text-lg font-semibold" style={{color: 'var(--text-primary)'}}>Assets to supply as collateral</h3>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-700">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Asset</th>
                      <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Wallet balance</th>
                      <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>LTV</th>
                      <th className="px-6 py-3 text-center text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
                    {balances.map((asset, index) => (
                      <CollateralAssetRow 
                        key={index} 
                        token={asset} 
                        formatBalance={formatBalance}
                        onTransactionSuccess={handleTransactionSuccess}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Collateral Manage Modal */}
        {selectedCollateral && (
          <CollateralManagementModal
            isOpen={showManageModal}
            onClose={() => {
              setShowManageModal(false);
              setSelectedCollateral(null);
            }}
            collateral={{
              tokenAddress: selectedCollateral.tokenAddress,
              symbol: selectedCollateral.symbol,
              icon: selectedCollateral.icon,
              name: selectedCollateral.name,
              amount: selectedCollateral.amount,
              ltv: selectedCollateral.ltv
            }}
            formatBalance={formatBalance}
            onTransactionSuccess={handleTransactionSuccess}
          />
        )}
      </div>
    );
  } catch (error) {
    console.error("❌ CollateralTab error:", error);
    return (
      <div className="bg-red-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-red-400 mb-4">Error loading collateral</h3>
        <div className="text-red-300">
          {error instanceof Error ? error.message : "Unknown error"}
        </div>
      </div>
    );
  }
}
