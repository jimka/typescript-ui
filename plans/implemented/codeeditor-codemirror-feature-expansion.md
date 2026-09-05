---
touches-shared:
  - packages/lib/package.json
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts
  - packages/lib/src/typescript/lib/component/editor/languages.ts
  - packages/lib/src/typescript/lib/component/editor/theme.ts
  - packages/lib/src/typescript/lib/component/editor/index.ts
  - packages/lib/src/typescript/CodeEditorPanel.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# CodeEditor CodeMirror Feature Expansion — Implementation Plan

## Overview

[`CodeEditor`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L186)
wraps CodeMirror 6 but installs only a small slice of it: history, the default
keymap, `drawSelection`, line numbers, active-line highlighting, indent-on-input
and bracket matching
([CodeEditor.ts:751-789](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L751)).
This plan adds the rest of CodeMirror's mainstream editing surface in five
phases: code folding and line wrapping, the remaining editing ergonomics plus
two new languages, the search panel, syntax-only linting, and keyword
autocompletion.

Four new options land on `CodeEditorOptions` (`lineWrap`, `placeholder`,
`highlightWhitespace`, `lint`); everything else is installed unconditionally.
`LanguageDefinition`
([LanguageRegistry.ts:28-37](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts#L28))
gains one optional field, `loadLintSource`, mirroring its existing
`loadFormatter`. `codeEditorTheme`
([theme.ts:39](packages/lib/src/typescript/lib/component/editor/theme.ts#L39))
gains rules for every new surface CodeMirror renders — the search panel, the
completion tooltip, the fold gutter, the lint markers and tooltip, the
placeholder, and the whitespace marks — all read from the same project tokens
its existing chrome block uses.

The riskiest change is not any of the extensions — it is
[`syncAutoHeight`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L928).
It derives the editor's height from `perLineHeight × doc.lines`, a model that
folding and wrapping both break, and it gates every height change on a
three-element shape tuple that neither folding nor wrapping moves. Phase 1
replaces the height model with a direct measurement of the rendered content
extent and widens the shape tuple. No later phase changes auto-height again.

---

## Architecture Decisions

### The documented "no IntelliSense" scope is deliberately narrowed, not dropped

`CodeEditor`'s class `@remarks`
([CodeEditor.ts:154-162](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L154))
and [CodeEditor.md:3](packages/lib/docs/components/CodeEditor.md#L3) both say the
editor omits autocomplete and lint entirely. After this plan, two bounded forms
of both are in scope: diagnostics derived only from the parser's own error
nodes, and completions drawn only from each grammar's own keyword/snippet
tables. Cross-file symbols, type information, hovers, go-to-definition, real
LSP, and collaborative editing all stay out.[^scope-wording]

### Auto-height measures the rendered content extent

`naturalContentHeight` stops being `perLineHeight × doc.lines + padding` and
becomes the distance from `.cm-content`'s top to the bottom of its **last
element child**, plus the document's bottom padding. That measurement is correct
under folding, under wrapping, and under CodeMirror's viewport virtualisation,
and it keeps the property the current formula was chosen for: it carries no
memory of the box's own committed height, so the editor can still shrink.[^extent]

### The shape tuple gains a fold count and a wrap flag

`_lastSyncedShape`
([CodeEditor.ts:265](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L265))
grows from `[lines, docLength, clientWidth]` to
`[lines, docLength, clientWidth, foldedLines, wrapFlag]`. Folding and toggling
wrap both change the rendered height without touching any of the first three, so
without this the resulting shrink or growth would be rejected as a self-triggered
geometry echo and the box would keep its old height forever.[^tuple]

| Action | Old tuple | New tuple | Height change trusted? |
|---|---|---|---|
| Type a character | `[4, 80, 500]` → `[4, 81, 500]` | `[4, 80, 500, 0, 0]` → `[4, 81, 500, 0, 0]` | yes, before and after |
| Fold a 6-line block | `[40, 900, 500]` → `[40, 900, 500]` | `[40, 900, 500, 0, 0]` → `[40, 900, 500, 5, 0]` | **no** before, yes after |
| `setLineWrap(true)` | `[4, 80, 500]` → `[4, 80, 500]` | `[4, 80, 500, 0, 0]` → `[4, 80, 500, 0, 1]` | **no** before, yes after |
| CodeMirror geometry echo | unchanged | unchanged | no, before and after |

The fold count is not read inside `syncAutoHeight`. The update listener in
`mount()` computes it and stores it on a `_foldedLines` field, which
`syncAutoHeight` then reads as a plain number.[^fold-field]

### Each runtime-toggleable extension gets its own `Compartment`

`lineWrap`, `placeholder`, `highlightWhitespace` and `lint` each get a private
`Compartment`, following the three already on the class — `_langCompartment`,
`_readOnlyCompartment`, `_themeCompartment`
([CodeEditor.ts:199-205](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L199)).
Everything with no runtime toggle (folding, search, autocompletion, the
selection ergonomics) goes into the static extension array in `mount()`.

### Lint sources are a new optional `LanguageDefinition` field

`LanguageDefinition` gains `loadLintSource?: () => Promise<LintSource>`, an exact
structural mirror of its existing `loadFormatter`
([LanguageRegistry.ts:36](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts#L36)):
optional, lazily loaded, resolved through `getLanguage(id)`, and simply absent
for a language that has none. `LintSource` takes an `EditorState` rather than
CodeMirror's `EditorView`, so a source is DOM-free and unit-testable; the editor
adapts it to what `linter()` wants.[^lint-shape]

### Completion sources come from each grammar, not from the registry

No `loadCompletionSource` field is added. Every built-in grammar except JSON
already publishes its own completion source through CodeMirror's language-data
facet, so `autocompletion()` finds them with no registry involvement; JSON gets
a three-word keyword list attached inside its own `loadExtension`, using the same
language-data idiom a consumer would use for a custom grammar.[^completion-source]

### Comment toggling needs no change

`Mod-/` (`toggleComment`) and `Alt-A` (`toggleBlockComment`) are already members
of `defaultKeymap`, which `mount()` already installs. Comment toggling works
today; no keymap entry is added for it.[^comments]

### `completionKeymap` is not added by hand

`autocompletion()` installs `completionKeymap` itself, at `Prec.highest`. Adding
it again to the editor's own `keymap.of([...])` array would be redundant and
would bind the same keys at a lower precedence. `closeBracketsKeymap` is *not*
self-installing and must be added.[^keymaps]

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/editor/CodeEditor.ts

export interface CodeEditorOptions extends ComponentOptions {
    // ... existing fields unchanged ...

    /** Whether long lines wrap instead of scrolling horizontally. Default `false`. */
    lineWrap?: boolean;
    /** Text shown in an empty document. Unset: nothing is shown. */
    placeholder?: string;
    /** Whether spaces, tabs and trailing whitespace are rendered visibly. Default `false`. */
    highlightWhitespace?: boolean;
    /** Whether parser-error diagnostics are shown. Default `false`; inert for a language with no lint source. */
    lint?: boolean;
}

class CodeEditor extends Component<CodeEditorOptions> {
    getLineWrap(): boolean;
    setLineWrap(wrap: boolean): this;

    getPlaceholder(): string | null;
    setPlaceholder(text: string | null): this;

    getHighlightWhitespace(): boolean;
    setHighlightWhitespace(highlight: boolean): this;

    getLint(): boolean;
    setLint(lint: boolean): this;
}
```

```typescript
// packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts

/**
 * Produces parser-level diagnostics for a document state. Takes an
 * `EditorState`, not a view, so a source is DOM-free.
 */
export type LintSource = (state: EditorState) => Diagnostic[] | Promise<Diagnostic[]>;

export interface LanguageDefinition {
    // ... existing fields unchanged ...

    /** Dynamically imports and builds this language's lint source, when one exists. */
    loadLintSource?: () => Promise<LintSource>;
}
```

```typescript
// packages/lib/src/typescript/lib/component/editor/syntaxDiagnostics.ts  (new)

/**
 * Walks the parse tree for error nodes and reports each as an `"error"`
 * diagnostic. Syntax only — it knows nothing about names, types or other files.
 */
export function collectSyntaxErrors(state: EditorState): Diagnostic[];
```

Backing fields: `lineWrap` / `placeholder` / `highlightWhitespace` / `lint` are
cached in `this._options` (the default shape in
[ARCHITECTURE.md](ARCHITECTURE.md), *Three non-negotiable rules for every DOM
write*) — no private normalising field is needed. Each has a matching
`Compartment` field: `_lineWrapCompartment`, `_placeholderCompartment`,
`_whitespaceCompartment`, `_lintCompartment`.

`setPlaceholder(null)` stores `undefined` on the options bag and reconfigures its
compartment to `[]`, so `getPlaceholder()` reads back `null` — the same
`?? undefined` / `?? null` pairing `setLanguage` / `getLanguage` already use
([CodeEditor.ts:397-412](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L397)).

---

## Internal Structure

### The reworked height measurement

```typescript
/** `.cm-content`'s last element child — the last rendered line, gap, or widget. */
const CM_LAST_BLOCK_SELECTOR = ":scope > :last-child";

/**
 * The document's true rendered height: `.cm-content`'s top to its last child's
 * bottom, plus the document's bottom padding. Immune to `.cm-content`'s
 * `min-height: 100%` because that stretch trails *after* the last child.
 * Returns `null` when nothing is resolvable, so the caller can fall back.
 */
private measureContentExtent(): number | null {
    if (!this._contentElement || !this._view) {
        return null;
    }

    const lastBlock = DOM.source.querySelector(this._contentElement, CM_LAST_BLOCK_SELECTOR);

    if (!lastBlock) {
        return null;
    }

    const contentTop  = DOM.source.getElementRect(this._contentElement).top;
    const blockBottom = DOM.source.getElementRect(lastBlock).bottom;

    return blockBottom - contentTop + this._view.documentPadding.bottom;
}
```

`syncAutoHeight` then reads:

```typescript
const naturalContentHeight = this.measureContentExtent()
    ?? (perRowHeight * this._view.state.doc.lines + padding);
```

and `perRowHeight` replaces today's `perLineHeight`:

```typescript
// A `.cm-line` is exactly one row tall only while wrapping is off. With
// wrapping on it is as tall as the rows it wraps to, so the per-row unit
// comes from CodeMirror's own default line height instead.
const perRowHeight = this.getLineWrap() && this._view.defaultLineHeight > 0
    ? this._view.defaultLineHeight
    : (lineElement ? DOM.source.getElementRect(lineElement).height
                   : (metrics.scrollHeight - padding) / this._view.state.doc.lines);
```

Everything else in `syncAutoHeight` — the growth and shrink trust gates, the
horizontal-scrollbar reserve, the fractional-undershoot correction, the
`pureSelectionChange` rejection — stays exactly as it is. All four already exist
in the method and each carries its own comment explaining the live failure it
was written for; do not restate, relocate or "simplify" any of them.

### The fold count

```typescript
/** Document lines currently hidden inside folded ranges. */
private _foldedLines = 0;

/**
 * Counts the document lines hidden by folds. Pure over the state — no DOM,
 * no view — so it is directly unit-testable against a real `EditorState`.
 */
private countFoldedLines(state: EditorState): number {
    let hidden = 0;

    foldedRanges(state).between(0, state.doc.length, (from, to) => {
        hidden += state.doc.lineAt(to).number - state.doc.lineAt(from).number;
    });

    return hidden;
}
```

The update listener in `mount()` refreshes `_foldedLines` before it calls
`syncAutoHeight`.

### The syntax-error walker

`collectSyntaxErrors` walks `syntaxTree(state).cursor()` and emits one
diagnostic per error node, merging a node that starts exactly where the previous
one ended, and stopping at `MAX_SYNTAX_DIAGNOSTICS = 100`:

| Error nodes found (`from`–`to`) | Emitted diagnostics |
|---|---|
| `10–12` | `{ from: 10, to: 12, message: "Unexpected input" }` |
| `10–12`, `12–14` | `{ from: 10, to: 14, message: "Unexpected input" }` (merged) |
| `25–25` (zero length, at EOF) | `{ from: 25, to: 25, message: "Missing input" }` |
| `10–12`, `40–41` | both, unmerged |
| 250 nodes | the first 100 |

Every diagnostic carries `severity: "error"`. A `syntaxTree` that is incomplete
(CodeMirror's parse budget on a very large document) simply yields fewer
diagnostics; that is not treated as an error.

---

## Ordered Implementation Steps

Phases run in order. Phase 1 must land before phase 2 (both touch the extension
array and phase 2's options reuse phase 1's compartment shape). Phases 3, 4 and 5
are independent of each other and of phase 2 — in particular **phase 5 shares no
code with phase 4**: completions come from grammar language data, not from the
syntax-tree walker.

Throughout, `TEST` means
`npm -w packages/lib exec -- vitest run tests/component/code-editor.test.ts`.

### Phase 1 — Auto-height rework, folding, line wrapping

1. `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — add
   `lineWrap` to `CodeEditorOptions`, cache it in `applyOptions`
   ([CodeEditor.ts:325](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L325))
   with the existing `if (options.X !== undefined) this._options.X = options.X;`
   shape, add `_lineWrapCompartment`, `getLineWrap()`, `setLineWrap()`, and
   register `this._lineWrapCompartment.of(this.getLineWrap() ? EditorView.lineWrapping : [])`
   in `mount()`'s extension array. `setLineWrap` follows `setReadOnly`
   ([CodeEditor.ts:455](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L455))
   exactly: cache, then reconfigure only when `this._view` exists.
   *Check:* `npm -w packages/lib run typecheck`.
2. Same file — add `CM_LAST_BLOCK_SELECTOR = ":scope > :last-child"` next to the
   existing `CM_LINE_SELECTOR`
   ([CodeEditor.ts:105](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L105)),
   then add the private `measureContentExtent()` method exactly as given in
   `## Internal Structure`.
3. Same file — in `syncAutoHeight`
   ([CodeEditor.ts:928](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L928)),
   rename the local `perLineHeight` to `perRowHeight`, give it the wrap-aware
   form from `## Internal Structure`, and replace the `naturalContentHeight`
   assignment ([CodeEditor.ts:984](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L984))
   with the `measureContentExtent() ?? …` form. Leave `capPx`, `floorPx` and
   every guard below untouched.
   *Check:* `TEST` — every existing `syncAutoHeight` test still passes unedited
   (none seeds a `:scope > :last-child` result, so they take the documented
   fallback and produce today's numbers).
4. Same file — add `private _foldedLines = 0;` and the private
   `countFoldedLines(state)` method; import `foldedRanges` from
   `@codemirror/language` alongside the existing `indentOnInput` import
   ([CodeEditor.ts:14](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L14)).
5. Same file — widen `_lastSyncedShape`
   ([CodeEditor.ts:265](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L265))
   to `readonly [number, number, number, number, number] | null`, and build the
   tuple ([CodeEditor.ts:992](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L992))
   as `[doc.lines, doc.length, metrics.clientWidth, this._foldedLines,
   this.getLineWrap() ? 1 : 0]`. Update the field's doc comment to name all five
   components.
6. Same file — in `mount()`'s `updateListener`
   ([CodeEditor.ts:770](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L770)),
   set `this._foldedLines = this.countFoldedLines(update.state);` before the
   `heightChanged || geometryChanged` branch.
7. Same file — add `codeFolding()` and `foldGutter()` to the static extension
   array, and `...foldKeymap` into the existing `keymap.of([...])` array
   ([CodeEditor.ts:760](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L760)),
   placed **before** `indentWithTab` so that entry keeps the precedence its
   comment claims.
8. `packages/lib/src/typescript/lib/component/editor/theme.ts` — add
   `.cm-foldGutter .cm-gutterElement` and `.cm-foldPlaceholder` rules (token
   mapping in `## Expected Behaviour`).
9. `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — raise the
   flash overlay's `zIndex` from `"300"` to `"400"`
   ([CodeEditor.ts:1207](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1207))
   and extend its comment to mention CodeMirror's panels, which also sit at 300.
10. `packages/lib/tests/component/code-editor.test.ts` — add the phase-1
    unit cases from `## Expected Behaviour`: `lineWrap` option caching,
    `countFoldedLines`, `measureContentExtent`, and the three shape-tuple trust
    cases.
    *Check:* `TEST`.
11. `packages/lib/src/typescript/CodeEditorPanel.ts` — add a `Wrap: off` toggle
    button next to the existing read-only toggle
    ([CodeEditorPanel.ts:51](packages/lib/src/typescript/CodeEditorPanel.ts#L51)),
    and extend `SAMPLE_JS` with a foldable multi-line function body, so both
    phase-1 features have a manual-verify handle.
    *Check:* `npm run dev`, open the **CodeEditor** section at
    `http://localhost:8015`.

### Phase 2 — Remaining editing ergonomics, two new languages

12. `packages/lib/package.json` — add `@codemirror/lang-css` and
    `@codemirror/lang-python` to `dependencies`
    ([package.json:176-205](packages/lib/package.json#L176)) via
    `npm install -w packages/lib @codemirror/lang-css@^6.3.1 @codemirror/lang-python`.
    `@codemirror/lang-css@6.3.1` is already resolved in the lockfile as a
    transitive dependency, so pinning that range must not move the tree.
    *Check:* `npm ls @codemirror/lang-css` reports one entry, still `6.3.1`.
13. `packages/lib/src/typescript/lib/component/editor/languages.ts` — register
    `css` (grammar `@codemirror/lang-css`, formatter Prettier's `css` parser via
    `prettier/plugins/postcss`) and `python` (grammar `@codemirror/lang-python`,
    no formatter), following the five existing blocks
    ([languages.ts:24-77](packages/lib/src/typescript/lib/component/editor/languages.ts#L24)).
14. `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — add
    `placeholder` and `highlightWhitespace` to `CodeEditorOptions`, cache both in
    `applyOptions`, add `_placeholderCompartment` / `_whitespaceCompartment`
    plus their four accessors, and register both compartments in the extension
    array. The whitespace compartment holds
    `[highlightWhitespace(), highlightTrailingWhitespace()]` when on, `[]` when
    off.
15. Same file — add `highlightSpecialChars()`, `dropCursor()`,
    `rectangularSelection()`, `crosshairCursor()` and
    `EditorState.allowMultipleSelections.of(true)` to the static extension array.
16. `packages/lib/src/typescript/lib/component/editor/theme.ts` — add
    `.cm-placeholder`, `.cm-specialChar`, `.cm-highlightSpace`, `.cm-highlightTab`
    and `.cm-trailingSpace` rules.
17. `packages/lib/tests/component/code-editor.test.ts` — add the `placeholder` /
    `highlightWhitespace` option-caching cases and extend the built-in-language
    list assertion ([code-editor.test.ts:50-54](packages/lib/tests/component/code-editor.test.ts#L50))
    to include `css` and `python`.
    *Check:* `TEST` and `npm -w packages/lib run typecheck`.

### Phase 3 — Search panel

18. `packages/lib/package.json` — add `@codemirror/search@^6.7.1` (already
    resolved transitively at that version).
19. `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — add
    `search()` and `highlightSelectionMatches()` to the static extension array,
    and `...searchKeymap` into the `keymap.of([...])` array before
    `indentWithTab`.
20. `packages/lib/src/typescript/lib/component/editor/theme.ts` — add the panel
    rules: `.cm-panels`, `.cm-panels-top`, `.cm-panels-bottom`, `.cm-textfield`,
    `.cm-button`, `.cm-button:hover`, `.cm-button:active`, `.cm-searchMatch`,
    `.cm-searchMatch.cm-searchMatch-selected`, `.cm-selectionMatch` (token
    mapping in `## Expected Behaviour`).
    *Check:* dev app, **CodeEditor** section, Ctrl-F in both light and dark
    themes.

### Phase 4 — Syntax-only lint

21. `packages/lib/package.json` — add `@codemirror/lint@^6.9.7` (already
    resolved transitively at that version).
22. Create
    `packages/lib/src/typescript/lib/component/editor/syntaxDiagnostics.ts` with
    `collectSyntaxErrors` and the `MAX_SYNTAX_DIAGNOSTICS` constant, per
    `## Internal Structure`.
23. `packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts` — add
    the exported `LintSource` type and the optional `loadLintSource` field on
    `LanguageDefinition`, documented in the same voice as `loadFormatter`.
24. `packages/lib/src/typescript/lib/component/editor/languages.ts` — give
    `javascript`, `json`, `html`, `css`, `python` and `sql` a
    `loadLintSource: async () => collectSyntaxErrors`. **Do not** give `markdown`
    one — its grammar never produces error nodes.
25. `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — add the
    `lint` option, its accessors, `_lintCompartment`, and a private
    `refreshLint()` that mirrors `setLanguage`'s async stale-guard
    ([CodeEditor.ts:430-434](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L430)):
    resolve `getLanguage(id)?.loadLintSource`, then reconfigure only if
    `this._view` still exists, `getLint()` is still true, and `getLanguage()`
    still equals the id the load started for. `setLint()` and `setLanguage()`
    each call `refreshLint()` when `this._view` exists, and only cache
    otherwise. `mount()` registers `this._lintCompartment.of([])` and needs no
    `refreshLint()` call of its own: an editor mounted with a language already
    runs `setLanguage(language)`
    ([CodeEditor.ts:857-861](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L857)),
    and one mounted without a language has nothing to lint, so `[]` is already
    right. The compartment's contents are `[linter((view) => source(view.state)),
    lintGutter()]`, or `[]` when lint is off or the language has no source.
26. `packages/lib/src/typescript/lib/component/editor/index.ts` — export
    `collectSyntaxErrors` and the `LintSource` type.
27. `packages/lib/src/typescript/lib/component/editor/theme.ts` — add
    `.cm-lintRange-error` (replace CodeMirror's fixed-colour squiggle image with a
    token-coloured `text-decoration: underline wavy`), `.cm-diagnostic-error`,
    `.cm-diagnosticSource` and `.cm-tooltip-lint .cm-diagnostic` rules. Leave the
    gutter marker glyphs at CodeMirror's defaults.[^markers]
28. `packages/lib/tests/component/code-editor.test.ts` — add the
    `collectSyntaxErrors` cases and the `loadLintSource` registry-shape cases
    from `## Expected Behaviour`.
    *Check:* `TEST`.
29. `packages/lib/src/typescript/CodeEditorPanel.ts` — add a `Lint: off` toggle
    button.
    *Check:* dev app, type `)))` into the JavaScript sample with lint on (not
    `function (`: phase 5's `closeBrackets()` auto-inserts the matching `)`
    as it's typed, and `function ()` parses with no error node — a bare `)`
    has no opening counterpart for `closeBrackets()` to pair, so `)))`
    inserts literally and produces three real error nodes).

### Phase 5 — Keyword autocompletion

30. `packages/lib/package.json` — add `@codemirror/autocomplete@^6.20.3`
    (already resolved transitively at that version).
31. `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — add
    `autocompletion()` and `closeBrackets()` to the static extension array, and
    `...closeBracketsKeymap` into the `keymap.of([...])` array before
    `indentWithTab`. Do **not** add `completionKeymap`.
32. `packages/lib/src/typescript/lib/component/editor/languages.ts` — in the
    `json` entry's `loadExtension`, return
    `[json(), jsonLanguage.data.of({ autocomplete: completeFromList(["true", "false", "null"]) })]`.
    Leave the other six entries alone — their grammars publish their own sources.
33. `packages/lib/src/typescript/lib/component/editor/theme.ts` — add
    `.cm-tooltip.cm-tooltip-autocomplete`,
    `.cm-tooltip-autocomplete > ul > li`,
    `.cm-tooltip-autocomplete > ul > li:hover`,
    `.cm-tooltip-autocomplete > ul > li[aria-selected]`,
    `.cm-completionMatchedText`, `.cm-completionDetail` and
    `.cm-completionIcon` rules.
    *Check:* dev app, type `gree` in the JavaScript sample (not `docu`:
    `@codemirror/lang-javascript`'s `localCompletionSource` only offers
    keywords and locally-scoped bindings, not DOM globals like `document` —
    `gree` matches the sample's own top-level `greet` function).

### Documentation and closeout

34. `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — rewrite the
    class `@remarks` scope sentence
    ([CodeEditor.ts:154-156](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L154))
    per `## Documentation Impact`.
35. `packages/lib/docs/components/CodeEditor.md` — update the scope paragraph,
    the options table, the language table, the "Registering a language" example,
    the keyboard section, the methods table and the theming section; add a
    **Linting** and an **Autocompletion** section.
36. `packages/lib/docs/components/index.md:89` and
    `packages/lib/scripts/llms/manifest.data.mjs:101` — update the one-line task
    description, then run `npm run docs:llms`.
    *Check:* `git diff packages/lib/llms.txt` shows only the CodeEditor row.
37. `packages/lib/docs/reference/changelog/next.md` — add the new options, the
    two new languages, the new `LanguageDefinition` field and the new exports
    under **Changed › Components**.
    *Check:* `npm run docs:api` — 0 errors, 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/syntaxDiagnostics.ts` |
| Modify | `packages/lib/package.json` |
| Modify | `package-lock.json` (regenerated by `npm install`) |
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/languages.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/theme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/index.ts` |
| Modify | `packages/lib/src/typescript/CodeEditorPanel.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/components/index.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/scripts/llms/manifest.data.mjs` |
| Modify | `packages/lib/llms.txt` (generated — via `npm run docs:llms`) |

---

## Expected Behaviour

### Unit-testable (offline harness, `packages/lib/tests/component/code-editor.test.ts`)

Option caching — one case per new option, matching the existing
`setReadOnly / getReadOnly round-trip` tests:

| Call | `getX()` |
|---|---|
| `new CodeEditor()` | `getLineWrap()` → `false`, `getPlaceholder()` → `null`, `getHighlightWhitespace()` → `false`, `getLint()` → `false` |
| `new CodeEditor(undefined, { lineWrap: true, placeholder: "Type…", highlightWhitespace: true, lint: true })` | `true`, `"Type…"`, `true`, `true` |
| `editor.setLineWrap(true)` offline | `getLineWrap()` → `true`, no throw, no view |
| `editor.setPlaceholder(null)` after `setPlaceholder("x")` | `getPlaceholder()` → `null` |

`countFoldedLines` — pure over a real `EditorState` built in the test with
`codeFolding()` and a `foldEffect` dispatched onto it:

- No folds → `0`.
- One fold spanning lines 3–8 → `5`.
- Two disjoint folds spanning 5 and 2 lines → `7`.

`collectSyntaxErrors` — pure over a real `EditorState` built with
`@codemirror/lang-json`:

- `{"a": 1}` → `[]`.
- `{"a": }` → at least one diagnostic, every entry `severity: "error"`.
- `""` (empty document) → `[]`.
- Adjacent error nodes merge, per the table in `## Internal Structure`.
- A document producing more than 100 error nodes → exactly 100 diagnostics.

`syncAutoHeight` shape tuple — driven the way the existing tests drive it, with a
stubbed `_view` and mocked `DOM.source`:

- With `_foldedLines` changed between two calls and every other input held
  constant, a smaller measured extent **is** committed (fold shrinks the box).
- With `lineWrap` toggled between two calls and every other input held constant,
  a larger measured extent **is** committed.
- With all five components held constant, a larger measured extent is **not**
  committed (today's echo guard, unchanged).

`measureContentExtent` — with `setQuerySelectorResult(':scope > :last-child', …)`
seeded, `getElementRect` mocked per handle, and the horizontal-scrollbar reserve
and undershoot correction neutralised the way the existing *per-line measurement*
tests neutralise them
([code-editor.test.ts:1187-1200](packages/lib/tests/component/code-editor.test.ts#L1187)):

- Content top `0`, last-child bottom `100`, `documentPadding.bottom` `4` →
  committed height `104`, whatever `doc.lines` says.
- No seeded last child → falls back to `perRowHeight × doc.lines + padding`,
  reproducing today's numbers exactly.

`LanguageDefinition` registry shape:

- A definition registered with `loadLintSource` round-trips through
  `getLanguage(id)` with the field intact.
- A definition registered without it has `loadLintSource === undefined`, and the
  editor installs no linter for it.
- `listLanguages()` includes `css` and `python` after the barrel import.

### Manual verification only (live-only component; the offline sink never mounts a view)

Run in the dev app (`npm run dev`, `http://localhost:8015`, **CodeEditor**
section) unless noted, in **both** light and dark themes.

**Phase 1.**
- Folding a multi-line block via the gutter arrow collapses it, and the editor's
  committed box height shrinks to match the collapsed content — no blank band
  below the last visible line. Unfolding restores the previous height exactly.
- `Ctrl-Shift-[` / `Ctrl-Shift-]` fold and unfold at the cursor.
- With `Wrap: on`, a line longer than the box wraps, the horizontal scrollbar
  disappears, and the box grows to fit the wrapped rows without drifting upward
  over the following seconds. Toggling back restores the original height.
- Narrowing the window with wrap on re-flows and re-fits the height.
- The docs app's fenced code blocks (`npm run docs:dev`, any page with a fenced
  block) still size correctly and show a fold gutter.

**Phase 2.**
- `placeholder` text appears in an empty editor and vanishes on the first
  keystroke.
- `highlightWhitespace: true` renders visible space/tab marks; trailing
  whitespace is tinted.
- Alt-click adds a second cursor; typing edits at both. Alt-drag selects a
  rectangle. Holding Alt shows the crosshair cursor. Dragging text shows the drop
  cursor.
- Selecting `css` and `python` highlights correctly; `format()` reformats CSS and
  re-indents Python.

**Phase 3.**
- Ctrl-F (Cmd-F on macOS) opens the search panel at the bottom of the editor;
  Escape closes it. Panel background, input and buttons read as project chrome,
  not as CodeMirror's grey default, in both themes.
- Matches highlight; the current match is distinguishable from the others.
- Selecting a word highlights its other occurrences.
- With `autoHeightMaxRows` set, opening the panel does not change the committed
  box height and does not start a height drift.[^panel-height]

**Phase 4.**
- With `Lint: on` and the JavaScript sample, typing `)))` shows a gutter
  marker and a wavy underline; hovering the marker shows a themed tooltip.
  (Not `function (`: phase 5's `closeBrackets()` auto-inserts the matching
  `)`, and the resulting `function ()` parses with no error node.)
- Fixing the syntax clears both.
- With `Lint: on` and a Markdown document, nothing ever appears.
- Switching language while lint is on swaps the diagnostics without leaving stale
  markers.

**Phase 5.**
- Typing `gree` in the JavaScript sample (matching the sample's own top-level
  `greet` function — not `docu`: `localCompletionSource` only offers keywords
  and locally-scoped bindings, not DOM globals like `document`) opens the
  completion tooltip; ArrowDown/Enter accepts. The tooltip matches project
  chrome in both themes.
- Typing `{` inserts `{}` with the caret between; Backspace over the pair deletes
  both.
- Ctrl-Space opens completions explicitly.
- In a JSON document, typing `t` at a value position offers `true`.

### Theme token mapping

The rules added to
[theme.ts](packages/lib/src/typescript/lib/component/editor/theme.ts) use the
project's existing tokens, each with a light/dark-safe fallback, matching how the
existing `chrome` block is written
([theme.ts:40-65](packages/lib/src/typescript/lib/component/editor/theme.ts#L40)):

| Selector | Tokens |
|---|---|
| `.cm-panels` | `--ts-ui-toolbar-bg`, `--ts-ui-text-color` |
| `.cm-panels-top` / `.cm-panels-bottom` | `--ts-ui-toolbar-border` |
| `.cm-textfield` | `--ts-ui-input-bg`, `--ts-ui-text-color`, `--ts-ui-input-border`, `--ts-ui-border-radius`, `--ts-ui-font-family`, `--ts-ui-font-size` |
| `.cm-button` (+ `:hover`, `:active`) | `--ts-ui-button-bg`, `--ts-ui-button-border`, `--ts-ui-button-hover-bg`, `--ts-ui-button-pressed-bg`, `--ts-ui-border-radius` |
| `.cm-searchMatch` | `--ts-ui-indicator-selection` at reduced opacity |
| `.cm-searchMatch.cm-searchMatch-selected` | `--ts-ui-indicator-selection` |
| `.cm-selectionMatch` | `rgba(127, 127, 127, 0.2)` (neutral, matching the existing active-line wash) |
| `.cm-tooltip.cm-tooltip-autocomplete` | `--ts-ui-autocomplete-bg`, `--ts-ui-autocomplete-border`, `--ts-ui-autocomplete-shadow`, `--ts-ui-text-color` |
| `.cm-tooltip-autocomplete > ul > li[aria-selected]` | `--ts-ui-autocomplete-item-highlight-bg`, `--ts-ui-autocomplete-item-highlight-color` |
| `.cm-tooltip-autocomplete > ul > li:hover` | `--ts-ui-autocomplete-item-hover-bg` |
| `.cm-completionMatchedText` | `--ts-ui-indicator-focus`, bold, `textDecoration: none` |
| `.cm-completionDetail` / `.cm-diagnosticSource` | `--ts-ui-autocomplete-item-disabled-color` |
| `.cm-lintRange-error` | `backgroundImage: none` + `textDecoration: underline wavy var(--ts-ui-validation-error-border, #dc2626)` |
| `.cm-diagnostic-error` | `borderLeft` from `--ts-ui-validation-error-border` |
| `.cm-tooltip-lint .cm-diagnostic` | `--ts-ui-tooltip-bg`, `--ts-ui-tooltip-color` |
| `.cm-foldGutter .cm-gutterElement` | `--ts-ui-text-color` at reduced opacity, `cursor: pointer` |
| `.cm-foldPlaceholder` | `--ts-ui-button-bg`, `--ts-ui-border-color`, `--ts-ui-border-radius` |
| `.cm-placeholder` | `--ts-ui-autocomplete-item-disabled-color` |
| `.cm-specialChar`, `.cm-highlightSpace`, `.cm-highlightTab` | `--ts-ui-border-color` |
| `.cm-trailingSpace` | `--ts-ui-validation-error-border` at low opacity |

---

## Verification

- `npm -w packages/lib run typecheck` — clean.
- `npm -w packages/lib run test` — full suite green, with every pre-existing
  `syncAutoHeight` test passing unedited.
- `npm ls @codemirror/search @codemirror/lint @codemirror/autocomplete @codemirror/lang-css`
  — one entry each, at the versions already in the lockfile; the four new direct
  dependencies must not move the resolved tree.
- The `external` regex at
  [vite.lib.config.ts:99](packages/lib/vite.lib.config.ts#L99) already matches
  `^@codemirror/`, so no build config change is needed. Confirm the built bundle
  still inlines no CodeMirror code: `npm run build:lib`, then
  `grep -rl "cm-searchMatch" packages/lib/dist` — expect no matches.
- `npm run docs:api` — 0 errors, 0 link warnings.
- `npm run docs:llms`, then `git diff packages/lib/llms.txt` — only the CodeEditor
  row changes.
- Manual smoke tests: every case in `## Expected Behaviour` ›
  *Manual verification only*, in the dev app's **CodeEditor** section and in the
  docs app's fenced code blocks.

---

## Documentation Impact

**Class JSDoc.** Replace the `@remarks` sentence at
[CodeEditor.ts:154-156](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L154):

> `CodeEditor` deliberately omits IntelliSense (no autocomplete, no lint, no
> language service) — its scope is highlighting plus one-command formatting.

with a sentence naming the new, still-bounded scope: highlighting, formatting,
folding, search, parser-level diagnostics and keyword/snippet completion are in
scope; anything needing semantic understanding — cross-file symbols, type
information, hovers, go-to-definition, a real language server — and collaborative
editing are not. Keep the surrounding live-only / `Canvas` paragraph as it is.

**`packages/lib/docs/components/CodeEditor.md`.**

- Line 3's "explicitly *no* IntelliSense, no TypeScript language service, no
  virtual file system" becomes the same bounded statement as the class JSDoc.
- Options table ([CodeEditor.md:32-40](packages/lib/docs/components/CodeEditor.md#L32))
  gains `lineWrap`, `placeholder`, `highlightWhitespace` and `lint`. The table is
  also missing a row for the existing `autoHeightMinRows` option — leave that
  gap alone; it predates this plan.
- Language table ([CodeEditor.md:46-52](packages/lib/docs/components/CodeEditor.md#L46))
  gains `css` and `python`, and a **Lint source** column.
- "Registering a language" ([CodeEditor.md:56-74](packages/lib/docs/components/CodeEditor.md#L56))
  uses Python as its example — replace it, since Python is now built in, and
  document `loadLintSource` and the language-data completion idiom.
- Keyboard section ([CodeEditor.md:88-96](packages/lib/docs/components/CodeEditor.md#L88))
  gains the fold, search, comment and completion bindings.
- Methods table ([CodeEditor.md:100-111](packages/lib/docs/components/CodeEditor.md#L100))
  gains the eight new accessors.
- Theming section ([CodeEditor.md:112-114](packages/lib/docs/components/CodeEditor.md#L112))
  notes that the search panel, completion tooltip, fold gutter and lint markers
  are themed from the same tokens.
- Two new sections, **Linting** and **Autocompletion**, each stating what is and
  is not covered.

**Catalog and index.**
[`docs/components/index.md:89`](packages/lib/docs/components/index.md#L89) and
[`scripts/llms/manifest.data.mjs:101`](packages/lib/scripts/llms/manifest.data.mjs#L101)
both carry a one-line description mentioning only highlighting and formatting;
both need the wider one, and `llms.txt` is regenerated from the manifest rather
than edited. The sidebar entry at
[`packages/docs/src/content/pages.ts:223`](packages/docs/src/content/pages.ts#L223)
already exists and needs no change.

**New exports.** `collectSyntaxErrors` and `LintSource` are re-exported from
`packages/lib/src/typescript/lib/component/editor/index.ts` — the
`component/editor` subpath barrel — and carry `@category Components`, matching
`registerLanguage` and `Formatter`.

**Changelog.** A **Changed › Components** entry in
`packages/lib/docs/reference/changelog/next.md`.

---

## Potential Challenges

- **Auto-height under wrapping cannot be fully settled by reading code.** The
  design above is derived from CodeMirror's stylesheet and the existing failure
  analysis, not from observation; the growth/shrink guards were tuned live and
  wrapping introduces a feedback path (height ← rows ← width ← scrollbar) that
  static reading cannot rule out. Treat the phase-1 wrap manual checks as a
  gate: if the box drifts, the fix is a further shape-tuple component or a
  wrap-specific trust rule, not a slop constant.[^wrap-open]
- **The fold gutter appears in the docs app's fenced code blocks**, which upgrade
  to read-only `CodeEditor`s
  ([Markdown.ts:1054](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1054)).
  This is a deliberate, accepted visual change; verify the blocks still size
  correctly rather than trying to suppress it.
- **Ctrl-F inside a focused fenced code block now opens CodeMirror's search
  instead of the browser's.** Accepted — CodeMirror's search is the more useful
  one inside the editor, and the browser's is one Escape away.
- **`MarkdownEditor`'s source surface inherits everything.** Its inner editor is
  built with `language: "markdown"`
  ([MarkdownEditor.ts:362](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L362)),
  so it gains folding, search, bracket closing and the markdown grammar's own
  HTML-tag completions, and gains nothing from lint. No `MarkdownEditor.ts` change
  is needed; verify its source mode still round-trips.
- **`:scope` in a `querySelector` call.** The modelled test source has no selector
  engine and returns whatever `setQuerySelectorResult` seeded
  ([TestDOM.ts:1184](packages/lib/tests/dom/TestDOM.ts#L1184)), so the selector
  string is only exercised live. Confirm the last-child measurement works in the
  browser before relying on it.
- **Four of the five new direct dependencies were already in the tree**
  (`@codemirror/lang-css`, `search`, `lint`, `autocomplete`); only
  `@codemirror/lang-python` is genuinely new. If `npm install` moves any of the
  four to a newer major, stop and pin instead — a CodeMirror major bump is not
  part of this plan.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) | Every phase edits it. Read `syncAutoHeight` (L880-1165) **and** the comment block above `_lastSyncedShape` (L231-265) in full before touching height. |
| [`packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts`](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts) | `loadFormatter` (L36) is the precedent `loadLintSource` mirrors. |
| [`packages/lib/src/typescript/lib/component/editor/languages.ts`](packages/lib/src/typescript/lib/component/editor/languages.ts) | The five existing registrations are the template for `css` and `python`. |
| [`packages/lib/src/typescript/lib/component/editor/theme.ts`](packages/lib/src/typescript/lib/component/editor/theme.ts) | The token-with-fallback style every new rule must copy. |
| [`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts) | The live-only testing convention: offline-observable contract only, with `_view` stubbed and `DOM.source` mocked. |
| [`packages/lib/tests/component/display/Canvas.test.ts`](packages/lib/tests/component/display/Canvas.test.ts) | The other live-only component's test shape, which `CodeEditor`'s follows. |
| [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts) | The fenced-block upgrade (L1024-1085) is the auto-height consumer most exposed to phase 1. |
| [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) | Hosts a `CodeEditor` (L362) and so inherits every always-on extension. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | The typed-setter / options-bag / cache rules every new option follows. |
| [`packages/lib/llms.txt`](packages/lib/llms.txt) | Generated; edit the manifest, not this file. |

---

## Non-Goals

- **Collaborative editing.** `@codemirror/collab` is not installed and no
  operational-transform or presence surface is added.
- **A language service.** No cross-file symbols, no type information, no hovers,
  no go-to-definition, no rename, no diagnostics beyond the parser's own error
  nodes. `collectSyntaxErrors` reports *where the grammar failed*, nothing more.
- **New events.** No `"diagnostics"` or `"foldchange"` event. The existing
  `"change"` / `"readonlyedit"` / `"heightchange"` surface is unchanged; a
  consumer needing diagnostics can supply its own `LintSource` and observe it
  there.
- **Exposing the `EditorView`.** The view stays private; every new capability is
  reached through an option, an accessor, or a `LanguageDefinition` field.
- **Further language packages.** `lang-rust`, `lang-cpp`, `lang-java`,
  `lang-php`, `lang-xml`, `lang-yaml`, `lang-less` and `lang-sass` all follow the
  same three-line `registerLanguage` shape and can be added later; only `css` and
  `python` are in scope here.
- **Changing `MarkdownEditor`.** Its source surface inherits the new behaviour
  through its inner `CodeEditor`; no option is set on it and no defaults are
  changed there.
- **Formatter configuration.** The `css` entry registers Prettier's `css` parser
  with its stock defaults, and `python` registers no formatter at all — it falls
  back to `format()`'s whole-document re-indent. Formatter *options* are a
  separate plan ([plans/formatter-options.md](plans/formatter-options.md)).
- **Reworking the auto-height guards themselves.** Phase 1 replaces the *height
  measurement* and widens the *shape tuple*; the growth-distrust, shrink-noise,
  scrollbar-reserve and fractional-undershoot rules stay exactly as written.

---

## Notes

[^scope-wording]: The original wording was a real design commitment, not
    boilerplate: it justified shipping no `@codemirror/lint` and no
    `@codemirror/autocomplete`. Narrowing it rather than deleting it keeps the
    commitment that actually matters — no language service, no type information,
    no cross-file anything — while admitting the two things a parser already
    knows for free: where it failed, and which keywords the grammar defines. Both
    fall out of the Lezer tree that syntax highlighting already builds, so they
    add no analysis machinery, only a presentation of what is already computed.

[^extent]: Three candidate models were compared. (1) `perLineHeight × doc.lines`,
    today's model: breaks under folding (`doc.lines` is unchanged when a block
    collapses) and under wrapping (a `.cm-line`'s rect is as tall as the rows it
    wraps to, so multiplying it by the line count over-counts badly).
    (2) `view.contentHeight`, CodeMirror's own figure: the existing
    `syncAutoHeight` doc rejects it because CodeMirror defers its internal
    line-height refresh while the view sits outside the browser's visible
    viewport, which is exactly the docs app's below-the-fold fenced blocks.
    (3) The last-child measurement chosen here. `.cm-content` is
    `display: block` with `min-height: 100%` and `padding: 4px 0`
    (`@codemirror/view`'s base theme), so its children stack from the top and the
    `min-height` stretch trails *after* the last child — the same property that
    made an individual `.cm-line`'s rect trustworthy. CodeMirror represents
    out-of-viewport regions as `.cm-gap` widget elements with explicit heights,
    which are element children of `.cm-content`, so the last child's bottom
    reflects the whole document even when only the viewport's lines are rendered.

[^tuple]: The tuple is a *trust gate*, not an input to the height calculation.
    Its job is to distinguish a genuine content change from CodeMirror's own
    post-commit geometry echo, which the existing comment block documents at
    length. A fold changes rendered height with no change to line count, document
    length or container width, so under the three-element tuple the resulting
    shrink is indistinguishable from an echo and is refused — the box would keep
    its unfolded height with a blank band under the collapsed content. A wrap
    toggle is the same case in the growth direction.

[^fold-field]: Computing the count inside `syncAutoHeight` would make that method
    call `foldedRanges(this._view.state)`, and roughly twenty existing tests stub
    `_view.state` as a bare `{ doc: { lines: n } }` object with no `field`
    method, so every one of them would throw. Caching the count on a field that
    the update listener refreshes keeps those tests untouched, keeps
    `syncAutoHeight`'s inputs plain numbers, and is correct because the count can
    only change through an update — which is also the only thing that calls
    `syncAutoHeight` after mount.

[^lint-shape]: `linter()` wants `(view: EditorView) => Diagnostic[] |
    Promise<Diagnostic[]>`. Taking the view would make every `LintSource`
    untestable offline and would hand consumers a live DOM object for no reason —
    a syntax-only source needs nothing but the state. `CodeEditor` bridges the two
    with a one-line adapter, `linter((view) => source(view.state))`. The shape
    also matches `Formatter`, which likewise takes plain data rather than the
    view.

[^completion-source]: Checked against the installed packages:
    `@codemirror/lang-javascript` publishes `localCompletionSource` plus snippet
    completions, `lang-css` publishes `cssCompletionSource`, `lang-html`
    publishes `htmlCompletionSourceWith`, `lang-sql` publishes
    `keywordCompletionSource`, `lang-markdown` publishes `htmlTagCompletion`, and
    `lang-python` publishes its own local/global sources — all through
    `<lang>Language.data.of({ autocomplete: … })`, which `autocompletion()` reads
    without being told. Only `lang-json` ships none. A registry field would
    therefore have exactly one built-in user and would duplicate a mechanism
    CodeMirror already provides for consumer grammars, so JSON's three keywords
    are attached with the same `data.of` idiom instead.

[^comments]: Verified in the installed `@codemirror/commands@6.10.4`:
    `defaultKeymap` contains `{ key: "Mod-/", run: toggleComment }` and
    `{ key: "Alt-A", run: toggleBlockComment }`. `mount()` already spreads
    `defaultKeymap`, so both bindings are live today. The only work is
    documenting them in `CodeEditor.md`'s keyboard section.

[^keymaps]: `autocompletion()` installs
    `Prec.highest(keymap.computeN([completionConfig], …))`, gated on its own
    `defaultKeymap: true` config, which is the default. A hand-added
    `...completionKeymap` inside the editor's own `keymap.of([...])` would sit at
    normal precedence beneath it and could only shadow keys the higher-precedence
    copy declined. `closeBrackets()`, by contrast, returns only an input handler
    and a state field, so its single `Backspace` binding must be added explicitly.

[^markers]: `@codemirror/lint`'s gutter markers are `content: url(data:image/svg+xml,…)`
    declarations carrying hard-coded fills, so recolouring them means authoring
    replacement data URIs — three inline SVGs to maintain against a package that
    may change them. The default glyphs (red circle, amber triangle, blue square)
    are saturated shapes with contrasting outlines and read acceptably on both
    themes, so they are left alone; the squiggle, panel and tooltip — which *are*
    plain CSS — are tokenised.

[^panel-height]: CodeMirror renders panels as `.cm-panels` inside `.cm-editor`,
    outside `.cm-scroller`, so an open panel takes vertical space from the
    scroller rather than from the document. With `autoHeightMaxRows` set, that
    means the visible row count drops while the box height stays put, and a short
    document briefly gains an internal vertical scrollbar. That is the expected
    trade — growing the box to make room for a transient panel would fight the
    growth-distrust guard — but the check exists because it is also where a
    drift would first show up.

[^wrap-open]: The auto-height guards in `syncAutoHeight` were each derived from a
    live reproduction: unbounded upward drift on a non-integer device-pixel
    ratio, collapse toward zero through repeated shrink echoes, a false
    scrollbar reserve measured against a stale box, and a fractional undershoot
    invisible to integer `scrollHeight`. None of those were predictable from the
    code. Line wrapping adds a genuinely new coupling — rendered row count now
    depends on `clientWidth`, which the horizontal-scrollbar reserve also feeds —
    and no amount of static reading proves that loop settles. The design above is
    the best available from the code alone; phase 1's wrap checks are where it
    gets confirmed or corrected.

---

## Implementation Notes

- **`collectSyntaxErrors('')` reports one diagnostic, not `[]`.** The plan's
  `## Expected Behaviour` table for `collectSyntaxErrors` listed an empty
  document as `[]`, alongside valid JSON. Verified directly against the
  installed `@codemirror/lang-json` (via `syntaxTree(state).cursor()` on a
  state built from `EditorState.create({ doc: "", extensions: [json()] })`):
  an empty document parses to a single zero-length error node
  (`JsonText(⚠)` at `0–0`), because JSON requires exactly one top-level
  value and an empty document supplies none. This is the correct behaviour
  for `collectSyntaxErrors` to surface — the function's whole contract is
  "wherever the grammar failed" — so the implementation reports it and the
  test in `code-editor.test.ts` (`'reports a single diagnostic for an empty
  document, not []'`) was written against the verified real output instead
  of the plan's table entry.
- **`@codemirror/search` briefly drifted to `6.7.2`.** `npm install -w
  packages/lib @codemirror/search@^6.7.1` (phase 3, step 18) resolved to
  `6.7.2` — newer than the `6.7.1` the plan's `## Potential Challenges`
  recorded as already-transitively-resolved — because an explicit
  command-line install target fetches the latest version satisfying the
  given range rather than preferring whatever the lockfile already pinned.
  Re-run as `npm install -w packages/lib @codemirror/search@6.7.1` (the
  exact version, not a range) to pin it back to the pre-existing resolution,
  satisfying the plan's `## Verification` requirement that none of the four
  already-resolved packages move the tree. `package.json` still records the
  plan's stated `^6.7.1` range; only the resolved version was at risk of
  drifting.
- **`npm run docs:api` has 3 pre-existing warnings, not 0.** The plan's
  `## Verification` says this command must finish with 0 warnings. It
  finishes with 3 (all `component/display.MarkdownViewer` links to the
  non-exported `MarkdownContentPane`, none of it touched by this plan) —
  confirmed pre-existing by checking out `master`, where the same three
  warnings already fire against `MarkdownViewer.ts`. This plan's own changes
  introduce 0 new warnings: two `{@link CodeEditor.refreshLint}` references
  (a private method) and one `{@link MAX_SYNTAX_DIAGNOSTICS}` reference (a
  non-exported constant) were caught by the same command and rewritten as
  prose per `CODE_CONVENTIONS.md`'s "Don't `{@link}` internal symbols from
  public JSDoc" rule before this run.
- **The `grep -rl "cm-searchMatch" packages/lib/dist` no-inlining check
  reports a match, but not a real one.** `## Verification` expects no match,
  on the premise that the string only appears if CodeMirror's own package
  code got bundled. That premise no longer holds once this plan's own
  `theme.ts` legitimately writes `".cm-searchMatch"` as a CSS-in-JS object
  key — the match is that literal, in our own first-party source, not
  CodeMirror's. Confirmed via the built bundle's own import statements
  (`dist/lib/CodeEditor-*.js`): every `@codemirror/*` symbol
  (`search`/`searchKeymap`/`highlightSelectionMatches`,
  `linter`/`lintGutter`, `autocompletion`/`closeBrackets`/`closeBracketsKeymap`,
  and all of phase 1-2's additions) is still a bare `from "@codemirror/…"`
  import, exactly like the pre-existing `@codemirror/language` /
  `@codemirror/view` imports — nothing from those packages is inlined.
- **`.cm-searchMatch` / `.cm-searchMatch.cm-searchMatch-selected` derive from
  `--ts-ui-indicator-focus`, not `--ts-ui-indicator-selection` as `##
  Expected Behaviour` › Theme token mapping specifies.** That table entry's
  premise doesn't hold: `--ts-ui-indicator-selection`'s real, actively
  consumed shape is a dashed **outline** shorthand
  (`AbstractSelectableList.ts:261`, `Cell.ts:166`, both
  `outline: var(--ts-ui-indicator-selection, 1px dashed rgb(120, 170, 240))`),
  not a colour — confirmed live via the mounted theme's own custom-property
  value. Used as a `background-color` source it is invalid at
  computed-value time and, since the property is genuinely set (not
  merely unset), the `var()` fallback never activates either — silently
  painting nothing. `--ts-ui-indicator-focus` (`rgb(30, 100, 200)` live,
  confirmed via `getComputedStyle`), the framework's actual single accent
  colour token and already read elsewhere in this same file
  (`.cm-completionMatchedText`), is used instead via the same `color-mix`
  recipe as `ScrollShadow.scrollShadowEdgeValue`, confirmed live to resolve
  to the real theme colour rather than the fallback. The pre-existing
  `.cm-selectionBackground` rule (`theme.ts:60`, predating this plan) has
  the identical defect; it is out of this plan's scope and left untouched.
- **`CodeEditorPanel`'s main demo editor cannot exercise Wrap or folding
  driving auto-height growth/shrink, so a second, purpose-built editor was
  added.** The plan's phase-1 manual-verify list requires observing both
  wrap-driven height growth and fold-driven height shrink in the dev app,
  and step 11 added a `Wrap` button to the existing `SAMPLE_JS` editor on
  the assumption that it could show this — but that editor has no
  `autoHeightMaxRows` (it fills a `Fit` host instead), so `syncAutoHeight()`
  early-returns unconditionally and no height change is observable there
  regardless of wrap or fold state (confirmed live: folding `SAMPLE_JS`'s
  `describePerson` left its box at a fixed 1723px). A second editor
  (`_wrapFoldDemo`, a small foldable function plus a deliberately-long line,
  `autoHeightMaxRows: 6`, `preferredSize: { width: 400, height: 60 }` so
  `VBox`'s default non-stretching cross-axis layout gives it a fixed width
  for the line to actually overflow — confirmed against `VBox.ts`'s
  `layoutPreferredMode`: `if (!size || this.isStretching()) defaultWidth =
  containerSize.width`) was added below the toolbar, its Wrap driven by the
  same `Wrap` button and its fold by its own gutter arrow. Confirmed live:
  unwrapped height 63px with a horizontal scrollbar; wrapped height 127px (5
  visibly wrapped rows) with the scrollbar gone; toggling back returns to
  exactly 63px. Separately, folding the function shrank the box 133px→103px
  with no blank band.
- **No manual-verify surface existed anywhere in the dev app for `css`,
  `python`, or `json`-specific behaviour**, so a `Language` row (`JS` /
  `CSS` / `Python` / `JSON`) was added that swaps the main editor's language
  and content to a small per-language sample. This covers the plan's phase-2
  check ("selecting `css` and `python` highlights correctly; `format()`
  reformats CSS and re-indents Python") and phase-5's JSON-specific check
  ("in a JSON document, typing `t` at a value position offers `true`"),
  neither of which any editor in the demo app could exercise before (every
  `CodeEditor` there was constructed with `language: 'javascript'`, and no
  docs page has a `css`/`python` fenced block). Confirmed live for all four:
  CSS's irregular spacing (`color:blue;`, `padding:  4px   8px;`) reformats
  to `color: blue;` / `padding: 4px 8px;` on Format; Python highlights
  correctly and Format's re-indent fallback runs with no error; JSON
  highlights correctly and, after deleting `true` and typing `t` at that
  same value position, the completion tooltip offers `true`.
- **A pre-existing, non-deterministic test flake was observed and is
  unrelated to this branch.** `npm -w packages/lib run test` intermittently
  (roughly half of ~6 runs during this implementation) reports a stray
  `Errors: 1 error` alongside "6104/6104 tests passed" — a `ProductionDOMSink.apply`
  exception whose stack trace runs entirely through
  `TableHeader.onStoreFilterChange` → `renderColumnWindow` →
  `positionColumnCells` → `HeaderCell.applyBounds`, attributed by Vitest to
  whichever test file (`ColumnFilterRow.test.ts`) happened to be running
  when it fired. `ColumnFilterRow.test.ts` passes cleanly every time run in
  isolation, and immediately-repeated full-suite runs against the identical
  tree hash alternate between clean and this error, confirming it is a
  cross-test-file timing leak (consistent with this codebase's documented
  `Animation.ts`/viewport-listener test-isolation flakes) and not a
  regression — nothing in this diff touches `component/table/` or
  `HeaderCell`.
- **`.cm-trailingSpace` also hardcoded a literal instead of deriving from a
  theme token — the same defect class as the `.cm-searchMatch` fix above,
  missed in that pass.** `## Expected Behaviour` › Theme token mapping
  specifies `--ts-ui-validation-error-border` at low opacity; the
  implementation had `rgba(220, 38, 38, 0.15)` (that token's literal
  fallback value) instead. Fixed with the same `color-mix(in srgb,
  var(--ts-ui-validation-error-border, #dc2626) 15%, transparent)` recipe
  the lint rules a few lines below it already use — confirmed live that this
  token, unlike `--ts-ui-indicator-selection`, genuinely is a plain colour
  (`rgb(200, 50, 50)` in the live theme), so `color-mix` resolves correctly.
- **The wrap+fold auto-height demo's row cap saturated before Wrap was even
  toggled, hiding real growth behind a no-op — a demo-config bug, not a
  `syncAutoHeight` bug.** Live-tested at the previous `autoHeightMaxRows: 6`:
  toggling Wrap *shrank* the box (133px→126px) instead of growing it.
  Root-caused before treating it as the `[^wrap-open]` gate failing: with
  `SAMPLE_WRAP_FOLD` already 6 logical lines unwrapped, `capPx` (`perRowHeight
  * 6`) bound the committed height in *both* the unwrapped and wrapped
  states, leaving no headroom for the long line's real wrapped extent
  (~9 rows) to show through `measureContentExtent()` — the small shrink was
  the wrap-aware `perRowHeight` source (`defaultLineHeight`) reading
  marginally lower than the unwrapped source (`.cm-line`'s own measured
  rect), a second-order effect only visible because the cap masked the real,
  much larger first-order growth. Raised `autoHeightMaxRows` to 15 (well
  above both the 6-row unwrapped and ~9-row wrapped extents) and re-tested
  live: unwrapped 141px → wrapped 205px (real growth, no horizontal
  scrollbar) → back to 142px on toggle-off (1px of the same sub-pixel noise
  every other case in this plan already documents, not drift). This confirms
  the underlying `syncAutoHeight`/`measureContentExtent`/shape-tuple logic in
  `CodeEditor.ts` is correct as designed; no source change was needed, only
  the demo's own row cap.
- **Two Ordered Implementation Steps / Manual verification checks (phase 4's
  lint check and phase 5's completion check) were stale against phase 5's own
  `closeBrackets()`, and are corrected in the plan text itself** (steps 29 and
  33, and the Phase 4 / Phase 5 manual-verification bullets): `function (`
  no longer reaches lint as an error once `closeBrackets()` auto-inserts the
  matching `)` — `function ()` has no error node in the installed
  `@codemirror/lang-javascript` grammar. Replaced with `)))`, which has no
  opening counterpart for `closeBrackets()` to pair, inserts literally, and
  produces three real (non-zero-width) error nodes — confirmed live: a red
  gutter marker plus a wavy underline (`text-decoration-style: wavy`,
  colour resolving to the live `--ts-ui-validation-error-border`). Similarly,
  `docu` never opens the completion tooltip, since `localCompletionSource`
  only offers keywords and locally-scoped bindings, not DOM globals like
  `document`; replaced with `gree`, which matches the sample's own top-level
  `greet` function — confirmed live, tooltip opens offering `greet`.
