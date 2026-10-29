import { mergeConfig, defineConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Merge the production Vite config so tests inherit `resolve.alias`
// (`~` -> src/typescript/lib plus the `@jimka/typescript-ui/*` subpath aliases
// in vite.config.ts). Without this merge a standalone Vitest config resolves
// none of the `~/...` imports every source file uses.
export default mergeConfig(viteConfig, defineConfig({
    test: {
        environment: 'node',              // component tests run under node via the modelled DOM harness; only the production-seam suites keep the `// @vitest-environment jsdom` pragma
        globals: true,
        include: ['tests/**/*.test.ts'],
        setupFiles: ['tests/setup/node-setup.ts'],   // installs the modelled DOM baseline under node; self-guards to a no-op under jsdom
        // Unset, Vitest runs one worker per core but one, and the slowest files
        // — the MarkdownEditor suites, the heaviest by far — start together. On
        // a many-core machine whose memory is capped (a WSL VM) that, with
        // module registries then pinning every undisposed component (since
        // fixed: they forget them on `DOM.onSinkChange`), ran the host out of
        // memory and took it down. Even fixed, a worker can reach ~1.5 GB, so
        // the cap stays. Measured 2026-10-29: the full suite peaked at ~6 GB
        // across four workers. A host with memory to spare can raise it per
        // run with `--maxWorkers`, which overrides this.
        maxWorkers: 4,
        coverage: {
            provider: 'v8',
            include: ['src/typescript/lib/**/*.ts'],
            exclude: ['src/typescript/lib/**/index.ts', 'src/typescript/lib/glyphs/**'],
        },
    },
}));
