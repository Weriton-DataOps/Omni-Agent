import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
const path = (s: string) => fileURLToPath(new URL(s, import.meta.url))
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { external: [/\/runtime\//, /\/dist\//], input: path('src/main/index.ts') } } },
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: path('src/preload/index.ts'), output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  renderer: { root: path('src/renderer'), plugins: [react()], build: { rollupOptions: { input: path('src/renderer/index.html') } } }
})
