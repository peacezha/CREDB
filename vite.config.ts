import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  build: {
    // server.js serves static files from this directory
    outDir: 'build',
    sourcemap: false,
  },
});
