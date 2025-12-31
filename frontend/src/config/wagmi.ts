import { createConfig, http, fallback } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { defineChain } from 'viem';

// Arc testnet chain config
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_ARC_RPC_URL || 'https://rpc.testnet.arc.network',
      ],
    },
    public: {
      http: [process.env.NEXT_PUBLIC_ARC_RPC_URL || 'https://rpc.testnet.arc.network'],
    },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://testnet.arcscan.app/' },
  },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [arcTestnet, sepolia],
  // ❌ KHÔNG thêm connectors - usePrivyWagmi() sẽ tự động inject!
  transports: {
    [arcTestnet.id]: fallback([
      http(process.env.NEXT_PUBLIC_ARC_RPC_URL || 'https://rpc.testnet.arc.network'),
    ]),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_RPC_URL || 'https://ethereum-sepolia.publicnode.com'),
  },
  // Khuyên dùng cho Next.js + tránh hydration issues
  ssr: false, // Tắt SSR để tránh lỗi hydration
  storage: null, // Tắt persist để tránh lỗi hydration
});
