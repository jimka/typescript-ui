// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Fit } from "~/layout/Fit.js";
import { Insets } from "~/primitive/Insets.js";
import { ThemeManager } from "~/core/Theme.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

/**
 * Interns the `relatedTarget` of a blur event into a {@link Handle}, or returns
 * `null` when no node is receiving focus.
 *
 * A native `blur` carries `relatedTarget: Node | null`, but a cell editor that
 * re-fires its inner field's blur as a synthetic `CustomEvent("blur")` (e.g.
 * {@link StringEditor}, {@link NumberEditor}) has no `relatedTarget` at all —
 * the property reads back `undefined`. Feeding that to
 * [`DOM.source.intern`](/api/core/namespaces/DOM/interfaces/Source#intern)
 * throws (`new WeakRef(undefined)` is a `TypeError`), which would abort the
 * blur listener *before* it commits the edit — leaving the cell stuck in edit
 * mode and the pooled editor un-released, so the whole column can no longer be
 * edited. Treating both `null` and `undefined` as "focus left the editor
 * entirely" keeps the commit path alive for the synthetic-blur editors while
 * preserving the real-node answer the {@link CellEditor.retainsFocus} overrides
 * depend on.
 *
 * @param e - The blur event, native or synthetically re-fired.
 * @returns The interned handle of the focus target, or `null`.
 *
 * @category Components
 */
export function blurRelatedTargetHandle(e: FocusEvent): Handle | null {
    return e.relatedTarget ? DOM.source.intern(e.relatedTarget) : null;
}

/**
 * The `detail` payload an editor forwards on its re-fired `"keydown"` custom
 * event. The editor wraps its inner field's native keydown so the parent cell's
 * commit/cancel logic can read `keyCode` (and the modifier flags) without the
 * editor naming the global `KeyboardEvent` constructor.
 *
 * @category Components
 */
export interface ForwardedKeyDetail {
    key:      string;
    code:     string;
    keyCode:  number;
    shiftKey: boolean;
    ctrlKey:  boolean;
    altKey:   boolean;
    metaKey:  boolean;
}

/**
 * Normalizes a cell editor's re-fired `"keydown"` event to a
 * {@link ForwardedKeyDetail}, regardless of whether the editor re-fired its
 * inner field's keydown as a synthetic `CustomEvent` or the native
 * `KeyboardEvent` reached the listener directly.
 *
 * {@link StringEditor}, {@link NumberEditor}, and {@link ComboEditor} wrap a
 * child control and manually re-fire its keydown as a `CustomEvent` carrying
 * this shape in `detail`. {@link DateEditor}, {@link TimeEditor}, and
 * {@link DateTimeEditor} instead extend a shared base class whose own
 * element *is* the `<input>`, so no re-fire happens — the listener receives
 * the real native `KeyboardEvent`, whose own `detail` is the numeric
 * `UIEvent.detail` (`0`), not an object. Reading `detail` as an object only
 * when it actually is one keeps both paths working through the same read.
 *
 * @param e - The forwarded keydown event, in either shape.
 * @returns The key fields in a uniform {@link ForwardedKeyDetail} shape.
 *
 * @category Components
 */
export function forwardedKeyDetail(e: CustomEvent<ForwardedKeyDetail> | KeyboardEvent): ForwardedKeyDetail {
    const detail = (e as CustomEvent<ForwardedKeyDetail>).detail;

    if (detail && typeof detail === "object") {
        return detail;
    }

    const native = e as KeyboardEvent;

    return {
        key: native.key,     code: native.code,     keyCode: native.keyCode,
        shiftKey: native.shiftKey, ctrlKey: native.ctrlKey,
        altKey: native.altKey,    metaKey: native.metaKey,
    };
}

/**
 * Abstract base class for cell editors.
 *
 * Subclasses allow in-place editing of a typed value inside a table cell using a
 * Fit layout with theme-driven padding.
 *
 * @category Components
 */
export abstract class CellEditor<T> extends Component {

    /**
     * Installed by {@link CellEditorPool}: lets an editor that manages its own
     * dismissal (e.g. one that pops a floating picker dropdown) ask the active
     * cell to commit the edit. Null until wired.
     */
    private _onCommitRequested: (() => void) | null = null;

    constructor(tag: string = "div") {
        super({ tag });

        this.setLayoutManager(new Fit());

        // Inlined (rather than a private method) so CellRenderer and CellEditor stay
        // structurally compatible — BooleanCell relies on a CellEditor doubling as the
        // renderer, which fails if both classes declare a private member of the same name.
        const applyPadding = () => {
            const p = ThemeManager.getTheme().table.cell.padding;
            this.setInsets(new Insets(0, p, 0, p));
        };

        applyPadding();

        this.subscribeTheme(applyPadding);
    }

    /**
     * Returns the current editor value.
     *
     * @returns The edited value of type T.
     */
    abstract getValue(): T;

    /**
     * Sets the editor to an initial value before editing begins.
     *
     * @param t - The value to populate the editor with.
     */
    abstract setValue(t: T): void;

    /**
     * Returns whether the edit should stay alive when the editor's `<input>`
     * loses focus to `relatedTarget`. The default is `false` (any blur ends the
     * edit). Editors that own a floating sub-surface (e.g. a picker dropdown
     * with its own focusable field) override this to keep editing while focus
     * moves into that surface.
     *
     * @remarks Overrides delegate the cross-portal answer ("did focus land
     * inside my dropdown or any descendant layer?") to
     * [`LayerManager.containsAcrossLayers`](/api/core/namespaces/LayerManager/functions/containsAcrossLayers)
     * rather than walking a private layer stack themselves.
     *
     * @param _relatedTarget - The node handle receiving focus, or null.
     * @returns True to suppress the blur-driven commit/close.
     */
    retainsFocus(_relatedTarget: Handle | null): boolean {
        return false;
    }

    /**
     * Installs the handler the editor calls to ask the active cell to commit.
     * Wired once by {@link CellEditorPool}.
     *
     * @param handler - Callback that commits the active cell's edit.
     */
    setCommitRequestHandler(handler: () => void): void {
        this._onCommitRequested = handler;
    }

    /**
     * Asks the active cell to commit the edit. Used by editors that detect the
     * end of an edit themselves (e.g. an outside click while focus sits in a
     * popped picker rather than the editor's own input).
     */
    protected requestCommit(): void {
        this._onCommitRequested?.();
    }

    /**
     * Mirrors {@link CellRenderer.getContentX} so a `CellEditor` and a
     * `CellRenderer` stay structurally compatible — {@link BooleanCell}
     * uses a [`BooleanEditor`](/api/component/table/classes/BooleanEditor)
     * as both renderer and editor, and TS would reject that pass if
     * either base class declared a member the other didn't. Default
     * returns `0`; editors do not currently report indent offsets of
     * their own.
     *
     * @returns Always `0`.
     */
    getContentX(): number {
        return 0;
    }

    /**
     * Mirrors {@link CellRenderer.getDisplayText} so a `CellEditor` and a
     * `CellRenderer` stay structurally compatible — {@link BooleanCell}
     * uses a [`BooleanEditor`](/api/component/table/classes/BooleanEditor)
     * as both renderer and editor, and TS would reject that pass if
     * either base class declared a member the other didn't. Default
     * returns `""`; editors do not currently report display text of
     * their own.
     *
     * @returns Always `""`.
     */
    getDisplayText(): string {
        return "";
    }
}