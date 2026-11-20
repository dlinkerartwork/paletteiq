import type { Metadata } from "next";
import "./globals.css";
import { AccountWorkspaceGate } from '@/components/account-workspace';
import SharedLocalWorkspaceGate from '@/components/shared-local-workspace-gate';

export const metadata: Metadata = {
  title: "Clipart Intelligence Studio | paletteIQ",
  description: "Analyze clipart market signals and create original character collections, prompts, and image assets.",
  icons: {
    icon: "/paletteiq-icon.svg",
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
      <body className="antialiased"><SharedLocalWorkspaceGate><AccountWorkspaceGate>{children}</AccountWorkspaceGate></SharedLocalWorkspaceGate></body>
    </html>
  );
}
