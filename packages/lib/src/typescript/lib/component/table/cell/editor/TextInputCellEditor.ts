// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "~/component/table/cell/editor/CellEditor.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { Menu } from "~/overlay/Menu.js";
import { buildClipboardMenuItems } from "~/component/shared/buildClipboardMenuItems.js";

/**
 * Base class for cell editors backed by a native `<input>` element.
 *
 * Owns the typed setters for the three input attributes that every
 * bare-input editor needs to declare its identity — `type`, `inputmode`,
 * and `autocomplete`. Subclasses call these from their constructor instead
 * of routing through `Component.setElementAttribute` directly, which keeps
 * the rule that behaviour-affecting attributes never reach the string-keyed
 * attribute API at the call site.
 *
 * Cannot reuse `Input`'s typed setters because [`CellEditor`](/api/component/table/classes/CellEditor)
 * extends [`Component`](/api/core/classes/Component) (not `Input`):
 * `Input` carries form-submission `name` plumbing and a default font CSS
 * rule that cell editors do not need, and most non-text editors prefer a
 * `<div>` root.
 *
 * @category Components
 */
export abstract class TextInputCellEditor<T> extends CellEditor<T> {

    private _type:         string | null = null;
    private _inputMode:    string | null = null;
    private _autoComplete: string | null = null;

    // Self-wired Cut/Copy/Paste replacement for the browser's own right-click
    // menu, suppressed page-wide by Body.init (native-context-menu-suppression.md).
    // Mirrors TextInput._contextMenu; disposed explicitly in destructor().
    private readonly _contextMenu: Menu = new Menu();

    constructor() {
        super("input");

        Event.addListener(this, "contextmenu", this.handleContextMenu);
    }

    /**
     * Disposes the context menu, then runs the inherited teardown —
     * `_contextMenu` is a LayerManager-mounted panel, never a registered
     * child (see Menu.ts's class comment).
     */
    protected destructor(): void {
        this._contextMenu.dispose();

        super.destructor();
    }

    /**
     * Sets the HTML `type` attribute on the underlying input element. Called
     * once from a subclass constructor to declare the editor's input shape.
     *
     * @param value - The input type (e.g. `"text"`, `"number"`).
     *
     * @returns This component, for method chaining.
     */
    protected setType(value: string): this {
        this._type = value;
        this.setElementAttribute("type", value);

        return this;
    }

    /**
     * Sets the HTML `inputmode` attribute, which controls the on-screen
     * keyboard surface on mobile. Cell editors typically pass `"none"` so
     * the virtual keyboard does not pop while a picker dropdown is open.
     *
     * @param value - A valid `inputmode` value.
     *
     * @returns This component, for method chaining.
     */
    protected setInputMode(value: string): this {
        this._inputMode = value;
        this.setElementAttribute("inputmode", value);

        return this;
    }

    /**
     * Sets the HTML `autocomplete` attribute, which controls browser
     * autofill. Cell editors typically pass `"off"` to keep autofill
     * suggestions from interfering with the picker dropdown.
     *
     * @param value - A valid `autocomplete` token.
     *
     * @returns This component, for method chaining.
     */
    protected setAutoComplete(value: string): this {
        this._autoComplete = value;
        this.setElementAttribute("autocomplete", value);

        return this;
    }

    /**
     * Native `contextmenu` handler: opens the Cut/Copy/Paste menu that
     * replaces the browser's own.
     *
     * @param event - The native contextmenu event; its `clientX`/`clientY` seed the menu's position.
     * @returns Stops propagation and suppresses the browser's own menu.
     */
    private handleContextMenu(event: MouseEvent): Event.ListenerResult {
        const element = this.getElement();

        if (element) {
            const range           = DOM.source.getSelectionRange(element);
            const hasSelectedText = range !== null && range.start !== range.end;

            this._contextMenu.show(event.clientX, event.clientY, buildClipboardMenuItems({
                hasSelectedText,
                cut:   () => this.cut(),
                copy:  () => this.copy(),
                paste: () => void this.paste(),
            }));
        }

        return { stop: true, prevent: true };
    }

    /**
     * Copies the current selection to the system clipboard. No-op without a selection.
     *
     * @returns This component, for method chaining.
     */
    copy(): this {
        const element = this.getElement();
        if (!element) {
            return this;
        }

        const range = DOM.source.getSelectionRange(element);
        if (range === null || range.start === range.end) {
            return this;
        }

        DOM.sink.writeClipboardText(DOM.source.getValue(element).slice(range.start, range.end));

        // The context-menu row that invoked this blurred the editor via the
        // browser's default mousedown-elsewhere behaviour (the same class of
        // problem PickerColumn.handlePointerDown prevents for a picker cell);
        // restore it so the editor doesn't appear to have lost focus once the
        // menu closes. preventScroll — the editor is already on screen, this
        // is where the user just right-clicked.
        this.focus(true);

        return this;
    }

    /**
     * Copies the current selection to the system clipboard, then removes it
     * from the field. No-op without a selection.
     *
     * @returns This component, for method chaining.
     */
    cut(): this {
        const element = this.getElement();
        if (!element) {
            return this;
        }

        const range = DOM.source.getSelectionRange(element);
        if (range === null || range.start === range.end) {
            return this;
        }

        const text = DOM.source.getValue(element);
        DOM.sink.writeClipboardText(text.slice(range.start, range.end));

        DOM.sink.setValue(element, text.slice(0, range.start) + text.slice(range.end));
        DOM.sink.setSelectionRange(element, range.start, range.start);

        // Re-fires "input" so the subclass's own listener (DateEditor / TimeEditor /
        // DateTimeEditor's `Event.addListener(this, "input", () => this.onInput())`)
        // re-syncs its cached value from the DOM — mirrors TextInput.cut().
        Event.fireEvent(this, "input");

        // See copy()'s comment: restores focus after the context-menu row's
        // click blurred the editor.
        this.focus(true);

        return this;
    }

    /**
     * Reads the system clipboard and inserts it at the caret, replacing any selection.
     *
     * @returns Resolves `true` once the paste is applied (even for an empty clipboard), or `false` when the clipboard read failed.
     */
    async paste(): Promise<boolean> {
        const element = this.getElement();
        if (!element) {
            return false;
        }

        const clip = await DOM.source.readClipboardText();
        if (clip === null) {
            // See copy()'s comment: restores focus after the context-menu
            // row's click blurred the editor, even on a denied read — a
            // no-op if the editor was destroyed while the read was in flight.
            this.focus(true);

            return false;
        }

        const el = this.getElement();

        if (clip !== "" && el) {
            const text     = DOM.source.getValue(el);
            const range    = DOM.source.getSelectionRange(el) ?? { start: text.length, end: text.length };
            const combined = text.slice(0, range.start) + clip + text.slice(range.end);

            DOM.sink.setValue(el, combined);

            const caret = Math.min(range.start + clip.length, combined.length);
            DOM.sink.setSelectionRange(el, caret, caret);
            Event.fireEvent(this, "input");
        }

        // See copy()'s comment: restores focus after the context-menu row's
        // click blurred the editor; a no-op if the editor was destroyed
        // while the read was in flight.
        this.focus(true);

        return true;
    }

    protected init(element?: Handle): this {
        super.init(element);

        const el = element || this.getElement()!;

        if (this._type !== null) {
            DOM.sink.apply(el, { setAttr: { "type": this._type } });
        }

        if (this._inputMode !== null) {
            DOM.sink.apply(el, { setAttr: { "inputmode": this._inputMode } });
        }

        if (this._autoComplete !== null) {
            DOM.sink.apply(el, { setAttr: { "autocomplete": this._autoComplete } });
        }

        return this;
    }
}
