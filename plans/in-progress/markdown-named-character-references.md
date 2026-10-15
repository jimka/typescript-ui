---
depends-on: [marked-upgrade]
touches-shared:
  - packages/lib/src/typescript/lib/component/display/markdownExtensions.ts
  - packages/lib/src/typescript/lib/component/display/Markdown.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts
  - packages/lib/tests/component/display/Markdown.test.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-importer.test.ts
  - packages/lib/tests/component/markdown-serializer.test.ts
  - packages/lib/tests/component/markdown-source-edits.test.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts
  - packages/lib/tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts
  - packages/lib/docs/components/Markdown.md
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
  - packages/lib/THIRD-PARTY-NOTICES.md
---

# Markdown Named Character References — Implementation Plan

## Overview

A **character reference** is `&`, then a name or a number, then `;`: `&copy;` (named) or `&#169;` (numeric) both stand for `©`. After [`marked-upgrade`](marked-upgrade.md), the `Markdown` viewer and the `MarkdownEditor` read a numeric reference as its character, but only in text, and show a named one as typed. The repository's owner decided on 2026-10-14 that named references are read too. This plan does that, for the viewer and the editor alike, wherever CommonMark reads references.

| Document | After `marked-upgrade` | After this plan |
|---|---|---|
| `&copy; &amp; &nbsp;` | as typed | `©`, `&`, a no-break space |
| `[a](/f&ouml; "&#35;1")` | destination `/f&ouml;`, title `&#35;1` | destination `/fö`, title `#1` |
| ```` ```j&#115; ```` (a fence's info string) | language `j&#115;` | language `js` |
| `# Terms &amp; Conditions` | `id="terms-amp-conditions"` | `id="terms-conditions"` |
| `&notaname;`, `&copy` (no `;`), `` `&copy;` ``, `<https://a.test/&copy;>`, `<div>&copy;</div>`, `![&copy;](/x)` | as typed | as typed |
| text typed as `&copy;` in the editor, then saved | `&copy;` | `\&copy;`, which reads back as typed |

The reading happens in one place, the scoped `marked` instance in [markdownExtensions.ts:602](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L602), so the viewer, the editor's import and every check the serializer and source mode make by lexing read alike. The names come from a table generated once from the WHATWG list into the library. The serializer and source mode's link commands escape the `&` of anything that would read as a reference. Heading ids are computed from the heading's text with its references read.

No public symbol changes. Measured on a private copy of the repository on 18.1.0: the viewer and the editor read 56 probe documents alike, the whole suite passes (19,920 tests), and of 19,927 typed strings none reads back otherwise after a save, beyond the tabs and double spaces already lost after `marked-upgrade`; see [`## Addendum: Measured`](#addendum-measured).

---

## Architecture Decisions

### The table is generated from the WHATWG list into the library

A one-shot script, `packages/lib/scripts/import-html-entities.mjs`, reads the WHATWG `entities.json` and writes `htmlNamedCharacterReferences.ts`: a `Map` from each name to its characters. It mirrors [scripts/import-fontawesome.ts](packages/lib/scripts/import-fontawesome.ts), which generates the Font Awesome glyph data with an SPDX header naming its licence. The generated file carries `SPDX-License-Identifier: BSD-3-Clause`, and `THIRD-PARTY-NOTICES.md` lists it under the components bundled in `dist/lib`, beside d3.[^table-source] [^licence]

No new dependency is added, and no package already installed for the library provides a usable table.[^table-source]

### All 2,125 names are read

The table holds every name of the WHATWG list that ends in `;`, the set CommonMark names. HTML's 106 legacy forms without `;` are left out, because CommonMark does not read them. The cost is about 12.5 kB gzipped in the chunk the viewer and the editor share.[^full-set]

### References are read in four of `marked`'s tokenizer slots

A new object `CHARACTER_REFERENCE_TOKENIZERS` in `markdownExtensions.ts` overrides `inlineText`, `link`, `def` and `fences`. Both the bounded instance and its unbounded test twin install it, beside their block tokenizers. Each override runs `marked`'s own method from `Tokenizer.prototype` and then changes one field of the token, as the dialect's [`blockquoteWithSourceRaw`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L467) changes only `raw`.[^one-seam]

| Slot | Field it reads references in | CommonMark |
|---|---|---|
| `inlineText` | `text`, from `raw` | example 25 |
| `link` | `href`, `title` | example 32 |
| `def` | `href`, `title` (so a reference link gets read values) | example 33 |
| `fences` | `lang` | example 34 |

### Text is read from `raw` in one pass

`inlineText` sets `text` to `decodeCharacterReferences(raw)`, which reads numeric and named references in one pass. `marked`'s own numeric reading is replaced, not followed by a second one, so `&#38;copy;` reads as `&copy;`, not `©`. Text `marked` marks `escaped` (inside an inline `<pre>`, `<code>`, `<kbd>` or `<script>` tag) keeps `raw`, as `marked` keeps it.[^one-pass]

### Destinations, titles and info strings read escapes and references together

`marked` removes the backslash escapes from a destination, a title and an info string before the override sees them. Reading references afterwards would turn the escaped `\&copy;` into `©`. So `link`, `def` and `fences` run `marked`'s method on a **view** of the tokenizer whose `anyPunctuation` rule (the unescape rule) matches nothing, and then read escapes and references in one left-to-right pass with `decodeEscapesAndCharacterReferences`.

| Written | Read |
|---|---|
| `/f&ouml;` | `/fö` |
| `/a\&copy;` | `/a&copy;` |
| `\\&copy;` | `\©` |

A view is an object made with `Object.create(tokenizer, { rules: … })`, as `listWithOwnTaskMarker` makes one at [markdownExtensions.ts:372](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L372). One view is made per lex and kept in a `WeakMap` keyed by the rules object `marked` gives each lexer.[^view]

### Numeric references are read there too

`decodeEscapesAndCharacterReferences` reads numeric references as well, so `[a](/n&#35;1)` links to `/n#1`. CommonMark reads both kinds in the same places.[^numeric-elsewhere]

### Where references are not read

Code spans, code blocks, autolinks (`<https://…>` and bare URLs), raw HTML, link labels, and the dialect's own image (`![alt](src)`), styled-span attributes and `:::` attributes keep what is written. No override touches the tokenizers that build them.[^not-read]

### The save escapes the `&` of every reference

`needsEscape` in `markdownSerializer.ts` escapes an `&` when `startsWithCharacterReference` holds at it: a numeric reference, or a name the table holds. This replaces `marked-upgrade`'s numeric-only case at the same line. `writeLinkDestination`, `serializeCode`, and source mode's `formatDestination` and `quotedTitle` escape references with `escapeCharacterReferences`.[^escape]

| Text in the editor | Saved |
|---|---|
| `&copy;` | `\&copy;` |
| `&amp; &#35;` | `\&amp; \&#35;` |
| `&notaname; &Copy; &copy` | unchanged |
| link URL `/a&copy;&b` | `(/a\&copy;&b)` |

### A heading id reads the heading's references

`nextHeadingId` in `Markdown.ts` slugifies `decodeCharacterReferences(text)`, so `# Terms &amp; Conditions` and `# Terms & Conditions` both get `id="terms-conditions"`. Without this, an editor save that writes the heading's `&amp;` as `&` would change its id.[^slug]

### The edit fuzz counts words as read

`checkNoWordLost` in `markdown-edit-fuzz.test.ts` reads the source's words with references read, and accepts a word of the save either as written or as read.[^fuzz-words]

---

## Public API

None. Two new internal modules, neither re-exported from `component/display/index.ts`:

```ts
// component/display/htmlNamedCharacterReferences.ts (generated)
export const HTML_NAMED_CHARACTER_REFERENCES: ReadonlyMap<string, string>;

// component/display/markdownCharacterReferences.ts
export function decodeCharacterReferences(text: string): string;
export function decodeEscapesAndCharacterReferences(text: string): string;
export function startsWithCharacterReference(text: string): boolean;
export function escapeCharacterReferences(text: string): string;
```

---

## Internal Structure

### `packages/lib/scripts/import-html-entities.mjs`

The whole file:

```js
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * One-shot codegen for the HTML named character references.
 *
 * Reads the WHATWG list (`entities.json`, from
 * https://html.spec.whatwg.org/entities.json) and writes
 * `src/typescript/lib/component/display/htmlNamedCharacterReferences.ts`:
 * every name that ends in `;`, without its `&` and `;`, mapped to the
 * characters it stands for. The names without `;` are HTML's legacy forms,
 * which CommonMark does not read, so they are left out. The WHATWG list is
 * static: it will not be expanded or changed, so the output never needs
 * regenerating.
 *
 * Usage:
 *   curl -sS -o /tmp/entities.json https://html.spec.whatwg.org/entities.json
 *   node scripts/import-html-entities.mjs /tmp/entities.json
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** The number of names ending in `;` in the WHATWG list; a different count means the input is not that list. */
const EXPECTED_NAMES = 2125;

const LIB_ROOT = resolve(new URL("..", import.meta.url).pathname);
const OUT_FILE = join(LIB_ROOT, "src/typescript/lib/component/display/htmlNamedCharacterReferences.ts");

/**
 * Writes a string as a double-quoted TypeScript literal with every character
 * outside printable ASCII as a `\u` escape, so the generated file holds no
 * invisible or combining character.
 *
 * @param {string} text - The characters a name stands for.
 * @returns {string} The literal.
 */
function literal(text) {
    let out = "";

    for (const unit of text) {
        const code = unit.codePointAt(0);

        if (code >= 0x20 && code < 0x7f && unit !== "\"" && unit !== "\\") {
            out += unit;
        } else if (code > 0xffff) {
            out += `\\u{${code.toString(16).toUpperCase()}}`;
        } else {
            out += `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
        }
    }

    return `"${out}"`;
}

const [, , input] = process.argv;

if (input === undefined) {
    throw new Error("Usage: node scripts/import-html-entities.mjs <entities.json>");
}

const list = JSON.parse(await readFile(input, "utf8"));
const entries = Object.entries(list)
    .filter(([name]) => name.endsWith(";"))
    .map(([name, { characters }]) => [name.slice(1, -1), characters])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

if (entries.length !== EXPECTED_NAMES) {
    throw new Error(`Expected ${EXPECTED_NAMES} names ending in ";", found ${entries.length}`);
}

const lines = entries.map(([name, characters]) => `    ["${name}", ${literal(characters)}],`);

await writeFile(OUT_FILE, `// SPDX-License-Identifier: BSD-3-Clause
// Source: the HTML Standard's named character references,
// https://html.spec.whatwg.org/entities.json
// Copyright © WHATWG (Apple, Google, Mozilla, Microsoft).
// Generated by scripts/import-html-entities.mjs; do not edit.

/**
 * Every HTML named character reference CommonMark reads: the name between
 * \`&\` and \`;\`, mapped to the characters it stands for. Names are case
 * sensitive (\`&amp;\` and \`&AMP;\` are both listed; \`&Amp;\` is not).
 */
export const HTML_NAMED_CHARACTER_REFERENCES: ReadonlyMap<string, string> = new Map([
${lines.join("\n")}
]);
`);

console.log(`Wrote ${entries.length} names to ${OUT_FILE}`);
```

### `packages/lib/src/typescript/lib/component/display/markdownCharacterReferences.ts`

The whole file:

```ts
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { HTML_NAMED_CHARACTER_REFERENCES } from "~/component/display/htmlNamedCharacterReferences.js";

/**
 * A character reference as CommonMark reads one, anywhere in a text: `&`, then
 * `#` and one to seven decimal digits (capture 1), `#x` or `#X` and one to six
 * hexadecimal digits (capture 2), or a name — a letter, then one to 31 letters
 * or digits (capture 3) — then `;`. A name stands for characters only when
 * {@link HTML_NAMED_CHARACTER_REFERENCES} lists it; the digit counts and the
 * name length are CommonMark's (and `marked`'s for the numeric forms).
 */
const CHARACTER_REFERENCE = /&(?:#(\d{1,7})|#[Xx]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g;

/** {@link CHARACTER_REFERENCE} anchored at the start of the text, for the serializer's per-character check. */
const LEADING_CHARACTER_REFERENCE = /^&(?:#(\d{1,7})|#[Xx]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/;

/**
 * A backslash escape (capture 1: the escaped character) or a character
 * reference (captures 2 to 4, as {@link CHARACTER_REFERENCE}'s 1 to 3), read
 * left to right in one pass, so `\&copy;` is an escaped `&` and `copy;`, and
 * `&#92;&copy;` is a backslash and `©`. The escapable characters are
 * `marked`'s own (its `anyPunctuation` rule): Unicode punctuation and symbols.
 */
const ESCAPE_OR_CHARACTER_REFERENCE = /\\([\p{P}\p{S}])|&(?:#(\d{1,7})|#[Xx]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/gu;

/** What a numeric reference to no character (zero, a surrogate, or past U+10FFFF) stands for, per CommonMark. */
const REPLACEMENT_CHARACTER = "\uFFFD";

/** The highest Unicode code point. */
const LAST_CODE_POINT = 0x10ffff;

/** The first and last UTF-16 surrogate code points, which no numeric reference may name. */
const FIRST_SURROGATE = 0xd800;
const LAST_SURROGATE = 0xdfff;

/**
 * The characters one matched reference stands for.
 *
 * @param reference - The reference as written.
 * @param decimal - Its decimal digits, when it is a decimal reference.
 * @param hex - Its hexadecimal digits, when it is a hexadecimal reference.
 * @param name - Its name, when it is a named reference.
 * @returns The characters, or `reference` itself for a name the list does not hold.
 */
function referencedCharacters(reference: string, decimal: string | undefined, hex: string | undefined, name: string | undefined): string {
    if (name !== undefined) {
        return HTML_NAMED_CHARACTER_REFERENCES.get(name) ?? reference;
    }

    const code = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex!, 16);
    const named = code !== 0 && code <= LAST_CODE_POINT && (code < FIRST_SURROGATE || code > LAST_SURROGATE);

    return named ? String.fromCodePoint(code) : REPLACEMENT_CHARACTER;
}

/**
 * Reads every character reference in a run of Markdown text as the
 * characters it stands for: `&copy;` and `&#169;` as `©`. A name the HTML
 * list does not hold (`&notaname;`), a name without its `;` (`&copy`) and a
 * number with too many digits stay as written.
 *
 * @param text - The text as written.
 * @returns The text as read.
 */
export function decodeCharacterReferences(text: string): string {
    return text.replace(CHARACTER_REFERENCE, referencedCharacters);
}

/**
 * Reads a link destination, a link title or a code fence's info string as
 * CommonMark does: backslash escapes and character references together, in
 * one pass from the left.
 *
 * @param text - The destination, title or info string as written, its
 *   escapes still in it.
 * @returns It as read.
 */
export function decodeEscapesAndCharacterReferences(text: string): string {
    return text.replace(ESCAPE_OR_CHARACTER_REFERENCE, (match, escaped: string | undefined, decimal: string | undefined, hex: string | undefined, name: string | undefined) => (
        escaped !== undefined ? escaped : referencedCharacters(match, decimal, hex, name)
    ));
}

/**
 * Tells whether the text starts with a character reference that would be
 * read as other characters: a numeric one, or a name the HTML list holds.
 *
 * @param text - The text, from the `&` on.
 * @returns `true` when a save must escape that `&` to keep the text as typed.
 */
export function startsWithCharacterReference(text: string): boolean {
    const match = LEADING_CHARACTER_REFERENCE.exec(text);

    return match !== null && (match[3] === undefined || HTML_NAMED_CHARACTER_REFERENCES.has(match[3]));
}

/**
 * Puts a backslash before every `&` that starts a character reference, so a
 * link destination or title written with it reads back as the text it was.
 *
 * @param text - The destination or title as the editor holds it.
 * @returns It with each such `&` escaped.
 */
export function escapeCharacterReferences(text: string): string {
    return text.replace(CHARACTER_REFERENCE, (match, _decimal: string | undefined, _hex: string | undefined, name: string | undefined) => (
        name === undefined || HTML_NAMED_CHARACTER_REFERENCES.has(name) ? "\\" + match : match
    ));
}
```

### The tokenizers, in `markdownExtensions.ts`

Add after the closing `}` of `htmlWithInputEndAsLineEnd` ([markdownExtensions.ts:502](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L502)) and before the doc comment of `DIALECT_BLOCK_TOKENIZERS`, with one blank line on each side:

```ts
/** A pattern that matches nothing: `marked`'s unescape rule, switched off. */
const MATCHES_NOTHING = /(?!)/gu;

/**
 * The view {@link keepingEscapes} made for each rules object. `marked` gives
 * the tokenizer a new rules object for every lexer it makes, so this holds
 * one view per lex, made on that lex's first link, definition or code fence.
 */
const VIEWS_KEEPING_ESCAPES = new WeakMap<Tokenizer["rules"], Tokenizer>();

/**
 * A view of the tokenizer whose `anyPunctuation` rule matches nothing, so the
 * destination, title and info string `marked` builds keep their backslash
 * escapes as written. The view shares everything else with the tokenizer,
 * through its prototype: its lexer, options and state.
 *
 * @param tokenizer - The tokenizer `marked` called.
 * @returns The view.
 */
function keepingEscapes(tokenizer: Tokenizer): Tokenizer {
    let view = VIEWS_KEEPING_ESCAPES.get(tokenizer.rules);

    if (view === undefined) {
        const rules = { ...tokenizer.rules, inline: { ...tokenizer.rules.inline, anyPunctuation: MATCHES_NOTHING } };

        view = Object.create(tokenizer, { rules: { value: rules } }) as Tokenizer;
        VIEWS_KEEPING_ESCAPES.set(tokenizer.rules, view);
    }

    return view;
}

/**
 * The four tokenizers that read character references (`&copy;`, `&#169;`)
 * where CommonMark reads them: in text, link destinations and titles (inline
 * links and link reference definitions, so a reference link gets its
 * definition's read values), and code fence info strings. `marked` reads only
 * numeric references, and only in text; it keeps a named one as written. Each
 * runs `marked`'s own method; `link`, `def` and `fences` run it on
 * {@link keepingEscapes}'s view and then read the escapes and references
 * together ({@link decodeEscapesAndCharacterReferences}), so an escaped `&`
 * (`\&copy;`) stays text. Text inside raw HTML (`marked`'s `escaped`), code
 * spans, code blocks and autolinks is not read: those keep what is written.
 */
const CHARACTER_REFERENCE_TOKENIZERS: TokenizerObject = {
    inlineText(src) {
        const token = Tokenizer.prototype.inlineText.call(this, src);

        if (token !== undefined && token.escaped !== true) {
            token.text = decodeCharacterReferences(token.raw);
        }

        return token;
    },
    link(src) {
        const token = Tokenizer.prototype.link.call(keepingEscapes(this), src);

        if (token !== undefined) {
            token.href = decodeEscapesAndCharacterReferences(token.href);

            if (token.title) {
                token.title = decodeEscapesAndCharacterReferences(token.title);
            }
        }

        return token;
    },
    def(src) {
        const token = Tokenizer.prototype.def.call(keepingEscapes(this), src);

        if (token !== undefined) {
            token.href = decodeEscapesAndCharacterReferences(token.href);

            if (token.title) {
                token.title = decodeEscapesAndCharacterReferences(token.title);
            }
        }

        return token;
    },
    fences(src) {
        const token = Tokenizer.prototype.fences.call(keepingEscapes(this), src);

        if (token?.lang) {
            token.lang = decodeEscapesAndCharacterReferences(token.lang);
        }

        return token;
    },
};
```

---

## Ordered Implementation Steps

Work in the plan's worktree, `.worktrees/markdown-named-character-references`, on a branch from the tip of `marked-upgrade`. Its `node_modules` and `packages/lib/node_modules` are symlinks to the main tree's. This plan adds no dependency: never run `npm install`, `npm ci` or `npm update`. Run commands from `packages/lib` unless a step says otherwise. Each `-` line of a `diff` block occurs once in its file; find it by its text, not by a line number.

Check first: `node -p "require('marked/package.json').version"` prints `18.1.0`, and `grep -n 'NUMERIC_CHARACTER_REFERENCE' src/typescript/lib/component/editor/markdownSerializer.ts` finds the constant and its `case "&"` line that `marked-upgrade` added. When either check fails, stop: `marked-upgrade` has not landed.

### Part A — the table and the decoder

1. **Create the generator.** Create `packages/lib/scripts/import-html-entities.mjs` with the text in `## Internal Structure`, unchanged.

2. **Generate the table.** Download the list outside the repository, check it, and run the generator:

   ```sh
   curl -sS -o "$SCRATCH/entities.json" https://html.spec.whatwg.org/entities.json
   sha256sum "$SCRATCH/entities.json"
   node scripts/import-html-entities.mjs "$SCRATCH/entities.json"
   sha256sum src/typescript/lib/component/display/htmlNamedCharacterReferences.ts
   ```

   `$SCRATCH` is any folder outside the repository, such as your scratchpad directory. When the download fails, use the copy at `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans4/named-refs/whatwg/entities.json`.
   - Check: the list's hash is `d741d877ac77c4194c4ad526b5b4a19aef8dfe411ab840a466891cdbb9f362e6`. When it is not, stop and report it.
   - Check: the script prints `Wrote 2125 names to …`, the generated file has 2,138 lines, and its hash is `fed00a098c825d70aa0ac291a76d462d1dda046e50aef2dccd27a17912015bfe`.
   - Do not edit the generated file by hand, and do not add `entities.json` to the repository.

3. **Write the decoder's tests.** Create `packages/lib/tests/component/display/markdownCharacterReferences.test.ts`:

   ```ts
   // SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

   import { describe, it, expect } from 'vitest';
   import { HTML_NAMED_CHARACTER_REFERENCES } from '~/component/display/htmlNamedCharacterReferences';
   import {
       decodeCharacterReferences, decodeEscapesAndCharacterReferences, escapeCharacterReferences, startsWithCharacterReference,
   } from '~/component/display/markdownCharacterReferences';

   describe('HTML_NAMED_CHARACTER_REFERENCES', () => {
       it('CR1. holds the 2,125 names of the WHATWG list that end in ";", spelled as the list spells them', () => {
           expect(HTML_NAMED_CHARACTER_REFERENCES.size).toBe(2125);
           expect(HTML_NAMED_CHARACTER_REFERENCES.get('copy')).toBe('\u00A9');
           expect(HTML_NAMED_CHARACTER_REFERENCES.get('COPY')).toBe('\u00A9');
           expect(HTML_NAMED_CHARACTER_REFERENCES.has('Copy')).toBe(false);
           expect(HTML_NAMED_CHARACTER_REFERENCES.get('ngE')).toBe('\u2267\u0338');
           expect(HTML_NAMED_CHARACTER_REFERENCES.get('Afr')).toBe('\u{1D504}');
           expect(HTML_NAMED_CHARACTER_REFERENCES.get('fjlig')).toBe('fj');
           expect(HTML_NAMED_CHARACTER_REFERENCES.has('toString')).toBe(false);
       });
   });

   describe('decodeCharacterReferences', () => {
       it.each([
           ['CR2', '&copy; &amp; &AElig; &ngE; &CounterClockwiseContourIntegral;', '\u00A9 & \u00C6 \u2267\u0338 \u2233'],
           ['CR3', '&#35; &#x41; &#X22; &#0; &#xD800; &#1114112;', '# A " \uFFFD \uFFFD \uFFFD'],
           ['CR4', '&notaname; &copy &copyx; &Copy; &toString; &hi?;', '&notaname; &copy &copyx; &Copy; &toString; &hi?;'],
           ['CR5', '&#12345678; &#abc; &#; &#x; &#x1234567;', '&#12345678; &#abc; &#; &#x; &#x1234567;'],
           ['CR6', '&amp;copy; &#38;copy; a&copy;b', '&copy; &copy; a\u00A9b'],
       ])('%s: %j reads as %j', (_id, text, read) => {
           expect(decodeCharacterReferences(text)).toBe(read);
       });
   });

   describe('decodeEscapesAndCharacterReferences', () => {
       it.each([
           ['CR7', '/f&ouml;&ouml;', '/f\u00F6\u00F6'],
           ['CR8', '/a\\&copy;', '/a&copy;'],
           ['CR9', '\\\\&copy;', '\\\u00A9'],
           ['CR10', '&#92;&copy; a\\*b \\a', '\\\u00A9 a*b \\a'],
       ])('%s: %j reads as %j', (_id, text, read) => {
           expect(decodeEscapesAndCharacterReferences(text)).toBe(read);
       });
   });

   describe('startsWithCharacterReference and escapeCharacterReferences', () => {
       it.each([
           ['&copy; x', true], ['&COPY;', true], ['&#35;', true], ['&#x41;', true], ['&#0;', true],
           ['&notaname;', false], ['&Copy;', false], ['&copy', false], ['&#12345678;', false], ['& copy;', false], ['x&copy;', false],
       ])('CR11: %j starts with a reference: %s', (text, starts) => {
           expect(startsWithCharacterReference(text)).toBe(starts);
       });

       it('CR12: escapes the & of each reference and of nothing else', () => {
           expect(escapeCharacterReferences('/a&copy;&b=1&#35;&notaname;&amp')).toBe('/a\\&copy;&b=1\\&#35;&notaname;&amp');
       });
   });
   ```

   - Check: `npx vitest run tests/component/display/markdownCharacterReferences.test.ts` fails to import `~/component/display/markdownCharacterReferences`.

4. **Write the decoder.** Create `packages/lib/src/typescript/lib/component/display/markdownCharacterReferences.ts` with the text in `## Internal Structure`, unchanged.
   - Check: the same command reports 22 passed.

### Part B — reading

5. **Viewer tests.** In `tests/component/display/Markdown.test.ts`, in `describe('Markdown heading ids'`, add after the test `re-renders the same id on a second setMarkdown call with the same single-heading source`, as the last test of the `describe`:

   ```ts

       // A heading id is read from the heading's text with its character references read, so `&amp;` and `&` give one id
       // and an edit that writes the character itself keeps the id.
       it('CR20: reads character references before slugifying, so `&amp;` and `&` give one id', () => {
           new Markdown('# Terms &amp; Conditions\n\n## Terms & Conditions\n\n### &#35;1 &copy;').getElement(true);

           expect(attrWrites().map((a) => a.id).filter((id) => id !== undefined)).toEqual(['terms-conditions', 'terms-conditions-1', '1']);
       });
   ```

   Add a new `describe` directly after the one that ends with the `CF1` test (`describe('Markdown fenced code block'`), before `describe('Markdown fenced code block — CodeEditor upgrade wiring'`:

   ````ts
   describe('Markdown character references', () => {
       // CommonMark 25, 28, 29, 30: a named reference the HTML list holds reads as its characters; any other `&…;`, and a
       // name without its `;`, stays as written.
       it('CR21: reads a named or numeric reference in text as its characters, and leaves the rest as written', () => {
           new Markdown('&copy; &amp; &ngE; &#35; &notaname; &copy &Copy;').getElement(true);

           expect(textWrites()).toEqual(['\u00A9 & \u2267\u0338 # &notaname; &copy &Copy;']);
       });

       // CommonMark 32, 33: references are read in a link destination and title, an inline link's or a definition's.
       it('CR22: reads references in a link destination, and keeps a backslash-escaped & as written', () => {
           new Markdown('[a](/f&ouml;&ouml;) [b](/x\\&copy;) [c] [d](/n&#35;1)\n\n[c]: /d&amp;e').getElement(true);

           expect(attrWrites().map((a) => a.href).filter((href) => href !== undefined)).toEqual(['/f\u00F6\u00F6', '/x&copy;', '/d&e', '/n#1']);
       });

       // CommonMark 35, 36: a code span and a code block keep their text as written.
       it('CR23: keeps references in a code span and in a code block as written', () => {
           new Markdown('`&copy;`\n\n    &amp;').getElement(true);

           expect(trimmedTextWrites()).toEqual(['&copy;', '&amp;']);
       });

       // CommonMark 34: a fence's info string is read, so `j&#115;` names the js language.
       it('CR24: reads references in a code fence\'s info string', () => {
           new Markdown('```j&#115;\nconst a = 1;\n```').getElement(true);

           expect(classWrites()).toContainEqual(['ts-ui-md-code-host']);
       });

       // Text inside an autolink is its destination as written; raw HTML is shown as written.
       it('CR25: keeps references in an autolink and in an HTML block as written', () => {
           new Markdown('<https://a.test/?q&copy;>\n\n<div>&copy;</div>').getElement(true);

           expect(attrWrites().map((a) => a.href).filter((href) => href !== undefined)).toEqual(['https://a.test/?q&copy;']);
           expect(trimmedTextWrites()).toEqual(['https://a.test/?q&copy;', '<div>&copy;</div>']);
       });
   });

   ````

   - Check: `npx vitest run tests/component/display/Markdown.test.ts` fails CR20, CR21, CR22 and CR24; CR23 and CR25 pass.

6. **Importer rows.** In `tests/component/markdown-importer.test.ts`, in the `rows` of `describe('$importMarkdown — round trips (R rows)'`, add after the row `R12`:

   ```ts
           ['R13', '&copy; &amp; x', '\u00A9 & x'],
           ['R17', '# Terms &amp; Conditions', '# Terms & Conditions'],
   ```

   (`R14` to `R16` follow in step 12, between these two.)
   - Check: `npx vitest run tests/component/markdown-importer.test.ts` fails R13 and R17.

7. **CommonMark corpus rows.** In `tests/component/markdown-roundtrip/corpus/commonmark.ts`, add the section's missing examples and give rows 32 and 33 their links:

   ```diff
   +    { name: 'CommonMark 25 (Entity and numeric character references)', source: '&nbsp; &amp; &copy; &AElig; &Dcaron;\n&frac34; &HilbertSpace; &DifferentialD;\n&ClockwiseContourIntegral; &ngE;\n' },
        { name: 'CommonMark 26 (Entity and numeric character references)', source: '&#35; &#1234; &#992; &#0;\n' },
   +    { name: 'CommonMark 27 (Entity and numeric character references)', source: '&#X22; &#XD06; &#xcab;\n' },
   +    { name: 'CommonMark 28 (Entity and numeric character references)', source: '&nbsp &x; &#; &#x;\n&#87654321;\n&#abcdef0;\n&ThisIsNotDefined; &hi?;\n' },
        { name: 'CommonMark 29 (Entity and numeric character references)', source: '&copy\n' },
   -    { name: 'CommonMark 32 (Entity and numeric character references)', source: '[foo](/f&ouml;&ouml; "f&ouml;&ouml;")\n' },
   +    { name: 'CommonMark 30 (Entity and numeric character references)', source: '&MadeUpEntity;\n' },
   +    { name: 'CommonMark 31 (Entity and numeric character references)', source: '<a href="&ouml;&ouml;.html">\n' },
   +    { name: 'CommonMark 32 (Entity and numeric character references)', source: '[foo](/f&ouml;&ouml; "f&ouml;&ouml;")\n', links: ['/f\u00F6\u00F6'] },
   +    { name: 'CommonMark 33 (Entity and numeric character references)', source: '[foo]\n\n[foo]: /f&ouml;&ouml; "f&ouml;&ouml;"\n', links: ['/f\u00F6\u00F6'] },
   +    { name: 'CommonMark 34 (Entity and numeric character references)', source: '``` f&ouml;&ouml;\nfoo\n```\n' },
        { name: 'CommonMark 35 (Entity and numeric character references)', source: '`f&ouml;&ouml;`\n' },
   +    { name: 'CommonMark 36 (Entity and numeric character references)', source: '    f&ouml;f&ouml;\n' },
        { name: 'CommonMark 37 (Entity and numeric character references)', source: '&#42;foo&#42;\n*foo*\n' },
        { name: 'CommonMark 38 (Entity and numeric character references)', source: '&#42; foo\n\n* foo\n' },
   +    { name: 'CommonMark 39 (Entity and numeric character references)', source: 'foo&#10;&#10;bar\n' },
   +    { name: 'CommonMark 40 (Entity and numeric character references)', source: '&#9;foo\n' },
   +    { name: 'CommonMark 41 (Entity and numeric character references)', source: '[a](url &quot;tit&quot;)\n' },
   ```

8. **The fuzz's word count.** In `tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts`, add the import after the `@lexical/utils` import:

   ```ts
   import { decodeCharacterReferences } from '~/component/display/markdownCharacterReferences';
   ```

   In the doc comment above `checkNoWordLost`, after the line ending `is not required: the link is written inline once its definition no longer resolves it.`, add:

   ```ts
    * The source's words are its words as read, its character references read (`&amp;` is `&`, no word), since a block
    * the save writes again writes a reference as its character; a save's words are its words as written and as read,
    * since a block it keeps keeps its references (`j&#115;` is still `js`).
   ```

   In its body:

   ```diff
   -    const kept = [...wordsOf(testCase.source)].filter((word) => !run.record.released.has(word) && !labels.has(word));
   -    const savedWords = wordsOf(run.saved);
   +    const kept = [...wordsOf(decodeCharacterReferences(testCase.source))].filter((word) => !run.record.released.has(word) && !labels.has(word));
   +    const savedWords = new Set([...wordsOf(run.saved), ...wordsOf(decodeCharacterReferences(run.saved))]);
   ```

   - Check: `npx vitest run tests/component/markdown-roundtrip` fails exactly `CommonMark 32 … viewer reads the declared links` and `CommonMark 33 … viewer reads the declared links`.

9. **Read the references.** In `src/typescript/lib/component/display/markdownExtensions.ts`:
   - Add the import, after the `markdownAttributes.js` import:
     ```ts
     import { decodeCharacterReferences, decodeEscapesAndCharacterReferences } from "~/component/display/markdownCharacterReferences.js";
     ```
   - Add the block of `## Internal Structure`, *The tokenizers*.
   - Install it on both instances:
     ```diff
     -const _marked = new Marked({ extensions: MARKDOWN_EXTENSIONS, tokenizer: BOUNDED_BLOCK_TOKENIZERS });
     +const _marked = new Marked({ extensions: MARKDOWN_EXTENSIONS, tokenizer: { ...BOUNDED_BLOCK_TOKENIZERS, ...CHARACTER_REFERENCE_TOKENIZERS } });
     ```
     ```diff
     -    _unboundedMarked ??= new Marked({ extensions: MARKDOWN_EXTENSIONS, tokenizer: DIALECT_BLOCK_TOKENIZERS });
     +    _unboundedMarked ??= new Marked({ extensions: MARKDOWN_EXTENSIONS, tokenizer: { ...DIALECT_BLOCK_TOKENIZERS, ...CHARACTER_REFERENCE_TOKENIZERS } });
     ```
   - In the doc comment of `lexMarkdownUnbounded`:
     ```diff
     - * the dialect's own `table`, `blockquote`, `list` and `html` tokenizers, so
     - * the guards and windows are the only difference.
     + * the dialect's own `table`, `blockquote`, `list` and `html` tokenizers and
     + * its character-reference tokenizers, so the guards and windows are the only
     + * difference.
     ```

10. **The heading id.** In `src/typescript/lib/component/display/Markdown.ts`, add the import directly above `import { lexMarkdown } from "~/component/display/markdownExtensions.js";`:

    ```ts
    import { decodeCharacterReferences } from "~/component/display/markdownCharacterReferences.js";
    ```

    In `nextHeadingId` ([Markdown.ts:426](packages/lib/src/typescript/lib/component/display/Markdown.ts#L426)):

    ```diff
    - * @param text - The heading's plain text.
    + * @param text - The heading's text as written; its character references are
    + *   read before it is slugified, so `&amp;` and `&` give one id.
    ```
    ```diff
    -    const slug = slugify(text);
    +    const slug = slugify(decodeCharacterReferences(text));
    ```

11. **Two importer tests that pinned a reference as typed.** In `tests/component/markdown-importer.test.ts`, replace test `I28`:

    ```diff
    -    it('I28: an entity stays text and an escape is its character, in one text node', () => {
    -        const editor = load('&amp; \\*');
    -
    -        expect(firstBlockInline(editor)).toEqual([{ text: '&amp; *' }]);
    -        expectSurface(editor, '&amp; \\*');
    +    it('I28: a character reference and an escape are each their character, in one text node', () => {
    +        const editor = load('&amp; &copy; \\* &notaname;');
    +
    +        expect(firstBlockInline(editor)).toEqual([{ text: '& \u00A9 * &notaname;' }]);
    +        expectSurface(editor, '&amp; &copy; \\* &notaname;');
    ```

    In test `a format a selection from a list into the next paragraph cannot apply keeps a construct kept as written in the list`, the `&amp;` is filler; give it plain text of the same length:

    ```diff
    -            const source = '- ~[![a](/i.png)](/p) [<https://b.test/p_(q)>](/out)~\n- [[e &amp;](/x)]\n\nf';
    +            const source = '- ~[![a](/i.png)](/p) [<https://b.test/p_(q)>](/out)~\n- [[e and x](/x)]\n\nf';
    ```
    ```diff
    -            select(editor, ['e &amp;', 6], ['f', 1]);
    +            select(editor, ['e and x', 6], ['f', 1]);
    ```

    - Check, the checkpoint of part B: run the 32 Markdown test files (`npx vitest run $(find tests -name '*.test.ts' | grep -i markdown)`). Exactly one test fails: `E10` of `markdown-serializer.test.ts`, which part C changes. A test that fails and is not `E10` was added by a plan that landed after `marked-upgrade`: see `## Potential Challenges`.

### Part C — writing

12. **Tests of the save.**

    `tests/component/markdown-serializer.test.ts`, in the `cases` of `describe('$serializeMarkdown — escaping'`:

    ```diff
    -        ['E10', '&amp; &#35;', '&amp; \\&#35;'],
    +        ['E10', '&amp; &#35;', '\\&amp; \\&#35;'],
    ```

    Add after `E13`:

    ```ts
            ['E14', '&copy; &COPY; a&ngE;', '\\&copy; \\&COPY; a\\&ngE;'],
            ['E15', '&notaname; &Copy; &copy &toString;', '&notaname; &Copy; &copy &toString;'],
            ['E16', '&amp;copy;', '\\&amp;copy;'],
            ['E17', '\\&copy;', '\\\\\\&copy;'],
    ```

    Add directly above `describe('$serializeMarkdown — further cases the plan specifies'`:

    ````ts
    describe('$serializeMarkdown — character references in a link and a code fence', () => {
        it('E18: escapes the & of a reference in a link destination and title, so the link reads back as held', () => {
            const output = serialize(() => [p(fill($createLinkNode('/a&copy;&b', { title: 't&amp;' }), ['x']))]);

            expect(output).toBe('[x](/a\\&copy;&b "t\\&amp;")');
            expect(viewerModel(output).blocks).toEqual([para(run('x', [], { href: '/a&copy;&b', title: 't&amp;' }))]);
        });

        it('E19: escapes it inside an angle-bracket destination too', () => {
            const output = serialize(() => [p(fill($createLinkNode('/a b&#35;'), ['x']))]);

            expect(output).toBe('[x](</a b\\&#35;>)');
            expect(viewerModel(output).blocks).toEqual([para(run('x', [], { href: '/a b&#35;', title: null }))]);
        });

        it('E20: writes an autolink as it is, since an autolink reads no reference', () => {
            const url = 'https://a.test/?q&copy;';
            const output = serialize(() => [p(fill($createLinkNode(url), [url]))]);

            expect(output).toBe(`<${url}>`);
            expect(viewerModel(output).blocks).toEqual([para(run(url, [], { href: url, title: null }))]);
        });

        it('E21: escapes the & of a reference in a code block\'s language', () => {
            const output = serialize(() => [$createCodeNode('c&amp;')]);

            expect(output).toBe('```c\\&amp;\n```');
            expect(viewerModel(output).blocks).toEqual([{ kind: 'code', lang: 'c&amp;', text: '' }]);
        });
    });

    ````

    `tests/component/markdown-importer.test.ts`, after test `I28`:

    ````ts

        it('I29: a code block takes its language from the info string as read, and keeps the info string as written', () => {
            const editor = load('```j&#115; x\ncode\n```');

            expect(readDocument(editor, () => {
                const code = $getRoot().getFirstChild();

                return $isCodeNode(code) ? code.getLanguage() : null;
            })).toBe('js');
            expect(canonicalSave(editor)).toBe('```j&#115; x\ncode\n```');
        });
    ````

    and in the R rows, between `R13` and `R17`:

    ```ts
            ['R14', '&amp;copy; and \\&copy;', '\\&copy; and \\&copy;'],
            ['R15', '[a](/f&ouml; "t&amp;amp;")', '[a](/f\u00F6 "t\\&amp;")'],
            ['R16', '[x](/a\\&copy;)', '[x](/a\\&copy;)'],
    ```

    `tests/component/markdown-source-edits.test.ts`, in `describe('link commands'`, directly above the test `refuses to wrap a link inside an image's alt text`:

    ```ts
        it('escapes the & of a character reference in a new link\'s URL, so the link reads back to that URL', () => {
            const text = 'see docs here';

            expect(apply(text, linkSource('/a&copy;')(text, 4, 8)!)).toBe('see [docs](/a\\&copy;) here');
            expect(apply(text, linkSource('/a b&amp;')(text, 4, 8)!)).toBe('see [docs](</a b\\&amp;>) here');
        });

        it('escapes it in the title a reference link brings when it becomes an inline link', () => {
            const text = 'see [docs][r]\n\n[r]: /d "&amp;copy;"';

            expect(apply(text, linkSource('/e')(text, 6, 6)!)).toBe('see [docs](/e "\\&copy;")\n\n[r]: /d "&amp;copy;"');
        });

    ```

    `tests/component/markdown-editor.test.ts`, as the last rows of `const SAME: ParityRow[] = [`, after the row `E19` with command `h2`:

    ````ts
            // Text that would read as a character reference keeps its escaped `&` on both surfaces.
            ['CR1', '\\&copy; one & x', 'one', null, 'h2', '## \\&copy; one & x', '## \\&copy; one & x'],
            ['CR1', '\\&copy; one & x', 'one', null, 'quote', '> \\&copy; one & x', '> \\&copy; one & x'],
            ['CR1', '\\&copy; one & x', 'one', null, 'code', '```\n\\&copy; one & x\n```', '```\n\\&copy; one & x\n```'],
            ['CR1', '\\&copy; one & x', 'one', null, 'UL', '- \\&copy; one & x', '- \\&copy; one & x'],
    ````

    - Check: the four files fail E10, E14, E16, E17, E18, E19, E21, I29, R14, R15, the two new source-edit tests and the four `CR1` rows; E15, E20 and R16 pass.

13. **Dialect corpus rows.** `tests/component/markdown-roundtrip/corpus/dialect.ts`, after the row `named and numeric entities`:

    ````ts
        { name: 'character references that spell syntax', source: '&ast;a&ast; &num; b &lsqb;c&rsqb;(/d) &lt;div&gt; &amp;copy;' },
        { name: 'escaped character references', source: '\\&copy; \\&#35; x\\&amp;' },
        { name: 'unknown character reference names', source: '&notaname; &copy &Copy; &toString;' },
        { name: 'character references in a heading', source: '# Terms &amp; Conditions &copy;' },
        { name: 'character references in a table', source: '| &copy; | b |\n|---|---|\n| &amp;lt; | &#35; |' },
        { name: 'character references in emphasis, a styled span and a list', source: '- **&copy;** [&amp;]{color=red}\n- ++&lt;++' },
        { name: 'character references in a link title and a definition', source: '[a](/u "t&amp;") [b]\n\n[b]: /v&copy; "&quot;q&quot;"', links: ['/u', '/v\u00A9'] },
        { name: 'character reference after a www autolink', source: 'www.a.test/?q=1&copy;', links: ['http://www.a.test/?q=1'] },
        { name: 'character reference in a code fence info string', source: '```j&#115; x\nconst a = 1;\n```' },
        { name: 'non-breaking spaces from character references', source: '&nbsp;a&nbsp; b' },
    ````

    `tests/component/markdown-roundtrip/corpus/referenceLinks.ts`, after the row `entity in a label`:

    ```ts
        { name: 'named entity in a label', source: '[&copy;] and [x][&amp;]\n\n[&copy;]: /c\n[&amp;]: /a', links: ['/c', '/a'] },
    ```

    - Check: `npx vitest run tests/component/markdown-roundtrip` fails `canonical`, `canonicalIdempotence` and `edits` of the three rows `character references that spell syntax`, `escaped character references` and `character references in a table`: nine tests.

14. **The serializer.** In `src/typescript/lib/component/editor/markdownSerializer.ts`:
    - Add the import directly after `import type { MdBlockToken } from "~/component/display/markdownExtensions.js";`:
      ```ts
      import {
          decodeEscapesAndCharacterReferences, escapeCharacterReferences, startsWithCharacterReference,
      } from "~/component/display/markdownCharacterReferences.js";
      ```
    - Delete the constant `NUMERIC_CHARACTER_REFERENCE` that `marked-upgrade` added after `EMAIL_DOMAIN_CHARACTER`: its doc comment (it starts `A numeric character reference at the start of the text`), the `const` line, and the one blank line after it.
    - In `needsEscape`:
      ```diff
      -        case "&":  return NUMERIC_CHARACTER_REFERENCE.test(site.text.slice(site.index));
      +        case "&":  return startsWithCharacterReference(site.text.slice(site.index));
      ```
      and in its doc comment:
      ```diff
      - * of `www.` and the `@` of an email address (GFM autolinks); a `!` just
      + * of `www.` and the `@` of an email address (GFM autolinks); an `&` that
      + * starts a character reference (`&copy;`, `&#35;`); a `!` just
      ```
    - In `writeLinkDestination` ([markdownSerializer.ts:4631](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L4631)):
      ```diff
      -    const destination = bare ? url : url === "" && !titled ? "" : `<${url.replace(/[\\<>]/g, "\\$&")}>`;
      +    const destination = bare ? escapeCharacterReferences(url) : url === "" && !titled ? "" : `<${escapeCharacterReferences(url.replace(/[\\<>]/g, "\\$&"))}>`;
      ```
      ```diff
      -    const written = `(${destination}${titled ? ` "${lines.replace(/[\\"]/g, "\\$&")}"` : ""})`;
      +    const written = `(${destination}${titled ? ` "${escapeCharacterReferences(lines.replace(/[\\"]/g, "\\$&"))}"` : ""})`;
      ```
      and in its doc comment:
      ```diff
      - * breaks becomes one.
      + * breaks becomes one. The `&` of a character reference is escaped in both
      + * (`\&copy;`), since `marked` reads one as its character.
      ```
    - In `serializeCode` ([markdownSerializer.ts:2333](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2333)):
      ```diff
      -    const authoredLanguage = authored.replace(/\\([!-/:-@[-`{-~])/g, "$1").split(/\s+/)[0];
      -    const info = authored !== "" && authoredLanguage === language ? authored : language;
      +    const authoredLanguage = decodeEscapesAndCharacterReferences(authored).split(/\s+/)[0];
      +    const info = authored !== "" && authoredLanguage === language ? authored : escapeCharacterReferences(language);
      ```
      and in its doc comment:
      ```diff
      - * The info string is the one the block was loaded with
      - * ({@link codeInfoState}) while its first word is still the block's
      - * language, else the language.
      + * The info string is the one the block was loaded with
      + * ({@link codeInfoState}) while its first word, read as `marked` reads it,
      + * is still the block's language, else the language with the `&` of each
      + * character reference escaped.
      ```
    - Check: `grep -rn 'NUMERIC_CHARACTER_REFERENCE' src` finds nothing.

15. **Source mode.** In `src/typescript/lib/component/editor/markdownSourceEdits.ts`:
    - Add the import directly above `import { lexMarkdown } from "~/component/display/markdownExtensions.js";`:
      ```ts
      import { escapeCharacterReferences } from "~/component/display/markdownCharacterReferences.js";
      ```
    - `quotedTitle` ([markdownSourceEdits.ts:1190](packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts#L1190)):
      ```diff
      - * Writes a title in double quotes, its `\` and `"` escaped.
      + * Writes a title in double quotes, its `\` and `"` escaped, and the `&` of
      + * each character reference.
      ```
      ```diff
      -    return title === null || title === "" ? "" : `"${title.replace(/[\\"]/g, "\\$&")}"`;
      +    return title === null || title === "" ? "" : `"${escapeCharacterReferences(title.replace(/[\\"]/g, "\\$&"))}"`;
      ```
    - `formatDestination` ([markdownSourceEdits.ts:1201](packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts#L1201)):
      ```diff
      - * parenthesis, which a bare destination cannot hold safely.
      + * parenthesis, which a bare destination cannot hold safely. The `&` of a
      + * character reference is escaped, so the destination reads back as `url`.
      ```
      ```diff
      -    return /[\s()]/.test(url) ? `<${url}>` : url;
      +    const escaped = escapeCharacterReferences(url);
      +
      +    return /[\s()]/.test(url) ? `<${escaped}>` : escaped;
      ```

16. **Checkpoint for part C.** The 32 Markdown test files report 0 failed. On the measured base they hold 10,102 tests, 229 more than before this plan.[^counts]

### Part D — documentation and notices

17. Make the edits in `## Documentation Impact`.

18. Run the checks in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/scripts/import-html-entities.mjs` |
| Create (generated, step 2) | `packages/lib/src/typescript/lib/component/display/htmlNamedCharacterReferences.ts` |
| Create | `packages/lib/src/typescript/lib/component/display/markdownCharacterReferences.ts` |
| Create | `packages/lib/tests/component/display/markdownCharacterReferences.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-serializer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-edits.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |
| Modify | `packages/lib/THIRD-PARTY-NOTICES.md` |

---

## Expected Behaviour

Every case is unit-tested; the steps hold the test code. Each expected value follows from one of four rules, not from what the code produced:

- **R1.** A reference reads as its characters where CommonMark reads one (text, destination, title, info string), and as typed everywhere else.
- **R2.** The editor shows what the viewer shows for the same source.
- **R3.** A save read by the viewer shows what the editor showed; text the editor holds that would read as a reference is saved with its `&` escaped.
- **R4.** An unedited block is saved as it was loaded.

| Case | Expected | Rule | Test |
|---|---|---|---|
| `&copy; &amp; &ngE; &#35;` | `© & ≧̸ #` in the viewer and the editor | R1, R2 | CR2, CR21, I28 |
| `&notaname;`, `&Copy;`, `&toString;`, `&copy` (no `;`), `&#12345678;`, `&#abc;` | as written | R1 | CR4, CR5, CR21 |
| `&amp;copy;`, `&#38;copy;` | `&copy;`: read once, not twice | R1 | CR6, R14 |
| `[a](/f&ouml;&ouml;)`, `[c]` with `[c]: /d&amp;e`, `[d](/n&#35;1)` | destinations `/föö`, `/d&e`, `/n#1` | R1 | CR22, CM 32, CM 33 |
| `[b](/x\&copy;)` | destination `/x&copy;` | R1 | CR8, CR22, R16 |
| `[a](/f&ouml; "t&amp;amp;")`, saved in the standard form | `[a](/fö "t\&amp;")`, which reads as the source | R3 | R15 |
| ```` ```j&#115; x ```` | language `js` (the viewer upgrades it to a `CodeEditor`); the save keeps `j&#115; x` | R1, R4 | CR24, I29 |
| `` `&copy;` ``, an indented `&amp;` | as written | R1 | CR23 |
| `<https://a.test/?q&copy;>`, `<div>&copy;</div>` | as written | R1 | CR25 |
| `# Terms &amp; Conditions`, `## Terms & Conditions` | ids `terms-conditions`, `terms-conditions-1` | R3 | CR20, R17 |
| `&copy; &amp; x`, saved in the standard form | `© & x` | R3 | R13 |
| text `&copy; &COPY; a&ngE;` saved | `\&copy; \&COPY; a\&ngE;` | R3 | E14 |
| text `&amp; &#35;` saved | `\&amp; \&#35;` | R3 | E10 |
| text `&notaname; &Copy; &copy &toString;` saved | unchanged | R3 | E15 |
| text `\&copy;` (a backslash typed before it) saved | `\\\&copy;` | R3 | E17 |
| link `/a&copy;&b` titled `t&amp;` saved | `[x](/a\&copy;&b "t\&amp;")` | R3 | E18 |
| link `/a b&#35;` saved | `[x](</a b\&#35;>)` | R3 | E19 |
| autolink `https://a.test/?q&copy;` saved | `<https://a.test/?q&copy;>` | R1, R3 | E20 |
| code block of language `c&amp;` saved | ```` ```c\&amp; ```` | R3 | E21 |
| source mode: `linkSource('/a&copy;')` on `docs` | `[docs](/a\&copy;)` | R3 | source-edit test |
| source mode: a reference link titled `&amp;copy;` given a new URL | `[docs](/e "\&copy;")` | R3 | source-edit test |
| `\&copy; one & x`, each block command, both surfaces | both keep `\&copy;` | R2, R3 | CR1 rows |
| the 22 new corpus rows | all seven round-trip checks and the edit fuzz pass | R2, R3, R4 | corpus |

Nothing needs manual verification: the viewer tests read the DOM writes a browser receives, and no focus, pointer or layout behaviour changes.

---

## Verification

From the worktree's root:

- `npm run test` — `typecheck:test`, then the whole library suite. Expect 0 failed and 229 more tests than the branch's parent.[^counts]
- `npm run typecheck` and `npm run lint` — both pass.
- `npm run docs:api` — zero warnings. The new modules are not re-exported, and only internal comments link to them.
- `npm run docs:llms:check` — unchanged; no public symbol moved.
- `git status --short` — the 22 paths of `## Files to Create / Modify / Delete` and nothing else.

From `packages/lib`:

- `sha256sum src/typescript/lib/component/display/htmlNamedCharacterReferences.ts` — `fed00a098c825d70aa0ac291a76d462d1dda046e50aef2dccd27a17912015bfe`.
- `grep -rn 'NUMERIC_CHARACTER_REFERENCE' src` — nothing.
- `npx vitest run tests/component/display/markdownLexer.test.ts` — 0 failed. It compares the bounded instance with its unbounded twin; both now hold the four tokenizers.
- `npx vitest run tests/component/markdown-roundtrip` — 0 failed.

---

## Documentation Impact

No public symbol changes. Six files change.

1. **`packages/lib/docs/components/Markdown.md`.** In the *Supported syntax* table, replace the row `marked-upgrade` added after the `[label]: url "title"` row (it starts ``| `&#35;`, `&#x23;` |``) with:

   ```markdown
   | `&copy;`, `&amp;`, `&#35;`, `&#x23;` | the character the reference names (`©`, `&`, `#`) — in text, a link's destination and title, and a code fence's info string; a name the HTML list does not hold (`&notaname;`), a name without its `;` (`&copy`), and any reference in a code span, a code block, an autolink, an image or HTML are shown as typed |
   ```

   In the paragraph that starts `Every rendered heading carries a slugified \`id\``, after its first sentence, add: ``Character references in the heading are read first, so `# Terms &amp; Conditions` and `# Terms & Conditions` both render `id="terms-conditions"`.``

2. **`packages/lib/docs/components/MarkdownEditor.md`.** In the *Supported constructs* table, add after the `Hard line break` row:

   ```markdown
   | Character reference | read as the character it names (`&copy;` shows `©`) wherever the viewer reads it; written as the character itself, and text that would read as a reference is written with its `&` escaped (`\&copy;`) |
   ```

3. **`packages/lib/docs/reference/changelog/next.md`.** Under `## Breaking changes`, `### Components`, add as the last bullet:

   ```markdown
   - **`Markdown` and `MarkdownEditor` read named character references.**
     `&copy;`, `&amp;`, `&nbsp;` and every other name of the HTML list read as
     their characters, as numeric references already do, in text, a link's
     destination and title, and a code fence's info string; numeric references
     are now read in those last three places too. A heading's id is made from
     its text with its references read (`# Terms &amp; Conditions` gets
     `terms-conditions`, where it got `terms-amp-conditions`). The editor
     saves text that would read as a reference with its `&` escaped
     (`\&copy;`). See [Migration](/reference/migration/next).
   ```

4. **`packages/lib/docs/reference/migration/next.md`.** In the section `marked-upgrade` added (`` ## `Markdown` and `MarkdownEditor` read through `marked` 18.1.0 ``), delete the table row that starts ``| `&amp;`, `&copy;` — a named character reference |``. Then add this section at the end of the file:

   ````markdown
   ## `Markdown` and `MarkdownEditor` read named character references

   **What changed and why.** A character reference is `&`, a name or a
   number, and `;`. CommonMark reads every reference whose name is in the
   HTML list as the character it names, in text, a link's destination and
   title, and a code fence's info string. The library read only numeric
   references, and only in text. It now reads both kinds wherever CommonMark
   does, in the viewer and the editor alike.

   | Source | Before | After |
   |---|---|---|
   | `&copy; &amp; &nbsp;` | shown as typed | `©`, `&`, a no-break space |
   | `[a](/f&ouml; "&#35;1")` | links to `/f&ouml;`, titled `&#35;1` | links to `/fö`, titled `#1` |
   | ```` ```j&#115; ```` | a code block of language `j&#115;` | of language `js` |
   | `# Terms &amp; Conditions` | `id="terms-amp-conditions"` | `id="terms-conditions"` |
   | `&notaname;`, `&copy` (no `;`), a reference in code, an autolink, an image or HTML | shown as typed | shown as typed (unchanged) |

   In the editor, text typed as `&copy;` is now saved as `\&copy;`, so that it
   stays the text that was typed.

   **Who needs to act.** Nothing fails to compile. Content that shows a
   named reference as literal text on purpose escapes its `&`:

   ```markdown
   <!-- Before: showed "&copy;" -->
   &copy;

   <!-- After -->
   \&copy;
   ```

   A `#fragment` link to a heading whose text holds a reference changes to the
   new id.
   ````

5. **`packages/lib/THIRD-PARTY-NOTICES.md`.** Add this section after the d3 section's closing code fence, before the `---` that opens `## 2. Runtime dependencies`:

   ````markdown
   ### HTML named character references (WHATWG)

   The Markdown chunk inlines the HTML Standard's list of named character
   references (`dist/lib/markdownExtensions-*.js`), generated from
   <https://html.spec.whatwg.org/entities.json> into
   `htmlNamedCharacterReferences.ts`. The HTML Standard is licensed under the
   Creative Commons Attribution 4.0 International License; portions of it
   incorporated into source code are licensed under the BSD 3-Clause License:

   ```
   Copyright © WHATWG (Apple, Google, Mozilla, Microsoft).

   Redistribution and use in source and binary forms, with or without
   modification, are permitted provided that the following conditions are met:

   1. Redistributions of source code must retain the above copyright notice,
      this list of conditions and the following disclaimer.

   2. Redistributions in binary form must reproduce the above copyright notice,
      this list of conditions and the following disclaimer in the documentation
      and/or other materials provided with the distribution.

   3. Neither the name of the copyright holder nor the names of its
      contributors may be used to endorse or promote products derived from
      this software without specific prior written permission.

   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
   AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
   IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
   ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
   LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
   CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
   SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
   INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
   CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
   ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
   POSSIBILITY OF SUCH DAMAGE.
   ```
   ````

`packages/lib/llms.txt` is not touched: it lists components, not syntax.

---

## Potential Challenges

- **The download fails or the list differs.** Step 2 checks the hash of `entities.json` and of the generated file; the copy kept in the scratch folder has the right hash.
- **A plan that landed after `marked-upgrade` added a test that holds a named reference.** When the reference is only filler, swap it for plain text of the same length, as step 11 does; when it is the test's subject, pin the read character. Report each such test.
- **The held branch `markdown-editor-raw-block-range-edits`.** Its tests hold no named reference beyond the ones this plan already re-pins, but its own `markdown-source-places.test.ts` sweeps the corpus, which gains 22 rows. Whoever rebases it applies the rule above.
- **The generated file is 2,138 lines.** Review it by its hash, not line by line, and never edit it by hand: the WHATWG list is static, so it never needs regenerating.[^table-source]
- **`token.escaped` in `inlineText`.** It is `marked`'s flag for text inside an inline `<pre>`, `<code>`, `<kbd>` or `<script>` tag. Keep the check: without it, such text would read references the viewer then shows beside the tag's source.
- **A link whose destination the editor holds with a backslash.** `writeLinkDestination` doubles the backslash before it escapes references; keep that order, or a destination held as `\&copy;` would read back as `\\©`.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/display/markdownExtensions.ts](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts) — `listWithOwnTaskMarker` (line 370) makes a view of the tokenizer with `Object.create`, the precedent for `keepingEscapes`; `blockquoteWithSourceRaw` (line 467) runs `marked`'s method and changes one field, the precedent for the four overrides; `BOUNDED_BLOCK_TOKENIZERS` (line 566) and `_marked` (line 602) are where they install.
- [packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts) — `needsEscape` and the numeric case `marked-upgrade` adds to it; `writeLinkDestination`; `serializeCode`.
- [packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts](packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts) — `repointLink`, `quotedTitle`, `formatDestination` and `hrefOf` (lines 1135 to 1218).
- [packages/lib/scripts/import-fontawesome.ts](packages/lib/scripts/import-fontawesome.ts) — the one-shot generator precedent: third-party data written into source files with an SPDX header naming its licence.
- [packages/lib/THIRD-PARTY-NOTICES.md](packages/lib/THIRD-PARTY-NOTICES.md) — the d3 section (line 133), the precedent for a bundled component's notice.
- [packages/lib/tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts](packages/lib/tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts) — `checkNoWordLost` (line 302).
- [plans/marked-upgrade.md](plans/marked-upgrade.md) — its decision 3 and the numeric escape this plan extends.

---

## Non-Goals

- **Images.** The dialect's `![alt](src)` reads its alt text and source as written; it reads no backslash escape either. `![&copy;](/a&copy;.png)` keeps both as typed, as numeric references are kept today.[^not-read]
- **Writing a character back as a reference.** An edited block writes `©` and a no-break space as the characters themselves; an unedited block keeps `&copy;` and `&nbsp;` as written.
- **Reading references in link labels.** CommonMark matches labels as written; `[&copy;]` matches `[&copy;]:` and not `[©]:`.
- **Slugging a heading from its shown text.** The id still reads the heading's source, references read: markup and link destinations in it count as before.
- **Loading the table lazily.** Lexing is synchronous; a table that arrived later would make the viewer and the editor read a document two ways.[^full-set]
- **The SQLAdmin repository.** It takes this with the next library release.

---

## Addendum: Measured

Measured in a private copy of the repository at `736452bbc` with the edits of `marked-version-pin-or-upgrade` and `marked-upgrade` applied, whose `node_modules` was a set of links to the main tree's with its own `marked` 18.1.0 (from `npm pack marked@18.1.0`). Nothing was installed in the main tree or a worktree. The scripts, probes and outputs are under `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans4/named-refs/`; the copy's git log holds the prototype commit by commit.

### The prototype

Every source and test edit of this plan was made in the copy.

| State | Markdown tests (32 files) | Failing |
|---|---|---|
| after `marked-upgrade` | 9,873 | 0 |
| the four tokenizers and the slug only (old serializer), with the old tests | 9,873 | 3: I28, the `e &amp;` filler test, E10 |
| the plan's tests, on the source as `marked-upgrade` leaves it | 10,102 | 27 |
| the whole plan | 10,102 | 0 |

The whole suite with the plan held 19,920 tests and passed. `npm run typecheck`, `npm run typecheck:test`, `npm run lint` and `npm run docs:api` (0 errors) passed.

### Reading

56 probe documents were each loaded in the viewer and the editor: the two read alike for every one, and every one saved byte for byte unedited. The documents and both readings are in `runs/read-proto2.json`.

A copy of the four overrides on plain `marked` 18.1.0, compared with the CommonMark 0.31.2 examples: 646 of 652 pass without them and 649 with them (GFM off), gaining examples 32, 33 and 503 and losing none; every example of *Entity and numeric character references* passes. With GFM on, 642 and 645.

### Typed text

19,927 strings, each put into a paragraph, saved, and read back by the viewer:

| Serializer | Strings that do not read back as typed |
|---|---|
| after `marked-upgrade` (no named reference read) | 847, each holding a tab or two spaces |
| this plan's reading, with `marked-upgrade`'s numeric escape only | 7,481: the same 847, and 6,634 holding a named reference |
| this plan | 847, the same as the first row |

### Size

`npm run build:lib` in the copy, before and after:

| Built file | Before (raw / gzip / brotli) | After |
|---|---|---|
| `markdownExtensions-*.js` | 11,007 / 3,991 / 3,640 bytes | 50,203 / 16,448 / 14,123 bytes |
| `component/display.es.js`, `component/editor.es.js` | — | within 20 bytes of before |

For scale, `marked` 18.1.0 itself is 46,345 bytes, 13,907 gzipped. An application that imports only `ProgressBar` from `component/display` still bundles the Markdown chunk (checked with rolldown and esbuild), so the cost reaches every application that imports from `component/display` or `component/editor`.

| Table form | Minified | gzip |
|---|---|---|
| `new Map([[name, chars], …])`, the plan's | 39.2 kB added | 12.5 kB added |
| one string of `name=chars` pairs, split at load | 24.5 kB | 11.0 kB |
| the same, names front-coded | 18.4 kB | 10.0 kB |
| `entities` 8.0.0, `decodeHTMLStrict` | 38.3 kB | 22.2 kB |

### Time

`lexMarkdown` on a 190,800-character document holding 2,000 inline links, 2,000 reference links, 400 definitions, 400 code fences and 6,000 references, median of 15 runs:

| Version | Median |
|---|---|
| after `marked-upgrade` | 34.2 ms |
| the `inlineText` override alone | 34.9 ms |
| all four, a new view per call | 49.6 ms |
| all four, one view per lex (the plan's) | 36.0 ms |

---

## Notes

[^table-source]: Searched first: no runtime dependency of the library ships a usable table. `marked` reads only numeric references and exports no helper for them; `prettier`'s Markdown plugin inlines a table in a minified bundle with no export; `typedoc` and the `entities` package (BSD-2-Clause, installed only through `jsdom`'s `parse5` and through `markdown-it`, both dev dependencies) have one, but neither is a runtime dependency. Adding `entities` as one would cost 22.2 kB gzipped in every application, against 12.5 kB for the generated table, and add a package to the install. Reading references through the browser (`innerHTML` on a detached element) costs no bytes, but the lexer then needs a DOM: the library's imports are DOM-free, `extractMarkdownHeadings` lexes without rendering, every DOM access goes through the `DOM.sink`/`DOM.source` seam, whose test double would need a table of its own anyway, and HTML's parser reads legacy prefixes (`&notit;` becomes `¬it;`), which would need guarding. The WHATWG list is static ("will not be expanded or changed in the future", HTML Standard §13.5), so the generator runs once and the file never drifts; the hashes in step 2 pin both the input and the output. The copy at `scratch-keep/plans4/named-refs/whatwg/entities.json` was downloaded on 2026-10-14.

[^licence]: The HTML Standard says: "This work is licensed under a Creative Commons Attribution 4.0 International License. To the extent portions of it are incorporated into source code, such portions in the source code are licensed under the BSD 3-Clause License instead." BSD 3-Clause is permissive and asks only for the notice, so it is not the kind of licence the owner keeps out of the library (EPL `elkjs` stays an external peer dependency for that reason). The notice follows the d3 precedent: d3 is ISC-licensed and inlined into `dist/lib`, and `THIRD-PARTY-NOTICES.md` reproduces its licence under *Components bundled in this package*. The SPDX header follows the Font Awesome glyph files, which carry `CC-BY-4.0` in a library otherwise `PolyForm-Noncommercial-1.0.0`.

[^full-set]: CommonMark names the WHATWG list as "the authoritative source for the valid entity references", and its own example 25 uses names only HTML5 has (`&HilbertSpace;`, `&DifferentialD;`, `&ClockwiseContourIntegral;`, `&ngE;`). commonmark.js, markdown-it and GitHub read all of them. A subset was weighed: HTML 4's 253 names would cost about 1.5 kB gzipped, but would leave common HTML5 names such as `&apos;` and `&check;` as typed, so a document would read differently in this library than in every other CommonMark renderer, and the line between read and unread names would be arbitrary. Compact encodings save at most 2.5 kB gzipped (addendum, *Size*) at the price of a parse step at load and a generated file nobody can read; the `Map` literal was kept. The table lands in the shared Markdown chunk, which every application importing `component/display` or `component/editor` already bundles together with `marked` (13.9 kB gzipped). A table loaded lazily was rejected: the lexer is synchronous, and the viewer and the editor would read a document one way before the table arrived and another way after.

[^one-seam]: Every lexing site in the library goes through the scoped instance (`lexMarkdown`, `lexMarkdownInline`, `lexMarkdownWithDefinitions`, `lexMarkdownLinkDefinitions`): the viewer, the importer, the serializer's read-back checks, source mode's analysis and its verified edits. So reading references in the tokenizers reaches all of them, as `marked`'s own numeric reading reached them on 18.1.0 with no other change (the importer imports `text`, `href`, `title` and `lang` from the tokens; it keeps an info string as written in `codeInfoState` whenever it differs from the language). Post-processing tokens after the lex was rejected: the lexer's `tokens.links` map, which resolves reference links, is filled from `def` tokens during the lex, so `def` must read references before the map is filled. The overrides go on both instances because `markdownLexer.test.ts` compares the bounded instance with its unbounded twin token by token.

[^one-pass]: CommonMark reads each reference once: `&#38;copy;` is `&` followed by `copy;`, which shows as `&copy;`. Reading named references after `marked`'s numeric pass would read the `&copy;` that pass produced as `©`. `decodeCharacterReferences` takes the numeric rules from `marked` 18.1.0 (one to seven decimal digits, one to six hexadecimal ones, U+FFFD for zero, a surrogate or a code point past U+10FFFF), so numeric references read as they did after `marked-upgrade`. A name is a letter and one to 31 letters or digits, the length of the longest WHATWG name (`CounterClockwiseContourIntegral`), as in commonmark.js's own pattern.

[^view]: `marked` builds `href` as `href.replace(this.rules.inline.anyPunctuation, '$1')`, and `title` and `lang` the same way (its `Tokenizer.link`, `def` and `fences`). A view whose `anyPunctuation` matches nothing gives the override the strings as `marked` cut them, escapes still in, and the override then does the unescaping itself together with the references. Re-parsing the destination out of `raw` was rejected: it would duplicate `marked`'s rules for angle brackets, balanced parentheses and the long-destination cut. Mutating `marked`'s shared rule objects for the call was rejected: the inline rules are module-level objects every `marked` instance shares, and the link text is lexed inside the call. The view's `lexer`, `options` and `state` are the tokenizer's, reached through the prototype, and the link text is lexed by `this.lexer`, whose tokenizer is the real one, so nothing nested sees the view. `marked` gives the tokenizer a new rules object in every `Lexer` constructor, so a `WeakMap` keyed by it holds one view per lex. Making a view per call cost 45% of lexing time on the measured document; one per lex costs 5% (addendum, *Time*).

[^numeric-elsewhere]: `marked` 18.1.0 reads numeric references only in text, so after `marked-upgrade` `[a](/n&#35;1)` links to `/n&#35;1`, where CommonMark links to `/n#1`. One decoder for both kinds closes that gap at no extra cost; reading only named references in destinations would make `/f&ouml;` and `/f&#246;` link to different places. The serializer and source mode escape both kinds in the same places, so nothing typed is lost (E19 escapes a numeric one).

[^not-read]: CommonMark: references are "not recognized in code blocks and code spans" (examples 35 and 36), autolink destinations are taken as written, raw HTML passes through as written (example 31), and link labels are matched as written. Tokens for these are built by `marked`'s `codespan`, `code`, `autolink`, `url`, `tag` and `html` tokenizers and the label match in `reflink`, none of which is overridden. Two places differ from commonmark.js and stay as `marked` reads them: text between an inline `<code>`, `<pre>`, `<kbd>` or `<script>` tag and its end tag (`marked`'s `escaped`), which commonmark.js reads but `marked` keeps as written for numeric references too; and the dialect's image, whose tokenizer reads `![alt](src)` with one regular expression and processes no escapes, so its alt text and source keep references as written, as they keep numeric ones today. The viewer shows HTML as its source text, so the first difference shows the tag and its content as typed, which is consistent.

[^escape]: The escape mirrors `marked-upgrade`'s numeric case at the same `needsEscape` line, which reads `site.text` from the `&` on; a reference cannot span two text nodes of different formats, since a format's delimiters would stand inside it. Only names the table holds are escaped, so `&notaname;` and `&copy` stay as typed, matching what the lexer reads. Measured on 19,927 typed strings: with the reading but without the escape, 6,634 strings holding a named reference read back otherwise; with it, none does (addendum, *Typed text*). `\&` is an escape `marked` reads in text, in both destination forms and in titles; in a code fence's info string too, so `serializeCode` escapes a language the editor holds, and compares an authored info string's first word with the language after reading its escapes and references, as the importer's language was read. Source mode's `formatDestination` and `quotedTitle` write the destination and title of a link command; without the escape `hrefOf` would read the new link back as `/a©`, and the command's own check, which compares with `hrefOf`, would accept it. A link the editor holds as source keeps that source: an inline link written by hand as `[x](/a\&copy;)` saves byte for byte (R16), as the serializer keeps a link's source when its standard form would read otherwise.

[^slug]: `nextHeadingId` slugifies the heading token's `text`, which is the heading's source line. Before this plan `# Terms &amp; Conditions` got `terms-amp-conditions`, and the same heading after an edit, saved as `# Terms & Conditions`, got `terms-conditions`: the editor would move the id. The same was already true of numeric references after `marked-upgrade` (`# &#35; x` gave `35-x`, its save `\# x` gives `x`). Reading references before slugifying makes the id independent of how a character is written. It changes the id of existing headings that hold a reference, which the migration note lists. A reference inside a code span in a heading is read for the id too, though it shows as typed: the slug already reads the source, link destinations included, and only references were in scope.

[^fuzz-words]: The fuzz requires every word of the source outside the edited blocks to appear in the save. Two cases broke that with references read, without anything being lost. A paragraph rewritten because a definition it used was deleted writes `"t&amp;"` as `"t&"`, so the source's word `amp` is gone: the source's words must be its words as read. A code block kept as written keeps `j&#115;`, whose read word `js` appears in the save only as read: so the save's words are taken both as written and as read. The check keeps its strength for text: a word typed or shown still has to appear in the save.

[^counts]: Measured on the copy: 22 tests in the new decoder file, 6 viewer tests (CR20 to CR25), 8 serializer tests (E14 to E21), 6 importer tests (I29, R13 to R17), 2 source-edit tests, 4 parity rows (CR1), and 181 round-trip tests for the 22 new corpus rows (seven checks each, a links check for five rows that declare links, and one edit-fuzz test each). That is 229. The branches that land between the measured base and this plan add tests of their own, so compare with the branch's parent.
