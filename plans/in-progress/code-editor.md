# CodeEditor Component — Implementation Plan

## Overview

A new **`CodeEditor`** component wrapping **CodeMirror 6**, providing **syntax highlighting** and **one-command code formatting** — explicitly *no* IntelliSense, no TypeScript language service, no virtual FS. It lives in a new subpath package `component/editor`, mirroring the per-directory barrel + Vite-entry convention every other component group already follows (see [`vite.lib.config.ts`](vite.lib.config.ts#L28)).

CodeMirror owns and mutates its own DOM subtree directly — it is a *foreign live widget*, exactly like the `RenderingContext` a [`Canvas`](src/typescript/lib/component/display/Canvas.ts#L126) obtains from the seam. So `CodeEditor` is a **live-only** component: under the modelled test sink it mounts nothing and every editor path no-ops, matching `Canvas` / `WebGLCanvas`. The only new DOM-seam surface is a single mount method (the second named escape from the seam's one-way contract, after `getContext`), and CodeMirror is imported *only* inside `component/editor`, never in `core/DOM.ts`, so the core bundle never pulls it in.

Highlighting grammars, and the optional per-language formatter, both load through dynamic `import()` on demand, so the base editor chunk stays ~130–180 KB and the (large) Prettier standalone bundle never reaches the base bundle. The initial registry is JS/TS, JSON, HTML, SQL, Markdown; adding a language is one `registerLanguage(...)` call.

---

## Architecture Decisions

### New subpath package `component/editor`

CodeEditor gets its own directory `src/typescript/lib/component/editor/` and its own build entry, rather than joining `component/display` (where `Markdown` lives). This keeps CodeMirror + Prettior + sql-formatter out of the display chunk — a consumer importing only `Markdown` must not drag in CodeMirror. Adding the subpath requires four coordinated edits (the [subpath-resolution gotcha](src/typescript/lib/glyphs) the project has hit before): a `paths` entry in [`tsconfig.json`](tsconfig.json#L21), an `entry` in [`vite.lib.config.ts`](vite.lib.config.ts#L45), an `exports` block in [`package.json`](package.json#L74), and the barrel `index.ts`. The `tsconfig.lib.json` `include` glob already covers new files, so no change there.

### CodeMirror is a foreign live widget behind the seam — `CodeEditor` is live-only

The DOM seam forbids any module outside `core/DOM.ts` from holding an `Element`/`Node`/`HTMLElement` reference ([`no-raw-dom.js`](scripts/eslint/no-raw-dom.js#L59) *hold* clause), and all DOM writes go through `DOM.sink`. CodeMirror's `EditorView` breaks both assumptions by design: it takes a real parent element and directly mutates a whole DOM region it owns. This is **not** a violation to paper over — it is the same accepted escape `getContext` already documents: *"Unlike every other sink method this returns a live object … the single, named escape from the seam's one-way contract — the reason a canvas is a live-only component"* ([`DOM.ts`](src/typescript/lib/core/DOM.ts#L714)). `EditorView` is a CodeMirror type, not a DOM-lib element type, so — like `Canvas` holding a `CanvasRenderingContext2D` and `WebGLCanvas` holding a `WebGL2RenderingContext` — `CodeEditor` may hold it without tripping `no-raw-dom`.

The seam gets **one** new `DOMSink` method that resolves a handle to its real element and hands it to a caller-supplied factory, returning whatever the factory builds (or `null` offline):

```typescript
mountView<T>(handle: Handle, factory: (parent) => T): T | null;
```

`CodeEditor` calls `DOM.sink.mountView(el, (parent) => new EditorView({ parent, state }))`. The factory's `parent` parameter is **left unannotated** — its `HTMLElement` type is inferred from the seam signature, so no `TSTypeReference` naming a DOM type appears in `CodeEditor.ts` and the *hold* clause does not fire. CodeMirror's `EditorViewConfig.parent` accepts the inferred element structurally. The production sink calls the factory with the resolved element; the modelled test sink returns `null`, so `CodeEditor` never constructs an `EditorView` offline and every editor operation guards on a `null` view — the live-only pattern, identical to `Canvas.getContext`.

After mount, **all** interaction is `EditorView`/`EditorState` API (`view.dispatch`, `view.state`, `view.focus`, compartments) — `CodeEditor` never touches the editor's inner DOM, so there is no other seam bypass. The component's *own* outer element is styled through normal typed setters like any component.

### Extends `Component`, mounts at first connected layout

`CodeEditor extends Component<CodeEditorOptions>` — a leaf with no framework children (CodeMirror owns the subtree), so no `LayoutManager` and no `Panel` child machinery. The `EditorView` is constructed in [`onFirstLayout`](src/typescript/lib/core/Component.ts#L4653), which fires once the element exists, is connected, and has been sized — precisely CodeMirror's requirement for correct internal scroll measurement. The editor fills the component's assigned box and scrolls **internally** (CodeMirror's own scroller); the component itself reports no content-derived size (unlike `Markdown`, which measures flowed height). Consumers give it a sized host (a `Fit` panel or an explicit `preferredSize`), the same as `Canvas`.

### Lean, curated extension set — no autocomplete, no lint

Rather than CodeMirror's `basicSetup` (which bundles `@codemirror/autocomplete` and `@codemirror/lint`), the base editor composes an explicit extension list from `@codemirror/view`, `@codemirror/state`, `@codemirror/commands`, and `@codemirror/language`: history, default + history keymaps, `drawSelection`, `lineNumbers`, `highlightActiveLine`(+gutter), `indentOnInput`, `bracketMatching`, and `syntaxHighlighting`. Excluding the autocomplete/lint packages honours the "no IntelliSense" scope *and* keeps the base chunk lean.

### Per-language registry with lazy grammar + optional lazy formatter

A module-level registry maps a language `id` to a `LanguageDefinition { id, label?, loadExtension, loadFormatter? }`. `loadExtension` dynamically `import()`s the `@codemirror/lang-*` grammar; the optional `loadFormatter` dynamically `import()`s a formatter adapter. The active language is swapped at runtime through a CodeMirror `Compartment` (reconfigure, not view-rebuild). Because the grammar packages are `external` in the lib build, Rollup preserves the `import()` calls as runtime dynamic imports resolved from the consumer's `node_modules` — real lazy loading with no base-bundle cost.

### `format()` is async, cursor-preserving, and never destroys content

`format()` returns a `Promise<void>`. It resolves the active language's `loadFormatter`; if none, it runs CodeMirror's built-in re-indent command over the whole document (synchronous fallback). If a formatter exists, it is dynamically imported (and cached), invoked with the current document text, and — on success — the whole document is replaced in a single transaction whose selection is mapped through the formatter's returned cursor offset (Prettier's `formatWithCursor`; sql-formatter has no cursor map, so the old offset is clamped to the new length). Scroll is left to CodeMirror (no `scrollIntoView` on the transaction). If the formatter **throws** (invalid syntax), the error is caught, the document is left **untouched**, and the promise rejects so the caller can surface it — the user's content is never lost.

### Theming maps onto the CSS-custom-property tokens

CodeMirror is themed by an `EditorView.theme({...})` extension whose colours reference the project's theme tokens directly — `var(--ts-ui-input-bg)`, `var(--ts-ui-text-color)`, `var(--ts-ui-font-mono, …)`, `var(--ts-ui-border-color)`, `var(--ts-ui-indicator-focus)`, `var(--ts-ui-indicator-selection)` — each with a light/dark-safe fallback, mirroring how [`Markdown`](src/typescript/lib/component/display/Markdown.ts#L57) references tokens. A `syntaxHighlighting(HighlightStyle.define([...]))` extension maps Lezer highlight `tags` to token-driven colours. Because the theme reads live CSS vars, a `ThemeManager.setTheme` toggle recolours the editor with no rebuild; the component still subscribes to [`ThemeManager.onThemeChange`](src/typescript/lib/core/Theme.ts#L1205) to reconfigure the theme compartment for the `dark`/`light` flag (`--ts-ui-color-scheme`) and unsubscribes on `dispose`, mirroring `Markdown`.

### Dependencies are external, formatters are lazy

Like [`marked`](vite.lib.config.ts#L51), every new package is a real runtime `dependency` marked `external` in the lib build — never inlined — so it resolves from the consumer's (sqladmin's) `node_modules`. CodeMirror core (state+view+commands+language + one grammar) is ~150 KB and is statically imported into the base editor chunk; Prettier standalone (~1.5 MB with plugins) and sql-formatter are **only** ever reached through dynamic `import()` inside a `loadFormatter`, so they cannot land in the base bundle. The existing `keepNames` minify config ([`vite.lib.config.ts`](vite.lib.config.ts#L60)) already preserves `CodeEditor`'s class identifier (needed for the framework's `constructor.name`-based CSS class + layout serialization); CodeMirror is external, so its own minification is the consumer build's concern.

---

## Public API

```typescript
// component/editor/CodeEditor.ts
export interface CodeEditorOptions extends ComponentOptions {
    /** Initial document text (also accepted as the positional first arg). */
    value?: string;
    /** Registered language id (e.g. "javascript", "json", "sql"). Unset → plain text. */
    language?: string;
    /** Whether the editor is read-only. Default false. */
    readOnly?: boolean;
    /** Construction-time listener bag; the only event is "change". */
    listeners?: { change?: (payload: CodeEditorChange) => void };
}

export interface CodeEditorChange { value: string; }
type CodeEditorEvent = "change";

class CodeEditor extends Component<CodeEditorOptions> {
    constructor(value?: string, options?: CodeEditorOptions);

    // Value — backing store is the live EditorState (cached to _options.value pre-mount / offline).
    getValue(): string;
    setValue(value: string): this;

    // Active language — swaps the grammar Compartment, lazy-loading the grammar.
    getLanguage(): string | null;
    setLanguage(id: string | null): this;   // async grammar load applied when it resolves

    // Read-only — reconfigures a readOnly Compartment.
    getReadOnly(): boolean;
    setReadOnly(readOnly: boolean): this;

    /** Formats the document via the active language's formatter, or re-indents if none. */
    format(): Promise<void>;

    // Custom "change" event via ListenerBag (fires on document change).
    on(event: CodeEditorEvent, fn: (payload: CodeEditorChange) => void): this;
    off(event: CodeEditorEvent, fn: (payload: CodeEditorChange) => void): this;
}

// callable() wrapped; exported as `CodeEditor` / `_CodeEditor` per convention.
```

```typescript
// component/editor/LanguageRegistry.ts
import type { Extension } from "@codemirror/state";

export type Formatter = (source: string, cursorOffset: number) =>
    Promise<{ formatted: string; cursorOffset: number }> | { formatted: string; cursorOffset: number };

export interface LanguageDefinition {
    id: string;
    label?: string;
    loadExtension: () => Promise<Extension>;
    loadFormatter?: () => Promise<Formatter>;
}

export function registerLanguage(def: LanguageDefinition): void;
export function getLanguage(id: string): LanguageDefinition | undefined;
export function listLanguages(): readonly LanguageDefinition[];
```

```typescript
// core/DOM.ts — new DOMSink method (seam-exempt; the second named escape after getContext)
mountView<T>(handle: Handle, factory: (parent: HTMLElement) => T): T | null;
```

**State-bearing property routing.** `value` → `EditorState` doc when mounted, cached in `_options.value` before mount / offline; `getValue` reads the view when present, else `_options.value ?? ""`. `language` → grammar `Compartment`, cached in `_options.language`. `readOnly` → readOnly `Compartment`, cached in `_options.readOnly`. All three are `CodeEditorOptions` fields dispatched from `applyOptions`. The `listeners` bag is dispatched via `this.applyListeners(options?.listeners)` from the **constructor body** after `super()` (per [ARCHITECTURE.md](ARCHITECTURE.md) Event handling). Fields the cascade-dispatched setters write (`_view`, `_unsubscribeTheme`) must use `declare` per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md).

---

## Internal Structure

### Files in `component/editor/`

- **`CodeEditor.ts`** — the component. Holds `declare private _view: EditorView | null` (the foreign live widget, `null` until mount / offline), the three `Compartment`s (`_langCompartment`, `_readOnlyCompartment`, `_themeCompartment`), and `_unsubscribeTheme`. Mounts in `onFirstLayout`; emits `change` from a CodeMirror `updateListener`.
- **`LanguageRegistry.ts`** — module-level `Map<string, LanguageDefinition>`, `registerLanguage` / `getLanguage` / `listLanguages`. No CodeMirror import beyond the `Extension` *type*.
- **`languages.ts`** — registers the five built-ins; each entry's `loadExtension`/`loadFormatter` is a dynamic-import arrow. Imported for side-effect from the barrel.
- **`theme.ts`** — builds the `EditorView.theme(...)` + `HighlightStyle` extensions from the CSS tokens; exports a `codeEditorTheme(dark: boolean): Extension`.
- **`formatters/prettier.ts`** — a shared adapter: `formatWithPrettier(parser, plugins loader)` dynamically imports `prettier/standalone` + the parser plugins and calls `formatWithCursor`. Reused by JS/TS, JSON, HTML, Markdown entries.
- **`formatters/sql.ts`** — dynamically imports `sql-formatter`, returns `{ formatted, cursorOffset: clamp(old, formatted.length) }`.
- **`index.ts`** — barrel: re-exports `CodeEditor`, `CodeEditorOptions`, `CodeEditorChange`, the registry API, and imports `languages.ts` for its registration side-effect.

### Built-in language entries (`languages.ts`)

| id | grammar (`loadExtension`) | formatter (`loadFormatter`) |
|---|---|---|
| `javascript` | `@codemirror/lang-javascript` → `javascript({ typescript: true })` | Prettier `babel-ts` |
| `json` | `@codemirror/lang-json` → `json()` | Prettier `json` |
| `html` | `@codemirror/lang-html` → `html()` | Prettier `html` |
| `sql` | `@codemirror/lang-sql` → `sql()` | `sql-formatter` |
| `markdown` | `@codemirror/lang-markdown` → `markdown()` | Prettier `markdown` |

### Mount sequence (in `onFirstLayout`)

1. Guard: if a `_view` already exists, return (idempotent).
2. Build the base extension list + `_readOnlyCompartment.of(...)` + `_themeCompartment.of(codeEditorTheme(dark))` + `_langCompartment.of([])` + an `EditorView.updateListener` that emits `change` on `update.docChanged`.
3. `EditorState.create({ doc: _options.value ?? "", extensions })`.
4. `this._view = DOM.sink.mountView(el, (parent) => new EditorView({ parent, state }))` — `null` offline.
5. If `_options.language` is set, kick off `setLanguage(id)` so the grammar loads and reconfigures the compartment when it resolves.

---

## Ordered Implementation Steps

1. **Add dependencies** to `package.json` `dependencies`: `codemirror`, `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lang-javascript`, `@codemirror/lang-json`, `@codemirror/lang-html`, `@codemirror/lang-sql`, `@codemirror/lang-markdown`, `@lezer/highlight`, `prettier`, `sql-formatter`. Run `npm install`. → verify: `node -e "require.resolve('@codemirror/view')"`.
2. **Extend the DOM seam.** Add `mountView<T>(handle, factory): T | null` to the `DOMSink` interface, `ProductionDOMSink` (resolve the handle, call the factory), and the modelled/recording test sink (return `null`). → verify: `npm run typecheck`; the recording sink compiles.
3. **`LanguageRegistry.ts`** — the `Map`, `registerLanguage` / `getLanguage` / `listLanguages`, `LanguageDefinition` / `Formatter` types. → verify: unit test round-trips a registered definition.
4. **`formatters/prettier.ts` + `formatters/sql.ts`** — the lazy adapters. → verify: typecheck (behaviour verified in step 9 tests).
5. **`languages.ts`** — register the five built-ins with dynamic-import loaders.
6. **`theme.ts`** — `codeEditorTheme(dark)` from the CSS tokens + `HighlightStyle`.
7. **`CodeEditor.ts`** — the component: options/setters/getters, compartments, `onFirstLayout` mount, `format()`, `change` emit, `dispose` (unsubscribe theme + `_view?.destroy()`). Wrap with `callable()`; export `_CodeEditor` / `CodeEditor`. Route the `listeners` bag through `applyListeners` from the constructor body. → verify: `npm run test:lint` (`no-raw-dom`, `forward-super-options`, `no-element-style` stay green — confirm the unannotated factory param does not trip *hold*).
8. **`index.ts` barrel** + wire the subpath: `tsconfig.json` `paths`, `vite.lib.config.ts` `entry` + `external` (extend the array to include the CodeMirror/Prettier/sql-formatter packages, or switch to a regex predicate), `package.json` `exports` (`./component/editor`). → verify: `grep -rn "component/editor" tsconfig.json vite.lib.config.ts package.json` shows all three; `npm run build:lib` emits `dist/lib/component/editor.es.js` and does **not** inline CodeMirror/Prettier.
9. **Unit tests** for the DOM-free logic: registry, `format()` dispatch (formatter-present vs. re-indent fallback vs. formatter-throws-content-preserved), cursor clamp. → verify: `npm run test`.
10. **Demo panel** `src/typescript/CodeEditorPanel.ts` (import from `@jimka/typescript-ui/component/editor`) + register in `main.ts`, mirroring `MarkdownPanel`. → verify: `npm run dev`, open the panel.
11. **Docs**: `docs/components/CodeEditor.md` + sidebar entry in `docs/.vitepress/config.mts`; JSDoc on all exports. → verify: `npm run docs:build` finishes with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/editor/CodeEditor.ts` |
| Create | `src/typescript/lib/component/editor/LanguageRegistry.ts` |
| Create | `src/typescript/lib/component/editor/languages.ts` |
| Create | `src/typescript/lib/component/editor/theme.ts` |
| Create | `src/typescript/lib/component/editor/formatters/prettier.ts` |
| Create | `src/typescript/lib/component/editor/formatters/sql.ts` |
| Create | `src/typescript/lib/component/editor/index.ts` |
| Create | `src/typescript/CodeEditorPanel.ts` (demo) |
| Create | `docs/components/CodeEditor.md` |
| Create | `tests/component/code-editor.test.ts` (registry + format dispatch) |
| Modify | `src/typescript/lib/core/DOM.ts` (add `mountView` to interface + production + modelled sinks) |
| Modify | `package.json` (deps + `exports`) |
| Modify | `vite.lib.config.ts` (entry + external) |
| Modify | `tsconfig.json` (`paths`) |
| Modify | `src/typescript/main.ts` (register demo panel) |
| Modify | `docs/.vitepress/config.mts` (sidebar entry) |
| Modify | `tests/component/default-options-fallback.test.ts` (row for any `CodeEditor` defaulted field, per the default-resolution registry rule) |

---

## Expected Behaviour

**Unit-testable (DOM-free logic, modelled sink):**

- `registerLanguage` + `getLanguage` round-trip; `getLanguage("nope")` → `undefined`; `listLanguages()` includes the five built-ins after the barrel side-effect import.
- `format()` with a formatter-less language runs the re-indent fallback path (assert the fallback branch is taken; the actual re-indent is CodeMirror's and needs a live view — manual).
- `format()` dispatch: given a stub formatter that returns `{ formatted, cursorOffset }`, the promise resolves; given a stub that **throws**, the promise **rejects** and `getValue()` is unchanged (content preserved). *(Test against the dispatch logic factored to not require a live `EditorView` — the formatter call + error handling is pure; the transaction application is guarded on `_view`.)*
- sql-formatter cursor clamp: old offset beyond new length clamps to `formatted.length`.
- Offline (`_view === null`): `getValue()` returns `_options.value ?? ""`; `setValue` caches to `_options.value`; `setLanguage`/`setReadOnly`/`format()` no-op or resolve without throwing.
- `applyOptions` forwards `value` / `language` / `readOnly`; the `listeners.change` bag is wired (a plain `new CodeEditor({ listeners: { change } })` registers).
- Default-options fallback: any field `CodeEditor` defaults resolves through its getter (registry-test row).

**Manual-verify (live-only — requires a browser, CodeMirror mounts):**

- Syntax highlighting renders for each of the five languages.
- `format()` reformats JS/TS, JSON, HTML, Markdown (Prettier) and SQL (sql-formatter); cursor stays at the logically-equivalent position; scroll is not thrown to the top.
- `format()` on syntactically-invalid JS leaves the document unchanged (no content loss) and the promise rejects.
- Formatter-less language: `format()` re-indents the document.
- `setLanguage` swap changes highlighting without losing document text; grammar loads lazily (visible as a separate network chunk).
- `setReadOnly(true)` blocks edits; `false` restores them.
- Theme toggle recolours the editor (background, text, selection, syntax) with no rebuild flicker.
- Editor fills its host box and scrolls internally when the document exceeds the box.
- Base editor chunk stays ~130–180 KB; Prettier/sql-formatter appear only as lazily-loaded chunks on first `format()`.

---

## Verification

- `npm run typecheck` — clean.
- `npm run test:lint` — `no-raw-dom` green (the unannotated `mountView` factory param must not trip *hold*; `EditorView`/`Compartment`/`EditorState` are foreign types, not DOM-lib element types); `forward-super-options`, `no-element-style` green.
- `npm run test` — the registry + format-dispatch unit tests.
- `npm run build:lib` — emits `dist/lib/component/editor.es.js`; inspect it to confirm CodeMirror/Prettier/sql-formatter are `import`ed (external), not inlined, and that Prettier appears only behind dynamic `import()`.
- `npm run dev` — exercise the `CodeEditorPanel`: highlighting, `format()` (all five languages + invalid-input case), language swap, read-only, theme toggle, internal scroll.
- `npm run docs:build` — zero warnings.

---

## Documentation Impact

- Export surface: `CodeEditor`, `CodeEditorOptions`, `CodeEditorChange`, and the registry API are exported from the new `component/editor` barrel (public subpath `@jimka/typescript-ui/component/editor`).
- Doc page: `docs/components/CodeEditor.md`, following `docs/components/Markdown.md`'s shape (intro, Usage, Construction table, supported languages, `format()` semantics, live-only note). Cross-reference the generated API page `/api/component/editor/classes/CodeEditor`.
- Sidebar: add a `{ text: 'CodeEditor', link: '/components/CodeEditor' }` entry in `docs/.vitepress/config.mts` alongside the `Markdown` entry (line ~115).
- JSDoc: every exported symbol documented; per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), public JSDoc must not `{@link}` internal symbols — describe the seam/registry mechanics in prose.
- Note the new runtime dependencies (CodeMirror, Prettier, sql-formatter) are installed transitively, like `marked`.

---

## Potential Challenges

- **`no-raw-dom` *hold* clause on the factory param.** The `mountView` factory's `parent` must be left unannotated so no `TSTypeReference` names `HTMLElement` in `CodeEditor.ts`; if an annotation creeps in, the lint fails. Mitigation: rely on the inferred type from the seam signature; verify with `npm run test:lint` immediately after writing the mount call.
- **Externalizing a whole package family.** The current `external: ['marked']` is a literal array; adding ~13 packages is error-prone. Mitigation: switch to a predicate matching `/^(codemirror|@codemirror\/|@lezer\/|prettier|sql-formatter|marked)/`.
- **Dynamic import of externals must survive the lib build.** Rollup should preserve `import()` of an external as a runtime dynamic import; confirm the built chunk still contains `import("prettier/standalone")` rather than an inlined copy.
- **Cursor/scroll preservation across a full-doc replace.** Prettier's `formatWithCursor` handles the cursor; sql-formatter cannot, so clamp. Do not add `scrollIntoView` to the format transaction, or the view jumps.
- **Live-only test coverage gap.** CodeMirror cannot mount under the modelled sink, so highlighting/formatting output is manual-verify. Mitigation: factor `format()`'s formatter-call + error handling to be unit-testable without a live view; keep the transaction application guarded on `_view`.
- **`onFirstLayout` timing.** The mount needs a connected, sized element; `onFirstLayout` guarantees this. Constructing the `EditorView` earlier (in `render`) risks a zero-height editor that never scrolls.
- **Base-bundle budget.** Using `basicSetup` would pull autocomplete/lint and blow the budget + violate scope; the curated extension list is load-bearing, not a style choice.

---

## Critical Files

- [`src/typescript/lib/component/display/Canvas.ts`](src/typescript/lib/component/display/Canvas.ts) — the live-only + foreign-live-object pattern (`getContext` → `null` offline) `CodeEditor` mirrors.
- [`src/typescript/lib/component/display/Markdown.ts`](src/typescript/lib/component/display/Markdown.ts) — third-party-library wrapper, positional-arg + options-bag constructor, theme-token CSS refs, `ThemeManager.onThemeChange` + `dispose`.
- [`src/typescript/lib/core/DOM.ts`](src/typescript/lib/core/DOM.ts) — the `DOMSink`/`DOMSource` seam and the `getContext` escape (L708–726) the new `mountView` mirrors.
- [`scripts/eslint/no-raw-dom.js`](scripts/eslint/no-raw-dom.js) — the *hold* clause the factory param must avoid.
- [`vite.lib.config.ts`](vite.lib.config.ts) — entry map, `external`, `keepNames` minify.
- [`tsconfig.json`](tsconfig.json) / [`package.json`](package.json) — subpath `paths` + `exports` the new package must join.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — event handling (`listeners` bag / `applyListeners`, `on`/`off`/`emit`), typed setters, callable export, one-DOM-element-per-class.
- [`src/typescript/MarkdownPanel.ts`](src/typescript/MarkdownPanel.ts) / [`docs/components/Markdown.md`](docs/components/Markdown.md) — demo-panel + doc-page templates.

---

## Non-Goals

- **IntelliSense / TypeScript language service / virtual FS** — out of scope by decision; the curated extension set deliberately omits `@codemirror/autocomplete` and `@codemirror/lint`.
- **CSS language** — explicitly skipped from the initial registry (extensible later via `registerLanguage`).
- **Off-main-thread formatting** — formatting runs on the main thread with lazy `import()`. A Web Worker is a deferred future option *behind the same `format()` API* — the `format()` promise contract already accommodates it, so no API change is needed to add it later.
- **Format-on-blur / format-on-save toggles** — speculative config; not added. Consumers wire `format()` to whatever trigger they want.
- **A form-input binding surface (`"binding"` event, `Model` binding)** — `CodeEditor` exposes only a `change` event; full data-binding parity with input controls is not in scope.
- **Diff / merge view, collaborative editing, minimap** — not part of highlighting + formatting.
