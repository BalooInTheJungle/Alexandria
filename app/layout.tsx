import type { Metadata } from "next";
import { Unbounded } from "next/font/google";
import "./globals.css";

const unbounded = Unbounded({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-unbounded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Alexandria",
  description: "Veille scientifique & RAG — Molecular Materials & Magnetism",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={unbounded.variable}>
      <body>{children}</body>
    </html>
  );
}
