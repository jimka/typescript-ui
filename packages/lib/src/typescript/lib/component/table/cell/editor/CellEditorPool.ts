// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Event } from "~/core/Event.js";
import type { Cell } from "~/component/table/cell/Cell.js";
import { CellEditor, blurRelatedTargetHandle, forwardedKeyDetail } from "~/component/table/cell/editor/CellEditor.js";
import type { ForwardedKeyDetail } from "~/component/table/cell/editor/CellEditor.js";
import { StringEditor } from "~/component/table/cell/editor/String.js";
import { NumberEditor } from "~/component/table/cell/editor/Number.js";
import { DateEditor } from "~/component/table/cell/editor/Date.js";
import { TimeEditor } from "~/component/table/cell/editor/Time.js";
import { DateTimeEditor } from "~/component/table/cell/editor/DateTime.js";

/**
 * Factory callable that constructs a fresh {@link CellEditor} for a given pool key.
 *
 * @category Components
 */
export type CellEditorFactory = () => CellEditor<unknown>;

/**
 * Per-table registry that holds at most one shared editor instance per editor variant.
 *
 * Every cell in [`Body`](/api/component/table/classes/Body) used to allocate its own editor up
 * front, but only one cell can be edited at a time. The pool keeps the renderer-per-row model
 * untouched while collapsing the N editors down to one instance per cell-provided key returned
 * from {@link Cell.getEditorKey}. On {@link CellEditorPool.acquire} the editor is lazily
 * constructed (and its blur/keydown listeners wired once), then re-used across every subsequent
 * edit of the same variant.
 *
 * Built-in keys are seeded by the constructor:
 *
 * - `"string"`, `"number"`, `"date"`
 * - `"time"` / `"time:seconds"`
 * - `"datetime"` / `"datetime:seconds"`
 *
 * Custom cells can opt in by overriding {@link Cell.getEditorKey} and registering a factory via
 * {@link CellEditorPool.register} before the first edit. Cells that return `null` from
 * `getEditorKey` (e.g. `BooleanCell`, `GlyphCell`, `DefaultCell`) keep their legacy behaviour.
 *
 * @category Components
 */
export class CellEditorPool {

    private _editors   : Map<string, CellEditor<unknown>> = new Map();
    private _factories : Map<string, CellEditorFactory>   = new Map();
    private _activeCell: Cell<any> | null             = null;

    /**
     * Constructs a pool pre-seeded with factories for every built-in typed cell.
     */
    constructor() {
        this._factories.set("string",           () => new StringEditor());
        this._factories.set("number",           () => new NumberEditor());
        this._factories.set("date",             () => new DateEditor());
        this._factories.set("time",             () => new TimeEditor(false));
        this._factories.set("time:seconds",     () => new TimeEditor(true));
        this._factories.set("datetime",         () => new DateTimeEditor(false));
        this._factories.set("datetime:seconds", () => new DateTimeEditor(true));
    }

    /**
     * Registers or overrides a factory for the given pool key.
     *
     * @param key - The editor variant key, matching {@link Cell.getEditorKey}.
     * @param factory - A factory that constructs a fresh editor instance.
     * @returns This pool, for method chaining.
     *
     * @remarks If an editor was already cached for the key it is dropped so the new factory runs
     * on the next call to {@link CellEditorPool.acquire}.
     */
    register(key: string, factory: CellEditorFactory): this {
        this._factories.set(key, factory);
        this._editors.delete(key);

        return this;
    }

    /**
     * Returns the shared editor for `key`, lazily constructing it on first call and marking
     * `cell` as the active edit target.
     *
     * @param key - The editor variant key returned by {@link Cell.getEditorKey}.
     * @param cell - The cell that is starting an edit; receives subsequent blur/keydown events.
     * @returns The shared editor instance, or `null` if no factory is registered for `key`.
     */
    acquire(key: string, cell: Cell<any>): CellEditor<unknown> | null {
        const factory = this._factories.get(key);
        if (!factory) {
            return null;
        }

        let editor = this._editors.get(key);
        if (!editor) {
            editor = factory();
            this.wireListeners(editor);
            this._editors.set(key, editor);
        }

        this._activeCell = cell;

        return editor;
    }

    /**
     * Clears the active-cell pointer. Called by {@link Cell} when an edit commits or cancels.
     */
    release(): void {
        this._activeCell = null;
    }

    /**
     * Disposes every editor this pool has lazily constructed, releasing their
     * per-instance stylesheet rules. Called once, from `Body.destructor()`,
     * when the owning table is torn down — a shared editor is acquired into
     * `_editors` only on a real edit gesture (`Cell.startEdit` → `acquire`),
     * held there for the table's whole lifetime, and detached-but-not-disposed
     * on every edit end (`Cell.detachEditor`'s `removeComponent`, which keeps a
     * reusable editor alive across edits) — so nothing else ever reaches it.
     */
    dispose(): void {
        for (const editor of this._editors.values()) {
            editor.dispose();
        }

        this._editors.clear();
    }

    /**
     * Wires `blur` and `keydown` listeners on the shared editor exactly once at construction,
     * dispatching through `activeCell` so the same listener serves every cell that borrows the
     * editor.
     *
     * @param editor - The freshly constructed editor to wire.
     */
    private wireListeners(editor: CellEditor<unknown>): void {
        editor.setCommitRequestHandler(() => this._activeCell?.commitEdit());

        // Internal cell-editor wiring: listens on a privately-owned child;
        // see the cell-editor carve-out in ARCHITECTURE.md.
        Event.addListener(editor, "blur", (e: FocusEvent) => {
            if (editor.retainsFocus(blurRelatedTargetHandle(e))) {
                return;
            }

            this._activeCell?.commitEdit();
        });
        Event.addListener(editor, "keydown", (e: CustomEvent<ForwardedKeyDetail> | KeyboardEvent) => {
            this._activeCell?.onKeyDown(e);

            // Tab must not shift native DOM focus, and PageUp/PageDown must
            // not run their native per-editor default (e.g. a native
            // date/time input's own segment-increment): the active cell's
            // own navigate handler already moves editing to the neighboring
            // cell or page (see Cell.onKeyDown), so this listener — which
            // for a native-input editor (Date/Time/DateTime) sits on the
            // real keydown target — is one of the places that must
            // suppress the browser's default behaviour for these keys.
            const keyCode = forwardedKeyDetail(e).keyCode;

            if (keyCode === 9 || keyCode === 33 || keyCode === 34) {
                return { prevent: true };
            }

            return;
        });
    }
}
