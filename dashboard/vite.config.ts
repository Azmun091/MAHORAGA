import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiTarget = process.env.MAHORAGA_API_URL || `http://localhost:${process.env.WRANGLER_PORT || '8787'}`

export default defineConfig({
  base: '/mahoraga/', // Base path for serving under /mahoraga/
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api/, '/agent'),
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: [
      'autotrader',
      'autotrader.tail3a7fed.ts.net',
      'fd7a:115c:a1e0::bf01:e18d',
      '100.74.225.124',
    ],
  },
})
