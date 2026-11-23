import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Avatar Studio",
  description: "A browser-based face tracking and avatar puppetry demo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
