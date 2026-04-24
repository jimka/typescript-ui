import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/typescript/Base/index.ts',
      name: 'TypescriptUI',
      formats: ['es', 'umd'],
      fileName: (format) => `typescript-ui.${format}.js`,
    },
    outDir: 'dist/lib',
    sourcemap: true,
    minify: 'oxc',
  },
})
