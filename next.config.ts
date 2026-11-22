import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Há um package-lock.json perdido em C:\Users\joaog; sem isto o Turbopack o
  // toma como raiz do workspace e o proxy quebra no dev ("adapterFn is not a function").
  turbopack: { root: path.resolve(__dirname) },
  // Os modelos .docx são lidos com fs em runtime — o trace da Vercel não os
  // enxerga sozinho, então entram explicitamente no bundle da função.
  // unpdf (texto do PDF na leitura sem IA, lib/leituraSemIaServidor.ts) embute o
  // pdf.js inteiro: fica fora do bundle e é carregado do node_modules pelo Node.
  serverExternalPackages: ["unpdf"],
  outputFileTracingIncludes: {
    "/api/contratos/documento": ["./modelos/contrato-experiencia/*.docx"],
  },
};

export default nextConfig;
