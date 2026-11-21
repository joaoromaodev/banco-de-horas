import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  {
    // Regra nova do React Compiler. As telas antigas carregam dados num efeito
    // (padrão anterior a ela); fica como aviso até a refatoração das telas.
    rules: { "react-hooks/set-state-in-effect": "warn" },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Worktrees das sessões paralelas vivem dentro do repositório.
    ".claude/**",
  ]),
]);

export default eslintConfig;
