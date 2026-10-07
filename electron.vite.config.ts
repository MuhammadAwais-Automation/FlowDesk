import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

export default defineConfig({
  main: {
    // electron-builder leaves electron-updater out of app.asar, so it is
    // bundled into main.js instead of loaded from node_modules.
    plugins: [externalizeDepsPlugin({ exclude: ['electron-updater'] })],
    build: {
      lib: {
        entry: {
          main: resolve('electron/main.ts'),
          brainUtility: resolve('electron/brain/utility.ts'),
        },
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          preload: resolve('electron/preload.ts'),
          webviewPreload: resolve('electron/webviewPreload.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        input: resolve('index.html'),
      }
    },
    resolve: {
      alias: {
        '@': resolve('src')
      }
    },
    // Vite's cold-start dep scan crawls every .html under root by default, and
    // the repo root also holds git worktrees and unpacked builds (Chromium
    // LICENSE pages), which stalled first load for minutes (white window).
    optimizeDeps: {
      entries: ['index.html'],
    },
    server: {
      watch: {
        ignored: [
          '**/.worktrees/**', '**/.kilo/**', '**/.agents/**', '**/.superpowers/**',
          '**/dist/**', '**/dist-*/**', '**/out/**', '**/probes/**', '**/scratch/**',
        ],
      },
    },
    plugins: [react()],
    css: {
      postcss: {
        plugins: [
          tailwindcss(),
          autoprefixer(),
        ]
      }
    }
  }
})
