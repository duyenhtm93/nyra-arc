"use client";

import { useState, useCallback } from "react";
import { useUserSupply, useSupplyRates } from "@/hooks/useUserSupply";
import { useMarketData } from "@/hooks/useMarketData";
import SupplyableAssetRow from "../tables/SupplyableAssetRow";
import SupplyManagementRow from "../tables/SupplyManagementRow";

// Component để hiển thị APY cho mỗi supply
function SupplyAPYCell({ tokenAddress }: { tokenAddress: string }) {
  const { lendRate, isLoading } = useSupplyRates(tokenAddress);
  
  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-600 rounded w-12 ml-auto"></div>
      </div>
    );
  }
  
  return (
    <div className="text-right">{lendRate.toFixed(2)}%</div>
  );
}

export default function SupplyOverview() {
  const [refreshKey, setRefreshKey] = useState(0);
  
  const { userSupplies, walletBalances, isLoading } = useUserSupply(refreshKey);
  const marketData = useMarketData();

  // Callback to refresh data after successful transaction
  const handleTransactionSuccess = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  // Filter assets based on zero balance toggle
  const filteredBalances = walletBalances;

  const formatBalance = (amount: number) => {
    if (amount === 0) return "0.00";
    return amount.toFixed(2);
  };

  // Get token price from market data
  const getTokenPrice = (tokenAddress: string) => {
    const market = marketData.find(m => m.tokenAddress === tokenAddress);
    return market?.price || 1.00;
  };

  return (
    <div className="space-y-6">
      {/* Your Supplies Section */}
      <div className="rounded-lg overflow-hidden border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
        <div className="px-6 py-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold" style={{color: 'var(--text-primary)'}}>Your supplies</h3>
        </div>
        
        {isLoading ? (
          <div className="animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-3/4 mb-2"></div>
            <div className="h-4 bg-gray-700 rounded w-1/2"></div>
          </div>
        ) : userSupplies.supplies.length === 0 ? (
          <div className="text-gray-400 text-center py-8">
            Nothing supplied yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Asset</th>
                  <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Amount</th>
                  <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Interest</th>
                  <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>APY</th>
                  <th className="px-6 py-3 text-center text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
                {userSupplies.supplies.map((supply, index) => {
                  if (!supply) return null;
                  return (
                    <tr key={index} className="hover:bg-gray-750">
                      <td className="px-6 py-3 whitespace-nowrap">
                        <div className="flex items-center">
                          <img 
                            src={supply.icon} 
                            alt={supply.symbol}
                            className="w-8 h-8 mr-3 rounded-full"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                          <div>
                            <div className="text-base text-white">{supply.symbol}</div>
                            <div className="text-xs text-gray-400">{supply.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
                        <div>{formatBalance(supply.amount + supply.interestEarned)}</div>
                        <div className="text-xs" style={{color: 'var(--text-secondary)'}}>${((supply.amount + supply.interestEarned) * getTokenPrice(supply.tokenAddress)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
                        <div style={{color: 'var(--text-primary)'}}>{formatBalance(supply.interestEarned)}</div>
                        <div className="text-xs" style={{color: 'var(--text-secondary)'}}>${(supply.interestEarned * getTokenPrice(supply.tokenAddress)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
                        <SupplyAPYCell tokenAddress={supply.tokenAddress} />
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-center">
                        <SupplyManagementRow 
                          supply={supply} 
                          walletBalance={walletBalances.find(w => w.tokenAddress === supply.tokenAddress)?.balance || 0}
                          formatBalance={formatBalance}
                          onTransactionSuccess={handleTransactionSuccess}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Assets to Supply Section */}
      <div className="rounded-lg overflow-hidden border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
        <div className="px-6 py-4 border-b border-gray-700">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold" style={{color: 'var(--text-primary)'}}>Assets to supply</h3>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Assets</th>
                <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Wallet balance</th>
                <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>APY</th>
                <th className="px-6 py-3 text-center text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
              {filteredBalances.map((asset) => {
                // Find existing supply for this asset
                const existingSupply = userSupplies.supplies.find(s => s.tokenAddress === asset.tokenAddress);
                return (
                  <SupplyableAssetRow 
                    key={asset.tokenAddress} 
                    asset={asset} 
                    formatBalance={formatBalance}
                    onTransactionSuccess={handleTransactionSuccess}
                    currentSupplied={existingSupply?.amount || 0}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredBalances.length === 0 && (
          <div className="text-center py-4 text-gray-400 text-sm">
            No assets available to supply
          </div>
        )}
      </div>
    </div>
  );
}
