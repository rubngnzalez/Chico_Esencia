import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    throw new Error('Falta news/.env con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY: no compilar sin credenciales')
  }
  return {
    plugins: [react()],
    base: '/news/',
    build: {
      outDir: '../shaddai-web/news',
      emptyOutDir: false,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
            tiptap: [
              '@tiptap/react',
              '@tiptap/starter-kit',
              '@tiptap/extension-image',
              '@tiptap/extension-link',
              '@tiptap/extension-placeholder'
            ]
          }
        }
      }
    }
  }
})
