import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import AppHeader from "@/components/AppHeader";
import { artExists } from "@/components/Art";
import BottomNav from "@/components/BottomNav";
import Web3Provider from "@/components/Web3Provider";
import { BRAND } from "@/lib/brand";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-playfair", weight: ["600", "700", "800"], display: "swap" });

export const metadata: Metadata = {
  title: { default: `${BRAND.name} — play live, free or for tokens`, template: `%s · ${BRAND.name}` },
  description: "Mobile-first multiplayer backgammon: quick matches, a computer opponent, six hand-crafted boards and fair server dice.",
  ...(artExists("og") ? { openGraph: { images: ["/images/og-image.png"] } } : {}),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B1220",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body>
        <Web3Provider>
          <AppHeader />
          {children}
          <BottomNav />
        </Web3Provider>
      </body>
    </html>
  );
}
