// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect } from 'vitest';

// File reading lives in a plain-ESM helper: the test program is deliberately
// Node-types-free, so `node:fs` cannot be imported here. See the helper for why.
import { readDemoEditorSample, readSampleDeclaration } from '../helpers/readDemoSample.mjs';

/**
 * `tests/component/markdown-source-preservation.test.ts` tests the MD Editor
 * demo's own sample, which it gets from this reader. The reader takes the
 * sample out of the demo panel's source by hand, so it must never hand back
 * text the demo does not show: wherever it could misread the declaration it
 * throws instead. Each such case is pinned here, on source text made for it.
 */

/** A panel source declaring `body` as its sample, among other code. */
function panelDeclaring(body: string): string {
    return `import { x } from './x';\n\nconst SAMPLE = \`${body}\`;\n\nexport const y = SAMPLE;\n`;
}

describe('the MD Editor demo sample reader', () => {
    it('reads the declaration\'s body as the literal evaluates: text, line breaks, and a `$` that opens no substitution', () => {
        expect(readSampleDeclaration(panelDeclaring('# Title\n\nCosts $5, {a} and $ {b}.\n'))).toBe('# Title\n\nCosts $5, {a} and $ {b}.\n');
    });

    it('reads an escaped backtick, backslash and `$` as the character itself', () => {
        expect(readSampleDeclaration(panelDeclaring('a \\`code\\` b \\\\ c \\${d}'))).toBe('a `code` b \\ c ${d}');
    });

    it('reads the sample the demo panel holds', () => {
        const sample = readDemoEditorSample();

        expect(sample.startsWith('# MarkdownEditor\n')).toBe(true);
        expect(sample.endsWith('\n')).toBe(true);
        expect(sample).toContain('`**bold**`');
    });

    it.each([
        ['is gone', 'export const y = 1;\n'],
        ['is exported', 'export const SAMPLE = `a`;\n'],
        ['is not a const', 'let SAMPLE = `a`;\n'],
        ['is indented, so not the module\'s own', '    const SAMPLE = `a`;\n'],
        ['has a type annotation', 'const SAMPLE: string = `a`;\n'],
        ['is a quoted string', 'const SAMPLE = "a";\n'],
        ['is tagged', 'const SAMPLE = md`a`;\n'],
        ['is followed by more of an expression', 'const SAMPLE = `a` + other;\n'],
        ['has no semicolon', 'const SAMPLE = `a`\n'],
        ['holds a backtick that is not escaped', 'const SAMPLE = `a`b`;\n'],
        ['is never closed', 'const SAMPLE = `a\nb\n'],
    ])('throws when the declaration %s', (_shape, source) => {
        expect(() => readSampleDeclaration(source)).toThrow('no longer declares its sample');
    });

    it.each([
        ['a line-break escape', 'a\\nb', '"\\\\n"'],
        ['a tab escape', 'a\\tb', '"\\\\t"'],
        ['a unicode escape', 'a\\u00e9b', '"\\\\u"'],
        ['a line continuation', 'a\\\nb', '"\\\\\\n"'],
        ['a substitution', 'a ${name} b', '"${"'],
    ])('throws on %s, which would not read as written', (_what, body, token) => {
        expect(() => readSampleDeclaration(panelDeclaring(body))).toThrow(`SAMPLE holds ${token}`);
    });
});
