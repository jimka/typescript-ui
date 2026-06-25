// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { DOM } from "~/core/DOM.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { Insets } from "~/primitive/Insets.js";
import { Card } from "~/layout/Card.js";
import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { CellEditor } from "~/component/table/cell/editor/CellEditor.js";
import type { ForwardedKeyDetail } from "~/component/table/cell/editor/CellEditor.js";
import { CellEditorPool } from "~/component/table/cell/editor/CellEditorPool.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { ThemeManager } from "~/core/Theme.js";

/**
 * String-literal union of the events emitted by {@link Cell}.
 *
 * @category Components
 */
export type CellEvent = "commit" | "editend";

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

    private _readOnly: boolean;
    private _renderer: CellRenderer<T>;
    private _editor: CellEditor<T> | undefined;
    private _editorPool: CellEditorPool | null = null;
    protected _activeEditor: CellEditor<T> | null = null;
    // Typed as `ListenerBag<string>` rather than `ListenerBag<CellEvent>` so
    // subclasses (e.g. HeaderCell) can re-declare the bag with a wider
    // event union without fighting TypeScript's invariant generic on
    // `ListenerBag.add`. The compile-time gate on event names lives on the
    // host's typed `on` / `off` / `emit` overloads, not on the bag field.
    protected _listeners: ListenerBag<string> = new ListenerBag<string>();

    constructor(tag: string, renderer: CellRenderer<T>, editor?: CellEditor<T>, rendererConstraints?: LayoutConstraints, editorContraints?: LayoutConstraints) {
        super({ tag: tag || "td" });

        this.setLayoutManager(new Card());

        this.getAria().setRole("gridcell");

        this._readOnly = false;
        this._renderer = renderer;
        this._editor = editor;
        this.setInsets(new Insets(0, 0, 0, 0));

        this.setBackgroundColor('var(--ts-ui-table-cell-bg, transparent)');
        this.setForegroundColor('var(--ts-ui-table-cell-color, inherit)');
        this.setBorder('var(--ts-ui-table-cell-border, none)');

        ThemeManager.onThemeChange(() => this.setBorder('var(--ts-ui-table-cell-border, none)'));

        this.addComponent(renderer, rendererConstraints);

        if (editor) {
            this.addComponent(editor, editorContraints);

            editor.setCommitRequestHandler(() => this.commitEdit());

            Event.addListener(editor, 'blur', (e: FocusEvent) => {
                if (editor.retainsFocus(e.relatedTarget === null ? null : DOM.source.intern(e.relatedTarget))) {
                    return;
                }

                this.commitEdit();
            });
            Event.addListener(editor, 'keydown', (e: CustomEvent<ForwardedKeyDetail>) => this.onKeyDown(e));
        }

        Event.addListener(renderer, 'dblclick', () => this.startEdit());
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
     * Body rows call this from their cell-construction loop based on
     * the column's `ColumnConfig.readOnly` flag, and the body's
     * per-rebind read-only resolution forwards the OR of the static
     * column flag, the spec-level row predicate, and the per-cell
     * predicate. Application code should declare read-only through
     * those config-level surfaces rather than calling this setter
     * directly on a cell.
     *
     * Calling `setReadOnly(true)` while the cell is in edit mode
     * silently commits the active edit before flipping the flag, so the
     * borrowed editor releases back to the {@link CellEditorPool}
     * cleanly and the in-progress user input lands on the record. The
     * commit fires the cell's `onCommit` callback (and any cascading
     * store-event refresh) as if the user had blurred the editor.
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

        if (value) {
            this.setBackgroundColor('var(--ts-ui-table-cell-readonly-bg, rgba(0, 0, 0, 0.04))');
            this.setCursor('default');
        } else {
            this.setBackgroundColor('var(--ts-ui-table-cell-bg, transparent)');
            this.clearCursor();
        }

        return this;
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

        editor.setValue(renderer.getValue());

        this.getLayoutManager().setVisibleComponentId(editor.getId());
        this.doLayout();
        // preventScroll: the cell lives in the table body's overflow:hidden,
        // translate-positioned scroll viewport. A native focus-scroll would
        // shift the clipped content without moving the VirtualScroller's cached
        // offset, desyncing the header + scrollbar. The body scrolls the column
        // into view through the scroll model instead.
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
     * (`renderer.getContentX()`). For a plain renderer the offset is
     * `0` and this is a no-op; for a
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
     * offset and shrinks its width accordingly. Idempotent — when no
     * offset is reserved this is a single comparison and an early
     * return.
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

        const cellWidth = this.getWidth() ?? 0;
        const editorWidth = Math.max(0, cellWidth - contentX);

        editor.setAutoCommitStyle(false);
        editor.setX(contentX);
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
}