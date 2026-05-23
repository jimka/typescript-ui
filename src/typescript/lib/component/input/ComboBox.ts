// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { AnimatedDropdown, AnimatedDropdownOptions } from "~/core/AnimatedDropdown.js";
import { CSS } from "~/core/CSS.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Event } from "~/core/Event.js";
import { Util } from "~/core/Util.js";
import { Type } from "~/core/Type.js";
/**
 * One entry in a {@link ComboBox}'s internal item list. Plain data — the
 * dropdown's `ComboBoxRow` instances are the view layer. The `Option`
 * Component (backed by a native `<option>` element) was used here before
 * the move off the native `<select>` dropdown, which created unused DOM
 * nodes and dragged in form-submission semantics that don't apply to a
 * `<div>`-based combobox.
 *
 * @category Components
 */
export interface ComboBoxItem {
    /** Binding identifier — what `getValue` / `setValue` round-trip. */
    key:   string;
    /** Display text shown in the input surface and each dropdown row. */
    label: string;
}
import { AbstractStore } from "~/data/AbstractStore.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { Bindable } from "~/core/Bindable.js";
import { ThemeManager } from "~/core/Theme.js";
import { Position } from "~/primitive/Position.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Insets } from "~/primitive/Insets.js";
import { VBox } from "~/layout/VBox.js";
import { Glyph } from "~/component/display/Glyph.js";
import { chevron_down } from "~/glyphs/solid/chevron_down.js";
import { callable } from "~/core/Callable.js";

Glyph.register(chevron_down);

/**
 * Construction-time options for {@link ComboBox}.
 *
 * @category Components
 */
export interface ComboBoxOptions extends ComponentOptions {
    items?:             String | Array<String>;
    store?:             AbstractStore;
    displayField?:      string;
    valueField?:        string;
    selectedIndex?:     number;
    value?:             string;
    selectedItem?:      string;
    /** When false, the dropdown opens/closes instantly. Default: true. */
    dropdownAnimated?:  boolean;
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins.
 */
const _defaultComboBoxOptions: Partial<ComboBoxOptions> = {
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
    foregroundColor: "var(--ts-ui-text-color, black)",
    border:          { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-autocomplete-border, rgb(200, 200, 200))" },
    borderRadius:    "var(--ts-ui-border-radius, 4px)",
    cursor:          "pointer",
    padding:         new Insets(3, 6, 3, 6),
};

/**
 * Floating dropdown that lists the parent {@link ComboBox}'s options. Inherits
 * fade lifecycle from [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown).
 *
 * @category Components
 */
class ComboBoxDropdown extends AnimatedDropdown<AnimatedDropdownOptions> {

    private readonly _rows: ComboBoxRow[] = [];
    private readonly _onSelect: (index: number) => void;

    /**
     * @param onSelect - Called with the index of the selected row.
     */
    constructor(onSelect: (index: number) => void) {
        super({
            zIndex:          10050,
            position:        Position.FIXED,
            backgroundColor: "var(--ts-ui-autocomplete-bg, rgb(255, 255, 255))",
            border:          { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-autocomplete-border, rgb(200, 200, 200))" },
            borderRadius:    "var(--ts-ui-border-radius, 4px)",
            shadow:          "var(--ts-ui-autocomplete-shadow, 2px 4px 8px rgba(0,0,0,0.15))",
        });

        this._onSelect = onSelect;

        this.getAria().setRole("listbox");
        this.setContain("layout");

        const vbox = new VBox();
        vbox.setComponentSpacing(0);
        vbox.setStretching(true);
        this.setLayoutManager(vbox);
    }

    /**
     * Replaces the rendered row list with one entry per label and lays out
     * the panel anchored below `anchorEl`.
     *
     * @param anchorEl - Element the dropdown is anchored to.
     * @param labels - Display labels, in order.
     */
    showAt(anchorEl: HTMLElement, labels: string[]): this {
        this.pauseLayout();
        this.syncRows(labels);
        this.resumeLayout();

        const rowHeight = 22;
        const insets    = 8;
        const panelH    = labels.length * rowHeight + insets;
        const rect      = anchorEl.getBoundingClientRect();

        this.setWidth(rect.width);
        this.setHeight(panelH);

        const vpHeight = window.innerHeight;
        let y = rect.bottom;

        if (y + panelH > vpHeight && rect.top - panelH > 0) {
            y = rect.top - panelH;
        }

        this.setX(rect.left);
        this.setY(y);

        this.showAnimated();

        // VBox positions rows via framework setters that no-op while the
        // panel's element is detached. Run the layout pass after showAnimated
        // mounts the panel so rows land at the correct y offsets on first
        // open.
        this.doLayout();

        return this;
    }

    /**
     * Reconciles the rendered row pool with `labels`. New rows are added,
     * surplus rows removed, overlapping rows have their text updated.
     *
     * @param labels - The display labels to render.
     */
    private syncRows(labels: string[]): void {
        const newLen = labels.length;
        const oldLen = this._rows.length;
        const overlap = Math.min(newLen, oldLen);

        for (let i = 0; i < overlap; i++) {
            this._rows[i].setLabel(labels[i]);
        }

        if (newLen > oldLen) {
            for (let i = oldLen; i < newLen; i++) {
                const row = this.buildRow(labels[i], i);
                this.addComponent(row);
                this._rows.push(row);
            }
        } else if (newLen < oldLen) {
            for (let i = newLen; i < oldLen; i++) {
                this.removeComponent(this._rows[i]);
            }
            this._rows.splice(newLen);
        }
    }

    /**
     * Builds a single dropdown row. The row owns its own listeners (see
     * {@link ComboBoxRow}) — they suppress focus loss on `pointerdown` and
     * forward `click` to the dropdown's select callback with this row's
     * index.
     *
     * @param label - Display text.
     * @param index - Zero-based row index passed to the select callback.
     * @returns The constructed row component.
     */
    private buildRow(label: string, index: number): ComboBoxRow {
        const row = new ComboBoxRow(this._onSelect, index);
        row.setLabel(label);

        return row;
    }
}

// Static typography for the ComboBox surface and its row pool. Layout
// (label + caret placement, row text centering) is handled by the
// framework's HBox manager and per-component `line-height` so no class
// rule needs to write `display: flex` here. Class rules below match by
// `this.constructor.name`, which Component auto-tags on every element.
(() => {
    const surface = new StyleRule(() =>
        (CSS.getClassRule("ComboBox")
            ?? CSS.createClassRule("ComboBox")) as CSSStyleRule);
    surface.setMany({
        userSelect: "none",
        whiteSpace: "nowrap",
    });
    surface.ensure();

    const label = new StyleRule(() =>
        (CSS.getClassRule("ComboBoxLabel")
            ?? CSS.createClassRule("ComboBoxLabel")) as CSSStyleRule);
    // No `flex` here — `HBox` sizes the label component directly. `overflow`
    // and `text-overflow` keep long labels truncating with an ellipsis when
    // HBox clamps the label width to fit the row.
    label.setMany({
        overflow:     "hidden",
        textOverflow: "ellipsis",
    });
    label.ensure();

    const row = new StyleRule(() =>
        (CSS.getClassRule("ComboBoxRow")
            ?? CSS.createClassRule("ComboBoxRow")) as CSSStyleRule);
    // Row height matches the cached `preferredSize(0, 22)` from the
    // ComboBoxRow constructor; `lineHeight` centers the single line of text
    // vertically without `display: flex`. Keep these two values in sync if
    // the row height changes.
    row.set("lineHeight", "22px");
    row.ensure();

    const rowHover = new StyleRule(() =>
        (CSS.getRule(".ComboBoxRow:hover")
            ?? CSS.createRule(".ComboBoxRow:hover")) as CSSStyleRule);
    rowHover.set("backgroundColor",
        "var(--ts-ui-autocomplete-item-hover-bg, rgba(30, 100, 200, 0.08))");
    rowHover.ensure();
})();

/**
 * The visible label `<span>` inside a {@link ComboBox}. Holds a typed
 * `setLabel` setter so call sites never write `element.textContent` directly.
 * Positioned by the parent `ComboBox`'s `doLayout` (flush left, taking the
 * row's remaining width after the fixed-size caret).
 */
class ComboBoxLabel extends Component {
    // Cached so `setLabel` calls made before the element renders (e.g. from
    // the ComboBox constructor) survive to be applied at render time.
    private _text:       string = "";
    private _lineHeight: string | null = null;

    constructor() {
        super({ tag: "span" });
        this.setPointerEvents("none");
    }

    /**
     * Updates the rendered label text.
     *
     * @param text - The text to display.
     */
    setLabel(text: string): this {
        this._text = text;

        const el = this.getElement();
        if (el) {
            el.textContent = text;
        }

        return this;
    }

    /**
     * Sets the CSS `line-height` so the single line of label text vertically
     * centers within the label's allocated height. Numeric values are stored
     * with a `"px"` suffix; string values pass through unchanged.
     *
     * @param value - A pixel count (number) or a CSS line-height string.
     *
     * @returns This component, for method chaining.
     */
    setLineHeight(value: number | string): this {
        this._lineHeight = typeof value === "number" ? value + "px" : value;

        this.setElementCSSRule("lineHeight", this._lineHeight);

        return this;
    }

    /**
     * Returns the cached CSS `line-height` value, or null when unset.
     *
     * @returns The line-height string (e.g. `"22px"`), or null.
     */
    getLineHeight(): string | null {
        return this._lineHeight;
    }

    protected render(): HTMLElement {
        const element = super.render();
        element.textContent = this._text;

        return element;
    }
}

/**
 * The fixed-size caret container inside a {@link ComboBox}. Uses relative
 * positioning so the framework-absolute chevron glyph it owns stays inside
 * the 16×16 box instead of escaping the right edge.
 */
class ComboBoxCaret extends Component {
    constructor() {
        super({ tag: "span", position: Position.RELATIVE });
        // Lock the size at 16×16 via the typed min/max setters so the box
        // stays square regardless of content (the glyph child is
        // framework-absolute and contributes no intrinsic height).
        this.setMinSize(16, 16);
        this.setMaxSize(16, 16);
        this.setPointerEvents("none");

        const glyph = new Glyph("chevron-down");
        glyph.setPointerEvents("none");
        this.addComponent(glyph);
    }
}

/**
 * A single row inside the dropdown panel. Holds the static row styling via
 * the `.ComboBoxRow` / `.ComboBoxRow:hover` class rules and exposes
 * {@link setLabel} so callers never touch `element.textContent` directly.
 */
class ComboBoxRow extends Component {
    // Cached so `setLabel` calls made before the element renders survive to
    // be applied at render time.
    private _text: string = "";
    /** Owner-supplied click handler invoked with this row's `_index`. */
    private readonly _onSelect: (index: number) => void;
    /** Zero-based index in the row pool; passed to `_onSelect` on click. */
    private _index: number;

    constructor(onSelect: (index: number) => void, index: number) {
        super({ tag: "div" });

        this._onSelect = onSelect;
        this._index    = index;

        this.setPreferredSize(0, 22);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, 22);
        this.setPadding(new Insets(0, 8, 0, 8));
        this.setCursor("pointer");

        Event.addListener(this, "pointerdown", (e: PointerEvent) => this.onPointerDown(e));
        Event.addListener(this, "click",       ()                => this.onClick());
    }

    /**
     * Updates the rendered row label.
     *
     * @param text - The text to display.
     */
    setLabel(text: string): this {
        this._text = text;

        const el = this.getElement();
        if (el) {
            el.textContent = text;
        }

        return this;
    }

    /**
     * Updates the index that this row reports through its select callback.
     * Used when reconciling the pool against a new label list of different
     * length, so an existing row can be reused at a new position.
     *
     * @param index - The new zero-based row index.
     */
    setIndex(index: number): this {
        this._index = index;

        return this;
    }

    protected render(): HTMLElement {
        const element = super.render();
        element.textContent = this._text;

        return element;
    }

    /**
     * Suppresses focus loss when the row is pointed at so any host whose blur
     * commits state (e.g. a pooled cell editor) does not commit before the
     * row's `click` callback runs.
     *
     * @param e - The pointerdown event.
     */
    private onPointerDown(e: PointerEvent): void {
        e.preventDefault();
    }

    /**
     * Forwards the row's index to the owner-supplied select callback.
     */
    private onClick(): void {
        this._onSelect(this._index);
    }
}

/**
 * A drop-down combo box backed by a styled `<div>` surface and an
 * `AnimatedDropdown` panel.
 *
 * Manages an internal list of {@link ComboBoxItem} entries and an active selection.
 * Also accepts an {@link AbstractStore} via {@link setStore} to populate
 * options from the data layer. The dropdown fades in / out using the shared
 * `AnimatedDropdown` lifecycle; pass `dropdownAnimated: false` (or call
 * {@link setDropdownAnimated}) to bypass the fade.
 *
 * @example
 * ```typescript
 * import { ComboBox } from '@jimka/typescript-ui/component/input';
 *
 * const combo = new ComboBox({ items: ['Admin', 'User'] });
 * panel.addComponent(combo);
 * ```
 *
 * @category Components
 */
class ComboBox<TOptions extends ComboBoxOptions = ComboBoxOptions> extends Component<TOptions> implements Bindable<string> {

    private _items:         Array<ComboBoxItem> = [];
    private _selectedIndex: number = -1;
    private _value:         string = "";
    private _dropdown:      ComboBoxDropdown | null = null;
    private _label:         ComboBoxLabel;
    private _caret:         ComboBoxCaret;
    private _storeRefresh:  (() => void) | null = null;
    private readonly _onViewportPointerDown: (e: PointerEvent) => void;

    /**
     * @param options - Optional construction-time options.
     */
    constructor(options?: ComboBoxOptions);
    constructor(options?: TOptions) {
        super({
            ..._defaultComboBoxOptions,
            ...(options ?? {}),
            tag: options?.tag ?? "div",
        } as TOptions);

        this.getAria().setRole("combobox");
        this.getAria().setExpanded(false);
        this.getAria().setTabIndex(0);

        this._label = new ComboBoxLabel();
        this._caret = new ComboBoxCaret();
        this.addComponent(this._label);
        this.addComponent(this._caret);
        this._label.setLabel(this.computeLabel());

        this.updateHeight();
        ThemeManager.onThemeChange(() => this.updateHeight());

        Event.addListener(this, "click",   ()                 => this.toggleDropdown());
        Event.addListener(this, "keydown", (e: KeyboardEvent) => this.onKeyDown(e));

        this._onViewportPointerDown = (e: PointerEvent) => this.onViewportPointerDown(e);

        // Late-built state: store / items / selection were written pure to
        // `_options` by the super-time cascade. Dispatch them now that the
        // internal state is initialised.
        if (this._options.store !== undefined && this._options.displayField !== undefined) {
            this.setStore(this._options.store, this._options.displayField, this._options.valueField);
        }

        if (this._options.items !== undefined) {
            this.setItems(this._options.items);
        }

        if (this._options.selectedIndex !== undefined) {
            this.setSelectedIndex(this._options.selectedIndex, false);
        }

        if (this._options.value !== undefined) {
            this.setValue(this._options.value);
        }

        if (this._options.selectedItem !== undefined) {
            this.setValue(this._options.selectedItem);
        }
    }

    /**
     * Applies a {@link ComboBoxOptions} bag. Inherited Component fields cascade
     * through `super.applyOptions`; item / store / selection fields are written
     * pure into `_options` here and dispatched from the constructor body once
     * internal state is initialised.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        if (options.items            !== undefined) this._options.items            = options.items;
        if (options.store            !== undefined) this._options.store            = options.store;
        if (options.displayField     !== undefined) this._options.displayField     = options.displayField;
        if (options.valueField       !== undefined) this._options.valueField       = options.valueField;
        if (options.selectedIndex    !== undefined) this._options.selectedIndex    = options.selectedIndex;
        if (options.value            !== undefined) this._options.value            = options.value;
        if (options.selectedItem     !== undefined) this._options.selectedItem     = options.selectedItem;
        if (options.dropdownAnimated !== undefined) this._options.dropdownAnimated = options.dropdownAnimated;

        return this;
    }

    /**
     * Recalculates preferred and maximum height from a probe input's measured size.
     *
     * Uses the same measurement helper as `Input`-based fields so a `ComboBox`
     * placed next to a `TextField` matches its row height.
     */
    protected updateHeight(): void {
        const h = Util.measureInputHeight();

        this.setPreferredSize(200, h);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, h);
    }

    /**
     * Places the label flush left and the caret flush right, both vertically
     * centered within the inner height. Replaces the prior `display: flex`
     * arrangement on the surface element so every child position is committed
     * via framework setters.
     */
    doLayout(): this {
        super.doLayout();

        const inner = this.getInnerSize();
        if (!inner) {
            return this;
        }

        // Layout constants. `gap` matches the prior `gap: 6px` on the
        // `.ComboBox` class rule; `caretSize` matches the 16×16 `ComboBoxCaret`
        // min/max box. The label fills the remaining width.
        const gap       = 6;
        const caretSize = 16;
        const insets    = this.getInsets();

        const innerLeft = insets.getLeft();
        const innerTop  = insets.getTop();
        const labelW    = Math.max(0, inner.width - caretSize - gap);
        const caretX    = innerLeft + labelW + gap;
        const caretY    = innerTop + Math.max(0, (inner.height - caretSize) / 2);

        this._label.setX(innerLeft);
        this._label.setY(innerTop);
        this._label.setWidth(labelW);
        this._label.setHeight(inner.height);
        // `lineHeight` equals the label's height so the single line of label
        // text vertically centers without `display: flex` on the parent.
        this._label.setLineHeight(inner.height);

        this._caret.setX(caretX);
        this._caret.setY(caretY);
        this._caret.setWidth(caretSize);
        this._caret.setHeight(caretSize);

        return this;
    }

    /**
     * Returns the offset from the top of the combo box to the inner-text baseline.
     *
     * @returns The baseline offset in pixels.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(Util.measureInputBaseline());
    }

    /**
     * Toggles the dropdown's open state.
     */
    private toggleDropdown(): void {
        const dropdown = this.ensureDropdown();

        if (dropdown.isOpen()) {
            this.closeDropdown();
            return;
        }

        const labels = this._items.map(item => item.label);
        dropdown.showAt(this.getElement(true), labels);
        this.getAria().setExpanded(true);
        Event.addViewportListener(this, "pointerdown", this._onViewportPointerDown);
    }

    /**
     * Closes the dropdown if open.
     */
    private closeDropdown(): void {
        if (this._dropdown && this._dropdown.isOpen()) {
            Event.removeViewportListener(this, "pointerdown", this._onViewportPointerDown);
            this._dropdown.hideAnimated();
            this.getAria().setExpanded(false);
        }
    }

    /**
     * Lazily builds the dropdown instance on first open.
     *
     * @returns The owned dropdown instance.
     */
    private ensureDropdown(): ComboBoxDropdown {
        if (!this._dropdown) {
            this._dropdown = new ComboBoxDropdown(idx => this.onRowSelected(idx));
            const animated = this._options.dropdownAnimated;
            if (animated !== undefined) {
                this._dropdown.setAnimated(animated);
            }
        }

        return this._dropdown;
    }

    /**
     * Viewport-level pointerdown handler: closes the dropdown when the click
     * lands outside both the ComboBox and the dropdown panel.
     *
     * @param e - The pointerdown event from the viewport.
     */
    private onViewportPointerDown(e: PointerEvent): void {
        const target = e.target as Node;
        const dropEl = this._dropdown?.getElement();
        if (dropEl?.contains(target)) {
            return;
        }
        if (this.getElement()?.contains(target)) {
            return;
        }
        this.closeDropdown();
    }

    /**
     * Handles keydown for keyboard-driven open / navigation.
     *
     * @param e - The keyboard event.
     */
    private onKeyDown(e: KeyboardEvent): void {
        switch (e.key) {
            case "ArrowDown":
            case "Enter":
            case " ":
                e.preventDefault();
                if (!this.ensureDropdown().isOpen()) {
                    this.toggleDropdown();
                } else {
                    this.cycleSelection(1);
                }
                break;
            case "ArrowUp":
                e.preventDefault();
                if (!this.ensureDropdown().isOpen()) {
                    this.toggleDropdown();
                } else {
                    this.cycleSelection(-1);
                }
                break;
            case "Escape":
                this.closeDropdown();
                break;
            default:
                break;
        }
    }

    /**
     * Moves the active selection by `delta` rows, wrapping at both ends.
     *
     * @param delta - +1 to advance, -1 to go back.
     */
    private cycleSelection(delta: number): void {
        if (this._items.length === 0) {
            return;
        }

        const len = this._items.length;
        const cur = this._selectedIndex < 0 ? 0 : this._selectedIndex;
        const next = ((cur + delta) % len + len) % len;

        this.setSelectedIndex(next, true);
    }

    /**
     * Internal callback fired when a row inside the dropdown is clicked.
     *
     * @param index - The selected row index.
     */
    private onRowSelected(index: number): void {
        this.setSelectedIndex(index, true);
        this.closeDropdown();
    }

    /**
     * Returns the display label for the active selection.
     *
     * @returns The label to render, or an empty string when nothing is selected.
     */
    private computeLabel(): string {
        if (this._selectedIndex >= 0 && this._selectedIndex < this._items.length) {
            return this._items[this._selectedIndex].label;
        }

        return "";
    }

    /**
     * Refreshes the rendered label after a value or selection change.
     */
    private refreshLabel(): void {
        this._label.setLabel(this.computeLabel());
    }

    /**
     * Registers a listener for the 'change' event, fired on each selection change.
     *
     * @param listener - The callback to invoke when the selection changes.
     */
    addActionListener(listener: Function): this {
        Event.addListener(this, "change", listener);

        return this;
    }

    /**
     * Sets the field value by matching the option's key.
     *
     * @param value - The option key to select. Falls back to no-op when unmatched.
     */
    setValue(value: string): this {
        this._value = value;

        const idx = this._items.findIndex(item => item.key === value);

        if (idx >= 0) {
            this._selectedIndex = idx;
        }

        this.refreshLabel();

        return this;
    }

    /**
     * Returns the current value (the key of the selected option).
     *
     * @returns The selected option's key, or the last value passed to {@link setValue}.
     */
    getValue(): string {
        if (this._selectedIndex >= 0 && this._selectedIndex < this._items.length) {
            return this._items[this._selectedIndex].key;
        }

        return this._value;
    }

    /**
     * Registers a listener that fires on each user-driven change.
     *
     * @param fn - The callback to invoke on change.
     */
    addBindingListener(fn: () => void): void {
        this.addActionListener(fn);
    }

    /**
     * Returns the display text of the currently selected option.
     *
     * @returns The selected option's display text, or an empty string when nothing is selected.
     */
    getSelectedItem(): string {
        if (this._selectedIndex >= 0 && this._selectedIndex < this._items.length) {
            return this._items[this._selectedIndex].label;
        }

        return "";
    }

    /**
     * Returns the zero-based index of the currently selected option.
     *
     * @returns The selected index, or -1 when nothing is selected.
     */
    getSelectedIndex(): number {
        return this._selectedIndex;
    }

    /**
     * Sets the selected index and optionally fires a 'change' event.
     *
     * @param idx - The zero-based index to select.
     * @param fireEvent - Optional. When true (default), fires the 'change' event after updating.
     */
    setSelectedIndex(idx: number, fireEvent: boolean = true): this {
        this._selectedIndex = idx;

        if (idx >= 0 && idx < this._items.length) {
            this._value = this._items[idx].key;
        }

        this.refreshLabel();

        if (fireEvent) {
            Event.fireEvent(this, "change");
        }

        return this;
    }

    /**
     * Returns a copy of the current {@link ComboBoxItem} array.
     *
     * @returns A shallow copy of the internal item array.
     */
    getItems(): Array<ComboBoxItem> {
        return this._items.slice();
    }

    /**
     * Replaces all options with the given string values.
     *
     * @param items - A single string or an array of strings to use as option labels.
     */
    setItems(items: String | Array<String>): this {
        if (!Type.isArray(items)) {
            items = [items as String];
        }

        this._items = [];

        const list = items as Array<String>;
        for (let i = 0; i < list.length; i++) {
            this._items.push({ key: String(i), label: list[i] as string });
        }

        if (this._selectedIndex < 0 && this._items.length > 0) {
            this._selectedIndex = 0;
        } else if (this._selectedIndex >= this._items.length) {
            this._selectedIndex = this._items.length - 1;
        }

        this.refreshLabel();

        return this;
    }

    /**
     * Appends a new option to the end of the list.
     *
     * @param item - The string label for the new option.
     */
    addItem(item: String): this {
        this._items.push({ key: String(this._items.length), label: item as string });

        if (this._selectedIndex < 0) {
            this._selectedIndex = 0;
            this.refreshLabel();
        }

        return this;
    }

    /**
     * Binds this component to a store, populating options from the given display field.
     *
     * @param store - The store to bind to.
     * @param displayField - The record field whose value is shown as the option label.
     * @param valueField - Optional. The record field used as the option value; defaults to the record's primary key.
     */
    setStore(store: AbstractStore, displayField: string, valueField?: string): this {
        const oldStore = this._options.store;

        if (this._storeRefresh && oldStore) {
            (['load', 'add', 'remove', 'datachanged', 'sync'] as const)
                .forEach(e => oldStore.off(e, this._storeRefresh!));
        }

        this._options.store        = store;
        this._options.displayField = displayField;
        this._options.valueField   = valueField;

        const refresh = (): void => this.refreshFromStore();
        this._storeRefresh = refresh;

        store.on('load',        refresh);
        store.on('add',         refresh);
        store.on('remove',      refresh);
        store.on('datachanged', refresh);
        store.on('sync',        refresh);

        this.refreshFromStore();

        return this;
    }

    /**
     * Returns the currently bound store, or null if none is set.
     *
     * @returns The bound store, or null.
     */
    getStore(): AbstractStore | null {
        return this._options.store ?? null;
    }

    /**
     * Returns the store record corresponding to the currently selected option.
     *
     * @returns The selected ModelRecord, or undefined if no store is bound or no item is selected.
     */
    getSelectedRecord(): ModelRecord | undefined {
        const store = this._options.store;

        if (!store) {
            return undefined;
        }

        return store.getRecords()[this._selectedIndex];
    }

    /**
     * Rebuilds the option list from the bound store's current records.
     */
    protected refreshFromStore(): void {
        const store        = this._options.store;
        const displayField = this._options.displayField;
        const valueField   = this._options.valueField;

        if (!store || !displayField) {
            return;
        }

        this._items = [];
        const records = store.getRecords();

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const label  = String(record.get(displayField));
            const key    = valueField
                               ? String(record.get(valueField))
                               : String(record.getId());

            this._items.push({ key, label });
        }

        if (this._value) {
            const idx = this._items.findIndex(item => item.key === this._value);
            if (idx >= 0) {
                this._selectedIndex = idx;
            }
        } else if (this._selectedIndex < 0 && this._items.length > 0) {
            this._selectedIndex = 0;
        }

        this.refreshLabel();
    }

    /**
     * Enables or disables the fade animation on the dropdown.
     *
     * @param value - true to fade, false for instant open/close.
     */
    setDropdownAnimated(value: boolean): this {
        this._options.dropdownAnimated = value;

        if (this._dropdown) {
            this._dropdown.setAnimated(value);
        }

        return this;
    }

    /**
     * Returns whether the dropdown fade is enabled.
     *
     * @returns true when the dropdown fades; false when it opens/closes instantly.
     */
    isDropdownAnimated(): boolean {
        return this._options.dropdownAnimated ?? true;
    }
}

const ComboBoxCallable = callable(ComboBox);
type ComboBoxCallable = ComboBox;
export {
    ComboBox            as _ComboBox,
    ComboBoxDropdown    as _ComboBoxDropdown,
    ComboBoxCallable    as ComboBox
};
