---
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/src/typescript/lib/component/editor/theme.ts
  - packages/lib/src/typescript/lib/component/editor/index.ts
  - packages/lib/src/typescript/CodeEditorPanel.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# CodeEditor Reveal Range — Implementation Plan

## Overview

[`CodeEditor`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L333)
can move its caret to the end of the document
([`moveCursorToEnd()`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1012))
and report where the caret currently is
([`getCursorPosition()`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1036)),
but nothing lets a host jump the editor to a line and column it computed
elsewhere. The `Ctrl-F` panel searches only a query the user types into it; it
cannot be driven from outside code.

This plan adds one public method, `revealRange(at, options?)`. It selects the
target range, scrolls it into view, optionally takes focus, and paints a
short-lived accent highlight over the range so the landing spot is obvious even
when the editor never took focus. The highlight is a CodeMirror *decoration* — a
styled span the editor draws over a range of text, independent of the native
selection — held in a `StateField` added to the extension list
[`mount()`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1698)
already builds, and coloured from `theme.ts`'s existing accent recipe
([theme.ts:126-140](packages/lib/src/typescript/lib/component/editor/theme.ts#L126)).

Seven files change: the component, the editor theme, the `component/editor`
barrel (two new exported types), the test file, the dev-app demo panel (the only
place in this repository where a real CodeMirror view mounts), the component doc
page, and the changelog.

---

## Architecture Decisions

### `revealRange(at, options?)` — 1-based line and column, matching this class

The target is `{ line, column, length }` with `line` and `column` both counting
from 1, the convention
[`CodeEditorCursorPosition`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L64)
already publishes and
[`readCursorPosition`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1296)
already produces. `length` is a character count. All three fields are
required.[^required-fields]

The method mirrors `moveCursorToEnd()` in every mechanical respect: it returns
`this` for chaining, it no-ops before the view is mounted, and it dispatches one
selection transaction with `scrollIntoView: true` and no document change.

### The method clamps the target against the live document

A caller supplies a position it computed from some other copy of the text, so
the position can be stale. `revealRange` clamps line, column and length against
the live document rather than trusting them.[^clamp-here]

Clamping is three `Math.min` / `Math.max` pairs. Worked against the document
`"ab\ncd"` — two lines, line 1 spanning offsets 0-2, line 2 spanning 3-5:

| `at` | Line used | `from` | `to` | Why |
|---|---|---|---|---|
| `{ line: 1, column: 1, length: 2 }` | 1 | 0 | 2 | exact — column 1 is the line's first character |
| `{ line: 2, column: 2, length: 1 }` | 2 | 4 | 5 | line 2 starts at 3, column 2 is 3 + 1 |
| `{ line: 7, column: 1, length: 1 }` | 2 | 3 | 4 | line clamped to the last line |
| `{ line: 1, column: 7, length: 2 }` | 1 | 2 | 2 | column clamped to the line's end; empty, so no highlight |
| `{ line: 1, column: 2, length: 9 }` | 1 | 1 | 2 | length clamped to the line's end |
| `{ line: 0, column: 0, length: 1 }` | 1 | 0 | 1 | line and column floored to 1 |

A revealed range never spans a line break: `to` is capped at the target line's
end.[^single-line]

### The highlight is a decoration, not the native selection

The native selection alone is too weak a cue: CodeMirror renders an unfocused
selection much fainter than a focused one, and `revealRange` is expected to run
with `focus: false` whenever a host is previewing a hit without stealing focus
from its own results list. A decoration paints regardless of focus.[^selection-token-bug]

This is the mechanism `@codemirror/search` itself uses for `.cm-searchMatch`,
which `theme.ts` already styles — the same decoration-mark-plus-class shape,
applied to a range this component chooses instead of a range a query matched.

### The highlight persists until something supersedes it

The decoration stays until one of four things happens: another `revealRange`
call replaces it, a `revealRange` call with `highlight: false` clears it, the
document changes, or a user-driven selection change occurs (a click, an arrow
key, a find-next). It is not on a timer.[^persist]

CodeMirror marks user-driven selection changes with a `"select"` user-event
annotation, so the field's rule is exact: clear on `tr.docChanged`, clear on
`tr.isUserEvent("select")`, keep otherwise. `revealRange`'s own transaction
carries neither annotation, and it carries the set-effect, which the field
checks first.

| Transaction | Highlight after |
|---|---|
| `revealRange({ line: 3, column: 1, length: 4 })` | painted over line 3, columns 1-5 |
| `revealRange({ line: 9, column: 2, length: 3 })` | moved to line 9 — one highlight, never two |
| user clicks elsewhere (`userEvent: "select.pointer"`) | cleared |
| user types (`docChanged`) | cleared |
| editor is scrolled, or the theme is toggled | unchanged |

### A brief CSS entrance flash, gated on `prefers-reduced-motion`

The highlight animates once from a brighter tint down to its resting tint, so
the eye catches it even when the target was already on screen and nothing
scrolled. The animation is a CSS `@keyframes` block referenced by a second class
on the same decoration; under reduced motion `revealRange` omits that class and
the highlight simply appears at its resting tint.[^css-animation]

This mirrors [`TabButton`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L37)'s
busy pulse exactly: a keyframe registered once through
[`StyleRule.ensureKeyframes`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L423),
and an `Animation.isReducedMotion()` branch at the call site
([TabButton.ts:441-445](packages/lib/src/typescript/lib/component/button/TabButton.ts#L441))
choosing a static presentation instead of the animated one.

### The highlight owns its own class, at the current-search-match colour

The decoration carries `ts-ui-cm-reveal` (plus `ts-ui-cm-reveal-flash` while
animating), not `cm-searchMatch-selected`. Its resting colour is the same
`color-mix` on `--ts-ui-indicator-focus` at the same 25% strength that
[`.cm-searchMatch.cm-searchMatch-selected`](packages/lib/src/typescript/lib/component/editor/theme.ts#L138)
uses, so the two read as one visual language: "this is the match you are looking
at now".[^own-class]

---

## Public API

Two new exported interfaces, in
`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`, placed
immediately after `CodeEditorCursorPosition`
([CodeEditor.ts:64-78](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L64)):

```typescript
/**
 * A range to reveal in a {@link CodeEditor}, as passed to
 * {@link CodeEditor.revealRange}. `line` and `column` count from 1, matching
 * {@link CodeEditorCursorPosition}; `length` is a character count. All three
 * are clamped against the live document, so a position computed from a stale
 * copy of the text lands at the nearest valid range instead of throwing.
 *
 * @category Components
 */
export interface CodeEditorRevealTarget {
    /** 1-based line number in the document. */
    line: number;
    /** 1-based character offset into that line. A literal tab counts as one column. */
    column: number;
    /**
     * Length of the range in characters, from `column`. A range that would run
     * past the end of its line is cut off there — a revealed range never spans
     * a line break.
     */
    length: number;
}

/**
 * Options for {@link CodeEditor.revealRange}.
 *
 * @category Components
 */
export interface CodeEditorRevealOptions {
    /**
     * Whether to move keyboard focus into the editor. Defaults to `true`. Pass
     * `false` when previewing a location from another control that should keep
     * focus — a search-results list being arrowed through, say.
     */
    focus?: boolean;
    /**
     * Whether to paint the reveal highlight over the range. Defaults to `true`.
     * `false` moves the caret and scrolls with no highlight, and clears any
     * highlight a previous call left.
     */
    highlight?: boolean;
}
```

New public method on `CodeEditor`:

```typescript
class CodeEditor extends Component<CodeEditorOptions> {
    revealRange(at: CodeEditorRevealTarget, options?: CodeEditorRevealOptions): this;
}
```

New barrel exports, in
`packages/lib/src/typescript/lib/component/editor/index.ts`
([index.ts:7](packages/lib/src/typescript/lib/component/editor/index.ts#L7)) —
`CodeEditorRevealTarget` and `CodeEditorRevealOptions` join the existing
`export type { … }` line.

Two module-level symbols in `CodeEditor.ts` are exported for the test file only,
and are deliberately **not** added to the barrel, so they stay out of the
generated API docs: `setRevealHighlight` (the `StateEffect`) and
`revealHighlightField` (the `StateField`). This matches how
`packages/lib/tests/component/code-editor.test.ts` already imports
`mapFormatOptions` and `formatWithSql` straight from their modules rather than
through `component/editor`. Public JSDoc must never `{@link}` either of them,
per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s *Don't `{@link}` internal
symbols from public JSDoc*.

---

## Internal Structure

### `theme.ts` — the CSS

Three new module-level constants and one keyframe registration, placed after the
syntax-palette constants
([theme.ts:13-19](packages/lib/src/typescript/lib/component/editor/theme.ts#L13)).
`theme.ts` gains one import: `import { StyleRule } from "~/core/StyleTarget.js";`.

```typescript
/** Class the reveal highlight's decoration carries; styled below, inside the editor's theme scope. */
export const REVEAL_CLASS = "ts-ui-cm-reveal";

/** Added alongside {@link REVEAL_CLASS} to run the entrance flash once. Omitted under reduced motion. */
export const REVEAL_FLASH_CLASS = "ts-ui-cm-reveal-flash";

/** Name of the reveal flash's `@keyframes` block, registered once below. */
const REVEAL_FLASH_KEYFRAME = "ts-ui-code-editor-reveal-flash";

// Long enough to register as a flash rather than a repaint, short enough that
// it has finished by the time the eye reaches the range — the same order as
// READONLY_FLASH_MS (300ms) in CodeEditor.ts, doubled because this animation
// has to be caught rather than merely felt.
const REVEAL_FLASH_MS = 600;

/** Resting tint of the reveal highlight — the same strength as a selected search match. */
const REVEAL_RESTING_TINT = "color-mix(in srgb, var(--ts-ui-indicator-focus, #2563eb) 25%, transparent)";

/** Peak tint the flash starts from, decaying to {@link REVEAL_RESTING_TINT}. */
const REVEAL_PEAK_TINT = "color-mix(in srgb, var(--ts-ui-indicator-focus, #2563eb) 50%, transparent)";

StyleRule.ensureKeyframes(
    REVEAL_FLASH_KEYFRAME,
    `from { background-color: ${REVEAL_PEAK_TINT}; } to { background-color: ${REVEAL_RESTING_TINT}; }`
);
```

Two new rules inside `codeEditorTheme`'s `EditorView.theme({ … })` object,
placed immediately after `".cm-selectionMatch"`
([theme.ts:141-143](packages/lib/src/typescript/lib/component/editor/theme.ts#L141)):

```typescript
[`.${REVEAL_CLASS}`]: {
    backgroundColor: REVEAL_RESTING_TINT,
},
[`.${REVEAL_CLASS}.${REVEAL_FLASH_CLASS}`]: {
    // No fill-mode: the animation ends on the resting tint the rule above
    // already declares, so the mark settles with nothing to clean up.
    animation: `${REVEAL_FLASH_KEYFRAME} ${REVEAL_FLASH_MS}ms ease-out`,
},
```

### `CodeEditor.ts` — the decoration machinery

New imports: `Decoration` from `@codemirror/view`
([CodeEditor.ts:17-21](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L17)),
`type DecorationSet` from the same module, `StateEffect` and `StateField` from
`@codemirror/state`
([CodeEditor.ts:22](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L22)),
and `REVEAL_CLASS` / `REVEAL_FLASH_CLASS` from `~/component/editor/theme.js`
([CodeEditor.ts:34](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L34)).

Module-level, placed immediately after `buildReadOnlyExtension`
([CodeEditor.ts:287-289](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L287)):

```typescript
/** The reveal highlight's mark, without the entrance flash (reduced motion). */
const REVEAL_MARK = Decoration.mark({ class: REVEAL_CLASS });

/** The reveal highlight's mark, with the entrance flash. */
const REVEAL_FLASH_MARK = Decoration.mark({ class: `${REVEAL_CLASS} ${REVEAL_FLASH_CLASS}` });

/**
 * Carries a range for {@link revealHighlightField} to highlight, or `null` to
 * clear whatever it holds. `flash` asks for the entrance animation; the caller
 * decides it, so `prefers-reduced-motion` is read once per reveal rather than
 * baked into the field.
 *
 * @internal
 */
export const setRevealHighlight = StateEffect.define<{ from: number; to: number; flash: boolean } | null>();

/**
 * Holds the single range {@link CodeEditor.revealRange} last highlighted, as a
 * CodeMirror decoration drawn over the text independently of the native
 * selection. At most one range is ever held: a new reveal replaces the old one
 * rather than stacking.
 *
 * The highlight is cleared by any document change and by any user-driven
 * selection change (CodeMirror annotates those with a `"select"` user event —
 * clicks, arrow keys, find-next), so it never lingers over text the user has
 * moved on from. Every other transaction, scrolling and theme toggles included,
 * leaves it alone. A transaction carrying the effect wins over both rules,
 * which is what lets one transaction set the selection and the highlight
 * together.
 *
 * @internal
 */
export const revealHighlightField = StateField.define<DecorationSet>({
    create(): DecorationSet {
        return Decoration.none;
    },

    update(highlight: DecorationSet, tr): DecorationSet {
        for (const effect of tr.effects) {
            if (effect.is(setRevealHighlight)) {
                const value = effect.value;

                return value === null
                    ? Decoration.none
                    : Decoration.set([(value.flash ? REVEAL_FLASH_MARK : REVEAL_MARK).range(value.from, value.to)]);
            }
        }

        if (tr.docChanged || tr.isUserEvent("select")) {
            return Decoration.none;
        }

        return highlight;
    },

    provide: (field) => EditorView.decorations.from(field),
});
```

### `CodeEditor.ts` — the public method

Placed immediately after `getCursorPosition()`
([CodeEditor.ts:1036-1042](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1036))
and before `copy()`:

```typescript
/**
 * Selects a range given by line, column and length, scrolls it into view, and
 * paints a brief accent highlight over it.
 *
 * @remarks Built for a host that computed the position somewhere else — a
 * project-wide search's results list, a compiler diagnostic, a stack frame —
 * and needs the editor to jump there. `line` and `column` count from 1, the
 * same convention {@link CodeEditor.getCursorPosition} reports.
 *
 * All three fields are clamped against the live document, so a position taken
 * from a copy of the text that has since changed lands at the nearest valid
 * range instead of throwing. A range that would run past its line's end is cut
 * off there — a revealed range never spans a line break.
 *
 * The highlight is drawn over the text independently of the native selection,
 * which is deliberately faint while the editor is unfocused; it stays until
 * another reveal replaces it, the document changes, or the user moves the
 * caret. Under `prefers-reduced-motion` it appears with no entrance animation
 * rather than not at all. A selection-only transaction — it changes no text, so
 * it emits no `"change"`. No-op before the view is mounted (offline /
 * pre-mount), like every other view operation.
 *
 * @param at - The range to reveal.
 * @param options - Whether to take focus, and whether to paint the highlight.
 * @returns This component, for method chaining.
 */
revealRange(at: CodeEditorRevealTarget, options?: CodeEditorRevealOptions): this {
    if (!this._view) {
        return this;
    }

    const doc  = this._view.state.doc;
    const line = doc.line(Math.min(Math.max(at.line, 1), doc.lines));
    const from = Math.min(line.from + Math.max(at.column, 1) - 1, line.to);
    const to   = Math.min(from + Math.max(at.length, 0), line.to);

    // An empty range would make an empty mark decoration, which CodeMirror
    // rejects; a caret with no highlight is the honest rendering of a target
    // that clamped down to nothing.
    const highlight = (options?.highlight ?? true) && to > from
        ? { from, to, flash: !Animation.isReducedMotion() }
        : null;

    this._view.dispatch({
        selection:      { anchor: from, head: to },
        effects:        setRevealHighlight.of(highlight),
        scrollIntoView: true,
    });

    if (options?.focus ?? true) {
        this.focus();
    }

    return this;
}
```

### `CodeEditor.ts` — the extension wiring

One entry in `mount()`'s `extensions` array, immediately after
`highlightSelectionMatches()`
([CodeEditor.ts:1733](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1733)),
grouping it with the other match-highlighting extensions:

```typescript
            search(),
            highlightSelectionMatches(),
            // The programmatic counterpart to the two above: the highlight
            // revealRange() paints over a range the host supplied.
            revealHighlightField,
```

### `CodeEditorPanel.ts` — the demo handles

Two buttons appended to the upper toolbar after `saveBtn`
([CodeEditorPanel.ts:163](packages/lib/src/typescript/CodeEditorPanel.ts#L163))
and before the `Language:` label, each targeting a fixed range in `SAMPLE_JS`:

```typescript
        // Line 12, columns 5-9 of SAMPLE_JS: the `parts` identifier inside the
        // `if (person.role)` block. Deliberately not the same range as Preview
        // below, so pressing them alternately shows one highlight moving rather
        // than two accumulating.
        const revealBtn = new Button({ text: 'Reveal' });
        revealBtn.on('action', () => { this._editor.revealRange({ line: 12, column: 5, length: 5 }); });

        // Line 2, columns 9-15: the `message` identifier. focus: false, so the
        // pressed button keeps focus and the highlight is the only cue.
        const previewBtn = new Button({ text: 'Preview' });
        previewBtn.on('action', () => {
            this._editor.revealRange({ line: 2, column: 9, length: 7 }, { focus: false });
        });
```

---

## Ordered Implementation Steps

Throughout, `TEST` means
`npm -w packages/lib exec -- vitest run tests/component/code-editor.test.ts`.

1. `packages/lib/src/typescript/lib/component/editor/theme.ts` — add the
   `StyleRule` import, the six constants, and the `StyleRule.ensureKeyframes`
   call from `## Internal Structure` › *`theme.ts` — the CSS*, after the syntax
   palette constants
   ([theme.ts:19](packages/lib/src/typescript/lib/component/editor/theme.ts#L19)).
   *Check:* `npm -w packages/lib run typecheck`.
2. Same file — add the two rules to `codeEditorTheme`'s `EditorView.theme({ … })`
   object, after `".cm-selectionMatch"`
   ([theme.ts:141-143](packages/lib/src/typescript/lib/component/editor/theme.ts#L141)).
   *Check:* `npm -w packages/lib run typecheck`.
3. `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — add the
   `CodeEditorRevealTarget` and `CodeEditorRevealOptions` interfaces from
   `## Public API`, after `CodeEditorCursorPosition`
   ([CodeEditor.ts:78](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L78)).
4. Same file — add the four new imports listed in `## Internal Structure` ›
   *`CodeEditor.ts` — the decoration machinery*: `Decoration` into the
   `@codemirror/view` value import
   ([:17-21](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L17)),
   `DecorationSet` as a type import from the same module, `StateEffect` /
   `StateField` into the `@codemirror/state` value import
   ([:22](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L22)),
   and `REVEAL_CLASS` / `REVEAL_FLASH_CLASS` alongside the existing
   `codeEditorTheme` import
   ([:34](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L34)).
   `Animation` is already imported
   ([:3](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L3)).
5. Same file — add `REVEAL_MARK`, `REVEAL_FLASH_MARK`, `setRevealHighlight` and
   `revealHighlightField` from `## Internal Structure`, immediately after
   `buildReadOnlyExtension`
   ([:289](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L289)).
   *Check:* `npm -w packages/lib run typecheck`.
6. Same file — add `revealRange` from `## Internal Structure` ›
   *`CodeEditor.ts` — the public method*, immediately after
   `getCursorPosition()`
   ([:1042](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1042)).
   *Check:* `npm -w packages/lib run typecheck`.
7. Same file — add `revealHighlightField` to `mount()`'s extension array after
   `highlightSelectionMatches()`
   ([:1733](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1733)),
   with the comment shown in `## Internal Structure`.
   *Check:* `TEST` — every pre-existing test still passes unedited.
8. `packages/lib/src/typescript/lib/component/editor/index.ts` — add
   `CodeEditorRevealTarget` and `CodeEditorRevealOptions` to the existing
   `export type { … } from '~/component/editor/CodeEditor.js';` line
   ([index.ts:7](packages/lib/src/typescript/lib/component/editor/index.ts#L7)).
   Do **not** export `setRevealHighlight` or `revealHighlightField` here.
   *Check:* `grep -n 'revealHighlightField' packages/lib/src/typescript/lib/component/editor/index.ts`
   — expect zero matches.
9. `packages/lib/tests/component/code-editor.test.ts` — add a
   `describe('CodeEditor revealRange')` block and a
   `describe('CodeEditor reveal highlight field')` block covering every case in
   `## Expected Behaviour` › *Unit-testable*, placed after the existing
   `describe('CodeEditor cursor position')` block
   ([code-editor.test.ts:1701](packages/lib/tests/component/code-editor.test.ts#L1701)).
   Import `setRevealHighlight` and `revealHighlightField` alongside the existing
   `CodeEditor` import
   ([:2](packages/lib/tests/component/code-editor.test.ts#L2)). No new
   `@codemirror/state` import is needed: `EditorState` is already imported
   ([:18](packages/lib/tests/component/code-editor.test.ts#L18)), and effects are
   built through `setRevealHighlight.of(...)`.
   *Check:* `TEST` — full file green.
10. `packages/lib/src/typescript/CodeEditorPanel.ts` — add the two buttons from
    `## Internal Structure` › *`CodeEditorPanel.ts` — the demo handles*, and
    two `upperToolbar.addComponent(...)` calls for them after
    `upperToolbar.addComponent(saveBtn)`
    ([CodeEditorPanel.ts:163](packages/lib/src/typescript/CodeEditorPanel.ts#L163)).
    *Check:* `npm -w packages/lib run typecheck` and `npm -w packages/lib run lint`.
11. Same file — extend the class doc comment's upper-toolbar sentence
    ([CodeEditorPanel.ts:77-82](packages/lib/src/typescript/CodeEditorPanel.ts#L77))
    to mention that Reveal and Preview jump the editor to a fixed range, Preview
    without taking focus.
12. `packages/lib/docs/components/CodeEditor.md` — apply the two edits in
    `## Documentation Impact`.
13. `packages/lib/docs/reference/changelog/next.md` — add the bullet from
    `## Documentation Impact`.
    *Check:* `npm run docs:api` — 0 errors, 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/theme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/index.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/src/typescript/CodeEditorPanel.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Unit-testable (offline harness, `packages/lib/tests/component/code-editor.test.ts`)

`CodeEditor` is live-only — `DOM.sink.mountView` returns `null` under the
recording DOM sink, so `_view` never leaves `null` on its own. These tests reach
`revealRange` the way the `clipboard commands` block already does
([code-editor.test.ts:2808-2819](packages/lib/tests/component/code-editor.test.ts#L2808)):
by assigning a duck-typed view to `editor._view`. Here the fake carries a **real**
`EditorState`, so `doc.line()` and `doc.lines` behave exactly as they do live:

```typescript
function fakeView(doc: string, dispatch = vi.fn(), focus = vi.fn()) {
    return { state: EditorState.create({ doc }), dispatch, focus };
}
```

**No-op before mount.** `new CodeEditor().revealRange({ line: 1, column: 1, length: 1 })`
returns the editor itself and throws nothing.

**Chaining.** With a fake view assigned, `revealRange(...)` returns the editor
itself.

**Line / column / length → offsets.** One case per row of the clamping table in
`## Architecture Decisions` › *The method clamps the target against the live
document*, all against `doc: 'ab\ncd'`. Assert the single `dispatch` call's spec
has `selection` equal to `{ anchor: <from>, head: <to> }` and `scrollIntoView`
`true`.

**Focus.**

| Call | `view.focus` |
|---|---|
| `revealRange({ line: 1, column: 1, length: 1 })` | called once |
| `revealRange({ line: 1, column: 1, length: 1 }, { focus: true })` | called once |
| `revealRange({ line: 1, column: 1, length: 1 }, { focus: false })` | not called |

**Highlight effect**, read off the dispatched spec's `effects` (assert
`effect.is(setRevealHighlight)`, then its `.value`), against `doc: 'ab\ncd'`:

| Call | Effect value |
|---|---|
| `revealRange({ line: 1, column: 1, length: 2 })` | `{ from: 0, to: 2, flash: true }` |
| `revealRange({ line: 1, column: 1, length: 2 }, { highlight: false })` | `null` |
| `revealRange({ line: 1, column: 1, length: 0 })` | `null` — empty range |
| `revealRange({ line: 1, column: 7, length: 2 })` | `null` — clamped to empty |

**Reduced motion.** With
`vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} })`
— the shape
[`Tab.lazy.test.ts:329`](packages/lib/tests/component/layout/Tab.lazy.test.ts#L329)
already uses — `revealRange({ line: 1, column: 1, length: 2 })`'s effect value is
`{ from: 0, to: 2, flash: false }`. Without the spy it is `flash: true`.

**The `StateField`**, driven on a real state:
`EditorState.create({ doc: 'ab\ncd', extensions: [revealHighlightField] })`, then
`state.update(spec).state`. Read the result with `state.field(revealHighlightField)`
— `.size` for the count, `.iter()` for `from` / `to` / `value.spec.class`.

| Starting state | Transaction | Field afterwards |
|---|---|---|
| fresh | none | `size` 0 |
| fresh | `effects: setRevealHighlight.of({ from: 0, to: 2, flash: true })` | `size` 1, `from` 0, `to` 2, class `ts-ui-cm-reveal ts-ui-cm-reveal-flash` |
| fresh | `effects: setRevealHighlight.of({ from: 0, to: 2, flash: false })` | `size` 1, class `ts-ui-cm-reveal` |
| holding `0-2` | `effects: setRevealHighlight.of({ from: 3, to: 5, flash: true })` | `size` 1, `from` 3, `to` 5 — replaced, not stacked |
| holding `0-2` | `effects: setRevealHighlight.of(null)` | `size` 0 |
| holding `0-2` | `selection: { anchor: 4 }, userEvent: 'select'` | `size` 0 |
| holding `0-2` | `changes: { from: 0, insert: 'x' }` | `size` 0 |
| holding `0-2` | `selection: { anchor: 4 }` (no user event) | `size` 1, unchanged |
| holding `0-2` | `state.update({})` | `size` 1, unchanged |
| holding `0-2` | `selection: { anchor: 4 }, userEvent: 'select'` **and** `effects: setRevealHighlight.of({ from: 3, to: 5, flash: true })` | `size` 1, `from` 3, `to` 5 — the effect wins |

### Manual verification only (live-only component; the offline sink never mounts a view)

Run in the dev app (`npm run dev`, `http://localhost:8015`, **CodeEditor**
section), using the upper editor's new **Reveal** and **Preview** buttons:

1. Pressing **Reveal** selects `parts` on line 12, moves focus into the editor
   (the caret blinks), and paints an accent highlight over those five characters
   that briefly flashes brighter before settling.
2. Pressing **Preview** selects `message` on line 2, leaves focus on the button
   (the button keeps its focus ring, the editor's caret does not blink), and
   still paints a clearly visible highlight — the point of the feature.
3. Pressing **Reveal** then **Preview** then **Reveal** leaves exactly one
   highlight on screen at a time; it moves rather than accumulating.
4. After a **Preview**, clicking anywhere in the document clears the highlight.
5. After a **Preview**, pressing an arrow key clears the highlight.
6. After a **Preview**, typing a character clears the highlight.
7. After a **Preview**, scrolling the editor with the wheel leaves the highlight
   in place.
8. After a **Preview**, toggling the project theme (light ↔ dark) leaves the
   highlight in place and recolours it with the rest of the editor.
9. With the OS set to reduce motion, **Reveal** paints the highlight with no
   flash — the highlight is still there, at its resting tint.
10. With `Ctrl-F` open on a query that matches elsewhere, a **Reveal** highlight
    and the search-match tints coexist and are both legible.
11. Pressing **CSS** (a four-line sample), then **Reveal** (which targets line
    12), lands the caret at the end of the last line with no highlight and no
    error — the clamp path.
12. Pressing **Reveal** on a document scrolled so line 12 is off screen scrolls
    line 12 into view.

---

## Verification

- `npm -w packages/lib run typecheck` — clean.
- `npm -w packages/lib run lint` — clean.
- `npm -w packages/lib exec -- vitest run tests/component/code-editor.test.ts`
  — full file green, every pre-existing case passing unedited.
- `npm run docs:api` — 0 errors, 0 link warnings.
- `grep -rn 'ts-ui-cm-reveal' packages/lib/src/` — expect matches only in
  `theme.ts` (the constants and the two rules).
- Manual smoke tests: all twelve cases in `## Expected Behaviour` › *Manual
  verification only*, in the dev app's **CodeEditor** section.

---

## Documentation Impact

**`packages/lib/docs/components/CodeEditor.md`.**

- New **Revealing a range** section, placed directly after **Search and replace**
  ([CodeEditor.md:205-222](packages/lib/docs/components/CodeEditor.md#L205)) and
  before **Right-click menu**:

  > `revealRange({ line, column, length })` jumps the editor to a range a host
  > computed somewhere else — a project-wide search hit, a compiler diagnostic, a
  > stack frame. It selects the range, scrolls it into view, takes focus, and
  > paints an accent highlight over it. `line` and `column` count from 1, the
  > same convention [`getCursorPosition()`](#cursor-position) reports.
  >
  > Pass `{ focus: false }` when the caller should keep focus — previewing hits
  > from a results list, say. That is why the highlight exists: an unfocused
  > selection is too faint to find. The highlight is drawn over the text
  > independently of the selection, and stays until another `revealRange` call
  > replaces it, the document changes, or the user moves the caret. Pass
  > `{ highlight: false }` for a silent jump, which also clears any highlight a
  > previous call left.
  >
  > All three fields are clamped against the live document, so a position taken
  > from a copy of the text that has since changed lands at the nearest valid
  > range rather than throwing. A range that would run past its line's end is cut
  > off there — a revealed range never spans a line break. The highlight animates
  > in once; under `prefers-reduced-motion` it appears without the animation
  > rather than not at all.

- Methods table
  ([CodeEditor.md:228-251](packages/lib/docs/components/CodeEditor.md#L228))
  gains one row, after the `getCursorPosition()` row:

  | Method | Purpose |
  |---|---|
  | `revealRange(at, options?)` | Select, scroll to and highlight a 1-based `{ line, column, length }` range. `options.focus` (default `true`) takes keyboard focus; `options.highlight` (default `true`) paints the highlight. No-op before the editor is mounted. |

**`packages/lib/docs/reference/changelog/next.md`.** One bullet under
`## Added` › `### Components`
([next.md:8-17](packages/lib/docs/reference/changelog/next.md#L8)):

> - **`CodeEditor` gains `revealRange(at, options?)`**, for jumping the editor to
>   a range a host computed elsewhere — a search hit, a diagnostic, a stack
>   frame. It selects the 1-based `{ line, column, length }` range, scrolls it
>   into view, and paints an accent highlight over it that survives the editor
>   not having focus, which a native selection does not. `options.focus: false`
>   previews a location without stealing focus; `options.highlight: false`
>   suppresses the highlight. The target is clamped against the live document, so
>   a stale position lands at the nearest valid range instead of throwing. The
>   new types `CodeEditorRevealTarget` and `CodeEditorRevealOptions` are exported
>   from `component/editor`. No consumer action is needed.

**Two new exports.** `CodeEditorRevealTarget` and `CodeEditorRevealOptions` join
the existing `export type { … }` line in `component/editor`'s barrel;
`CodeEditor` itself is already exported, so the new method needs no further
barrel change.

**No change** to `packages/lib/llms.txt`
([llms.txt:93](packages/lib/llms.txt#L93)) or `docs/components/index.md`: both
carry a one-line summary of the component's scope ("highlighting, formatting,
folding, search, lint and completion") that a programmatic reveal does not
change. `docs/concepts/theming.md` needs no change either — the highlight
introduces no new theme token, reading `--ts-ui-indicator-focus`, which that page
already documents.

---

## Potential Challenges

- **An empty mark decoration throws.** CodeMirror rejects a mark decoration whose
  `from` equals its `to`. `revealRange` therefore passes `null` to the effect
  whenever the clamped range is empty, so the caret still moves and no
  decoration is built.
- **`view.focus()` must not clear the highlight it just set.** CodeMirror's
  `focus()` wraps its DOM work in `observer.ignore(...)`, so it dispatches no
  transaction and nothing reaches the field. Manual case 1 in
  `## Expected Behaviour` is the check: if a highlight ever vanished the instant
  focus landed, the fix would be to narrow the field's clear rule to a user
  selection that differs from the highlighted range.
- **Nothing to tear down.** The field lives in the view's own state and dies with
  the view, and the animation is pure CSS. Unlike
  [`flashReadOnly`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2357),
  this feature allocates no `Handle`, no timer and no `Animation.CancelHandle`,
  so `destructor()`
  ([:1429](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1429))
  needs no change.
- **The keyframe is registered at module import.** `theme.ts`'s module-level
  `StyleRule.ensureKeyframes` call runs when the module is first imported, before
  the test harness installs its recording sink in `beforeEach`. This is the same
  position `ProgressBar`
  ([ProgressBar.ts:8](packages/lib/src/typescript/lib/component/display/ProgressBar.ts#L8))
  and `TabButton`
  ([TabButton.ts:42](packages/lib/src/typescript/lib/component/button/TabButton.ts#L42))
  are already in, and both are imported by the existing suite, so the path is
  proven; `ensureKeyframes` is idempotent by name, so a repeat import costs
  nothing.
- **`color-mix` in a keyframe.** The flash interpolates `background-color`
  between two `color-mix(...)` values. `theme.ts` already relies on `color-mix`
  for `.cm-searchMatch` and `.cm-trailingSpace`, so the browser baseline is
  unchanged; a browser that cannot interpolate them still lands on the resting
  tint, because the animation is not `forwards` and the resting rule owns the
  final value.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) —
  the component. Read `moveCursorToEnd()`
  ([:1012](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1012))
  and `getCursorPosition()`
  ([:1036](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1036))
  for the no-op-before-mount / dispatch-with-`scrollIntoView` / return-`this`
  conventions this method mirrors, `applyFormatted`'s own clamp
  ([:1252](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1252)),
  `buildReadOnlyExtension`
  ([:287](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L287))
  for where module-level extension code lives, `mount()`'s extension array
  ([:1698-1802](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1698)),
  and `flashReadOnly` / `mountFlashOverlay`
  ([:2281-2369](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2281)) —
  the attention-cue precedent this plan deliberately does **not** follow (see
  `## Notes`).
- [`packages/lib/src/typescript/lib/component/button/TabButton.ts`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L37) —
  the precedent the flash follows: a `StyleRule.ensureKeyframes` block at module
  level ([:37-45](packages/lib/src/typescript/lib/component/button/TabButton.ts#L37))
  and an `Animation.isReducedMotion()` branch choosing a static presentation
  ([:441-445](packages/lib/src/typescript/lib/component/button/TabButton.ts#L441)).
- [`packages/lib/src/typescript/lib/component/editor/theme.ts`](packages/lib/src/typescript/lib/component/editor/theme.ts#L126) —
  `.cm-searchMatch`, `.cm-searchMatch.cm-searchMatch-selected` and
  `.cm-selectionMatch`, the visual family the reveal highlight joins, and the
  `color-mix` recipe it reuses.
- [`packages/lib/src/typescript/lib/core/Animation.ts`](packages/lib/src/typescript/lib/core/Animation.ts#L77) —
  `isReducedMotion()`, and `play()`
  ([:106](packages/lib/src/typescript/lib/core/Animation.ts#L106)), whose
  `Handle`-taking contract is why it cannot drive this highlight.
- [`packages/lib/src/typescript/lib/core/StyleTarget.ts`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L423) —
  `StyleRule.ensureKeyframes`, the seam the `@keyframes` block goes through.
- [`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts#L2808) —
  the `clipboard commands` block's `fakeView` helper and dispatch-spy assertions,
  the shape the new tests follow, plus the `cursor position` block
  ([:1542-1701](packages/lib/tests/component/code-editor.test.ts#L1542)) for
  driving a real `EditorState` through a duck-typed `_view`.
- [`packages/lib/tests/component/layout/Tab.lazy.test.ts`](packages/lib/tests/component/layout/Tab.lazy.test.ts#L329) —
  how a reduced-motion test stubs `DOM.source.matchMedia`.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *CSS writes go through `StyleRule` /
  `InlineStyle`* and *Defer DOM work to render time* (why the `@keyframes` block
  goes through `StyleRule.ensureKeyframes` rather than a raw stylesheet write).
- [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) — *Don't `{@link}` internal
  symbols from public JSDoc* (why `revealRange`'s JSDoc never names
  `revealHighlightField`).
- [`packages/lib/docs/components/CodeEditor.md`](packages/lib/docs/components/CodeEditor.md#L205) —
  the doc page the new section and table row land in.

---

## Non-Goals

- **No `revealRange` overload taking a raw document offset.** `getCursorPosition()`
  already reports an `offset`, but no consumer needs an offset-shaped reveal, and
  a second overload would double the clamping surface for no caller.
- **No "go to line" UI.** This plan adds an API, not a dialog. CodeMirror's own
  go-to-line panel is a separate feature with its own keybinding and chrome.
- **No timed auto-dismiss.** The highlight has no timer; it is superseded, not
  expired. Adding one later would be a behaviour change to an option, not a
  gap left open here.
- **No `MarkdownEditor` forwarding.** `MarkdownEditor` composes a `CodeEditor`
  but exposes its own surface; re-exposing a reveal across its two editing modes
  is a separate change.
- **No fix for `theme.ts`'s `.cm-selectionBackground` token.** The editor's
  selection colour reads `--ts-ui-indicator-selection` as a `background-color`
  ([theme.ts:59-61](packages/lib/src/typescript/lib/component/editor/theme.ts#L59)),
  but every built-in theme sets that token to a CSS *outline* shorthand, so the
  declaration is invalid and dropped. That is a real pre-existing bug, and it is
  part of why an unfocused selection reads so faintly — but it is a separate
  one-line change with its own visual review, and fixing it would not remove the
  need for this highlight.[^selection-token-bug]
- **No consumer migration.** The application that motivated this API reaches the
  live `EditorView` through the DOM today; switching it over to `revealRange` is
  work in that repository, not this one.[^consumer-followup]

---

## Notes

[^required-fields]: Making `column` and `length` optional (defaulting to 1 and 0)
    would turn `revealRange({ line: 42 })` into a "go to line" call. It was
    rejected on [CLAUDE.md](CLAUDE.md)'s *Simplicity First* rule — no
    configurability that wasn't asked for. Every known caller has all three
    values, and a caller that only has a line writes `column: 1, length: 0`,
    which is one keystroke rather than a second code path to document and test.

[^clamp-here]: `doc.line(n)` throws a `RangeError` for an out-of-range `n`, so
    without clamping a public library method would throw on stale input — and
    every consumer would have to write the same three `Math.min` calls
    defensively. The library owns the live document and the caller, by
    definition, does not: that is why the caller had to supply a line and column
    rather than an offset in the first place. There is precedent inside the same
    class:
    [`applyFormatted`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1252)
    clamps the formatter's reported cursor offset with
    `Math.min(cursorOffset, formatted.length)` rather than trusting it, and has a
    test block of its own for the clamp.

[^single-line]: A match reported as a line, a column and a length comes from a
    line-oriented search, so a length running past the line's end means the
    caller's copy of that line was longer than the live one — the exact staleness
    the clamp exists for. Letting the range spill onto the next line would
    highlight text that has nothing to do with the target. Capping at `line.to`
    matches what the motivating consumer already does by hand.

[^selection-token-bug]: `theme.ts` sets
    `".cm-selectionBackground": { backgroundColor: "var(--ts-ui-indicator-selection, …)" }`,
    but `docs/concepts/theming.md` documents that token as a "Complete CSS
    outline shorthand", and `ClassicTheme` / `ModernTheme` / `DarkTheme` all set
    it to `'1px dashed rgb(120, 170, 240)'`. A CSS parser drops
    `background-color: 1px dashed rgb(...)` as invalid, so the editor falls back
    to CodeMirror's own base-theme selection colours — a light purple when
    focused, plain grey when not. `theme.ts`'s own `.cm-searchMatch` comment
    already warns about exactly this ("that token's real, actively consumed shape
    is a dashed *outline* shorthand … so it is invalid as a `background-color`
    source"), which is how the mistake was spotted. Fixing it is out of scope
    here (see `## Non-Goals`) and worth raising separately.

[^persist]: A timed fade — the highlight disappearing after a second or so
    regardless of what the user does — was the alternative. It was rejected for
    the case the feature exists to serve: a user arrowing through a results list
    reads the surrounding code for several seconds per hit, and a highlight that
    has already vanished by then leaves them with only the faint selection the
    feature was built to replace. Superseding is also cheaper and safer: no
    timer to cancel on teardown, no race between a pending clear and the next
    reveal, and no way for a stale timer to fire against a destroyed view.
    Treating a `focus: false` preview differently from a `focus: true` commit was
    considered and rejected too — it would mean two behaviours to document and
    test for one method, and the supersede rule already gives the preview case
    what it needs, since arrowing to the next hit fires the next `revealRange`.

[^css-animation]: The other candidate was
    [`flashReadOnly`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2357)'s
    approach: `Animation.play(handle, { from, to, durationMs, properties })`.
    `Animation.play` takes a `Handle` — a live element the framework's DOM seam
    already owns — and `flashReadOnly` can supply one because
    [`mountFlashOverlay`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2281)
    creates that overlay `<div>` itself and tracks it. A decoration's rendered
    `<span>` is created by CodeMirror on its own render pass, so driving it the
    same way would mean dispatching the transaction, waiting a frame, querying
    the span back out of the view's DOM, interning it as a `Handle`, and coping
    with CodeMirror re-rendering or discarding that span mid-animation (it does
    exactly that when the range scrolls out of the viewport). A CSS class needs
    none of that: the class name travels with the decoration, and the browser
    runs the animation whenever and wherever CodeMirror renders the span. The
    framework has four existing keyframe call sites for this kind of
    class-driven animation (`TabButton`, `Glyph`, `ProgressBar`,
    `ProgressSpinner`), so this is the established pattern rather than a new one.
    Declaring the `@keyframes` block inside `EditorView.theme`'s style spec was
    also possible — CodeMirror's `style-mod` passes `@`-prefixed keys through
    unprefixed — but was rejected because `codeEditorTheme(dark)` is re-invoked
    on every theme toggle, so the block would be re-inserted each time, and it
    would bypass the framework's own idempotent `ensureKeyframes` seam.

[^own-class]: Reusing the literal `cm-searchMatch cm-searchMatch-selected`
    classes was rejected on ownership: `@codemirror/search` sets and clears those
    classes itself from its own query state, so a reveal wearing them would be
    indistinguishable from — and could be visually contradicted by — a live
    `Ctrl-F` result. The colour is nonetheless identical, because the meaning is
    identical: both mark "the one match you are looking at". The `ts-ui-` prefix
    rather than `cm-` follows the framework's own class naming (`ts-ui-component`,
    `ts-ui-trait-*`, and every keyframe name) and keeps the `cm-*` namespace to
    CodeMirror, so a future CodeMirror release adding its own `.cm-reveal*` class
    cannot collide.

[^consumer-followup]: The gap this plan closes was found in a downstream
    application whose project-wide search panel reaches the live `EditorView`
    through the component's DOM id and dispatches a selection transaction itself,
    documented there as a sanctioned workaround. Replacing that workaround with a
    `revealRange` call is a consumer-side follow-up, tracked in that repository.
    One conversion detail worth recording: that consumer's own match type reports
    a **0-based** column, so its call site adds one when building the
    `CodeEditorRevealTarget`. This plan does not adopt the 0-based convention,
    because `CodeEditorCursorPosition` — the same class's existing line/column
    surface — is 1-based on both fields, and a class publishing two conflicting
    column conventions would be worse than one conversion at one call site.

---

## Implementation Notes

- **All twelve `## Expected Behaviour` › *Manual verification only* cases were
  driven live** via `npm run dev` (port 8015) against a real Chrome instance
  (chrome-devtools MCP), using the dev app's **CodeEditor** section and its new
  Reveal / Preview buttons, and inspected through both the accessibility-tree
  snapshot and `document.querySelectorAll('.ts-ui-cm-reveal')` /
  `getComputedStyle` reads rather than screenshots alone:
  1. **Reveal** selected `parts` on line 12 (`Ln 12, Col 10 · Pos 305` — the
     head, at `column + length`), moved focus into the editor, and painted
     `class="ts-ui-cm-reveal ts-ui-cm-reveal-flash"` over it. This is the case
     `## Potential Challenges` calls out as the one that would catch
     `view.focus()` clearing the highlight it just set — it did not.
  2. **Preview** selected `message` on line 2, left `document.activeElement`
     on the Preview button (confirmed via the a11y snapshot showing it
     `focusable focused`), and still painted the highlight.
  3. Reveal → Preview → Reveal left exactly one `.ts-ui-cm-reveal` element at
     each step (never two), moving from `parts` to `message` and back.
  4. Clicking inside the document (on the editor's textbox) dropped the
     highlight count to 0.
  5. With the caret in the document (via a direct `.cm-content.focus()`,
     which — like `view.focus()` — dispatches no transaction and left the
     highlight in place) pressing `ArrowRight` dropped the count to 0.
  6. Typing a character after re-arming Preview dropped the count to 0 (and
     set `Dirty: yes`, confirming the keystroke actually reached the
     document).
  7. Dispatching a `wheel` event at the scroller left the count at 1,
     unchanged.
  8. Cycling the Misc panel's theme button to the dark theme left the count
     at 1 and changed the mark's computed `background-color` from
     `color(srgb 0.117647 0.392157 0.784314 / 0.25)` (light) — recolouring
     with the rest of the editor via `--ts-ui-indicator-focus` as designed.
  9. With `window.matchMedia` patched so `(prefers-reduced-motion: reduce)`
     reports `matches: true`, **Reveal**'s mark class was `ts-ui-cm-reveal`
     with no `-flash` suffix, still present at the resting tint.
  10. With the floating search panel open on `greet` (2 matches, away from
      the `parts` target), a **Reveal** left both `.cm-searchMatch` (15%
      tint) and `.ts-ui-cm-reveal` (25% tint) present simultaneously — same
      hue, distinct strengths, both legible, confirmed by both a screenshot
      and the two elements' computed backgrounds.
  11. Switching to the four-line **CSS** sample then pressing **Reveal**
      (still targeting line 12) landed the caret at `Ln 5, Col 1` — the end
      of the sample's last (blank) line — with 0 `.ts-ui-cm-reveal` elements
      and no console error (`list_console_messages` was empty across every
      navigation in the session).
  12. Shrinking the viewport to 900×400 (so the editor's `.cm-scroller` had
      `scrollHeight` 517 against a `clientHeight` of 77) and scrolling to the
      bottom (`scrollTop` 440, putting line 12 off-screen), then pressing
      **Reveal**, moved `scrollTop` to 216 and brought the `parts` mark's
      bounding rect fully inside the scroller's — confirmed geometrically,
      not just by absence of error.

  The mutations these cases made to the dev app's in-memory document
  (case 6's typed character; the theme left on dark) live only in the
  browser tab, which was closed afterward; `git status` in the worktree
  stayed clean throughout, and the dev server was stopped at the end of the
  session.
