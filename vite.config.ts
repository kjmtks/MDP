import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    watch: {
      usePolling: true,
    },
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ws/, '')
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/files': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/drawio': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/plantuml': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  }
})