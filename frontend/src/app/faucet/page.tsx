"use client";

import { useState, useMemo, useEffect, useCallback, memo } from "react";
import Image from "next/image";
import { useWallets } from "@privy-io/react-auth";
import { useToast } from "@/hooks/useToast";
import { getAddress } from "@/utils/addresses";
import { useTokenBalance } from "@/hooks/useCollateral";
import { ARC_CHAIN_ID } from "@/utils/addresses";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { encodeFunctionData } from "viem";

const TEST_TOKEN_ABI = [
  {
    name: "faucet",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

const TOKENS = [
  { symbol: "USDC", name: "USD Coin", icon: "/usdc.svg", address: getAddress("USDC") },
  { symbol: "EURC", name: "Euro Coin", icon: "/eurc.svg", address: getAddress("EURC") },
  { symbol: "BTC", name: "Bitcoin", icon: "/btc.svg", address: getAddress("BTC") },
  { symbol: "ETH", name: "Ethereum", icon: "/eth.svg", address: getAddress("ETH") },
  { symbol: "BNB", name: "Binance Coin", icon: "/bnb.svg", address: getAddress("BNB") },
] as const;

export default function FaucetPage() {
  const { wallets } = useWallets();
  const toast = useToast();
  const { address: wagmiAddress, isConnecting } = useAccount();
  const userAddress = useMemo(() => wagmiAddress || wallets[0]?.address, [wagmiAddress, wallets]);

  type ClaimState = Record<string, { success: boolean; message: string }>;
  const [claimResults, setClaimResults] = useState<ClaimState>({});

  const FaucetRow = memo(({ token }: { token: (typeof TOKENS)[number] }) => {
    const { wallets: privyWallets } = useWallets();
    const { isConnected } = useAccount();
    const isExternalFaucet = token.symbol === "USDC" || token.symbol === "EURC";
    const { balance, isLoading, refetch } = useTokenBalance(token.address, userAddress);
    const {
      data: hasClaimedRaw,
      refetch: refetchClaimStatus,
    } = useReadContract({
      address: token.address as `0x${string}`,
      abi: [
        {
          name: "hasClaimedFaucet",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ name: "", type: "bool" }],
        },
      ] as const,
      functionName: "hasClaimedFaucet",
      args: userAddress ? [userAddress as `0x${string}`] : undefined,
      chainId: ARC_CHAIN_ID,
      query: {
        enabled: !!userAddress && !isExternalFaucet,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
    });
    const { writeContractAsync } = useWriteContract();
    const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
    const [pendingToastId, setPendingToastId] = useState<string | number | null>(null);

    const {
      isLoading: isTxPending,
      isSuccess: isTxSuccess,
      isError: isTxError,
      error: txError,
    } = useWaitForTransactionReceipt({
      hash: txHash,
    });

    useEffect(() => {
      if (!txHash) return;

      if (isTxSuccess) {
        if (pendingToastId !== null) {
          toast.dismiss(pendingToastId);
          setPendingToastId(null);
        }
        toast.showTransactionSuccess(txHash, `Claim ${token.symbol}`);
        setClaimResults((prev) => ({
          ...prev,
          [token.symbol]: { success: true, message: "" },
        }));
        void refetch();
        if (!isExternalFaucet) {
          void refetchClaimStatus();
        }
        setTxHash(undefined);
      } else if (isTxError) {
        if (pendingToastId !== null) {
          toast.dismiss(pendingToastId);
          setPendingToastId(null);
        }
        const wagmiError = txError as { shortMessage?: string; message?: string } | undefined;
        const message = wagmiError?.shortMessage || wagmiError?.message || `Failed to claim ${token.symbol}`;
        toast.showError(message);
        setClaimResults((prev) => ({
          ...prev,
          [token.symbol]: { success: false, message },
        }));
        setTxHash(undefined);
      }
    }, [isTxSuccess, isTxError, txHash, txError, pendingToastId, toast, token.symbol, isExternalFaucet, refetch, refetchClaimStatus]);

    const handleClaim = useCallback(async () => {
      if (isExternalFaucet) {
        window.open("https://faucet.circle.com/", "_blank");
        return;
      }

      if (!userAddress) {
        toast.showError("Please connect wallet first");
        return;
      }

      let loadingId: string | number | null = null;

      try {
        loadingId = toast.showLoading(`Claiming ${token.symbol}...`);
        let tx: `0x${string}`;

        if (isConnected) {
          tx = await writeContractAsync({
            address: token.address,
            abi: TEST_TOKEN_ABI,
            functionName: "faucet",
          });
        } else if (privyWallets.length > 0) {
          const privyWallet = privyWallets[0];
          const provider = await privyWallet.getEthereumProvider();
          const data = encodeFunctionData({
            abi: TEST_TOKEN_ABI,
            functionName: "faucet",
          });

          tx = (await provider.request({
            method: "eth_sendTransaction",
            params: [
              {
                from: userAddress,
                to: token.address,
                data,
              },
            ],
          })) as `0x${string}`;
        } else {
          throw new Error("No connected wallet");
        }

        if (loadingId !== null) {
          toast.dismiss(loadingId);
        }
        const pendingId = toast.showTransactionPending(`Claim ${token.symbol}`);
        if (pendingId !== null) {
          setPendingToastId(pendingId);
        }
        setTxHash(tx);
      } catch (error: any) {
        if (loadingId !== null) {
          toast.dismiss(loadingId);
        }
        const message = error?.shortMessage || error?.message || `Failed to claim ${token.symbol}`;
        toast.showError(message);
        setClaimResults((prev) => ({
          ...prev,
          [token.symbol]: { success: false, message },
        }));
      }
    }, [isExternalFaucet, userAddress, isConnected, token.address, token.symbol, writeContractAsync, privyWallets, toast]);

    const displayBalance = useMemo(() => {
      return isLoading
        ? "Loading..."
        : balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }, [isLoading, balance]);

    const isAlreadyClaimed = useMemo(() => {
      return isExternalFaucet
        ? false
        : claimResults[token.symbol]?.success || hasClaimedRaw === true;
    }, [isExternalFaucet, claimResults, token.symbol, hasClaimedRaw]);

    return (
      <tr>
        <td className="px-6 py-4 w-1/3">
          <div className="flex items-center gap-3">
            <div className="relative w-8 h-8">
              <Image
                src={token.icon}
                alt={token.symbol}
                fill
                className="object-contain"
              />
            </div>
            <div>
              <div className="font-medium text-white">{token.symbol}</div>
              <div className="text-xs text-gray-400">{token.name}</div>
            </div>
          </div>
        </td>
        <td className="px-6 py-4 text-right text-base w-1/3" style={{ color: "var(--text-primary)" }}>
          {displayBalance}
        </td>
        <td className="px-6 py-4 text-right w-1/3">
          <button
            onClick={handleClaim}
            disabled={
              isExternalFaucet ? false : !userAddress || isConnecting || isTxPending || isAlreadyClaimed
            }
            className="px-3 py-1 text-sm rounded transition-colors text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
            style={{ backgroundColor: "var(--button-active)" }}
          >
            {isExternalFaucet
              ? "Claim"
              : isAlreadyClaimed
                ? "Claimed"
                : isTxPending
                  ? "Claiming..."
                  : "Claim"}
          </button>
        </td>
      </tr>
    );
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-500">

      <div className="premium-card rounded-lg overflow-hidden shadow-2xl mx-auto" style={{ maxWidth: "800px" }}>
        <div className="px-6 py-5 border-b border-gray-700/50 bg-gray-800/20">
          <h2 className="text-xl font-semibold text-white" style={{ fontFamily: 'var(--font-headline)' }}>Available Tokens</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 border-b border-gray-700/50">
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Asset</th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">Wallet Balance</th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              {TOKENS.map((token) => (
                <FaucetRow key={token.symbol} token={token} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

