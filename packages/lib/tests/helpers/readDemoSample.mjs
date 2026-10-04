// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Reads the MD Editor demo's sample text out of the demo panel's source, for
// `tests/component/markdown-source-preservation.test.ts`, which tests the
// sample the demo shows and so holds no copy of it. The demo keeps its sample
// in a module-private `const`, so the source is the only place to read it
// from. This lives in a plain-ESM module rather than in the test itself for the
// reason `readReadmes.mjs` gives: `tsconfig.test.json` builds a deliberately
// Node-types-free program, and keeping the `node:` imports here (typed by the
// sibling `.d.mts`) confines them to a file the typed program never checks.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** `packages/lib/tests/helpers/` -> the MD Editor demo panel's source file. */
const DEMO_PANEL = fileURLToPath(new URL('../../src/typescript/MarkdownEditorPanel.ts', import.meta.url));

/**
 * The demo's `const SAMPLE = `…`;` declaration, capturing the template
 * literal's body as written: a run of characters that are neither a backtick
 * nor a backslash, and of backslash escapes.
 */
const SAMPLE_DECLARATION = /^const SAMPLE = `((?:[^`\\]|\\[\s\S])*)`;$/m;

/** One backslash escape in the literal's body, or the start of a `${…}` substitution. */
const ESCAPE_OR_SUBSTITUTION = /\\([\s\S])|\$\{/g;

/** The characters the literal may escape: all a Markdown sample needs, and each stands for itself. */
const SELF_ESCAPES = '`\\$';

/**
 * The value of the `SAMPLE` template literal a demo panel's source declares.
 * The literal is read by hand, not evaluated, so this throws on anything it
 * would misread — the declaration gone or reshaped, an escape other than a
 * backtick, backslash or `$`, or a `${…}` substitution — rather than hand
 * back text the demo does not show.
 *
 * @param panelSource - The text of the demo panel's source file.
 * @returns The sample's text.
 * @throws Error - When the source does not declare the sample in the one
 *   form this reads, or the literal holds something it does not read.
 */
export function readSampleDeclaration(panelSource) {
    const declaration = SAMPLE_DECLARATION.exec(panelSource);

    if (declaration === null) {
        throw new Error('the panel source no longer declares its sample as "const SAMPLE = `…`;"');
    }

    return declaration[1].replace(ESCAPE_OR_SUBSTITUTION, (token, escaped) => {
        const standsForItself = escaped !== undefined && SELF_ESCAPES.includes(escaped);

        if (!standsForItself) {
            throw new Error(`the panel source's SAMPLE holds ${JSON.stringify(token)}, which this reader does not read`);
        }

        return escaped;
    });
}

/**
 * The text of the MD Editor demo's sample: the value of the `SAMPLE` template
 * literal in `MarkdownEditorPanel.ts`, as {@link readSampleDeclaration} reads
 * it.
 *
 * @returns The sample's text.
 */
export function readDemoEditorSample() {
    return readSampleDeclaration(readFileSync(DEMO_PANEL, 'utf8'));
}
