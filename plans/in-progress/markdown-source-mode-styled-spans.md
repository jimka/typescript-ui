---
depends-on:
  - markdown-source-mode-editing
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/tests/component/markdown-source-edits.test.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/components/MarkdownDocumentPanel.md
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Source-Mode Styled Spans — Implementation Plan

## Overview

[`markdown-source-mode-editing.md`](plans/markdown-source-mode-editing.md) — the
sibling plan this one builds on — made `MarkdownEditor`'s inline, link and
block-prefix commands edit the raw Markdown while `getMode() === "source"`. It
left three commands behind:
`setTextColor`, `setFontFamily` and `setFontSize`, which all funnel through the
private
[`patchSelectionStyle(patch)`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1471)
and stay no-ops in source mode.

This plan makes those three work. It adds one transform factory,
`spanStyleSource(patch)`, to the pure module that plan created
(`component/editor/markdownSourceEdits.ts`), and turns the single Phase 0 guard
inside `patchSelectionStyle` into the one-line `editSource` branch every other
source-mode command already uses. No other production file changes.

The syntax written is the dialect's styled span,
[`STYLED_TEXT`](packages/lib/src/typescript/lib/component/editor/markdownStyleTransformers.ts#L23)
— `[text]{color=… font=… size=…}`. The hard part is not wrapping text in it;
it is **merging** a new attribute into a span that is already there, splitting
it when only part of it is selected, and taking it away again when the last
attribute is cleared.

---

## Architecture Decisions

### The transform joins the module the sibling plan created

`spanStyleSource(patch)` is a new export of
`packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts`, with
the same `MarkdownSourceTransform` return type as that module's
`linkSource(url)`. It adds nothing to the package barrel. Nothing the sibling
plan decided changes: its range normaliser, its link locator and its
`editSource` helper are all used exactly as they stand.[^same-module]

### Re-emit runs through the same pipeline the WYSIWYG export runs

Every attribute group this transform writes is produced by
`formatAttributes(spanStyleToAttributes(resolveSpanStyle(merged)))` — the exact
three calls
[`STYLED_TEXT.export`](packages/lib/src/typescript/lib/component/editor/markdownStyleTransformers.ts#L25)
makes. That one choice settles attribute order, attribute validation and
unknown-key handling at once. It makes the bytes written in source mode
identical to the bytes WYSIWYG would have written for the same style, so a span
written here survives a switch to WYSIWYG and back unchanged.[^shared-pipeline]

### Values are neither validated nor escaped by the source path

A value that fails `resolveSpanStyle` is dropped on re-emit, exactly as the
WYSIWYG export drops it. The command is not refused on account of its value, and
the value is not escaped. A CSS *property* the dialect has no attribute key for
is a different matter: there the whole command declines.[^no-validation]

### The value space is whatever the three setters accept

`setTextColor` / `setFontFamily` / `setFontSize` are public, so any CSS string
already reaches them. Source mode accepts the same range the WYSIWYG path does
and is not restricted to `MarkdownDocumentPanel`'s fixed Red/Green/Blue,
Serif/Monospace, Small/Large palette.

### A span is found by `]{`, never by `](`

An existing span is located with
[`STYLED_TEXT.importRegExp`](packages/lib/src/typescript/lib/component/editor/markdownStyleTransformers.ts#L37)
itself — `/\[([^[\]]+)\]\{([^{}]*)\}/` — made global. Requiring `{` immediately
after `]` is what keeps a link out of the match, the same reasoning the viewer's
[`STYLED_SPAN_EXTENSION`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L77)
records for the read-only side.[^link-vs-span]

### Partial coverage splits the span, because WYSIWYG splits it

Selecting part of an existing span's text rewrites it into two or three spans:
the selected part carries the merged attributes, the rest keep the
originals. Lexical's `$forEachSelectedTextNode` splits a partially selected
text node the same way, so the two surfaces agree.[^split-not-widen]

### The brackets always land outside the emphasis markers

Before anything else, the range widens outward over any run of `*`, `~`, `+`
or `` ` `` that flanks it symmetrically, so a bold word becomes
`[**hello**]{color=…}` and never `**[hello]{color=…}**`.[^extrude]

### Three refusals keep the span syntax writable

The transform declines — returns `null` — for a range containing a newline, a
range overlapping a `[…](…)` link or `![…](…)` image, and a run of text that
would have to be bracketed while containing a `[` or `]`.[^refusals]

### Source mode contributes nothing to the selection state

`MarkdownEditorSelectionState` gains no colour, font or size field, and
`MarkdownDocumentPanel` is not touched. Its Text style dropdown builds a fixed
palette once at construction
([MarkdownDocumentPanel.ts:267](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L267))
with no checkmarks to keep live, so there is nothing for a new field to
drive.[^no-state]

---

## Public API

No exported signature changes. `MarkdownEditor.setTextColor`,
`setFontFamily` and `setFontSize` keep their shapes; only their behaviour in
`"source"` mode changes, and their JSDoc with it.

### `markdownSourceEdits.ts` (internal — not barrelled)

One new export, beside the sibling plan's `linkSource`:

```typescript
/**
 * Applies a colour/font/size patch to the raw Markdown around the selection,
 * writing the dialect's `[text]{key=value …}` styled span. Merges into an
 * existing span rather than nesting inside it, splits one that is only partly
 * selected, and removes the whole `{…}` group when the patch clears its last
 * attribute.
 *
 * @param patch - Kebab-case CSS property names (`color`, `font-family`,
 *   `font-size`) mapped to their new value, or `null` to remove that property
 *   — the same bag `MarkdownEditor`'s three style setters build.
 * @returns The edit rule, which yields `null` for a patch this dialect cannot
 *   express and for a selection the span syntax cannot be written around.
 */
export function spanStyleSource(patch: Record<string, string | null>): MarkdownSourceTransform;
```

---

## Internal Structure

### From the CSS patch to the dialect's attribute keys

`patchSelectionStyle` builds a kebab-case CSS patch; the span syntax uses three
shorter keys. The mapping is the one
[`cssTextToAttributes`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L308)
and
[`spanStyleToCss`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L281)
already encode in the other direction:

```typescript
/** The span attribute key for each kebab-case CSS property the three style setters patch. */
const ATTRIBUTE_KEY_BY_CSS_PROPERTY: Record<string, string | undefined> = {
    "color":       "color",
    "font-family": "font",
    "font-size":   "size",
};
```

| CSS patch | Attribute patch |
|---|---|
| `{ color: "#cc0000" }` | `{ color: "#cc0000" }` |
| `{ "font-family": "Georgia, serif" }` | `{ font: "Georgia, serif" }` |
| `{ "font-size": null }` | `{ size: null }` |
| `{ "text-decoration": "underline" }` | — the transform returns `null` |

### The range

Starting from the raw `[from, to)`:

1. **Refuse a newline.** `text.slice(from, to).includes("\n")` → `null`. A span
   cannot cross a line break in this dialect.
2. **Normalise** with the sibling plan's existing normaliser — trim whitespace
   inward, expand a collapsed caret to its enclosing word, absorb edge markers,
   give up when the result is empty. Call the result `[a, b)`.
3. **Extrude emphasis markers.** While `a > 0`, `b < text.length`,
   `text[a - 1] === text[b]`, and that character is one of `*`, `~`, `+`,
   `` ` ``: decrement `a` and increment `b`.
4. **Refuse a link or image overlap.** Over
   `/!?\[([^[\]]*)\]\(([^()]*)\)/g`, refuse when any match's range intersects
   `[a, b)`.

| Text (selection shown `‹…›`) | Result of the four steps | Why |
|---|---|---|
| `a ‹hello› b` | `[a, b)` = `hello` | nothing to trim or extrude |
| `a **‹hello›** b` | `[a, b)` = `**hello**` | step 3 extrudes the `*` runs on both sides |
| `a ‹**hello**› b` | `[a, b)` = `**hello**` | step 2 absorbs to `hello`, step 3 extrudes straight back |
| `[‹hello›]{color=red}` | `[a, b)` = `hello` | `[` and `]` are not marker characters |
| `a ‹ › b` | refused (step 2) | whitespace only, nothing to act on |
| `see [‹docs›](/d)` | refused (step 4) | inside a link |
| `one‹\n›two` | refused (step 1) | a span cannot cross a line break |

### The units, and the edit range

Collect every newline-free match of `/\[([^[\]]+)\]\{([^{}]*)\}/g`. For a match
starting at `i`, its **full range** is `[i, i + match[0].length)` and its **text
range** is `[i + 1, i + 1 + match[1].length)`.

The edit range starts at the smaller of `a` and the lowest full-range start
among the spans that intersect `[a, b)`, and ends at the larger of `b` and the
highest full-range end among them. Widening this way is what lets a span that
the selection only clips be rewritten whole.

Walking the edit range left to right gives an alternating list of **units** —
each one a stretch of *visible* text with the attributes it carries. A span
contributes its text range with `parseAttributes(match[2])`; everything between
spans contributes itself with `{}`. Span syntax (`[`, `]`, `{…}`) belongs to no
unit and is re-emitted rather than carried.

### The pieces

Each unit `[u0, u1)` splits into three pieces at the selection's boundaries,
clamped into the unit: `pa = min(max(a, u0), u1)` and `pb = min(max(b, u0), u1)`.

| Piece | Range | Patched |
|---|---|---|
| before | `[u0, pa)` | no |
| selected | `[pa, pb)` | yes |
| after | `[pb, u1)` | no |

Clamping is also what handles a selection boundary that lands inside a span's
syntax: an offset inside `[` maps to the text's start, one inside `]{…}` maps to
its end, so that span's text is simply not patched.

### Emitting a piece

```typescript
/** One run of visible text the rewrite re-emits, with the attributes it carries. */
interface StyledPiece {
    text:       string;
    attributes: Record<string, string>;
    patched:    boolean;
}

/**
 * Re-emits one piece: bare text when its resolved attribute set is empty, else
 * `[text]{…}`. Returns `null` when a bracketed emission would carry a `[` or
 * `]`, which the dialect's span text cannot hold.
 *
 * @param piece - The piece to emit.
 * @param patch - The attribute patch, applied only when `piece.patched`.
 * @returns The emitted Markdown, or `null` to decline the whole edit.
 */
function emitPiece(piece: StyledPiece, patch: Record<string, string | null>): string | null {
    if (piece.text === "") {
        return "";
    }

    const merged = { ...piece.attributes };

    if (piece.patched) {
        for (const [key, value] of Object.entries(patch)) {
            if (value === null) {
                delete merged[key];
            } else {
                merged[key] = value;
            }
        }
    }

    const resolved = spanStyleToAttributes(resolveSpanStyle(merged));

    if (Object.keys(resolved).length === 0) {
        return piece.text;
    }

    return /[[\]]/.test(piece.text) ? null : `[${piece.text}]{${formatAttributes(resolved)}}`;
}
```

`insert` is every piece's emission concatenated. The edit is declined — `null`
— when any piece declines, and when `insert` equals the text the edit range
already holds.

### The resulting selection

The selection lands on the user's own text in the rewritten document: from the
start of the first **patched, non-empty** piece's text to the end of the last
one. Record both offsets while building `insert`.

| Selection before | `insert` | Selection after |
|---|---|---|
| `‹hello› world` | `[hello]{color=#cc0000}` | `hello`, at offsets 1–6 |
| `[hello ‹world›]{size=1.2em}` | `[hello ]{size=1.2em}[world]{color=#2563eb size=1.2em}` | `world`, at offsets 21–26 |

Landing inside the brackets rather than around them keeps a following Bold press
producing `[**hello**]{color=…}`, which is the shape that survives a round trip.

### Worked cases

| Before (selection `‹…›`) | Command | After |
|---|---|---|
| `‹hello› world` | `setTextColor("#cc0000")` | `[hello]{color=#cc0000} world` |
| `[‹hello›]{size=1.2em}` | `setTextColor("#cc0000")` | `[hello]{color=#cc0000 size=1.2em}` |
| `[‹hello›]{color=#cc0000}` | `setTextColor(null)` | `hello` |
| `[‹hello›]{color=#cc0000 size=1.2em}` | `setTextColor(null)` | `[hello]{size=1.2em}` |
| `[hello ‹world›]{size=1.2em}` | `setTextColor("#2563eb")` | `[hello ]{size=1.2em}[world]{color=#2563eb size=1.2em}` |
| `‹The [warning]{color=#cc0000} is loud.›` | `setFontSize("1.2em")` | `[The ]{size=1.2em}[warning]{color=#cc0000 size=1.2em}[ is loud.]{size=1.2em}` |
| `a **‹hello›** b` | `setTextColor("#cc0000")` | `a [**hello**]{color=#cc0000} b` |
| `[‹hello›]{weight=bold}` | `setTextColor("#cc0000")` | `[hello]{color=#cc0000}` — `weight` is not a span key |

Attribute order in the output is always `color`, then `font`, then `size` —
`spanStyleToAttributes`'s own order. A hand-written span in another order is
re-ordered once, on its first edit, and is stable from then on.

### `MarkdownEditor.patchSelectionStyle`

The sibling plan's Phase 0 left one guard at the top of the method. It becomes
the branch every other source-mode command already uses:

```typescript
if (this.editSource(spanStyleSource(patch))) {
    return this;
}
```

---

## Ordered Implementation Steps

`SRC-TEST` means
`npm -w packages/lib exec -- vitest run tests/component/markdown-source-edits.test.ts`
and `MD-TEST` means
`npm -w packages/lib exec -- vitest run tests/component/markdown-editor.test.ts`
— the same shorthand the sibling plan uses.

1. `packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts` —
   extend the existing `~/component/display/markdownAttributes.js` import with
   `parseAttributes`, `formatAttributes`, `resolveSpanStyle` and
   `spanStyleToAttributes`.
   *Check:* `npm -w packages/lib run typecheck`.
2. Same file — add the module-private `ATTRIBUTE_KEY_BY_CSS_PROPERTY` map, the
   `StyledPiece` interface and `emitPiece`, all from `## Internal Structure`.
3. Same file — add the module-private span scanner
   (`/\[([^[\]]+)\]\{([^{}]*)\}/g`, skipping any match whose text contains a
   newline) and the bracket-construct scanner
   (`/!?\[([^[\]]*)\]\(([^()]*)\)/g`). Keep the sibling plan's own link
   locator as it is — it answers a different question and
   `toggleLink` / `removeLink` depend on its exact semantics.
4. Same file — add the exported `spanStyleSource(patch)` from `## Public API`:
   the four range steps, the CSS-to-attribute translation through
   `ATTRIBUTE_KEY_BY_CSS_PROPERTY` (declining on an unmapped property), the unit
   walk, the piece split, `emitPiece` per piece, and finally the decline when
   `insert` equals the text the edit range already holds — in that order.
   *Check:* `npm -w packages/lib run typecheck` and `npm -w packages/lib run lint`.
5. `packages/lib/tests/component/markdown-source-edits.test.ts` — add the
   `describe('spanStyleSource')` block from `## Expected Behaviour` ›
   *The transform*, reusing the file's existing `apply(text, edit)` helper.
   *Check:* `SRC-TEST` green.
6. `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — add
   `spanStyleSource` to the existing
   `~/component/editor/markdownSourceEdits.js` import.
7. Same file — in `patchSelectionStyle`
   ([:1471](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1471)),
   replace the sibling plan's `if (this.isSourceMode()) { return this; }` guard
   with the `editSource` branch from `## Internal Structure`.
   *Check:* `npm -w packages/lib run typecheck`.
8. Same file — rewrite the sibling plan's *"No-op in `"source"` mode, where the
   raw-Markdown surface is shown."* sentence in the JSDoc of
   `patchSelectionStyle`, `setTextColor`
   ([:1502](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1502)),
   `setFontFamily`
   ([:1514](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1514))
   and `setFontSize`
   ([:1527](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1527)),
   to:

   ```
   In `"source"` mode this writes the `[text]{…}` styled span into the raw
   Markdown instead, merging into an existing span rather than nesting inside
   it. Refused there for a selection that crosses a line break or touches a
   link.
   ```

   Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) (*Don't `{@link}` internal
   symbols from public JSDoc*), do not link `spanStyleSource`,
   `resolveSpanStyle` or any other module-private symbol from these four
   comments.
   *Check:*
   `grep -c 'if (this.isSourceMode()) { return this; }' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`
   — expect 11, one fewer than the sibling plan's Step 25 left behind:
   `setBlockAlignment`, `setColumnCount` and the nine table-structure commands.
   Recount from the file and report a mismatch rather than editing code to make
   the number come out.
9. `packages/lib/tests/component/markdown-editor.test.ts` — add the
   `describe('MarkdownEditor source-mode styled spans')` block from
   `## Expected Behaviour` › *In `MarkdownEditor`*, and remove `setTextColor`,
   `setFontFamily` and `setFontSize` from the sibling plan's source-mode no-op
   block.
   *Check:* `MD-TEST` green.
10. `packages/lib/docs/components/MarkdownEditor.md`,
    `packages/lib/docs/components/MarkdownDocumentPanel.md` and
    `packages/lib/docs/reference/changelog/next.md` — apply
    `## Documentation Impact`.
    *Check:* `npm run docs:api` — 0 errors, 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/tests/component/markdown-source-edits.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/MarkdownDocumentPanel.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### The transform (unit-testable, `packages/lib/tests/component/markdown-source-edits.test.ts`)

Every row of the *range*, *resulting selection* and *worked cases* tables in
`## Internal Structure` becomes a case, run through the file's
`apply(text, edit)` helper — a range-table row is asserted through the edit its
`[a, b)` produces, or with `toBeNull()` for a refused row. Plus:

- **A new span wraps the selection.**
  `spanStyleSource({ color: '#cc0000' })('hello world', 0, 5)` returns
  `{ from: 0, to: 5, insert: '[hello]{color=#cc0000}', selection: { from: 1, to: 6 } }`.
- **A second attribute merges rather than nests.**
  `spanStyleSource({ 'font-size': '1.2em' })('[hello]{color=#cc0000} world', 1, 6)`
  applies to `'[hello]{color=#cc0000 size=1.2em} world'`, selection
  `{ from: 1, to: 6 }`.
- **Clearing the last attribute removes the brackets.**
  `spanStyleSource({ color: null })('[hello]{color=#cc0000} world', 1, 6)`
  applies to `'hello world'`, selection `{ from: 0, to: 5 }`.
- **Clearing one of two keeps the group.**
  `spanStyleSource({ color: null })('[hello]{color=#cc0000 size=1.2em} world', 1, 6)`
  applies to `'[hello]{size=1.2em} world'`.
- **A partly selected span splits.**
  `spanStyleSource({ color: '#2563eb' })('[hello world]{size=1.2em}', 7, 12)`
  applies to `'[hello ]{size=1.2em}[world]{color=#2563eb size=1.2em}'`, with the
  selection on `world`.
- **A selection covering a span and plain text rewrites both.**
  `spanStyleSource({ 'font-size': '1.2em' })('The [warning]{color=#cc0000} is loud.', 0, 37)`
  applies to
  `'[The ]{size=1.2em}[warning]{color=#cc0000 size=1.2em}[ is loud.]{size=1.2em}'`.
- **Emphasis markers end up inside the brackets.**
  `spanStyleSource({ color: '#cc0000' })('a **hello** b', 4, 9)` returns
  `{ from: 2, to: 11, insert: '[**hello**]{color=#cc0000}', selection: { from: 3, to: 12 } }`.
- **A collapsed caret takes its word.**
  `spanStyleSource({ color: '#cc0000' })('a hello b', 4, 4)` applies to
  `'a [hello]{color=#cc0000} b'`.
- **A collapsed caret with no word declines.**
  `spanStyleSource({ color: '#cc0000' })('a  b', 2, 2)` returns `null`.
- **A caret inside the attribute text declines.**
  `spanStyleSource({ color: '#cc0000' })('[x]{color=red}', 10, 10)` returns
  `null` — the word expansion lands on `red`, which clamps out of the span's
  text, leaving the edit range unchanged.
- **A newline declines.**
  `spanStyleSource({ color: '#cc0000' })('one\ntwo', 0, 7)` returns `null`.
- **A selection inside a link declines.**
  `spanStyleSource({ color: '#cc0000' })('see [docs](/d) here', 5, 9)` returns
  `null`.
- **A selection straddling a link declines.** The same text with `(5, 16)`
  returns `null`.
- **A selection inside an image's alt text declines.**
  `spanStyleSource({ color: '#cc0000' })('a ![alt](/i.png) b', 4, 7)` returns
  `null`.
- **A stray bracket declines.**
  `spanStyleSource({ color: '#cc0000' })('a [b c', 0, 6)` returns `null`.
- **An unknown CSS property declines.**
  `spanStyleSource({ 'text-decoration': 'underline' })('hello', 0, 5)` returns
  `null`.
- **A no-op clear declines.** `spanStyleSource({ color: null })('hello', 0, 5)`
  returns `null` — the replacement equals what it replaces.
- **An invalid value on plain text declines.**
  `spanStyleSource({ color: 'nope!' })('hello', 0, 5)` returns `null`.
- **An invalid value clears an existing one.**
  `spanStyleSource({ color: 'nope!' })('[x]{color=#cc0000}', 1, 2)` applies to
  `'x'`, matching what the WYSIWYG export does with the same unusable value.
- **An unknown attribute key is dropped on re-emit.**
  `spanStyleSource({ color: '#cc0000' })('[x]{weight=bold}', 1, 2)` applies to
  `'[x]{color=#cc0000}'`.
- **A font family with a space is quoted.**
  `spanStyleSource({ 'font-family': 'Georgia, serif' })('hello', 0, 5)` applies
  to `'[hello]{font="Georgia, serif"}'`.
- **A second identical press changes nothing.** Applying the first case's edit
  and re-running `spanStyleSource({ color: '#cc0000' })` over the resulting
  span's text returns `null`.

### In `MarkdownEditor` (unit-testable, `packages/lib/tests/component/markdown-editor.test.ts`)

Offline, `CodeEditor.getSelection()` reports a collapsed caret at offset 0, so a
command with no injected view acts on the document's first word. **A second
command in the same test still sees that same offset-0 caret**, so every case
that needs the caret somewhere else injects a duck-typed view —
`codeEditorOf(editor)._view = { state: EditorState.create({ doc, selection: { anchor, head } }), dispatch }`
with `dispatch = vi.fn()` — and asserts the dispatched transaction, exactly as
the sibling plan's Phase 1 cases do.

- **A colour reaches the source text.**
  `new MarkdownEditor('hello world', { mode: 'source' }).setTextColor('#cc0000').getValue()`
  is `'[hello]{color=#cc0000} world'`.
- **A font family reaches the source text.**
  `new MarkdownEditor('hello world', { mode: 'source' }).setFontFamily('Georgia, serif').getValue()`
  is `'[hello]{font="Georgia, serif"} world'`.
- **A second attribute merges into the span.** With the injected view over
  `'[hello]{color=#cc0000} world'` and `{ anchor: 1, head: 6 }`,
  `setFontSize('1.2em')` dispatches once, with
  `changes: { from: 0, to: 22, insert: '[hello]{color=#cc0000 size=1.2em}' }`
  and `selection: { anchor: 1, head: 6 }`.
- **Clearing the last attribute takes the span away.** The same injected view,
  `setTextColor(null)`, dispatches
  `changes: { from: 0, to: 22, insert: 'hello' }` and
  `selection: { anchor: 0, head: 5 }`.
- **The Lexical editor is never built.** `lexicalOf(editor)` is `null` after any
  of the above.
- **A link still refuses.** With the injected view over `'see [docs](/d)'` and
  `{ anchor: 5, head: 9 }`, `setTextColor('#cc0000')` dispatches zero times.
- **Read-only refuses and signals.** With `readOnly: true` on `'hello world'`,
  `setTextColor('#cc0000')` leaves `getValue()` unchanged and emits one
  `"readonlyedit"` on the source editor.
- **Focus is restored.** Spying the private `_codeEditor`'s `focus`,
  `setTextColor('#cc0000')` on `'hello world'` calls it once. It is called on
  the declined path too — the injected link view above dispatches nothing, and
  `focus` is still called once.
- **WYSIWYG is unaffected.** The existing cases at
  [markdown-editor.test.ts:391](packages/lib/tests/component/markdown-editor.test.ts#L391)
  and [:405](packages/lib/tests/component/markdown-editor.test.ts#L405) pass
  unchanged.

### Round-trip (unit-testable, same file) — the dialect guarantee

For each of `'[hello]{color=#cc0000} world'`,
`'[hello]{color=#cc0000 size=1.2em} world'`,
`'[hello]{font="Georgia, serif"} world'`,
`'a [**hello**]{color=#cc0000} b'` and
`'[hello ]{size=1.2em}[world]{color=#2563eb size=1.2em}'`: build a source-mode
editor on it, call `setMode('wysiwyg')`, and read `getValue()` — the result
equals the input under the file's existing `normalize()` helper. The existing
round-trip corpus at
[markdown-editor.test.ts:68](packages/lib/tests/component/markdown-editor.test.ts#L68)
already covers the single-span forms from the WYSIWYG side; these cases pin the
source side against the same dialect.

### Manual verification only (live-only; the offline sink never mounts a CodeMirror view)

Run the dev app (`npm run dev`, `http://localhost:8015`, **MarkdownEditor**
section) and press the toolbar's **Edit Markdown source** toggle:

- Selecting a word and choosing **Text style › Colour › Red** writes
  `[word]{color=#cc0000}` and leaves `word` selected inside the brackets.
- Choosing **Size › Large** straight afterwards gives
  `[word]{color=#cc0000 size=1.2em}` — one group, not two.
- **Colour › Default** then **Size › Default** returns the bare word, brackets
  and all.
- One menu choice is one **Ctrl/Cmd+Z**.
- Switching to WYSIWYG shows the word in red at the larger size, and switching
  back leaves the Markdown byte-for-byte as it was.
- With the caret inside a link, every Text style entry does nothing and the
  caret stays in the source editor.
- With `setReadOnly(true)`, a Text style entry flashes the editor and changes
  nothing.

---

## Verification

- `npm -w packages/lib run typecheck` — clean.
- `npm -w packages/lib run lint` — clean.
- `SRC-TEST` and `MD-TEST` — green, including every case in
  `## Expected Behaviour`.
- `npm -w packages/lib exec -- vitest run tests/component/markdown-document-panel.test.ts`
  — green with no edits, confirming the toolbar needed no source change.
- `grep -c 'if (this.isSourceMode()) { return this; }' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`
  — expect 11 (see Step 8).
- `grep -rn 'ensureEditor' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`
  — `patchSelectionStyle`'s hit now sits below an `editSource` branch rather
  than an `isSourceMode` guard.
- `npm run docs:api` — 0 errors, 0 link warnings.
- Manual smoke tests: every case in `## Expected Behaviour` › *Manual
  verification only*.

---

## Documentation Impact

**`packages/lib/docs/components/MarkdownEditor.md`.**

- **Command API** ([:75](packages/lib/docs/components/MarkdownEditor.md#L75)):
  in the `setTextColor` / `setFontFamily` / `setFontSize` row, change *"No-op
  inside a link."* to *"No-op inside a link, in either mode."* In the paragraph
  the sibling plan added after the table, move these three commands into the
  works-in-source-mode list and change its count of WYSIWYG-only commands from
  fourteen to eleven.
- **Source / WYSIWYG mode**
  ([:146](packages/lib/docs/components/MarkdownEditor.md#L146)): extend the
  sibling plan's paragraph with one sentence — in source mode the three style
  setters write the `[text]{…}` span directly, merging into a span already
  around the selection and removing the group entirely when the last attribute
  is cleared; attributes are re-emitted in the dialect's own `color`/`font`/`size`
  order, so a hand-written group may be re-ordered once.

**`packages/lib/docs/components/MarkdownDocumentPanel.md`.** **Toolbar**
([:18](packages/lib/docs/components/MarkdownDocumentPanel.md#L18)): the sibling
plan's sentence listing what becomes a no-op after the **Edit Markdown source**
toggle drops **Text style** from that list — the Table, Alignment and Columns
dropdowns stay there — and gains a clause saying the Text style dropdown writes
the styled span into the raw text instead.

**`packages/lib/docs/reference/changelog/next.md`.** One entry under *Added* ›
*Components*: `setTextColor` / `setFontFamily` / `setFontSize` now edit the raw
Markdown in `"source"` mode, merging into an existing `[text]{…}` span.

---

## Potential Challenges

- **`formatAttributes` does not escape a double quote or a newline.** A font
  family containing `"`, or an `rgb()` value containing a newline, survives
  `resolveSpanStyle` and then serialises ambiguously. This is pre-existing and
  shared with the WYSIWYG export path, which writes the identical string; the
  toolbar palette never produces either. Do not add a source-only guard — it
  would make the two surfaces disagree for input that is already broken on
  both.
- **A range mixing an emphasis run with other text produces one span where
  WYSIWYG produces two.** `[**bold** plain]{color=…}` imports correctly, but
  Lexical re-exports it as `[**bold**]{color=…}[ plain]{color=…}` on the first
  mode switch. Information is preserved; only the byte form is re-normalised
  once. Splitting at emphasis-run boundaries would need a parser, which this
  module deliberately is not.
- **The multi-span round-trip case depends on Lexical keeping adjacent,
  differently-styled text nodes apart.** If
  `'[hello ]{size=1.2em}[world]{color=#2563eb size=1.2em}'` does not come back
  unchanged, report the actual output rather than weakening the assertion — it
  would mean the dialect's own export is merging spans, which is a finding
  about `STYLED_TEXT`, not about this transform.
- **Guard counts drift.** The `grep -c` check in Step 8 is written against the
  file as the sibling plan leaves it. Recount and report a mismatch rather than
  editing code to make the number come out.

---

## Critical Files

| File | Why |
|---|---|
| `plans/markdown-source-mode-editing.md` | The plan this one builds on: `markdownSourceEdits.ts`, `MarkdownSourceEdit`/`MarkdownSourceTransform`, the range normaliser, `editSource`, `CodeEditor.replaceRange`. Read it first. |
| [`markdownSourceEdits.ts`](packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts) | The module this plan extends — the normaliser to reuse, `linkSource` as the factory shape to mirror, and the link locator to leave alone. |
| [`markdownStyleTransformers.ts`](packages/lib/src/typescript/lib/component/editor/markdownStyleTransformers.ts#L23) | `STYLED_TEXT` — the `importRegExp` to reuse, and the export pipeline the re-emit must match call for call. |
| [`markdownAttributes.ts`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L188) | `parseAttributes`, `formatAttributes`, `resolveSpanStyle`, `spanStyleToAttributes` — and the validators that decide what a value may be. |
| [`markdownTransformers.ts`](packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts#L68) | Why `STYLED_TEXT` sits after `LINK`, and the full list of syntax the dialect may emit. |
| [`markdownExtensions.ts`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L77) | The viewer's `STYLED_SPAN_EXTENSION`, whose comment states the `]{`-versus-`](` rule this plan's detection follows. |
| [`MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1471) | `patchSelectionStyle` and the three setters — the one insertion point and the four JSDoc comments to rewrite. |
| `plans/implemented/markdown-rich-formatting-extension.md` | *Colour, font, and size are refused inside a link* (§ Architecture Decisions, line 113) and its footnote — the decision the source path mirrors. |
| [`markdown-editor.test.ts`](packages/lib/tests/component/markdown-editor.test.ts#L68) | The existing round-trip corpus and the `normalize()` / `lexicalOf` / `codeEditorOf` helpers the new cases use. |

---

## Non-Goals

- **Colour / font / size in the selection state.** `MarkdownEditorSelectionState`
  gains no field and `MarkdownDocumentPanel` is not touched. Live checkmarks in
  the Text style dropdown would need the WYSIWYG side to report the same three
  fields, a widened `selectionStatesEqual`, and the menu rebuilt per open — a
  separate change that is not required for the commands to work.
- **A pending style for a collapsed caret.** WYSIWYG's `$patchStyleText` stores
  a style on an empty selection so the next character typed carries it. A text
  buffer has nowhere to keep that, so in source mode a caret with no word under
  it does nothing at all.
- **Recolouring across a line break.** A `[text]{…}` span cannot cross one in
  this dialect, and emitting one span per line would need the block-prefix
  awareness this module does not have.
- **Recolouring link text.** Refused in source mode for the reason the WYSIWYG
  side already refuses it. Image alt text is refused alongside it: an image has
  no text node for the WYSIWYG side to style either.
- **`setBlockAlignment` / `setColumnCount` and the nine table-structure
  commands.** Backlog, documented in
  `plans/research/markdown-source-mode-backlog.md`. They keep their
  `isSourceMode()` guards.
- **Fixing `formatAttributes`'s quoting.** See `## Potential Challenges`.

---

## Notes

[^same-module]: A second module would have to duplicate the range normaliser
    (trim, word expansion, marker absorption) and the give-up rule, and the two
    copies would drift the first time either is tuned. Putting the transform
    beside `linkSource` also keeps one test file for the whole source-mode
    transform surface. The sibling plan's own exports are unchanged: this plan
    adds a function, and reads the normaliser it already has.

[^shared-pipeline]: The question "what order do attributes come out in, and what
    happens to an invalid or unknown one" has an answer already, and it is the
    one `STYLED_TEXT.export` gives:
    `formatAttributes(spanStyleToAttributes(resolveSpanStyle(…)))`.
    `spanStyleToAttributes` writes `color`, then `font`, then `size`,
    unconditionally, so repeated edits converge on one form instead of churning
    the document; `resolveSpanStyle` drops an unknown key and an invalid value.
    Reusing the three calls means the source surface and the WYSIWYG surface
    produce byte-identical Markdown for the same style, which is what makes the
    round-trip criterion hold by construction rather than by testing.

[^no-validation]: The tempting alternative is to refuse a value that fails
    `resolveSpanStyle`, on the grounds that raw user text should not be written
    into a `{…}` group. It is the wrong call, because the WYSIWYG path does not
    refuse it either — it hands the value to `$patchStyleText` and the export
    drops it later, so `setTextColor('nope!')` on an already-red word clears the
    red in WYSIWYG. Running the same resolve one step earlier reproduces that
    exactly, including the clear. As for escaping: every value that survives
    `resolveSpanStyle` is free of `{`, `}`, `[` and `]`, so the group and the
    bracket syntax cannot be broken by one. The residual `"`/newline gap is in
    `formatAttributes` and is hit identically by both surfaces — see
    `## Potential Challenges`.

[^link-vs-span]: `LINK` sits before `STYLED_TEXT` in `TRANSFORMERS` precisely
    because both constructs start with `[`. On the textual side the
    disambiguation is simpler and runs the other way: a span requires `{`
    immediately after `]`, which `[text](url)` never has, and an image's
    attribute group (`![alt](src){width=…}`) puts its `{` after `)`, not after
    `]`. The delimiter-row width group and the `:::` fence group are not
    preceded by `]` at all. So one regex separates all four, with no lookahead
    and no ordering rule to remember.

[^split-not-widen]: The three options were splitting the span, refusing the
    edit, and widening the selection to the whole span. Lexical settles it:
    `$patchStyleText` routes through `$forEachSelectedTextNode`, which calls
    `splitText(startOffset, endOffset)` on a partially selected node and styles
    only the middle part, leaving the outer parts with their original style. So
    WYSIWYG splits, and both surfaces agreeing matters more than either
    behaviour on its own. Widening would also surprise a user who deliberately
    selected one word of a long coloured run; refusing would make the command
    look broken.

[^extrude]: This is a correctness requirement, not a cosmetic one.
    `@lexical/markdown`'s `importTextTransformers` applies the *outermost*
    match first, so `**[hello]{color=…}**` applies the bold format and then
    recurses into the bold node, where `STYLED_TEXT.replace` builds a fresh
    `$createTextNode` — which starts with no format and does not inherit one
    through `replace`. The bold is silently lost on the first mode switch.
    `[**hello**]{color=…}` takes the other branch: the span matches outermost,
    its text is recursed into, and the bold is applied to the styled node. That
    is also the form `STYLED_TEXT.export` produces, since it wraps
    `exportFormat(node, …)` *inside* the brackets. Extruding marker runs before
    wrapping is what puts the brackets on the outside in every case. The
    sibling plan's normaliser absorbs edge markers inward for the inline
    toggles, which is the opposite move; running absorption and then extrusion
    is a net identity for a balanced run, so the normaliser is reused as it
    stands rather than split.

[^refusals]: Each refusal exists for a different reason. A newline: the
    importer works line by line, so a `[…]{…}` that spans one can never be read
    back as a span. A link or image overlap: a span may not nest inside a link
    (the originating plan's decision, mirrored here), and a range that clips a
    link's syntax would put a stray `[` or `]` inside the span's text, which
    `importRegExp`'s `[^[\]]+` cannot match. The bracket check on an emitted
    piece is the cheap backstop for everything else bracket-shaped — an
    unbalanced `[`, a nested construct this module does not know about — and it
    only fires when brackets would actually be added, so a piece that emits as
    bare text is never refused for containing one.

[^no-state]: `MarkdownDocumentPanel` builds the Text style dropdown once, at
    construction, and passes the array by value rather than as a thunk, so no
    entry can carry a live checkmark. The Alignment and Columns dropdowns pass
    thunks and do read live state, which is what makes the difference visible.
    Adding colour / font / size to `MarkdownEditorSelectionState` would
    therefore change nothing a user can see until the dropdown is also
    converted to a thunk and the WYSIWYG side is taught to report the same
    three fields — three changes, none of which the commands need in order to
    work. The honest report for source mode is the one the sibling plan already
    makes: the fields it can compute from raw text, and no others.
