import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import type { ReactNode } from "react";
import { SmoothScroll } from "@/components/motion/SmoothScroll";
import "./globals.css";

// Display face for the landing hero; exposed as a CSS variable so only the hero opts in.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = { title: "ClearGateway", description: "Non-custodial stablecoin payments (testnet)" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}
