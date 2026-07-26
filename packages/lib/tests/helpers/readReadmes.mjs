// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Reads the two README files for `tests/unit/readme-mirror.test.ts`. This lives in a
// plain-ESM module rather than in the test itself because `tsconfig.test.json` builds a
// deliberately Node-types-free program — its `include` omits `vite.config.ts` and
// `scripts/`, which are what pull `@types/node` into the `tsconfig.json` program. Adding
// node types to the test program is not an option: Node's `setTimeout` would shadow the
// DOM one and break the `number`-typed timer handles in `StatusBar` and
// `AbstractCalendarDropdown`. Keeping the `node:` imports here (typed by the sibling
// `.d.mts`, mirroring `scripts/llms/generate.mjs`) confines them to a file the typed
// program never checks.
//
// The root README cannot be loaded with Vite's `?raw` instead: it sits outside the
// package's Vite root, so the transform does not resolve it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** `packages/lib/tests/helpers/` -> repo root, independent of the working directory. */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Reads both READMEs as UTF-8 text, keyed by which of the two they are. */
export function readReadmes() {
    return {
        package: readFileSync(`${REPO_ROOT}packages/lib/README.md`, 'utf8'),
        root:    readFileSync(`${REPO_ROOT}README.md`, 'utf8'),
    };
}
