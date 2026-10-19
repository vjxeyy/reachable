/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API server (npm run server) listens on 8787. In dev, Vite forwards API and photo requests to it.
const api = process.env.API_PROXY_TARGET ?? 'http://localhost:8787'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': api,
      '/uploads': api,
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
  },
})
