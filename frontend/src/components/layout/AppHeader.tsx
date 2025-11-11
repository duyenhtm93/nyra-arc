"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useDisconnect } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import NavigationTabs from "./NavigationTabs";
import { TAB_CONFIG } from "@/lib/config";
import { addChainToWallet } from "@/config/chain";
import { ARC_CHAIN_ID } from "@/utils/addresses";
import { useToast } from "@/hooks/useToast";

export default function AppHeader() {
  const { authenticated, login, logout } = usePrivy();
  const { address, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { wallets } = useWallets();
  const [isWalletDropdownOpen, setIsWalletDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [networkPrompted, setNetworkPrompted] = useState(false);

  const activeWallet = useMemo(() => {
    if (!wallets || wallets.length === 0) return undefined;
    if (address) {
      const lowercaseAddress = address.toLowerCase();
      const externalWallet = wallets.find((wallet) => wallet.address?.toLowerCase() === lowercaseAddress);
      if (externalWallet) return externalWallet;
    }
    return wallets[0];
  }, [wallets, address]);

  const displayAddress = useMemo(() => {
    if (activeWallet) {
      const type = (activeWallet as { type?: string }).type;
      const clientType = (activeWallet as { walletClientType?: string }).walletClientType;
      const isEmbedded = type === "embedded" || clientType === "privy" || clientType === "embedded";
      if (isEmbedded) {
        return activeWallet.address;
      }
    }
    return address || undefined;
  }, [activeWallet, address]);

  const isEmbeddedWallet = useMemo(() => {
    if (!activeWallet) return false;
    const type = (activeWallet as { type?: string }).type;
    const clientType = (activeWallet as { walletClientType?: string }).walletClientType;
    return type === "embedded" || clientType === "privy" || clientType === "embedded";
  }, [activeWallet]);

  const walletChainId = wallets[0]?.chainId;
  const parsedChainId = walletChainId ? parseInt(walletChainId.split(":")[1]) : undefined;
  const displayChainId = chainId || parsedChainId;
  const isOnArcNetwork = displayChainId === ARC_CHAIN_ID;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsWalletDropdownOpen(false);
      }
    };

    if (isWalletDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isWalletDropdownOpen]);

  const requestArcNetwork = useCallback(async () => {
    const chainName = "Arc Testnet";
    const arcChainHex = "0x4ce5d2";

    try {
      const active = wallets.find((w) => w.address === address) || wallets[0];
      if (active) {
        await active.switchChain(ARC_CHAIN_ID);
        toast.showNetworkSwitched(chainName);
        return true;
      }
    } catch (error: any) {
      console.error("❌ Arc switch via Privy wallet failed:", error);
      if (error?.code === 4902) {
        try {
          await addChainToWallet(ARC_CHAIN_ID);
          toast.showNetworkSwitched(chainName);
          return true;
        } catch (addError) {
          console.error("❌ Add Arc network failed (embedded):", addError);
        }
      }
    }

    if (typeof window !== "undefined" && (window as any).ethereum) {
      try {
        await (window as any).ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: arcChainHex }],
        });
        toast.showNetworkSwitched(chainName);
        return true;
      } catch (switchError: any) {
        console.error("❌ wallet_switchEthereumChain failed:", switchError);
        if (switchError?.code === 4902) {
          try {
            await addChainToWallet(ARC_CHAIN_ID);
            await (window as any).ethereum.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: arcChainHex }],
            });
            toast.showNetworkSwitched(chainName);
            return true;
          } catch (addError) {
            console.error("❌ Add Arc network failed (EOA):", addError);
          }
        }
      }
    }

    toast.showWarning("Please switch your wallet to Arc Testnet.");
    return false;
  }, [wallets, address, toast]);

  useEffect(() => {
    if (!authenticated) {
      setNetworkPrompted(false);
      return;
    }

    if (isOnArcNetwork) {
      setNetworkPrompted(false);
      return;
    }

    if (!networkPrompted) {
      setNetworkPrompted(true);
      requestArcNetwork().finally(() => {
        // Allow future prompts if user still on wrong network after attempt
        setTimeout(() => {
          if (authenticated && !isOnArcNetwork) {
            setNetworkPrompted(false);
          }
        }, 3000);
      });
    }
  }, [authenticated, isOnArcNetwork, networkPrompted, requestArcNetwork]);

  const copyAddress = () => {
    if (displayAddress) {
      navigator.clipboard.writeText(displayAddress);
    }
  };

  const formatAddress = (addr: string | undefined) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const faucetTab = TAB_CONFIG.filter((tab) => tab.id === "faucet");
  const mainTabs = TAB_CONFIG.filter((tab) => tab.id !== "faucet");

  return (
    <header className="w-full border-b-2 border-gray-600" style={{ backgroundColor: "var(--background)" }}>
      <div className="w-4/5 mx-auto text-white py-4 flex items-center gap-8">
        <div className="flex items-center gap-2">
          <span className="text-orange-500 font-bold text-3xl" style={{ fontFamily: "var(--font-headline)" }}>
            Nyra
          </span>
        </div>

        <NavigationTabs tabs={mainTabs} />

        <div className="flex-1"></div>

        <div className="flex items-center gap-4">
          <NavigationTabs tabs={faucetTab} />

          {authenticated && (
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-2 border border-gray-600 rounded-lg h-[38px] cursor-default"
              style={{
                backgroundColor: "var(--background-secondary)",
                borderColor: isOnArcNetwork ? "#4b5563" : "#dc2626",
                color: "var(--text-primary)",
              }}
              disabled
            >
              <img src="/arc.svg" alt="Arc Testnet" className="w-6 h-6" />
              <span className="text-sm text-white">Arc Testnet</span>
              {!isOnArcNetwork && (
                <span className="text-xs text-red-400 ml-1">Switch in wallet</span>
              )}
            </button>
          )}

          {!authenticated ? (
            <button onClick={login} className="px-4 py-2 rounded-lg h-[38px]" style={{ backgroundColor: "var(--button-active)" }}>
              Connect Wallet
            </button>
          ) : displayAddress ? (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsWalletDropdownOpen(!isWalletDropdownOpen)}
                className="px-6 py-2 rounded-lg min-w-[168px] h-[38px]"
                style={{ backgroundColor: "var(--button-active)" }}
              >
                <span className="text-sm" style={{ fontFamily: "var(--font-mono)" }}>
                  {formatAddress(displayAddress)}
                </span>
              </button>

              {isWalletDropdownOpen && (
                <div className="absolute right-0 mt-2 w-full bg-gray-800 rounded-lg shadow-lg border border-gray-700 py-2">
                  <div className="px-4 py-2 border-b border-gray-700">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-300" style={{ fontFamily: "var(--font-mono)" }}>
                        {formatAddress(displayAddress)}
                      </span>
                      <button onClick={copyAddress} className="p-1 hover:bg-gray-700 rounded">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="px-4 py-2">
                    <button
                      onClick={() => {
                        if (isEmbeddedWallet) {
                          logout();
                        } else {
                          disconnect();
                        }
                        setIsWalletDropdownOpen(false);
                      }}
                      className="w-full px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
                    >
                      {isEmbeddedWallet ? "Logout" : "Disconnect"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button onClick={logout} className="px-4 py-2 bg-red-500 rounded hover:bg-red-600">
              Logout
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
