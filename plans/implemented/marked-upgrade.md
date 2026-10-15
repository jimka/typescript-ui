---
depends-on:
  - marked-version-pin-or-upgrade
touches-shared:
  - packages/lib/package.json
  - package-lock.json
  - packages/lib/src/typescript/lib/component/display/markdownExtensions.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts
  - packages/lib/tests/component/markdown-document-panel.test.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-importer.test.ts
  - packages/lib/tests/component/markdown-reference-links.test.ts
  - packages/lib/tests/component/markdown-serializer.test.ts
  - packages/lib/tests/component/markdown-source-edits.test.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts
  - packages/lib/docs/components/Markdown.md
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# marked Upgrade to 18.1.0 — Implementation Plan

## Overview

The plan `marked-version-pin-or-upgrade` pins the `marked` parser to exactly 18.0.10. This plan moves the pin to 18.1.0, the newest published version.

Between the two versions upstream released 26 changes to the parser. On 18.1.0, `marked` alone renders 646 of the 652 examples of the CommonMark 0.31.2 specification as the specification does; on 18.0.10 it renders 628. No document that was measured moves away from CommonMark.[^measured] 18.0.10 also has two defects that 18.1.0 does not: it shows nothing for a line that follows a fence closed inside a nested quote, and three of upstream's own stress documents take more than twelve seconds to lex where 18.1.0 takes under a tenth of a second.[^cost-of-staying]

Five of the readings that change are pinned by the library's tests today; the migration note in `## Documentation Impact` lists them with the others users are most likely to meet. `→` is a tab and `⏎` a line end throughout.

| Document | Viewer and editor on 18.0.10 | On 18.1.0 | CommonMark |
|---|---|---|---|
| `[[a](/in)](/out)` | a link `a` to `/in`; `/out` is not shown | the text `[`, the link `a` to `/in`, the text `](/out)` | as 18.1.0 |
| `&#35; x` | the text `&#35; x` | the text `# x` | as 18.1.0 |
| `> > ``` ⏎ > > a ⏎ > > ``` ⏎ b` | a quote; `b` is not shown | a quote, then the paragraph `b` | as 18.1.0 |
| `- a ⏎ <div` | a list whose item holds the HTML block `<div` | a list, then the HTML block `<div` | as 18.1.0 |
| `- one→tab` | an item reading `one   tab` | an item reading `one→tab` | as 18.1.0 |

The library's code changes in two places. The serializer escapes the `&` of a numeric character reference, so text typed as `&#35;` stays that text. And one function now gives the key `marked` files a link reference definition under, because 18.1.0 changed how it builds that key. Everything else is tests, corpus rows and documentation: 48 of the 9,805 Markdown tests pin a reading that changes.

The viewer and the editor still read every document alike, a save still reloads to the same document, and an unedited block is still saved byte for byte. These were checked on 669 documents on both versions; see [`## Addendum: Measured`](#addendum-measured).

---

## Decisions (signed off 2026-10-14)

The repository's owner answered these on 2026-10-14. The plan is written for these answers.

| # | Question | Answer, and what the plan builds |
|---|---|---|
| 1 | Which version? | **18.1.0**, pinned exactly.[^target] |
| 2 | A link written around a link shows its outer brackets and destination as text. Accept? | **Yes.** It is what CommonMark specifies (examples 518, 519 and 532) and what `commonmark.js` reads.[^around] |
| 3 | A numeric character reference is read as its character (`&#35;` shows `#`), while a named one is still shown as typed (`&copy;` shows `&copy;`). | **Named references are to be decoded too, with viewer and editor alike — in a separate plan, `markdown-named-character-references`, written later and built on this one.** This plan decodes nothing itself, and its documentation describes the difference between numeric and named references as it stands after the upgrade. The follow-up plan removes the difference.[^named] |
| 4 | Text typed as `&#35;` in the editor is saved as `\&#35;`. | **Yes.** It is the only way the text reads back as typed on 18.1.0.[^escape] |
| 5 | In source mode, **Remove link** on the inner link of `[[a](/in) b](/out)` does nothing. | **Yes, pinned by a test, and documented.** In WYSIWYG mode the command works and saves `\[a b\]\(/out)`.[^remove-declines] |
| 6 | When does this plan run? | **Directly after the pin, before `markdown-tab-column-parity`.** That plan can then drop two of its four tokenizers.[^order] |

Decisions 2, 3 and 4 change what an application's users see. The migration note is in [`## Documentation Impact`](#documentation-impact).

---

## Architecture Decisions

### The pin moves to exactly 18.1.0

`packages/lib/package.json` declares `"marked": "18.1.0"`. The guard test of the pin plan, `tests/unit/marked-version.test.ts`, needs no change: it compares the installed version with the declared one.[^target]

### No tokenizer changes

`markdownExtensions.ts` keeps its three correcting tokenizers and its six guarded block slots as they are. Each defect they correct is still in `marked` 18.1.0, and the guards still match the rules they were read off. No tokenizer is added to bring an old reading back.[^tokenizers]

### A link written around a link is text around the inner link

On 18.1.0 `marked` no longer makes a link whose text holds an inline or reference link. The outer brackets and destination are text. The editor needs no code for the new reading: it imports the tokens `marked` gives, and an edited block saves the brackets escaped (`\[[a](/in)\]\(/out)`).

`marked` still makes a link around an *autolink*: `[<https://a.test/x>](/out)` is a link token holding a link token on both versions, as it is in `commonmark.js`. So the editor's code for a link nested in a link stays, and stays tested.[^around]

The tests split in two groups, and the step order follows the split:

| A test whose subject is | Does | Example |
|---|---|---|
| how the editor handles a link token inside a link token | swaps its document for one with an autolink inside the link; passes on both versions | `[[b - c](https://y)](https://x)` becomes `[<https://y.test/b-c>](https://x)` |
| what a given document reads as | keeps the document and pins the new reading; passes on 18.1.0 only | `[a [b](/2) c](/1)` reads as `[a `, the link `b`, ` c](/1)` |

### The serializer escapes the `&` of a numeric character reference

`needsEscape` in [markdownSerializer.ts:5687](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L5687) gains one case: an `&` is escaped when a numeric character reference starts at it. It mirrors the cases beside it, which each read the text from the character's position (`:` of a bare URL, `.` of `www.`).[^escape]

| Text in the editor | Saved before | Saved after | Reads back on 18.1.0 |
|---|---|---|---|
| `&#35;` | `&#35;` | `\&#35;` | `&#35;` |
| `&#x41; b` | `&#x41; b` | `\&#x41; b` | `&#x41; b` |
| `&amp;` | `&amp;` | `&amp;` | `&amp;` |
| `&#12345678;` (eight digits, no reference) | `&#12345678;` | `&#12345678;` | `&#12345678;` |
| `&#abc;` | `&#abc;` | `&#abc;` | `&#abc;` |

### One function gives the key `marked` files a definition under

The library looks link reference definitions up in the map `marked` builds, and computes the map's key itself in three places as `label.replace(/\s+/g, " ").toLowerCase()`. On 18.1.0 `marked` also trims the label and folds its case the Unicode way. A new exported function `linkLabelKey` in `markdownExtensions.ts` holds the rule once, and the three places call it.[^label-key]

| Label | Key on 18.0.10 | Key on 18.1.0, and what `linkLabelKey` returns |
|---|---|---|
| `Foo  Bar` | `foo bar` | `foo bar` |
| ` foo ` | ` foo ` | `foo` |
| `ẞ` | `ß` | `ss` |
| `SS` | `ss` | `ss` |

### Named character references stay as typed in this plan

Nothing is added to decode `&amp;` or `&copy;`. After this plan the viewer still shows them as typed, the serializer writes them as typed, and the documentation says so. The plan `markdown-named-character-references`, written later and built on this one, will decode them in the viewer and the editor alike.[^named]

### Source mode's Remove link declines where the brackets around the link would become a link

`REMOVE_LINK_SOURCE` returns `null` on the inner link of `x [[a](/in) b](/out) y`. No code changes for this: the command already checks its result by lexing it, and `x [a b](/out) y` reads as a link to `/out`. A test pins the decline.[^remove-declines]

### Nobody but the orchestrator installs, and only at step 8

The implementer edits `packages/lib/package.json` and `package-lock.json` as text, in the worktree, and runs no npm command that installs. The orchestrator then installs 18.1.0 into the main tree's `node_modules`, with the owner's permission of 2026-10-14, at a moment when no other agent is running tests. Every worktree's `node_modules` is a symlink to that folder, so from then on every branch runs on 18.1.0. This is the pin plan's install step, with the version moved.[^install-step]

### Where this plan sits among the other Markdown plans

Every expectation below was measured on commit `34d48e32c` with the pin plan's edits applied. Plans that land before this one may add tests that pin a reading of 18.0.10. Step 9 gives the rule for each such test.[^order]

---

## Public API

No public symbol changes. One internal export is added to `markdownExtensions.ts`; it is not re-exported from `component/display/index.ts`.

```ts
/**
 * The key `marked` files a link reference definition under, and looks a
 * reference's label up by.
 */
export function linkLabelKey(label: string): string;
```

---

## Internal Structure

### `linkLabelKey`, in `markdownExtensions.ts`

Add directly above the doc comment of `lexMarkdownLinkDefinitions` ([markdownExtensions.ts:647](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L647)), with one blank line between the two:

```ts
/**
 * The key `marked` files a link reference definition under, and looks a
 * reference's label up by: the label with its whitespace runs collapsed to
 * one space, trimmed, and case-folded. The fold goes through upper case, as
 * `marked`'s own does, so that `ẞ` and `SS` share a key, which
 * `toLowerCase()` alone does not give. {@link lexMarkdownLinkDefinitions}
 * returns a map keyed this way.
 *
 * @param label - A reference's label or a definition's, as written between its brackets.
 * @returns The key.
 */
export function linkLabelKey(label: string): string {
    return label.replace(/\s+/g, " ").trim().toLowerCase().toUpperCase().toLowerCase();
}
```

### The escape, in `markdownSerializer.ts`

Add after `EMAIL_DOMAIN_CHARACTER` ([markdownSerializer.ts:308](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L308)), with one blank line between the two:

```ts
/**
 * A numeric character reference at the start of the text: `&#35;` or
 * `&#x23;`, with one to seven decimal digits or one to six hexadecimal ones.
 * `marked` reads one as the character it names, so the `&` of a reference the
 * text holds as typed is escaped.
 */
const NUMERIC_CHARACTER_REFERENCE = /^&#(?:\d{1,7}|[Xx][0-9A-Fa-f]{1,6});/;
```

In `needsEscape`, add one case after the `"@"` case ([markdownSerializer.ts:5706](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L5706)):

```ts
        case "&":  return NUMERIC_CHARACTER_REFERENCE.test(site.text.slice(site.index));
```

The digit counts are `marked` 18.1.0's own: its rule is `/&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/g`.

---

## Ordered Implementation Steps

Work in the plan's worktree, `.worktrees/marked-upgrade`. Its `node_modules` and `packages/lib/node_modules` are symlinks to the main tree's. Never run `npm install`, `npm ci` or `npm update`, in the worktree or anywhere else: step 8 is the only install, and the orchestrator runs it. Run every command from `packages/lib` unless a step says otherwise. Each `-` line of a `diff` block below occurs once in its file unless the block names the test it belongs to; find it by its text, not by a line number.

### Part A — on 18.0.10: tests of the nested-link code get documents that still nest

Nothing in part A depends on the `marked` version. The suite is green before part A and after it.

1. **`tests/component/markdown-document-panel.test.ts`.** In the two tests named `in a link nested in a link the Link button disables: the link commands decline there` and `with only the far end of a selection in a link nested in a link the Link button disables`:

   ```diff
   -            panel.setValue('[[b - c](https://y)](https://x)');
   -            caretIn(panel.getEditor(), 'b - c', 5);
   +            panel.setValue('[<https://y.test/b-c>](https://x)');
   +            caretIn(panel.getEditor(), 'https://y.test/b-c', 5);
   ```
   ```diff
   -            panel.setValue('plain [[b - c](https://y)](https://x)');
   +            panel.setValue('plain [<https://y.test/b-c>](https://x)');
   ```
   ```diff
   -                const [plain, nested] = ['plain ', 'b - c'].map((text) => {
   +                const [plain, nested] = ['plain ', 'https://y.test/b-c'].map((text) => {
   ```

2. **`tests/component/markdown-editor.test.ts`.** The fixture of rows A7 and A9:

   ```diff
   -    const NESTED_LINK = '[[b - c](https://y)](https://x)';
   +    const NESTED_LINK = '[<https://y.test/b-c>](https://x)';
   ```
   ```diff
   -                // Offset 2 of "b - c" has no word character on either side, so the caret expands to nothing.
   +                // Offset 6 of "https://y.test/b-c" stands between `:` and `/`, no word character on either side, so the caret expands to nothing.
   ```
   ```diff
   -                select: (editor) => caretIn(editor, 'b - c', 2),
   +                select: (editor) => caretIn(editor, 'https://y.test/b-c', 6),
   ```
   ```diff
   -                select: (editor) => caretIn(editor, 'b - c', 5),
   +                select: (editor) => caretIn(editor, 'https://y.test/b-c', 2),
   ```

3. **`tests/component/markdown-source-edits.test.ts`.** In `describe('REMOVE_LINK_SOURCE — a link nested in a link (whole-stack review fix #16b)'`:

   ```diff
   -        ['the nested link opens the outer link\'s text', 'x [[a](/in) b](/out) y', 'x a[ b](/out) y'],
   -        ['the nested link sits inside the outer link\'s text', 'x [c [a](/in) b](/out) y', 'x [c ](/out)a[ b](/out) y'],
   -        ['the nested link ends the outer link\'s text', 'x [c [a](/in)](/out) y', 'x [c ](/out)a y'],
   -        ['the outer link is a reference link', 'x [[a](/in) b][r] y\n\n[r]: /out', 'x a[ b][r] y\n\n[r]: /out'],
   +        ['the nested link opens the outer link\'s text', 'x [<https://a.test/in> b](/out) y', 'x https\\://a.test/in[ b](/out) y'],
   +        ['the nested link sits inside the outer link\'s text', 'x [c <https://a.test/in> b](/out) y', 'x [c ](/out)https\\://a.test/in[ b](/out) y'],
   +        ['the nested link ends the outer link\'s text', 'x [c <https://a.test/in>](/out) y', 'x [c ](/out)https\\://a.test/in y'],
   +        ['the outer link is a reference link', 'x [<https://a.test/in> b][r] y\n\n[r]: /out', 'x https\\://a.test/in[ b][r] y\n\n[r]: /out'],
   ```
   ```diff
   -            const [from, to] = rangeOf(text, 'a');
   -
   -            expect(apply(text, REMOVE_LINK_SOURCE(text, from, to)!)).toBe(unlinked);
   +            const [from, to] = rangeOf(text, 'a.test');
   +
   +            expect(apply(text, REMOVE_LINK_SOURCE(text, from, to)!)).toBe(unlinked);
   ```

4. **`tests/component/markdown-reference-links.test.ts`.** A reference kept as written is now `~~5 [![](g)][r]~~`: struck text and a linked image written as a reference, which the editor keeps as its source on both versions.

   In `a link split by a nested link writes each part in the full form`:
   ```diff
   -        const source = '[see [x](https://u) y][ref]\n\n[ref]: https://e.com';
   +        const source = '[see <https://u.test/x> y][ref]\n\n[ref]: https://e.com';
   ```
   In `DEF3`:
   ```diff
   -        const editor = load('[[x][r]](u)\n\n[r]: /r');
   +        const editor = load('~~5 [![](g)][r]~~\n\n[r]: /r');
   ```
   ```diff
   -        expect(expectShownAsSaved(editor)).toBe('[[x][r]](u)\n\n[r]: /s');
   +        expect(expectShownAsSaved(editor)).toBe('~~5 [![](g)][r]~~\n\n[r]: /s');
   ```
   In `DEF4`:
   ```diff
   -        const editor = load('[[x][r]](u)\n\n[r]: /r');
   +        const editor = load('~~5 [![](g)][r]~~\n\n[r]: /r');
   ```
   ```diff
   -        expect(expectShownAsSaved(editor)).toBe('[r]: /first\n\n[[x][r]](u)\n\n[r]: /r');
   +        expect(expectShownAsSaved(editor)).toBe('[r]: /first\n\n~~5 [![](g)][r]~~\n\n[r]: /r');
   ```
   In `DEF5`:
   ```diff
   -        const editor = load('See [text][ref] and [[x][ref]](u).\n\n[ref]: https://e.com');
   +        const editor = load('See [text][ref] and ~~5 [![](g)][ref]~~.\n\n[ref]: https://e.com');
   ```
   ```diff
   -        expect(saved).toBe('See [text](https://e.com) and [[x][ref]](u).\n\n[ref]: https://f.com');
   +        expect(saved).toBe('See [text](https://e.com) and ~~5 [![](g)][ref]~~.\n\n[ref]: https://f.com');
   ```
   ```diff
   -            runs: [{ text: 'See ' }, { text: 'text', link: { href: 'https://e.com' } }, { text: ' and ' }, { text: 'x', link: { href: 'https://f.com' } }, { text: '.' }],
   +            runs: [{ text: 'See ' }, { text: 'text', link: { href: 'https://e.com' } }, { text: ' and ' }, { text: '5 ' }, { kind: 'image', link: { href: 'https://f.com' } }, { text: '.' }],
   ```
   In `DEF7`:
   ```diff
   -        const editor = load('- [l]: /l\n\nx [[l]](u)');
   +        const editor = load('- [l]: /l\n\nx ~~5 [![](g)][l]~~');
   ```
   ```diff
   -        expect(editorSurfaceModel(editor)[1]).toMatchObject({ runs: [{ text: 'x ' }, { text: 'l', link: { href: '/m' } }] });
   +        expect(editorSurfaceModel(editor)[1]).toMatchObject({ runs: [{ text: 'x ' }, { text: '5 ' }, { kind: 'image', link: { href: '/m' } }] });
   ```
   In `DEF8`:
   ```diff
   -        const editor = load('[[x][c]](u)\n\n::: columns\n[c]: /c\n|||\nz\n:::');
   +        const editor = load('~~5 [![](g)][c]~~\n\n::: columns\n[c]: /c\n|||\nz\n:::');
   ```
   ```diff
   -        expect(expectShownAsSaved(editor)).toBe('[[x][c]](u)\n\n::: columns\n[c]: /d\n|||\nz\n:::');
   +        expect(expectShownAsSaved(editor)).toBe('~~5 [![](g)][c]~~\n\n::: columns\n[c]: /d\n|||\nz\n:::');
   ```
   In `DEF14`:
   ```diff
   -        const editor = load('[[x][r]](u) tail\n\n[r]: /r');
   +        const editor = load('~~5 [![](g)][r]~~ tail\n\n[r]: /r');
   ```
   ```diff
   -        })).toBe('x tail');
   +        })).toBe('5  tail');
   ```
   In `a link nested in a link written as a reference keeps all its source when the block is written again`:
   ```diff
   -        const editor = load('[<https://a.test/q>[](/z)][r] w\n\n[r]: /c');
   +        const editor = load('[<https://a.test/q><https://b.test/z>][r] w\n\n[r]: /c');
   ```
   ```diff
   -        expect(editor.getValue()).toBe('[<https://a.test/q>[](/z)][r] w!\n\n[r]: /c');
   +        expect(editor.getValue()).toBe('[<https://a.test/q><https://b.test/z>][r] w!\n\n[r]: /c');
   ```
   Leave `DEF10` as it is: its `[[x][r]](u)` has no definition for `r` when it loads, so nothing nests on either version.

5. **`tests/component/markdown-importer.test.ts`.**

   Test `I26`. Replace its title, document and middle row; the first and last rows stay:
   ```diff
   -    it('I26: a link nested in a link wins, and the outer link reopens after it', () => {
   -        const editor = load('[a [b](/2) c](/1)');
   +    it('I26: an autolink nested in a link wins, and the outer link reopens after it', () => {
   +        const editor = load('[a <https://b.test/2> c](/1)');
   ```
   ```diff
   -            { link: '/2', children: [{ text: 'b' }] },
   +            { link: 'https://b.test/2', children: [{ text: 'https://b.test/2' }] },
   ```
   ```diff
   -        expectSurface(editor, '[a [b](/2) c](/1)');
   +        expectSurface(editor, '[a <https://b.test/2> c](/1)');
   ```
   The `blankLinks` table:
   ```diff
   -        ['beside links nested in it, at the end of a paragraph', '[[a](/1)[b](/2)    ](/o)', '[[a](/1)[b](/2)    ](/o)'],
   -        ['beside a link nested in it, at the start of a paragraph', 'x\n\n[  [a](/1)](/o) b', '[  [a](/1)](/o)'],
   +        ['beside links nested in it, at the end of a paragraph', '[<https://a.test/1><https://b.test/2>    ](/o)', '[<https://a.test/1><https://b.test/2>    ](/o)'],
   +        ['beside a link nested in it, at the start of a paragraph', 'x\n\n[  <https://a.test/1>](/o) b', '[  <https://a.test/1>](/o)'],
   ```
   Test `a link with whitespace between the links nested in it, at a paragraph's start, keeps its link node`:
   ```diff
   -        // Only whitespace at the link's own edge is trimmed there; an empty link beside the space stays its own source node.
   -        const editor = load('[<https://a.test/x> [](https://e.test/y)](/o) z');
   +        // Only whitespace at the link's own edge is trimmed there; the space between the two nested links keeps the outer link's node.
   +        const editor = load('[<https://a.test/x> <https://e.test/y>](/o) z');
   ```
   ```diff
   -            { link: '/o', children: [{ text: ' ' }, { source: '[](https://e.test/y)', display: '' }] },
   +            { link: '/o', children: [{ text: ' ' }] },
   +            { link: 'https://e.test/y', children: [{ text: 'https://e.test/y' }] },
   ```
   The `nested` table. The row `an autolink inside a link` above these two stays:
   ```diff
   -        ['a link inside a link', '[[a](/in)](/out) z', 'a', '/in', undefined],
   -        ['a link inside emphasis inside a link', '[**[a](/in)**](/out) z', 'a', '/in', BOLD],
   +        ['an autolink inside emphasis inside a link', '[**<https://a/x>**](/p/y) z', 'https://a/x', 'https://a/x', BOLD],
   ```
   The `sources` list in `describe('import: a link whose text all sits in links nested in it'`. Replace the whole list:
   ```diff
   -            'x [[a](/in)](/out) y',
   -            '[[2]()]()',
   -            '[<ps:>]()',
   -            '[<4@x.t>]()',
   -            '[~~[6]()~~]()',
   -            '[***[0]()***]()',
   -            '[++[1]()++]()',
   -            '**[[a](/in)](/out)** y',
   -            '[[a](/1)[b](/2)](/o)',
   -            '[**[a](/1)**[b](/2)](/o) z',
   -            'x [[\\[a \\]b](/p)](/q)',
   +            'x [<https://a.test/in>](/out) y',
   +            '[<ps:>]()',
   +            '[<4@x.t>]()',
   +            '[~~<https://6.test>~~]()',
   +            '[***<https://0.test>***]()',
   +            '[++<https://1.test>++]()',
   +            '**[<https://a.test/in>](/out)** y',
   +            '[<https://a.test/1><https://b.test/2>](/o)',
   +            '[**<https://a.test/1>**<https://b.test/2>](/o) z',
   ```
   The `breaks` table in the same `describe`:
   ```diff
   -            ['deleting the second run of a split nested link', '[[**a**, b](/in)](/out) z', (editor) => {
   -                select(editor, [', b', 0], [' z', 0]);
   +            ['deleting the second of two nested links', '[<https://a.test/1><https://b.test/2>](/o) z', (editor) => {
   +                select(editor, ['https://b.test/2', 0], [' z', 0]);
   ```
   ```diff
   -            ['typing between the runs of a split nested link', '[[a](/1)[b](/2)](/o) z', (editor) => {
   +            ['typing between two nested links', '[<https://a.test/1><https://b.test/2>](/o) z', (editor) => {
   ```
   ```diff
   -                    const [node] = $textNodeHolding('a');
   -
   -                    node.selectNext(0, 0);
   +                    const [node] = $textNodeHolding('https://a.test/1');
   +
   +                    node.selectNext(0, 0);
   ```
   ```diff
   -            ['splitting a nested link\'s paragraph inside it', '[[x y _w_](/in)](/out) **q**', (editor) => {
   -                select(editor, ['w', 0]);
   +            ['splitting a nested link\'s paragraph inside it', '[<https://a.test/in>](/out) **q**', (editor) => {
   +                select(editor, ['https://a.test/in', 8]);
   ```
   Test `removing, re-pointing or clearing the link of a nested link's text is declined`:
   ```diff
   -            const source = 'x [~~[a](/in)~~](/out) y';
   -            const editor = load(source);
   -
   -            select(editor, ['a', 0]);
   +            const source = 'x [~~<https://a.test/in>~~](/out) y';
   +            const editor = load(source);
   +
   +            select(editor, ['https://a.test/in', 0]);
   ```
   The table in `describe('#6 formatting declines over a run kept as source'`:
   ```diff
   -            ['colour on a link nested in a link', 'x [[a](/in)](/out) y', ['a', 0], ['a', 1], (editor) => editor.setTextColor('#cc0000')],
   +            ['colour on a link nested in a link', 'x [<https://a.test/in>](/out) y', ['https://a.test/in', 0], ['https://a.test/in', 1], (editor) => editor.setTextColor('#cc0000')],
   ```
   Test `a run of a link nested in a link keeps the strikethrough its source writes, joined after a letter`:
   ```diff
   -            const editor = load('a\n\n[~~[6]()~~]() x');
   -
   -            select(editor, ['6', 0]);
   +            const editor = load('a\n\n[~~<https://6.test>~~]() x');
   +
   +            select(editor, ['https://6.test', 0]);
   ```
   ```diff
   -            expect(editor.getValue()).toBe('a[~~[6]()~~]() x');
   +            expect(editor.getValue()).toBe('a[~~<https://6.test>~~]() x');
   ```
   Test `text typed over the rest of a line after a run whose source writes its own strikethrough keeps no struck edge space`. `14` is the length of `https://6.test`:
   ```diff
   -            const editor = load('[~~[6]()~~]() x');
   +            const editor = load('[~~<https://6.test>~~]() x');
   ```
   ```diff
   -            select(editor, ['6', 1], [' x', 2]);
   +            select(editor, ['https://6.test', 14], [' x', 2]);
   ```
   The `cases` table that holds `strikethrough over a space before a linked image`:
   ```diff
   -            ['a link holding a link, in a heading', '# [0[3]()](p)', '# [0[3]()](p) w'],
   +            ['a link holding an autolink, in a heading', '# [0<http://3.test>](p)', '# [0<http://3.test>](p) w'],
   ```
   ```diff
   -            ['a link holding a link whose text escapes a bracket, in a heading', '# [`9`[\\[4]()](9)', '# [`9`[\\[4]()](9) w'],
   ```
   ```diff
   -            ['a struck link holding a link, its text escaping a bracket', '[~[a](/b) \\]~)]()', '[~[a](/b) \\]~)]() w'],
   +            ['a struck link holding an autolink, its text escaping a bracket', '[~<https://a.test/b> \\]~)]()', '[~<https://a.test/b> \\]~)]() w'],
   ```
   Test `a run holding a link nested in a link is read back, so a paste breaking its emphasis shows as saved`:
   ```diff
   -            const editor = load('***[ab]{font=Georgia} [[c](/x)](/y)***');
   +            const editor = load('***[ab]{font=Georgia} [<https://c.test/x>](/y)***');
   ```
   Test `a level 2 heading whose continuation line keeps an indent before a source run is written on one line`:
   ```diff
   -            const editor = load('x\n    [[a](/1)[b](/2)](/o)');
   +            const editor = load('x\n    [<https://a.test/1><https://b.test/2>](/o)');
   ```
   Test `a format a selection from a list into the next paragraph cannot apply keeps a construct kept as written in the list`. The `&#35;` goes too: it is `#` on 18.1.0, and `&amp;` reads the same on both:
   ```diff
   -            const source = '- ~[![a](/i.png)](/p) [[b c](/p_(q))](/out)~\n- [[e &#35;](/x)]\n\nf';
   +            const source = '- ~[![a](/i.png)](/p) [<https://b.test/p_(q)>](/out)~\n- [[e &amp;](/x)]\n\nf';
   ```
   ```diff
   -            select(editor, ['e &#35;', 6], ['f', 1]);
   +            select(editor, ['e &amp;', 6], ['f', 1]);
   ```
   ```diff
   -            expect(editor.getValue()).toContain('~[![a](/i.png)](/p) [[b c](/p_(q))](/out)~');
   +            expect(editor.getValue()).toContain('~[![a](/i.png)](/p) [<https://b.test/p_(q)>](/out)~');
   ```

6. **Checkpoint for part A.** `npx vitest run tests/component/markdown-document-panel.test.ts tests/component/markdown-editor.test.ts tests/component/markdown-importer.test.ts tests/component/markdown-reference-links.test.ts tests/component/markdown-source-edits.test.ts` reports **0 failed**. On the measured base the five files hold 1,783 tests, four fewer than the 1,787 before part A.[^part-a-count]
   - Check: `grep -rn "b - c" tests/component/markdown-editor.test.ts tests/component/markdown-document-panel.test.ts` finds nothing.
   - Check: `grep -c "\[\[x\]\[r\]\](u)" tests/component/markdown-reference-links.test.ts` prints `1`, the line of `DEF10`.

### Part B — the version moves, and the readings that change are re-pinned

7. **Change the declared version, then stop.** From the worktree's root, run:

   ```sh
   sed -i 's/"marked": "18\.0\.10",/"marked": "18.1.0",/' packages/lib/package.json package-lock.json
   sed -i '/^    "node_modules\/marked": {$/,/^    },$/{s/"version": "18\.0\.10",/"version": "18.1.0",/;s#marked-18\.0\.10\.tgz#marked-18.1.0.tgz#;s#"integrity": "sha512-[^"]*"#"integrity": "sha512-PamYXWWWg2nboG3oX5Ffzpy3EFZROqZJK9hSlMmUnekp7TxPs5DcT95vwd46m73/exfKCRVMtgXoPMI4FEJL6w=="#}' package-lock.json
   git diff -U0 -- packages/lib/package.json package-lock.json
   ```

   The result is the lockfile npm writes for this change.[^lock-edit]
   - Check: the diff shows one changed line in `packages/lib/package.json` (line 222, `"marked": "18.1.0",`) and four in `package-lock.json`: `"version": "18.1.0",`, `"resolved": "https://registry.npmjs.org/marked/-/marked-18.1.0.tgz",` and the new `"integrity"` of the `node_modules/marked` entry, and `"marked": "18.1.0",` in the `packages/lib` entry. When it shows anything else, stop and report what it shows.
   - Check, from `packages/lib`: `npx vitest run tests/unit/marked-version.test.ts` — MV1 passes; MV2 fails with `node_modules holds marked 18.0.10 but packages/lib/package.json declares 18.1.0`.
   - Then stop, and report to the orchestrator: "Ready for the marked 18.1.0 install (step 8)." Do not go on until the orchestrator says step 8 is done.

8. **The orchestrator installs 18.1.0 (owner's permission of 2026-10-14).** Not the implementer. The orchestrator runs this block at a moment when no other agent is running tests or a dev server, in any worktree:

   ```sh
   cd /home/jika/typescript/typescript-ui        # the main tree, on master
   git status --short -- package.json package-lock.json packages/lib/package.json    # must print nothing
   npm install marked@18.1.0 --save-exact -w packages/lib --dry-run
   npm install marked@18.1.0 --save-exact -w packages/lib
   git diff -U0 -- package-lock.json packages/lib/package.json
   node -p "require('marked/package.json').version"
   git checkout -- package-lock.json packages/lib/package.json
   ```

   - Check: the dry run names `marked` (18.0.10 to 18.1.0) and no other package. When it names any other package, do not run the install; report to the owner.
   - Check: the diff shows the declaration line of `packages/lib/package.json` and, in `package-lock.json`, the three lines of the `node_modules/marked` entry and the declaration line of the `packages/lib` entry. Its `+` lines are the `+` lines of step 7's diff; its `-` lines show what master holds, which is `^18.0.5` and 18.0.9 until the pin reaches master. One more line may change: `"dev": true,` becoming `"devOptional": true,` in the `node_modules/typescript` entry, which npm 11.12.1 writes on any install.[^lock-edit] Any other changed line: report to the owner before going on.
   - Check: `node -p` prints `18.1.0`.
   - The last command puts master's two files back. The main tree's `node_modules` keeps 18.1.0; master gets the declaration when the branch is merged.[^install-step]
   - Then tell the implementer that step 8 is done. From here on, every branch that still declares 18.0.10 fails MV2 until it is rebased onto this one; see `## Potential Challenges`.

9. **See the expected failures.** `npx vitest run tests/unit/marked-version.test.ts` reports 2 passed. `npx vitest run` then fails in exactly these eight tests on the measured base:

   | File | Test | Step |
   |---|---|---|
   | `markdown-editor.test.ts` | `E19 h2: the surfaces differ here on purpose, each as pinned` | 12 |
   | `markdown-editor.test.ts` | `a heading declines on a line the viewer does not show` | 12 |
   | `markdown-importer.test.ts` | `R7: "&#35; x" saves as "&#35; x"` | 13 |
   | `markdown-serializer.test.ts` | `E10: "&amp; &#35;" is written "&amp; &#35;" and reads back as itself` | 10 |
   | `markdown-source-edits.test.ts` | `declines when a tab on an item's marker line stands where the command has to read` | 14 |
   | `markdown-source-edits.test.ts` | `declines a line the viewer does not show` | 14 |
   | `markdown-roundtrip.test.ts` | `html block start on a lazy line after a list item` › `surface (known divergence: listItemBlocks)` | 15 |
   | `markdown-roundtrip.test.ts` | `reference inside a link` › `viewer reads the declared links` | 15 |

   A failing test that is not in the table was added by a plan that landed before this one. Find its cause in this table and change it as the row says, then list it in the implementation report:

   | The failing test | Cause upstream | What to do |
   |---|---|---|
   | loads a link written around an inline or reference link, and is about how the editor handles the nesting | #4051 | swap the inner link for an autolink (`<https://a.test/x>`), as in part A |
   | pins what such a document reads as | #4051 | pin the reading of step 13's `around` rows: the brackets and destination are text |
   | expects `&#…;` to be shown as typed | #4076 | use `&amp;` where the text is only filler; pin the decoded character where the reference is the subject |
   | expects a tab in a list item's text to become spaces | #4086 | pin the tab |
   | expects an HTML block to stay in a list item it follows on a lazy line | #4072 | pin the block after the list |
   | expects a line after a fence closed inside a nested quote to be hidden | #4101 | pin the paragraph after the quote |
   | expects a line that follows a hard line break to keep the spaces it starts with | #4075 | pin them dropped: `> a\ ⏎ >  cd` shows `a`, the break, then `cd` |
   | none of these | — | stop and report the test, its message and the document; do not guess |

10. **The numeric-reference escape.** In `tests/component/markdown-serializer.test.ts`, change row E10 first:
    ```diff
    -        ['E10', '&amp; &#35;', '&amp; &#35;'],
    +        ['E10', '&amp; &#35;', '&amp; \\&#35;'],
    ```
    Add two rows after `E11`:
    ```ts
            ['E12', '&#x41; b', '\\&#x41; b'],
            ['E13', '&#12345678; &#abc; &#;', '&#12345678; &#abc; &#;'],
    ```
    Run the file: E10 and E12 fail on the written text, E13 passes. Then make the two edits of `## Internal Structure`, *The escape*. Run again: all pass.

    In the same file, the comment above the `cases` of `describe('emphasis next to a word: a run between a letter and punctuation stays lossy'` says the viewer does not decode references. Replace its second and third lines:
    ```diff
    -        // CommonMark's remedy, a character reference for the letter (`fuz&#x7A;*\\**`), shows as typed in the viewer,
    -        // which does not decode references. Each case asserts the loss, so a writer that fixes one turns it red.
    +        // CommonMark's remedy is a character reference for the letter (`fuz&#x7A;*\\**`), which the viewer reads as
    +        // the letter. The serializer does not write one. Each case asserts the loss, so a writer that fixes one turns it red.
    ```

11. **The label key.** In `tests/component/markdown-reference-links.test.ts`, add as the first test of `describe('stack fuzz round 2: references where the save could read them otherwise'`:
    ```ts
        // `marked` matches a label to its definition after trimming it, collapsing its whitespace and folding its case
        // (`ẞ` meets `SS`). The save has to find the definition the same way, or it writes the link inline.
        it.each([
            '[ẞ]\n\n[SS]: /url',
            '[text][ẞ] and [Straße][]\n\n[SS]: /url\n[STRASSE]: /street',
            '[foo ] and [x][ bar]\n\n[foo]: /foo\n[bar]: /bar',
            '[Foo] and [x][FOO  bar]\n\n[foo]: /foo\n[foo bar]: /bar',
        ])('%j keeps its reference forms in the standard-form save', (source) => {
            const editor = load(source);

            expect(references(editor).length).toBeGreaterThan(0);
            expect(canonicalSave(editor)).toBe(source);
        });
    ```
    Run the file: the first three rows fail (the save holds `[ẞ](/url)`, `[text](/url) and [Straße](/street)` and `[foo ](/foo) and [x](/bar)`), the fourth passes. Then:
    - Add `linkLabelKey` to `markdownExtensions.ts` as in `## Internal Structure`.
    - In the same file, change the `@returns` of `lexMarkdownLinkDefinitions`:
      ```diff
      - * @returns `marked`'s map from normalised label (whitespace runs collapsed to
      - *   one space, lowercased) to `{ href, title }`.
      + * @returns `marked`'s map from a label's key ({@link linkLabelKey}) to `{ href, title }`.
      ```
    - `markdownSerializer.ts`, in `resolvesToNode`. Add `linkLabelKey` to the existing import from `~/component/display/markdownExtensions.js`, then:
      ```diff
      -    const key = node.getReference().label.replace(/\s+/g, " ").toLowerCase();
      +    const key = linkLabelKey(node.getReference().label);
      ```
      and in the comment above the function:
      ```diff
      - * URL and title, matching labels as `marked` does: whitespace runs collapsed
      - * to one space, then lowercased. An empty title counts as none, as `marked`
      + * URL and title, matching labels as `marked` does ({@link linkLabelKey}).
      + * An empty title counts as none, as `marked`
      ```
    - `markdownWritable.ts`. Add `linkLabelKey` to the existing import from `~/component/display/markdownExtensions.js`, then in `$adoptDefinitionTitles`:
      ```diff
      -        const definition = definitions[node.getReference().label.replace(/\s+/g, " ").toLowerCase()];
      +        const definition = definitions[linkLabelKey(node.getReference().label)];
      ```
      in `$namesLabel`:
      ```diff
      -    const keyed = sources.replace(/\s+/g, " ").toLowerCase();
      +    const keyed = linkLabelKey(sources);
      ```
      and in the comment above `$namesLabel`:
      ```diff
      - * `marked` keys them (whitespace runs one space, lowercased). The runs'
      + * `marked` keys them ({@link linkLabelKey}). The runs'
      ```
    - Check: `grep -rn 'replace(/\\s+/g, " ").toLowerCase()' src/typescript/lib/component` finds nothing.
    - Run the file again: all pass.

12. **`tests/component/markdown-editor.test.ts`.**

    Row `E19` with command `h2` leaves `DIFFERS`:
    ```diff
    -        ['E19', '- one\ttab\n- z', 'one', null, 'h2', '## one   tab\n\n- z', '- one\ttab\n- z'],
    ```
    and joins `SAME` as its last row, directly above the `];` that closes `const SAME: ParityRow[] = [`:
    ```ts
            // A tab in an item's text is content: both surfaces keep it.
            ['E19', '- one\ttab\n- z', 'one', null, 'h2', '## one\ttab\n\n- z', '## one\ttab\n- z'],
    ```
    The other `E19` row, with command `UL`, stays in `DIFFERS`.

    Test `a heading declines on a line the viewer does not show`:
    ```diff
    -    // The editor keeps this document as a raw block, which shows `b`; the
    -    // viewer hides it. Only the decline is checked.
    -    it('a heading declines on a line the viewer does not show', () => {
    +    // `b` is a paragraph after the quote: a fence closed inside a nested quote ends the lines the quote takes.
    +    it('a heading acts on the line after a fence closed inside a nested quote', () => {
    ```
    and, as the last assertion of that test:
    ```diff
    -        expect(editor.getValue()).toBe(doc);
    +        expect(editor.getValue()).toBe('> > ```\n> > a\n> > ```\n## b');
    ```

13. **`tests/component/markdown-importer.test.ts`.**

    Row R7:
    ```diff
    -        ['R7', '&#35; x', '&#35; x'],
    +        ['R7', '&#35; x', '\\# x'],
    ```
    Add directly after test `I26`:
    ```ts
        it('I26b: a link written around a link is no link: its brackets and destination are text around the inner link', () => {
            const editor = load('[a [b](/2) c](/1)');

            expect(firstBlockInline(editor)).toEqual([
                { text: '[a ' },
                { link: '/2', children: [{ text: 'b' }] },
                { text: ' c](/1)' },
            ]);
            expectSurface(editor, '[a [b](/2) c](/1)');
        });
    ```
    In `describe('import: a link whose text all sits in links nested in it'`, add directly above `const breaks`:
    ```ts
            // A link written around a link is no link (CommonMark: a link's text holds no link). Its brackets and its
            // destination are text, which an edited block saves escaped. [source, its save once ' q' is typed at the end]
            const around: Array<[string, string]> = [
                ['x [[a](/in)](/out) y', 'x \\[[a](/in)\\]\\(/out) y q'],
                ['[[2]()]()', '\\[[2]()\\]\\() q'],
                ['[~~[6]()~~]()', '\\[~~[6]()~~\\]\\() q'],
                ['[***[0]()***]()', '\\[***[0]()***\\]\\() q'],
                ['[++[1]()++]()', '\\[++[1]()++\\]\\() q'],
                ['**[[a](/in)](/out)** y', '**\\[[a](/in)\\]\\(/out)** y q'],
                ['[[a](/1)[b](/2)](/o)', '\\[[a](/1)[b](/2)\\]\\(/o) q'],
                ['[**[a](/1)**[b](/2)](/o) z', '\\[**[a](/1)**[b](/2)\\]\\(/o) z q'],
                ['x [[\\[a \\]b](/p)](/q)', 'x \\[[\\\\[a \\\\]b](/p)\\]\\(/q) q'],
            ];

            for (const [source, saved] of around) {
                it(`${JSON.stringify(source)} shows the inner link as the viewer does, and saves the brackets around it as text`, () => {
                    const editor = load(source);

                    expectSurface(editor, source);
                    expect(editor.getValue()).toBe(source);
                    typeAtDocumentEnd(editor, ' q');
                    expect(editor.getValue()).toBe(saved);
                    expectSaveShowsSurface(editor);
                    expect(viewerModel(saved).blocks).toEqual(viewerModel(source + ' q').blocks);
                });
            }

            it('removing the inner link of a link written around a link leaves its text between the brackets, which stay text', () => {
                const source = 'x [[a](/in) b](/out) y';
                const editor = load(source);

                select(editor, ['a', 0]);
                editor.removeLink();

                expect(editor.getValue()).toBe('x \\[a b\\]\\(/out) y');
                expectSaveShowsSurface(editor);
            });

    ```
    In the last `around` row the inner link's text is written `\\[a \\]b` in the save. That is how the serializer already writes a bracket in a link's text, and the row's last assertion shows it reads as the source does.

14. **`tests/component/markdown-source-edits.test.ts`.**

    Test `declines when a tab on an item's marker line stands where the command has to read`. Its first two assertions and its last stay:
    ```diff
    -        expect(blockPrefixSource('## ')('- one\ttab\n- z', 2, 2)).toBeNull();
    -        expect(listSource('ordered')('- one\ttab\n- z', 2, 2)).toBeNull();
    +
    +        // A tab in the item's text is content, and the command reads past it.
    +        expect(apply('- one\ttab\n- z', blockPrefixSource('## ')('- one\ttab\n- z', 2, 2)!)).toBe('## one\ttab\n- z');
    +        expect(apply('- one\ttab\n- z', listSource('ordered')('- one\ttab\n- z', 2, 2)!)).toBe('1. one\ttab\n- z');
    ```
    Test `declines a line the viewer does not show`. Replace the two comment lines above it and the whole test with:
    ```ts
        // A fence closed inside a nested quote ends the lines the quote takes: `b` is a paragraph after the quote.
        it('acts on the line after a fence closed inside a nested quote', () => {
            const text = '> > ```\n> > a\n> > ```\nb';
            const at = (command: (text: string, from: number, to: number) => MarkdownSourceEdit | null): string | null => {
                const edit = command(text, text.length, text.length);

                return edit === null ? null : apply(text, edit);
            };

            expect(blockTypes(text)).toEqual(['blockquote', 'paragraph']);
            expect(at(lineCommands.paragraph)).toBeNull();
            expect(at(lineCommands.heading)).toBe('> > ```\n> > a\n> > ```\n## b');
            expect(at(lineCommands.quote)).toBe('> > ```\n> > a\n> > ```\n> b');
            expect(at(lineCommands.bullets)).toBe('> > ```\n> > a\n> > ```\n- b');
            expect(at(lineCommands.numbers)).toBe('> > ```\n> > a\n> > ```\n1. b');
            expect(at(lineCommands.code)).toBe('> > ```\n> > a\n> > ```\n```\nb\n```');
        });
    ```
    `lineCommands.paragraph` returns `null` because `b` is a paragraph already. The decline for text no token stands for stays covered by the test `declines a repeated definition inside a ':::' column, which no column token stands for either`.

    In `describe('REMOVE_LINK_SOURCE — a link nested in a link (whole-stack review fix #16b)'`, add after the `for` loop:
    ```ts

        // A link written around a link is no link: only the inner one is. Taking the inner link's syntax away would
        // leave `[a b](/out)`, which reads as a link to `/out`, so the command declines.
        it.each([
            'x [[a](/in) b](/out) y',
            'x [c [a](/in) b](/out) y',
            'x [c [a](/in)](/out) y',
            'x [[a](/in) b][r] y\n\n[r]: /out',
        ])('declines on the inner link of %j, whose text would join a link around it', (text) => {
            const [from, to] = rangeOf(text, 'a');

            expect(REMOVE_LINK_SOURCE(text, from, to)).toBeNull();
        });
    ```

15. **The corpus.**

    `tests/component/markdown-roundtrip/corpus/dialect.ts`:
    ```diff
    -    { name: 'link nested in a link', source: 'x [[a](/in)](/out) y' },
    +    { name: 'link written around a link', source: 'x [[a](/in)](/out) y', links: ['/in'] },
    ```
    ```diff
    -    { name: 'struck link nested in a link', source: '[~~[6]()~~]() x' },
    -    { name: 'two links nested in a link', source: '[[a](/1)[b](/2)](/o)' },
    +    { name: 'struck link in brackets', source: '[~~[6]()~~]() x', links: [''] },
    +    { name: 'two links in one pair of brackets', source: '[[a](/1)[b](/2)](/o)', links: ['/1', '/2'] },
    ```
    ```diff
    -    { name: 'html block start on a lazy line after a list item', source: '- a\n<div', known: { surface: 'listItemBlocks' } },
    +    { name: 'html block start on a lazy line after a list item', source: '- a\n<div' },
    ```
    Add after the row `two links in one pair of brackets`:
    ```ts
        { name: 'text after a fence closed in a nested quote', source: '> > ```\n> > a\n> > ```\nb', known: { surface: 'quoteBlocks' } },
        { name: 'protocol autolinks', source: 'mailto:foo@bar.baz and xmpp:foo@bar.baz/txt', links: ['mailto:foo@bar.baz', 'xmpp:foo@bar.baz/txt'] },
    ```
    `tests/component/markdown-roundtrip/corpus/referenceLinks.ts`:
    ```diff
    -    { name: 'reference inside a link', source: '[see [ref] here](https://outer)\n\n[ref]: https://e.com', links: ['https://outer', 'https://e.com', 'https://outer'] },
    +    { name: 'reference inside brackets with a destination', source: '[see [ref] here](https://outer)\n\n[ref]: https://e.com', links: ['https://e.com', 'https://outer'] },
    ```
    Add after it:
    ```ts
        { name: 'label matched by case folding', source: '[ẞ] and [Straße][]\n\n[SS]: /url\n[STRASSE]: /street', links: ['/url', '/street'] },
        { name: 'label with whitespace at its edges', source: '[foo ] and [x][ bar]\n\n[foo]: /foo\n[bar]: /bar', links: ['/foo', '/bar'] },
    ```
    - Check: `npx vitest run tests/component/markdown-roundtrip` reports 0 failed.

16. **Comments in the source that state the old reading.**

    [markdownImporter.ts:1651](packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1651), in the comment above `appendLink`:
    ```diff
    - * in nested links (`marked` nests an autolink or a link in link text;
    + * in nested links (`marked` nests an autolink in link text;
    ```
    [markdownSourceLines.ts:429](packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L429), in the comment above `readLineTargets`:
    ```diff
    - * fence or `|||` line, or text the viewer does not show, such as a repeated
    - * definition or a line after a fence closed inside a nested quote — and when
    + * fence or `|||` line, or text the viewer does not show, such as a repeated
    + * definition — and when
    ```
    [markdownSourceEdits.ts:1034](packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts#L1034), in the comment above the function that follows `REMOVE_LINK_SOURCE`:
    ```diff
    - * Builds the edit replacing a link with its text. A link nested in another
    - * link's text (`[[a](/in) b](/out)`) is taken out of the outer link, whose
    - * text before and after it each keep the outer link's target
    - * (`a[ b](/out)`), so its text is unlinked rather than joining the outer
    - * link, as removing the link in WYSIWYG mode does.
    + * Builds the edit replacing a link with its text. An autolink nested in
    + * another link's text (`[<https://a.test/in> b](/out)`) is taken out of the
    + * outer link, whose text before and after it each keep the outer link's
    + * target (`https\://a.test/in[ b](/out)`), so its text is unlinked rather
    + * than joining the outer link, as removing the link in WYSIWYG mode does.
    ```

17. **Documentation.** Make the edits in `## Documentation Impact`.

18. **Run the full checks** in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify (step 7, by `sed`) | `packages/lib/package.json` |
| Modify (step 7, by `sed`) | `package-lock.json` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify (comment only) | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Modify (comment only) | `packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts` |
| Modify (comment only) | `packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts` |
| Modify | `packages/lib/tests/component/markdown-document-panel.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-reference-links.test.ts` |
| Modify | `packages/lib/tests/component/markdown-serializer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-edits.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

The main tree's `node_modules` changes at step 8, by the orchestrator. It is not part of the branch.

---

## Expected Behaviour

All of it is unit-tested; the steps hold the test code. Each expected value below follows from one of three rules, not from what the code happened to produce:

- **R1.** The editor shows what the viewer shows for the same source.
- **R2.** A saved document read by the viewer shows what the editor showed.
- **R3.** An unedited block is saved as it was loaded.

| Case | Expected | Rule | Test |
|---|---|---|---|
| `[a [b](/2) c](/1)` loaded | text `[a `, link `b` to `/2`, text ` c](/1)` | R1 | I26b |
| `x [[a](/in)](/out) y`, then ` q` typed at the end | saved `x \[[a](/in)\]\(/out) y q`, which reads as the source plus ` q` | R2 | `around` rows |
| the same document, unedited | saved as loaded | R3 | `around` rows, second assertion |
| `x [[a](/in) b](/out) y`, WYSIWYG `removeLink()` on `a` | saved `x \[a b\]\(/out) y` | R2 | step 13 |
| the same, source mode | `REMOVE_LINK_SOURCE` returns `null` | the command's own check of its result | step 14 |
| `[a <https://b.test/2> c](/1)` loaded | link `/1` holding `a `, link `https://b.test/2`, link `/1` holding ` c` | R1 | I26 |
| the text `&amp; &#35;` in a paragraph, saved | `&amp; \&#35;`, which reads back as `&amp; &#35;` | R2 | E10 |
| the text `&#12345678; &#abc; &#;` saved | unchanged: none of the three is a reference | R2 | E13 |
| `&#35; x` loaded and saved in the standard form | `\# x` | R1, R2 | R7 |
| `[ẞ]` with `[SS]: /url`, saved in the standard form | `[ẞ]`, not `[ẞ](/url)` | the form a reference was written in is kept while its definition resolves it | step 11 |
| `- one→tab ⏎ - z`, `setBlockType("h2")` on `one` | WYSIWYG `## one→tab ⏎⏎ - z`; source mode `## one→tab ⏎ - z`; both read alike | R1 | E19 |
| `> > ``` ⏎ > > a ⏎ > > ``` ⏎ b`, heading command on `b` | `… ⏎ ## b` | the command acts on a paragraph | steps 12 and 14 |
| `- a ⏎ <div` | viewer and editor both read a list, then an HTML block | R1 | corpus row, no `known` entry |

Nothing needs manual verification: no rendering, focus or pointer behaviour changes.

---

## Verification

From the worktree's root:

- `npm run test` — `typecheck:test`, then the whole library suite. Expect 0 failed, and 55 more tests than the branch's parent.[^final-count]
- `npm run typecheck` and `npm run lint` — both pass. `linkLabelKey` is the only new symbol.
- `npm run docs:api` — zero warnings. `linkLabelKey` is linked only from comments of symbols that are themselves outside the public API.
- `npm run docs:llms:check` — unchanged; no public symbol moved.
- `node -p "require('marked/package.json').version"` — `18.1.0`.
- `grep -n '"marked"' packages/lib/package.json` — one line, `"marked": "18.1.0",`.
- `git status --short` — the twenty paths of `## Files to Create / Modify / Delete` and nothing else. `node_modules` and `dist` are ignored.

From `packages/lib`:

- `npx vitest run tests/component/markdown-roundtrip` — 0 failed. These are the three rules of `## Expected Behaviour` on every corpus document, and the edit fuzz.
- `npx vitest run tests/component/display/markdownLexer.test.ts` — 0 failed. It compares the guarded block slots with their unguarded twin, which is the check that no guard has gone stale.

---

## Documentation Impact

1. **`packages/lib/docs/reference/migration/next.md`** — add this section at the end of the file:

   ````markdown
   ## `Markdown` and `MarkdownEditor` read through `marked` 18.1.0

   **What changed and why.** The library reads Markdown through `marked`
   18.1.0 and pins that exact version. Until now it declared `^18.0.5` and
   was tested on 18.0.9. `marked` released 29 changes to its parser in
   between, and each one that changes a reading brings it in line with the
   CommonMark specification or with GFM. The viewer and the editor change
   together, so a document still reads the same in both. A document that is
   loaded and saved without an edit is still saved byte for byte.

   | Source | Before | After |
   |---|---|---|
   | `[[a](/in)](/out)` — a link written around a link | the link `a` to `/in`; `/out` not shown | the text `[`, the link `a` to `/in`, the text `](/out)` |
   | `&#35;`, `&#x23;` — a numeric character reference | shown as typed | the character it names, `#` |
   | `&amp;`, `&copy;` — a named character reference | shown as typed | shown as typed (unchanged) |
   | a line after a fence closed inside a nested quote | not shown at all | a paragraph after the quote |
   | `- a`, then `<div` on the next line | the HTML block inside the list item | the HTML block after the list |
   | a tab in a list item's text | spaces | the tab |
   | `[ẞ]` with the definition `[SS]: /url` | literal text | a link: labels match by Unicode case folding, and ignore spaces at their edges |
   | `mailto:a@b.cc`, `xmpp:a@b.cc/x` as bare text | a link on the address alone | a link on the whole, as GFM specifies |
   | `Foo`, an indented line, then `===` | a paragraph | a heading |
   | `foo`, then a code fence alone on the last line | one paragraph holding the fence | the paragraph `foo`, then an empty code block |
   | `*a*\🙂` — emphasis, then a backslash and an emoji | emphasis holding `a*`, then `🙂` | emphasis holding `a`, then `\🙂` |
   | a line after a hard line break, starting with spaces | the spaces shown | the spaces dropped |

   In the editor, text typed as `&#35;` is now saved as `\&#35;`, so that it
   stays the text that was typed.

   **Who needs to act.** Nothing fails to compile. Review content that relies
   on one of the readings in the *Before* column. The one most likely to
   matter is a link written around a link: write the outer text without a
   link inside it, or keep only the inner link.

   ```markdown
   <!-- Before: showed "docs" linked to /in -->
   [[docs](/in)](/out)

   <!-- After: pick one target -->
   [docs](/in)
   ```

   An application that showed `&#35;` or `&#169;` as literal text on purpose
   writes `\&#35;` instead.
   ````

2. **`packages/lib/docs/reference/changelog/next.md`.**

   Under `## Breaking changes`, `### Components`, add as the last bullet:
   ```markdown
   - **`Markdown` and `MarkdownEditor` read through `marked` 18.1.0.** The
     parser is pinned to exactly 18.1.0; the library was tested on 18.0.9
     before. A link written around a link (`[[a](/in)](/out)`) shows its
     outer brackets and destination as text, a numeric character reference
     (`&#35;`) reads as its character, a line after a fence closed inside a
     nested quote is shown again, an HTML block on the line after a list item
     ends the list, a tab in a list item's text is kept, a code fence alone on
     a paragraph's last line opens an empty code block, and reference labels
     match by Unicode case folding. Each is the reading CommonMark or GFM
     specifies. See [Migration](/reference/migration/next) for the table.
   ```
   Replace the bullet the pin plan added under `## Changed`, `### Components` (it starts `- **\`marked\` is pinned to exactly 18.0.10.**`) with:
   ```markdown
   - **`marked` is pinned to one exact version, 18.1.0.** The library declared
     `^18.0.5`, so a fresh install resolved the newest 18.x, and an
     application with an older lockfile kept an older one. `marked`'s patch
     releases change how a document reads, so the same document could read
     differently in two applications. The library now declares the version it
     is tested on. An application that depends on `marked` itself at another
     version gets a second copy beside the library's.
   ```
   In the bullet that describes the source-mode commands, replace the example of `removeLink`:
   ```diff
   -  would not read back as intended (markers left literal by Markdown's flanking
   -  rules or a backslash, or cutting another construct). `removeLink` on a link
   -  nested in another link's text takes it out of the outer link
   -  (`[[a](/in) b](/out)` gives `a[ b](/out)`). The block commands work on
   +  would not read back as intended (markers left literal by Markdown's flanking
   +  rules or a backslash, or cutting another construct). `removeLink` on an
   +  autolink nested in another link's text takes it out of the outer link
   +  (`[<https://a.test/in> b](/out)` gives `https\://a.test/in[ b](/out)`). The block commands work on
   ```
   Under `## Fixed`, `### Components`, add:
   ```markdown
   - **A reference keeps its form when its label and its definition's differ
     in case folding or outer spaces.** `[ẞ]` with the definition `[SS]: /url`
     was written `[ẞ](/url)` once its block was edited; it stays `[ẞ]`.
   ```

3. **`packages/lib/docs/components/MarkdownEditor.md`.**

   On line 293, in the sentence about `removeLink`:
   ```diff
   -and takes a link nested in another link's text out of it (`[[a](/in) b](/out)` gives `a[ b](/out)`) so its text is unlinked rather than joining the outer link;
   +and takes an autolink nested in another link's text out of it (`[<https://a.test/in> b](/out)` gives `https\://a.test/in[ b](/out)`) so its text is unlinked rather than joining the outer link, and does nothing on the inner link of a link written around a link (`[[a](/in) b](/out)`), where `[a b](/out)` would read as a link;
   ```
   In the table of command conditions, row `canLink` (line 185):
   ```diff
   -either end of it is in a link nested in another link
   +either end of it is in an autolink nested in another link
   ```
   and row `canRemoveLink` (line 186):
   ```diff
   -or that link is nested in another link
   +or that link is an autolink nested in another link
   ```

4. **`packages/lib/docs/components/Markdown.md`.**

   In the *Supported syntax* table, add a row after the `[label]: url "title"` row:
   ```markdown
   | `&#35;`, `&#x23;` | the character the reference names (`#`); a named reference (`&amp;`, `&copy;`) is shown as typed |
   ```
   Change the `[text](url)` row:
   ```diff
   -| `[text](url)` | `<a href target="_blank" rel="noopener noreferrer">` |
   +| `[text](url)` | `<a href target="_blank" rel="noopener noreferrer">`; a link written around a link (`[[a](/in)](/out)`) is no link, and its brackets and destination show as text around the inner link |
   ```
   Change the reference-link row:
   ```diff
   -| `[text][label]`, `[label][]`, `[label]` | `<a>` whose href is the matching reference definition's URL; labels match case-insensitively, and an undefined label renders as literal text |
   +| `[text][label]`, `[label][]`, `[label]` | `<a>` whose href is the matching reference definition's URL; labels match by Unicode case folding with outer spaces ignored, and an undefined label renders as literal text |
   ```
   In the sentence the pin plan wrote on line 25, nothing changes: it names no version.

---

## Potential Challenges

- **A plan that landed first added tests that pin a reading of 18.0.10.** Step 9's second table says what to do with each such test; the implementer reports every test it changed that this plan does not list. On the measured base there is none.
- **`markdown-editor-link-format-command-fixes` runs after this plan.** Its row S2 names the document `[[b - c](https://y)](https://x)` with the caret at offset 5 of `b - c`: that is the fixture `NESTED_LINK` of rows A7 and A9, which step 2 swaps. Its implementer uses the fixture as it stands after this plan, `[<https://y.test/b-c>](https://x)`, with the caret in a word at offset 2 of `https://y.test/b-c`, and writes no test on a link written around a link with brackets.
- **`recordingLexer` passes `marked`'s list tokenizer a view of the lexer made with `Object.create`.** `marked` 18.1.0's `Lexer` has a private method, which a view cannot call. The list tokenizer only reads `state`, `inlineQueue` and `blockTokens` from the view, and every list test passes on 18.1.0. Do not call `inlineTokens` on the view.
- **Every worktree runs on 18.1.0 from step 8.** Any other open branch that still declares 18.0.10 fails MV2 until it is rebased onto this branch; the message names both versions. The held branch `markdown-editor-raw-block-range-edits` also fails 49 tests of its own on 18.1.0, beside the 43 it fails on 18.0.10: 48 in `markdown-source-places.test.ts` (16 on a tab after a task marker, #4086; 22 on spaces after a hard line break, #4075; 9 on a link written around a link, #4051; and the corpus sweep `SP10`, whose first documents hold `&#35;`, #4076) and `TL5` in `markdown-editor-command-crashes.test.ts` (a tab in an item's text, #4086). Step 9's second table gives the change for each cause; that work belongs to whoever rebases that branch, not to this plan.
- **A dev server started before step 8.** Vite may keep serving its pre-bundled copy of 18.0.10. Restart any demo or docs dev server after step 8, with `--force` if a page still reads the old way.
- **The escape in a table cell, a link's text or a heading.** `needsEscape` runs for text in every context; the new case does not read the context. `\&` is an escape `marked` accepts wherever text is.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts) — `needsEscape` (line 5687) and the constants it reads (lines 283 to 308) are the precedent for the new case; `resolvesToNode` (line 4236) is one of the three key sites.
- [packages/lib/src/typescript/lib/component/display/markdownExtensions.ts](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts) — `lexMarkdownLinkDefinitions` (line 658), which `linkLabelKey` sits above; the three correcting tokenizers (lines 370, 467, 502), which do not change.
- [packages/lib/src/typescript/lib/component/editor/markdownWritable.ts](packages/lib/src/typescript/lib/component/editor/markdownWritable.ts) — `$adoptDefinitionTitles` (line 1307) and `$namesLabel` (line 1356).
- [packages/lib/src/typescript/lib/component/editor/markdownImporter.ts](packages/lib/src/typescript/lib/component/editor/markdownImporter.ts) — `appendLink` (line 1662) and `appendNestedLinkRuns` (line 1745): the nested-link code that stays. Read to understand what part A's documents exercise.
- [packages/lib/tests/component/markdown-roundtrip/harness.ts](packages/lib/tests/component/markdown-roundtrip/harness.ts) — `assertCheck`: a corpus row's `known` entry must fail, which is why step 15 removes one.
- [packages/lib/tests/unit/marked-version.test.ts](packages/lib/tests/unit/marked-version.test.ts) — the pin plan's guard; between steps 7 and 8 it fails MV2, and after step 8 it passes.
- [plans/marked-version-pin-or-upgrade.md](plans/marked-version-pin-or-upgrade.md) — its addendum holds the per-version measurements this plan builds on.

---

## Non-Goals

- **Decoding named character references.** `&amp;` and `&copy;` stay as typed here. The plan `markdown-named-character-references`, written later and built on this one, decodes them in the viewer and the editor alike. See decision 3.
- **Removing the editor's nested-link code.** A link around an autolink still nests on 18.1.0, so the code is still reached.[^around]
- **Making source mode's Remove link write escaped brackets.** See decision 5.
- **Using a numeric reference to write emphasis the standard form cannot.** The cases in `emphasis next to a word: a run between a letter and punctuation stays lossy` stay lossy; only their comment changes.
- **Changing `markdown-tab-column-parity`.** What it can drop after this plan is listed in the footnote on order; revising that plan is separate work.[^order]
- **The SQLAdmin repository.** It takes the new `marked` with the next library release; its notices file follows then.
- **A CI job for future `marked` versions.** The guard test fails on any drift; a later upgrade is planned the way this one was.

---

## Addendum: Measured

The test counts were measured on commit `34d48e32c` (the tip of `feature/markdown-editor-typing-shortcuts-only-for-typing`) with the pin plan's edits applied, in a private copy of the repository outside every worktree. The copy had a `node_modules` of its own, whose `marked` folder was replaced by each published version in turn; nothing was installed into the main tree or a worktree. Measurements of `marked` alone (nesting, tab documents, timings) were taken on commit `75d022ba1`. The method, and the table of which upstream change breaks which test, are in the addendum of [`marked-version-pin-or-upgrade`](marked-version-pin-or-upgrade.md). The scripts and outputs are kept under `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans4/marked-revision/`, and the earlier ones under `scratch-keep/plans3/marked-version/`.

### The prototype

Every edit of this plan was applied to the copy from this plan's text: a script replaced each `diff` block's `-` lines with its `+` lines, found by their text, and inserted each code block where its step says. No edit was written by hand.

| State | `marked` | Failing tests |
|---|---|---|
| base with the pin | 18.0.10 | 0 of 19,621 in the whole suite |
| base with the pin | 18.1.0 | 48 of 9,805 Markdown tests |
| after part A | 18.0.10 | 0 of 1,783 in the five files part A edits |
| after part A | 18.1.0 | 8 of 9,801 Markdown tests, the ones in step 9's table; the guard's two pass |
| after parts A and B | 18.1.0 | 0 of 19,676 in the whole suite |

The seven test files the plan edits hold 5,638 tests on the base with the pin and 5,689 after it. On the last row `npm run typecheck`, `npm run typecheck:test` and `npm run lint` passed. The docs app's type check and its suite (2,615 tests), run against a `dist/lib` built in the copy, passed on 18.1.0.

### The 48 tests, by cause

| Upstream change | Tests | In this plan |
|---|---|---|
| "do not nest a link inside a link" (#4051, 18.0.11) | 40 | 35 given a document that nests, or is kept as written, on both versions, and 4 removed in part A; the corpus row `reference inside a link` re-pinned in step 15 |
| "match html block start conditions when ending a list item" (#4072, 18.0.13) | 1 | step 15: the `known` entry goes |
| "preserve internal tabs in list item content" (#4086, 18.0.14) | 2 | steps 12 and 14 |
| "decode numeric character references in text" (#4076, 18.0.14) | 3 | steps 10 and 13, and one swapped in part A |
| "keep text after empty nested blockquote" (#4101, 18.0.14) | 2 | steps 12 and 14 |

Part A also swaps the documents of six tests that pass on both versions but would no longer test what their titles say: `a link split by a nested link…`, the two `blankLinks` rows, `colour on a link nested in a link`, `a run holding a link nested in a link…` and `a level 2 heading whose continuation line…`.

### Typed text

19,893 strings were each put into a paragraph, saved, and read back by the viewer.

| Serializer | `marked` | Strings that read back as typed |
|---|---|---|
| base | 18.0.10 | 18,839 |
| base | 18.1.0 | 15,461 |
| with the escape | 18.0.10 | 18,839 |
| with the escape | 18.1.0 | 18,839 |

All 3,378 strings lost on 18.1.0 hold a numeric character reference. With the escape the saved text is the same on both versions. The 1,054 strings that do not read back on either version hold a tab or a run of spaces, which is outside this plan.

### Links that still nest

100,000 generated inline documents were lexed through `lexMarkdown`. On 18.0.9, whose links read as 18.0.10's, 326 held a link token inside a link token; on 18.1.0, 56 did, every one through an autolink in the outer link's text. `commonmark.js` 0.31.2 reads `[a <https://x.y/z> b](/u)` the same way: a link holding a link.

### The tab documents

The 111 tab documents of `markdown-tab-column-parity`, read through `lexMarkdown` and compared with `commonmark.js`:

| `marked` | Read as `commonmark.js` | Block structure differs | Only literal text differs |
|---|---|---|---|
| 18.0.9, 18.0.12 | 77 | 15 | 19 |
| 18.0.13 | 85 | 15 | 11 |
| 18.0.14, 18.1.0 | 88 | 14 | 9 |

So the upgrade alone fixes 11 of the 34, and that plan's container-prefix tokenizers are still needed for the rest.

### What 18.0.10 costs in time

Three of the documents upstream wrote to catch slow regular expressions, lexed by `marked` alone:

| Document | 18.0.10 | 18.1.0 | Fixed by |
|---|---|---|---|
| 250,781 characters of footnote-like definitions | 12.6 s | 76 ms | #4040 (18.0.11) |
| 406,792 characters of nested reference definitions | 12.4 s | 93 ms | #4040 (18.0.11) |
| `[](` followed by 50,000 no-break spaces | stopped after 25 s | 5 ms | #4106 (18.1.0) |

These are inline rules; the library's guarded block slots do not bound them.

---

## Notes

[^measured]: Of 669 documents (the 492 of the round-trip corpus of `34d48e32c`, 66 from the fixtures upstream added with its fixes, and 111 tab documents), 68 read differently on 18.1.0 than on 18.0.10. `marked`'s output moves onto `commonmark.js` 0.31.2's on 54 of them, matched it before and after on 7, and matches it neither before nor after on 7. None moves away. The 7 are GFM constructs CommonMark does not have (strikethrough; `mailto:` and `xmpp:` autolinks, where 18.1.0 follows the GFM specification's examples 633 to 635), one document only the library's own HTML tokenizer reads correctly, and one tab document. Of the 652 CommonMark examples, the count `marked` alone gets right is 628 on 18.0.10, 632 on 18.0.11, 640 on 18.0.12 and 646 from 18.0.13; no example that passes on one version fails on a later one. Between 18.0.10 and 18.1.0 upstream lists 27 fixes and features; 26 change the parser and one the command-line tool.

[^cost-of-staying]: The dropped line is a regression upstream introduced in 18.0.9 (#4030) and fixed in 18.0.14 (#4101): for `> > ``` ⏎ > > a ⏎ > > ``` ⏎ b`, versions 18.0.9 to 18.0.13 give `b` no token, so the viewer shows nothing for it. Two tests of the stack pin that as "a line the viewer does not show". The timings are in the addendum; an application that shows Markdown it did not write can be stalled by such a document on 18.0.10.

[^target]: 18.1.0 and 18.0.14 fail the same 48 tests and read all 608 documents measured on `75d022ba1` alike but two, which hold an unbalanced parenthesis in a link destination (#4107, where 18.1.0 matches `commonmark.js`). 18.1.0 adds the fix for the 20-second document of the addendum's last table (#4106) and a fast exit for unterminated links (#4070). Its type declarations differ from 18.0.9's by additions only (18.0.10's are 18.0.9's) (`Tokens.Link.autolink`, two lexer state flags, three rule names), and `tsc` over the library's source with `marked` resolved to 18.1.0's declarations reports no error. `marked` is MIT-licensed on both versions.

[^around]: CommonMark: "Links may not contain other links, at any level of nesting." Upstream's fix made its examples 518, 519 and 532 pass. The rule in `commonmark.js` covers links written with brackets; an autolink inside a link's text still nests there, and in `marked` 18.1.0: measured, 56 of 100,000 generated documents hold a link token inside a link token on 18.1.0, each through an autolink. So `appendNestedLinkRuns`, `nestedLinkPieces`, `keepIntactNestedLinks`, `rewrapNestedLinkRuns`, `$selectionInNestedLinkRun` and the two node states are still reached, and part A keeps a test on each path by giving it a document that nests on both versions. Deleting that code would need `marked` to stop nesting autolinks, or a tokenizer of the library's own that declines such a link; neither is this plan.

[^named]: `marked` gives a text token's `text` with named references as typed and leaves decoding to the HTML it would render; the viewer builds DOM text nodes from `text`, so it shows `&copy;`. From 18.0.14 `marked` decodes numeric references in the tokenizer itself (#4076), which is why only they change. A tokenizer that put the numeric references back would undo a fix that matches CommonMark. The owner wants named references decoded too, in the viewer and the editor alike (decision 3 of 2026-10-14). That needs the table of HTML entity names in the library, a reading the editor imports and a save that keeps typed text typed, so it is a plan of its own, `markdown-named-character-references`, built on this one. Nothing in this plan makes it harder: the escape of decision 4 is the pattern that plan extends to named references.

[^escape]: Measured on 19,893 typed strings: on 18.1.0 without the escape, 3,378 do not read back as typed, all of them holding a numeric reference; with it, none of those is lost, and the saved text is identical on 18.0.10 and 18.1.0, because `\&` is an escape both versions read as `&`. The regular expression is `marked` 18.1.0's own rule for a numeric reference, anchored at the `&`. The case reads `site.text` from `site.index`, as the `:` and `.` cases beside it read `site.text` up to `site.index`; a reference cannot span two text nodes of different formats, since a format's delimiters would stand inside it.

[^label-key]: `marked` 18.0.9 and 18.0.10 keyed a definition as `label.toLowerCase()` with whitespace runs collapsed. 18.0.13 folds case through upper case (#4077) and 18.0.14 trims (#4091); in 18.1.0 both are in its `normalizeLabel`, `label.trim().toLowerCase().toUpperCase().toLowerCase()`, applied where the definition is filed and where a label is looked up. The library's three copies of the old rule are [markdownSerializer.ts:4241](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L4241) and [markdownWritable.ts:1313](packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1313) and line 1362. Measured on 18.1.0: with the old key, `resolvesToNode` does not find the definition of `[ẞ]` under `ß`, and the standard-form save writes `[ẞ](/url)`; with the new key it writes `[ẞ]`. The reading is the same either way, so no round-trip rule was broken; the reference form was lost. No difference was found for the two sites in `markdownWritable.ts` in the cases tried (a definition edited after load, with a folded or padded label); they change with the third so that one rule is written once. The function lives in `markdownExtensions.ts` because that module returns the map the key indexes.

[^remove-declines]: Measured on 18.1.0: `REMOVE_LINK_SOURCE` returns `null` for the four documents of step 14, where on 18.0.10 it took the nested link out of the outer one. The WYSIWYG command on the same document removes the link and saves `x \[a b\]\(/out) y`, which reads as the editor shows it. The source command builds its edit from the source text and declines when the result would not read back as intended; here the plain unwrap leaves `[a b](/out)`. Writing the escapes in source mode is possible, but it is new behaviour for a command whose other results never add escapes around the selection.

[^tokenizers]: Tried against `marked` alone on every version from 18.0.5 to 18.1.0: `- [ ] foo ⏎⏎   [x] bar` still loses the marker of the later paragraph (`listWithOwnTaskMarker`), `> - a ⏎ > - a ⏎ c ⏎ > - a ⏎ c ⏎ <div>` still gives tokens whose `raw` do not join into the source (`blockquoteWithSourceRaw`), and `<div` as a last line is still a paragraph (`htmlWithInputEndAsLineEnd`). `markdownLexer.test.ts`, which compares the guarded slots with their unguarded twin on 5,000 random documents, passes on 18.1.0, and the two lexers agree on all 669 measured documents. Upstream changed three rules the guards were read off (`hr` now allows tabs between its characters, `lheading` no longer stops at indented code, the HTML rule's tag names are stricter); none changes what a guard's first-character test admits.

[^install-step]: The owner's rule is that no agent runs `npm install`, `npm ci` or `npm update`: every worktree's `node_modules` is a symlink to the main tree's, so an install changes what every branch runs on. The owner permitted the orchestrator, on 2026-10-14, to run the `marked` installs of the pin plan and of this plan, limited to `marked`. The install runs in the main tree because that is the folder every worktree reads. The main tree is on `master`, so `npm install` also rewrites master's `packages/lib/package.json` and `package-lock.json`; the orchestrator puts them back, and the change reaches `master` when the line is merged. The dry run catches an install that would add or remove other packages. Running it after part A, not before, keeps the suite green on both versions until the version moves; running it at all, rather than giving this worktree a `node_modules` of its own, keeps the one-folder rule every worktree follows.

[^lock-edit]: Tried on copies of the repository's manifests outside the repository, with no `node_modules`, starting from the pin's lockfile: `npm install marked@18.1.0 --save-exact -w packages/lib --package-lock-only` wrote the same `packages/lib/package.json` as the first `sed` command, byte for byte, and the same `package-lock.json` as both `sed` commands but for one line: npm 11.12.1 rewrites `"dev": true,` as `"devOptional": true,` in the `node_modules/typescript` entry. It writes that line with no package requested at all, so it is not part of the `marked` change, and the branch leaves it out. The second `sed` command only edits lines between `"node_modules/marked": {` and the entry's closing `},`. CI's `npm ci` fails when the lockfile and `package.json` disagree, so a wrong edit cannot pass CI.

[^order]: Measured on the 111 tab documents of `markdown-tab-column-parity`: the upgrade alone brings the library's reading onto `commonmark.js` for 11 of the 34 that differ on 18.0.9. Eight are a tab after one to three spaces in indented code, which that plan's `codeWithTabIndent` corrects (upstream #4080 does the same from 18.0.13). Three are tabs in a list item's content, which its `listWithTabStops` protects with a stand-in character because 18.0.9 expands them (upstream #4086 stopped doing so in 18.0.14). After this plan both are corrections of defects `marked` no longer has. Its tokenizers for tabs in a list's or a quote's prefix are still needed: 14 documents still differ in block structure on 18.1.0. That plan reports that its tokenizers read its documents alike on 18.0.9 and 18.1.0, so it can run on either; running it after this plan lets it be revised to leave the two out. `markdown-source-mode-list-lift-parity` depends on the tab plan and was measured on 18.0.9; it names this version question as owned elsewhere. `markdown-editor-link-format-command-fixes` runs after this plan and needs no document swapped: its one nested-link case is the fixture part A swaps (see `## Potential Challenges`). The other unstarted Markdown plans (`markdown-editor-cross-item-range-removal`, `-large-document-costs`, `-list-looseness-transform-cost`, `-reload-differences`, `-table-command-fixes`, `-typing-at-link-start-swallowed`, `markdown-source-mode-block-locator` and `-command-gaps`) were measured on 18.0.9; each implementer checks a failing test against step 9's second table. The held branch `markdown-editor-raw-block-range-edits` is rebased onto this one after it closes; its 49 failures on 18.1.0 are listed in `## Potential Challenges`.

[^part-a-count]: Part A removes four rows and adds none: `a link inside a link` (its autolink twin is the row above it), `[[2]()]()` and `x [[\[a \]b](/p)](/q)` from the `sources` list, and `a link holding a link whose text escapes a bracket, in a heading`. An autolink has no text of its own to escape a bracket in, so the last three subjects cannot be written with one. Step 13's `around` rows pin `[[2]()]()` and `x [[\[a \]b](/p)](/q)` under their new reading; the heading row is not pinned again, because its document is no longer kept as written.

[^final-count]: Measured on `34d48e32c` with the pin: 19,621 tests in the whole suite, 19,676 after this plan. The seven test files this plan edits go from 5,638 to 5,689. Part A removes 4. Part B adds 2 in step 10 (E12, E13), 4 in step 11, 1 in step 13's I26b, 10 in step 13's `around` rows and `removeLink` test, 4 decline rows in step 14, and 38 through step 15: seven checks for each of the four new corpus rows, a links check for each of the six rows that gain or newly declare `links`, and one edit-fuzz test for each new row. That is 55 in all; the four edit-fuzz tests are in `markdown-edit-fuzz.test.ts`, outside the seven files. The branches that land between `34d48e32c` and this plan add tests of their own, so compare with the branch's parent, not with these totals.

## Implementation Notes

- Commit order: the part A test swaps, the numeric-reference escape, the pin with the tests, corpus rows and comments that re-pin the 18.1.0 readings, the label key, then three documentation commits (one per functionality; the plan's single migration section is split across them). Every commit below the pin is green on 18.0.10, its own declared version (checked with a private `node_modules` whose `marked` is the stored 18.0.10 copy): the escape commit re-pins R7 (`markdown-importer.test.ts`) to `\&#35; x`, which is what 18.0.10 saves with the escape, and the pin commit moves it to `\# x`. The label key sits above the pin because it needs 18.1.0: on 18.0.10 `marked` keys `[ẞ]` as `ß` and `[ foo ]` as ` foo `, so the new key would write those references inline. The installed `marked` is 18.1.0 throughout, so on it the commits below the pin fail: `tests/unit/marked-version.test.ts` (MV2); the five Markdown test files part A edits fail 5 tests that only the pin commit re-pins; the two corpus tests of `markdown-roundtrip.test.ts` (`html block start on a lazy line after a list item` and `reference inside a link`) fail; and E10 in `markdown-serializer.test.ts` fails at the part A commit, before the escape. The commits above the pin pass their own test files.
- Deviation, plan step 4: the replacement document `~~5 [![](g)][r]~~` imports on 18.1.0 as a live reference link node, not as a reference kept as written, so DEF3, DEF4, DEF5, DEF7, DEF8 and DEF14 lost their subject. They now load `x [<https://a.test>][r] tail`, a link written around an autolink, which still nests and is kept as written on both versions. Each asserts first that the block holds that kept source run, and each fails when `$namesLabel` is bypassed (checked by mutation, restored afterwards). DEF3 now retypes the definition's label so the reference stops resolving, since the autolink hides the reference's URL; DEF14 asserts the source run's key changes, so the block really goes through `$showBlockAnew`.
- Deviation, plan step 14: the plan's replacement test dropped the `tableSource(2, 2)` assertion on the nested-quote line; it is back, pinning that the table is inserted before `b`.
- The plan's Documentation Impact missed the sentence in `docs/components/MarkdownEditor.md` that listed "a line after a fence closed inside a nested quote" among the source the block commands decline on; it now lists only a repeated definition. The `canLink` JSDoc, `MarkdownDocumentPanel.md` and the context-menu sentence of `MarkdownEditor.md` say "an autolink nested in another link", as the plan's other `MarkdownEditor.md` edits do. The `Markdown.md` reference-label row is in the pin's documentation commit: it states a reading that starts at the pin.
- Beyond the plan: `$namesLabel` keyed the whole joined source, so a kept run written `[ r ]` never matched the key `r` (18.1.0 trims a label). It now keys each bracketed text on its own, with an escape-aware pattern (`(?:\\.|[^[\]\\])*`, as in the serializer), so a label that escapes a bracket (`[ r\]s ]` against `[r\]s]: /r`) matches too; the whole-source fallback it replaced is gone, since the pattern covers what it did. Tests: `x [<https://a.test>][ r ] tail`, `x [<https://a.test>][ r\]s ] tail` and `x [<https://a.test>][ẞ] tail` (against `[SS]: /r`), each with its definition retyped to `[q]: /s`; with lowercase-only keys the fold test fails.
- The plan's `[^label-key]` footnote says no difference was found for the two sites in `markdownWritable.ts`; that holds only for `$adoptDefinitionTitles`. `$namesLabel` differs with folded, trimmed or escaped labels, as the tests above show. For `$adoptDefinitionTitles` a failing document was sought and not found: `[ẞ][]` with `[SS]: /url "⏎⏎title"`, `[x][ foo ]` and `[foo ][]` with `[foo]: /url "⏎⏎title"`, each with the definition's title retyped, save the same with the old lowercase-only key and with the new one.
- `npm run docs:api` ran with no warnings and `npm run docs:llms:check` reported `Coverage OK: 108 catalogued, 121 explicitly excluded, 0 unaccounted for`.
- The full suite ran with `--maxWorkers=2`: 564 files, 18,787 passed and 2 todo, 18,789 in all, which is the parent's 18,731 in all plus 58: the plan's 55 and the 3 extra `$namesLabel` tests.
- Not done, by the orchestrator's instruction: the audit loop, the move to `plans/implemented/`, and the rebase-clean checkpoint (the branch sits on a chained phase). The plan has no manual-verify items.
