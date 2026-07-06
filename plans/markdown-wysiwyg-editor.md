---
depends-on: [code-editor]
touches-shared: [src/typescript/lib/core/DOM.ts]
---

# MarkdownEditor Component — Implementation Plan

## Overview

A new **`MarkdownEditor`** component: a **WYSIWYG rich-text editor** built on **Lexical** whose public value is a **Markdown string**. It edits a document as rendered rich text (no visible markup) and reads/writes Markdown through `@lexical/markdown`'s bidirectional converters — markdown string → editor state on load, editor state → markdown string on read/change. It is the editing counterpart to the read-only [`Markdown`](src/typescript/lib/component/display/Markdown.ts#L173) viewer and is deliberately scoped to the **exact subset of Markdown the viewer renders**, so a document produced by the editor renders identically in the viewer.

It lives in the new subpath package `component/editor` — the same package [`CodeEditor`](plans/code-editor.md) introduces — mirroring the per-directory barrel + Vite-entry convention every component group follows. Lexical, like CodeMirror, owns and mutates its own `contenteditable` DOM subtree directly (a *foreign live widget*), so `MarkdownEditor` reuses the single `DOMSink.mountView` seam method the CodeEditor plan adds rather than inventing a second mount mechanism. The editor's markdown↔state conversion is pure JS (Lexical's editor state is DOM-free), so the value get/set/round-trip path is **unit-testable offline**; only the live typing/selection/paste surface needs a browser.

This plan **depends on** [`plans/code-editor.md`](plans/code-editor.md): that plan creates the `component/editor` subpath (tsconfig/vite/package.json wiring), the `DOMSink.mountView` seam, the demo-panel + docs scaffolding pattern, and the `external`-package-family predicate in the lib build. If CodeEditor lands first, `MarkdownEditor` only *adds* to that shared surface. If this lands first, it must add `mountView` and the subpath wiring itself (called out per step).

---

## Architecture Decisions

### Name — `MarkdownEditor`

The component's public value is a Markdown string and it is the direct editing counterpart to the `Markdown` viewer, so the symmetric `Markdown` (viewer) / `MarkdownEditor` (editor) pairing is the clearest name in the library. `RichTextEditor` was rejected: it implies an HTML/rich value and a general rich-text surface, whereas this component's contract is specifically "edit Markdown as WYSIWYG, value is Markdown." The name states the serialization format, which is the load-bearing fact for a consumer. Exported `callable()`-wrapped as `MarkdownEditor` / `_MarkdownEditor` per convention ([ARCHITECTURE.md](ARCHITECTURE.md), *Components are exported through `callable()`*).

### Feature set is a strict subset of the `Markdown` viewer's token handlers

The viewer ([`Markdown.ts`](src/typescript/lib/component/display/Markdown.ts#L466)) renders exactly these constructs (everything else falls through to a plain-text fallback):

- **Block:** heading (`<h1>`–`<h6>`), paragraph, list (ordered `<ol>` / unordered `<ul>` with `<li>`), blockquote, fenced code (`<pre><code>`). (`space` between blocks is whitespace only.)
- **Inline:** text, `strong` (bold), `em` (italic), `codespan` (inline code), `link`.

The viewer does **not** render: tables, images, strikethrough, task/checklists, thematic breaks (`hr`), raw HTML — each falls to the plain-text fallback ([`Markdown.ts`](src/typescript/lib/component/display/Markdown.ts#L477)). Therefore the editor's supported operations and — critically — its markdown **emit** are restricted to the list above. This is enforced by using a **curated transformer array**, not Lexical's full `TRANSFORMERS` preset (see next decision).

### Curated `@lexical/markdown` transformer list — the dialect contract

The single most important correctness surface is that the editor's emitted markdown must round-trip through the viewer's `marked` lexer to the same rendered result. Lexical's default `TRANSFORMERS` includes constructs the viewer drops (`STRIKETHROUGH`, `HIGHLIGHT`, `CHECK_LIST`). The editor instead composes an explicit `transformers` array containing only:

| Construct | Lexical transformer | Emits | Viewer token |
|---|---|---|---|
| Heading | `HEADING` | `# `…`###### ` | `heading` |
| Blockquote | `QUOTE` | `> ` | `blockquote` |
| Fenced code | `CODE` | ` ```lang ` fence | `code` |
| Unordered list | `UNORDERED_LIST` | `- ` | `list` (ordered:false) |
| Ordered list | `ORDERED_LIST` | `1. ` | `list` (ordered:true) |
| Bold | `BOLD_STAR` | `**b**` | `strong` |
| Italic | `ITALIC_STAR` | `*i*` | `em` |
| Inline code | `INLINE_CODE` | `` `c` `` | `codespan` |
| Link | `LINK` | `[t](url)` | `link` |

Star (not underscore) variants are chosen for bold/italic so export is deterministic and matches the viewer's demo output. `STRIKETHROUGH`, `HIGHLIGHT`, `CHECK_LIST`, and any table/image transformer are **omitted** so the editor can never produce markup the viewer would drop to plain text. This curated array is the single source of truth passed to `$convertFromMarkdownString`, `$convertToMarkdownString`, and `registerMarkdownShortcuts`.

### Lexical is a foreign live widget behind the seam — reuse `DOMSink.mountView`

Lexical's editing view is a `contenteditable` element that Lexical directly owns and mutates. Like CodeMirror's `EditorView`, this breaks the seam's *no-raw-`Element`-reference* + *all-writes-through-`DOM.sink`* assumptions by design ([`no-raw-dom.js`](scripts/eslint/no-raw-dom.js) *hold* clause). This plan reuses the **exact** seam the CodeEditor plan adds:

```typescript
// core/DOM.ts — added by the CodeEditor plan; reused here unchanged.
mountView<T>(handle: Handle, factory: (parent) => T): T | null;
```

`MarkdownEditor` mounts by making its own root element `contenteditable` and handing it to Lexical inside the factory:

```typescript
this._editor = createEditor({ nodes, theme, onError });   // headless, DOM-free
// ...in onFirstLayout:
DOM.sink.mountView(el, (root) => { this._editor.setRootElement(root); return root; });
```

The factory's `root` parameter is **left unannotated** — its `HTMLElement` type is inferred from the seam signature, so no `TSTypeReference` naming a DOM type appears in `MarkdownEditor.ts` and the *hold* clause does not fire (the identical trick the CodeEditor plan relies on). `LexicalEditor.setRootElement(root)` accepts the inferred element structurally. Offline, `mountView` returns `null`, the factory never runs, `setRootElement` is never called, and the editor stays **headless** — which is exactly what makes conversion testable (next decision). After mount, all interaction is `LexicalEditor`/`EditorState` API (`editor.update`, `editor.read`, `editor.dispatchCommand`, `editor.registerUpdateListener`) — the component never touches Lexical's inner DOM, so there is no other seam bypass.

### The editor is created **headless and always**, so markdown↔state conversion is offline-testable

Unlike CodeMirror (whose value lives in a DOM-bound view), Lexical separates the **editor state** (a pure immutable JS tree) from the **view** (the optional `contenteditable`). `createEditor()` with no root element is fully functional for state reads/writes: `editor.update(() => $convertFromMarkdownString(md, transformers))` and `editor.read(() => $convertToMarkdownString(transformers))` run without any DOM. This is Lexical's headless mode (the basis of `@lexical/headless`). Consequently:

- The `MarkdownEditor` constructs its `LexicalEditor` unconditionally (in `onFirstLayout` for live mount, but conversion works even if `setRootElement` was never called — so the modelled test sink path exercises it).
- `getValue()` / `setValue()` / the dialect round-trip are **real unit tests** against the modelled sink, not manual-verify. This is the key divergence from CodeEditor's "everything live-only" split and the reason the dialect contract can be test-enforced.

The registered node set (`HeadingNode`, `QuoteNode`, `ListNode`, `ListItemNode`, `LinkNode`, `CodeNode`, `CodeHighlightNode`) must be supplied to `createEditor({ nodes })` for the transformers to build/parse those node types — headless or not.

### Setters must be synchronous → Lexical core is statically imported (subpath boundary is the laziness)

The value API (`getValue`/`setValue`) is synchronous, matching every other value-bearing component. Since `$convertFromMarkdownString`/`$convertToMarkdownString` and the transformer constants must be available synchronously, the `@lexical/*` packages are **statically imported** into the editor chunk (marked `external`, resolved from the consumer's `node_modules`, never inlined — like `marked`). A dynamic `import()` would force an async value API and break parity, so it is rejected for the conversion path. The laziness the constraint asks for is delivered by the **subpath boundary**: a consumer who never imports `@jimka/typescript-ui/component/editor` never bundles Lexical at all, and the actual `createEditor` + registration is deferred to `onFirstLayout` so a pre-mount consumer pays only module-eval cost. (Optional future refinement — dynamic-importing the transformer bundle behind an async `ready()` — is a Non-Goal; it would complicate the value API for a lean engine.)

### No toolbar UI in v1 — command API + keyboard + markdown-shortcut typing

Shipping a toolbar means building an active-format-tracking UI coupled to selection state — significant surface that "simplicity first" ([CLAUDE.md](CLAUDE.md)) says to defer. v1 ships the **editing surface** plus three ways to invoke formatting, all provided by Lexical:

1. **Markdown-shortcut typing** — `registerMarkdownShortcuts(editor, transformers)` auto-formats as the user types (`# ` → heading, `**b**` → bold, `- ` → list, `> ` → quote, ` ``` ` → code) using the *same curated transformer list*, so the interaction and the emit agree.
2. **Default keyboard shortcuts** — `registerRichText` wires <kbd>Ctrl/Cmd+B</kbd> (bold), <kbd>Ctrl/Cmd+I</kbd> (italic); `registerHistory` wires undo/redo.
3. **A thin imperative command API** on the component so a consumer can wire their own toolbar from the library's existing `Button`s (composition per [ARCHITECTURE.md](ARCHITECTURE.md) *Compose before specializing*): `toggleBold()`, `toggleItalic()`, `toggleInlineCode()`, `setBlockType(type)` (paragraph / h1–h6 / quote / code), `toggleUnorderedList()`, `toggleOrderedList()`, `toggleLink(url)`. Each body dispatches the corresponding Lexical command / `$setBlocksType` inside `editor.update`.

A built-in toolbar component can be added later behind the same command API with no breaking change.

### Read-only via `editor.setEditable(false)`

A `readOnly` option / `setReadOnly` / `getReadOnly` toggles `editor.setEditable(!readOnly)`. Note: the *display* read-only use case remains the `marked`-based `Markdown` viewer (leaner, no Lexical). `MarkdownEditor`'s read-only exists for the "temporarily lock an editor" case, not as a viewer substitute.

### Theming maps Lexical's class-based theme onto the CSS-custom-property tokens

Lexical themes by a class-name map (`EditorThemeClasses`): `{ heading: { h1: "…" }, quote: "…", code: "…", list: { ul: "…", ol: "…" }, text: { bold: "…", italic: "…", code: "…" }, link: "…" }`. The editor defines module-level `StyleRule`s (per [ARCHITECTURE.md](ARCHITECTURE.md) *CSS writes go through `StyleRule`*) for these classes that **reference the same theme tokens the viewer uses** — `var(--ts-ui-font-mono, …)` for code, `var(--ts-ui-border-color, …)` for the quote bar, `var(--ts-ui-indicator-focus, #2563eb)` for links, `600` heading weight — so the WYSIWYG surface *visually matches* what the viewer renders (the whole point of WYSIWYG). The viewer's class-rule constants are module-private, so these rules are replicated (not imported); the shared contract is the token names, which are documented in the viewer. Because the rules reference live CSS vars, a `ThemeManager.setTheme` toggle recolours with no rebuild; the component still subscribes to `ThemeManager.onThemeChange` only if a token needs the dark/light flag (Lexical has no compartment to reconfigure — the class rules re-resolve their vars automatically, so a subscription is likely unnecessary; mirror `Markdown`'s `dispose`-time unsubscribe only if one is added).

### Extends `Component`, mounts at first connected layout

`MarkdownEditor extends Component<MarkdownEditorOptions>` — a leaf with no framework children (Lexical owns the subtree), so no `LayoutManager`. The root element is made `contenteditable` through a typed `setContentEditable` setter (a behaviour-changing attribute → typed setter per [ARCHITECTURE.md](ARCHITECTURE.md) *All attributes and styles go through typed setters*; private `_contentEditable` field + `setElementAttribute` internally). `setRootElement` fires in [`onFirstLayout`](src/typescript/lib/core/Component.ts#L4653) once the element exists and is connected. Unlike `Markdown`, the editor does **not** measure/report content height — it fills its host box and scrolls internally (`overflow: auto` on its own element); consumers give it a sized host (a `Fit` panel / explicit `preferredSize`), like `CodeEditor`.

---

## Public API

```typescript
// component/editor/MarkdownEditor.ts
export interface MarkdownEditorOptions extends ComponentOptions {
    /** Initial Markdown source (also accepted as the positional first arg). */
    value?: string;
    /** Whether the editor is read-only. Default false. */
    readOnly?: boolean;
    /** Construction-time listener bag; the only event is "change". */
    listeners?: { change?: (payload: MarkdownEditorChange) => void };
}

export interface MarkdownEditorChange { value: string; }
type MarkdownEditorEvent = "change";

/** Block type accepted by setBlockType. */
type MarkdownBlockType = "paragraph" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "quote" | "code";

class MarkdownEditor extends Component<MarkdownEditorOptions> {
    constructor(value?: string, options?: MarkdownEditorOptions);

    // Value — the Markdown string. Backed by the live EditorState; cached to
    // _options.value on every change and pre-mount/offline.
    getValue(): string;                 // editor.read(() => $convertToMarkdownString(TRANSFORMERS))
    setValue(value: string): this;      // editor.update(() => $convertFromMarkdownString(value, TRANSFORMERS))

    // Read-only — toggles editor.setEditable.
    getReadOnly(): boolean;
    setReadOnly(readOnly: boolean): this;

    // Imperative command API (consumer toolbars wire to these). No-op offline.
    toggleBold(): this;
    toggleItalic(): this;
    toggleInlineCode(): this;
    toggleUnorderedList(): this;
    toggleOrderedList(): this;
    toggleLink(url: string | null): this;
    setBlockType(type: MarkdownBlockType): this;

    // Custom "change" event via ListenerBag (fires on document edit).
    on(event: MarkdownEditorEvent, fn: (payload: MarkdownEditorChange) => void): this;
    off(event: MarkdownEditorEvent, fn: (payload: MarkdownEditorChange) => void): this;

    /** Detaches theme listener (if any) and the editor root. */
    dispose(): void;

    // callable() wrapped; exported as `MarkdownEditor` / `_MarkdownEditor`.
}
```

```typescript
// core/DOM.ts — reused from the CodeEditor plan (added there; no change here if
// CodeEditor lands first). Only added by THIS plan if it lands first.
mountView<T>(handle: Handle, factory: (root: HTMLElement) => T): T | null;
```

**State-bearing property routing.** `value` → `EditorState` via `$convertFrom/ToMarkdownString`; cached in `_options.value` (read pre-mount/offline and refreshed on every `change`); `getValue` reads the state on demand (cheap; the state is in-memory) and falls back to `_options.value ?? ""` when the editor is absent. `readOnly` → `editor.setEditable`, cached in `_options.readOnly`. `contentEditable` is not a consumer option (intrinsic) — private `_contentEditable` field + `setContentEditable`, dispatched in the constructor, not on the options bag. Both `value` and `readOnly` are `MarkdownEditorOptions` fields dispatched from `applyOptions`. The `listeners` bag is dispatched via `this.applyListeners(options?.listeners)` from the **constructor body** after `super()` ([ARCHITECTURE.md](ARCHITECTURE.md) Event handling). Fields the cascade-dispatched setters or constructor write and that must survive `super()` (`_editor`, `_unregister`, `_contentEditable`) use `declare` ([CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) *Fields written during the `super()` cascade*).

**Reads are on demand, writes cache.** `getValue` computes markdown from the live state each call (no persistent markdown cache to drift); `_options.value` is only the pre-mount/offline fallback and the `change`-payload snapshot. This avoids a stale-cache class of bug and keeps a single source of truth (the editor state).

---

## Internal Structure

### Files in `component/editor/`

- **`MarkdownEditor.ts`** — the component. Holds `declare private _editor: LexicalEditor | null` (headless-capable; constructed in `onFirstLayout` — see mount sequence), `declare private _unregister: (() => void) | null` (the `mergeRegister` teardown for rich-text/history/shortcuts/update-listener), and `declare private _contentEditable: boolean`. Emits `change` from a `registerUpdateListener` that recomputes markdown and updates `_options.value`.
- **`markdownTransformers.ts`** — exports the curated `TRANSFORMERS` array (the nine transformers in the dialect table) built from `@lexical/markdown`'s named transformer constants. Single source of truth for import, export, and shortcuts.
- **`editorNodes.ts`** — exports the `nodes` array (`HeadingNode`, `QuoteNode`, `ListNode`, `ListItemNode`, `LinkNode`, `CodeNode`, `CodeHighlightNode`) passed to `createEditor`.
- **`editorTheme.ts`** — the `EditorThemeClasses` map + the module-level `StyleRule`s (an `ensureMarkdownEditorClassRules()` singleton mirroring the viewer's `ensureMarkdownClassRules`) that reference the theme tokens.
- **`index.ts`** — barrel entry for the subpath (see wiring note). Adds `MarkdownEditor` / `MarkdownEditorOptions` / `MarkdownEditorChange` exports alongside CodeEditor's.

### Mount sequence (in `onFirstLayout`)

1. Guard: if `_editor` already exists, return (idempotent).
2. `this._editor = createEditor({ nodes: EDITOR_NODES, theme: EDITOR_THEME, onError })`.
3. Register behaviour and capture teardown:
   `this._unregister = mergeRegister(registerRichText(editor), registerHistory(editor, createEmptyHistoryState(), 300), registerMarkdownShortcuts(editor, TRANSFORMERS), editor.registerUpdateListener(onUpdate))`.
4. Apply cached state into the fresh editor: `setValue(_options.value ?? "")`, `editor.setEditable(!_options.readOnly)`.
5. `DOM.sink.mountView(el, (root) => { editor.setRootElement(root); return root; })` — `null` offline (view never attaches; state still usable).

`onUpdate({ editorState })` recomputes markdown via `editor.read` and, when the doc changed, writes `_options.value` and `emit("change", { value })`.

### Offline / headless path (modelled sink)

`onFirstLayout` still runs under tests? It fires on connected layout — under the modelled sink there is no real layout, so the component may create its editor lazily on first `getValue`/`setValue` instead. **Decision:** create the `LexicalEditor` lazily via a private `ensureEditor()` called from `onFirstLayout` *and* from `getValue`/`setValue`/the command methods, so conversion works in tests without a layout pass. `ensureEditor` builds the headless editor + registrations but only `setRootElement` is gated on `mountView` (live). This keeps the DOM-free API fully exercised offline.

---

## Ordered Implementation Steps

1. **Confirm the shared surface from the CodeEditor plan exists.** If `component/editor` (tsconfig `paths`, vite `entry`, package.json `exports`, barrel `index.ts`) and `DOMSink.mountView` are already implemented, reuse them. If not (this plan lands first), perform CodeEditor's steps 2 + 8 for the subpath + `mountView` here. → verify: `node -e "require.resolve('@codemirror/view')"` is *not* required; `grep -rn "component/editor" tsconfig.json vite.lib.config.ts package.json`.
2. **Add dependencies** to `package.json` `dependencies`: `lexical`, `@lexical/rich-text`, `@lexical/list`, `@lexical/link`, `@lexical/code`, `@lexical/markdown`, `@lexical/history`, `@lexical/utils`, `@lexical/selection`. Add them to the lib build's `external` predicate (extend the `/^(codemirror|@codemirror\/|…)/` regex the CodeEditor plan introduces to include `|^lexical$|^@lexical\/`). Run `npm install`. → verify: `node -e "require.resolve('lexical')"`.
3. **`markdownTransformers.ts`** — export the curated nine-transformer array. → verify: unit test asserts the array excludes `STRIKETHROUGH`/`HIGHLIGHT`/`CHECK_LIST` and includes the nine.
4. **`editorNodes.ts`** — export the `nodes` array.
5. **`editorTheme.ts`** — `EditorThemeClasses` map + `ensureMarkdownEditorClassRules()` referencing the tokens.
6. **`MarkdownEditor.ts`** — options/value/readOnly/command setters, `ensureEditor()` + `onFirstLayout` mount, `setContentEditable`, `change` emit, `dispose`. Route `listeners` via `applyListeners` from the constructor body. Wrap with `callable()`; export `_MarkdownEditor` / `MarkdownEditor`. → verify: `npm run test:lint` (`no-raw-dom` *hold* clause stays green — the `mountView` factory param is unannotated; `LexicalEditor` is a foreign type; `forward-super-options`, `no-element-style` green).
7. **Barrel** — add the `MarkdownEditor` exports to `component/editor/index.ts`. → verify: `npm run typecheck`.
8. **Unit tests** (`tests/component/markdown-editor.test.ts`) for the DOM-free logic — transformer curation, value round-trip, dialect fidelity (see Expected Behaviour). → verify: `npm run test`.
9. **Demo panel** `src/typescript/MarkdownEditorPanel.ts` + register in `main.ts` (a `Split` or two `Fit` panels showing the editor and a live `Markdown` viewer bound to `getValue()` on `change`, to visually prove round-trip parity), mirroring `MarkdownPanel`. → verify: `npm run dev`.
10. **Docs** — `docs/components/MarkdownEditor.md` + sidebar entry in `docs/.vitepress/config.mts`; JSDoc on all exports (no `{@link}` to internal symbols per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)). → verify: `npm run docs:build` finishes with zero warnings.
11. **Default-options fallback registry** — add a row in `tests/component/default-options-fallback.test.ts` for any `MarkdownEditor` defaulted field (`readOnly`). → verify: `npm run test`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Create | `src/typescript/lib/component/editor/markdownTransformers.ts` |
| Create | `src/typescript/lib/component/editor/editorNodes.ts` |
| Create | `src/typescript/lib/component/editor/editorTheme.ts` |
| Create | `src/typescript/MarkdownEditorPanel.ts` (demo) |
| Create | `docs/components/MarkdownEditor.md` |
| Create | `tests/component/markdown-editor.test.ts` |
| Modify | `src/typescript/lib/component/editor/index.ts` (barrel — add MarkdownEditor exports; create it if this plan precedes CodeEditor) |
| Modify | `package.json` (Lexical deps; `exports` for `./component/editor` if not already added) |
| Modify | `vite.lib.config.ts` (extend `external` predicate for `lexical`/`@lexical/*`; `entry` for `component/editor` if not already added) |
| Modify | `tsconfig.json` (`paths` for `component/editor` if not already added) |
| Modify | `src/typescript/lib/core/DOM.ts` (**only if this plan lands before CodeEditor** — add `mountView`) |
| Modify | `src/typescript/main.ts` (register demo panel) |
| Modify | `docs/.vitepress/config.mts` (sidebar entry) |
| Modify | `tests/component/default-options-fallback.test.ts` (row for `readOnly`) |

---

## Expected Behaviour

**Unit-testable (DOM-free, modelled sink — the editor runs headless):**

- **Transformer curation:** the exported array contains exactly the nine dialect-table transformers; `STRIKETHROUGH`, `HIGHLIGHT`, `CHECK_LIST` are absent.
- **Value round-trip (idempotence):** `setValue(md); getValue()` returns markdown that is *canonically equal* to `md` for a corpus covering every supported construct (headings h1–h6, paragraphs, bold, italic, inline code, nested-free ordered/unordered lists, blockquote, fenced code, links). Lexical may normalise whitespace, so compare after a defined normalisation (trim trailing spaces, collapse blank-line runs), and assert `getValue(setValue(getValue(setValue(md)))) === getValue(setValue(md))` (second pass is a fixpoint).
- **Dialect fidelity (the headline test):** for each corpus doc, feed `getValue()` output through the viewer's lexer (`marked.lexer`, the same entry `Markdown` uses) and assert **every** produced top-level token type is in the viewer's supported set `{heading, paragraph, list, blockquote, code, space}` — i.e. the editor never emits a token the viewer would drop to plain-text fallback (no `table`/`html`/`hr`/`del` tokens). This is the enforceable form of "renders identically in the viewer."
- **Offline value fallback:** before mount / with `_editor` built headless, `getValue()` returns the converted markdown (or `_options.value ?? ""` if the editor was never built); `setValue` updates it.
- **`readOnly` routing:** `applyOptions` forwards `readOnly`; `getReadOnly()` reflects it; default is `false` (fallback-registry row).
- **`change` event:** a `setValue` (or a command applied to the headless editor) that mutates the state fires `change` with the new markdown; the `listeners.change` bag wired via a plain `new MarkdownEditor({ listeners: { change } })` receives it.
- **Command methods no-throw headless:** `toggleBold`/`toggleUnorderedList`/`setBlockType("h2")`/`toggleLink("…")` applied to the headless editor mutate the state and are reflected in `getValue()` (e.g. `setBlockType("h2")` on a paragraph yields a `## ` line); with no selection they no-op without throwing.
- **`setContentEditable`** caches `_contentEditable` and survives `super()` (a `declare` field).

**Manual-verify (live-only — requires a browser, Lexical mounts a `contenteditable`):**

- Typing renders as WYSIWYG rich text with no visible markup.
- Markdown-shortcut typing: `# ` → heading, `**b**` → bold, `- ` → bullet, `1. ` → numbered, `> ` → quote, ` ``` ` → code block.
- Keyboard shortcuts: <kbd>Ctrl/Cmd+B</kbd>/<kbd>+I</kbd> toggle bold/italic; <kbd>Ctrl/Cmd+Z</kbd>/<kbd>+Y</kbd> undo/redo.
- Command API from a consumer button toggles the format at the current selection.
- Selection across formats behaves; caret is preserved on format toggle.
- **Round-trip parity:** the demo's side-by-side `Markdown` viewer bound to `getValue()` on `change` renders identically to the editing surface for every supported construct.
- Pasting external rich text keeps only supported formatting (bold/italic/links/lists/headings/code); tables/images/colours are dropped to plain text (Lexical's default node-filtered paste).
- `setReadOnly(true)` blocks edits; `false` restores them.
- Theme toggle recolours the editing surface (code font/wash, quote bar, link colour) with no rebuild.
- Editor fills its host box and scrolls internally when the document exceeds the box.
- Editor chunk loads Lexical only when `component/editor` is imported; a consumer importing only `Markdown` never bundles it.

---

## Verification

- `npm run typecheck` — clean.
- `npm run test:lint` — `no-raw-dom` green (the unannotated `mountView` factory param must not trip *hold*; `LexicalEditor`/`EditorState` are foreign types, not DOM-lib element types); `forward-super-options`, `no-element-style` green.
- `npm run test` — transformer-curation, round-trip idempotence, **dialect-fidelity** (viewer-lexer token-set) tests, `readOnly`/`change`/command/default-fallback tests.
- `npm run build:lib` — emits `dist/lib/component/editor.es.js`; inspect it to confirm `lexical`/`@lexical/*` are `import`ed (external), not inlined.
- `npm run dev` — exercise `MarkdownEditorPanel`: WYSIWYG typing, markdown shortcuts, keyboard/command formatting, read-only, theme toggle, internal scroll, and the side-by-side viewer round-trip parity.
- `npm run docs:build` — zero warnings.

---

## Documentation Impact

- Export surface: `MarkdownEditor`, `MarkdownEditorOptions`, `MarkdownEditorChange` exported from the `component/editor` barrel (public subpath `@jimka/typescript-ui/component/editor`, shared with `CodeEditor`).
- Doc page: `docs/components/MarkdownEditor.md`, following `docs/components/Markdown.md`'s shape — intro (WYSIWYG, Markdown value), Construction table, supported-construct table (cross-referencing the viewer's subset), command API, markdown-shortcut list, read-only note, the dialect/round-trip guarantee, and a live-only note. Cross-reference the generated API page `/api/component/editor/classes/MarkdownEditor` and link to the `Markdown` viewer page (the counterpart).
- Sidebar: add `{ text: 'MarkdownEditor', link: '/components/MarkdownEditor' }` in `docs/.vitepress/config.mts` near the `Markdown` entry (line ~115).
- JSDoc: every exported symbol documented; public JSDoc must not `{@link}` internal symbols — describe the seam/transformer mechanics in prose ([CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)).
- Note the new runtime dependencies (`lexical`, `@lexical/*`) install transitively, like `marked`.

---

## Potential Challenges

- **Dialect drift (primary risk).** Any transformer whose emit `marked` parses differently than intended silently breaks viewer parity. Mitigation: the curated nine-transformer array (never the full preset) + the dialect-fidelity test asserting the viewer's lexer produces only supported token types; run it over a broad corpus and add a case whenever a construct is added.
- **List nesting.** Lexical indents nested lists with spaces; `marked` (CommonMark) nesting rules differ, and the viewer's list handling is basic. Mitigation: v1 corpus/tests cover flat lists; deep nesting is a documented rough edge (Non-Goal for guaranteed fidelity), not a crash — the viewer's fallback keeps it safe.
- **Whitespace/blank-line normalisation.** Lexical's markdown export may differ from the input in trailing spaces / blank-line count, failing naive string equality. Mitigation: compare after a defined normalisation and assert a fixpoint on the second pass rather than exact input equality.
- **`no-raw-dom` *hold* clause on the factory param.** The `mountView` factory's `root` must be left unannotated so no `TSTypeReference` names `HTMLElement`. Mitigation: rely on the inferred type; verify with `npm run test:lint` right after writing the mount call.
- **Shared `component/editor` barrel pulls both engines.** If the barrel's re-exports aren't tree-shakeable, importing `MarkdownEditor` could drag in CodeMirror (via CodeEditor's side-effectful `languages.ts` registration import). Mitigation: `MarkdownEditor`'s own modules have **no** side-effect imports, so with correct `sideEffects` config a consumer referencing only `MarkdownEditor` shakes CodeMirror out; flag the `languages.ts` side-effect as the one obstacle and keep the two components' module graphs disjoint. If it proves unshakeable, split the barrel — deferred until measured.
- **Headless `onFirstLayout` timing under tests.** The modelled sink has no layout pass, so `onFirstLayout` may not fire; conversion must not depend on it. Mitigation: `ensureEditor()` is also called lazily from `getValue`/`setValue`/commands, so the DOM-free path is always available.
- **Paste sanitization scope.** v1 relies on Lexical's default node-filtered paste; markdown-*text* paste is **not** auto-converted to formatting (that needs a paste-command intercept). Mitigation: documented as a v1 limitation; the node filter already prevents unsupported constructs from surviving.
- **Content-editable + absolute positioning + internal scroll.** The component is `position: absolute` (framework rule) with `overflow: auto`; Lexical's selection/scroll must cooperate. Mitigation: mount in `onFirstLayout` (connected, sized element), like `CodeEditor`; verify internal scroll live.

---

## Critical Files

- [`plans/code-editor.md`](plans/code-editor.md) — the sibling plan this depends on: the `component/editor` subpath, the `DOMSink.mountView` seam, the `external` predicate, the demo/docs scaffolding, and the unannotated-factory-param *hold*-clause trick — all reused verbatim.
- [`src/typescript/lib/component/display/Markdown.ts`](src/typescript/lib/component/display/Markdown.ts) — the viewer whose token handlers ([L466–L479](src/typescript/lib/component/display/Markdown.ts#L466)) define the supported subset, whose theme-token CSS refs the editor mirrors, and whose `ensureMarkdownClassRules`/`dispose`/`onFirstLayout` patterns the editor follows.
- [`src/typescript/lib/component/display/Canvas.ts`](src/typescript/lib/component/display/Canvas.ts) — the live-only + foreign-live-object pattern (`getContext` → `null` offline) `mountView` mirrors.
- [`src/typescript/lib/core/DOM.ts`](src/typescript/lib/core/DOM.ts#L708) — the `DOMSink`/`DOMSource` seam and the `getContext` escape the `mountView` method mirrors.
- [`src/typescript/lib/core/Component.ts`](src/typescript/lib/core/Component.ts#L4653) — `onFirstLayout`, `trackHandle`, the typed-setter/`applyOptions`/`applyListeners` machinery, `callable()` export.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — event handling (`listeners` bag / `applyListeners`, `on`/`off`/`emit`), typed setters, one-DOM-element-per-class, absolute positioning, `StyleRule`, callable export.
- [`src/typescript/MarkdownPanel.ts`](src/typescript/MarkdownPanel.ts) / [`docs/components/Markdown.md`](docs/components/Markdown.md) — demo-panel + doc-page templates.

---

## Non-Goals

- **Any Markdown construct the viewer doesn't render** — tables, images, strikethrough, task/checklists, thematic breaks (`hr`), raw HTML, footnotes. Excluded by the curated transformer list so fidelity is guaranteed.
- **Built-in toolbar UI** — v1 ships the command API + keyboard + markdown-shortcut typing; a toolbar can be composed by consumers or added later behind the same commands.
- **Markdown-text paste conversion** — pasting a markdown *string* is treated as plain text in v1; only rich (HTML) paste is node-filtered. A paste-command intercept is deferred.
- **Async/lazy value API** — `getValue`/`setValue` stay synchronous; Lexical core is statically imported (subpath boundary is the laziness). Dynamic-importing the transformer bundle is deferred.
- **Collaboration / CRDT / mentions / images / embeds** — out of the basic scope.
- **Serving as the read-only display path** — the `marked`-based `Markdown` viewer remains the lean read-only renderer; `MarkdownEditor`'s `readOnly` is for locking an editor, not replacing the viewer.
- **Full data-binding parity with input controls** (`"binding"` event, `Model` binding) — v1 exposes only `change`, matching the `CodeEditor` plan's scope.
- **Deep-nested-list fidelity guarantee** — flat lists are covered/tested; deep nesting is safe (viewer fallback) but not fidelity-guaranteed.
