import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "预付费额度充值与消耗 Demo"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
