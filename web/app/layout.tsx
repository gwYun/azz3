import type { Metadata } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n-context";
import { ToastProvider } from "@/lib/toast-context";
import { Nav } from "@/components/Nav";
import { MobileBanner } from "@/components/MobileBanner";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "azz3 — transfer-fee predictor",
  description: "Drag the sliders, see the fee, send a build.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${interTight.variable} ${jetbrains.variable}`}
    >
      <body className="min-h-screen font-sans">
        <I18nProvider>
          <ToastProvider>
            <MobileBanner />
            <Nav />
            <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
