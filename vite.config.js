import { defineConfig } from 'vite'

export default defineConfig({
  // GitHub Pages serves the site at /vokabeltrainer/, not the root.
  // This prefix gets applied to all asset URLs in the built HTML.
  // For local dev (npm run dev) this is ignored — root is fine locally.
  base: '/vokabeltrainer/',

  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
  },
})
