import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BRAND } from "@/lib/brand";
import { Dicas } from "@/components/retorno";
import { SCRIPT_TEMA } from "@/components/tema";
import { Medicao } from "@/components/medicao";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: `${BRAND.nome} — ${BRAND.subtitulo}`,
  description: BRAND.descricao,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-full bg-fundo text-tinta">
        {children}
        <Dicas />
        <Medicao />
      </body>
    </html>
  );
}
