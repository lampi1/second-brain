// Vite config of the renderer build (scripts/build.mjs); main and preload build with esbuild.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Renderer only (main and preload are built by esbuild in scripts/build.mjs).
export default defineConfig({
  root: path.resolve(import.meta.dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, 'src/shared') } },
  build: { outDir: path.resolve(import.meta.dirname, 'out/renderer'), emptyOutDir: true, sourcemap: false, target: 'chrome140' },
});
