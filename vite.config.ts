import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

// base relativa: l'app funziona sia su un dominio dedicato sia in una sottocartella (es. GitHub Pages)
// `vite build --mode anteprima` crea un unico file HTML senza service worker, per l'anteprima
export default defineConfig(({ mode }) => ({
  base: './',
  build: mode === 'anteprima' ? { outDir: 'dist-anteprima' } : {},
  plugins: mode === 'anteprima' ? [react(), viteSingleFile()] : [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/icon.svg'],
      manifest: {
        name: 'Finanze Personali',
        short_name: 'Finanze',
        description: 'Gestione personale di ricavi, costi e investimenti. Dati solo sul dispositivo.',
        lang: 'it',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F7F7F5',
        theme_color: '#F7F7F5',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
      }
    })
  ],
  test: {
    environment: 'node'
  }
}));
