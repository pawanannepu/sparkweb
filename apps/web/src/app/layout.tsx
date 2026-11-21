import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "sparkweb | AI Application Creator",
  description: "Describe an application in plain words and receive working software.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
    </html>
  );
}
