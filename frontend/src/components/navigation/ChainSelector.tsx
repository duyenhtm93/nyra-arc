"use client";

import { useAccount } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { addChainToWallet } from "@/config/chain";
import { ARC_CHAIN_ID } from "@/utils/addresses";
import { useToast } from "@/hooks/useToast";

export default function ChainSelector() {
  const { address, chainId } = useAccount();
  const { wallets } = useWallets();
  const toast = useToast();

  const handleSwitch = async (targetChainId: number) => {
    const chainName = targetChainId === ARC_CHAIN_ID ? 'Arc Testnet' : 'Sepolia Testnet';
    
    try {
      // Tìm ví đang active - thử nhiều cách
      let activeWallet = wallets.find(w => w.address === address);
      
      // Nếu không tìm thấy, thử tìm ví đầu tiên
      if (!activeWallet && wallets.length > 0) {
        activeWallet = wallets[0];
      }
      
      if (activeWallet) {
        // Sử dụng wallet.switchChain() cho tất cả loại ví
        await activeWallet.switchChain(targetChainId);
        toast.showNetworkSwitched(chainName);
      } else {
        throw new Error(`No active wallet found. Address: ${address}, Wallets: ${wallets.length}`);
      }
    } catch (error: any) {
      console.error("❌ Chain switch error:", error);
      
      // Xử lý lỗi 4902 - chain chưa được thêm vào ví
      if (error?.code === 4902) {
        try {
          await addChainToWallet(targetChainId);
          toast.showNetworkSwitched(chainName);
        } catch (addError: any) {
          console.error("❌ Add chain error:", addError);
          toast.showNetworkError(`Failed to add chain: ${addError.message}`);
        }
      } else {
        toast.showNetworkError(error.message);
      }
    }
  };

  // Danh sách chains được hỗ trợ
  const supportedChains = [
    { id: ARC_CHAIN_ID, name: 'Arc Testnet' },
    { id: 11155111, name: 'Sepolia Testnet' },
  ];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-gray-600">Current chain: {chainId}</p>
      <p className="text-xs text-gray-500">
        Address: {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected'}
      </p>
      <p className="text-xs text-gray-500">
        Wallets: {wallets.length}
      </p>
      <select
        value={chainId}
        onChange={(e) => handleSwitch(Number(e.target.value))}
        className="px-3 py-2 border rounded-lg bg-white"
      >
        {supportedChains.map((chain) => (
          <option key={chain.id} value={chain.id}>
            {chain.name}
          </option>
        ))}
      </select>
    </div>
  );
}
