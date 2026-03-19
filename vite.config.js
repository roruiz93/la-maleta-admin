import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug'],
        passes: 3,
      },
      mangle: {
        toplevel: true,
        safari10: true,
      },
      format: {
        comments: false,
      }
    },
    rollupOptions: {
      output: {
        entryFileNames:  'assets/[hash].js',
        chunkFileNames:  'assets/[hash].js',
        assetFileNames:  'assets/[hash].[ext]',
        manualChunks: {
          'fb': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
        }
      }
    },
    sourcemap: false,
    chunkSizeWarningLimit: 500,
  },
  envPrefix: 'VITE_',
})
