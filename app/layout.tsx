import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Banco de Horas — Folha de Ponto",
  description: "Leitura de folha de ponto e geração de planilhas",
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
    >
      <body className="min-h-full flex flex-col">
        <nav className="border-b bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3 text-sm">
            <span className="font-bold">⏱️ Banco de Horas</span>
            <a href="/" className="text-blue-600 hover:underline">Início</a>
            <a href="/cadastros" className="text-blue-600 hover:underline">Cadastros</a>
            <a href="/configuracoes" className="text-blue-600 hover:underline">Configurações</a>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
