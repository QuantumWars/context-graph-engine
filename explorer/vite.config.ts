import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API is a separate process on loopback (DEC-020). Vite proxies to it in development so the
// browser makes same-origin requests and no CORS policy has to be widened.
export default defineConfig({
  plugins: [react()],
  server: { port: 5273, proxy: { '/api': 'http://127.0.0.1:4321' } },
});
