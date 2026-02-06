import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
