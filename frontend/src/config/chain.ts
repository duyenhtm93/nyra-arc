// config/chain.ts
// Cấu hình chain cho việc thêm chain vào ví (fallback cho lỗi 4902)
export const chainConfigs = {
  11155111: {
    chainId: '0xaa36a7',
    chainName: 'Sepolia Testnet',
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'ETH',
      decimals: 18
    },
    rpcUrls: ['https://ethereum-sepolia.publicnode.com'],
    blockExplorerUrls: ['https://sepolia.etherscan.io']
  },
  5042002: {
    chainId: '0x4ce5d2',
    chainName: 'Arc Testnet',
    nativeCurrency: {
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6
    },
    rpcUrls: [
      process.env.NEXT_PUBLIC_ARC_RPC_URL || 'https://rpc.testnet.arc.network'
    ],
    blockExplorerUrls: ['https://testnet.arcscan.app/']
  }
};

// Hàm thêm chain vào ví (fallback cho lỗi 4902)
export const addChainToWallet = async (chainId: number) => {
  const chainConfig = chainConfigs[chainId as keyof typeof chainConfigs];
  if (!chainConfig) {
    throw new Error(`Chain configuration not found for chain ID: ${chainId}`);
  }

  // Gọi wallet_addEthereumChain
  await (window as any).ethereum?.request({
    method: 'wallet_addEthereumChain',
    params: [chainConfig]
  });
};
