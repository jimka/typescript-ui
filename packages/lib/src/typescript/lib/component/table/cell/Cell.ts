// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { Insets } from "~/primitive/Insets.js";
import { Card } from "~/layout/Card.js";
import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { CellEditor, blurRelatedTargetHandle } from "~/component/table/cell/editor/CellEditor.js";
import type { ForwardedKeyDetail } from "~/component/table/cell/editor/CellEditor.js";
import { CellEditorPool } from "~/component/table/cell/editor/CellEditorPool.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";

/**
 * String-literal union of the events emitted by {@link Cell}.
 *
 * @category Components
 */
export type CellEvent = "commit" | "editend";

// Every cell resolves its text colour, resting background, and resting
// border to the same theme tokens, on every instance and every subclass, so
// they are class defaults rather than per-instance writes — which keeps
// these declarations on the shared `.Cell`-family class rule instead of
// each cell's own `#id` rule. A subclass that paints a different resting
// background (`ParentHeaderCell`, `GroupSeparatorCell`, `FilterCell`) sets
// it imperatively in its own constructor, which still wins on `#id` over
// this default.
const _defaultCellOptions: Partial<ComponentOptions> = {
    foregroundColor: 'var(--ts-ui-table-cell-color, inherit)',
    backgroundColor: 'var(--ts-ui-table-cell-bg, transparent)',
    border:          'var(--ts-ui-table-cell-border, none)',
};

/**
 * Base class for table cells that support both a display renderer and an optional in-place editor.
 *
 * A {@link Card} layout toggles between the renderer and editor views. Double-clicking the
 * renderer starts an edit; blur or Enter commits it; Escape cancels it.
 *
 * Subclasses ({@link BooleanCell}, {@link NumberCell}, {@link StringCell}, {@link HeaderCell})
 * wire a typed renderer and editor pair. Custom cell types extend this class with your own
 * renderer / editor classes.
 *
 * @category Components
 */
export class Cell<T> extends Component {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. The same constant this
    // class's constructor forwards as `subclassDefaults`, exposed at the
    // class level so `DefaultCell`/`StringCell`/… share `.Cell`'s rule
    // instead of each repeating it.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultCellOptions;

    // Declares the three ephemeral background/cursor/shadow tints — see
    // `## Architecture Decisions` — highest priority first: `.rangeSelected`
    // beats `.readOnly`, which beats `.requiredEmpty` (matching
    // `setReadOnly`'s own precedence note over the required-empty outline).
    // `.readOnly` also declares `shadow: null` — not because `readOnly`
    // itself has an opinion on shadow, but because `resolveStyleValue`'s
    // active-state walk is per-*key*, not per-state: without it, a
    // read-only *and* required-empty cell would still resolve `getShadow()`
    // to `.requiredEmpty`'s ring (the first active layer that *declares*
    // `shadow`, skipping over `.readOnly`, which doesn't) even though
    // `.requiredEmpty`'s own CSS rule is correctly guarded off by
    // `:not(.readOnly)` and never paints — see Cell.test.ts's precedence
    // block, which pins `getShadow()` alongside the CSS declarations.
    //
    // `.focused` (Body's keyboard-focus ring) is deliberately *not* in this
    // list: it shares no property with any of these three (`outline` only),
    // so guarding them against it — `guardedSuffixFor` guards a state
    // against *every* higher-priority entry unconditionally, not only ones
    // sharing a property — would suppress a focused cell's entire
    // background/cursor/shadow tint rather than just layering the ring on
    // top of it. It carries its own unguarded shared rule instead, below.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".rangeSelected",
            extract: (): StyleBag => ({ backgroundColor: "var(--ts-ui-table-cell-range-selected, rgba(30, 100, 200, 0.15))" }),
        },
        {
            selector: ".readOnly",
            extract: (): StyleBag => ({
                backgroundColor: "var(--ts-ui-table-cell-readonly-bg, rgba(0, 0, 0, 0.04))",
                cursor:          "default",
                shadow:          null,
            }),
        },
        {
            selector: ".requiredEmpty",
            extract: (): StyleBag => ({ shadow: "inset 0 0 0 1px var(--ts-ui-table-cell-required-outline, rgba(220, 60, 60, 0.6))" }),
        },
    ];

    private _readOnly: boolean;
    private _requiredEmpty: boolean = false;
    private _rangeSelected: boolean = false;
    private _baseBackground: string = 'var(--ts-ui-table-cell-bg, transparent)';
    private _renderer: CellRenderer<T>;
    private _editor: CellEditor<T> | undefined;
    private _editorPool: CellEditorPool | null = null;
    private _scrollIntoView: (() => void) | null = null;
    // Internal cell-editor wiring: listens on a privately-owned child; see
    // the cell-editor carve-out in ARCHITECTURE.md. An arrow field rather
    // than a plain method: `Event` invokes a listener via
    // `.apply(component, ...)`, bound to the component the listener was
    // registered on — here the renderer, not this cell — so a bare method
    // reference would run with the wrong `this`; the arrow field's lexical
    // `this` keeps it pinned to the cell regardless.
    private _onRendererDoubleClick = (): void => { this.startEdit(); };
    protected _activeEditor: CellEditor<T> | null = null;
    // Typed as `ListenerBag<string>` rather than `ListenerBag<CellEvent>` so
    // subclasses (e.g. HeaderCell) can re-declare the bag with a wider
    // event union without fighting TypeScript's invariant generic on
    // `ListenerBag.add`. The compile-time gate on event names lives on the
    // host's typed `on` / `off` / `emit` overloads, not on the bag field.
    protected _listeners: ListenerBag<string> = this.registerListenerBag(new ListenerBag<string>());

    constructor(tag: string, renderer: CellRenderer<T>, editor?: CellEditor<T>, rendererConstraints?: LayoutConstraints, editorContraints?: LayoutConstraints, subclassDefaults?: Partial<ComponentOptions>) {
        super({ tag: tag || "td" }, { ..._defaultCellOptions, ...(subclassDefaults ?? {}) });

        this.setLayoutManager(new Card());

        this.getAria().setRole("gridcell");

        this._readOnly = false;
        this._renderer = renderer;
        this._editor = editor;
        this.setInsets(new Insets(0, 0, 0, 0));

        // `border` is dispatched automatically from `_defaultCellOptions` by
        // `Component.applyChromeOptions`'s always-dispatch during `super()`
        // above, so `_border` is already set here — no explicit call needed.
        // `backgroundColor` is not in that always-dispatch group (its class
        // default is resolved lazily by `getBackgroundColor()`'s folding
        // getter instead), so it still needs this explicit call: it seeds
        // the instance layer's `backgroundColor` for `_applyStateTint`'s
        // equality guard (`setReadOnly` / `setRequiredEmpty` /
        // `setRangeSelected` / `setBaseBackground`), which compares against
        // the cached value rather than reading through the folding getter.
        this.setBackgroundColor('var(--ts-ui-table-cell-bg, transparent)');

        // Ensures the shared `.Cell.focused` rule for the keyboard-focus
        // ring — `outline` plus its `outline-offset` sibling (which has no
        // `StyleBag` key of its own: a shorthand-less longhand no framework
        // declaration covers). Unguarded — see `ownStyleStates`' own comment
        // for why `.focused` stays out of that list, and therefore needs no
        // `:not(...)` suffix of its own to layer correctly on top of any of
        // the three declared states.
        this.ensureSharedStateRule(".focused", {
            outline:       "var(--ts-ui-indicator-selection, 1px dashed rgb(120, 170, 240))",
            outlineOffset: "-1px",
        });

        this.addComponent(renderer, rendererConstraints);

        if (editor) {
            this.addComponent(editor, editorContraints);

            editor.setCommitRequestHandler(() => this.commitEdit());

            // Internal cell-editor wiring: listens on a privately-owned child;
            // see the cell-editor carve-out in ARCHITECTURE.md.
            Event.addListener(editor, 'blur', (e: FocusEvent) => {
                if (editor.retainsFocus(blurRelatedTargetHandle(e))) {
                    return;
                }

                this.commitEdit();
            });
            Event.addListener(editor, 'keydown', (e: CustomEvent<ForwardedKeyDetail>) => this.onKeyDown(e));
        }

        // Internal cell-editor wiring: listens on a privately-owned child;
        // see the cell-editor carve-out in ARCHITECTURE.md.
        Event.addListener(renderer, 'dblclick', () => this.startEdit());
    }

    /**
     * Opts out of content-size clamping: a cell fits the geometry its host
     * {@link Body} force-assigns (column width × row height), exactly like a
     * {@link Container} fits its parent's allocation. Without this, a cell
     * whose visible child carries a hard maximum — e.g. {@link BooleanCell}'s
     * 16×16 checkbox — would clamp {@link Component.setHeight} down to that
     * child max and sit shorter than the row, pinning the checkbox to the top
     * instead of letting the cell's anchored layout centre it. Only the cell's
     * own explicit min/max remain hard limits.
     *
     * @returns `false` — clamp to explicit constraints only, never to the
     *   content-derived size.
     */
    protected clampsToContentSize(): boolean {
        return false;
    }

    /**
     * Opts into the unchanged-geometry layout skip: a cell re-placed at the
     * same x/width/height it already holds is not re-laid-out.
     *
     * The writers that move a cell's layout without moving its rectangle —
     * each of which already lays the cell out itself, except the theme
     * change, which the host `Header`/`Body` handle by marking their cells
     * dirty (see `Header`'s theme subscription and `Body.onThemeReflow`):
     *
     * - `Cell.setActiveRenderer` — a `DynamicCell` swapping the child the
     *   layout is fitted around.
     * - `Cell.startEdit` / `detachEditor` — the same swap, for the editor
     *   (`detachEditor` is private, reached from `commitEdit` and
     *   `cancelEdit`).
     * - `TreeCellRenderer.setTreeState` — a depth change moves the indent.
     * - `HeaderCell.setHeaderGlyph` — a glyph shifts the renderer's left
     *   inset.
     * - `FilterCell.selectOperator` / `setFilterState` — an operator change
     *   enables/disables the text input, which moves layout without moving
     *   geometry.
     * - `GlyphRenderer.setValue` — replaces its child outright.
     * - A theme change, which rewrites the padding and border every cell is
     *   fitted against.
     *
     * @returns `true` — a cell allows `applyBounds` to skip an unchanged
     *   rectangle.
     */
    protected canSkipUnchangedLayout(): boolean {
        return true;
    }

    /**
     * Returns the pool-key that selects which shared editor this cell should borrow on edit.
     *
     * @returns A string key registered on the {@link CellEditorPool}, or `null` to opt out of
     * the shared-editor mechanism.
     *
     * @remarks The default implementation returns `null` so user-authored cells that pass an
     * editor through the constructor (the legacy path) keep working unchanged. Built-in typed
     * cells override this to return their variant key (e.g. `"string"`, `"time:seconds"`).
     */
    getEditorKey(): string | null {
        return null;
    }

    /**
     * Attaches this cell to a {@link CellEditorPool} so that {@link Cell.startEdit} can borrow
     * a shared editor instead of allocating one.
     *
     * @param pool - The pool to borrow from, or `null` to disable shared-editor mode.
     * @returns This cell, for method chaining.
     */
    setEditorPool(pool: CellEditorPool | null): this {
        this._editorPool = pool;

        return this;
    }

    /**
     * Installs the callback {@link Cell.startEdit} runs before opening the
     * editor, used by the host {@link Body} to scroll this cell's column into
     * view through its scroll model. Running it first means the editor — and
     * any picker dropdown it anchors — opens at the cell's final position
     * rather than its pre-scroll one.
     *
     * @param handler - The scroll-into-view callback, or `null` to clear it.
     * @returns This cell, for method chaining.
     */
    setScrollIntoViewHandler(handler: (() => void) | null): this {
        this._scrollIntoView = handler;

        return this;
    }

    /**
     * Registers a listener for one of this cell's events.
     *
     * @param event - `"commit"` fires with the committed value whenever an
     *   edit is committed; `"editend"` fires after the cell returns to
     *   renderer view via keyboard action (Enter / Escape), not on blur.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This cell, for method chaining.
     */
    on(event: "commit",   listener: (value: T) => void): this;
    on(event: "editend",  listener: () => void): this;
    on(event: CellEvent,  listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This cell, for method chaining.
     */
    off(event: CellEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with `payload`, in
     * registration order.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "commit",   value: T): void;
    protected emit(event: "editend"): void;
    protected emit(event: CellEvent,  ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Returns true if the cell cannot be edited.
     *
     * @returns True if the cell is read-only.
     */
    isReadOnly() {
        return !!this._readOnly;
    }

    /**
     * Sets whether this cell is read-only. Read-only cells refuse
     * {@link Cell.startEdit}, render with the
     * `--ts-ui-table-cell-readonly-bg` tint, and present a default
     * cursor instead of any renderer-supplied edit affordance.
     * Idempotent — passing the current value short-circuits before any
     * style writes.
     *
     * The body is the only writer: its read-only resolution forwards the
     * OR of the static column flag, the spec-level row predicate, and the
     * per-cell predicate, and re-runs whenever a row rebinds or its column
     * window changes — so a read-only column scrolling into view arrives
     * read-only without a rebind. Application code should declare read-only
     * through those config-level surfaces rather than calling this setter
     * directly on a cell.
     *
     * Calling `setReadOnly(true)` while the cell is in edit mode
     * silently commits the active edit before flipping the flag, so the
     * borrowed editor releases back to the {@link CellEditorPool}
     * cleanly and the in-progress user input lands on the record. The
     * commit fires the cell's `onCommit` callback (and any cascading
     * store-event refresh) as if the user had blurred the editor.
     *
     * Read-only wins over the required-empty outline set via
     * {@link Cell.setRequiredEmpty} — a read-only cell cannot be
     * filled, so ringing it as required would be misleading.
     *
     * @param value - `true` to mark read-only, `false` to restore the
     *   default editable appearance.
     * @returns This cell, for method chaining.
     */
    setReadOnly(value: boolean): this {
        if (this._readOnly === value) {
            return this;
        }

        // Flip the flag BEFORE running the mid-edit commit. The
        // commit's onCommit callback synchronously calls
        // `store.notifyRecordChanged`, which cascades back into
        // `Body.applyReadOnlyState` and re-invokes this same setter on
        // this same cell. Flipping first lets the re-entrant call
        // short-circuit on the idempotence guard above; otherwise it
        // would observe `_readOnly === false`, see `isEditing() ===
        // true`, and recurse into `commitEdit` indefinitely.
        // `commitEdit` itself checks `isReadOnly()` and would
        // short-circuit now that the flag is set, so we inline its
        // value/renderer/onCommit/detach sequence here instead.
        this._readOnly = value;

        if (value && this._activeEditor) {
            const committedValue = this._activeEditor.getValue();

            this._renderer.setValue(committedValue);
            this.emit("commit", committedValue as T);
            this.detachEditor();
        }

        this._applyStateTint();

        return this;
    }

    /**
     * Sets whether this cell shows the required-empty outline — a visual
     * cue that a required column's cell currently holds an empty value.
     * Sourced from `--ts-ui-table-cell-required-outline`. Idempotent —
     * passing the current value short-circuits before any style writes.
     *
     * Body rows call this from their per-rebind resolution based on the
     * column's `ColumnConfig.required` flag and `requiredPredicate`.
     * Read-only wins over this outline — see {@link Cell.setReadOnly}'s
     * precedence note.
     *
     * @param value - `true` to show the required-empty outline, `false`
     *   to hide it.
     * @returns This cell, for method chaining.
     */
    setRequiredEmpty(value: boolean): this {
        if (this._requiredEmpty === value) {
            return this;
        }

        this._requiredEmpty = value;
        this._applyStateTint();

        return this;
    }

    /**
     * Sets whether this cell shows the cell-range-selection highlight — a
     * per-cell background tint driven by the host {@link Body}'s rectangular
     * cell-range selection. Sourced from `--ts-ui-table-cell-range-selected`.
     * Idempotent — passing the current value short-circuits before any style
     * writes. Wins over both the read-only tint and the base background in
     * the cell's internal background-resolution precedence.
     *
     * @param value - `true` to show the range-selected tint, `false` to hide it.
     * @returns This cell, for method chaining.
     */
    setRangeSelected(value: boolean): this {
        if (this._rangeSelected === value) {
            return this;
        }

        this._rangeSelected = value;
        this._applyStateTint();

        return this;
    }

    /**
     * Sets the background this cell falls back to when not read-only —
     * e.g. a column's `groupColor` tint. {@link Row} routes its
     * group-color write through this setter (instead of
     * `setBackgroundColor` directly) so a filled cell in a grouped,
     * required column restores its group tint rather than going
     * transparent (the required-empty outline is a separate overlay
     * and does not affect the background).
     *
     * @param color - The CSS color string to use as the base background, or
     *   `null` to restore the theme default
     *   (`var(--ts-ui-table-cell-bg, transparent)`).
     * @returns This cell, for method chaining.
     */
    setBaseBackground(color: string | null): this {
        const background = color ?? 'var(--ts-ui-table-cell-bg, transparent)';

        if (this._baseBackground === background) {
            return this;
        }

        this._baseBackground = background;

        // Pooled, frequently-rebound cell: Row.setColumnWindow / Header's
        // column reconciler call this on every recycle pass, not just on a
        // real change. `cacheStyleValue` keeps `getBackgroundColor()`
        // answering `background` (see Cell.test.ts's background/cursor/
        // outline precedence block) without itself queuing a CSS write —
        // the actual paint routes through the shared `.Cell.bg<color>`
        // value-class rule below instead. That cached instance-layer value
        // is deduped against the recorded value-class layer at flush time
        // (see Component.layersBelowInstance), which is what keeps `#id`
        // clear: cells sharing one groupColor (a whole grouped column,
        // typically) share one rule rather than each materialising its own
        // `#id` declaration.
        this.cacheStyleValue('backgroundColor', background);

        if (color === null) {
            this.clearValueStyleState("bg");
        } else {
            this.setValueStyleState("bg", color, { backgroundColor: color });
        }

        return this;
    }

    /**
     * Toggles the range-selected, read-only, and required-empty state tints
     * — see `ownStyleStates`. Their relative priority (and against
     * `.focused`) is resolved by the generated CSS guard suffixes, not
     * here, so this can just reflect each flag independently.
     */
    private _applyStateTint(): void {
        this.setStyleState(".rangeSelected", this._rangeSelected);
        this.setStyleState(".readOnly", this._readOnly);
        this.setStyleState(".requiredEmpty", this._requiredEmpty);
    }

    /**
     * Commits on Enter and cancels on Escape while editing, then fires `_onEditEnd` to return focus to the container.
     *
     * @param evnt - The forwarded keydown event. The editor re-fires its inner
     *   field's keydown as a custom event whose `detail` carries `keyCode` and
     *   the modifier flags, so this reads `detail` rather than the native
     *   top-level properties.
     */
    onKeyDown(evnt: CustomEvent<ForwardedKeyDetail>): void {
        const keyCode = evnt.detail?.keyCode;

        if (keyCode == 13) { // Enter
            this.commitEdit();
            this.emit("editend");
        } else if (keyCode == 27) { // Escape
            this.cancelEdit();
            this.emit("editend");
        }
    }

    /**
     * Returns true if an editor is currently mounted on this cell.
     *
     * @returns True if the cell is in edit mode.
     */
    isEditing(): boolean {
        return this._activeEditor !== null;
    }

    /**
     * Returns the Card layout manager used to toggle between renderer and editor.
     *
     * @returns The {@link Card} layout manager for this cell.
     */
    getLayoutManager() {
        return <Card>super.getLayoutManager();
    }

    /**
     * Switches to the editor view, copies the renderer's value, and focuses the editor.
     *
     * @remarks When the cell was constructed with a per-cell editor (legacy mode), that editor
     * is used. Otherwise the cell asks its {@link CellEditorPool} for the shared editor matching
     * {@link Cell.getEditorKey} and parents it into this cell for the duration of the edit.
     */
    startEdit(): void {
        if (this.isReadOnly() || this.isEditing()) {
            return;
        }

        // Scroll this column fully into view before the editor opens, so the
        // editor and any picker dropdown it anchors land at the cell's final
        // position. The editor itself focuses with preventScroll, so the
        // browser never scrolls the body out from under the scroll model.
        this._scrollIntoView?.();

        if (this._editor) {
            this._activeEditor = this._editor;
        } else {
            const key = this.getEditorKey();
            if (!key || !this._editorPool) {
                return;
            }

            const shared = this._editorPool.acquire(key, this);
            if (!shared) {
                return;
            }

            this._activeEditor = shared as CellEditor<T>;
            this.addComponent(this._activeEditor);
        }

        const editor = this._activeEditor;
        const renderer = this._renderer;

        this.prepareEditor(editor);
        editor.setValue(renderer.getValue());

        this.getLayoutManager().setVisibleComponentId(editor.getId());
        this.doLayout();
        // preventScroll — the column was already revealed through the scroll
        // model above; a native focus-scroll would desync the header + scrollbar.
        editor.focus(true);
    }

    /**
     * Saves the editor value to the renderer, fires onCommit, and returns to renderer view.
     *
     * @returns This cell, for method chaining.
     */
    commitEdit(): this {
        if (this.isReadOnly() || !this.isEditing()) {
            return this;
        }

        const editor = this._activeEditor!;
        const value = editor.getValue();

        this._renderer.setValue(value);
        this.emit("commit", value as T);

        this.detachEditor();

        return this;
    }

    /**
     * Discards the editor value and returns to renderer view.
     */
    cancelEdit(): void {
        if (this.isReadOnly() || !this.isEditing()) {
            return;
        }

        this.detachEditor();
    }

    /**
     * Restores the renderer as the visible card layer and, in shared-editor mode, detaches the
     * borrowed editor from this cell so the pool can lend it to the next cell.
     *
     * @remarks `activeEditor` is cleared **before** the Card swap because hiding the editor
     * pulls focus off its `<input>` and synchronously fires `blur`. The pool's blur listener
     * routes back into `commitEdit`, which would otherwise re-enter here and double-remove the
     * element — clearing the pointer first makes the re-entrant `isEditing()` check short-circuit.
     */
    private detachEditor(): void {
        const editor = this._activeEditor;
        if (!editor) {
            return;
        }

        this._activeEditor = null;

        this.getLayoutManager().setVisibleComponentId(this._renderer.getId());
        this.doLayout();

        if (this._editor !== editor) {
            this.removeComponent(editor);
            this._editorPool?.release();
        }
    }

    /**
     * Sets the renderer's displayed value.
     *
     * @param value - The value to pass to the renderer.
     */
    setValue(value: T) : this {
        this._renderer.setValue(value);

        return this;
    }

    /**
     * Returns the cell's renderer component.
     *
     * @returns The {@link CellRenderer} for this cell.
     */
    getRenderer() {
        return this._renderer;
    }

    /**
     * Runs the inherited (Card) layout, then re-indents the active
     * editor so it lines up with the renderer's content offset
     * (`renderer.getContentX()`), inside this cell's own content box.
     * For a plain renderer the offset is `0` and this is a no-op; for a
     * [`TreeCellRenderer`](/api/component/table/classes/TreeCellRenderer)
     * the editor shifts right by `depth * indentPx + TOGGLE_WIDTH` so
     * it stays aligned with the value the user double-clicked instead
     * of snapping to the cell's left edge.
     *
     * @returns This cell, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        this.alignEditorWithContent();

        return this;
    }

    /**
     * If an editor is currently active and the renderer reports a
     * non-zero content offset, override the Card layout's
     * fill-the-cell editor placement so the editor starts at that
     * offset from this cell's content box origin and shrinks its
     * width accordingly. Idempotent — when no offset is reserved this
     * is a single comparison and an early return.
     */
    private alignEditorWithContent(): void {
        const editor = this._activeEditor;

        if (!editor) {
            return;
        }

        const contentX = this._renderer.getContentX();

        if (contentX <= 0) {
            return;
        }

        // The Card layout already placed the editor inside this cell's content
        // box, so its y and height are right; only the left edge and the width
        // move here. The outer-width fallback preserves the previous behaviour
        // before the element exists.
        const box = this.getContentBounds()
                 ?? { x: 0, y: 0, width: this.getWidth() ?? 0, height: 0 };

        const editorWidth = Math.max(0, box.width - contentX);

        editor.setAutoCommitStyle(false);
        editor.setX(box.x + contentX);
        editor.setWidth(editorWidth);
        editor.setAutoCommitStyle(true);
    }

    /**
     * Replaces the cell's renderer with one returned by `factory`, after
     * passing the existing renderer to the factory so it can be adopted as
     * a delegate. The wrapping renderer becomes this cell's new
     * {@link CellRenderer.getValue} / {@link CellRenderer.setValue} target;
     * the Card layout's renderer-visible state is restored automatically.
     *
     * Used by tree-table rows to install a `TreeCellRenderer` that
     * prepends an indent + expand/collapse toggle in front of the typed
     * renderer appropriate for the column's field type.
     *
     * @param factory - Receives the detached old renderer; returns the
     *   new wrapping renderer that must adopt it as a child.
     *
     * @returns This cell, for method chaining.
     */
    wrapRenderer(factory: (delegate: CellRenderer<T>) => CellRenderer<T>): this {
        const oldRenderer = this._renderer;

        this.removeComponent(oldRenderer);

        const newRenderer = factory(oldRenderer);

        this._renderer = newRenderer;
        this.addComponent(newRenderer);
        this.getLayoutManager().setVisibleComponentId(newRenderer.getId());

        return this;
    }

    /**
     * Returns the cell's editor component, or undefined if the cell is display-only.
     *
     * @returns The {@link CellEditor} for this cell, or undefined.
     */
    getEditor() {
        return this._editor;
    }

    /**
     * Swaps which renderer is this cell's active display + commit target.
     *
     * @param renderer - The renderer to make active.
     * @param isNewChild - `true` the first time `renderer` is shown on this
     *   cell: it is parented via `addComponent` and wired for double-click
     *   activation, mirroring the wiring the constructor does for the
     *   initial renderer. `false` for a renderer already parented on an
     *   earlier swap.
     */
    protected setActiveRenderer(renderer: CellRenderer<T>, isNewChild: boolean): void {
        if (isNewChild) {
            this.addComponent(renderer);

            // Internal cell-editor wiring: listens on a privately-owned child;
            // see the cell-editor carve-out in ARCHITECTURE.md.
            Event.addListener(renderer, 'dblclick', this._onRendererDoubleClick);
        }

        const changed = this._renderer !== renderer;

        this._renderer = renderer;
        this.getLayoutManager().setVisibleComponentId(renderer.getId());

        // Re-fit the newly visible renderer to the cell, mirroring startEdit /
        // stopEdit's Card swaps. Body.bindAndPositionRows skips a rebound
        // cell's own doLayout when its column geometry is unchanged (a pure
        // scroll) — safe for a fixed-type column, but a DynamicCell can swap
        // its active renderer on that same rebind. Without this the swapped-in
        // variant keeps its stale (zero) size and vanishes: the rotated value
        // column's number/date/boolean rows blank out on scroll. Guarded on an
        // actual variant change so stable-type rebinds keep that skip. (On the
        // cell's very first bind the cell is not yet sized, so this lays out to
        // zero — harmless, as Body's first geometry pass re-runs doLayout.)
        if (changed) {
            this.doLayout();
        }
    }

    /**
     * Hook run immediately before the acquired editor receives the
     * renderer's value in {@link Cell.startEdit}. Default is a no-op.
     *
     * @param _editor - The editor about to be shown, not yet holding a value.
     */
    protected prepareEditor(_editor: CellEditor<T>): void {
        // no-op by default
    }
}