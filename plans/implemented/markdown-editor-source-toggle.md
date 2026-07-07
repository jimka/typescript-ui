# MarkdownEditor Source / WYSIWYG Mode Toggle — Implementation Plan

## Overview

Add a `mode: 'wysiwyg' | 'source'` capability to [`MarkdownEditor`](../src/typescript/lib/component/editor/MarkdownEditor.ts). In `'wysiwyg'` (default) the existing Lexical rich-text surface is shown; in `'source'` the component instead shows the project's existing [`CodeEditor`](../src/typescript/lib/component/editor/CodeEditor.ts) editing the **raw Markdown source**. Both surfaces are bound to the same Markdown value: `getValue()` / `setValue()` operate on whichever surface is active, and mode switches convert the value across (Lexical ⇄ Markdown string ⇄ CodeMirror). The `"change"` event fires from the active surface only, with the unchanged `MarkdownEditorChange` payload. `readOnly` applies to both surfaces.

The crux is structural: today `MarkdownEditor`'s own element **is** Lexical's `contenteditable` root ([MarkdownEditor.ts:519](../src/typescript/lib/component/editor/MarkdownEditor.ts#L519) mounts via `editor.setRootElement(element)` where `element = this.getElement()`). A single component owns one element, so it cannot also host a `CodeEditor` child. The component is therefore restructured into a **two-child container**: its own element becomes a neutral [`Card`](../src/typescript/lib/layout/Card.ts) host stacking (a) a small new private `WysiwygSurface` component that owns the `contenteditable` element Lexical mounts into, and (b) a `CodeEditor`. `MarkdownEditor` **keeps** owning the Lexical editor object and all its editing/value/command logic — only the *element* the view mounts into moves to the surface child. The demo panel ([MarkdownEditorPanel.ts](../src/typescript/MarkdownEditorPanel.ts)) gains a toolbar `ToggleButton` that drives `setMode`.

---

## Architecture Decisions

### Restructure into a two-child `Card` container — not overlay/replace

`MarkdownEditor` becomes a container whose element carries a `Card` layout ([Card.ts:25](../src/typescript/lib/layout/Card.ts#L25) — "shows exactly one child component at a time, sizing it to fill the container's inner bounds"). It hosts two child `Component`s: a private `WysiwygSurface` (the Lexical `contenteditable` host) and a `CodeEditor`. Rationale: a single class owns one DOM element (ARCHITECTURE.md *One DOM element per class*), so the Lexical `contenteditable` and the CodeMirror view — two foreign live widgets, each needing its own host element — cannot share `MarkdownEditor`'s element. Two child components hosted by `Card` is the framework-native "show one of N" primitive (the same one `Tab`/`Cell` use). Overlaying/replacing on one element was rejected: Lexical would try to manage the `CodeEditor`'s DOM as editable content.

### `MarkdownEditor` keeps owning the Lexical editor; only the mount *element* moves

The Lexical editor object (`_editor`), `ensureEditor`, `handleChange`, all command methods (`toggleBold` … `setBlockType`), `getValue`/`setValue`, and readOnly logic **stay on `MarkdownEditor`**. Only the `contenteditable` element + its mount plumbing move to `WysiwygSurface`. Rationale: (1) the existing white-box test reaches `(editor as ...)._editor` ([markdown-editor.test.ts:60](../tests/component/markdown-editor.test.ts#L60)) and asserts `getContentEditable()` on `MarkdownEditor` — both must keep working; (2) fully extracting the editor into the surface would force ~9 command-method forwarders and duplicate the value/change logic across a seam, relocating complexity rather than removing it (ARCHITECTURE.md *Compose before specializing*). Handing just the element over keeps the diff surgical.

### `WysiwygSurface` is a private in-file component, `new`-constructed

A minimal `Component` subclass declared in `MarkdownEditor.ts`, **not exported** and constructed with `new` (not `callable()`). It owns: the `contenteditable` attribute (+ the `init()` replay), `setCursor("text")`, `setOverflow("auto")`, and a `mount(editor)` method doing the `DOM.sink.mountView` + `editor.setRootElement` handshake on its **own** element. Rationale: `callable()` is required only for *exported* components (ARCHITECTURE.md); an internal helper used solely via `new` inside its own module needs no wrap. Keeping it in the same file keeps the surface cohesive with the coordinator that drives it.

### `init()` `contenteditable` replay + `setCursor` move to the surface

These currently live on `MarkdownEditor` because its own element was the editable surface; they assume `this.getElement()` is the `contenteditable`. After the restructure that assumption belongs to `WysiwygSurface`, so the `init()` override (replaying the cached `contenteditable` attribute onto the freshly-created element — needed because `setElementAttribute` is write-through only during detached construction) and `setContentEditable`/`_contentEditable`/`getContentEditable` move there. `MarkdownEditor` keeps **thin forwarders** `setContentEditable`/`getContentEditable` that delegate to the surface, preserving the public API and the existing test.

### Canonical value is `_options.value`, kept in sync by *both* change handlers

`_options.value` is the single source of truth for the Markdown string between switches. The Lexical update path (`handleChange`) and the new `CodeEditor` change path (`handleCodeChange`) each write `_options.value` and emit — each guarded by `payload.value === this._options.value` (the existing `handleChange` guard, [MarkdownEditor.ts:536](../src/typescript/lib/component/editor/MarkdownEditor.ts#L536)). `getValue`/`setValue` become **mode-aware**: they read/write the currently-active surface, which stays equal to `_options.value` because the active surface's change handler keeps it synced. On a mode switch the value is read from the *outgoing* surface (via `getValue()` **before** flipping the mode) and pushed into the *incoming* surface.

### Change routing: wire once, guard by equality — never rewire on switch

The `CodeEditor`'s `"change"` listener is wired **once**, at `CodeEditor` construction (via its `listeners` option bag), to `handleCodeChange`. It is never detached/reattached on mode switch (avoiding the known *re-wiring stacks duplicate listeners* hazard). Only the active surface can fire: in `'wysiwyg'` mode the `CodeEditor` is hidden and never fed input, so it never emits; the only programmatic `CodeEditor.setValue` (on entering source) is caught by the `=== _options.value` guard, so it does not double-emit. Symmetrically, the Lexical listener is caught by its own guard when we load source text into it on entering wysiwyg.

### Toggle affordance lives in the consumer/demo, not inside `MarkdownEditor`

`MarkdownEditor` exposes only the imperative `getMode()` / `setMode()` (+ the `mode` option); the demo wires a `ToggleButton`. Rationale: `MarkdownEditor` deliberately ships **no built-in toolbar or chrome** — the existing design exposes imperative commands (`toggleBold`, …) for consumers to wire to their own `Button`s ([docs/components/MarkdownEditor.md](../docs/components/MarkdownEditor.md) "There is no built-in toolbar"). A built-in mode toggle would contradict that established stance and risk overlapping/intercepting the editing surface. The mode toggle follows the same consumer-wired pattern. The demo satisfies the requirement that the toggle be visible/usable in the running app.

---

## Public API

New/changed on `MarkdownEditor` (all other signatures unchanged):

```typescript
/** The editing surface a MarkdownEditor currently shows. */
export type MarkdownEditorMode = "wysiwyg" | "source";

export interface MarkdownEditorOptions extends ComponentOptions {
    value?: string;
    readOnly?: boolean;
    /** Which surface is shown. Default "wysiwyg". */
    mode?: MarkdownEditorMode;
    listeners?: { change?: (payload: MarkdownEditorChange) => void };
}

class MarkdownEditor extends Component<MarkdownEditorOptions> {
    getMode(): MarkdownEditorMode;               // reads _options.mode ?? "wysiwyg"
    setMode(mode: MarkdownEditorMode): this;     // converts + swaps the visible Card child

    // value/readOnly become mode-aware but keep their existing signatures:
    getValue(): string;
    setValue(value: string): this;
    setReadOnly(readOnly: boolean): this;        // now also forwards to the CodeEditor

    // preserved as thin forwarders to the WysiwygSurface child:
    getContentEditable(): boolean;
    setContentEditable(contentEditable: boolean): this;
}
```

- Backing field: `mode` lives in the options bag (`this._options.mode`), following `value`/`readOnly`. No `declare` field is needed (nothing writes a private field during the `super()` cascade).
- `applyOptions` forwards `mode`: `if (options.mode !== undefined) this._options.mode = options.mode;` (pure cache, consumed at construction time when picking the initial visible child).
- Barrel: add `MarkdownEditorMode` to the `export type { … }` line in [index.ts](../src/typescript/lib/component/editor/index.ts#L12). `MarkdownEditorOptions` is already exported, so the new `mode` field rides along.

---

## Internal Structure

### `WysiwygSurface` (private, in `MarkdownEditor.ts`)

```typescript
class WysiwygSurface extends Component {
    private _contentEditable = false;
    private readonly _onReady: () => void;

    constructor(onReady: () => void) {
        super();
        this._onReady = onReady;
        this.setContentEditable(true);
        this.setOverflow("auto");   // fills its box, scrolls internally
        this.setCursor("text");     // caret over the whole surface; replayed by applyStyle
        this.onFirstLayout(() => this._onReady());
    }

    // Verbatim move of MarkdownEditor's current init() override (contenteditable replay).
    protected init(element?: Handle): this { /* ...same body... */ }

    setContentEditable(contentEditable: boolean): this { /* ...same body... */ }
    getContentEditable(): boolean { return this._contentEditable; }

    /** Verbatim move of MarkdownEditor.mountRoot, mounting into THIS surface's element. */
    mount(editor: LexicalEditor): void {
        if (editor.getRootElement()) return;
        const element = this.getElement();
        if (!element) return;
        ensureMarkdownEditorClassRules();
        DOM.sink.mountView(element, (root) => { editor.setRootElement(root); return root; });
    }
}
```

`onReady` fires on the surface's first connected layout, i.e. when it is the visible `Card` child and gets sized — the correct moment to mount the live Lexical view.

### `MarkdownEditor` constructor (new shape)

```typescript
constructor(value?: string, options?: MarkdownEditorOptions) {
    super(options);
    if (value !== undefined && this._options.value === undefined) this._options.value = value;

    this._card = new Card();
    this.setLayoutManager(this._card);

    this._wysiwyg = new WysiwygSurface(() => this.mountWysiwyg());
    this._codeEditor = new CodeEditor(this._options.value ?? "", {
        language: "markdown",
        readOnly: this._options.readOnly ?? false,
        listeners: { change: (payload) => this.handleCodeChange(payload) },
    });

    this.addComponent(this._wysiwyg);
    this.addComponent(this._codeEditor);

    // Pick the initial visible child from the mode.
    this._card.setVisibleComponentId(
        this.getMode() === "source" ? this._codeEditor.getId() : this._wysiwyg.getId());

    this.applyListeners(options?.listeners);
    // NOTE: no constructor onFirstLayout(ensureEditor) — the WysiwygSurface's onReady
    // drives the wysiwyg build+mount; the headless editor is otherwise built on demand.
}
```

Fields (structural, non-option-backed — plain private fields, base-class-set before the cascade so no `declare` needed): `_card: Card`, `_wysiwyg: WysiwygSurface`, `_codeEditor: CodeEditor`. Keep the existing `_editor`, `_unregister`, `_listeners`.

### `mountWysiwyg` (replaces the old constructor `onFirstLayout`)

```typescript
private mountWysiwyg(): void {
    const editor = this.ensureEditor();  // build headless editor if needed (unchanged)
    this._wysiwyg.mount(editor);         // attach the live view into the surface element
}
```

`ensureEditor` loses its trailing `this.mountRoot()` call (mounting is now the surface's job); it only builds/returns the headless editor. Remove `mountRoot` from `MarkdownEditor` (moved to `WysiwygSurface.mount`).

### Mode-aware value + switch

```typescript
getValue(): string {
    if (this.getMode() === "source") return this._codeEditor.getValue();
    const editor = this._editor;
    if (editor) return editor.read(() => $convertToMarkdownString(TRANSFORMERS));
    return this._options.value ?? "";
}

setValue(value: string): this {
    if (this.getMode() === "source") {
        this._codeEditor.setValue(value);  // → handleCodeChange (guarded)
    } else {
        this.ensureEditor().update(() => $convertFromMarkdownString(value, TRANSFORMERS), { discrete: true });
    }
    return this;
}

setMode(mode: MarkdownEditorMode): this {
    if (this.getMode() === mode) return this;

    const md = this.getValue();          // read the OUTGOING surface (mode not yet flipped)
    this._options.mode = mode;           // flip

    if (mode === "source") {
        this._codeEditor.setValue(md);   // load source text into CodeMirror
        this._card.setVisibleComponentId(this._codeEditor.getId());
    } else {
        this.ensureEditor().update(() => $convertFromMarkdownString(md, TRANSFORMERS), { discrete: true });
        this._card.setVisibleComponentId(this._wysiwyg.getId());
    }
    return this;
}

private handleCodeChange(payload: CodeEditorChange): void {
    if (payload.value === this._options.value) return;  // guard: no double-emit on programmatic setValue
    this._options.value = payload.value;
    this.emit("change", { value: payload.value });
}
```

### readOnly + dispose

```typescript
setReadOnly(readOnly: boolean): this {
    this._options.readOnly = readOnly;
    this._editor?.setEditable(!readOnly);
    this._codeEditor.setReadOnly(readOnly);   // NEW: apply to the source surface too
    return this;
}

dispose(): void {
    this._unregister?.();
    this._editor?.setRootElement(null);
    this._codeEditor.dispose();               // NEW: tear down the CodeMirror view + theme sub
}
```

---

## Ordered Implementation Steps

1. **`MarkdownEditor.ts` — add imports.** Add `import { CodeEditor } from "~/component/editor/CodeEditor.js";` and `import type { CodeEditorChange } from "~/component/editor/CodeEditor.js";` and `import { Card } from "~/layout/Card.js";`. `DOM`, `Handle`, `ensureMarkdownEditorClassRules` remain imported (now used by `WysiwygSurface`). Check: `npm run typecheck` (will still error until later steps — that's expected; this checkpoint is just "imports resolve").

2. **`MarkdownEditor.ts` — add the `WysiwygSurface` private class** above `class MarkdownEditor`, per *Internal Structure*. Move the current `init()` body, `setContentEditable`, `getContentEditable`, `_contentEditable`, and the `mountRoot` body (as `mount(editor)`) into it verbatim, retargeting to the surface's own element. Keep `setCursor("text")` and `setOverflow("auto")` in the surface constructor.

3. **`MarkdownEditor.ts` — add `MarkdownEditorMode` type** next to `MarkdownEditorEvent`, and add `mode?: MarkdownEditorMode;` to `MarkdownEditorOptions`.

4. **`MarkdownEditor.ts` — rework the constructor** to the new shape in *Internal Structure*: build `_card` / `_wysiwyg` / `_codeEditor`, `addComponent` both, set the initial visible child from `getMode()`, keep `applyListeners`. Remove the old `setContentEditable(true)`, `setOverflow("auto")`, `setCursor("text")`, and `onFirstLayout(() => this.ensureEditor())` lines. Declare the three new private fields.

5. **`MarkdownEditor.ts` — `applyOptions`**: add `if (options.mode !== undefined) this._options.mode = options.mode;`.

6. **`MarkdownEditor.ts` — add `getMode`/`setMode`** and `handleCodeChange`; make `getValue`/`setValue` mode-aware (per *Internal Structure*).

7. **`MarkdownEditor.ts` — `setReadOnly`**: add `this._codeEditor.setReadOnly(readOnly);`. **`dispose`**: add `this._codeEditor.dispose();`.

8. **`MarkdownEditor.ts` — remove now-orphaned members from `MarkdownEditor`**: the old `init()` override, `setContentEditable`/`getContentEditable`/`_contentEditable`, and `mountRoot` (moved to the surface). Re-add **thin forwarders** on `MarkdownEditor`: `getContentEditable() { return this._wysiwyg.getContentEditable(); }` and `setContentEditable(v) { this._wysiwyg.setContentEditable(v); return this; }`. Change `ensureEditor` to drop its trailing `this.mountRoot()` and add `private mountWysiwyg()`.

9. **`index.ts` barrel** — add `MarkdownEditorMode` to the `export type { MarkdownEditorOptions, MarkdownEditorChange, MarkdownBlockType }` list. Check: `grep -n MarkdownEditorMode src/typescript/lib/component/editor/index.ts` — expect one match.

10. **`npm run typecheck`** — expect zero errors.

11. **`tests/component/markdown-editor.test.ts` — add a `MarkdownEditor mode` describe block** covering the unit-testable behaviours below. Run `npm test -- markdown-editor` — expect green (existing + new).

12. **`MarkdownEditorPanel.ts` — wire the toggle** (see *Demo*). Manual-verify only.

13. **`docs/components/MarkdownEditor.md`** — document the `mode` option + `getMode`/`setMode` (see *Documentation Impact*). Run `npm run docs:build` — expect zero warnings.

### Demo (`MarkdownEditorPanel.ts`)

Replace the plain `editorHost` (`Fit`) with a `Border`-layout panel: north = a toolbar hosting a `ToggleButton`, center = the `Fit` panel wrapping `this._editor`. Keep the viewer host and the `change → syncViewer` wiring (it now fires in both modes).

```typescript
import { Placement } from '@jimka/typescript-ui/primitive';
import { Border, Fit, Split } from '@jimka/typescript-ui/layout';
import { ToggleButton } from '@jimka/typescript-ui/component/button';

// in constructor, replacing the editorHost block:
const toggle = new ToggleButton('Markdown source');
toggle.on('action', () => this._editor.setMode(toggle.isSelected() ? 'source' : 'wysiwyg'));

const toolbar = new Panel({ layoutManager: new HBox() });   // or place the toggle directly
toolbar.addComponent(toggle);

const editorFit = new Panel({ layoutManager: new Fit() });
editorFit.addComponent(this._editor);

const editorSide = new Panel({ layoutManager: new Border() });
editorSide.addComponent(toolbar, { placement: Placement.NORTH });
editorSide.addComponent(editorFit, { placement: Placement.CENTER });
this.addComponent(editorSide);
```

`ToggleButton.isSelected()` reflects the *new* state inside the `"action"` handler (its `onAction` flips selection before firing). Import `HBox` from `@jimka/typescript-ui/layout` (or give the toolbar a small fixed `preferredSize` height so the `Border` north band sizes). Verify the `ToggleButton` import subpath resolves (`@jimka/typescript-ui/component/button`).

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/component/editor/MarkdownEditor.ts` (add `WysiwygSurface`, mode API, mode-aware value, child container) |
| Modify | `src/typescript/lib/component/editor/index.ts` (export `MarkdownEditorMode`) |
| Modify | `src/typescript/MarkdownEditorPanel.ts` (toolbar `ToggleButton` toggle) |
| Modify | `tests/component/markdown-editor.test.ts` (mode describe block) |
| Modify | `docs/components/MarkdownEditor.md` (document `mode`/`getMode`/`setMode`) |

No files created (WysiwygSurface is in-file) or deleted.

---

## Expected Behaviour

Unit-testable (offline, against the modelled sink — `mountView` returns `null`, so both views stay headless/cached but every value/mode/change path still runs; mirror the existing test's approach):

1. **Default mode is `'wysiwyg'`** — `new MarkdownEditor().getMode() === 'wysiwyg'`.
2. **`mode` option is honoured** — `new MarkdownEditor('x', { mode: 'source' }).getMode() === 'source'`.
3. **`getValue()` is mode-agnostic for the same doc** — construct with `'# Title'`; `getValue()` in default wysiwyg equals `getValue()` after `setMode('source')` (both `'# Title'`, normalized). In source mode `getValue()` returns the `CodeEditor`'s raw text.
4. **`setMode('source')` exposes raw markdown equal to `getValue()`** — after `setMode('source')`, `getValue()` (now the CodeEditor text) equals the pre-switch markdown.
5. **Edit-in-source then `setMode('wysiwyg')` preserves edits** — offline, simulate a source edit via `editor.setMode('source'); editor.setValue('## Edited');` then `editor.setMode('wysiwyg'); expect(normalize(editor.getValue())).toContain('## Edited')`.
6. **Mode round-trip preserves content** — `value → setMode('source') → setMode('wysiwyg') → getValue()` equals the original (normalized), for each CORPUS doc.
7. **`change` fires once per content-changing edit in wysiwyg mode** — existing test unchanged; verify count is exactly 1 for a `setValue`.
8. **`change` fires once per content-changing edit in source mode** — after `setMode('source')`, a `setValue('new')` fires exactly one `change` with `{ value: 'new' }`; a `setValue` to the *same* value fires none.
9. **`setMode` to the same mode is a no-op** and fires no `change`.
10. **Switching modes with unchanged content fires no `change`** — `setMode('source'); setMode('wysiwyg')` on an untouched doc emits zero changes (the `=== _options.value` guards).
11. **`readOnly` routes to both surfaces** — `new MarkdownEditor(undefined, { readOnly: true })`: `getReadOnly()` is `true`, the built Lexical editor `isEditable()` is `false`, and the child `CodeEditor.getReadOnly()` is `true` (reach it white-box like `lexicalOf`). `setReadOnly(false)` clears all three.
12. **`getContentEditable()` still defaults to `true`** — existing test at [markdown-editor.test.ts:102](../tests/component/markdown-editor.test.ts#L102) stays green via the forwarder.
13. **All existing command / round-trip / dialect-fidelity tests stay green** (default mode is wysiwyg, so their paths are unchanged).

Manual-verify (needs a live browser — CodeMirror/Lexical views only mount under the production sink; see the MD Editor demo tab):

14. Default view shows the WYSIWYG rich-text surface; typing/shortcuts work as before.
15. Toggling the toolbar button swaps to the raw-Markdown `CodeEditor`, showing the current document as source; editing there and toggling back renders those edits as rich text.
16. The right-hand `Markdown` viewer stays in sync while editing in **both** modes.
17. `readOnly` (if exercised) blocks edits and shows the read-only affordances in both surfaces.

---

## Verification

- `npm run typecheck` — zero errors.
- `npm test -- markdown-editor` — existing + new mode tests green.
- `npm run docs:build` — zero warnings (public API changed: new `mode`/`getMode`/`setMode`).
- Manual smoke in the **MD Editor** demo tab at `http://localhost:8015` (`npm run dev`): exercise behaviours 14–17. Toggle mode repeatedly; confirm no duplicate `change`/viewer flicker (listener wired once) and that content survives every round-trip.

---

## Documentation Impact

- **Barrel**: `MarkdownEditorMode` is added to [src/typescript/lib/component/editor/index.ts](../src/typescript/lib/component/editor/index.ts); `MarkdownEditorOptions` already exported.
- **Concept page** [docs/components/MarkdownEditor.md](../docs/components/MarkdownEditor.md): add a `mode` row to the Construction options table; add a short **Source / WYSIWYG mode** section explaining `getMode`/`setMode`, that the value is shared and preserved across switches, that `readOnly` applies to both surfaces, and that the toggle affordance is consumer-wired (like the command API) — cross-reference [`CodeEditor`](/components/CodeEditor) as the source surface. Add `getMode()`/`setMode(mode)` to the "Common methods" table.
- **API pages** under `docs/api/component/editor/` (`classes/MarkdownEditor.md`, `interfaces/MarkdownEditorOptions.md`) are TypeDoc-generated — regenerated by `npm run docs:build`; do not hand-edit.
- **JSDoc**: `getMode`/`setMode`/`mode` need JSDoc. Per [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md) *Don't `{@link}` internal symbols*, do **not** `{@link}` the private `WysiwygSurface`; describe the source surface in prose or link the public `CodeEditor`.
- **llms.txt** is generated from `scripts/llms/manifest.data.mjs`; the one-line MarkdownEditor summary need not change for this detail (leave unless the manifest calls out modes).

---

## Potential Challenges

- **Mount timing / lazy source surface** — the `CodeEditor` only mounts on its first layout, which happens the first time `Card` makes it visible (`setVisibleComponentId` schedules a layout). Its value is fed via `setValue` *before* the switch, which caches into `_options.value` and is picked up by `mount`'s `EditorState.create({ doc })` — so first-switch content is correct even though the view didn't exist yet. Verify manually.
- **Normalization on source→wysiwyg switch** — loading raw source into Lexical re-serializes canonical Markdown; if the user typed non-canonical (but in-dialect) source, `handleChange` may emit one `change` with the normalized value. This is correct (the canonical value changed) and, because the dialect round-trips to a fixpoint (existing round-trip test), is identity for already-canonical text. Note it; don't suppress.
- **`getId()` stability for `Card`** — capture `this._codeEditor.getId()` / `this._wysiwyg.getId()` at switch time (ids are stable per instance); don't cache a stale id if a child is ever replaced (it never is here).
- **Don't rewire the CodeEditor change listener on switch** — wire it once at construction; rely on the equality guard. Re-adding on each switch would stack duplicate listeners (a known framework hazard).
- **`callable()` on the private surface** — intentionally omitted (internal `new`-only class). If a future change exports it, wrap it then.

---

## Critical Files

- [src/typescript/lib/component/editor/MarkdownEditor.ts](../src/typescript/lib/component/editor/MarkdownEditor.ts) — the component being restructured; study `ensureEditor`, `mountRoot`, `handleChange`, `init`, the value/command methods.
- [src/typescript/lib/component/editor/CodeEditor.ts](../src/typescript/lib/component/editor/CodeEditor.ts) — the source surface. Construction: `new CodeEditor(value, { language, readOnly, listeners })`; value: `getValue()`/`setValue()`; change: `on('change', …)` / `listeners.change`; `setReadOnly`; `dispose`; mounts via `onFirstLayout`.
- [src/typescript/lib/layout/Card.ts](../src/typescript/lib/layout/Card.ts) — `setVisibleComponentId(id)`, fills the visible child, hides siblings.
- [src/typescript/lib/component/editor/markdownTransformers.ts](../src/typescript/lib/component/editor/markdownTransformers.ts) — the `TRANSFORMERS` dialect used by both conversion directions.
- [tests/component/markdown-editor.test.ts](../tests/component/markdown-editor.test.ts) — the offline test pattern (`lexicalOf`, `normalize`, CORPUS) to extend.
- [ARCHITECTURE.md](../ARCHITECTURE.md) *One DOM element per class*, *Compose before specializing*, *Event handling* (custom `on`/`off`/`emit` + `listeners` bag); [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md) *Fields written during the `super()` cascade*, *Don't `{@link}` internal symbols*.

---

## Non-Goals

- No built-in mode-toggle UI inside `MarkdownEditor` — the affordance is consumer-wired, consistent with the no-toolbar design.
- No split/preview or side-by-side source+WYSIWYG view — exactly one surface is shown at a time.
- No new `"change"`-payload shape or a separate `"modechange"` event — the existing `MarkdownEditorChange` is reused; mode changes themselves do not emit an event.
- No syntax highlighting choices beyond `language: 'markdown'` for the source `CodeEditor`; no formatter wiring.
- No change to the Lexical dialect / `TRANSFORMERS`.
