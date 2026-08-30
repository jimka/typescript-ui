// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Scans the library source for classes matching the two registry tests'
// patterns, so `dispose-full-teardown.test.ts` and
// `dispose-listener-teardown.test.ts` derive their expected class lists at
// run time instead of carrying a hand-written count that can drift silently.
// This lives in a plain-ESM module rather than in the tests themselves
// because `tsconfig.test.json` builds a deliberately Node-types-free
// program — its `include` omits `vite.config.ts` and `scripts/`, which are
// what pull `@types/node` into the `tsconfig.json` program. Adding node
// types to the test program is not an option: Node's `setTimeout` would
// shadow the DOM one and break the `number`-typed timer handles in
// `StatusBar` and `AbstractCalendarDropdown`. Keeping the `node:` imports
// here (typed by the sibling `.d.mts`, mirroring `scripts/llms/generate.mjs`
// and `readReadmes.mjs`) confines them to a file the typed program never
// checks.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** `packages/lib/tests/helpers/` -> the library source root. */
const SOURCE_ROOT = fileURLToPath(new URL('../../src/typescript/lib/', import.meta.url));

/** Top-level class declaration; every library class is declared at column 0. */
const CLASS_DECLARATION = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/;

/** An indented one would be attributed to the wrong class, so the scan refuses to guess. */
const NESTED_CLASS_DECLARATION = /^\s+(?:export\s+)?(?:abstract\s+)?class\s+\w+/;

/** The teardown registry's source of truth. */
const DESTRUCTOR_DECLARATION = /^\s*protected destructor\(/;

/** The listener registry's source of truth. */
const SELF_LISTENER_REGISTRATION = /Event\.add(Listener|SubtreeListener|ViewportListener)\(\s*this\s*,/;

/** Recursively lists every `.ts` file under `dir`. */
function listSourceFiles(dir) {
    const files = [];

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);

        if (entry.isDirectory()) {
            files.push(...listSourceFiles(path));
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            files.push(path);
        }
    }

    return files;
}

/**
 * Scans every library source file for lines matching `pattern`, attributing
 * each match to the most recently declared column-0 class, and returns the
 * sorted, de-duplicated set of matched class names (excluding `Component`
 * itself — the base class declares both patterns and is the mechanism under
 * test, not a subject of it).
 *
 * @param pattern - The line pattern to scan for.
 * @returns Sorted, de-duplicated class names whose body contains a line matching `pattern`.
 */
function classesMatching(pattern) {
    const matched = new Set();

    for (const file of listSourceFiles(SOURCE_ROOT)) {
        const lines = readFileSync(file, 'utf8').split('\n');
        let currentClass = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            const classMatch = line.match(CLASS_DECLARATION);
            if (classMatch) {
                currentClass = classMatch[1];
                continue;
            }

            if (NESTED_CLASS_DECLARATION.test(line)) {
                throw new Error(`libraryClassScan: nested class declaration at ${file}:${i + 1} — the column-0 assumption no longer holds.`);
            }

            if (pattern.test(line) && currentClass && currentClass !== 'Component') {
                matched.add(currentClass);
            }
        }
    }

    return [...matched].sort();
}

/** Class names declaring `protected destructor(` — the teardown registry's source of truth. */
export function classesDeclaringDestructor() {
    return classesMatching(DESTRUCTOR_DECLARATION);
}

/** Class names calling `Event.addListener(this, ...)` / `addSubtreeListener` / `addViewportListener` — the listener registry's source of truth. */
export function classesRegisteringEventListeners() {
    return classesMatching(SELF_LISTENER_REGISTRATION);
}
