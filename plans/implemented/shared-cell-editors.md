# Shared Cell Editors — Implementation Plan

## Overview

Every cell in [Body.ts](../src/typescript/lib/component/table/Body.ts) currently allocates *two* components: a renderer and an editor. With a virtual row pool of, say, 30 rows × 10 columns, that is ~300 cells × 2 = ~600 components — and ~270 of those editors (everything except `BooleanCell`, `GlyphCell`, and `DefaultCell`) sit idle, eating allocation cost, theme-listener registrations, and a `cell.doLayout()` pass per cell.

The proposal: hold a **single instance per editor type** at the [Body](../src/typescript/lib/component/table/Body.ts) level, and parent that shared editor into the active cell on `startEdit()` / detach on commit/cancel. There is at most one cell being edited at any time, so one editor per type is sufficient.

The change is surgical and concentrated in [Cell.ts:24](../src/typescript/lib/component/table/cell/Cell.ts#L24), the typed-cell subclasses ([String.ts:15](../src/typescript/lib/component/table/cell/String.ts#L15) etc.), [Row.ts:30](../src/typescript/lib/component/table/Row.ts#L30) and [Body.ts:46](../src/typescript/lib/component/table/Body.ts#L46). Renderers are untouched — they remain one per cell because every row must display its own value.

---

## Architecture Decisions

### Pool owned by `Body`, not `Table`

`Body` is the only place editing happens (rows live in `Body`, the row pool is keyed there, and `Body.onKeyDown` initiates edits via [Body.ts:817](../src/typescript/lib/component/table/Body.ts#L817)). Putting the editor registry on `Body` keeps the lifetime aligned with the row pool: `clearRowPool` doesn't need to touch editors, but `setStore` / theme-change paths already invalidate the row pool, and the editor pool naturally survives both since editors are theme-agnostic by the time they're built. `Table` exposes the body via `getBody()` already, so no new top-level API is needed.

### Pool keyed by *editor variant*, not just type

`TimeCell` and `DateTimeCell` take a `showSeconds: boolean` flag ([Time.ts:19](../src/typescript/lib/component/table/cell/Time.ts#L19), [DateTime.ts:19](../src/typescript/lib/component/table/cell/DateTime.ts#L19)) that is wired straight into their editors. A table with two time columns — one tracking minutes, one tracking seconds — must not collapse them into one shared editor with stale `step` semantics. The pool key is therefore the cell-provided string returned from `getEditorKey()`:

| Cell | Key |
|---|---|
| `StringCell` | `"string"` |
| `NumberCell` | `"number"` |
| `DateCell` | `"date"` |
| `TimeCell` (no seconds) | `"time"` |
| `TimeCell` (with seconds) | `"time:seconds"` |
| `DateTimeCell` (no seconds) | `"datetime"` |
| `DateTimeCell` (with seconds) | `"datetime:seconds"` |
| `BooleanCell`, `GlyphCell`, `DefaultCell` | `null` |

At most one entry per key is ever created; first edit lazily constructs.

### `BooleanCell` opts out of the pool

[Boolean.ts:17](../src/typescript/lib/component/table/cell/Boolean.ts#L17) uses its `BooleanEditor` as the renderer itself — the checkbox is permanently visible and reflects each row's value. Sharing one checkbox across visible rows is impossible; every row needs its own. `BooleanCell` therefore returns `null` from `getEditorKey()` and keeps allocating its own `BooleanEditor` exactly as today. No regression, no win.

### Backward-compatible Cell constructor

The [custom-cell recipe](../docs/recipes/custom-cell.md) and [`Cell.ts:32`](../src/typescript/lib/component/table/cell/Cell.ts#L32) document the constructor as `super(tag, renderer, editor?)`. We keep that signature working for user-authored cells: if `editor` is provided to the constructor, the cell uses it the old way (added to its own Card layout, listeners wired in the constructor). If `editor` is absent **and** `getEditorKey()` returns non-null, the cell uses the shared pool. Custom cells that want the shared-pool benefit can override `getEditorKey()` and register a factory with the pool — but that's opt-in, not forced.

### `Card` layout retained, editor reparented in/out per edit

Each cell keeps its `Card` layout with the renderer as the sole pre-registered child. On `startEdit`, the cell calls `this.addComponent(editor, …)` (registers + DOM-appends), then `setVisibleComponentId(editor.getId())`. On commit/cancel, it switches the Card back to the renderer and calls `this.removeComponent(editor)`. This piggy-backs on the framework's existing add/remove machinery — no manual element moves, no off-screen holder div — and keeps the editor's element a DOM child of the active gridcell, preserving the existing ARIA grouping.

The editor's home between edits is the pool's internal `Map`; its element simply gets detached on `removeComponent` and re-attached on the next acquire. We never destroy and rebuild it.

### Listeners wired once per editor, dispatch via `activeCell` pointer

Today each cell does `Event.addListener(editor, 'blur', () => this.commitEdit())` inside its constructor ([Cell.ts:55-57](../src/typescript/lib/component/table/cell/Cell.ts#L55-L57)). With a shared editor we cannot add/remove per edit (cheap-but-noisy) — instead, the pool wires each editor's `blur` and `keydown` exactly once at first creation, routing through the pool's `activeCell` pointer:

```typescript
Event.addListener(editor, 'blur',    ()              => this.activeCell?.commitEdit());
Event.addListener(editor, 'keydown', (e: KeyboardEvent) => this.activeCell?.onKeyDown(e));
```

`activeCell` is set in `acquire()` and cleared in `release()`.

---

## Public API (TypeScript Signatures)

### `Cell` — additions

```typescript
export class Cell<T> extends Component {
    // unchanged constructor signature
    constructor(
        tag: string,
        renderer: CellRenderer<T>,
        editor?: CellEditor<T>,
        rendererConstraints?: LayoutConstraints,
        editorConstraints?: LayoutConstraints,
    );

    // NEW — override in built-in subclasses; default returns null (legacy mode)
    getEditorKey(): string | null;

    // NEW — Body sets this on every cell after constructing the row
    setEditorPool(pool: CellEditorPool | null): this;
}
```

### `CellEditorPool` (new file `cell/editor/CellEditorPool.ts`)

```typescript
export type CellEditorFactory = () => CellEditor<unknown>;

export class CellEditorPool {
    constructor();

    /** Register or override a factory for a given key. Built-ins seeded by the constructor. */
    register(key: string, factory: CellEditorFactory): this;

    /**
     * Returns the shared editor for `key`, lazily constructing it on first call,
     * wiring blur/keydown listeners once, and marking `cell` as the active edit target.
     */
    acquire(key: string, cell: Cell<unknown>): CellEditor<unknown> | null;

    /** Clears the active-cell pointer. Called when the cell commits/cancels. */
    release(): void;
}
```

The pool is exported from the `component/table` barrel so custom-cell authors can register factories on a table's `body.getEditorPool()`.

### `Body` — addition

```typescript
class Body extends Component {
    // NEW
    getEditorPool(): CellEditorPool;
}
```

### Typed-cell subclasses

The seven typed-cell subclasses lose their editor allocations (except `BooleanCell`) and gain a `getEditorKey()` override. Constructor signature visible to callers is unchanged.

```typescript
class StringCell   extends Cell<String>      { getEditorKey(): string { return "string"; } }
class NumberCell   extends Cell<Number>      { getEditorKey(): string { return "number"; } }
class DateCell     extends Cell<Date | null> { getEditorKey(): string { return "date"; } }
class TimeCell     extends Cell<Date | null> { getEditorKey(): string { return this.showSeconds ? "time:seconds" : "time"; } }
class DateTimeCell extends Cell<Date | null> { getEditorKey(): string { return this.showSeconds ? "datetime:seconds" : "datetime"; } }
// BooleanCell, GlyphCell, DefaultCell — no override; inherit null
```

---

## Implementation

### `CellEditorPool` skeleton

```typescript
export class CellEditorPool {
    private editors  : Map<string, CellEditor<unknown>>   = new Map();
    private factories: Map<string, CellEditorFactory>     = new Map();
    private activeCell: Cell<unknown> | null              = null;

    constructor() {
        this.factories.set("string",            () => new StringEditor());
        this.factories.set("number",            () => new NumberEditor());
        this.factories.set("date",              () => new DateEditor());
        this.factories.set("time",              () => new TimeEditor(false));
        this.factories.set("time:seconds",      () => new TimeEditor(true));
        this.factories.set("datetime",          () => new DateTimeEditor(false));
        this.factories.set("datetime:seconds",  () => new DateTimeEditor(true));
    }

    register(key: string, factory: CellEditorFactory): this {
        this.factories.set(key, factory);
        // If we already cached an editor for this key, drop it so the new factory runs next acquire.
        this.editors.delete(key);
        return this;
    }

    acquire(key: string, cell: Cell<unknown>): CellEditor<unknown> | null {
        const factory = this.factories.get(key);
        if (!factory) return null;

        let editor = this.editors.get(key);
        if (!editor) {
            editor = factory();
            this.wireListeners(editor);
            this.editors.set(key, editor);
        }

        this.activeCell = cell;
        return editor;
    }

    release(): void {
        this.activeCell = null;
    }

    private wireListeners(editor: CellEditor<unknown>): void {
        Event.addListener(editor, "blur",    ()              => this.activeCell?.commitEdit());
        Event.addListener(editor, "keydown", (e: KeyboardEvent) => this.activeCell?.onKeyDown(e));
    }
}
```

### `Cell` edit lifecycle (post-refactor)

```typescript
private editor: CellEditor<T> | undefined;        // legacy mode only
private editorPool: CellEditorPool | null = null; // shared mode
private activeEditor: CellEditor<T> | null = null;// the editor currently mounted

getEditorKey(): string | null { return null; }

setEditorPool(pool: CellEditorPool | null): this {
    this.editorPool = pool;
    return this;
}

startEdit(): void {
    if (this.isReadOnly() || this.isEditing()) return;

    // Legacy path: editor was passed in via constructor and is already a child.
    if (this.editor) {
        this.activeEditor = this.editor;
    } else {
        const key = this.getEditorKey();
        if (!key || !this.editorPool) return;
        const shared = this.editorPool.acquire(key, this as Cell<unknown>);
        if (!shared) return;
        this.activeEditor = shared as CellEditor<T>;
        this.addComponent(this.activeEditor); // attaches to Card layout + DOM
    }

    const editor = this.activeEditor;
    editor.setValue(this.renderer.getValue());
    this.getLayoutManager().setVisibleComponentId(editor.getId());
    this.doLayout();
    editor.focus();
}

commitEdit(): this { /* read value, fire onCommit, then detach (see below) */ }
cancelEdit(): void { /* detach (see below) */ }

private detachEditor(): void {
    if (!this.activeEditor) return;
    this.getLayoutManager().setVisibleComponentId(this.renderer.getId());
    this.doLayout();

    // Only detach when the editor came from the pool — legacy editors stay parented.
    if (this.editor !== this.activeEditor) {
        this.removeComponent(this.activeEditor);
        this.editorPool?.release();
    }
    this.activeEditor = null;
}
```

`isEditing()` becomes `return this.activeEditor !== null` — Card's `getVisibleComponentId()` lookup is now redundant.

### `Body` integration

```typescript
class Body extends Component {
    private editorPool: CellEditorPool = new CellEditorPool();

    getEditorPool(): CellEditorPool { return this.editorPool; }
}
```

In `growRowPool` ([Body.ts:386](../src/typescript/lib/component/table/Body.ts#L386)) just after the `new Row(...)`:

```typescript
for (const cell of row.getComponents() as Cell<unknown>[]) {
    cell.setEditorPool(this.editorPool);
}
```

(Alternative: pass the pool into the `Row` constructor and have `Row` set it on each cell at creation time. Either works; the post-construction loop keeps `Row`'s constructor signature stable and is one line in `Body`. Pick whichever your style guide prefers.)

---

## Ordered Implementation Steps

### Step 1 — Add `getEditorKey()` to `Cell`

[Cell.ts:24](../src/typescript/lib/component/table/cell/Cell.ts#L24): add `getEditorKey(): string | null { return null; }` as a virtual default. No behaviour change yet.

### Step 2 — Create `CellEditorPool`

New file `src/typescript/lib/component/table/cell/editor/CellEditorPool.ts`. Constructor seeds the seven built-in factories. Listeners wired in `acquire` on first construction of each editor.

### Step 3 — Wire pool into `Body`

[Body.ts:46](../src/typescript/lib/component/table/Body.ts#L46): add `private editorPool: CellEditorPool = new CellEditorPool();` and a `getEditorPool()` getter. In `growRowPool`, after the `new Row(...)` call, iterate the row's cells and `cell.setEditorPool(this.editorPool)`.

### Step 4 — Add `setEditorPool` + shared-mode lifecycle to `Cell`

Replace the editor-related portions of `Cell.startEdit / commitEdit / cancelEdit` per the snippet above. `isEditing()` switches to checking `this.activeEditor !== null`.

### Step 5 — Migrate built-in typed cells

For each of `StringCell`, `NumberCell`, `DateCell`, `TimeCell`, `DateTimeCell`:

- Stop constructing the editor in the constructor.
- Call `super('td', renderer)` (3-arg form — no editor).
- Override `getEditorKey()`.
- For `TimeCell` / `DateTimeCell`: store `showSeconds` as a private field so `getEditorKey()` can read it and return the right variant.
- Remove the `private dateEditor`/`timeEditor`/`dateTimeEditor` fields. The `commitEdit()` overrides on these three need to read `getValue()` / `isEmpty()` off `this.activeEditor as DateEditor` (or equivalent) — i.e., the editor mounted at commit time.

`BooleanCell`, `GlyphCell`, `DefaultCell`, `HeaderCell` — unchanged.

### Step 6 — Verify no regressions in `commitEdit()` overrides

The three "revert on bad input" overrides in [Date.ts:33](../src/typescript/lib/component/table/cell/Date.ts#L33), [Time.ts:33](../src/typescript/lib/component/table/cell/Time.ts#L33), [DateTime.ts:33](../src/typescript/lib/component/table/cell/DateTime.ts#L33) all peek at the editor's `isEmpty()` and `getValue()` before calling `super.commitEdit()`. Replace `this.dateEditor` (etc.) reads with `(this.activeEditor as DateEditor)`. Add a guard for `activeEditor === null` (shouldn't happen since `commitEdit` no-ops if not editing, but explicit is cheap).

### Step 7 — Drop dead code

- `Cell.getEditor()` — currently returns `this.editor`. Keep for legacy custom cells; it returns the legacy-mode editor or `undefined`. Don't expose pooled editors through it (a getter that sometimes returns the active editor and sometimes nothing is confusing).
- The unused `editorConstraints` parameter on `Cell` constructor is unused once built-in cells stop passing editors. Leave it: it's still used by user-authored cells in legacy mode.

### Step 8 — Verification + docs

See **Verification** below. Update [docs/recipes/custom-cell.md](../docs/recipes/custom-cell.md) to document both modes:

- "Quick way" (legacy): pass `editor` to `super(...)` — works today, no pool involvement.
- "Shared-editor way": override `getEditorKey()` to return `'currency'`, then register a factory via `table.getBody().getEditorPool().register('currency', () => new CurrencyEditor())` *before* the first edit.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/table/cell/editor/CellEditorPool.ts` |
| Modify | `src/typescript/lib/component/table/cell/Cell.ts` |
| Modify | `src/typescript/lib/component/table/cell/String.ts` |
| Modify | `src/typescript/lib/component/table/cell/Number.ts` |
| Modify | `src/typescript/lib/component/table/cell/Date.ts` |
| Modify | `src/typescript/lib/component/table/cell/Time.ts` |
| Modify | `src/typescript/lib/component/table/cell/DateTime.ts` |
| Modify | `src/typescript/lib/component/table/Body.ts` |
| Modify | `src/typescript/lib/component/table/index.ts` (export `CellEditorPool`) |
| Modify | `docs/recipes/custom-cell.md` |

---

## Verification

1. `npx tsc --noEmit` — no new errors above the baseline.
2. `npx vite build` succeeds.
3. `npm run dev` and open the table demo (`ComplexUIPanel`):
   - Double-click a string cell → `StringEditor` mounts, focuses, edit commits on Enter. Repeat on another string cell — same editor instance is reused (verify in DevTools: only one `<input>` exists for string editing across the whole body).
   - Double-click a number cell → right-aligned editor appears with correct text.
   - Edit a `date`, `time`, `datetime` column — verify the `step` attribute is correct when one column has `showSeconds: true` and another has `false`.
   - Edit a `boolean` cell — checkbox is still per-row, toggles immediately, commits without entering "edit mode".
   - Press Escape mid-edit: editor disappears, renderer shows unchanged value.
   - Press Enter mid-edit: renderer updates and focus returns to the body (existing `setOnEditEnd` behaviour at [Body.ts:812](../src/typescript/lib/component/table/Body.ts#L812)).
4. Scroll the body fast while an edit is in progress: the editor remains attached to the cell that initiated the edit even when that cell's row pool slot scrolls away. *Expected:* this is the same behaviour as today (the editor moves with its cell because the cell's DOM element is the editor's parent). Sanity-check by editing a cell, scrolling so its row leaves the viewport, then scrolling back — the editor should still be there mid-edit.
5. Memory smoke test: open DevTools → Memory → take heap snapshot before opening the table; open the table with ~100 rows × 10 columns; take a second snapshot. Compare `StringEditor` / `NumberEditor` instance counts: should be **1 each** (or 0 if those types never edited), not ~1000.
6. `npm run docs:build` — 0 errors and 0 link warnings (excluding the pre-existing typedoc "unsupported TypeScript version" notice).
7. `graphify update .` to refresh the knowledge graph.

---

## Documentation Impact

- **Barrel:** [src/typescript/lib/component/table/index.ts](../src/typescript/lib/component/table/index.ts) gains `export { CellEditorPool } from '~/component/table/cell/editor/CellEditorPool.js'`. No symbols are renamed or removed — all existing `*Editor` exports stay (they're public types user code can subclass).
- **Curated docs:** `docs/components/TableInternals.md` — add a short subsection on the editor pool (one paragraph, plus a note that `BooleanCell` opts out). Add `CellEditorPool` to the table catalog page (`docs/components/index.md` if listed there, plus the sidebar in `docs/.vitepress/config.mts`).
- **Recipe:** [docs/recipes/custom-cell.md](../docs/recipes/custom-cell.md) — update the "Compose the cell" / "Use it in a Table" sections to mention `getEditorKey()` and the pool-`register` path as the recommended approach for high-row-count tables. Keep the legacy path documented for simple/one-off cells.
- **Cross-bucket JSDoc:** `CellEditorPool` is in `component/table`; the only other bucket that might link to it is — looking at usage — none. Body/Cell are also in `component/table`, so they use `{@link CellEditorPool}` inside the same bundle. No markdown-link forms needed for this change.

---

## Potential Challenges

- **Edit interrupted by row pool rebinding.** If the user edits cell X in pool slot 3, then scrolls so slot 3 is rebound to a different data record, the editor's parent cell now displays the new record's renderer value behind a still-mounted editor showing the old record's value. Today this is *already* a hazard (each cell owns its editor and the bug shape is the same); the refactor doesn't worsen it but a fix could be added in the same pass — `Body.bindAndPositionRows` could call `cell.cancelEdit()` whenever `wasRebound === true` and the cell was editing. Flag this as a follow-up if not desired here.
- **Listeners persist across pool key swaps.** Once `StringEditor` is created with its `blur`/`keydown` wired through the pool's `activeCell`, those listeners stay forever. That's intentional — the pool lives as long as the Body — but it does mean the listeners hold a reference to the pool. Not a leak unless the Body is discarded and a fresh one created without releasing the pool; current `setStore` keeps the same Body. Watch for this if a future feature swaps bodies.
- **DOM-detach side effects.** `removeComponent(editor)` will detach the editor's element. The next `addComponent(editor)` re-appends it to the new cell. Native `<input>` elements lose focus on detach — that's fine because we always focus *after* mounting. The text content of `<input type="date">` and friends survives detach/reattach.
- **`Card.setVisibleComponentId` after `removeComponent`.** When we remove the editor and the card's visible-component points to the editor's id, the renderer must be set visible first (Step 4 snippet does this). Verify in `Card.ts` that `setVisibleComponentId(rendererId)` before `removeComponent(editor)` doesn't crash on a missing component.

---

## Critical Files

- [src/typescript/lib/component/table/cell/Cell.ts](../src/typescript/lib/component/table/cell/Cell.ts) — base class with the edit lifecycle.
- [src/typescript/lib/component/table/cell/Boolean.ts](../src/typescript/lib/component/table/cell/Boolean.ts) — the one cell that must stay on legacy mode; verify the refactor preserves its behaviour.
- [src/typescript/lib/component/table/Body.ts](../src/typescript/lib/component/table/Body.ts) — pool ownership + `growRowPool` wire-up.
- [src/typescript/lib/component/table/Row.ts](../src/typescript/lib/component/table/Row.ts) — cell-construction site; understand the per-field switch.
- [src/typescript/lib/component/table/cell/editor/CellEditor.ts](../src/typescript/lib/component/table/cell/editor/CellEditor.ts) — base class; padding listener registered in constructor will now fire on theme changes for *one* editor per type instead of N, which is fine.
- [src/typescript/lib/component/table/cell/Date.ts](../src/typescript/lib/component/table/cell/Date.ts) / [Time.ts](../src/typescript/lib/component/table/cell/Time.ts) / [DateTime.ts](../src/typescript/lib/component/table/cell/DateTime.ts) — the three `commitEdit` overrides that peek at editor state.
- [docs/recipes/custom-cell.md](../docs/recipes/custom-cell.md) — public-facing extension recipe.

---

## Non-Goals

- **Not changing renderers.** Renderers stay one-per-cell. Every row must paint its own value, so there's no sharing opportunity.
- **Not touching `BooleanCell` / `GlyphCell` / `DefaultCell`.** Their renderers either *are* the editor (Boolean) or there's no editor to share (Glyph/Default).
- **Not removing the `editor` constructor parameter from `Cell`.** Custom cells documented in the recipe rely on it; backward compatibility is a hard requirement here.
- **Not introducing focus-recovery on row-pool rebind.** Mentioned under Potential Challenges; leave for a follow-up unless the user requests it as part of this change.
- **Not auto-registering custom-cell factories.** The shared-pool path requires the user to call `body.getEditorPool().register(key, factory)` explicitly; no magic discovery.
