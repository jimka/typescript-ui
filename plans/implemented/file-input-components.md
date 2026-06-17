# File Input Components — Implementation Plan

## Overview

Two new value-bearing input controls under `src/typescript/lib/component/input/`:

- **`FileField`** — a styled trigger button wrapping a hidden native `<input type="file">`, plus a filename label. Extends [`AbstractInput`](../src/typescript/lib/component/input/AbstractInput.ts#L51), value type `File[]`, [`Bindable<File[]>`](../src/typescript/lib/core/Bindable.ts#L21).
- **`FileDropZone`** — a bordered drag-and-drop surface that *composes* a `FileField` (per the locked "button is the core, dropzone wraps it" decision) and additionally accepts OS file drops through the HTML5 `DataTransfer.files` API.

Both live in the `component/input` bucket, are wrapped with [`callable()`](../src/typescript/lib/core/Callable.ts#L37), and are exported from the input barrel ([`index.ts`](../src/typescript/lib/component/input/index.ts)). The native `<input type="file">` is the single source of truth for the selected `FileList`; `FileField` reads it on the native `change` event and fans the new value out through `AbstractInput`'s `change`/`binding` listener bag.

The OS-file-drop path is deliberately *separate* from the framework's internal [`DragManager`](../src/typescript/lib/core/DragManager.ts) — see the Architecture Decision below.

---

## Architecture Decisions

### `setValue` only supports clearing — browser security model

The browser forbids programmatically assigning a non-empty `FileList` to `<input type="file">.files` (only user gestures may populate it). Therefore `FileField`'s `Bindable` write contract is honoured only for the empty case:

- `setValue([])` (or any falsy/empty array) clears the native input (`el.value = ""`), updates the label to the empty state, and is fully supported.
- `setValue([...files])` with a non-empty array **cannot** push those files into the native control. The plan's implementation will treat a non-empty argument as a no-op on the native `FileList` and emit a single `console.warn` documenting the limitation, leaving the existing selection untouched. It will **not** throw — `Binding.setRecord` calls `setValue` during record load and must stay side-effect-tolerant.

`getValue()` always returns the live `File[]` read from `el.files`, so the read side of the binding contract is complete; only the write side is constrained. This is the standard, unavoidable platform limitation and is documented in JSDoc on `setValue` and in the curated doc page.

Consequence for `Binding`: a `FileField` bound to a record field round-trips reads (user picks files → record updated) but cannot be re-populated from a stored value. This matches how every web file input behaves and is acceptable for the intended use (upload-style fields, not persisted file blobs).

### OS file drops use `DataTransfer`, not the internal `DragManager`

[`DragManager`](../src/typescript/lib/core/DragManager.ts) is a pointer-based (`mousedown`/`mousemove`) system that fires *synthetic* `dragstart`/`drop` events via [`Event.fireEvent`](../src/typescript/lib/core/Event.ts#L185) and carries a plain-object `DragData` payload. It has no knowledge of `DataTransfer` and never sees OS file drops. Native file drops arrive as real HTML5 `dragover`/`drop` DOM events whose `event.dataTransfer.files` holds the dropped `FileList`. `FileDropZone` therefore wires the native `dragover`/`drop`/`dragleave` events directly (through `Event.addSubtreeListener`, see below) and **does not** call `DragManager.makeDropTarget`. The existing `--ts-ui-drag-dropzone-*` tokens belong to the internal-drag overlay ([`DropZoneOverlay`](../src/typescript/lib/core/component/DropZoneOverlay.ts)) and are *not* reused here to avoid coupling two unrelated mechanisms; `FileDropZone` gets its own `--ts-ui-filedropzone-*` tokens.

### Event wiring: `Event.addListener` for `change`, `Event.addSubtreeListener` for drop events

The native `change` event fires on the hidden `<input>` element itself, so `FileField` registers it with [`Event.addListener(this._input, "change", …)`](../src/typescript/lib/core/Event.ts#L213) (exact-target match). For `FileDropZone`, `dragover`/`drop`/`dragleave` may target the root *or any child* (the composed `FileField`, its label, its button), so the dropzone registers them with [`Event.addSubtreeListener`](../src/typescript/lib/core/Event.ts#L303) on its own root, matching the project's container-event-delegation convention. `dragover`/`drop` are **not** in `Event`'s `PASSIVE_TYPES` set ([Event.ts:40](../src/typescript/lib/core/Event.ts#L40)), so they default to non-passive and the listener can call `event.preventDefault()` — required both on `dragover` (to signal a valid drop target) and on `drop` (to stop the browser navigating to the dropped file). No `ListenerOptions` override is needed.

### Trigger button reuses `Button`; native input is a child Component with `tag: "input"`

The trigger follows the [`PickerButton`](../src/typescript/lib/component/input/PickerButton.ts) precedent — a `Button` instance owned by the field. The hidden native file input is a child `Component` constructed with `tag: "input"` and `display: none` (mirroring [`TextInput`](../src/typescript/lib/component/input/TextInput.ts#L60)'s `tag: "input"` default). The `type="file"`, `multiple`, and `accept` HTML attributes are written via the inherited `setElementAttribute` path (the same path `TextInput.setType` uses, [TextInput.ts:217](../src/typescript/lib/component/input/TextInput.ts#L217)). Clicking the trigger (or, in `FileDropZone`, the zone surface) calls `el.click()` on the hidden input to open the OS picker.

### `multiple` and `accept` are typed setters with cached backing fields

Both are real DOM properties, so per `CODE_CONVENTIONS.md` each gets a typed setter, a cached backing field on `_options`, and an `XOptions` entry routed through `applyOptions`: `setMultiple`/`_options.multiple` and `setAccept`/`_options.accept`. They write the native `multiple` / `accept` attributes on the hidden input. Following the `AbstractInput` cascade rule, the setters are dispatched from the constructor tail once the hidden input child exists, not from `applyOptions` (which only caches), mirroring [Checkbox's pattern](../src/typescript/lib/component/input/Checkbox.ts#L152).

### Filename label formatting

The label reads the current `File[]`:
- empty → `"no file selected"`
- exactly one → the single `file.name`
- multiple → the joined comma-separated names, but if the joined string would be long (`> FILENAME_JOIN_LIMIT` names) → `"N files"`. The threshold is a documented module const.

---

## Public API (TypeScript Signatures)

```typescript
// FileField.ts
export interface FileFieldOptions extends AbstractInputOptions {
    /** Allow selecting more than one file. Maps to the native `multiple` attribute. Default false. */
    multiple?: boolean;
    /** Native file-type filter, e.g. ".sql,.csv" or "image/*". Maps to the native `accept` attribute. */
    accept?:   string;
    /** Trigger button label. Default "Choose file…" / "Choose files…" per `multiple`. */
    buttonText?: string;
}

class FileField<TOptions extends FileFieldOptions = FileFieldOptions>
    extends AbstractInput<File[], TOptions>
{
    constructor(options?: TOptions);

    getValue(): File[];                 // live read from the native FileList
    setValue(value: File[]): this;      // clears on empty; non-empty is a no-op + warn (see Architecture Decisions)

    isMultiple(): boolean;
    setMultiple(value: boolean): this;  // backing: _options.multiple → native `multiple` attr

    getAccept(): string | null;
    setAccept(value: string): this;     // backing: _options.accept → native `accept` attr

    clearValue(): this;                 // convenience alias for setValue([]); matches Toggle.clearValue() convention

    protected applyEnabled(value: boolean): void;
    protected applyReadOnly(value: boolean): void;
}
export { FileField as _FileField, FileFieldCallable as FileField };
```

```typescript
// FileDropZone.ts
export interface FileDropZoneOptions extends FileFieldOptions {
    /** Instructional text shown inside the zone. Default "Drop files here or click to browse". */
    promptText?: string;
}

class FileDropZone<TOptions extends FileDropZoneOptions = FileDropZoneOptions>
    extends AbstractInput<File[], TOptions>   // composes a FileField internally
{
    constructor(options?: TOptions);

    getValue(): File[];                 // delegates to the inner FileField
    setValue(value: File[]): this;      // delegates to the inner FileField
    clearValue(): this;                 // delegates to the inner FileField's clearValue()

    protected applyEnabled(value: boolean): void;
    protected applyReadOnly(value: boolean): void;
}
export { FileDropZone as _FileDropZone, FileDropZoneCallable as FileDropZone };
```

`FileDropZone` re-emits the inner `FileField`'s `change`/`binding` events through its own `AbstractInput` listener bag (wire the inner field's `on("change", …)` to `this.notifyChange(...)` in the constructor) so a single `FileDropZone` instance satisfies `Bindable<File[]>` directly — the composing field is an internal detail, not part of the bound surface.

---

## Theme Tokens

`FileDropZone` needs its own border/background tokens (the internal-drag `dropzone` tokens are intentionally not reused — see Architecture Decisions). `FileField`'s trigger button inherits `Button`/`--ts-ui-form-*` tokens and needs no new colours; only the filename/prompt text colour token below is shared.

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-filedropzone-bg` | `rgba(80, 140, 240, 0.06)` | `rgba(80, 140, 240, 0.10)` | Resting zone background |
| `--ts-ui-filedropzone-border` | `2px dashed rgba(80, 140, 240, 0.40)` | `2px dashed rgba(80, 140, 240, 0.45)` | Resting dashed border |
| `--ts-ui-filedropzone-active-bg` | `rgba(80, 140, 240, 0.18)` | `rgba(80, 140, 240, 0.24)` | Background while a valid drag hovers |
| `--ts-ui-filedropzone-active-border` | `2px dashed rgba(80, 140, 240, 0.80)` | `2px dashed rgba(80, 140, 240, 0.85)` | Border while a valid drag hovers |

Token plumbing (four files, per the existing `drag.dropzone` precedent):
- **`Theme.ts`** — add a `fileDropZone: { background; border; activeBackground; activeBorder }` block to the `Theme` interface (near the `drag`/`form` blocks), and four `'--ts-ui-filedropzone-*': theme.fileDropZone.*` lines in [`themeToVars`](../src/typescript/lib/core/Theme.ts#L700).
- **`themes/ClassicTheme.ts`**, **`themes/ModernTheme.ts`** — light values above.
- **`themes/DarkTheme.ts`** — dark values above.
- **`themes/BaseTheme.ts`** — no entry needed (it is a sparse scaffold; the concrete themes carry the values).

Light values go in both Classic and Modern to match the existing `drag.dropzone` duplication.

---

## Internal Structure

`FileField` DOM tree (one Component per element, per ARCHITECTURE.md):
```
FileField (root, HBox)
 ├─ Button   (trigger; on("action") → this._input.getElement().click())
 ├─ Text     (filename label; truncate:true)
 └─ Component (hidden <input type="file">, display:none; owns the native change event)
```

`FileDropZone` DOM tree:
```
FileDropZone (root; dashed border; on subtree: dragover/dragleave/drop)
 └─ FileField (composed core — supplies the hidden input, picker click, value plumbing)
    └─ … (Button + label + hidden input as above)
```

Drop handler core (FileDropZone):
```typescript
private onDrop(e: DragEvent): void {
    e.preventDefault();
    this.setActive(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) {
        return;
    }

    // Hand the dropped FileList to the inner field so one code path owns
    // formatting + notify. The field cannot push these into its hidden
    // <input> (security model), so it stores them as its live value and
    // updates the label directly. notifyChange fans out change/binding.
    this._field.acceptDroppedFiles(files);
}
```

This requires the inner `FileField` to keep its own `File[]` cache that `getValue()` returns when populated by a drop (the hidden `<input>` stays empty for dropped files; `getValue` returns the cache OR `el.files` — the cache is set on drop, cleared and superseded on the next native `change`). The `acceptDroppedFiles` method is `internal`/package-visible (exported `_FileField` symbol), used only by `FileDropZone`.

---

## Ordered Implementation Steps

1. **`Theme.ts`** — add the `fileDropZone` block to the `Theme` interface and the four `--ts-ui-filedropzone-*` entries to `themeToVars`. Verify: `grep -n filedropzone src/typescript/lib/core/Theme.ts` → 4+ hits.
2. **`themes/ClassicTheme.ts`, `themes/ModernTheme.ts`, `themes/DarkTheme.ts`** — add the `fileDropZone` value blocks (light × 2, dark × 1).
3. **Create `src/typescript/lib/component/input/FileField.ts`** — `FileFieldOptions`, the class extending `AbstractInput<File[]>`, the trigger `Button`, the `Text` label, the hidden `tag:"input"` Component with `type=file`; typed `setMultiple`/`setAccept` with `_options` backing + `applyOptions` caching + constructor-tail dispatch; native `change` listener via `Event.addListener` → read `el.files` → cache + relabel + `notifyChange`; `getValue`/`setValue` (clear-only) per the Architecture Decision; `clearValue()` (matches the [`Toggle.clearValue()`](../src/typescript/lib/component/input/Toggle.ts#L201) convention); `acceptDroppedFiles(files)`; `applyEnabled`/`applyReadOnly` (forward to button + hidden input). `callable()` wrap + dual export.
4. **Create `src/typescript/lib/component/input/FileDropZone.ts`** — `FileDropZoneOptions`, the class extending `AbstractInput<File[]>` composing a `_FileField`; dashed-border styling from the new tokens; `Event.addSubtreeListener` for `dragover`(preventDefault + setActive(true)), `dragleave`(setActive(false)), `drop`(the handler above); click-to-pick by forwarding zone click to the inner field's picker; `getValue`/`setValue` delegate to the inner field; re-emit inner `change`/`binding`. `callable()` wrap + dual export.
5. **`component/input/index.ts`** — export `FileField`/`FileFieldOptions` and `FileDropZone`/`FileDropZoneOptions`.
6. **Demo** — add a small `FileField` + `FileDropZone` showcase to [`BindingPanel.ts`](../src/typescript/BindingPanel.ts) (or the existing form-input demo panel) so both render in the dev app for manual verification.
7. **Docs** — `docs/components/FileField.md` + `docs/components/FileDropZone.md`; add both to `docs/components/index.md` catalog and the sidebar in `docs/.vitepress/config.mts`.
8. **Verify** — typecheck, `npm run docs:build` (0 errors / 0 link warnings), manual smoke test (see Verification).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/input/FileField.ts` |
| Create | `src/typescript/lib/component/input/FileDropZone.ts` |
| Modify | `src/typescript/lib/component/input/index.ts` |
| Modify | `src/typescript/lib/core/Theme.ts` |
| Modify | `src/typescript/lib/core/themes/ClassicTheme.ts` |
| Modify | `src/typescript/lib/core/themes/ModernTheme.ts` |
| Modify | `src/typescript/lib/core/themes/DarkTheme.ts` |
| Modify | `src/typescript/BindingPanel.ts` (demo) |
| Create | `docs/components/FileField.md` |
| Create | `docs/components/FileDropZone.md` |
| Modify | `docs/components/index.md` |
| Modify | `docs/.vitepress/config.mts` |

---

## Verification

- **Typecheck:** project build/typecheck passes.
- **Barrel:** `grep -n 'FileField\|FileDropZone' src/typescript/lib/component/input/index.ts` → both exported.
- **No internal-drag coupling:** `grep -n 'DragManager\|makeDropTarget' src/typescript/lib/component/input/FileDropZone.ts` → zero hits.
- **Token plumbing:** `grep -rn 'filedropzone' src/typescript/lib/core/` → entries in `Theme.ts` + all three concrete theme files.
- **Manual smoke (dev app, scope to the demo panel):**
  - Single mode: click trigger → OS picker → pick one file → label shows its name; `getValue()` returns `[File]`.
  - `multiple: true`: pick several → label shows joined names or `"N files"` past the threshold.
  - `accept: ".csv"`: OS picker filters to CSV.
  - `FileDropZone`: drag a file from the OS onto the zone → border/background highlights on `dragover`, reverts on `dragleave`, and on `drop` the inner label updates and `change`/`binding` fire.
  - `setValue([])` clears; `setValue([someFile])` logs the documented warning and leaves selection unchanged.
  - Bind a `FileField` to a record via `Binding`; pick a file → record field updates.
- **Theme toggle:** switch Classic/Modern/Dark — the dropzone border/background tokens resolve in each.
- **Docs:** `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

- **Barrel:** `src/typescript/lib/component/input/index.ts` exports both classes + option interfaces; both carry `@category Components` so they land in `docs/api/component/input/index.md` after build (the callable dual-export form `XCallable as X` auto-promotes them from `variables/` to `classes/` via `typedoc-callable-plugin`).
- **Curated pages:** add `docs/components/FileField.md` and `docs/components/FileDropZone.md` (mirror the [`Checkbox.md`](../docs/components/Checkbox.md) shape: intro line linking `/api/component/input/classes/…`, Usage, Common methods table). Each must call out the `setValue` security-model limitation explicitly.
- **Catalog + sidebar:** add both to `docs/components/index.md` and `docs/.vitepress/config.mts`.
- **Cross-bucket JSDoc:** references to `Bindable`/`Binding`/`Button`/`AbstractInput` from these files use markdown links (`[\`Bindable\`](/api/core/interfaces/Bindable)`), not `{@link}`, per `_shared/docs-conventions.md` (different bucket).

---

## Potential Challenges

- **Drop highlight flicker:** `dragover`/`dragleave` fire repeatedly as the cursor crosses child elements; debounce by tracking a drag-depth counter or checking `relatedTarget` so the highlight doesn't strobe over the composed `FileField`'s children.
- **`dataTransfer.files` empty on `dragover`:** the `FileList` is only populated on `drop` in most browsers; do not read it during `dragover` — only `preventDefault` there.
- **Dropped files vs. picked files in `getValue`:** the hidden `<input>` cannot hold dropped files, so `FileField` must reconcile two sources (the native `FileList` and the drop cache); the next native `change` must supersede a stale drop cache, and a `clear()` must reset both.
- **`accept` is advisory:** the native `accept` attribute filters the picker but does not prevent drag-dropping disallowed types; this plan does not add drop-side MIME validation (out of scope) — note it in the doc.

---

## Critical Files

- [`AbstractInput.ts`](../src/typescript/lib/component/input/AbstractInput.ts) — base class, `getValue`/`setValue`/`notifyChange`/`applyEnabled`/`applyReadOnly` contract, the cascade rule (setters dispatched from constructor tail, not `applyOptions`).
- [`Checkbox.ts`](../src/typescript/lib/component/input/Checkbox.ts) — closest precedent: `Bindable`, `applyOptions` caching, constructor-tail dispatch, `callable()` dual export.
- [`TextInput.ts`](../src/typescript/lib/component/input/TextInput.ts) — `tag:"input"` Component, native attribute writes via `setElementAttribute`, bridging the native DOM event into `notifyChange`.
- [`PickerButton.ts`](../src/typescript/lib/component/input/PickerButton.ts) / [`Button.ts`](../src/typescript/lib/component/button/Button.ts) — trigger-button reuse pattern.
- [`Bindable.ts`](../src/typescript/lib/core/Bindable.ts) / [`Binding.ts`](../src/typescript/lib/core/Binding.ts) — the bind contract `setValue`/`getValue`/`on("binding")`.
- [`Event.ts`](../src/typescript/lib/core/Event.ts) — `addListener` (exact target), `addSubtreeListener` (descendant match), `PASSIVE_TYPES`, native event pass-through.
- [`DragManager.ts`](../src/typescript/lib/core/DragManager.ts) — confirm it is pointer/synthetic-event based and must NOT be used for OS file drops.
- [`Theme.ts`](../src/typescript/lib/core/Theme.ts) + `themes/{Classic,Modern,Dark}Theme.ts` — token interface + `themeToVars` + per-theme values.
- [`component/input/index.ts`](../src/typescript/lib/component/input/index.ts) — export surface.

---

## Non-Goals

- **Drop-side MIME/type validation** — the `accept` attribute filters the OS picker only; validating dropped file types is deferred (mention the gap in the doc).
- **Upload / progress / preview** — these are pure selection controls; no XHR, no thumbnails.
- **Re-populating a non-empty selection via `setValue`** — impossible under the browser security model (documented, not worked around).
- **Reusing the internal `--ts-ui-drag-dropzone-*` tokens** — kept separate to avoid coupling the file-drop surface to the internal-component-drag overlay.
