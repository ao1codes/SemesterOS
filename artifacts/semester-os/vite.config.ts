import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

const rootEnv = process.env.SEMESTEROS_SMOKE ? {} : loadEnv(process.env.NODE_ENV || 'development', path.resolve(import.meta.dirname, '../..'), '');
const env = { ...rootEnv, ...process.env };
const rawPort = env.PORT || env.WEB_PORT || '5173';

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = env.BASE_PATH || env.WEB_BASE_PATH || '/';
const clerkMode = env.CLERK_MODE || 'external';

if (!['external', 'disabled'].includes(clerkMode)) {
  throw new Error('CLERK_MODE must be external or disabled.');
}

export default defineConfig({
  base: basePath,
  envDir: process.env.SEMESTEROS_SMOKE ? false : path.resolve(import.meta.dirname, '../..'),
  define: {
    'import.meta.env.VITE_CLERK_MODE': JSON.stringify(clerkMode),
  },
  plugins: [react(), tailwindcss({ optimize: false })],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': { target: env.API_DEV_TARGET || `http://127.0.0.1:${env.API_PORT || '3001'}`, changeOrigin: false },
    },
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
