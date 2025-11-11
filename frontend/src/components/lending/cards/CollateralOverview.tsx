"use client";

import { useWallets } from "@privy-io/react-auth";
import { useUserCollaterals, useWalletBalances } from "@/hooks/useCollateral";
import CollateralAssetRow from "../tables/CollateralAssetRow";

export default function CollateralOverview() {
  const { wallets } = useWallets();
  const userAddress = wallets[0]?.address;

  const { collaterals, isLoading: collateralsLoading } = useUserCollaterals(userAddress);
  const { balances, isLoading: balancesLoading } = useWalletBalances(userAddress);

  const isLoading = collateralsLoading || balancesLoading;

  try {

    const formatBalance = (amount: number) => {
      if (amount === 0) return "0";
      if (amount < 0.0001) return amount.toExponential(2);
      if (amount < 1) return amount.toFixed(4);
      if (amount < 1000) return amount.toFixed(2);
      return amount.toLocaleString();
    };

    return (
      <div className="space-y-6">
        {/* Your Collaterals Section */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-400 mb-4">Your collaterals</h3>
          
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
            <div className="space-y-3">
              {collaterals.map((collateral, index) => (
                <div key={index} className="flex justify-between items-center p-3 bg-gray-700 rounded">
                  <div className="flex items-center">
                    <img 
                      src={collateral.icon} 
                      alt={collateral.symbol}
                      className="w-6 h-6 mr-3 rounded-full"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                    <div>
                      <div className="font-medium">{collateral.symbol}</div>
                      <div className="text-sm text-gray-400">
                        {formatBalance(collateral.amount)} {collateral.symbol}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-300">Collateral</div>
                    <div className="text-xs text-gray-400">LTV: 75%</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Assets to Supply as Collateral Section */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-400 mb-4">Assets to supply as collateral</h3>
          
          <div className="space-y-2">
            {/* Header */}
            <div className="grid grid-cols-12 gap-2 text-xs text-gray-400 font-medium pb-2 border-b border-gray-700">
              <div className="col-span-4">Asset</div>
              <div className="col-span-3 text-right">Wallet Balance</div>
              <div className="col-span-3 text-right">LTV</div>
              <div className="col-span-2 text-center">Actions</div>
            </div>

            {/* Asset Rows */}
            {balances.map((asset, index) => (
              <CollateralAssetRow 
                key={index} 
                token={asset} 
                formatBalance={formatBalance}
              />
            ))}
          </div>
        </div>
      </div>
    );
  } catch (error) {
    console.error("❌ CollateralCard error:", error);
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
