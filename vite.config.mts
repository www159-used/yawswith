import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  build: {
    target: 'chrome102',
    outDir: 'out/webview-ui',
    emptyOutDir: true,
    lib: {
      entry: 'src/webview/client.tsx',
      name: 'YawswithSidebar',
      formats: ['iife'],
      fileName: () => 'sidebar.js'
    }
  }
});
