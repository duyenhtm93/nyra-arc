"use client";

import { useMemo } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePrivyWagmi } from "@privy-io/wagmi";
import { wagmiConfig, arcTestnet } from "@/config/wagmi";
import { sepolia } from "wagmi/chains";

export default function Providers({ children }: { children: React.ReactNode }) {
  // ✅ QueryClient chỉ tạo 1 lần, không recreate
  const queryClient = useMemo(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 phút
        refetchOnWindowFocus: false,
      },
    },
  }), []);

  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_NYRA_PRIVY_APP_ID!}
      config={{
        loginMethods: ["email", "wallet"],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "all-users",
          },
        },
        defaultChain: arcTestnet,
        supportedChains: [arcTestnet, sepolia],
      }}
      authLoadingComponent={<AuthLoadingPlaceholder />}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <PrivyWagmiBridge>
            {children}
          </PrivyWagmiBridge>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}

// 👇 phải gọi hook này ở trong context của WagmiProvider
function PrivyWagmiBridge({ children }: { children: React.ReactNode }) {
  usePrivyWagmi();
  return <>{children}</>;
}

function AuthLoadingPlaceholder(_: { isActive?: boolean }) {
  return <div />;
}
