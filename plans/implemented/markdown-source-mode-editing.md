---
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/components/MarkdownDocumentPanel.md
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Source-Mode Editing — Implementation Plan

## Overview

[`MarkdownEditor`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1013)
shows one of two surfaces through a `Card`: the Lexical WYSIWYG surface, or a
raw-Markdown [`CodeEditor`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1108)
in `"source"` mode. Only `getValue`, `setValue` and `focus` branch on the
mode. All 32 public mutator commands — `toggleBold`, `setBlockType`,
`insertTable`, … — call `ensureEditor()` and act on the Lexical document
whatever the mode is.

That is a live bug. In source mode the Lexical document is never reloaded
from the text the user is typing, so a toolbar press mutates a **stale
shadow copy** of the document. The mutation fires Lexical's update listener,
so a `"change"` event escapes carrying content that is not on screen, and
`_options.value` desyncs from the `CodeEditor`.[^phantom]

This plan does three things, in order. **Phase 0** turns every command into
an explicit, documented no-op in source mode — a standalone bug fix.
**Phase 1** adds the plumbing (a pure transform module, a range-replacement
seam on `CodeEditor`, a mode-branch helper on `MarkdownEditor`, live
source-mode selection state) plus the inline commands. **Phase 2** adds the
block-prefix commands.

---

## Architecture Decisions

### Source mode edits the text, not a re-parsed document

Each source-mode command rewrites the raw Markdown around the current
character range. Nothing is parsed into Lexical and serialised back.[^why-textual]

### All the edit logic lives in one pure module

A new `packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts`
holds every edit as a pure function of the shape
`(text, from, to) => MarkdownSourceEdit | null` — no DOM, no component, no
Lexical. It sits beside its siblings `markdownTransformers.ts`,
`markdownStyleTransformers.ts` and `markdownTableTransformer.ts`, and mirrors
[`markdownAttributes.ts`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts),
the established shape for a pure Markdown helper module: exported free
functions, imported by the components that need them, absent from the package
barrel.[^pure-module]

### An edit names a range, not a whole document

`MarkdownSourceEdit` carries `{ from, to, insert, selection }` — the range of
the *pre-edit* text to replace, the replacement, and where the selection lands
in the *post-edit* text. It is not a whole-document result.[^minimal-range]

### `CodeEditorSelection` gains `from` and `to`

The two document offsets join `characterCount` and `lineCount` on the same
interface, the same getter, and the same `"selectionchange"` payload —
mirroring how `offset` joined `line`/`column` on `CodeEditorCursorPosition`
([CodeEditor.ts:65](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L65),
`plans/implemented/code-editor-document-offset.md`). The `"selectionchange"`
dedup widens to compare all four fields, for the same reason that plan
widened its own.[^dedup-widen]

### `CodeEditor.replaceRange` is the one mutation seam

A new public method dispatches the text change *and* the resulting selection
in a single CodeMirror transaction, so one button press is one undo step. Its
shape follows [`paste()`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1339);
its offsets are clamped against the live document like
[`revealRange()`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1245);
and, like [`applyFormatted`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1471),
it writes the new text into `this._options.value` **before** the `_view` null
check, so the whole feature is assertable offline through `getValue()`.[^offline-cache]

### `replaceRange` refuses a read-only edit, and says so

`replaceRange` returns early when `getReadOnly()` is true, routing through the
existing private `signalReadOnlyEdit()` so the user gets the `"readonlyedit"`
event and the rejection flash. Read-only stays un-gated on the WYSIWYG side;
that asymmetry is named in `## Non-Goals`.[^readonly]

### The mode branch lives in `MarkdownEditor`

Two private helpers keep each command's branch to one line.
`isSourceMode()` is the Phase 0 guard for a command with no source-mode
behaviour. `editSource(transform)` is the Phase 1/2 worker: it reads the text
and range, runs the transform, applies the edit through `replaceRange`,
restores focus, and reports that the command was handled. Neither helper is
public, and `MarkdownDocumentPanel` needs no source change.[^branch-in-editor]

### Focus restore belongs to `editSource`, not to `replaceRange`

A toolbar click blurs the editing surface, so `editSource` ends with
`this._codeEditor.focus(true)` — including when the transform declines to
edit.[^focus]

### The transforms match characters and line prefixes, never a parsed document

A transform works from the characters next to the selection and from line
boundaries. None of them builds a document model, so a toggle will happily
embolden text inside a fenced code block or a table cell. Two textual guards
decline an edit outright — an inline toggle refuses a range containing a
blank line, and inline code refuses a range still containing a backtick — and
the four commands whose contract is explicitly about an *enclosing* construct
find theirs the cheap way: `toggleLink` and `removeLink` with one regex pass
for `[text](url)`, `insertParagraphBeforeBlock` and
`insertParagraphAfterBlock` by matching line prefixes and counting fence
lines.[^no-structure]

### Source mode answers the selection state it can answer honestly

`getSelectionState()` and `"selectionstate"` become mode-aware. In source mode
the five format flags, `hasSelectedText` and `linkUrl` are computed from the
raw text; `inTable` is `false`, `tableColumnAlignment` and `blockAlignment`
are `null`, and `columnCount` is `1`. `MarkdownEditor` subscribes to the
source editor's `"selectionchange"`, and `setMode` emits a fresh state so the
toolbar never keeps a stale pressed state across a switch.[^state-honesty]

### The emitted syntax is this dialect, not stock Markdown

Every marker the transforms write matches the curated
[`TRANSFORMERS`](packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts#L68)
array, so source-mode output survives `setMode("wysiwyg")` unchanged:
`**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `++underline++`,
`[text](url)`, `![alt](src){width=…}`, and a GFM table whose delimiter row is
byte-for-byte what
[`formatDelimiterRow`](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L135)
emits. The image transform calls the same
[`resolveImageSpec`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L417)
and `formatAttributes` the `IMAGE` transformer uses, rather than formatting
the string itself.

---

## Public API

### `CodeEditorSelection`, widened

Replacing the doc comment and interface at
[CodeEditor.ts:81-99](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L81):

```typescript
/**
 * The primary selection's extent inside a {@link CodeEditor}'s document — the
 * payload of its `"selectionchange"` event, and what
 * {@link CodeEditor.getSelection} returns.
 *
 * @category Components
 */
export interface CodeEditorSelection {
    /**
     * Number of characters in the primary selection. 0 for a collapsed
     * selection (a bare caret). Counts UTF-16 code units, like
     * {@link CodeEditorCursorPosition.offset}: a character outside the Basic
     * Multilingual Plane (an emoji) counts as two.
     */
    characterCount: number;
    /** Number of lines the primary selection spans. 1 for a selection confined to a single line, including a collapsed one. */
    lineCount: number;
    /**
     * 0-based document offset of the selection's start — its normalized lower
     * bound, so a selection dragged backward reports the same value as one
     * dragged forward. The same raw position
     * {@link CodeEditorCursorPosition.offset} reports, usable directly with
     * `getValue().slice(from, to)` or as a CodeMirror selection anchor.
     */
    from: number;
    /** 0-based document offset of the selection's end (exclusive). Equal to {@link from} for a collapsed selection. */
    to: number;
}
```

`CodeEditorSelection` is already exported from
[`component/editor/index.ts`](packages/lib/src/typescript/lib/component/editor/index.ts#L7)
— no barrel change.

### `CodeEditor.replaceRange`

```typescript
replaceRange(from: number, to: number, insert: string, selection?: { from: number; to: number }): this;
```

### `markdownSourceEdits.ts` (internal — not barrelled)

```typescript
/** A source-mode edit: the range of the pre-edit text to replace, the replacement, and the selection to leave behind. */
export interface MarkdownSourceEdit {
    /** 0-based start of the range in the pre-edit text that `insert` replaces. */
    from: number;
    /** 0-based end (exclusive) of that range. */
    to: number;
    /** The replacement text for `[from, to)`. */
    insert: string;
    /** The selection to leave behind, as 0-based offsets into the post-edit text. */
    selection: { from: number; to: number };
}

/** A source-mode edit rule: the edit to apply for a document and selection, or `null` to change nothing. */
export type MarkdownSourceTransform = (text: string, from: number, to: number) => MarkdownSourceEdit | null;

/** What a source-mode selection can report about itself from raw text alone. */
export interface MarkdownSourceSelectionState {
    bold:            boolean;
    italic:          boolean;
    underline:       boolean;
    strikethrough:   boolean;
    code:            boolean;
    hasSelectedText: boolean;
    linkUrl:         string | null;
}

// Phase 1
export const BOLD_SOURCE:          MarkdownSourceTransform;
export const ITALIC_SOURCE:        MarkdownSourceTransform;
export const UNDERLINE_SOURCE:     MarkdownSourceTransform;
export const STRIKETHROUGH_SOURCE: MarkdownSourceTransform;
export const INLINE_CODE_SOURCE:   MarkdownSourceTransform;
export const REMOVE_LINK_SOURCE:   MarkdownSourceTransform;
export const CLEAR_FORMAT_SOURCE:  MarkdownSourceTransform;
export function linkSource(url: string | null): MarkdownSourceTransform;
export function readSourceSelectionState(text: string, from: number, to: number): MarkdownSourceSelectionState;

// Phase 2
export const FENCED_CODE_SOURCE: MarkdownSourceTransform;
export function blockPrefixSource(prefix: string): MarkdownSourceTransform;
export function listSource(kind: "unordered" | "ordered"): MarkdownSourceTransform;
export function paragraphAroundBlockSource(after: boolean): MarkdownSourceTransform;
export function imageSource(src: string, alt: string, attributes: Record<string, string>): MarkdownSourceTransform;
export function tableSource(rows: number, columns: number): MarkdownSourceTransform;
```

No `MarkdownEditor` signature changes. The behaviour of its 32 commands in
source mode changes; the types do not.

---

## Internal Structure

### The normalised range

Every inline transform and `readSourceSelectionState` starts from the same
normalisation of the raw `[from, to)`, in this order:

1. **Trim whitespace inward.** Advance `from` past leading whitespace, retreat
   `to` past trailing whitespace.
2. **Expand a collapsed caret** to the enclosing run of word characters, using
   the same class the WYSIWYG side uses —
   `WORD_CHARACTER = /[\p{L}\p{N}_]/u`
   ([MarkdownEditor.ts:592](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L592)).
3. **Absorb edge markers.** While the first and last characters of the range
   are the same marker character and the range is longer than two characters,
   move both ends inward by one. A marker character is one of `*`, `~`, `+`
   and `` ` ``.
4. **Give up** when the result is empty — return `null`.

| Selection (shown `‹…›`) | Normalised range | Why |
|---|---|---|
| `a ‹hello › b` | `hello` | trailing space trimmed out of the range |
| `a he‹›llo b` | `hello` | collapsed caret expands to the enclosing word |
| `a ‹**hello**› b` | `hello` | edge markers absorbed into the surrounding run |
| `a ‹ › b` | `null` | whitespace only, nothing to act on |
| `a ‹› b` (caret on the space) | `null` | no word under the caret |

### The inline-marker rule

Each inline toggle is `{ char, count }`: bold `{ "*", 2 }`, italic
`{ "*", 1 }`, strikethrough `{ "~", 2 }`, underline `{ "+", 2 }`, inline code
`` { "`", 1 } ``.

Let `n` be the smaller of the two runs of `char` immediately outside the
normalised range. A one-character marker is **active** when `n` is odd (a run
of two in the `*` family means bold, not italic); a two-character marker is
active when `n` is at least two. Active means the press removes `count`
characters from each side; inactive means it inserts `count` on each side.

| Text (selection = `hello`) | Press | `n` | Result |
|---|---|---|---|
| `hello` | Bold | 0 | `**hello**` |
| `**hello**` | Bold | 2 | `hello` |
| `**hello**` | Italic | 2 | `***hello***` |
| `***hello***` | Bold | 3 | `*hello*` |
| `*hello*` | Italic | 1 | `hello` |
| `~~hello~~` | Strikethrough | 2 | `hello` |
| `++hello++` | Underline | 2 | `hello` |

The resulting selection always covers the same visible text it covered
before, shifted by however many marker characters were added or removed on
the left.

Two guards decline the edit outright, returning `null`:

- The normalised range contains a blank line (`/\n[ \t]*\n/`) — markers can
  never pair across a paragraph break.
- Inline code only: the range still contains a `` ` ``.

### `clearFormatting`

On the normalised range: delete the surrounding runs of marker characters,
then delete every `**`, `*`, `~~`, `++` and `` ` `` inside it, longest first.
Links and `[text]{…}` styled spans are left alone, matching the WYSIWYG
command, which clears text formats only
([MarkdownEditor.ts:1629](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1629)).
No-op on a collapsed caret that expands to nothing.

| Before (selection = `hello`) | After |
|---|---|
| `***hello***` | `hello` |
| `**a *hello* b**` (selection = `a *hello* b`) | `a hello b` |
| `[hello](x)` (selection = `hello`) | `[hello](x)` — unchanged |

### The link locator

One regex pass over the whole document:
`/\[([^[\]]*)\]\(([^()]*)\)/g`, skipping any match preceded by `!` (an
image). The enclosing link is the first match whose span contains the whole
raw selection.

| Before | Command | After |
|---|---|---|
| `see ‹docs› here` | `toggleLink("/d")` | `see [docs](/d) here`, selection on `docs` |
| `see [do‹›cs](/d) here` | `toggleLink("/e")` | `see [docs](/e) here` |
| `see [do‹›cs](/d) here` | `removeLink()` | `see docs here`, selection on `docs` |
| `see ‹docs› here` | `removeLink()` | unchanged (`null`) |

### Block-prefix commands (Phase 2)

Each expands the selection to whole lines, rewrites each line, and leaves the
whole rewritten range selected. Two shared patterns:

```typescript
/** A leading heading, quote, bullet or numbered-list marker — what a block-type change replaces. */
const BLOCK_PREFIX = /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+\.[ \t]+)/;

/** A fence line, dropped rather than re-prefixed when a block type changes. */
const FENCE_LINE = /^[ \t]*```/;
```

`blockPrefixSource(prefix)` strips `BLOCK_PREFIX` from every selected line,
drops every `FENCE_LINE`, then prepends `prefix`. `FENCED_CODE_SOURCE` does
the same strip and then wraps the whole run in ` ``` ` lines.

| Selected lines | Command | Result |
|---|---|---|
| `## Title` | `setBlockType("quote")` | `> Title` |
| `> quoted` | `setBlockType("h2")` | `## quoted` |
| `- item` | `setBlockType("paragraph")` | `item` |
| `hello` | `setBlockType("code")` | ` ``` ` / `hello` / ` ``` ` |
| ` ``` ` / `hello` / ` ``` ` | `setBlockType("paragraph")` | `hello` |

`listSource(kind)` toggles off when **every** selected line already carries
that list's marker; otherwise it strips `BLOCK_PREFIX` and adds `- ` (or
`1. `, `2. `, … counting from one).

| Selected lines | Command | Result |
|---|---|---|
| `a` / `b` | `toggleUnorderedList()` | `- a` / `- b` |
| `- a` / `- b` | `toggleUnorderedList()` | `a` / `b` |
| `- a` / `b` | `toggleUnorderedList()` | `- a` / `- b` |
| `a` / `b` | `toggleOrderedList()` | `1. a` / `2. b` |
| `1. a` / `2. b` | `toggleOrderedList()` | `a` / `b` |

`paragraphAroundBlockSource(after)` finds the run of consecutive lines around
the caret that are all block lines — matching
`/^[ \t]*(?:>|[-*+][ \t]+|\d+\.[ \t]+|\||```)/` — and inserts a `"\n"` before
or after it, leaving the caret on the new blank line. A caret inside a fenced
code block counts as inside that fence: the run is found by counting fence
lines from the document start, so the whole fence (both markers and the code
between them) is the block. Returns `null` when the caret's line is neither a
block line nor inside a fence.

`tableSource(rows, columns)` inserts, at the start of the caret's line, a
blank line (unless one is already there), the header row, the delimiter row,
`rows - 1` body rows, and a trailing blank line. The caret lands in the first
header cell. For `insertTable(2, 3)` on an empty line:

```
|  |  |  |
| --- | --- | --- |
|  |  |  |
```

`imageSource(src, alt, attributes)` returns `null` when `resolveImageSpec`
rejects `src`, and otherwise replaces the selection with
`![alt](src)` plus `{width=… height=…}` when either dimension resolved,
leaving the caret after it.

### `MarkdownEditor`'s two helpers

```typescript
/**
 * Whether the raw-Markdown source surface is the one currently shown. A
 * command with no source-mode behaviour returns early on this, so it never
 * mutates the Lexical document that surface is not showing.
 *
 * @returns `true` in `"source"` mode.
 */
private isSourceMode(): boolean {
    return this.getMode() === "source";
}

/**
 * Applies `transform` to the source surface's raw Markdown when that surface
 * is the one shown, and restores focus to it afterwards — a toolbar click or
 * a menu row blurs the editing surface before the command runs. The range is
 * read from the `CodeEditor`'s own state rather than the DOM selection, which
 * a blurred surface no longer carries.
 *
 * @param transform - The edit rule to run against the raw Markdown.
 * @returns `true` when the source surface handled the command, so the caller
 *   must return without touching the Lexical document; `false` in WYSIWYG
 *   mode, so the caller falls through to its Lexical path.
 */
private editSource(transform: MarkdownSourceTransform): boolean {
    if (!this.isSourceMode()) {
        return false;
    }

    const selection = this._codeEditor.getSelection();
    const edit = transform(this._codeEditor.getValue(), selection.from, selection.to);

    if (edit !== null) {
        this._codeEditor.replaceRange(edit.from, edit.to, edit.insert, edit.selection);
    }

    this._codeEditor.focus(true);

    return true;
}
```

### `CodeEditor.replaceRange`

```typescript
/**
 * Replaces the text in `[from, to)` with `insert`, and optionally leaves
 * `selection` behind — both in one transaction, so a caller applying an edit
 * plus its resulting selection costs the user exactly one undo step. Both
 * the replaced range and the resulting selection are clamped against the
 * live document, like {@link CodeEditor.revealRange}, so offsets computed
 * from a copy of the text that has since changed land at the nearest valid
 * position rather than throwing.
 *
 * Refused while the editor is read-only: nothing changes, and the rejection
 * surfaces through the `"readonlyedit"` event and the read-only flash, the
 * same feedback a rejected keystroke gets. Before the view is mounted only
 * the cached value is updated, so {@link CodeEditor.getValue} reports the
 * result but no `"change"` fires — the same offline contract
 * {@link CodeEditor.setValue} has.
 *
 * @param from - 0-based start of the range to replace.
 * @param to - 0-based end (exclusive) of that range.
 * @param insert - The replacement text.
 * @param selection - Where to leave the selection, as offsets into the
 *   post-edit document; omitted maps the current selection through the change.
 * @returns This component, for method chaining.
 */
replaceRange(from: number, to: number, insert: string, selection?: { from: number; to: number }): this {
    if (this.getReadOnly()) {
        this.signalReadOnlyEdit();

        return this;
    }

    const text  = this.getValue();
    const start = Math.max(0, Math.min(from, text.length));
    const end   = Math.max(start, Math.min(to, text.length));
    const next  = text.slice(0, start) + insert + text.slice(end);

    this._options.value = next;

    if (!this._view) {
        return this;
    }

    this._view.dispatch({
        changes:        { from: start, to: end, insert },
        selection:      selection === undefined ? undefined : {
            anchor: Math.max(0, Math.min(selection.from, next.length)),
            head:   Math.max(0, Math.min(selection.to,   next.length)),
        },
        scrollIntoView: true,
    });

    return this;
}
```

### Mode-aware selection state

`getSelectionState()` and `updateSelectionState()` both route through one new
private reader, replacing their direct `editor.read(() => $readSelectionState())`
calls:

```typescript
/**
 * Reads the tracked selection state from whichever surface is active: the
 * raw Markdown in `"source"` mode, else the live Lexical state (or the
 * neutral default before the Lexical editor is built). Source mode answers
 * only what raw text can answer — the five format flags, whether there is
 * something to act on, and any enclosing link — and reports the table and
 * `:::` block fields as absent, which is what a consumer toolbar needs to
 * disable the controls those fields drive.
 *
 * @returns The current {@link MarkdownEditorSelectionState}.
 */
private readActiveSelectionState(): MarkdownEditorSelectionState {
    if (this.isSourceMode()) {
        const selection = this._codeEditor.getSelection();

        return {
            ...readSourceSelectionState(this._codeEditor.getValue(), selection.from, selection.to),
            inTable:              false,
            tableColumnAlignment: null,
            blockAlignment:       null,
            columnCount:          1,
        };
    }

    const editor = this._editor;

    return editor ? editor.read(() => $readSelectionState()) : NEUTRAL_SELECTION_STATE;
}
```

---

## Ordered Implementation Steps

Throughout, `MD-TEST` means
`npm -w packages/lib exec -- vitest run tests/component/markdown-editor.test.ts`,
`CE-TEST` means
`npm -w packages/lib exec -- vitest run tests/component/code-editor.test.ts`,
and `SRC-TEST` means
`npm -w packages/lib exec -- vitest run tests/component/markdown-source-edits.test.ts`.

### Phase 0 — stop the phantom mutations

1. `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — add
   the private `isSourceMode()` helper from `## Internal Structure`, placed
   immediately after
   [`getMode()`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1210).
2. Same file — insert `if (this.isSourceMode()) { return this; }` as the
   **first statement** (before any `ensureEditor()` call) of each of these 29
   methods: `toggleBold`, `toggleItalic`, `toggleInlineCode`,
   `toggleStrikethrough`, `toggleUnderline`, `patchSelectionStyle`,
   `toggleUnorderedList`, `toggleOrderedList`, `toggleLink`, `removeLink`,
   `clearFormatting`, `copy`, `cut`, `setBlockType`, `setBlockAlignment`,
   `setColumnCount`, `insertParagraphBeforeBlock`, `insertParagraphAfterBlock`,
   `insertTable`, `insertImage`, `insertTableRow`, `deleteTableRow`,
   `insertTableColumn`, `deleteTableColumn`, `setTableColumnAlignment`,
   `deleteTable`, `mergeTableCells`, `unmergeTableCell`,
   `setTableColumnWidth`. `patchSelectionStyle`
   ([:1471](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1471))
   covers `setTextColor` / `setFontFamily` / `setFontSize`, which have no
   guard of their own.
3. Same file — `paste()`
   ([:1723](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1723))
   returns `Promise<boolean>`, so its guard is
   `if (this.isSourceMode()) { return false; }`.
   *Check:* `npm -w packages/lib run typecheck`.
4. Same file — add this sentence to the JSDoc of all 32 public commands
   (including the three style setters), immediately before the `@returns` tag:

   ```
   No-op in `"source"` mode, where the raw-Markdown surface is shown.
   ```

   Phases 1 and 2 rewrite this sentence for each command they implement.
   *Check:* `grep -c 'this.isSourceMode()' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`
   — expect 30: the 29 guards of Step 2 plus `paste`'s guard from Step 3.
   Recount from the file and report a mismatch rather than editing code to
   make the number come out.
5. `packages/lib/tests/component/markdown-editor.test.ts` — add the
   `describe('MarkdownEditor source-mode command no-ops')` block from
   `## Expected Behaviour` › *Phase 0*.
   *Check:* `MD-TEST` green.
6. `packages/lib/docs/reference/changelog/next.md` and
   `packages/lib/docs/components/MarkdownEditor.md` — apply the Phase 0 edits
   in `## Documentation Impact`.
   *Check:* `npm run docs:api` — 0 errors, 0 link warnings.

### Phase 1 — the plumbing and the inline commands

7. `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — replace
   the `CodeEditorSelection` interface with the widened version from
   `## Public API`.
8. Same file — widen the `_lastSelection` seed
   ([:639](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L639))
   to `{ characterCount: 0, lineCount: 1, from: 0, to: 0 }`, and the offline
   fallback in `getSelection()`
   ([:1215](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1215))
   to the same object.
9. Same file — `readSelection`
   ([:1578](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1578))
   returns `from` and `to` alongside the two counts; `onSelectionChange`
   ([:1595](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1595))
   compares all four fields in its dedup guard, with a comment pointing at the
   worked case in `## Expected Behaviour`.
   *Check:* `npm -w packages/lib run typecheck`.
10. Same file — add `replaceRange` from `## Internal Structure`, placed
    immediately after `setValue`
    ([:749](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L749)).
    *Check:* `npm -w packages/lib run typecheck` and `npm -w packages/lib run lint`.
11. `packages/lib/tests/component/code-editor.test.ts` — widen every
    `toEqual` in `describe('CodeEditor selection')`
    ([:1703](packages/lib/tests/component/code-editor.test.ts#L1703)) per
    `## Expected Behaviour` › *Widened selection assertions*, then add the new
    cases from that same subsection and the `replaceRange` block.
    *Check:* `CE-TEST` green.
12. **Create** `packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts`
    with the SPDX header its siblings carry, the three exported types, the
    private normaliser, the marker rule, the link locator, and the Phase 1
    exports from `## Public API`.
13. **Create** `packages/lib/tests/component/markdown-source-edits.test.ts`
    covering `## Expected Behaviour` › *Phase 1 transforms*. This file needs
    no `installTestDOM` — the module it tests touches no DOM.
    *Check:* `SRC-TEST` green.
14. `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — add
    the `editSource` helper from `## Internal Structure`, immediately after
    `isSourceMode()`.
15. Same file — in each method below, replace the Phase 0 guard with
    `if (this.editSource(<transform>)) { return this; }`, and rewrite its
    Phase 0 JSDoc sentence to describe what the command does in source mode:

    | Method | `<transform>` |
    |---|---|
    | `toggleBold` | `BOLD_SOURCE` |
    | `toggleItalic` | `ITALIC_SOURCE` |
    | `toggleUnderline` | `UNDERLINE_SOURCE` |
    | `toggleStrikethrough` | `STRIKETHROUGH_SOURCE` |
    | `toggleInlineCode` | `INLINE_CODE_SOURCE` |
    | `toggleLink` | `linkSource(url)` |
    | `removeLink` | `REMOVE_LINK_SOURCE` |
    | `clearFormatting` | `CLEAR_FORMAT_SOURCE` |
16. Same file — in `copy` / `cut` / `paste`, replace the Phase 0 guard with a
    delegation to the source editor's own equivalent:
    `if (this.isSourceMode()) { this._codeEditor.copy(); return this; }`,
    the same for `cut()`, and
    `if (this.isSourceMode()) { return this._codeEditor.paste(); }`. Rewrite
    each one's Phase 0 JSDoc sentence to say it delegates to the source
    surface's own clipboard command.
    *Check:* `npm -w packages/lib run typecheck`.
17. Same file — add the `readActiveSelectionState()` reader from
    `## Internal Structure`; route `getSelectionState()`
    ([:1277](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1277))
    and `updateSelectionState()`
    ([:2907](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2907))
    through it.
18. Same file — add `selectionchange: () => this.updateSelectionState()` to
    the `listeners` bag of the `CodeEditor` constructed at
    [:1168](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1168),
    and add a `this.updateSelectionState();` call at the end of
    `handleCodeChange`
    ([:2935](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2935)).
19. Same file — add `this.updateSelectionState();` as the last statement
    before `return this;` in `setMode`
    ([:1224](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1224)).
    *Check:* `npm -w packages/lib run typecheck`.
20. `packages/lib/tests/component/markdown-editor.test.ts` — add the Phase 1
    blocks from `## Expected Behaviour`, and update the Phase 0 no-op block to
    drop the commands Phase 1 now implements.
    *Check:* `MD-TEST` green.

### Phase 2 — the block-prefix commands

21. `packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts`
    — add the Phase 2 exports from `## Public API`, plus the two shared
    patterns and the whole-line expansion from `## Internal Structure`.
    `imageSource` imports `resolveImageSpec` and `formatAttributes` from
    `~/component/display/markdownAttributes.js`, the two helpers
    `markdownImageTransformer.ts` uses, rather than formatting the string
    itself.
22. `packages/lib/tests/component/markdown-source-edits.test.ts` — add
    `## Expected Behaviour` › *Phase 2 transforms*.
    *Check:* `SRC-TEST` green.
23. `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — add
    a module-level `sourceTransformForBlockType(type: MarkdownBlockType): MarkdownSourceTransform`
    beside `createBlockNode`
    ([:192](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L192)),
    switching `"code"` to `FENCED_CODE_SOURCE` and every other type to
    `blockPrefixSource(prefix)` with `""` for `"paragraph"`, `"> "` for
    `"quote"` and `"#".repeat(level) + " "` for `h1`–`h6`.
24. Same file — add a module-level `imageAttributes(options)` helper building
    the `{ width?, height? }` record, and use it from both branches of
    `insertImage` so the record is built once.
25. Same file — in each method below, replace the Phase 0 guard with
    `if (this.editSource(<transform>)) { return this; }`, and rewrite its
    Phase 0 JSDoc sentence to describe what the command does in source mode:

    | Method | `<transform>` |
    |---|---|
    | `setBlockType` | `sourceTransformForBlockType(type)` |
    | `toggleUnorderedList` | `listSource("unordered")` |
    | `toggleOrderedList` | `listSource("ordered")` |
    | `insertParagraphBeforeBlock` | `paragraphAroundBlockSource(false)` |
    | `insertParagraphAfterBlock` | `paragraphAroundBlockSource(true)` |
    | `insertImage` | `imageSource(src, options?.alt ?? "", imageAttributes(options))` |
    | `insertTable` | `tableSource(rows, columns)` |

    *Check:* `npm -w packages/lib run typecheck`;
    `grep -c 'if (this.isSourceMode()) { return this; }' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`
    — expect 12: `patchSelectionStyle`, `setBlockAlignment`, `setColumnCount`
    and the nine table-structure commands, which is every guard site the
    fourteen backlog commands of `## Non-Goals` need. `copy` and `cut` use a
    two-statement body, so they do not match this single-line form. Recount
    from the file and report a mismatch rather than editing code to make the
    number come out.
26. `packages/lib/tests/component/markdown-editor.test.ts` — add the Phase 2
    blocks from `## Expected Behaviour`.
    *Check:* `MD-TEST` green.
27. `packages/lib/docs/components/MarkdownEditor.md`,
    `packages/lib/docs/components/CodeEditor.md`,
    `packages/lib/docs/components/MarkdownDocumentPanel.md` and
    `packages/lib/docs/reference/changelog/next.md` — apply the remaining
    edits in `## Documentation Impact`.
    *Check:* `npm run docs:api` — 0 errors, 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts` |
| Create | `packages/lib/tests/component/markdown-source-edits.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/components/MarkdownDocumentPanel.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Phase 0 (unit-testable, `packages/lib/tests/component/markdown-editor.test.ts`)

Each case builds `new MarkdownEditor('# Title\n\nhello world\n', { mode: 'source' })`,
registers a `"change"` listener, calls the command, and asserts.

- **No `"change"` escapes.** `toggleBold()`, `insertTable(2, 2)`,
  `setBlockType('h2')`, `toggleUnorderedList()`, `clearFormatting()`,
  `setTextColor('#c00')`, `insertTableRow()` and `deleteTable()` each emit
  nothing.
- **The value is untouched.** `editor.getValue()` still equals
  `'# Title\n\nhello world\n'` after each of the commands above.
- **The Lexical editor is never built.** After
  `new MarkdownEditor('x', { mode: 'source' }).toggleBold()`,
  `lexicalOf(editor)` is `null` (the field's initial value) — the guard
  returns before `ensureEditor()`.
- **Every command still returns its usual value.** `editor.toggleBold()` is
  `editor`, so chaining keeps working; `await editor.paste()` resolves
  `false`.
- **WYSIWYG is unaffected.** The same commands on a default-mode editor behave
  exactly as the existing suite already asserts (no test changes there).

### Widened selection assertions (unit-testable, `packages/lib/tests/component/code-editor.test.ts`)

Every existing case in `describe('CodeEditor selection')` still passes with
`from`/`to` added:

| Test | Selection | New expected |
|---|---|---|
| reports a collapsed selection as zero characters across one line | anchor 0, head 0 | `{ characterCount: 0, lineCount: 1, from: 0, to: 0 }` |
| reports the character count for a single-line forward selection | anchor 1, head 4 | `{ characterCount: 3, lineCount: 1, from: 1, to: 4 }` |
| reports the same character count for a selection dragged backward | anchor 4, head 1 | `{ characterCount: 3, lineCount: 1, from: 1, to: 4 }` |
| reports the line count for a selection spanning multiple lines | anchor 1, head 7 | `{ characterCount: 6, lineCount: 3, from: 1, to: 7 }` |
| reports the whole document for a select-all | anchor 0, head 8 | `{ characterCount: 8, lineCount: 3, from: 0, to: 8 }` |
| returns a collapsed selection … before the view is mounted | n/a | `{ characterCount: 0, lineCount: 1, from: 0, to: 0 }` |
| returns a collapsed selection … constructed with content but still unmounted | n/a | `{ characterCount: 0, lineCount: 1, from: 0, to: 0 }` |
| reports the range named by mainIndex | ranges `(0,1)`,`(3,5)`, main 1 | `{ characterCount: 2, lineCount: 1, from: 3, to: 5 }` |
| emits once when the selection changes | anchor 0, head 4 | `[{ characterCount: 4, lineCount: 2, from: 0, to: 4 }]` |
| emits again when the selection shrinks back toward the start | then anchor 1, head 0 | second payload `{ characterCount: 1, lineCount: 1, from: 0, to: 1 }` |
| emits again when the line count changes even though the character count ties | anchor 1→3, head 3→5 | `{ …, from: 1, to: 3 }` then `{ …, from: 3, to: 5 }` |
| emits selectionchange but not cursorchange for a select-all | anchor 0, head 5 | `[{ characterCount: 5, lineCount: 2, from: 0, to: 5 }]` |
| `on()` / `off()` register and remove a selectionchange listener | manual `emit` | payloads widened with `from`/`to` |
| wires a constructor `listeners.selectionchange` bag | manual `emit` | payload widened with `from`/`to` |

New cases in the same block:

- **A same-size selection moved elsewhere now emits.** `onSelectionChange` with
  `EditorState.create({ doc: 'abcdef', selection: { anchor: 0, head: 2 } })`,
  then the same document with `{ anchor: 3, head: 5 }`. Two payloads:
  `{ characterCount: 2, lineCount: 1, from: 0, to: 2 }` and
  `{ characterCount: 2, lineCount: 1, from: 3, to: 5 }`. Before the widened
  dedup this emitted once.
- **`getSelection()` reports the normalised bounds from a duck-typed view.**
  `editor._view = { state: EditorState.create({ doc: 'abcdef', selection: { anchor: 5, head: 2 } }) }`
  gives `{ characterCount: 3, lineCount: 1, from: 2, to: 5 }`.

### `replaceRange` (unit-testable, same file)

Each case sets `editor._view = { state: EditorState.create({ doc: 'abcdef' }), dispatch }`
with `dispatch = vi.fn()`, mirroring the existing `applyFormatted` cases.

- **Dispatches one transaction carrying both the change and the selection.**
  `replaceRange(1, 3, 'XY', { from: 1, to: 3 })` calls `dispatch` once with
  `changes: { from: 1, to: 3, insert: 'XY' }` and
  `selection: { anchor: 1, head: 3 }`.
- **Omitting `selection` dispatches no selection.** The spec's `selection` is
  `undefined`.
- **Offsets are clamped.** `replaceRange(-5, 99, 'Z')` dispatches
  `changes: { from: 0, to: 6, insert: 'Z' }`. A `selection` beyond the
  post-edit length clamps to it: `replaceRange(0, 6, 'Z', { from: 9, to: 9 })`
  dispatches `selection: { anchor: 1, head: 1 }`.
- **Inverted input is normalised.** `replaceRange(4, 1, 'Z')` dispatches
  `changes: { from: 4, to: 4, insert: 'Z' }` — `to` is raised to `from`, never
  below it.
- **Read-only refuses.** With `readOnly: true`, `replaceRange(1, 3, 'XY')`
  calls `dispatch` zero times, leaves `getValue()` unchanged, and emits one
  `"readonlyedit"`.
- **Offline it still updates the cached value.** With no `_view`,
  `new CodeEditor('abcdef').replaceRange(1, 3, 'XY').getValue()` is
  `'aXYdef'`, and no `"change"` fires.

### Phase 1 transforms (unit-testable, `packages/lib/tests/component/markdown-source-edits.test.ts`)

A local helper `apply(text, edit)` returns
`text.slice(0, edit.from) + edit.insert + text.slice(edit.to)` so each case
reads as before/after. Every row of the three tables in `## Internal
Structure` (*The normalised range*, *The inline-marker rule*, *The link
locator*) becomes a case. Additionally:

- **Trailing whitespace stays outside the markers.**
  `BOLD_SOURCE('a hello b', 2, 8)` (selection `'hello '`) applies to
  `'a **hello** b'`, selection `{ from: 4, to: 9 }`.
- **A collapsed caret expands to its word.** `BOLD_SOURCE('a hello b', 4, 4)`
  applies to `'a **hello** b'`.
- **A collapsed caret with no word is a no-op.** `BOLD_SOURCE('a  b', 2, 2)`
  returns `null`.
- **A whitespace-only selection is a no-op.** `BOLD_SOURCE('a   b', 1, 4)`
  returns `null`.
- **A selection spanning a blank line is a no-op.**
  `BOLD_SOURCE('one\n\ntwo', 0, 8)` returns `null`.
- **A single newline is fine.** `BOLD_SOURCE('one\ntwo', 0, 7)` applies to
  `'**one\ntwo**'`.
- **Inline code refuses a range containing a backtick.**
  ``INLINE_CODE_SOURCE('a `b` c', 0, 7)`` returns `null`.
- **Underline uses the dialect's `++`.** `UNDERLINE_SOURCE('hello', 0, 5)`
  applies to `'++hello++'`.
- **`linkSource(null)` behaves as `REMOVE_LINK_SOURCE`.** Both return the same
  edit for `'see [docs](/d)'` with the caret at offset 7.
- **`linkSource` declines with nothing to wrap.**
  `linkSource('/d')('a  b', 2, 2)` returns `null`.
- **`readSourceSelectionState` reports what a press would do.** For
  `'**hello** world'` with `from: 2, to: 7`: `bold` is `true`, the other four
  flags `false`, `hasSelectedText` `true`, `linkUrl` `null`. For
  `'see [docs](/d)'` with `from: 7, to: 7`: `linkUrl` is `'/d'`. For
  `'a  b'` with `from: 2, to: 2`: every flag `false` and `hasSelectedText`
  `false`.

### Phase 1 in `MarkdownEditor` (unit-testable, `packages/lib/tests/component/markdown-editor.test.ts`)

Offline, `CodeEditor.getSelection()` reports a collapsed caret at offset 0, so
a command with no injected view acts on the document's first word. Cases that
need a different range inject
`codeEditorOf(editor)._view = { state: EditorState.create({ doc, selection: { anchor, head } }), dispatch }`
and assert the dispatched transaction, mirroring `code-editor.test.ts`.

- **Bold rewrites the source text.**
  `new MarkdownEditor('hello world', { mode: 'source' }).toggleBold().getValue()`
  is `'**hello** world'`.
- **Pressing Bold twice returns the original.** A second `toggleBold()` on the
  same editor gives `'hello world'` again.
- **The Lexical editor is still never built.** `lexicalOf(editor)` is `null`
  after either press.
- **The transform runs against the injected range.** With the duck-typed view
  above over `'a hello b'` and `{ anchor: 2, head: 7 }`, `toggleBold()`
  dispatches exactly once, with
  `changes: { from: 2, to: 7, insert: '**hello**' }` and
  `selection: { anchor: 4, head: 9 }` — the edit
  `BOLD_SOURCE('a hello b', 2, 7)` returns.
- **Read-only refuses and signals.** With `readOnly: true`, `toggleBold()`
  leaves `getValue()` unchanged and emits one `"readonlyedit"` on the source
  editor.
- **Focus is restored.** `vi.spyOn` the private `_codeEditor`'s `focus`:
  `toggleBold()` calls it once. It is called on the declined path too — inject
  a view whose caret sits on a space (`doc: 'a  b'`, `anchor: 2`), where the
  transform returns `null` and nothing is dispatched, and `focus` is still
  called once.
- **Clipboard commands delegate.** `copy()` and `cut()` call the source
  editor's own `copy` / `cut` (spied), and `await paste()` resolves to what
  the source editor's `paste` resolved to.
- **The selection state comes from the source text.** With
  `codeEditorOf(editor)._view = { state: EditorState.create({ doc: '**hi** there', selection: { anchor: 2, head: 4 } }) }`,
  `editor.getSelectionState()` reports `bold: true`, `italic: false`,
  `hasSelectedText: true`, `linkUrl: null`, `inTable: false`,
  `tableColumnAlignment: null`, `blockAlignment: null`, `columnCount: 1`.
- **`setMode` emits a fresh state.** Build
  `new MarkdownEditor('**hi** there')` (WYSIWYG), drive a `$selectAll` through
  `lexicalOf(editor)` so the Lexical state reports `hasSelectedText: true`,
  then record `"selectionstate"` payloads and call `setMode('source')`.
  Exactly one payload arrives, and it is the source-mode answer for the
  caret at offset 0: every format flag `false`, `hasSelectedText: false`,
  `linkUrl: null`, `inTable: false`, `tableColumnAlignment: null`,
  `blockAlignment: null`, `columnCount: 1`. Without Step 19's emit the
  toolbar would keep the WYSIWYG state.
- **A source edit refreshes the state.** Build
  `new MarkdownEditor('hi there', { mode: 'source' })`, record
  `"selectionstate"` payloads, inject the duck-typed view from the first case
  above, then call `codeEditorOf(editor).onDocChange('**hi** there')`. One
  payload arrives, with `bold: true`.

### Phase 2 transforms (unit-testable, `packages/lib/tests/component/markdown-source-edits.test.ts`)

Every row of the three Phase 2 tables in `## Internal Structure` becomes a
case, plus:

- **A caret selects its whole line.** `blockPrefixSource('> ')('## Title', 4, 4)`
  applies to `'> Title'`.
- **A partial multi-line selection takes both whole lines.**
  `listSource('unordered')('one\ntwo', 1, 5)` applies to `'- one\n- two'`.
- **`paragraphAroundBlockSource` declines outside a block.**
  `paragraphAroundBlockSource(true)('plain text', 3, 3)` returns `null`.
- **It finds the whole fence from inside it.**
  ``paragraphAroundBlockSource(true)('```\ncode\n```', 5, 5)`` inserts the
  newline after the closing fence, not after the `code` line.
- **It finds the whole list from one item.**
  `paragraphAroundBlockSource(false)('- a\n- b\n- c', 5, 5)` inserts the
  newline before `- a`.
- **`imageSource` rejects an unsafe scheme.**
  `imageSource('javascript:alert(1)', 'x', {})('', 0, 0)` returns `null`.
- **`imageSource` emits the dialect's attribute block.**
  `imageSource('/d.png', 'Diagram', { width: '320' })('', 0, 0)` inserts
  `'![Diagram](/d.png){width=320}'`.
- **`tableSource` emits the delimiter row `formatDelimiterRow` emits.** The
  second line of `tableSource(2, 3)('', 0, 0)`'s insert is
  `'| --- | --- | --- |'`.
- **`tableSource` puts the caret in the first header cell.** The returned
  `selection` is collapsed two characters into the header row.

### Phase 2 in `MarkdownEditor` (unit-testable, same file)

- **`setBlockType` maps the type to the right transform.**
  `new MarkdownEditor('hello', { mode: 'source' }).setBlockType('h2').getValue()`
  is `'## hello'`; `setBlockType('code')` on `'hello'` gives
  `` '```\nhello\n```' ``.
- **`insertTable` writes a GFM skeleton.**
  `new MarkdownEditor('', { mode: 'source' }).insertTable(2, 3).getValue()`
  contains `'| --- | --- | --- |'`.
- **Source output round-trips.** For each of `'**hello** world'`,
  `'++hello++ world'`, `'## hello'`, `'- a\n- b'` and the `insertTable(2, 3)`
  skeleton: building a source-mode editor on it, calling `setMode('wysiwyg')`
  and reading `getValue()` returns the same text under the file's existing
  `normalize()` helper. This is the dialect guarantee.
- **The 14 backlog commands still no-op.** The Phase 0 block keeps
  `setTextColor`, `setFontFamily`, `setFontSize`, `setBlockAlignment`,
  `setColumnCount` and the nine table-structure commands named in
  `## Non-Goals`.

### Manual verification only (live-only; the offline sink never mounts a CodeMirror view)

Run the dev app (`npm run dev`, `http://localhost:8015`, **MarkdownEditor**
section) and press the toolbar's **Edit Markdown source** toggle:

- Selecting a word and pressing **Bold** wraps it in `**…**` and leaves it
  selected; pressing Bold again removes them. The caret stays in the source
  editor — focus is not left on the button.
- One press is one **Ctrl/Cmd+Z**: undo restores both the text and the
  selection in a single step.
- The document does not scroll or unfold when a button is pressed near the
  bottom of a long file.
- The five format buttons press and release as the caret moves through
  `**bold**`, `*italic*`, `++underline++`, `~~strike~~` and `` `code` ``
  runs, with no click needed.
- The **Table** button is greyed out in source mode, and enables again on
  switching back to WYSIWYG with the caret in a table.
- Switching to source mode with the caret in bold text, then back, leaves the
  Bold button matching the caret's real state at every step.
- With `setReadOnly(true)`, pressing Bold in source mode flashes the editor
  and changes nothing.
- **Insert › Table** in source mode writes a table skeleton with the caret in
  the first header cell; switching to WYSIWYG renders it as a table with no
  re-spacing of the delimiter row.

---

## Verification

- `npm -w packages/lib run typecheck` — clean.
- `npm -w packages/lib run lint` — clean.
- `SRC-TEST`, `MD-TEST`, `CE-TEST` — all green, including every case in
  `## Expected Behaviour`.
- `npm -w packages/lib exec -- vitest run tests/component/markdown-document-panel.test.ts`
  — green with no edits, confirming the toolbar needed no source change.
- `grep -rn 'ensureEditor' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`
  — read every hit: each one sits below an `isSourceMode()` or `editSource()`
  guard, or inside `setMode` / `setValue` / `focus` / `mountWysiwyg`, which
  already branch on the mode or only run on the WYSIWYG path.
- `npm run docs:api` — 0 errors, 0 link warnings.
- Manual smoke tests: every case in `## Expected Behaviour` › *Manual
  verification only*.

---

## Documentation Impact

**`packages/lib/docs/components/MarkdownEditor.md`.**

- *Phase 0* — **Source / WYSIWYG mode**
  ([:146](packages/lib/docs/components/MarkdownEditor.md#L146)): add a
  paragraph stating that every [command API](#command-api) command is a no-op
  while `"source"` mode is active.
- *Phase 2* — **Source / WYSIWYG mode**, same paragraph: replace it with one
  saying which commands edit the raw Markdown directly and which stay
  WYSIWYG-only, pointing at the Command API section's own list.
- *Phase 2* — **Command API**
  ([:75](packages/lib/docs/components/MarkdownEditor.md#L75)): after the
  table, add a paragraph naming the commands that work in source mode (the
  five format toggles, `toggleLink`, `removeLink`, `clearFormatting`,
  `cut`/`copy`/`paste`, `setBlockType`, the two list toggles, the two
  paragraph-around-block commands, `insertImage`, `insertTable`), and the
  fourteen that stay WYSIWYG-only.
- *Phase 1* — **Live selection state**
  ([:105](packages/lib/docs/components/MarkdownEditor.md#L105)): note that in
  source mode the flags are derived from the raw Markdown, `inTable` is always
  `false`, `blockAlignment` is `null` and `columnCount` is `1`, and that
  `setMode` emits a fresh state.
- *Phase 1* — **Read-only**
  ([:171](packages/lib/docs/components/MarkdownEditor.md#L171)): note that a
  refused source-mode command flashes and fires `"readonlyedit"` on the source
  editor.

**`packages/lib/docs/components/CodeEditor.md`.**

- **Selection** ([:180](packages/lib/docs/components/CodeEditor.md#L180)):
  `getSelection()` now returns `{ characterCount, lineCount, from, to }`, and
  `selectionchange` fires when any of the four changes — including a
  same-length selection moving elsewhere, which previously did not fire.
- Methods table ([:299](packages/lib/docs/components/CodeEditor.md#L299)):
  update the `getSelection()` and `on('selectionchange', fn)` rows, and add a
  `replaceRange(from, to, insert, selection?)` row — "Replace a range and
  optionally place the resulting selection, in one transaction (one undo
  step). Clamped against the live document; refused, with the read-only
  flash, while the editor is read-only."

**`packages/lib/docs/components/MarkdownDocumentPanel.md`.** **Toolbar**
([:18](packages/lib/docs/components/MarkdownDocumentPanel.md#L18)): note that
the format toggles, Link, Insert and the clipboard entries keep working after
the **Edit Markdown source** toggle, writing the markers into the raw text,
while the Table, Text style, Alignment and Columns dropdowns become no-ops
there — and that the Table button greys out because source mode reports
`inTable: false`.

**`packages/lib/docs/reference/changelog/next.md`.** Three entries under
*Components*: a fixed-bug entry for the phantom source-mode mutation (Phase
0), a feature entry for source-mode editing (Phases 1–2), and a behaviour
entry for `CodeEditorSelection`'s two new fields and the widened
`"selectionchange"` dedup.

---

## Potential Challenges

- **The `*` family's bold/italic ambiguity.** A naive "is the marker just
  outside the selection" test turns `**hello**` into `*hello*` when Italic is
  pressed. The run-length rule in `## Internal Structure` is what prevents it;
  its table's five `*` rows are the regression net.
- **`replaceRange`'s pre-dispatch cache write.** It mirrors `applyFormatted`,
  and is only safe because the dispatched change is computed from the same
  document `getValue()` just read. Do not reorder the read and the dispatch.
- **Double `"selectionstate"` work after an edit.** A `replaceRange`
  transaction fires both `"change"` and `"selectionchange"`, so
  `updateSelectionState` runs twice; `selectionStatesEqual`
  ([MarkdownEditor.ts:826](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L826))
  suppresses the second emit. Keep both call sites — an edit that leaves the
  offsets unchanged (a same-length `setValue`) needs the `"change"` one.
- **Widening the `"selectionchange"` dedup changes existing behaviour.** The
  demo `CodeEditorPanel` status line will now update more often. That is the
  documented intent; the changelog entry says so.
- **Guard counts drift.** The `grep -c` checks in Steps 4 and 25 are written
  against the file as it stands today. Recount from the file and report a
  mismatch rather than editing the code to make the number come out.

---

## Critical Files

| File | Why |
|---|---|
| [`MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) | The 32 commands, `setMode`, `$readSelectionState`, `$selectEnclosingWordIfCollapsed` (the word rule to mirror), `createBlockNode` (the switch to mirror). |
| [`CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) | `CodeEditorSelection`, `readSelection`/`onSelectionChange`, `applyFormatted` (the cache-then-dispatch precedent), `paste` (the transaction shape), `revealRange` (the clamping precedent), `signalReadOnlyEdit`. |
| [`markdownTransformers.ts`](packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts) | The dialect's fifteen transformers — the definition of what syntax may be emitted. |
| [`markdownStyleTransformers.ts`](packages/lib/src/typescript/lib/component/editor/markdownStyleTransformers.ts) | `UNDERLINE` (`++`) and `STYLED_TEXT` (`[t]{…}`). |
| [`markdownTableTransformer.ts`](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L135) | `formatDelimiterRow` — the exact delimiter row `tableSource` must emit. |
| [`markdownAttributes.ts`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts) | `resolveImageSpec` / `formatAttributes`, and the pure-helper-module shape `markdownSourceEdits.ts` follows. |
| [`MarkdownDocumentPanel.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L491) | `applySelectionState` — confirms `inTable: false` greys the Table button. Not modified. |
| [`code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts#L1400) | The duck-typed `_view = { state, dispatch }` pattern every new `CodeEditor` case uses. |
| `plans/implemented/code-editor-document-offset.md` | The additive-event-payload-field precedent this plan mirrors for `from`/`to`. |

---

## Non-Goals

- **`setTextColor` / `setFontFamily` / `setFontSize` in source mode.** These
  emit the `[text]{color=… font=… size=…}` styled span, whose merge rules with
  an existing span need their own design. A separate plan, building on this
  one's transform module and `replaceRange` seam.
- **`setBlockAlignment` / `setColumnCount` in source mode.** These wrap and
  unwrap `:::` fences with `{align=…}` attributes — a nesting-aware rewrite,
  not a line-prefix change. Backlog.
- **The nine table-structure commands in source mode** (`insertTableRow`,
  `deleteTableRow`, `insertTableColumn`, `deleteTableColumn`,
  `setTableColumnAlignment`, `deleteTable`, `mergeTableCells`,
  `unmergeTableCell`, `setTableColumnWidth`). Each needs a parsed pipe grid
  including the `<<` / `^^` merge continuations. Backlog. Source mode reports
  `inTable: false`, so `MarkdownDocumentPanel` greys the Table button rather
  than offering commands that do nothing.
- **Gating the WYSIWYG commands on `readOnly`.** `toggleBold()` on a
  read-only editor still emboldens text in WYSIWYG mode today; read-only there
  is a typing and view guard, not a command guard. Making the two sides agree
  means gating all 32 Lexical paths, which is its own behaviour change with
  its own test surface, and nothing in this plan depends on it. Backlog.
- **Structure-aware refusals.** A transform will wrap text inside a fenced
  code block, a table cell or an HTML block, because it never works out what
  the selection sits inside. Only the two textual guards named in
  `## Architecture Decisions` — the blank line and the stray backtick —
  decline an edit on the document's account.
- **Any change to `MarkdownDocumentPanel.ts`.** The mode branch lives in
  `MarkdownEditor`, so the panel's existing wiring is already correct.

---

## Notes

[^phantom]: Verified against the current code, not inferred. With source text
    `"# Title\n\nhello world edited\n"`, `toggleBold()` emitted a `"change"`
    carrying `"# Title\n\nhello world edited"` — the Lexical round-trip's
    normalisation (a dropped trailing newline) escaping as a document change
    the user never made. `insertTable(2, 2)` really does append table cells to
    the shadow document. The desync also has a second bite: `onDocChange`
    ([MarkdownEditor.ts:2872](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2872))
    returns early when the new value equals `_options.value`, so once the
    phantom write has put a wrong value in that cache, a later genuine source
    edit that happens to produce exactly that text is swallowed.

[^why-textual]: The rejected alternative was to parse the source into Lexical,
    map the character range onto a Lexical selection, run the existing command
    and serialise back. Two things kill it. A character range in raw Markdown
    has no reliable Lexical counterpart — the offsets that matter to the user
    include the marker characters, which do not exist as text in the parsed
    document. And serialising back rewrites the *whole* document through the
    normaliser, so one Bold press would re-space every table delimiter row and
    rewrite every list marker in the file. Local textual edits are also what
    every other source-mode Markdown editor does, so the behaviour is the one
    users already expect.

[^pure-module]: The point of the boundary is the test surface. Essentially all
    of this feature's logic — the marker rules, the normalisation, the link
    locator, the block rewrites — ends up in functions that take two strings'
    worth of input and return a plain object, so they unit-test offline with
    no harness at all. What is left that needs a live CodeMirror view is a
    single `dispatch` call inside `replaceRange`, and even that is assertable
    against a duck-typed view. Every view operation in `CodeEditor` no-ops
    before mount, so anything built directly on `_view.dispatch` is otherwise
    untestable offline.

[^minimal-range]: The alternative — a transform returning the whole rewritten
    document, applied as a full-document replace — is simpler to write, and
    was rejected for what a full replace costs at the CodeMirror level.
    CodeMirror maps every position in the old document through the change set,
    and a whole-document replace sends them all to 0: the scroll anchor, the
    fold state and every decoration reset. `applyFormatted`
    ([CodeEditor.ts:1471](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1471))
    carries a `scrollSnapshot()` workaround for exactly this, and it would be
    absurd to pay it on every Bold press. Each transform already knows the
    narrow range it is rewriting, so reporting that range instead of the whole
    document costs the transform nothing.

[^dedup-widen]: Today `"selectionchange"` dedups on `characterCount` and
    `lineCount` only, so dragging a three-character selection from one place
    in a line to another does not re-emit. Adding `from`/`to` to the payload
    without widening the dedup would ship a payload whose new fields can be
    silently stale — the event would carry offsets the consumer was never told
    had changed. `plans/implemented/code-editor-document-offset.md` made the
    same argument for `offset`. Widening it is also what lets
    `MarkdownEditor` subscribe to `"selectionchange"` rather than
    `"cursorchange"`: the source-mode selection state is a function of the
    range `[from, to)`, and after the widening that is exactly the event that
    reports a change to it. Any caret move changes `from` or `to`, so nothing
    `"cursorchange"` would have caught is lost.

[^offline-cache]: `setValue` and `applyFormatted` both write `_options.value`
    and then no-op the view work when `_view` is `null`, which is how
    `getValue()` keeps reporting the truth offline. `replaceRange` follows
    them, which means the whole feature is assertable offline end to end:
    `new MarkdownEditor('hello world', { mode: 'source' }).toggleBold().getValue()`
    returns `'**hello** world'` with nothing injected and no harness beyond
    the file's existing one. It also means no `"change"` fires offline, the
    same as `setValue` — the dirty flag and the `"change"` event are on the
    live path, driven by the view's update listener, and are covered by the
    manual-verify section.

[^readonly]: CodeMirror's `EditorState.readOnly` facet — installed by
    [`buildReadOnlyExtension`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L365)
    — blocks every document transaction, so without a gate the command would
    return `this` as though it had worked while nothing happened, and worse,
    `replaceRange`'s pre-dispatch cache write would leave `_options.value`
    holding text the document does not contain. Gating inside `replaceRange`
    rather than inside `MarkdownEditor` keeps `signalReadOnlyEdit` private,
    keeps the contract in one place, and means any future caller of
    `replaceRange` inherits it. `editSource` deliberately reports the command
    as handled either way: falling through to the Lexical path in source mode
    is the bug Phase 0 exists to fix, and a refusal is not a reason to
    reintroduce it.

[^branch-in-editor]: Putting the branch in `MarkdownDocumentPanel` instead
    would leave all 32 public commands silently broken for the right-click
    context menu and for any third-party toolbar, and would force the panel to
    reach into `MarkdownEditor`'s private `_codeEditor`. Keeping it in
    `MarkdownEditor` also means the panel needs no source change at all:
    `applySelectionState`
    ([MarkdownDocumentPanel.ts:491](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L491))
    already calls `this._tableBtn.setEnabled(state.inTable)`, so reporting
    `inTable: false` greys the Table button out on its own — the toolbar
    degrades honestly rather than offering commands that do nothing.

[^focus]: `CodeEditor.copy()`
    ([:1290](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1290))
    documents this exact problem at its own `focus(true)` call: the menu row
    or button that invoked the command blurred the view through the browser's
    default mousedown-elsewhere behaviour. CodeMirror keeps its state
    selection while blurred, which is why `editSource` reads the range from
    `getSelection()` (state) rather than from the DOM selection. The restore
    sits in `editSource` and not in `replaceRange` because `replaceRange` is a
    general text-mutation API, and the general mutation API next to it —
    `setValue` — does not touch focus; only the three clipboard commands,
    which exist specifically to be driven from a menu row, do. `editSource` is
    always driven from a button or a menu row, so it owns the restore, and it
    runs the restore on the declined path too so a no-op press still puts the
    caret back.

[^no-structure]: Refusing to wrap inside a fenced code block, or inside a
    table cell, means deciding what construct the selection is in from the
    text around it — which is a parser, in a module whose entire value is that
    it is not one. The two declining guards are both tests on the characters
    being wrapped, not on the surrounding document: a blank line inside the
    range means the markers could never pair (a blank line is a paragraph
    break in every Markdown dialect), and a backtick inside a range being
    wrapped in backticks produces a span that re-parses differently. They cost
    one regex each. The four commands that do read past the selection have no
    choice: their contract *is* the enclosing construct — `removeLink()`
    removes the whole link regardless of how much of it is selected, and
    `insertParagraphAfterBlock()` inserts after the whole list, not after the
    clicked item. A single non-backtracking regex pass, or one scan counting
    fence lines, is the cheapest way to find one, and neither generalises into
    a document model. Nesting is deliberately un-guarded: pressing Bold over
    `a **b** c` produces `**a **b** c**`, which is what a plain source editor
    does.

[^state-honesty]: `getSelectionState()` today returns `NEUTRAL_SELECTION_STATE`
    whenever the Lexical editor does not exist, and `"selectionstate"` only
    ever fires from Lexical's `registerUpdateListener`. So after
    `setMode("source")` the `MarkdownDocumentPanel` toolbar keeps whatever
    pressed state it had in WYSIWYG, and nothing refreshes it until the user
    switches back. Three changes fix it: one reader that branches on the mode,
    a `"selectionchange"` subscription on the source editor, and a fresh emit
    at the end of `setMode`. Reporting `inTable: false` and `columnCount: 1`
    in source mode is not a lie of convenience — those fields describe Lexical
    constructs the source surface genuinely has no notion of, and the
    consumer-visible effect (a greyed-out Table button, an Alignment menu
    showing "Default") is the honest one.

---

## Implementation Notes

- **Guard counts matched exactly.** Step 4's `grep -c 'this.isSourceMode()'`
  read 30 (the 29 Phase 0 guards plus `paste`'s) and Step 25's
  `grep -c 'if (this.isSourceMode()) { return this; }'` read 12
  (`patchSelectionStyle`, `setBlockAlignment`, `setColumnCount`, and the nine
  table-structure commands) on the first count, both against the file as it
  actually stood at that point in implementation — no mismatch to report.

- **The offline "pressing Bold twice" round-trip doesn't hold as literally
  stated.** Phase 1's Expected Behaviour says a second `toggleBold()` on the
  same editor, with no injected view, returns `'**hello** world'` to
  `'hello world'`. It doesn't: offline, `CodeEditor.getSelection()`
  always reports a collapsed caret at document offset 0 (per its own
  specified default), and after the first press the character at offset 0 is
  the leading `*` marker, not a word character — so `BOLD_SOURCE`'s
  normalised-range rule (a collapsed caret expands only to an *immediately
  adjacent* run of word characters, per its own spec) correctly declines the
  second press as a no-op rather than undoing the first. The round-trip only
  holds when the second press's caret is where a live CodeMirror view would
  actually leave it, inside the just-inserted markers. Both specs (the
  offline `getSelection()` default and the collapsed-caret expansion rule)
  are implemented exactly as written; they just don't compose the way that
  one Expected-Behaviour sentence assumed. The test for it
  (`markdown-editor.test.ts`, `'MarkdownEditor source-mode commands'` ›
  `'pressing bold twice returns the original'`) now demonstrates the
  round-trip by injecting a duck-typed view for the second press (mirroring
  a live view's actual caret position) and asserting the dispatched
  transaction, rather than asserting `getValue()` against the fully-offline
  default caret. No source code changed as a result of this finding.

- **`insertParagraphBeforeBlock` / `insertParagraphAfterBlock` insert two
  newlines, not the one the plan specifies.** Phase 2 specifies inserting
  "a `\n`  … leaving the caret on the new blank line". A single newline does
  not produce a paragraph *outside* the block: it leaves the caret on a line
  directly adjacent to the quote, list, table or fence, which Markdown reads
  as a lazy continuation, so text typed there re-parses straight back into
  that block (`> q` + typing gives `> q\n> p`; a table gains a `| p |  |`
  row; a list stays one list). Inserting `"\n\n"`, and landing the caret past
  both newlines for the `after` case, gives the blank separator line the
  command's own contract needs. This is a deviation from the plan's literal
  text in service of the behaviour the plan's own description asks for
  ("insert an empty paragraph … before/after the block"). Pinned by two tests
  that type into the inserted line and assert the resulting top-level block
  types, rather than only asserting the inserted text.

- **`copy`/`cut`'s source-mode guard is not written in Step 16's literal
  form.** Step 16 gives the guard as a single line,
  `if (this.isSourceMode()) { this._codeEditor.copy(); return this; }`, but
  the global `CODE_CONVENTIONS.md` requires one statement per line and a
  blank line before every `return`, and that snippet packs two statements onto
  one line with no blank line before the `return`. Both guards are therefore
  written as a normal four-line block. (Single-line braced `if` bodies as such
  are fine and do have precedent in this repo — e.g. `layout/Border.ts` and
  `component/table/Body.ts` — so it is the two-statements-per-line part, not
  the one-line form, that the snippet got wrong.) The conventions document
  wins over a plan's incidental formatting of a snippet; behaviour is
  identical.

- **`npm run docs:api` reports 14 warnings, all pre-existing.** The plan's
  checks ask for 0 link warnings. The run is 0 errors / 14 warnings, and none
  of the 14 names a symbol this branch adds — they sit in `SpatialNavigation`,
  `rankInDirection`, `FieldDecorator`, `MarkdownViewer` and five
  `MarkdownEditor` `{@link}`s this branch never touched, and they are present
  on `master` at the branch point too. The branch introduces no new warning;
  the plan's "0 warnings" bar was already unmet before it.

- **`tableSource`'s blank-line separator is decided from the line above the
  insertion point, not from the caret's own line.** The plan asks for "a blank
  line (unless one is already there)" above the table. The first implementation
  keyed that off whether the *caret's* line was blank, which cannot answer the
  question: the insert lands at that line's start, so the caret's line ends up
  *below* the table. It produced two blank lines above a table inserted on a
  non-blank line (`'para\nhello'`), two at the document start where none is
  wanted, and none at all when the caret sat on a blank line under a heading —
  the table then abutted the heading. The separator is now `"\n"` when the
  preceding line is non-blank and `""` when it is blank or the table lands at
  offset 0. Both branches are covered; before this, every test drove
  `tableSource` with `''`, so the separator branch never ran and no test
  asserted the surrounding blank lines.

  Residual, and deliberately left: when the caret sits on a pre-existing blank
  line, that line survives *below* the table, so the table can carry two blank
  lines beneath it instead of one. Removing it would mean consuming the line's
  terminator, which the plan does not ask for; the plan specifies only the
  leading separator and "a trailing blank line", and both shapes re-space
  canonically on the next `setMode("wysiwyg")`.

- **The hand-resolved changelog conflict initially dropped a blank line.**
  `master` moved during implementation and added its own `next.md` entry, so the
  rebase conflicted. The union resolution (master's entry first, this branch's
  after) left `## Added` with no preceding blank line — the only such heading in
  `docs/reference/changelog/`. Restored; every heading in the file is now
  preceded by one.

### Whole-stack review fixes

A review of the whole unmerged Markdown stack ran after this branch was
finished; these are its findings against this branch, fixed here and folded
into the commits they belong to.

- **C3 — a link's title was read as part of its URL.** The link locator took
  everything inside the parentheses as the URL, so for `[docs](/d "Title")`
  `linkUrl` was `/d "Title"` and `toggleLink("/e")` dropped the title. The
  pattern now follows CommonMark's inline-link grammar — a `<…>` or
  whitespace-free destination, then an optional `"…"`, `'…'` or `(…)` title —
  so `linkUrl` is the destination alone (angle brackets stripped) and an
  in-place URL update keeps the title as written.
- **C8 — three `CodeEditor` comments still described the old
  `"selectionchange"` dedup** (character and line count only): the
  `CodeEditorEvent` doc, `_lastSelection`, and the public
  `on("selectionchange")` overload. All three, and `readSelection`'s own
  summary, now describe the four-field dedup, including that a same-length
  selection moved elsewhere fires.
- **C9 — `tableSource`'s JSDoc** said the separator is skipped when the
  caret's line is blank (the code checks the line above the insertion point,
  per the earlier note above) and said "`rows` unaligned … columns". Both
  corrected.
- **F13 — `clearFormatting` orphaned markers and ate thematic breaks.** It
  deleted only the marker characters inside the selection, so selecting `d**`
  in `a **bold** b` gave `a **bold b` (likewise a code span's closing
  backtick), and a selected `***` thematic break was deleted outright. It now
  pairs markers the way Markdown reads them — code spans first, then a
  simplified CommonMark delimiter-stack pass over `*`, `~~` and `++` runs with
  the flanking rules, backslash escapes and the rule of three, one paragraph
  at a time — and removes every whole pair the selection touches, both
  markers together. A thematic break, a list bullet, an escaped marker, a
  marker inside a code span and a marker with no partner are never pairs, so
  they are left alone; a selection touching no pair is declined. This
  deliberately removes the *whole* pair even when the selection covers only
  part of its text, rather than splitting the span the way WYSIWYG would.
- **Advisory — inline toggles ignored CommonMark flanking.** `a hello.b`
  toggled bold gave `a **hello.**b`, which Markdown reads as literal text,
  while the selection state then reported bold. The marker-run measurement is
  now flanking-aware (for `*`, `~` and `+`, as Lexical 0.49's importer
  flanks all three; the viewer's `marked` rules flank `*` and `~` but read
  `++` with no flanking test, so for `+` the check errs toward declining;
  inline code has none), and a
  toggle checks its own result: if the markers it would add would not read
  back as that format, it declines.
- **Advisory — a backslash just before the selection.** In `C:\Users`, bold
  on `Users` produced `C:\**Users**`, whose first `*` is escaped. The same
  result check covers it: an escaped opening marker (or, outside inline code,
  an escaped closing one — a selection ending in `\`) does not count as a
  marker, so the toggle declines. Inline code may still close after a
  backslash, which is literal inside a code span.
- **Advisory — no-op edits cost an undo step.** `CLEAR_FORMAT_SOURCE`,
  `blockPrefixSource` and `FENCED_CODE_SOURCE` (`setBlockType("code")` on an
  existing fenced block — the same defect class) now decline rather than
  return an identical rewrite, as the styled-span transform does.
  `listSource` was also named, but it cannot produce one: every path either
  strips or adds a marker on at least one line. An exhaustive check over
  ~3.5 million small documents and selections built from list, quote,
  heading, fence and text atoms found no identical rewrite, so no unreachable
  guard was added.
- **Advisory — `linkSource` wrapped an image's alt text**
  (`![alt](src)` → `![[alt](/e)](src)`). The link locator now reports image
  matches instead of skipping them; `toggleLink`/`removeLink` decline inside
  one, and the selection state reports no `linkUrl` there.
- **Advisory — `UNALIGNED_DELIMITER_CELL` re-implemented `formatDelimiterRow`
  and its test hardcoded the row.** Reusing the helper from production code
  would make this module import `markdownTableTransformer.ts`, a Lexical
  module, breaking the leaf boundary the module is built on (no
  DOM/Lexical/component dependency). Instead `formatDelimiterRow` is exported
  and the test compares `tableSource`'s delimiter row against its output for
  1, 3 and 5 columns, so a drift in either fails the suite.
- **Advisory — `getSelectionState`'s `@returns`** said it returns the neutral
  default before Lexical is built, which is untrue in source mode (it always
  reads the raw Markdown there). Reworded per mode.
- **`npm run docs:api` now reports 0 warnings** on this branch; the 14 noted
  above were cleared on `master` since.
- **Fuzz #4 — a line command unbalanced a code fence.** `blockPrefixSource`
  and `FENCED_CODE_SOURCE` dropped every selected line matching a ` ``` `
  fence, so a selection holding only a closing fence and the paragraph below
  it (`` ```\nx\n```\n\npara *em* ``, `setBlockType("paragraph")`) deleted
  that one fence and turned the rest of the document into code; `listSource`
  prefixed fence lines with a marker. The line commands now find the
  document's multi-line constructs first and decline a selection touching
  one. A fenced code block (` ``` ` or `~~~`) whose lines are all selected is
  the one exception, still converting as one unit with both fences dropped,
  per this plan's ` ``` `/`hello`/` ``` ` → `hello` row; `listSource` declines
  even that, since code lines are no list items.
- **Fuzz #15 — line commands rewrote lines of other multi-line constructs.**
  A heading on a definition's continuation line (`[r]:\n  /u` →
  `[r]:\n##   /u`) destroyed the definition, and a heading or list marker on a
  table row (`| c |` → `## | c |`) cut the table short. The same construct
  scan declines a selection touching a table (header, delimiter or body row,
  read the way `markdownTableExtension.ts` reads one), a link reference
  definition with its continuation lines, an indented code block, a `:::`
  fence line (the Markdown between two of them stays editable), or an HTML
  block (CommonMark's seven start conditions, with their end conditions). The
  scan stays line-based, as this module is: it reads top-level lines only, and
  where a line is ambiguous it errs toward a construct, which only declines.
- **Fuzz #16a — inline commands wrapped or split a table cell's paragraph
  break.** A cell writes its paragraph breaks as a literal `\n\n`, which the
  viewer splits the cell's text on; inline code over `a\n\nb` showed the
  `\n\n` as literal text, and a wrap starting between the two `\n`s left a
  lone `\n` that shows literally too. An inline toggle's wrap and a new
  link's wrap now decline a range that holds or cuts into one inside a table;
  the same characters in prose are ordinary text and still wrap.
- **Fuzz (a) — a line command split a paragraph, and its other lines were
  re-read on their own.** A heading or fence on the first line of a
  paragraph that went on lazily or indented below left those lines to start
  afresh after the new block: an indented line became code, a
  definition-shaped line a (dropped) definition, and a setext underline
  closed only the rest into a heading (`foo\nbar\n===` → `## foo\nbar\n===`).
  Per case: `setBlockType` (heading, quote, paragraph) and `setBlockType("code")`
  now **include** the whole paragraph — every line it continues onto, above
  and below the selection — reading continuation with a line-based scan like
  the rest of the module (a line continues the paragraph text above unless it
  is blank, part of a construct, or starts a block that interrupts a
  paragraph, read past shared quote markers; inside a list item any list
  marker interrupts), and drop a setext underline with the rest of the block
  syntax. A continuation line keeps a leading `2.` as its text rather than
  losing it as a marker, and a new prefix drops the line's leftover
  indentation. The list toggle keeps its one-item-per-selected-line reading
  (the lines below still continue the last item lazily — WYSIWYG's own
  meaning, the paragraph becoming the item), so there it **declines**
  instead: when a selected continuation line would open something other than
  text as an item's first line (a definition, an HTML block, a list item —
  `ul` on `foo\n<span>`'s second line made an HTML block of it), when a line
  below would interrupt the new item rather than continue it (`ol` on
  `foo\n2. bar` made `2. bar` a second item), and on a setext heading, whose
  underline would close the item into a heading. A new item also drops its
  line's leftover indentation, which read as code after the marker.
  `insertTable` likewise goes above the caret's whole paragraph instead of
  splitting it, so `tableSource`'s separator test now starts from a heading
  line above rather than a paragraph line.
- **Fuzz (b) — a marker on a blank line joined the blocks around it.** A list
  marker written onto a blank line (`foo\n\nbar` → `foo\n- \nbar`) read as
  an empty item, which cannot interrupt a paragraph — `marked` took
  `foo\n-` as a setext heading, and `1. ` as text continuing it, with the
  block below continuing in turn. A blank line is no block, so the heading,
  quote and list commands now leave blank lines blank: alone, the command
  declines; inside a multi-block selection, only the non-blank lines get the
  marker (`- foo\n\n- bar`, numbered across the gap), and a list toggles off
  across the blank lines between its items.
- **Fuzz (c) — a fence or table inside a list item ended the list.**
  `setBlockType("code")` and `insertTable` wrote ` ``` ` and `|` rows at
  column 0 on a list item's indented content, ending the list and leaving
  the rest of the item outside it. Writing them at the item's indentation
  instead would keep the list, but the WYSIWYG editor holds no code block or
  table inside a list item and would keep the whole list as source, so both
  **decline** there (a line indented under a list item marker, a nested
  item's marker line included). A top-level item's own marker line still
  converts, as before.
- **Stack fuzz round 2 — an image inserted inside an image or a link's
  destination.** `insertImage` replaced the selection wherever it sat, so the
  caret in `![alt](/a.png)`'s alt text wrote a second image into the alt
  text (`![al![i](/i.png)t](/a.png)`), and one in a link's destination cut
  the link. `imageSource` now **declines** when either end of the selection
  sits strictly inside an image (alt text, source or `{…}` size group) or
  inside a link's syntax beyond its text (`](`, destination, title). A link's
  text still takes an image (`[do![i](/i.png)cs](/d)`), and a selection
  covering a whole link or image still replaces it.
- **Stack fuzz round 3 — an image inserted across a table's structure.**
  With the alt-text cases gone, the same check showed `insertImage` over a
  table's row break (`|\n` selected) joining two rows, and one written
  after a row's closing pipe standing as a cell past the header, which the
  viewer drops — words lost beyond the selection. `imageSource` now also
  declines when the selection touches a table's lines and does not lie
  inside one cell (`cutsTableStructure`): it must sit on one header or body
  row, not the delimiter row, hold no unescaped `|`, and stay between the
  row's outer pipes. Inside a cell, an empty one included, it inserts.
- **Stack fuzz round 3 — an image inserted on a `:::` fence's own lines.**
  A caret in `::: columns {align=center}` wrote the image into the fence's
  attribute group, and a selection over a fence or `|||` line removed it.
  `imageSource` also declines when the selection touches an opening or
  closing `:::` line or a `|||` separator (`touchesFenceLine`); a column's
  own text still takes an image.
- **Stack fuzz round 5 — an image inserted on a code fence's line.**
  Replacing the three-space indentation of a ```` ``` ```` line with an image
  (or writing one anywhere on an opening or closing fence line) ended the code block or
  opened one elsewhere, so the lines it held — a definition, a heading — read
  as something else. `touchesFenceLine` now also counts a fenced code block's
  opening and closing lines, its indentation included, so `imageSource`
  declines there as it does on a `:::` line; the code block's content lines
  and the text around the block still take an image.
- **Stack fuzz round 5 — a toggle must actually toggle (user-approved design
  change).** This plan's inline-marker rule read a format as active only
  when its markers sat *right around* the selection, and a press removed just
  those. Text carrying the same format twice — `**foo, **bar** az**` bold over
  `bar` — lost only the inner pair, so it stayed bold and the press looked
  like it did nothing; a selection inside a longer run (`world` in
  `**hello world**`) read as not bold at all. The user approved replacing the
  rule: a format is active when any pair of it Markdown reads (the same
  pairing `clearFormatting` uses) covers the normalised selection, however
  far out, and the selection state reports exactly that. Pressing an active
  format removes it from the whole selection, as the WYSIWYG toggle does:
  every pair of it inside the outermost covering one is dropped, and that
  pair's marker is written again around the text left before and after the
  selection (`**foo,** bar **az**`, `**hello** world`, `**h**ell**o**`). The
  split points step outward over whitespace, over the dropped markers and out
  of another format's pair that opens or closes right at the selection
  (`*a **b** c*` → `*a* **b** *c*`); a code span splits without moving past
  its spaces, which are code. The result is re-read — the paragraphs' pairs
  found again — and kept only when the selected text (and the whitespace at a
  split) no longer shows the format and every other character reads as
  before; otherwise the press declines. At this branch's line level a split
  whose new markers would cross a link's brackets also declines
  (`**[foo bar](/u)**`), since the link is no pair this reading can re-split.

**Manual verification.** Run in the library demo (worktree dev server, **MD
Editor** page, **Edit Markdown source** toggle), driven through
chrome-devtools: Bold wraps the selected word, leaves it selected and keeps
focus in the source editor; pressing it again unwraps it; one real
**Ctrl+Z** restores both the text and the selection; pressing Bold with the
caret near the bottom of a 200-line document leaves the scroll position
unchanged; the five format buttons press and release as the caret moves
through `**…**`, `*…*`, `++…++`, `~~…~~` and `` `…` `` runs; the **Table**
button is disabled in source mode; **Insert › Table** writes the skeleton
with the caret in the first header cell, renders as a table in WYSIWYG, and
comes back with the delimiter row unchanged; the Bold button matched the
caret's real state across a source → WYSIWYG → source round trip; and the new
fixes behave live — Bold on `a hello.b` and on `Users` in `C:\Users` changes
nothing, and the **Link…** dialog on `[docs](/d "Title")` is prefilled with
`/d` and updating it gives `[docs](/e "Title")`. Not run live: the read-only
flash (the demo has no read-only toggle for this editor; covered by unit
tests), the Table button re-enabling with the caret in a WYSIWYG table, and
`clearFormatting`, which the demo reaches only through the WYSIWYG context
menu, so in source mode it is API-only and covered by unit tests.

**Review fixes.** The source guard the plan spells as
`if (this.editSource(<transform>)) { return this; }` is written in two lines
at all 15 commands — `const handledBySource = this.editSource(<transform>);`
then `if (handledBySource) { return this; }` — so no call sits directly in an
`if` condition. Nothing behaves differently. A third review round did the
same for `copy()`'s own guard, which names `isSourceMode()`'s result
(`sourceMode`) before testing it; the guards of `cut()`, `paste()` and the
commands that do nothing in source mode are named further up the stack,
where later rounds rewrote them.
