import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import license from 'rollup-plugin-license';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const apiPort = env.PORT || '3000';

  return {
    plugins: [
      react(),
      license({
        thirdParty: {
          output: path.resolve(__dirname, 'public/ThirdPartyNotices.txt'),
        },
      })
    ],
    
    base: './',
    
    define: {
      __API_PORT__: JSON.stringify(apiPort),
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
        '/files': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true }
      }
    },
    preview: {
      port: 4173,
      strictPort: true,
      proxy: {
        '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
        '/files': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true }
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-mui': ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
            'vendor-editor': ['@uiw/react-codemirror', '@codemirror/state', '@codemirror/view', '@codemirror/lang-markdown'],
            'vendor-mermaid': ['mermaid'],
            'vendor-plantuml': ['@plantuml/core'],
            'vendor-chart': ['chart.js']
          }
        }
      },
      chunkSizeWarningLimit: 10000,
    }
  };
});