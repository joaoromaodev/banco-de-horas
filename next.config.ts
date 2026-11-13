import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Os modelos .docx são lidos com fs em runtime — o trace da Vercel não os
  // enxerga sozinho, então entram explicitamente no bundle da função.
  outputFileTracingIncludes: {
    "/api/contratos/documento": ["./modelos/contrato-experiencia/*.docx"],
  },
};

export default nextConfig;
