import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Test Devices",
  description: "Internal inventory for checking test devices in and out.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
