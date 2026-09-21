// Guards the library-build alias in packages/docs/vite.config.ts: the docs
// app, its dev server and this suite must import `@jimka/typescript-ui` from
// this checkout's own packages/lib build. Without the alias the import goes
// through the node_modules symlink, which in a worktree is the main
// checkout's build, so the suite would quietly test a different library. In
// the main checkout both routes reach the same file; only a worktree run can
// fail here.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';
import { Body } from '@jimka/typescript-ui/core';

// This checkout's own library build, which the Vite config's
// library-build alias must resolve `@jimka/typescript-ui/*` to.
const OWN_CORE_BUILD = fileURLToPath(new URL('../../lib/dist/lib/core.es.js', import.meta.url));

describe('library resolution', () => {
    it("imports @jimka/typescript-ui from this checkout's own packages/lib build", async () => {
        const own = await import(/* @vite-ignore */ pathToFileURL(OWN_CORE_BUILD).href) as { Body: unknown };

        expect(Body).toBe(own.Body);
    });
});
