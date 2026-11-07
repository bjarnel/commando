import { defineConfig } from 'vite';

export default defineConfig({
  // Relative production paths let the built game live in any subdirectory
  // (for example httpdocs/Developer/ne1net) without a domain-root rewrite.
  base: './',
  server: {
    host: true,
    port: 5173,
    strictPort: false,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
});
