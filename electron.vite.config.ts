import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
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
