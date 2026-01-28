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