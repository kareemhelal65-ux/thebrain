import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Brain AIOS — Your Company's AI Operating System",
  description: "The Brain remembers every meeting, every document, every decision. Ask anything about your company and get instant answers with source citations.",
  keywords: ["AI", "AIOS", "meeting memory", "company knowledge", "RAG", "business intelligence"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
