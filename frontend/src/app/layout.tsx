import "./globals.css";
import Providers from "./providers";
import { AppHeader, AppFooter } from "@/components/shared";
import { Toaster } from "sonner";

export const metadata = {
  title: "Nyra",
  description: "Decentralized Lending Protocol",
  icons: {
    icon: "/arc.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Poppins:wght@600;700;800&family=Roboto+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
        <link rel="icon" href="/arc.svg" type="image/svg+xml" />
      </head>
      <body className="min-h-screen flex flex-col bg-gray-950 text-white" suppressHydrationWarning>
        <Providers>
          <div className="flex flex-col min-h-screen w-full">
            <AppHeader />
            <main className="flex-grow w-4/5 mx-auto mt-12">{children}</main>
            <div className="w-4/5 mx-auto">
              <AppFooter />
            </div>
          </div>
          <Toaster 
            position="bottom-right"
            expand={false}
            richColors
            closeButton
            theme="dark"
          />
        </Providers>
      </body>
    </html>
  );
}
