import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react()],
    server: {
      port: env.APP_PORT ? parseInt(env.APP_PORT, 10) : 3000,
    },
    define: {
      '__APP_ROOT_DIR__': JSON.stringify(env.ROOT_DIR || './files'),
      '__API_PORT__': parseInt(env.API_PORT || '3001', 10),
    }
  };
});