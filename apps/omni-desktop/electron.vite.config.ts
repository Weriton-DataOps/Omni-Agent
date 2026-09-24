import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
const path = (s: string) => fileURLToPath(new URL(s, import.meta.url))
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { external: [/\/runtime\//, /\/dist\//], input: path('src/main/index.ts') } } },
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { index: path('src/preload/index.ts'), document: path('src/preload/document.ts') }, output: { format: 'cjs', entryFileNames: '[name].cjs' } } } },
  renderer: { root: path('src/renderer'), plugins: [react()], build: { rollupOptions: { input: { index: path('src/renderer/index.html'), document: path('src/renderer/document.html') } } } }
})
