"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import Image from "next/image";
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

  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { address } = useAccount();

  const userAddress = useMemo(() => (ready && authenticated) ? (address || wallets[0]?.address) : undefined, [ready, authenticated, address, wallets]);

  const marketData = useMarketData();

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

  useEffect(() => {
    if (ready && authenticated && userAddress && refreshKey === 0) {
      const timer = setTimeout(() => {
        setRefreshKey(prev => prev + 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [ready, authenticated, userAddress, refreshKey]);

  const formatBalance = useCallback((amount: number) => {
    if (amount === 0) return "0";
    if (amount < 0.0001) return amount.toExponential(2);
    if (amount < 1) return amount.toFixed(4);
    if (amount < 1000) return amount.toFixed(2);
    return amount.toLocaleString();
  }, []);

  const formatUSD = useCallback((amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }, []);

  const getTokenPrice = useCallback((tokenAddress: string) => {
    const market = marketData.find(m => m.tokenAddress === tokenAddress);
    return market?.price || 1.00;
  }, [marketData]);

  try {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        {/* Collateral Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="premium-card rounded-lg p-6 shadow-xl">
            <div className="text-2xl font-semibold mb-1 text-center" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-headline)' }}>
              {isLoading ? (
                <div className="h-8 w-24 bg-gray-700/50 rounded animate-pulse mx-auto" />
              ) : formatUSD(totalCollateralValue)}
            </div>
            <div className="text-xs text-center font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Total Collateral</div>
          </div>

          <div className="premium-card rounded-lg p-6 shadow-xl">
            <div className="text-2xl font-semibold mb-1 text-center" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-headline)' }}>
              {isLoading ? (
                <div className="h-8 w-24 bg-gray-700/50 rounded animate-pulse mx-auto" />
              ) : formatUSD(outstandingLoan)}
            </div>
            <div className="text-xs text-center font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Outstanding Loan</div>
          </div>

          <div className="premium-card rounded-lg p-6 shadow-xl">
            <div className="text-2xl font-semibold mb-1 text-center" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-headline)' }}>
              {isLoading ? (
                <div className="h-8 w-24 bg-gray-700/50 rounded animate-pulse mx-auto" />
              ) : formatUSD(availableToBorrow)}
            </div>
            <div className="text-xs text-center font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Available to Borrow</div>
          </div>

          <div className="premium-card rounded-lg p-6 shadow-xl">
            <div className="text-2xl font-semibold mb-1 text-center" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-headline)' }}>
              {isLoading ? (
                <div className="h-8 w-24 bg-gray-700/50 rounded animate-pulse mx-auto" />
              ) : healthFactor.toFixed(2)}
            </div>
            <div className="text-xs text-center font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Health Factor</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div className="rounded-lg overflow-hidden border border-gray-600" style={{ backgroundColor: 'var(--background-secondary)' }}>
              <div className="px-6 py-5 border-b border-gray-700/50 bg-gray-800/20">
                <h3 className="text-lg font-semibold text-white uppercase tracking-tight" style={{ fontFamily: 'var(--font-headline)' }}>Your collaterals</h3>
              </div>

              {isLoading ? (
                <div className="p-6">
                  <div className="animate-pulse space-y-4">
                    <div className="h-4 bg-gray-700 rounded w-3/4"></div>
                    <div className="h-4 bg-gray-700 rounded w-1/2"></div>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-white/5 border-b border-gray-700/50">
                      <tr>
                        <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400" style={{ fontFamily: 'var(--font-headline)' }}>Asset</th>
                        <th className="px-6 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-400" style={{ fontFamily: 'var(--font-headline)' }}>Amount</th>
                        <th className="px-6 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-400" style={{ fontFamily: 'var(--font-headline)' }}>LTV</th>
                        <th className="px-6 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-400" style={{ fontFamily: 'var(--font-headline)' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-600" style={{ backgroundColor: 'var(--background-secondary)' }}>
                      {collaterals.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="text-gray-400 text-center py-10 italic">
                            No collateral deposited yet
                          </td>
                        </tr>
                      ) : (
                        collaterals.map((collateral, index) => (
                          <tr key={`${collateral.tokenAddress}-${index}`}>
                            <td className="px-6 py-3 whitespace-nowrap">
                              <div className="flex items-center">
                                <div className="relative w-8 h-8 mr-3">
                                  <Image
                                    src={collateral.icon}
                                    alt={collateral.symbol}
                                    fill
                                    className="rounded-full object-contain"
                                  />
                                </div>
                                <div>
                                  <div className="text-base" style={{ color: 'var(--text-primary)' }}>{collateral.symbol}</div>
                                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{collateral.name}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{ color: 'var(--text-primary)' }}>
                              <div>{formatBalance(collateral.amount)}</div>
                              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>${(collateral.amount * getTokenPrice(collateral.tokenAddress)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                            </td>
                            <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{ color: 'var(--text-primary)' }}>
                              75%
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap text-center">
                              <button
                                onClick={() => {
                                  setSelectedCollateral(collateral);
                                  setShowManageModal(true);
                                }}
                                className="px-3 py-1 text-base rounded transition-colors text-white cursor-pointer bg-blue-600 hover:bg-blue-700 active:scale-95"
                                style={{ backgroundColor: 'var(--button-active)' }}
                              >
                                Manage
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <LiquidationAlert />
          </div>

          <div className="space-y-6">
            <div className="rounded-lg overflow-hidden border border-gray-600" style={{ backgroundColor: 'var(--background-secondary)' }}>
              <div className="px-6 py-5 border-b border-gray-700/50 bg-gray-800/20">
                <h3 className="text-lg font-semibold text-white uppercase tracking-tight" style={{ fontFamily: 'var(--font-headline)' }}>Assets to supply as collateral</h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-white/5 border-b border-gray-700/50">
                    <tr>
                      <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400" style={{ fontFamily: 'var(--font-headline)' }}>Asset</th>
                      <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right" style={{ fontFamily: 'var(--font-headline)' }}>Amount</th>
                      <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right" style={{ fontFamily: 'var(--font-headline)' }}>LTV</th>
                      <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-center" style={{ fontFamily: 'var(--font-headline)' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-600" style={{ backgroundColor: 'var(--background-secondary)' }}>
                    {balances.map((asset, index) => (
                      <CollateralAssetRow
                        key={`${asset.tokenAddress}-${index}`}
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
      <div className="bg-red-800/20 border border-red-600 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-red-400 mb-4">Error loading collateral</h3>
        <div className="text-red-300">
          {error instanceof Error ? error.message : "Unknown error"}
        </div>
      </div>
    );
  }
}

