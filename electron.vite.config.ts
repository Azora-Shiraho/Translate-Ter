import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const alias = {
  '@shared': resolve(__dirname, 'apps/desktop/src/shared'),
  '@main': resolve(__dirname, 'apps/desktop/src/main'),
  '@renderer': resolve(__dirname, 'apps/desktop/src/renderer')
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'apps/desktop/src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'apps/desktop/src/preload/index.ts')
      }
    }
  },
  renderer: {
    root: __dirname,
    resolve: { alias },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          settings: resolve(__dirname, 'settings.html')
        }
      }
    }
  }
});
