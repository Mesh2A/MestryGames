import type { Metadata } from "next";
import { Cairo, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const cairo = Cairo({
  variable: "--font-ar",
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "700", "800", "900"],
});

const inter = Inter({
  variable: "--font-en",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MestRyLock",
  description: "لعبة أرقام مع تحديات ومكافآت",
  icons: {
    icon: [{ url: "/favicon.png?v=2647e79", type: "image/png", sizes: "32x32" }],
    shortcut: [{ url: "/favicon.png?v=2647e79", type: "image/png", sizes: "32x32" }],
    apple: [{ url: "/apple-touch-icon.png?v=2647e79", type: "image/png", sizes: "180x180" }],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1.0,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className={`${cairo.variable} ${inter.variable} ${geistMono.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
