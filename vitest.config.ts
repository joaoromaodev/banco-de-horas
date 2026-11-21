import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // Mesmo alias do tsconfig.json: "@/*" -> "./*"
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // O fuso do runner não pode mudar o resultado dos testes de data.
    env: { TZ: 'UTC' },
  },
});
