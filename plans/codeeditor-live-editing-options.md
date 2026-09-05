---
depends-on: [codeeditor-codemirror-feature-expansion]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/src/typescript/CodeEditorPanel.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# CodeEditor Live-Editing Options — Implementation Plan

## Overview

This plan adds three options to
[`CodeEditor`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L209),
the CodeMirror 6 wrapper component: `tabSize`, `lineNumbers`, and
`spellcheck`. Each controls a runtime-toggleable aspect of the *live* editor:

- `tabSize` sets how many columns wide a literal tab renders, and how many
  columns one Tab keypress or auto-indent inserts. It sets two CodeMirror
  facets together — `EditorState.tabSize` and `indentUnit` — the same
  combined "Tab Size" semantics VS Code's `editor.tabSize` uses.
- `lineNumbers` shows or hides the line-number gutter, on by default (the
  editor already renders it unconditionally today).
- `spellcheck` turns the browser's native spellcheck UI on or off inside the
  editor, off by default (code identifiers are not English words, so the
  browser's spellchecker produces constant noise unless a consumer — e.g.
  `MarkdownEditor`'s prose source view — opts back in).

All three follow the exact shape of the four sibling options `CodeEditor`
already has — `lineWrap`, `placeholder`, `highlightWhitespace`, `lint` —
each cached in `applyOptions` and backed by its own `Compartment`,
reconfigured live when a view exists. `tabSize` and `spellcheck` add a new
compartment; `lineNumbers` moves an extension CodeMirror already installs
unconditionally into a compartment so it can be turned off.

Those four sibling options, and the `CodeEditorPanel` demo shape this plan
extends, do not exist on `master` yet — they ship in the still-unmerged
`plans/codeeditor-codemirror-feature-expansion.md`. This plan's `depends-on`
frontmatter blocks it from starting until that one is implemented; see
*This plan depends on the still-unmerged CodeMirror feature-expansion plan*
below.

---

## Architecture Decisions

### Follows the placeholder Compartment pattern exactly

`tabSize` is added the same way `placeholder` was: an optional field on
`CodeEditorOptions`, cached in `applyOptions`, a private `_tabSizeCompartment`,
and `getTabSize()` / `setTabSize()` that cache the value unconditionally and
reconfigure the compartment only when `this._view` exists — matching
`getPlaceholder()` / `setPlaceholder()`
([CodeEditor.ts:597-616](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L597))
in the branch this plan depends on. `placeholder`, not `lineWrap` /
`highlightWhitespace` / `lint`, is the precedent to copy: those three are
booleans defaulting to `false`, but `tabSize` is a number with no natural
"off" value, so it needs `placeholder`'s nullable shape instead — see
*`tabSize` is a nullable number, not a boolean-default option* below.
`lineNumbers` and `spellcheck` follow the boolean-default shape instead —
see their own decisions below.

### Sets `EditorState.tabSize` and `indentUnit` together, in one compartment

`setTabSize` reconfigures `_tabSizeCompartment` to
`[EditorState.tabSize.of(size), indentUnit.of(" ".repeat(size))]` — two
extensions in one compartment, the same shape
`_whitespaceCompartment` already uses for
`[highlightWhitespace(), highlightTrailingWhitespace()]`
([CodeEditor.ts:640-643](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L640)).
This pairing was verified against the installed CodeMirror packages, not
assumed: both facets pick their first (highest-precedence) value and fall
back to a built-in default when nothing sets them (`EditorState.tabSize`
defaults to `4`; `indentUnit` defaults to two spaces), no built-in language
grammar sets either facet, and CodeMirror's own indent commands
(`indentMore`/`indentLess`, bound through `indentWithTab`) and its
`indentOnInput()` re-indent service both read `indentUnit` directly — so one
compartment holding both facets is sufficient, with no third mechanism to
wire up and no per-language override to guard against.[^facet-verification]

`indentUnit` is imported from `@codemirror/language` — `CodeEditor.ts` already
imports from that package
([CodeEditor.ts:18](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L18))
— and `EditorState` (from `@codemirror/state`) is already imported
([CodeEditor.ts:15](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L15)),
so no new package dependency is added.

No `theme.ts` change is needed. CodeMirror sets the CSS `tab-size` (or
`-moz-tab-size`) property on the editor's content element itself, driven
directly by the live `state.tabSize`, with no theming or stylesheet
involvement — confirmed by reading `@codemirror/view`'s compiled source
rather than assumed.[^theme-check]

### `tabSize` is a nullable number, not a boolean-default option

`getTabSize()` returns `number | null` (`null` when unset), and
`setTabSize(size: number | null)` clears the option back to CodeMirror's own
defaults when passed `null` — the same round-trip
`getPlaceholder()`/`setPlaceholder(null)` already has
([CodeEditor.ts:608-616](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L608)).
A boolean-default shape like `lineWrap`'s (`?? false`) has no sensible value
for a "how wide" setting, so it is not used here.[^nullable-shape]

### No runtime validation of `size`

`setTabSize` does not check that `size` is a positive integer. This matches
`autoHeightMinRows` / `autoHeightMaxRows`
([CodeEditor.ts:74-82](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L74)),
whose own constraint ("should not exceed `autoHeightMaxRows`") is documented
in a JSDoc comment, not enforced in code. `tabSize`'s JSDoc documents the same
way: the value should be a positive integer.[^no-validation]

### `lineNumbers` wraps the existing unconditional gutter in a compartment

`mount()`'s static extension array already installs `lineNumbers()`
unconditionally
([CodeEditor.ts:1022](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1022)).
This plan moves that single line into a new `_lineNumbersCompartment`,
seeded with `lineNumbers()` when the option is on and `[]` when it's off, so
a consumer building a minimal or read-focused embedding can turn the gutter
off at runtime — the same "static extension becomes a compartment" move
`readOnly`/`lineWrap`/etc. already made for their own extensions. Nothing
else reads or depends on `lineNumbers()`'s presence: `highlightActiveLineGutter()`
([CodeEditor.ts:1024](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1024))
and `foldGutter()`
([CodeEditor.ts:1028](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1028))
are separate, independently-installed gutter extensions, so hiding the line-number
gutter leaves the active-line and fold gutters untouched.

### `lineNumbers` defaults to `true` — the getter still folds cleanly

`lineNumbers` is `CodeEditorOptions`'s first boolean option whose *unset*
default is `true` — `lineWrap`/`highlightWhitespace`/`lint`/`readOnly` all
default `false`. The getter is still the same one-line shape:
`this._options.lineNumbers ?? true`, mirroring `getReadOnly()`'s
`this._options.readOnly ?? false`
([CodeEditor.ts:543-545](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L543))
with the fallback literal flipped. This was verified against
[ARCHITECTURE.md](ARCHITECTURE.md)'s *Class-level defaults must survive the
getter* trap rather than assumed symmetrical — that trap fires when a
default lives in a `_default<Name>Options` bag but a getter's own hardcoded
fallback disagrees with it, silently dropping the seeded default. It does
not apply here: `_defaultCodeEditorOptions`
([CodeEditor.ts:100-112](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L100))
sets only `overflow`, never `lineNumbers`, so `?? true` in the getter is the
*only* place the default lives — there is no second, disagreeing source of
truth to drift from. This is exactly the shape the other four booleans
already have (their `?? false` fallback is also the sole source of their
default), so `lineNumbers` needs no `clearLineNumbers()`-style "unset"
tracking either: unlike `tabSize`/`placeholder`, a plain boolean has no
distinct "unset, defaults to true" state to preserve — `setLineNumbers(true)`
and leaving it unset are indistinguishable and behave identically, so there
is nothing for a third state to mean.[^line-numbers-default-true]

### `spellcheck` sets `EditorView.contentAttributes`, alongside existing contributors

`setSpellcheck` reconfigures a new `_spellcheckCompartment` to
`EditorView.contentAttributes.of({ spellcheck: spellcheck ? "true" : "false" })`
— always installed, with the string value tracking the option, so an
explicit `"false"` overrides the browser's own default rather than merely
omitting the attribute. `EditorView.contentAttributes` is a multi-source
`Facet` (`Facet<AttrSource, readonly AttrSource[]>`) that CodeMirror's view
layer combines per attribute key, not a single-value slot — and it already
has live contributors in this file before this plan touches it:
`crosshairCursor()` (always installed) contributes a `style` value, and
`_lineWrapCompartment`'s `EditorView.lineWrapping` and `_placeholderCompartment`'s
placeholder extension contribute `class` and `aria-placeholder` respectively,
whenever those options are on. `spellcheck` is a key none of the three
existing contributors write, so it combines into the facet as a fourth,
independent entry with no overwrite risk — verified against
`@codemirror/view`'s compiled combine logic, not assumed.[^spellcheck-combine]

`spellcheck` is a browser-native, per-editor DOM attribute — CodeMirror's own
lint/diagnostics extension (`getLint()`/`setLint()`) is unrelated and also
renders as a squiggly underline, which the docs call out explicitly (see
*Documentation Impact*) so the two are not conflated.

`MarkdownEditor`'s source view constructs its internal `CodeEditor` with
`language: "markdown"` and a fixed options bag
([MarkdownEditor.ts:362-366](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L362))
— exactly the case where a consumer would want `spellcheck: true`, since
that view is prose rather than code. This plan does not wire `MarkdownEditor`
to it; see *Non-Goals*.

### No auto-height shape-tuple change for `tabSize` or `spellcheck`; `lineNumbers` shares `tabSize`'s accepted gap

Neither `tabSize` nor `spellcheck` is added to `_lastSyncedShape`
([CodeEditor.ts:303](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L303)).
Tab width does not change line height in the general case, and `spellcheck`
sets a DOM attribute that changes no element's geometry at all, so neither
affects `syncAutoHeight`. `lineNumbers` is different: toggling the gutter
changes how much of `.cm-scroller`'s width is left for `.cm-content`, which
can shift where a wrapped line breaks — see *Potential Challenges* for the
narrow case this affects, which this plan accepts rather than fixes, the
same call already made for `tabSize`'s own literal-tab case.

### This plan depends on the still-unmerged CodeMirror feature-expansion plan

`master`'s `CodeEditor.ts` has only three compartments today —
`_langCompartment`, `_readOnlyCompartment`, `_themeCompartment` — and no
`lineWrap` / `placeholder` / `highlightWhitespace` / `lint` options; `master`'s
`LanguageRegistry.ts` has `FormatOptions` but no `loadLintSource`; and
`master`'s `CodeEditorPanel.ts` is the single-toolbar demo, not the two-editor
layout this plan's steps extend. All of that lands only once
`plans/codeeditor-codemirror-feature-expansion.md` — currently sitting on the
unmerged `feature/codeeditor-codemirror-feature-expansion` branch, not yet in
`plans/implemented/` on `master` — is implemented and merged.[^dependency]
`lineNumbers` and `spellcheck` share this dependency for the same reason
`tabSize` does: both mirror the same sibling-option pattern (compartment +
cached accessor pair) that pattern only exists on that branch today, and
`spellcheck`'s combine-safety argument above rests on `_lineWrapCompartment`
and `_placeholderCompartment`, which are also only on that branch.

Every file:line citation in this plan (e.g. `CodeEditor.ts:597-616`) refers to
that branch's current content, which is the concrete, verified shape this
plan builds on — not a guess at what the merge will look like. `/implement`
will not start this plan until `codeeditor-codemirror-feature-expansion` is in
`plans/implemented/`, per this plan's `depends-on` frontmatter.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/editor/CodeEditor.ts

export interface CodeEditorOptions extends ComponentOptions {
    // ... existing fields unchanged ...

    /**
     * Tab-stop width, in columns: how wide a literal tab character renders,
     * and how many columns one Tab keypress or auto-indent inserts. Sets
     * CodeMirror's `EditorState.tabSize` and `indentUnit` facets together, so
     * rendered tab stops and Tab-key / auto-indent width agree — the same
     * combined "Tab Size" setting most editors (e.g. VS Code's
     * `editor.tabSize`) use. Unset: CodeMirror's own defaults apply
     * untouched (4-column tab stops, a 2-space indent unit). Should be a
     * positive integer; not validated at runtime.
     *
     * Distinct from `FormatOptions.indentWidth` (see `LanguageRegistry.ts`),
     * which only shapes `format()`'s one-shot reformat output and has no
     * effect on live, interactive editing.
     */
    tabSize?: number;

    /** Whether the line-number gutter is shown. Default `true`. */
    lineNumbers?: boolean;

    /**
     * Whether the browser's native spellcheck runs inside the editor.
     * Default `false` — code identifiers are not English words, so the
     * browser's spellchecker produces constant false-positive squiggles
     * unless a consumer opts back in (e.g. `MarkdownEditor`'s prose source
     * view). Sets the DOM `spellcheck` attribute only; distinct from
     * `lint`, CodeMirror's own parser-error diagnostics, which also render
     * as a squiggly underline but come from the grammar, not the browser.
     */
    spellcheck?: boolean;
}

class CodeEditor extends Component<CodeEditorOptions> {
    getTabSize(): number | null;
    setTabSize(size: number | null): this;

    getLineNumbers(): boolean;
    setLineNumbers(show: boolean): this;

    getSpellcheck(): boolean;
    setSpellcheck(spellcheck: boolean): this;
}
```

Backing fields: all three are cached in `this._options` (the options-bag
convention in [ARCHITECTURE.md](ARCHITECTURE.md)) — `tabSize` matching
`placeholder`'s nullable shape, `lineNumbers`/`spellcheck` matching
`lineWrap`'s plain-boolean shape. No private normalising field is needed for
any of them. Compartment fields: `_tabSizeCompartment`,
`_lineNumbersCompartment`, `_spellcheckCompartment`.

---

## Internal Structure

`getTabSize()` / `setTabSize()`, matching `getPlaceholder()` /
`setPlaceholder()`'s exact shape:

```typescript
/**
 * Returns the current tab-stop width, in columns.
 *
 * @returns The configured tabSize, or `null` when unset (CodeMirror's own
 *   defaults apply: 4-column tab stops, a 2-space indent unit).
 */
getTabSize(): number | null {
    return this._options.tabSize ?? null;
}

/**
 * Sets (or clears) the tab-stop width, in columns. Caches the value; when a
 * view is mounted, also reconfigures the tab-size compartment, setting
 * CodeMirror's `EditorState.tabSize` and `indentUnit` facets together so
 * rendered tab stops and Tab-key / auto-indent width agree.
 *
 * @param size - The tab-stop width in columns (should be a positive
 *   integer), or `null` to clear it and fall back to CodeMirror's own
 *   defaults.
 * @returns This component, for method chaining.
 */
setTabSize(size: number | null): this {
    this._options.tabSize = size ?? undefined;

    if (this._view) {
        this._view.dispatch({
            effects: this._tabSizeCompartment.reconfigure(
                size !== null ? [EditorState.tabSize.of(size), indentUnit.of(" ".repeat(size))] : []),
        });
    }

    return this;
}
```

`getLineNumbers()` / `setLineNumbers()`, matching `getLineWrap()` /
`setLineWrap()`'s exact shape
([CodeEditor.ts:570-590](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L570)),
with the fallback literal flipped to `true`:

```typescript
/**
 * Returns whether the line-number gutter is currently shown.
 *
 * @returns The lineNumbers state.
 */
getLineNumbers(): boolean {
    return this._options.lineNumbers ?? true;
}

/**
 * Sets whether the line-number gutter is shown. Caches the state; when a
 * view is mounted, also reconfigures the line-numbers compartment.
 *
 * @param show - Whether the gutter should be shown.
 * @returns This component, for method chaining.
 */
setLineNumbers(show: boolean): this {
    this._options.lineNumbers = show;

    if (this._view) {
        this._view.dispatch({ effects: this._lineNumbersCompartment.reconfigure(show ? lineNumbers() : []) });
    }

    return this;
}
```

`getSpellcheck()` / `setSpellcheck()`, same shape again, reconfiguring the
`contentAttributes` compartment:

```typescript
/**
 * Returns whether the browser's native spellcheck currently runs inside the
 * editor.
 *
 * @returns The spellcheck state.
 */
getSpellcheck(): boolean {
    return this._options.spellcheck ?? false;
}

/**
 * Sets whether the browser's native spellcheck runs inside the editor.
 * Caches the state; when a view is mounted, also reconfigures the
 * spellcheck compartment, setting the DOM `spellcheck` attribute.
 *
 * @param spellcheck - Whether the browser's spellcheck should run.
 * @returns This component, for method chaining.
 */
setSpellcheck(spellcheck: boolean): this {
    this._options.spellcheck = spellcheck;

    if (this._view) {
        this._view.dispatch({
            effects: this._spellcheckCompartment.reconfigure(
                EditorView.contentAttributes.of({ spellcheck: spellcheck ? "true" : "false" })),
        });
    }

    return this;
}
```

`mount()`'s extension array registers each compartment's initial state next
to the other option compartments:

```typescript
this._tabSizeCompartment.of(
    this.getTabSize() !== null
        ? [EditorState.tabSize.of(this.getTabSize()!), indentUnit.of(" ".repeat(this.getTabSize()!))]
        : []),
this._lineNumbersCompartment.of(this.getLineNumbers() ? lineNumbers() : []),
this._spellcheckCompartment.of(
    EditorView.contentAttributes.of({ spellcheck: this.getSpellcheck() ? "true" : "false" })),
```

The standalone `lineNumbers(),` line already in the array
([CodeEditor.ts:1022](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1022))
is removed — `_lineNumbersCompartment.of(...)` above replaces it.

Worked example — the combined effect of a few `tabSize` values on a document
line starting with one literal tab character (`\t`), followed by `x`:

| `tabSize` | Rendered column `x` lands on | Spaces one Tab keypress inserts |
|---|---|---|
| unset | 4 (CodeMirror's own default) | 2 (CodeMirror's own default) |
| `2` | 2 | 2 |
| `4` | 4 | 4 |
| `8` | 8 | 8 |

Worked example — the DOM state of the editor's content element for a few
`lineNumbers` / `spellcheck` combinations:

| `lineNumbers` | `spellcheck` | Gutter shown | `.cm-content`'s `spellcheck` attribute |
|---|---|---|---|
| unset (default) | unset (default) | yes | `"false"` |
| `false` | `true` | no | `"true"` |
| `true` | `false` | yes | `"false"` |

---

## Ordered Implementation Steps

Throughout, `TEST` means
`npm -w packages/lib exec -- vitest run tests/component/code-editor.test.ts`.

1. Confirm the dependency has landed: `git log --oneline -1 --
   plans/implemented/codeeditor-codemirror-feature-expansion.md` on `master`
   returns a commit, and
   `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` already
   has `_lintCompartment` and `getPlaceholder()`. If either check fails, stop
   — this plan's dependency has not actually merged yet.
2. `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — add
   `indentUnit` to the existing `@codemirror/language` import
   ([CodeEditor.ts:18](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L18)).
   `lineNumbers` (from `@codemirror/view`) and `EditorView` are already
   imported ([CodeEditor.ts:11](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L11)),
   so `lineNumbers` and `spellcheck` need no import changes.
3. Same file — add the `tabSize` field to `CodeEditorOptions`, right after
   `lint`
   ([CodeEditor.ts:90](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L90)),
   with the JSDoc from `## Public API`.
4. Same file — cache it in `applyOptions`, right after the `lint` line
   ([CodeEditor.ts:384](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L384)):
   `if (options.tabSize !== undefined) this._options.tabSize = options.tabSize;`.
5. Same file — add
   `private readonly _tabSizeCompartment: Compartment = new Compartment();`
   right after `_lintCompartment`
   ([CodeEditor.ts:240](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L240)),
   with a doc comment matching the others: `/** Reconfigured by {@link
   CodeEditor.setTabSize}. */`.
6. Same file — add `getTabSize()` / `setTabSize()` right after `getLint()` /
   `setLint()`
   ([CodeEditor.ts:654-675](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L654)),
   exactly as given in `## Internal Structure`.
   *Check:* `npm -w packages/lib run typecheck`.
7. Same file — in `mount()`'s extension array, add the
   `this._tabSizeCompartment.of(...)` line right after
   `this._lintCompartment.of([])`
   ([CodeEditor.ts:1054](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1054)),
   exactly as given in `## Internal Structure`.
   *Check:* `TEST` — every existing test still passes unedited (no existing
   test touches the new compartment).
8. Same file — add the `lineNumbers` and `spellcheck` fields to
   `CodeEditorOptions`, right after `tabSize` (added in step 3), with the
   JSDoc from `## Public API`.
9. Same file — cache both in `applyOptions`, right after the `tabSize` line
   (added in step 4):
   `if (options.lineNumbers !== undefined) this._options.lineNumbers = options.lineNumbers;`
   and
   `if (options.spellcheck !== undefined) this._options.spellcheck = options.spellcheck;`.
10. Same file — add `_lineNumbersCompartment` and `_spellcheckCompartment`,
    right after `_tabSizeCompartment` (added in step 5), each with a doc
    comment matching the others (`/** Reconfigured by {@link
    CodeEditor.setLineNumbers}. */` / `setSpellcheck`).
11. Same file — add `getLineNumbers()` / `setLineNumbers()` and
    `getSpellcheck()` / `setSpellcheck()` right after `getTabSize()` /
    `setTabSize()` (added in step 6), exactly as given in
    `## Internal Structure`.
    *Check:* `npm -w packages/lib run typecheck`.
12. Same file — in `mount()`'s extension array: remove the standalone
    `lineNumbers(),` line
    ([CodeEditor.ts:1022](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1022));
    add `this._lineNumbersCompartment.of(...)` right after the
    `this._tabSizeCompartment.of(...)` line (added in step 7); add
    `this._spellcheckCompartment.of(...)` right after that — exactly as given
    in `## Internal Structure`.
    *Check:* `grep -n "^\s*lineNumbers(),$"
    packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — expect
    zero matches (the bare call is gone; `lineNumbers` is still imported and
    used, now only inside `setLineNumbers`/`mount()`'s compartment seed).
    Then `TEST` — every existing test still passes unedited.
13. `packages/lib/tests/component/code-editor.test.ts` — add
    `describe('CodeEditor tabSize', ...)`, `describe('CodeEditor
    lineNumbers', ...)`, and `describe('CodeEditor spellcheck', ...)` blocks,
    in that order, after the `'CodeEditor lint'` block (ends at
    [code-editor.test.ts:1434](packages/lib/tests/component/code-editor.test.ts#L1434)),
    with the cases from `## Expected Behaviour` › *Unit-testable*. `tabSize`
    matches the `'CodeEditor placeholder'` block's structure
    ([code-editor.test.ts:1335-1357](packages/lib/tests/component/code-editor.test.ts#L1335));
    `lineNumbers` and `spellcheck` match `'CodeEditor highlightWhitespace'`'s
    structure
    ([code-editor.test.ts:1359-1378](packages/lib/tests/component/code-editor.test.ts#L1359)).
    *Check:* `TEST`.
14. `packages/lib/src/typescript/CodeEditorPanel.ts` — add manual-verify
    handles for all three options on the upper (main) editor's toolbar, in
    this order: Lint, Tab size, Line numbers, Spellcheck, Save. `tabSize`'s
    handle:
    - Add `private readonly _tabSizeBtn: Button;` next to `_lintBtn`
      ([CodeEditorPanel.ts:95](packages/lib/src/typescript/CodeEditorPanel.ts#L95)).
    - Construct it next to `_lintBtn`
      ([CodeEditorPanel.ts:123-124](packages/lib/src/typescript/CodeEditorPanel.ts#L123)):
      `this._tabSizeBtn = new Button({ text: 'Tab size: 4' });` and
      `this._tabSizeBtn.on('action', () => this.toggleTabSize());`.
    - Add it to `upperToolbar`, right after `this._lintBtn`
      ([CodeEditorPanel.ts:135](packages/lib/src/typescript/CodeEditorPanel.ts#L135)):
      `upperToolbar.addComponent(this._tabSizeBtn);`.
    - Add a `toggleTabSize()` private method next to `toggleLint()`
      ([CodeEditorPanel.ts:209-214](packages/lib/src/typescript/CodeEditorPanel.ts#L209)):
      ```typescript
      private toggleTabSize(): void {
          // Cycles through three presets. Unset (CodeMirror's own default,
          // effectively 4) folds into the 4 slot, so the cycle always lands on
          // one of the three shown values instead of a fourth ambiguous
          // "unset" step.
          const TAB_SIZE_PRESETS = [2, 4, 8];
          const current = this._editor.getTabSize() ?? 4;
          const next = TAB_SIZE_PRESETS[(TAB_SIZE_PRESETS.indexOf(current) + 1) % TAB_SIZE_PRESETS.length];

          this._editor.setTabSize(next);
          this._tabSizeBtn.setText(`Tab size: ${next}`);
      }
      ```
    `lineNumbers`'s handle, following the same shape as `_tabSizeBtn` above
    but placed right after it:
    - Add `private readonly _lineNumbersBtn: Button;` next to `_tabSizeBtn`.
    - Construct it next to `_tabSizeBtn`:
      `this._lineNumbersBtn = new Button({ text: 'Line numbers: on' });` (the
      button's initial label reflects the default-on state) and
      `this._lineNumbersBtn.on('action', () => this.toggleLineNumbers());`.
    - Add it to `upperToolbar`, right after `this._tabSizeBtn`:
      `upperToolbar.addComponent(this._lineNumbersBtn);`.
    - Add a `toggleLineNumbers()` private method next to `toggleTabSize()`:
      ```typescript
      private toggleLineNumbers(): void {
          const show = !this._editor.getLineNumbers();

          this._editor.setLineNumbers(show);
          this._lineNumbersBtn.setText(show ? 'Line numbers: on' : 'Line numbers: off');
      }
      ```
    `spellcheck`'s handle, same shape again, placed right after
    `_lineNumbersBtn`:
    - Add `private readonly _spellcheckBtn: Button;` next to `_lineNumbersBtn`.
    - Construct it next to `_lineNumbersBtn`:
      `this._spellcheckBtn = new Button({ text: 'Spellcheck: off' });` and
      `this._spellcheckBtn.on('action', () => this.toggleSpellcheck());`.
    - Add it to `upperToolbar`, right after `this._lineNumbersBtn`:
      `upperToolbar.addComponent(this._spellcheckBtn);`.
    - Add a `toggleSpellcheck()` private method next to `toggleLineNumbers()`:
      ```typescript
      private toggleSpellcheck(): void {
          const spellcheck = !this._editor.getSpellcheck();

          this._editor.setSpellcheck(spellcheck);
          this._spellcheckBtn.setText(spellcheck ? 'Spellcheck: on' : 'Spellcheck: off');
      }
      ```
    In `SAMPLE_JS`
    ([CodeEditorPanel.ts:10-27](packages/lib/src/typescript/CodeEditorPanel.ts#L10)),
    append two lines: the literal-tab line `tabSize`'s own manual-verify case
    needs, and a comment with a deliberately misspelled English word for
    `spellcheck`'s manual-verify case (an identifier like `greet` is a weak,
    inconsistent spellcheck trigger across browsers; a plain misspelled word
    in a comment is not):
    ```
    // A literal tab indents this line — Tab always inserts spaces
    // (indentUnit), so a literal tab can only get into this sample by being
    // seeded here directly. Cycling "Tab size" above changes how many
    // columns it lines up under.
    \tconsole.log("indented with a literal tab");

    // This comment has a delibrately misspelled word, for the Spellcheck button.
    ```
    (The `\t` is a template-literal escape — it becomes a real tab
    character in the string, not a literal backslash-t.)
    *Check:* `npm run dev`, open the **CodeEditor** section at
    `http://localhost:8015`:
    - Click "Tab size: 4" and confirm it cycles `8 → 2 → 4 → 8 → …`.
    - Click "Line numbers: on" and confirm the gutter disappears (button
      label flips to "Line numbers: off"); click again to confirm it returns.
    - Click "Spellcheck: off" and confirm "delibrately" gains a squiggly
      underline (button label flips to "Spellcheck: on"); click again to
      confirm the squiggle clears.
15. `packages/lib/docs/components/CodeEditor.md` — per `## Documentation
    Impact` below.
16. `packages/lib/docs/reference/changelog/next.md` — add the changelog entry
    from `## Documentation Impact` below.
    *Check:* `npm run docs:api` — 0 errors, 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/src/typescript/CodeEditorPanel.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Unit-testable (offline harness, `packages/lib/tests/component/code-editor.test.ts`)

Option caching — `tabSize` mirrors the `'CodeEditor placeholder'` block
exactly:

| Call | `getTabSize()` |
|---|---|
| `new CodeEditor()` | `null` |
| `new CodeEditor(undefined, { tabSize: 4 })` | `4` |
| `editor.setTabSize(2)` offline | `2`, no throw, no view |
| `editor.setTabSize(4)` then `editor.setTabSize(null)` | `null` |

`lineNumbers` mirrors `'CodeEditor highlightWhitespace'`'s block, with the
default flipped to `true`:

| Call | `getLineNumbers()` |
|---|---|
| `new CodeEditor()` | `true` |
| `new CodeEditor(undefined, { lineNumbers: false })` | `false` |
| `editor.setLineNumbers(false)` offline | `false`, no throw, no view |

`spellcheck` mirrors the same block, unchanged default:

| Call | `getSpellcheck()` |
|---|---|
| `new CodeEditor()` | `false` |
| `new CodeEditor(undefined, { spellcheck: true })` | `true` |
| `editor.setSpellcheck(true)` offline | `true`, no throw, no view |

### Manual verification only (live-only component; the offline sink never mounts a view)

Run in the dev app (`npm run dev`, `http://localhost:8015`, **CodeEditor**
section), in both light and dark themes:

- With the cursor on a blank line, pressing Tab inserts a number of spaces
  matching the current "Tab size" (2, 4, or 8 spaces after clicking the demo
  button; 2 spaces — CodeMirror's own default — before it's ever clicked).
- The sample's literal-tab line (`\tconsole.log(...)`, added in step 14)
  shifts to line up under a different column as "Tab size" is cycled —
  visible confirmation that the rendered tab stop, not just Tab-key
  insertion, tracks the option.
- Cycling "Tab size" takes effect immediately, with no reload and no visible
  flash or scroll jump.
- `format()` (the Format button) is unaffected by `tabSize` — it re-runs
  Prettier with its own `FormatOptions.indentWidth`/whatever default, not the
  live editor's tab size. (Weak signal: the two only visibly diverge if the
  document still differs from Prettier's output; skip if the sample is
  already Prettier-clean.)
- Clicking "Line numbers: on" hides the line-number gutter immediately, with
  no reload; the fold gutter's arrows and the active line's own highlighted
  gutter cell both stay visible and functional — toggling line numbers off
  does not disturb either.
- Clicking "Spellcheck: off" turns on the browser's native spellcheck
  squiggle under the sample comment's deliberately misspelled word (added in
  step 14). This is a weak signal: it depends on the browser's own
  spellchecker actually firing (some browsers only run it once a field has
  focus, and dictionaries vary), so treat a missing squiggle as inconclusive
  rather than a failure, and confirm instead that toggling the option changes
  the DOM `spellcheck` attribute on `.cm-content` via the browser devtools if
  the visual squiggle doesn't appear.

---

## Verification

- `npm -w packages/lib run typecheck` — clean.
- `TEST` (`npm -w packages/lib exec -- vitest run tests/component/code-editor.test.ts`)
  — full file green, every pre-existing case passing unedited.
- `npm run docs:api` — 0 errors, 0 link warnings.
- Manual smoke tests: every case in `## Expected Behaviour` › *Manual
  verification only*, in the dev app's **CodeEditor** section.

---

## Documentation Impact

**`packages/lib/docs/components/CodeEditor.md`.**

- Construction options table
  ([CodeEditor.md:32-42](packages/lib/docs/components/CodeEditor.md#L32))
  gains three rows:

  | Option | Type | Default | Purpose |
  |---|---|---|---|
  | `tabSize` | `number` | unset | Tab-stop width in columns — how wide a literal tab renders and how many columns Tab / auto-indent insert. Unset: CodeMirror's own defaults (4-column stops, 2-space indent unit). Distinct from `format()`'s `indentWidth` — see [Formatting options](#formatting-options). |
  | `lineNumbers` | `boolean` | `true` | Whether the line-number gutter is shown. |
  | `spellcheck` | `boolean` | `false` | Whether the browser's native spellcheck runs inside the editor. See [Spellcheck](#spellcheck). |

- Methods table
  ([CodeEditor.md:156-172](packages/lib/docs/components/CodeEditor.md#L156))
  gains three rows:

  | Method | Purpose |
  |---|---|
  | `getTabSize()` / `setTabSize(size)` | Read, set, or (`null`) clear the tab-stop width, in columns. |
  | `getLineNumbers()` / `setLineNumbers(show)` | Read or toggle whether the line-number gutter is shown. |
  | `getSpellcheck()` / `setSpellcheck(spellcheck)` | Read or toggle whether the browser's native spellcheck runs inside the editor. |

- **Formatting options** section
  ([CodeEditor.md:106-128](packages/lib/docs/components/CodeEditor.md#L106))
  gains one sentence after the `FormatOptions` field table: `FormatOptions.indentWidth`
  only shapes `format()`'s one-shot reformat output; it has no effect on the
  live editor. The separate, always-in-effect `tabSize` construction option
  controls live tab-stop rendering and Tab-key / auto-indent width — see
  [Construction](#construction).

- New **Spellcheck** section, placed right after **Linting**
  ([CodeEditor.md:178-181](packages/lib/docs/components/CodeEditor.md#L178),
  before **Autocompletion**), naming the distinction the task explicitly
  calls for:

  > Turning on [`spellcheck`](#construction) sets the browser's native
  > `spellcheck` attribute on the editor's content element, so the browser's
  > own spellchecker underlines words it doesn't recognize — the same
  > behaviour a plain `<textarea spellcheck>` has. This is unrelated to
  > [`lint`](#linting): lint's squiggles come from the active language's own
  > parser, flagging syntax errors, while spellcheck's squiggles come from
  > the browser, flagging words outside its dictionary. Both can render as a
  > similar-looking underline; only one is CodeMirror's own feature.

No other section needs a change: `theme.ts` is untouched (see *Architecture
Decisions*), no new event or export is added, and
`docs/components/index.md` / `scripts/llms/manifest.data.mjs`'s one-line
summaries ("highlighting, formatting, folding, search, …") describe the
component's scope at a level three more options don't change.

**`packages/lib/docs/reference/changelog/next.md`.** One bullet under
`## Changed` › `### Components`, matching the existing CodeMirror
feature-expansion bullet's voice — one bullet for all three options, since
they land in the same change:

> - **`CodeEditor` gains three options: `tabSize`, `lineNumbers`, and
>   `spellcheck`.** `tabSize` controls the live editor's tab-stop width — how
>   wide a literal tab renders and how many columns Tab / auto-indent insert
>   — by setting CodeMirror's `EditorState.tabSize` and `indentUnit` facets
>   together; unset (the default) leaves CodeMirror's own defaults in place.
>   `lineNumbers` (default `true`) toggles the line-number gutter.
>   `spellcheck` (default `false`) toggles the browser's native spellcheck
>   inside the editor — distinct from the existing `lint` diagnostics, which
>   come from the language's own parser, not the browser. New `getTabSize()`
>   / `setTabSize(size)`, `getLineNumbers()` / `setLineNumbers(show)`, and
>   `getSpellcheck()` / `setSpellcheck(spellcheck)` accessors. `tabSize` is
>   also distinct from the existing `FormatOptions.indentWidth`, which only
>   shapes `format()`'s one-shot reformat output. No consumer action is
>   needed.

**No new export.** `CodeEditorOptions` and `CodeEditor` are already exported
from `component/editor`'s barrel; three new fields and six new methods on
already-exported types need no `index.ts` change.

---

## Potential Challenges

- **A wrapped document containing a literal tab can change row count without
  moving `_lastSyncedShape`.** `tabSize` changes how many columns a tab
  consumes, which can shift where a long, tab-containing line wraps under
  `lineWrap`, changing rendered height with none of the shape tuple's five
  components moving — the same class of problem folding and wrapping
  themselves caused before they were added to the tuple. This is accepted,
  not fixed: it requires `autoHeightMaxRows`, `lineWrap`, and a literal tab in
  the content all at once, which is rare in practice (most code is
  space-indented), and widening the shape tuple again is out of proportion
  for this plan. If it surfaces, add `tabSize` as the tuple's sixth
  component, following the same pattern `foldedLines`/`wrapFlag` used.
- **Toggling `lineNumbers` while `lineWrap` is on can also change row count
  without moving `_lastSyncedShape`.** The shape tuple's `clientWidth`
  component is `.cm-scroller`'s own client width
  ([CodeEditor.ts:1339](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1339)),
  which does not change when the gutter is hidden — the scroller's outer box
  is unaffected. But hiding the gutter widens `.cm-content` inside that same
  box, which can shift a wrapped line's break point, changing the real
  rendered height (`syncAutoHeight` measures `.cm-content` directly via
  `measureContentExtent()`) with `clientWidth` unchanged. Same class of gap
  as the literal-tab case above, and accepted the same way: it requires
  `autoHeightMaxRows`, `lineWrap`, and a line that actually wraps
  differently at the two gutter widths, all at once.
- **`setTabSize` can throw once a view is mounted, for an invalid `size`.**
  `size <= 0` is not validated (see *No runtime validation of `size`*); `"
  ".repeat(size)` throws on a negative `size`, and CodeMirror's own
  `indentUnit` facet throws on an empty string (`size === 0`). Both only
  matter if a caller passes a value outside the documented "positive
  integer" contract.
- **This plan cannot start until its dependency actually merges to `master`.**
  Every citation here points at the unmerged
  `feature/codeeditor-codemirror-feature-expansion` branch's current content.
  If that branch's `CodeEditor.ts` changes further before merging (e.g. its
  own line numbers shift), re-verify the citations against `master` at the
  time this plan is implemented, per step 1's check.

`spellcheck` has no equivalent challenge: it sets a DOM attribute with no
effect on any element's size, so it cannot move `_lastSyncedShape` in any way.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) | Every code step edits it. `getPlaceholder`/`setPlaceholder` (L597-616) is the exact pattern `tabSize` copies; `getLineWrap`/`setLineWrap` (L570-590) is the exact pattern `lineNumbers`/`spellcheck` copy; `mount()`'s extension array (L1011-1076) is where every new compartment registers. |
| `plans/implemented/codeeditor-codemirror-feature-expansion.md` (currently `plans/codeeditor-codemirror-feature-expansion.md`, unmerged) | This plan's dependency — introduces every compartment/option this plan mirrors, and the two-toolbar `CodeEditorPanel` shape step 14 extends. Read before starting; re-verify it has actually landed on `master` (step 1). |
| [`packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts`](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts) | `FormatOptions.indentWidth` (L15) is the already-shipped, functionally distinct option this plan's `tabSize` docs must not be confused with. Not modified by this plan. |
| [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) | Its source view (L362-366) is the motivating case for `spellcheck` defaulting to consumer-configurable rather than always-off. Not modified by this plan — see *Non-Goals*. |
| [`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts) | `'CodeEditor placeholder'` (L1335-1357) is the exact test shape `tabSize` copies; `'CodeEditor highlightWhitespace'` (L1359-1378) is the exact shape `lineNumbers`/`spellcheck` copy. |
| [`packages/lib/src/typescript/CodeEditorPanel.ts`](packages/lib/src/typescript/CodeEditorPanel.ts) | The demo panel step 14 extends; `toggleLint()` (L209-214) is the closest existing button-handler shape. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | The typed-setter / options-bag / cache-then-reconfigure-if-mounted rules every option in this plan follows; *Class-level defaults must survive the getter* (L207-218) is what `lineNumbers`' `?? true` default was checked against. |

---

## Non-Goals

- **No live tabs-vs-spaces toggle.** `tabSize` only controls width, not
  whether indentation inserts tabs or spaces (`indentUnit` here is always a
  string of spaces). A tabs-vs-spaces toggle would conflate with the existing
  `FormatOptions.useTabs`, which governs `format()`'s output.
- **No `FormatOptions` / formatter-tier change.** `LanguageRegistry.ts` is not
  touched. `FormatOptions.indentWidth` keeps its current, separate meaning.
- **No broader indentation-configuration feature.** No per-language default
  `tabSize`, no config for how `indentOnInput()`'s re-indent decides depth
  beyond what `indentUnit` already drives, no new event.
- **No auto-height shape-tuple change.** See *Potential Challenges*.
- **No `MarkdownEditor` wiring.** `spellcheck` is added to `CodeEditor` only.
  Defaulting `MarkdownEditor`'s internal source-view editor to
  `spellcheck: true`, or exposing a passthrough option on `MarkdownEditorOptions`,
  is future work — `MarkdownEditor.ts` is not modified by this plan.
- **No dictionary or spellcheck-language configuration.** `spellcheck` is a
  plain on/off toggle over the browser's own `spellcheck` attribute; the
  browser's own dictionary/locale choice is untouched (no `lang` attribute
  management).

---

## Notes

[^facet-verification]: Checked against the installed packages
    (`@codemirror/state`, `@codemirror/language`, and every installed
    `@codemirror/lang-*` grammar). `EditorState.tabSize` is
    `Facet<number, number>`, combined as `values => values.length ?
    values[0] : 4`; `indentUnit` is `Facet<string, string>`, combined as
    `values => values.length ? values[0] : "  "` (and throws if the resulting
    string isn't made of one repeated whitespace character — `"
    ".repeat(size)` always satisfies this for a positive integer `size`).
    Both take the first-supplied value outright with no precedence conflict
    to resolve, because grepping every installed `@codemirror/lang-*`
    package's compiled output found no call to `indentUnit.of(...)` or
    `EditorState.tabSize.of(...)` — the only facet either governs; only
    `lang-markdown` even *reads* `indentUnit` (to check whether it's a tab),
    and does not set it. `@codemirror/commands`' `indentMore` / `indentLess`
    (bound via `indentWithTab`, already installed in `mount()`) and
    `@codemirror/language`'s `indentOnInput()` (also already installed) both
    read `state.facet(indentUnit)` / `getIndentUnit(state)` directly, so
    setting it is sufficient to change their behaviour — no separate command
    or keymap change is needed.

[^theme-check]: `@codemirror/view`'s compiled source
    (`EditorView`'s content-DOM style application) sets
    `` `${browser.tabSize}: ${this.state.tabSize}` `` as an inline style on
    the content element on every relevant state read — `browser.tabSize`
    resolves to `"tab-size"` or `"-moz-tab-size"` depending on browser
    support. This runs unconditionally, independent of `codeEditorTheme()`
    (`theme.ts`), which never sets `tabSize`/`tab-size` today and needs no new
    rule.

[^nullable-shape]: A boolean-default option (like `lineWrap`'s `?? false`)
    works because "off" is a real, meaningful state. `tabSize` has no such
    state — every value CodeMirror could use (its own default of 4, or any
    number a caller picks) is itself a valid tab size, so there's nothing for
    `false` to mean. `null` unambiguously means "let CodeMirror's own default
    stand," matching `getPlaceholder()` (`null` = no placeholder) and
    `getAutoHeightMaxRows()` (`null` = auto-height off) — the two other
    nullable, non-boolean `CodeEditorOptions` accessors.

[^no-validation]: Considered adding a guard (e.g. throwing or clamping on
    `size <= 0`). Rejected: no other numeric `CodeEditorOptions` field
    validates its input — `autoHeightMinRows` exceeding `autoHeightMaxRows`
    is documented as wrong but not checked — and the project's guidelines
    call out "no error handling for impossible scenarios." A caller passing a
    non-positive `tabSize` is exactly that: an impossible, self-inflicted
    misuse, not a case the component needs to defend against.

[^line-numbers-default-true]: `packages/lib/tests/component/default-options-fallback.test.ts`
    is the mechanical guard ARCHITECTURE.md's *Class-level defaults must
    survive the getter* section requires for a field whose default is seeded
    in a `_default<Name>Options` bag but read back through a getter that
    could disagree with it. `CodeEditor` has no row in that registry today —
    checked directly, not assumed — because none of its four existing
    boolean options (`lineWrap`, `highlightWhitespace`, `lint`, `readOnly`)
    are seeded there either; each one's `?? false` fallback is its only
    default. `lineNumbers` follows the identical shape with `?? true`, so it
    needs no row either. The registry exists for a *different* failure mode
    (a getter's hardcoded fallback silently dropping a separately-seeded
    class default) that no boolean `CodeEditorOptions` field is exposed to,
    regardless of which literal the fallback resolves to.

[^spellcheck-combine]: `@codemirror/view`'s compiled source defines
    `contentAttributes` as `Facet.define()` with no custom combine function,
    so CodeMirror falls back to its own attribute-merge logic
    (`attrsFromFacet`/`combineAttrs`): each facet source is applied to a
    shared object in array order, and for any key other than `class` (values
    concatenated with a space) or `style` (values concatenated with `;`),
    a later-applied source's value for that key wins outright — a plain
    overwrite, not a merge. `EditorView.lineWrapping` (used by
    `_lineWrapCompartment`) is itself defined as
    `EditorView.contentAttributes.of({ class: "cm-lineWrapping" })`, and
    `placeholder()`'s extension (used by `_placeholderCompartment`)
    contributes `EditorView.contentAttributes.of({ "aria-placeholder": content })`
    — both already-live, already-compartmentized contributors to this same
    facet, confirming compartmentized `contentAttributes` contributors
    already coexist safely in this file. `crosshairCursor()` (always
    installed) contributes a `style` value the same way. None of the three
    ever writes a `spellcheck` key, so the new compartment's contribution
    cannot be overwritten by, or overwrite, any of them — verified by reading
    the compiled source, not assumed from the type signature alone.

[^dependency]: Verified directly, not assumed. On `master`
    (commit `e2662b08` at the time this plan was drafted),
    `CodeEditor.ts` has exactly three `Compartment` fields
    (`_langCompartment`, `_readOnlyCompartment`, `_themeCompartment`) and no
    `getPlaceholder`/`getLint`/etc. `plans/codeeditor-codemirror-feature-
    expansion.md` exists on `master` at the top level of `plans/`, not in
    `plans/implemented/`. `git log --all` shows a commit ("Move
    codeeditor-codemirror-feature-expansion plan to implemented") that does
    move it there, but that commit sits on the separate, unmerged
    `feature/codeeditor-codemirror-feature-expansion` branch
    (`git merge-base --is-ancestor` against `master`'s HEAD returns false).
    That branch's worktree has the full four-option `CodeEditor.ts`, the
    `loadLintSource`-bearing `LanguageRegistry.ts`, and the two-toolbar
    `CodeEditorPanel.ts` this plan's citations describe.
