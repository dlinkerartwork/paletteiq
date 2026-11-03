import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clipart Intelligence Studio | paletteIQ",
  description: "Analyze clipart market signals and create original character collections, prompts, and image assets.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
