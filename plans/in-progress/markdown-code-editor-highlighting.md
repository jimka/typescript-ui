# Markdown Fenced-Code Syntax Highlighting via CodeEditor — Implementation Plan

## Overview

[`Markdown`](../packages/lib/src/typescript/lib/component/display/Markdown.ts) renders a fenced code block as a plain `<pre class="ts-ui-md-pre"><code>` pair with no syntax colouring ([`appendCode`, Markdown.ts:828](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L828)). The library already has a syntax-highlighting editor, [`CodeEditor`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts), a CodeMirror 6 wrapper that renders read-only, colour-highlighted code when constructed with `{ readOnly: true, language: <id> }`. This plan wires the two together: a fenced block whose language is registered upgrades from the plain `<pre>` to a live `CodeEditor`; every other fenced block keeps rendering exactly as it does today.

Two facts drive every decision below. First, `CodeEditor` is a real `Component`, not a raw DOM handle — `Markdown` currently builds its whole subtree through `DOM.sink.createElement` and never parents a child `Component`, so this plan introduces that pattern for `Markdown` for the first time. Second, `CodeEditor` pulls in CodeMirror, a dependency an order of magnitude heavier than `marked` (Markdown's only current runtime dependency); `Markdown` is used on every docs page and any consumer's changelog/help text, most of which contain no fenced code at all, so `CodeEditor` must load on demand, not on every `Markdown` import.

---

## Architecture Decisions

### A live `CodeEditor` child is appended as raw DOM, not through `addComponent`

`Markdown` manually appends the `CodeEditor`'s element into the exact DOM node the fenced block occupies in its block-token tree, the same way [`TreeRow`](../packages/lib/src/typescript/lib/component/tree/TreeRow.ts) appends its content renderer and toggle `Glyph` ([TreeRow.ts:275](../packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L275) and [TreeRow.ts:175](../packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L175), positioned explicitly via `setX`/`setY`/`setWidth`/`setHeight` at [TreeRow.ts:214-242](../packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L214)) and the way [`DiagramView`](../packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) appends its busy-spinner overlay ([DiagramView.ts:616](../packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L616), "mounted by a raw DOM append, so it is not in this view's laid-out set").[^why-not-addcomponent]

### The fenced block's position is a `position: relative` wrapper `<div>`; the editor is explicitly sized to fill it

A fenced code block can sit anywhere in the token tree — top-level, inside a blockquote, inside a list item. `CodeEditor` is a `Component`, and every `Component` is `position: absolute` with no exception available here.[^position-carveouts] An absolutely positioned element resolves `top`/`left` against its nearest positioned ancestor — without a local positioning context, that ancestor would be `Markdown`'s own root element (itself `position: absolute`), not the fenced block's actual nested position, so the editor would jump to the top-left corner of the whole document. `appendCode` therefore wraps the block in a new `<div class="ts-ui-md-code-host">` carrying `position: relative` (a plain DOM element `Markdown` already builds via `DOM.sink.createElement`, not a `Component`, so the "no `position: relative` on a `Component`" rule does not apply to it). The editor is then positioned `setX(0).setY(0)` and sized `setWidth(w).setHeight(h)` to exactly fill that wrapper.[^absolute-no-autoheight]

Both `w` and `h` are measured, not estimated: before the swap, `Markdown` reads the placeholder `<pre>`'s rendered `clientWidth`/`scrollHeight` through `DOM.source.getScrollMetrics` — the same seam call [`measureContentHeight`](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L530) already uses for `Markdown`'s own content height — and hands those two numbers to the editor. The wrapper's own height is then pinned to the same measured value with an inline style (mirroring `CodeEditor`'s own flash-overlay wrapper at [CodeEditor.ts:617-636](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L617)), because an absolutely positioned child does not contribute to its parent's auto height — without this the wrapper would collapse to zero and every block after it would render on top of the code.

### Language mapping: fence info string → `CodeEditor` registry id

Only five ids are registered, by [languages.ts](../packages/lib/src/typescript/lib/component/editor/languages.ts): `javascript`, `json`, `html`, `sql`, `markdown` — there is no separate `typescript` id; `javascript` covers both, via `javascript({ typescript: true })` ([languages.ts:24-33](../packages/lib/src/typescript/lib/component/editor/languages.ts#L24)). `marked`'s `Tokens.Code.lang` carries the fence's info string verbatim (e.g. `js`, `ts`, `python`); only the first whitespace-delimited word is the language token per CommonMark, so a shebang-style modifier after it (`js {1,3}`) does not defeat the match.

| Fence info string (first word, lowercased) | `CodeEditor` language id |
|---|---|
| `js`, `javascript`, `jsx`, `mjs`, `cjs` | `javascript` |
| `ts`, `typescript`, `tsx` | `javascript` |
| `json` | `json` |
| `html`, `htm` | `html` |
| `sql` | `sql` |
| `md`, `markdown` | `markdown` |
| anything else, or no info string | *(no mapping — plain `<pre>`)* |

A new module-level `mapFenceLangToEditorId(lang: string | undefined): string | null` in Markdown.ts owns this table. Unmapped output is `null`, and every call site treats `null` identically to "no info string": render today's plain `<pre>`. This is a closed table, not a fallback to the raw info string as a guess — passing an unregistered id to `CodeEditor` silently renders unhighlighted text (`getLanguage` returns `undefined`, `setLanguage` no-ops), which would look like a bug rather than the deliberate "unsupported" case.

### `CodeEditor` loads through a narrow dynamic import, never the `component/editor` barrel

[vite.lib.config.ts](../packages/lib/vite.lib.config.ts) builds one bundle per package subpath (`component/display`, `component/editor`, …) with `@codemirror/*`, `@lezer/*`, `prettier`, `sql-formatter`, and `lexical`/`@lexical/*` all marked `external` ([vite.lib.config.ts:96](../packages/lib/vite.lib.config.ts#L96)) — none of those land in `dist/lib`. The risk this plan must avoid is different: a **static** top-level `import` of anything from `component/editor` inside `component/display`'s `Markdown.ts` forces a consumer's own bundler to resolve and evaluate `@codemirror/*` (and, through the barrel, `lexical`) the moment it imports `Markdown` at all, whether or not a fenced code block ever appears.

`component/editor/index.ts` ([index.ts:1-12](../packages/lib/src/typescript/lib/component/editor/index.ts#L1)) re-exports both `CodeEditor` *and* `MarkdownEditor` (the Lexical-based rich editor) — dynamically importing that barrel would pull in the unrelated Lexical stack too, defeating the point. `Markdown.ts` instead dynamically imports the two narrow modules it actually needs:

```typescript
const [{ CodeEditor: CodeEditorClass }] = await Promise.all([
    import("~/component/editor/CodeEditor.js"),
    import("~/component/editor/languages.js"), // side-effect only: registers the 5 language ids
]);
```

`languages.js` must be imported alongside `CodeEditor.js` rather than assumed already-loaded: `CodeEditor.ts` itself never imports it (only the barrel does, at [index.ts:4](../packages/lib/src/typescript/lib/component/editor/index.ts#L4)), so skipping it would leave the language registry empty and every `getLanguage(id)` lookup inside `CodeEditor` would return `undefined`. The type used for the field that stores a live editor comes from a type-only import (`import type { CodeEditor } from "~/component/editor/CodeEditor.js";`), which TypeScript erases entirely — it costs nothing at runtime and is not the import that needs to be dynamic.

Rollup's multi-entry lib build automatically factors a module reachable from two entry points into a shared chunk; because `Markdown.ts` reaches `CodeEditor.ts` only through this dynamic import (never a static one), that chunk loads asynchronously, and because the import specifiers name `CodeEditor.js`/`languages.js` directly rather than the barrel, `MarkdownEditor.ts` and Lexical are not reachable from it at all.[^glyph-theme-not-precedent]

### The import itself, not just the swap, waits for `onFirstLayout`

`appendCode` does not call `loadCodeEditorUpgrade` directly. It wraps the call in `this.onFirstLayout(() => void this.loadCodeEditorUpgrade(...))` — the same per-component "first connected, laid-out pass" hook `CodeEditor` uses for its own CodeMirror mount ([CodeEditor.ts:194](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L194)) and `Markdown` already uses for its own first prose measurement ([Markdown.ts:360](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L360)). Without this, `DocsDemo`'s `_source` panel — `new Markdown(..., { displayed: false })` ([DocsDemo.ts:85-87](../packages/docs/src/shell/DocsDemo.ts#L85-L87)) — would start downloading CodeMirror the instant the demo's `Markdown` is constructed, before "Show source" is ever clicked: `displayed: false` still runs `render()` (element creation is unaffected by visibility), so a kickoff kept in `appendCode` would fire regardless. `onFirstLayout` only drains once a component reaches a connected layout pass while `getLaidOutComponents()` includes it — and that method excludes a `displayed: false` component ([Component.ts:5375-5387](../packages/lib/src/typescript/lib/core/Component.ts#L5375)) — so the queued callback stays pending for as long as the panel stays collapsed, exactly matching how `Markdown`'s own `measureContentHeight` already defers for the same panel today.

This is a separate concern from the `isEffectivelyVisible()` check inside `loadCodeEditorUpgrade` (**Internal Structure**, step 2): that check guards the *apply* step against a component that was visible when the import started but got hidden again before it resolved (a slower network, or a fast toggle) — a race `onFirstLayout` alone cannot close, since it only guarantees visibility at the moment it *fires*, not for the duration of the subsequent `await`.

### Default-on, no opt-in flag

Every fenced block with an unmapped language, and every `Markdown` instance with no fenced code at all, is byte-for-byte unaffected — the dynamic import only fires when `mapFenceLangToEditorId` actually returns an id, so there is no bundle or render cost to opt out of. The feature request itself is unconditional ("a fenced code block with a supported language renders with real syntax highlighting… instead of the current plain rendering"), so this plan does not add a `MarkdownOptions.highlightCode` flag — there is nothing left for a flag to gate once the lazy-load already makes the zero-fenced-code and unsupported-language cases free.[^opt-in-rejected]

### Teardown disposes every live `CodeEditor`, not just its DOM

`CodeEditor.destructor()` unsubscribes a `ThemeManager` listener and destroys its CodeMirror view ([CodeEditor.ts:486-509](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L486)) — a theme-listener leak if only detached, matching the class's own "Call before discarding a dynamically-built `CodeEditor`" remark. Because the editor is appended as raw DOM rather than through `addComponent`, it is not in `Markdown`'s `_components` array and the base `Component.destructor()`'s child-recursion loop ([Component.ts:785-788](../packages/lib/src/typescript/lib/core/Component.ts#L785)) never reaches it — `Markdown` must dispose it explicitly, the same obligation `CodeEditor.destructor()` places on any caller holding one.

---

## Public API

No exported symbol changes. `MarkdownOptions`, `Markdown`'s public methods, and `CodeEditor`'s public API are all unchanged.

---

## Internal Structure

New private state on `Markdown`:

```typescript
/** A supported-language fenced block still waiting for CodeEditor to load or become visible. */
interface PendingCodeUpgrade {
    // Constructor type built from the type-only `CodeEditor` import — `typeof CodeEditor`
    // is not available here because the value itself is never statically imported.
    CodeEditorClass: new (value: string, options: { readOnly: true; language: string }) => CodeEditor;
    wrapper: Handle;
    pre:     Handle;
    code:    Handle;
    text:    string;
    languageId: string;
    generation: number;
}

private _codeEditors: Array<{ editor: CodeEditor; wrapper: Handle }> = [];
private _pendingCodeUpgrades: PendingCodeUpgrade[] = [];

/** Bumped by clearContent(); a resolved dynamic import compares its captured
 *  generation against this to detect a render it no longer belongs to
 *  (a later setMarkdown(), or disposal), mirroring DiagramView.relayout's
 *  generation token (DiagramView.ts:553-559). */
private _renderGeneration = 0;
```

Control flow, in the order a fenced block moves through it:

1. `appendCode` always builds the plain `<pre><code>` pair, unchanged. If `mapFenceLangToEditorId(token.lang)` returns an id, it additionally wraps the `<pre>` in a `ts-ui-md-code-host` div and registers `this.onFirstLayout(() => void this.loadCodeEditorUpgrade(wrapper, pre, code, token.text, id, this._renderGeneration))` — the kickoff itself, not just the DOM swap, waits for `Markdown`'s first connected+displayed layout (see **Architecture Decisions**, "The import itself, not just the swap, waits for `onFirstLayout`").
2. `loadCodeEditorUpgrade` awaits the two dynamic imports, then checks `generation !== this._renderGeneration` — a mismatch means `setMarkdown` rebuilt (or the component was disposed, which also bumps the generation) since this block was queued, so it returns without touching anything. Otherwise it checks `this.isEffectivelyVisible()`: if true, it calls `applyCodeEditorUpgrade` immediately and then `this.measureContentHeight()` to fold the new height in; if false (e.g. embedded in a `displayed: false` `Markdown`, as `DocsDemo`'s source panel is), it pushes a `PendingCodeUpgrade` onto `_pendingCodeUpgrades` instead.
3. `measureContentHeight` calls `syncCodeEditors()` as its first line. `syncCodeEditors` (a) filters `_pendingCodeUpgrades`, applying (via `applyCodeEditorUpgrade`, with no further `measureContentHeight` call — the caller is already inside one) any entry that has become visible and dropping it from the list, and (b) for every already-applied entry in `_codeEditors`, re-reads its wrapper's `clientWidth` and calls `editor.setWidth(...)` (a no-op if unchanged) — this is what keeps a code block's width tracking `Markdown`'s own width on resize, since `setWidth` on `Markdown` already calls `measureContentHeight` when the width actually changes.
4. `applyCodeEditorUpgrade` measures the placeholder `<pre>` via `DOM.source.getScrollMetrics`, removes and releases the `pre`/`code` handles (and drops them from `_contentHandles`), constructs the editor (`new CodeEditorClass(text, { readOnly: true, language: languageId })`), positions and sizes it, appends its element into the wrapper, pins the wrapper's height, and records `{ editor, wrapper }` in `_codeEditors`.
5. `clearContent` (already called by `setMarkdown` before a rebuild) additionally bumps `_renderGeneration`, disposes every entry in `_codeEditors` (`editor.dispose()`), and clears both `_codeEditors` and `_pendingCodeUpgrades`.
6. `destructor` calls `this.clearContent()` as its first line (before the existing `_unsubscribeTheme()` call), so final teardown disposes any live editors through the same path instead of duplicating the loop.

No collapse-to-`auto`/restore dance is needed when reading the placeholder `<pre>`'s metrics (unlike `measureContentHeight`'s own probe on `Markdown`'s root): the floor `measureContentHeight` works around only applies to an element that has previously had an explicit height committed via `setHeight` — the placeholder `<pre>` never has one, so its `scrollHeight` is already its natural content height.

---

## Ordered Implementation Steps

1. **Markdown.ts — add the language-mapping table.** Add the alias table above as a module-level `const FENCE_LANG_ALIASES: Record<string, string>` (or an equivalent `Map`) plus `mapFenceLangToEditorId(lang: string | undefined): string | null`, which lowercases and takes the first whitespace-delimited word of `lang` before looking it up. Check: unit test each row of the table plus `undefined`/empty/unmapped input.

2. **Markdown.ts — add the `CODE_HOST_CLASS` style rule.** Add `const CODE_HOST_CLASS = "ts-ui-md-code-host";` alongside the other class constants, and register it in `ensureMarkdownClassRules()` with `styles: { position: "relative" }`. Check: `grep -n "CODE_HOST_CLASS" Markdown.ts` shows the constant, the rule registration, and its one use site in `appendCode`.

3. **Markdown.ts — add the type-only `CodeEditor` import and new fields.** Add `import type { CodeEditor } from "~/component/editor/CodeEditor.js";` near the top (type-only, erased at compile time — this must not become a value import). Add `_codeEditors`, `_pendingCodeUpgrades`, `_renderGeneration`, and the `PendingCodeUpgrade` interface from **Internal Structure** above.

4. **Markdown.ts — add `applyCodeEditorUpgrade`.** Implement per **Internal Structure**, step 4: measure the placeholder `<pre>` via `DOM.source.getScrollMetrics`, remove/release the `pre`/`code` handles (and splice them out of `_contentHandles`), construct the editor, `setX(0).setY(0).setWidth(...).setHeight(...)`, `DOM.sink.appendChild` the editor's `getElement(true)!` into the wrapper, pin the wrapper's height via `DOM.sink.apply(wrapper, { style: { height: ... } })`, push into `_codeEditors`. Check: called directly in a unit test with a fake `CodeEditorClass` and a pre-built wrapper/pre/code, `_contentHandles` no longer contains the old `pre`/`code` handles and `_codeEditors` contains exactly one new entry.

5. **Markdown.ts — add `syncCodeEditors` and call it from `measureContentHeight`.** Implement per **Internal Structure**, step 3: flush any `_pendingCodeUpgrades` entry that has become visible (via `applyCodeEditorUpgrade`, with no further `measureContentHeight` call from inside `syncCodeEditors` — the caller is already inside one), then re-sync every already-applied entry's width from its wrapper's current `clientWidth`. Insert the call as the first line of `measureContentHeight`, before its `scrollHeight` read, since a freshly-applied wrapper's height must be committed before `Markdown`'s own content height is measured. Check: a `_pendingCodeUpgrades` entry with `isEffectivelyVisible()` forced `false` is left in place after calling `syncCodeEditors`; forced `true`, it is applied and removed.

6. **Markdown.ts — add `loadCodeEditorUpgrade`.** Implement per **Internal Structure**, step 2: the two-import `Promise.all`, the generation-staleness check, and the visibility branch (`applyCodeEditorUpgrade` + `measureContentHeight()` vs. pushing to `_pendingCodeUpgrades`). Check: with a faked dynamic import (see **Expected Behaviour**), a resolve after `setMarkdown` was called again is a no-op; a resolve while `isEffectivelyVisible()` is `false` queues instead of applying.

7. **Markdown.ts — rewrite `appendCode`.** Keep building the plain `<pre><code>` pair exactly as today. After building it, call `mapFenceLangToEditorId(token.lang)`; if it returns an id, create the `ts-ui-md-code-host` wrapper via `this.create("div")`, add `CODE_HOST_CLASS`, append the `<pre>` into the wrapper (instead of `parent`) and the wrapper into `parent`, then register `this.onFirstLayout(() => void this.loadCodeEditorUpgrade(wrapper, pre, code, token.text, id, this._renderGeneration))` — not a direct call, so the dynamic import waits for `Markdown`'s first connected+displayed layout (see **Architecture Decisions**). If it returns `null`, append the `<pre>` straight into `parent` — today's exact path, byte-for-byte unchanged. Check: a fenced block with no info string, or an unmapped language (e.g. `python`), still renders identically to the current behaviour — regression-test this against the existing `appendCode` test cases; a `Markdown` constructed with `{ displayed: false }` and a supported-language block makes zero calls to the dynamic-import loader until displayed.

8. **Markdown.ts — extend `clearContent` and `destructor`.** In `clearContent`, add `this._renderGeneration += 1;` and the `_codeEditors` disposal loop (dispose each, clear the array) plus `this._pendingCodeUpgrades.length = 0;`, alongside the existing handle-release loop. In `destructor`, insert `this.clearContent();` as the first line, before `this._unsubscribeTheme()`. Check: `grep -n "clearContent" Markdown.ts` shows the call from both `setMarkdown` and `destructor`.

9. **Tests — offline structural coverage.** `CodeEditor` mounts nothing under the modelled/offline `DOMSink` (its `_view` stays `null`; see [CodeEditor.ts:103-114](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L103)), so the offline suite can assert the *structural* outcome — the plain `<pre>` is replaced by a `ts-ui-md-code-host` wrapper containing a `CodeEditor`-shaped element, with the right cached `language` — without asserting real highlighting. Await the dynamic import's microtask (`await Promise.resolve()` a couple of times, or await a small helper) so the test doesn't need to fake the module loader.

10. **Manual verification.** Run the docs app (`npm run docs:dev`) and confirm, in a real browser: a `javascript`/`json`/`html`/`sql`/`markdown` fenced block renders with colour syntax highlighting at the correct width, height, and document position (including nested inside a blockquote or list item); an unsupported language (e.g. `python`) still renders as plain text; `DocsDemo`'s "Show source" panel (constructed with `displayed: false`) shows correctly highlighted TypeScript once toggled open, at the correct height (see **Expected Behaviour**).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` (add coverage per **Expected Behaviour**) |

No changes to `CodeEditor.ts`, `LanguageRegistry.ts`, `languages.ts`, `index.ts`, or `vite.lib.config.ts`.

---

## Expected Behaviour

- A fenced block with info string `js`, `javascript`, `ts`, `typescript`, `json`, `html`, `sql`, or `markdown` (any case) upgrades to a `CodeEditor`; the mapping table's every row is a distinct test case. **Unit-testable** (assert the mapped id via `mapFenceLangToEditorId`).
- A fenced block with no info string, or an unrecognised one (`python`, `rust`, a typo), renders the plain `<pre class="ts-ui-md-pre"><code>` exactly as today — no wrapper, no dynamic import triggered. **Unit-testable.**
- After the dynamic import resolves for a visible `Markdown`, the placeholder `pre`/`code` handles are gone from `_contentHandles`, a `CodeEditor` instance exists in `_codeEditors`, and its cached `getLanguage()` matches the mapped id. **Unit-testable** (offline; real CodeMirror rendering is not).
- Calling `setMarkdown()` again before a pending dynamic import resolves: the stale resolution is a no-op (no orphaned `CodeEditor` gets constructed against a torn-down wrapper). **Unit-testable** via the generation-token check.
- Disposing a `Markdown` with live `CodeEditor` children calls `dispose()` on each of them (assert via a spy on `CodeEditor.prototype.dispose`, or by checking the editor's own post-dispose state). **Unit-testable.**
- A `Markdown` instance constructed with `{ displayed: false }` and a supported-language fenced block does not call `loadCodeEditorUpgrade` at all until it is displayed and laid out — the dynamic import itself is deferred, not just the DOM swap. **Unit-testable** by spying on the dynamic-import loader and asserting zero calls while hidden.
- A `CodeEditor` upgrade that resolves while `isEffectivelyVisible()` is `false` (shown, then hidden again before the import settled) is deferred, then applied the next time `measureContentHeight` runs after the component becomes visible again (mirroring `DocsDemo`'s existing `setDisplayed(true)` → `afterNextLayout` re-measure dance). **Manual-verify** — needs a real layout pass and cannot be driven by the offline harness's modelled geometry.
- Real syntax colouring, correct on-page width/height/position (including nested inside a blockquote/list item), and the horizontal-scroll behaviour of an unwrapped long line inside the editor. **Manual-verify only** — `CodeEditor` is a live-only component ([CodeEditor.ts:103-114](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L103)).
- `DocsDemo`'s "Show source" panel — a `Markdown` instance constructed with a fenced `typescript` block and `{ displayed: false }` — renders its TypeScript source with real highlighting once "Show source" is toggled, at the correct height with no residual dead space or clipping. **Manual-verify.**

---

## Verification

- `npm run typecheck` (packages/lib) — zero errors.
- `npm test` (packages/lib) — the new `Markdown` cases from **Expected Behaviour**, plus the full existing suite green (no regression to `appendCode`'s current fallback path).
- `npm run build:lib` — confirms the dynamic import specifiers resolve and the build succeeds; inspect the emitted `dist/lib/component/display.es.js` for the absence of a static `@codemirror` or `lexical` specifier (`grep -c "@codemirror\|lexical" dist/lib/component/display.es.js` should be `0`), and confirm a separate async chunk exists containing `CodeEditor`.
- Manual smoke test per **Ordered Implementation Steps**, step 10.

---

## Potential Challenges

- **Line-height mismatch between the placeholder `<pre>` and CodeMirror's own rendering** could leave the editor's pinned height a few pixels short (showing `.cm-scroller`'s own internal scrollbar for a sliver of overflow) or a few pixels tall (a thin gap). Both `<pre>` and `CodeEditor` use the same `--ts-ui-font-mono` font, so the risk is small; accepted as a v1 limitation rather than adding a corrective remeasure, which would require `CodeEditor` to expose an internal content-height reading it does not have today (out of scope — see **Non-Goals**).
- **A fenced block nested inside a table cell** (GFM tables don't usually contain code fences, but `Markdown`'s `appendBlockTokens` recursion doesn't forbid it) exercises the same wrapper/positioning mechanism as a blockquote or list item; no special-casing needed, but worth including as a manual-verify case if one is easy to construct.
- **Rapid successive `setMarkdown()` calls**, each starting its own dynamic import before the previous resolves: covered by the generation-token check (steps 6 and 8), but confirm with a test that two overlapping calls never produce two live editors for the same block.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](../packages/lib/src/typescript/lib/component/display/Markdown.ts) — the file this plan changes.
- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) — read in full before starting; its own docblock and `mount()` explain the live-widget/offline-null contract this plan relies on.
- [`packages/lib/src/typescript/lib/component/editor/languages.ts`](../packages/lib/src/typescript/lib/component/editor/languages.ts) and [`LanguageRegistry.ts`](../packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts) — the five registered ids and the registry `Markdown` depends on being populated before `setLanguage` runs.
- [`packages/lib/src/typescript/lib/component/tree/TreeRow.ts`](../packages/lib/src/typescript/lib/component/tree/TreeRow.ts) — the precedent for a manually raw-DOM-appended `Component` child, explicitly positioned via `setX`/`setY`/`setWidth`/`setHeight`.
- [`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`](../packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) — the precedent for a generation-token-guarded async operation (`relayout`) and a raw-appended overlay component (`_busySpinner`) outside the laid-out set.
- [`packages/docs/src/shell/DocsDemo.ts`](../packages/docs/src/shell/DocsDemo.ts) — the validation consumer; also the precedent for the `notifyIntrinsicSizeChanged`/`afterNextLayout` re-measure dance a hidden-then-shown `Markdown` already relies on.
- [`packages/lib/vite.lib.config.ts`](../packages/lib/vite.lib.config.ts) — the `external` list and per-subpath entry structure the dynamic-import design depends on.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](../packages/lib/src/typescript/lib/core/DOM.ts) — `getScrollMetrics` (the measurement call) and `mountView`'s docblock (the live-widget/offline contract `CodeEditor` already implements).

---

## Non-Goals

- **No auto-height mode added to `CodeEditor`.** This plan measures the placeholder `<pre>` and sets an explicit pixel height instead of teaching `CodeEditor` to size itself to content — a `CodeEditor`-level feature with its own design surface (interacting with its existing fixed-height/scrolling contract for every other caller), out of scope for wiring it into `Markdown`.
- **No corrective remeasure after mount** for the line-height-mismatch edge case above.
- **No `MarkdownOptions.highlightCode` opt-out flag** — see **Architecture Decisions**.
- **No change to which five languages are registered** — adding a sixth language (e.g. Python) to `CodeEditor` itself is unrelated to this plan.

---

## Notes

[^why-not-addcomponent]: `Component.insertComponent` ([Component.ts:5034-5075](../packages/lib/src/typescript/lib/core/Component.ts#L5034)) always inserts a child's element as a direct child of `getChildHost()` — the container's own root — never at an arbitrary descendant position. A fenced block nested inside a blockquote or list item needs its `CodeEditor` to land inside that nested DOM node, not as a sibling of the blockquote at `Markdown`'s root; `addComponent`/`insertComponent` cannot express that regardless of index, so it is not an option here, independent of any other consideration (disposal, preferred-size propagation, etc.). The raw-append pattern trades those `_components` conveniences (auto-dispose via `disposeAllComponents`, preferred-size propagation) for exact DOM placement — `Markdown` reproduces the disposal half itself (see "Teardown disposes every live `CodeEditor`" below) and does not need preferred-size propagation, since it drives the editor's size explicitly rather than negotiating it.

[^position-carveouts]: ARCHITECTURE.md lists exactly two carve-outs from `position: absolute` for a `Component`: `Position.FIXED` (viewport-anchored overlays) and `Position.STATIC` (currently only `Legend`, for the `<legend>` element's native in-flow semantics). Neither fits a fenced code block, and introducing a third carve-out is explicitly called out as "a design decision — surface it in a plan rather than slipping it into a code change" — which this plan declines to do, since the wrapper-`<div>` approach solves the problem without one.

[^absolute-no-autoheight]: An absolutely positioned element is removed from normal flow and does not contribute to an ancestor's auto (content-based) height, even when that ancestor is `position: relative` — this is why the wrapper needs an explicit pixel height rather than being left to size itself around its now out-of-flow child. This also rules out a simpler-looking alternative: leaving `CodeEditor`'s own outer element at its default (never-called-`setHeight`) `height: auto` does not make it size to its CodeMirror content the way a normal block would, because `.cm-editor`'s own `height: 100%` rule ([theme.ts:42](../packages/lib/src/typescript/lib/component/editor/theme.ts#L42)) resolves against `CodeEditor`'s own box, not the wrapper.

[^glyph-theme-not-precedent]: The brief driving this plan hypothesized `Glyph`'s icon loading and `Theme.ts`'s font loading as precedent for an async-upgrade-of-a-sync-rendered-subtree pattern; neither turned out to fit. `Glyph` registers icon SVGs synchronously from a pre-built registry (no dynamic import). `Theme.ts`'s `ensureFontLoaded` ([Theme.ts:1226-1253](../packages/lib/src/typescript/lib/core/Theme.ts#L1226)) uses the browser's native `font-display: swap` CSS mechanism — the font swaps in via the CSS engine once downloaded, with no JS-driven DOM replacement — a different mechanism entirely from swapping one rendered subtree for another. The actual precedent this plan follows, `DiagramView.relayout`'s generation-token-guarded async recompute, is cited in the body.

[^opt-in-rejected]: An opt-in flag was considered and rejected. Its only purpose would be letting a consumer keep plain `<pre>` for a supported language on purpose (e.g. to avoid CodeMirror's extra DOM weight for a one-line snippet) — a real but narrow use case with no request behind it yet. Per CODE_CONVENTIONS.md's "no flexibility that wasn't requested," this plan does not add it; a future plan can add `highlightCode?: boolean` (default `true`) if a consumer needs to opt out, without touching this plan's design.
