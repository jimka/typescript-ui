import { defineConfig } from 'vite'

export default defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        // @jimka/typescript-ui derives each component's CSS class name from
        // `this.constructor.name`, so the minifier must preserve class and
        // function names. Without this the built page renders unstyled and
        // non-functional. Do not remove.
        rollupOptions: {
            output: {
                minify: {
                    compress: { keepNames: { function: true, class: true } },
                    mangle:   { keepNames: { function: true, class: true } },
                },
            },
        },
    },
})
