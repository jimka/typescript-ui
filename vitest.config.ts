import { mergeConfig, defineConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Merge the production Vite config so tests inherit `resolve.alias`
// (`~` -> src/typescript/lib plus the `@jimka/typescript-ui/*` subpath aliases
// in vite.config.ts). Without this merge a standalone Vitest config resolves
// none of the `~/...` imports every source file uses.
export default mergeConfig(viteConfig, defineConfig({
    test: {
        environment: 'node',              // default; component tests opt in via `// @vitest-environment jsdom`
        globals: true,
        include: ['tests/**/*.test.ts'],
        setupFiles: ['tests/setup/jsdom-setup.ts'],   // self-guards to a no-op under the node env
        coverage: {
            provider: 'v8',
            include: ['src/typescript/lib/**/*.ts'],
            exclude: ['src/typescript/lib/**/index.ts', 'src/typescript/lib/glyphs/**'],
        },
    },
}));
