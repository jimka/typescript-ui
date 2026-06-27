// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Panel } from "~/core/Panel.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Event } from "~/core/Event.js";
import { Type } from "~/core/Type.js";
import { Insets } from "~/primitive/Insets.js";
import { Fit } from "~/layout/Fit.js";
import { VBox } from "~/layout/VBox.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { ModelRecord } from "~/data/ModelRecord.js";

/**
 * One entry in a [`List`](/api/component/list/classes/List) /
 * [`MultiSelectList`](/api/component/list/classes/MultiSelectList) item
 * array. Plain data — the row pool is the view layer.
 *
 * @category Components
 */
export interface CustomListItem {
    /** Binding identifier — what `getValue` / `setValue` round-trip. */
    key:   string;
    /** Display text rendered in the row. */
    label: string;
}

/**
 * Accepted form for a single item passed to a custom list's `setItems` /
 * `addItem`: either a plain string (auto-keyed by its array position) or a
 * pre-formed {@link CustomListItem} with an explicit caller-supplied key.
 *
 * @category Components
 */
export type CustomListItemSpec = String | CustomListItem;

/**
 * Pixel height of one rendered row. Matches `CustomListRow`'s cached
 * `preferredSize(0, 22)` and the `lineHeight: 22px` declaration in the
 * shared `.CustomListRow` class rule. Keep these three values in lockstep
 * if the row chrome changes — keyboard `PageUp`/`PageDown` derives its
 * page size from this constant divided into the visible viewport height.
 */
const ROW_HEIGHT_PX = 22;

/**
 * Maximum time (in milliseconds) between successive printable-character
 * keypresses before the type-ahead search buffer resets. Picked to match
 * the native `<select>` type-ahead window the custom list replaces — a
 * burst of letters within this window builds a single search prefix; a
 * pause longer than this starts a fresh search.
 */
const TYPE_AHEAD_TIMEOUT_MS = 700;

/**
 * Construction-time options for {@link AbstractCustomList}.
 *
 * @category Components
 */
export interface AbstractCustomListOptions extends AbstractInputOptions {
    items?:        String | Array<String>;
    store?:        AbstractStore;
    displayField?: string;
    valueField?:   string;
    /**
     * Construction-time listener bag — the declarative form of `on()`. Adds the
     * list's `action` shorthand to the inherited `change` / `binding`.
     */
    listeners?: {
        action?:  () => void;
        change?:  (value: any) => void;
        binding?: () => void;
    };
}

/**
 * Shared visual defaults for every {@link AbstractCustomList} subclass.
 * Layered into the defaults bag passed to `super` from the abstract
 * constructor so {@link List} and {@link MultiSelectList} share row
 * chrome without duplicating the bag at every leaf.
 */
const _defaultAbstractCustomListOptions: Partial<AbstractCustomListOptions> = {
    tag:             "div",
    backgroundColor: "var(--ts-ui-list-bg, rgb(255, 255, 255))",
    foregroundColor: "var(--ts-ui-text-color, black)",
    border:          "1px solid var(--ts-ui-list-border, rgb(200, 200, 200))",
    borderRadius:    "var(--ts-ui-border-radius, 4px)",
    preferredSize:   { width: 200, height: 200 },
    maxSize:         { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
};

/**
 * Static styling registered once at module init. The container surface
 * carries the focus ring (matched against the framework auto-added
 * `.List` / `.MultiSelectList` classes that `Component.init()` derives
 * from `constructor.name`); `.CustomListRow` carries the row chrome
 * (single-line text with ellipsis truncation, optional theme-controlled
 * separator); the `.selected` / `.focused` modifier classes layer the
 * selection wash and keyboard-focus outline on top.
 *
 * The `:focus` ring is attached via a compound selector covering both
 * concrete subclass names rather than the abstract base — TypeScript
 * `class.constructor.name` is the leaf class, so the framework adds
 * `"List"` / `"MultiSelectList"` (not `"AbstractCustomList"`) to the
 * surface's classList. Keep this list in sync if a new concrete
 * subclass extends `AbstractCustomList`.
 */
(() => {
    new StyleRule({
        scope:  "selector",
        name:   ".List, .MultiSelectList",
        styles: {
            userSelect: "none",
            outline:    "none",
        },
    });

    // Pseudo-element overlay rather than a plain `outline:` rule so an
    // ancestor with `overflow: hidden` (the framework's Component default)
    // can't clip the focus indicator. `z-index: 1` lifts the ring above the
    // absolutely-positioned rows.
    new StyleRule({
        scope:  "selector",
        name:   ".List:focus::after, .MultiSelectList:focus::after",
        styles: {
            content:       "''",
            position:      "absolute",
            inset:         "0",
            border:        "2px solid var(--ts-ui-indicator-focus, rgb(30, 100, 200))",
            borderRadius:  "inherit",
            boxSizing:     "border-box",
            pointerEvents: "none",
            zIndex:        "1",
        },
    });

    // `lineHeight: 22px` centers the single line of label text vertically
    // without `display: flex` — matches `ROW_HEIGHT_PX` and the row's
    // cached `preferredSize(0, 22)`. The whiteSpace/overflow/textOverflow
    // trio truncates long labels with an ellipsis when the row is narrower
    // than the label text.
    new StyleRule({
        scope:  "class",
        name:   "CustomListRow",
        styles: {
            lineHeight:   "22px",
            whiteSpace:   "nowrap",
            overflow:     "hidden",
            textOverflow: "ellipsis",
            borderBottom: "1px solid var(--ts-ui-list-row-separator, transparent)",
            cursor:       "pointer",
        },
    });

    new StyleRule({
        scope:  "selector",
        name:   ".CustomListRow:hover",
        styles: {
            backgroundColor: "var(--ts-ui-list-row-hover-bg, rgba(30, 100, 200, 0.08))",
        },
    });

    new StyleRule({
        scope:  "selector",
        name:   ".CustomListRow.selected",
        styles: {
            backgroundColor: "var(--ts-ui-list-row-selected-bg, rgba(30, 100, 200, 0.18))",
            color:           "var(--ts-ui-list-row-selected-color, inherit)",
        },
    });

    // The keyboard-focused row is part of the *selection* indicator family
    // (a light per-row mark, distinct from the heavier focus border around
    // the focusable list root itself). Uses the dashed `indicator.selection`
    // shorthand so future themes can re-skin every "selection mark" in one
    // place. Rows have no positioned descendants, so the outline draws on
    // top of the row's text without any covering issue.
    new StyleRule({
        scope:  "selector",
        name:   ".CustomListRow.focused",
        styles: {
            outline: "var(--ts-ui-indicator-selection, 1px dashed rgb(120, 170, 240))",
        },
    });
})();

/**
 * A single row inside an {@link AbstractCustomList}. Holds the static
 * row styling via the `.CustomListRow` / `.CustomListRow:hover` /
 * `.CustomListRow.selected` / `.CustomListRow.focused` class rules and
 * exposes typed setters for the label, the pool index, the selected
 * flag, and the focused flag.
 *
 * Internal — not re-exported from the per-subpath barrel; the public
 * surface lives on `List` / `MultiSelectList`.
 */
class CustomListRow extends Component {
    // Cached so setter calls made before the element renders survive to
    // be applied at render time.
    private _text:     string  = "";
    private _selected: boolean = false;
    private _focused:  boolean = false;
    /** Zero-based index in the row pool; forwarded to `_onClick` on click. */
    private _index:    number;
    /** Owner-supplied click handler invoked with this row's `_index`. */
    private readonly _onClick: (index: number, event: MouseEvent) => void;

    /**
     * @param onClick - Called with the row's index and the raw mouse event
     *   when the row is clicked.
     * @param index - Initial pool index.
     */
    constructor(onClick: (index: number, event: MouseEvent) => void, index: number) {
        super({ tag: "div" });

        this._onClick = onClick;
        this._index   = index;

        this.getAria().setRole("option");
        this.setPreferredSize(0, ROW_HEIGHT_PX);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, ROW_HEIGHT_PX);
        this.setPadding(new Insets(0, 8, 0, 8));
        // Component's framework default writes `cursor: default` as an
        // inline style, which would beat the `.CustomListRow` class rule
        // — set the inline cursor explicitly so rows show the hand
        // cursor on hover.
        this.setCursor("pointer");

        Event.addListener(this, "pointerdown", this.onPointerDown);
        Event.addListener(this, "click",       this.onClick);
    }

    /**
     * Updates the rendered row label.
     *
     * @param text - The text to display.
     *
     * @returns This row, for method chaining.
     */
    setLabel(text: string): this {
        this._text = text;

        const el = this.getElement();
        if (el) {
            DOM.sink.apply(el, { text });
        }

        return this;
    }

    /**
     * Returns the cached row label.
     *
     * @returns The label string.
     */
    getLabel(): string {
        return this._text;
    }

    /**
     * Updates the index this row reports through its click callback. Used
     * when the row pool is reconciled against a new item list and an
     * existing row is reused at a new position.
     *
     * @param index - The new zero-based row index.
     *
     * @returns This row, for method chaining.
     */
    setIndex(index: number): this {
        this._index = index;

        return this;
    }

    /**
     * Returns the row's current pool index.
     *
     * @returns The zero-based index.
     */
    getIndex(): number {
        return this._index;
    }

    /**
     * Toggles the `.selected` class and `aria-selected` to reflect
     * membership in the owning list's selection set.
     *
     * @param value - `true` when this row is currently selected.
     *
     * @returns This row, for method chaining.
     */
    setSelected(value: boolean): this {
        this._selected = value;
        this.getAria().setSelected(value);
        this.applyRowClass();

        return this;
    }

    /**
     * Returns the cached selected state.
     *
     * @returns `true` when this row is currently selected.
     */
    isSelected(): boolean {
        return this._selected;
    }

    /**
     * Toggles the `.focused` class to reflect the keyboard-focus position
     * inside the owning list.
     *
     * @param value - `true` when this row currently holds the keyboard
     *   focus position.
     *
     * @returns This row, for method chaining.
     */
    setFocused(value: boolean): this {
        this._focused = value;
        this.applyRowClass();

        return this;
    }

    /**
     * Returns the cached focused state.
     *
     * @returns `true` when this row holds the keyboard-focus position.
     */
    isFocused(): boolean {
        return this._focused;
    }

    /**
     * Renders the row's `<div>` with its label and current class set.
     *
     * @returns The created element handle.
     */
    protected render(): Handle {
        const element = super.render();
        DOM.sink.apply(element, { text: this._text });
        this.applyRowClass();

        return element;
    }

    /**
     * Computes the row's class list from the cached selected/focused
     * state. Writes via `setElementAttribute("class", …)` so the framework
     * defer-write seam owns the DOM write.
     */
    private applyRowClass(): void {
        const classes = ["CustomListRow"];

        if (this._selected) {
            classes.push("selected");
        }

        if (this._focused) {
            classes.push("focused");
        }

        this.setElementAttribute("class", classes.join(" "));
    }

    /**
     * Suppresses focus loss when the row is pointed at. Without this,
     * clicking a row while the list root has focus would blur the list,
     * and the keyboard model would lose its focus position before the
     * click handler runs. The same pattern guards the AutoComplete row
     * pool against blurring the host input on click.
     *
     * @param e - The pointerdown event.
     */
    private onPointerDown(e: PointerEvent): void {
        e.preventDefault();
    }

    /**
     * Forwards the row's index and the raw mouse event to the owner-supplied
     * click callback.
     *
     * @param e - The click event.
     */
    private onClick(e: MouseEvent): void {
        this._onClick(this._index, e);
    }
}

/**
 * Abstract base for the framework's custom selectable list controls.
 *
 * Owns the item array, the store binding, the row pool (one
 * {@link CustomListRow} per visible item), the selection set, the
 * keyboard model (ArrowUp/Down, Home/End, PageUp/Down, Enter/Space,
 * type-ahead), and the ARIA listbox wiring. Concrete subclasses
 * ({@link List}, {@link MultiSelectList}) supply the
 * {@link AbstractCustomList.reduceSelection} reducer that translates a
 * click or keyboard gesture into a new selection set, and the
 * {@link AbstractCustomList.setValue} / `getValue` round-trip used by
 * [`Bindable`](/api/core/interfaces/Bindable).
 *
 * Not wrapped with `callable()` — abstract classes are never instantiated;
 * the wrapping rule applies only to concrete component subclasses.
 *
 * @category Components
 */
abstract class AbstractCustomList<
    TValue,
    TOptions extends AbstractCustomListOptions = AbstractCustomListOptions
>
    extends AbstractInput<TValue, TOptions>
{
    protected _items:        Array<CustomListItem> = [];
    protected _rowPool:      Array<CustomListRow>  = [];
    protected _selectedSet:  Set<number>           = new Set();
    protected _anchorIndex:  number | null         = null;
    protected _focusedIndex: number                = -1;
    /** Lower-cased type-ahead buffer; cleared on Escape or timeout. */
    protected _typeAheadBuf: string                = "";
    /** Timestamp (ms) of the last printable keypress; used to time out the buffer. */
    protected _typeAheadAt:  number                = 0;
    /**
     * When true, {@link handleRowClick} pulls DOM focus to the list root
     * after the gesture commits so subsequent keystrokes route through
     * `handleKeyDown`. Hosts that own their own focus surface and forward
     * keystrokes (e.g. the ComboBox dropdown, which calls
     * {@link handleKey} from the ComboBox's own `keydown`) set this to
     * `false` so the embedded list never steals focus from the wrapping
     * input.
     */
    protected _focusOnRowClick: boolean = true;
    /**
     * When true (default), keyboard navigation
     * (ArrowUp/Down/Home/End/PageUp/Down) commits the focused row as the
     * selection — the "selection follows focus" pattern most listbox
     * controls use. Hosts that want a navigable highlight without
     * committing the row as the selected value (the WAI-ARIA
     * combobox-with-list-autocomplete pattern, exercised by
     * [`AutoCompleteField`](/api/component/input/classes/AutoCompleteField))
     * call `setSelectFollowsFocus(false)` so ArrowUp/Down moves only the
     * focus highlight; Enter / Space / click still commit.
     */
    protected _selectFollowsFocus: boolean = true;
    protected _innerPanel:   Panel;
    private _storeRefresh:   (() => void) | null   = null;

    /**
     * @param options - Caller-supplied options bag.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        // `Fit` makes the inner panel fill the list root; the Component
        // default `Absolute` would size every child to its preferredSize
        // (none here) and collapse the inner panel to 0×0. Layered into
        // the defaults bag so concrete subclass defaults and user options
        // can still override, alongside the shared list chrome.
        super(
            options,
            {
                ..._defaultAbstractCustomListOptions,
                layoutManager: new Fit(),
                ...(subclassDefaults ?? {}),
            } as Partial<TOptions>,
        );

        // Element-level chrome: the list root carries the `listbox` role
        // and is focusable. The framework auto-adds the leaf-class name
        // (`"List"` / `"MultiSelectList"`) to the surface's classList in
        // `Component.init()`; the shared `.List, .MultiSelectList`
        // style rule registered at module init picks both up without an
        // extra opt-in.
        this.getAria().setRole("listbox");
        this.getAria().setTabIndex(0);

        // Inner panel is the scrollable row stack. `autoScroll: "y"` opts
        // it into the framework's native-overflow path; `VBox` lays the
        // rows out vertically full-width with no gap.
        this._innerPanel = new Panel({
            layoutManager: new VBox({ spacing: 0, stretching: true }),
            autoScroll:    "y",
            insets:        new Insets(0, 0, 0, 0),
        });
        this.addComponent(this._innerPanel);

        this.setMinSize(100, 100);

        Event.addListener(this, "keydown", this.handleKeyDown);

        // Late-built state: `store` / `items` / `enabled` / `readOnly`
        // were written pure to `_options` by the super-time cascade.
        // Dispatch them now that `_innerPanel` and `_rowPool` exist.
        if (this._options.store !== undefined && this._options.displayField !== undefined) {
            this.setStore(this._options.store, this._options.displayField, this._options.valueField);
        }

        if (this._options.items !== undefined) {
            this.setItems(this._options.items);
        }

        if (this._options.enabled !== undefined) {
            this.applyEnabled(this._options.enabled);
        }

        if (this._options.readOnly !== undefined) {
            this.applyReadOnly(this._options.readOnly);
        }
    }

    /**
     * Reflects the enabled flag on the ARIA tree, the tabindex, and the
     * cursor. Disabling the list parks the focus index at -1 so a
     * subsequent enable starts fresh, mirroring the native `<select>`
     * the framework replaces. Concrete subclasses can still override
     * for additional behaviour.
     *
     * @param value - The new enabled state.
     */
    protected applyEnabled(value: boolean): void {
        this.getAria().setDisabled(!value);
        this.getAria().setTabIndex(value ? 0 : -1);
        this.setCursor(value ? "default" : "not-allowed");

        if (!value) {
            this._focusedIndex = -1;
            this.refreshRowVisualState();
            this.updateActiveDescendant();
        }
    }

    /**
     * Reflects the read-only flag on the ARIA tree. Read-only lists
     * stay focusable and announce their state; the click / keyboard
     * reducers are gated separately in {@link handleRowClick} /
     * {@link handleKeyDown}.
     *
     * @param value - The new read-only state.
     */
    protected applyReadOnly(value: boolean): void {
        this.getAria().setReadOnly(value);
    }

    /**
     * Applies an {@link AbstractCustomListOptions} bag. Item / store
     * fields are written pure into `_options` here and dispatched from the
     * constructor body — the row pool and inner panel only exist after
     * `super()` returns.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);


        if (options.items        !== undefined) this._options.items        = options.items;
        if (options.store        !== undefined) this._options.store        = options.store;
        if (options.displayField !== undefined) this._options.displayField = options.displayField;
        if (options.valueField   !== undefined) this._options.valueField   = options.valueField;

        return this;
    }

    /**
     * Returns `null` so a multi-line list surface is treated as a
     * replaced/graphical element by horizontal layouts — matches the
     * behaviour the prior native `<select>`-backed `List` preserved.
     *
     * @returns Always `null`.
     */
    getBaseline(): number | null {
        return null;
    }

    /**
     * Returns a shallow copy of the current item array.
     *
     * @returns The items in display order.
     */
    getItems(): Array<CustomListItem> {
        return this._items.slice();
    }

    /**
     * Replaces all items with the given specs. Each entry is either a plain
     * string — auto-keyed by its array position (`{ key: String(i), label }`),
     * matching the historical behaviour — or a pre-formed
     * {@link CustomListItem} whose explicit key is kept verbatim. Selection and
     * focus are reset; the row pool is reconciled against the new length.
     *
     * @param items - A single spec or an array of specs. Each spec is a string
     *   (auto-keyed by position) or a `{ key, label }` object (explicit key).
     *
     * @remarks The caller owns key uniqueness across explicit keys and across
     *   any collision between an explicit key and a string's auto-index:
     *   `getValue` / `setValue` resolve to the first row whose `key` matches, so
     *   a duplicate key is merely addressed by its lowest matching row.
     *
     * @returns This component, for method chaining.
     */
    setItems(items: CustomListItemSpec | Array<CustomListItemSpec>): this {
        if (!Type.isArray(items)) {
            items = [items as CustomListItemSpec];
        }

        const list = items as Array<CustomListItemSpec>;
        const built: Array<CustomListItem> = [];

        for (let i = 0; i < list.length; i++) {
            const entry = list[i];

            built.push(
                typeof entry === "string"
                    ? { key: String(i), label: entry }
                    : { key: (entry as CustomListItem).key, label: (entry as CustomListItem).label },
            );
        }

        return this.setItemsArray(built);
    }

    /**
     * Replaces all items with the given pre-formed `{key, label}` pairs.
     * Mirrors {@link setItems} but skips the auto-keying step so a host
     * that already owns typed items (e.g. the [`ComboBox`](/api/component/input/classes/ComboBox)
     * dropdown pushing a `CustomListItem` array) can hand them over
     * without the keys being clobbered to stringified indices. Selection and focus are reset; the row pool
     * is reconciled against the new length.
     *
     * Protected on the abstract base so each concrete subclass decides
     * whether to widen it into the public surface — {@link List} does;
     * `MultiSelectList` does not (the multi-select consumers haven't
     * needed the typed-array entry point so far).
     *
     * @param items - The pre-formed item pairs, in display order.
     *
     * @returns This component, for method chaining.
     */
    protected setItemsArray(items: Array<CustomListItem>): this {
        this._items = items.slice();

        this._selectedSet.clear();
        this._anchorIndex  = null;
        this._focusedIndex = -1;

        this.pauseLayout();
        this.syncRows();
        this.resumeLayout();
        this.updateActiveDescendant();

        return this;
    }

    /**
     * Appends a new item to the end of the list. A plain string is auto-keyed
     * by the appended position (`{ key: String(this._items.length), label }`),
     * matching the historical behaviour; a pre-formed {@link CustomListItem}
     * keeps its explicit key verbatim.
     *
     * @param item - A string (auto-keyed by final position) or a `{ key, label }`
     *   object (explicit key).
     *
     * @remarks The caller owns key uniqueness — appending a string after
     *   explicit-keyed items index-keys by final position, which can collide
     *   with an earlier explicit key. `getValue` / `setValue` resolve to the
     *   first matching row.
     *
     * @returns This component, for method chaining.
     */
    addItem(item: CustomListItemSpec): this {
        this._items.push(
            typeof item === "string"
                ? { key: String(this._items.length), label: item }
                : { key: (item as CustomListItem).key, label: (item as CustomListItem).label },
        );

        this.pauseLayout();
        this.syncRows();
        this.resumeLayout();

        return this;
    }

    /**
     * Binds this list to a store. Records are pulled via `displayField` /
     * `valueField` whenever the store fires `load` / `add` / `remove` /
     * `datachanged` / `sync`. Re-binding to a new store de-registers the
     * previous handlers first.
     *
     * @param store - The store to bind to.
     * @param displayField - The record field whose value becomes the row label.
     * @param valueField - Optional. The record field used as the row key;
     *   defaults to the record's primary key when omitted.
     *
     * @returns This component, for method chaining.
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
     * Returns the currently bound store, or `null` when none is set.
     *
     * @returns The bound store, or `null`.
     */
    getStore(): AbstractStore | null {
        return this._options.store ?? null;
    }

    /**
     * Returns the store record corresponding to the most recent
     * single-selection anchor — matches the prior `<select>`-backed
     * behaviour where `getSelectedRecord()` returned the active option's
     * record. For {@link MultiSelectList} consumers wanting the full set
     * of selected records, use [`getSelectedRecords`](/api/component/list/classes/MultiSelectList#getselectedrecords).
     *
     * @returns The selected [`ModelRecord`](/api/data/classes/ModelRecord), or `undefined` when no
     *   store is bound or nothing is selected.
     */
    getSelectedRecord(): ModelRecord | undefined {
        const store = this._options.store;

        if (!store) {
            return undefined;
        }

        const idx = this.getSelectedIndex();

        if (idx < 0) {
            return undefined;
        }

        return store.getRecords()[idx];
    }

    /**
     * Returns the index of the most recent single-selection anchor, or
     * `-1` when nothing is selected.
     *
     * @returns The anchor index.
     */
    getSelectedIndex(): number {
        if (this._anchorIndex !== null && this._selectedSet.has(this._anchorIndex)) {
            return this._anchorIndex;
        }

        if (this._selectedSet.size === 0) {
            return -1;
        }

        // Fallback when the anchor is gone (e.g. after a programmatic
        // setValues that bypassed the click reducer): return the lowest
        // selected index so the contract stays single-valued.
        return Math.min(...this._selectedSet);
    }

    /**
     * Sets the single-selection anchor. The selection set becomes
     * exactly `{idx}` (or empty for `idx < 0`); `_focusedIndex` follows.
     * Optionally fires the `change` event so binding listeners run.
     *
     * @param idx - The zero-based index to select, or a negative value
     *   to clear the selection.
     * @param fireEvent - When `true` (default), fires the `change` event
     *   after updating; pass `false` for programmatic writes.
     *
     * @returns This component, for method chaining.
     */
    setSelectedIndex(idx: number, fireEvent: boolean = true): this {
        this._selectedSet.clear();

        if (idx >= 0 && idx < this._items.length) {
            this._selectedSet.add(idx);
            this._anchorIndex  = idx;
            this._focusedIndex = idx;
        } else {
            this._anchorIndex  = null;
            this._focusedIndex = -1;
        }

        this.refreshRowVisualState();
        this.updateActiveDescendant();

        if (fireEvent) {
            this.fireChange();
        }

        return this;
    }

    /**
     * Registers a listener for one of this list's events. `"action"` is a
     * typed semantic shorthand over {@link Event.addListener} for the DOM
     * change event — fired only on user-driven (click / keyboard) selection
     * changes, never on programmatic `setValue` / `setValues`, matching the
     * prior native `<select>`-backed semantics. `"change"` and `"binding"`
     * are the inherited {@link AbstractInput} listener-bag events.
     *
     * @param event - The event name.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This component, for method chaining.
     */
    on(event: "action",  listener: Function): this;
    on(event: "change",  listener: (value: TValue) => void): this;
    on(event: "binding", listener: () => void): this;
    on(event: "action" | "change" | "binding", listener: Function): this {
        if (event === "action") {
            Event.addListener(this, "change", listener);

            return this;
        }

        return super.on(event as "change", listener as (value: TValue) => void);
    }

    /**
     * Removes a previously registered listener. The exact callback
     * reference must match the one passed to {@link on}.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This component, for method chaining.
     */
    off(event: "action" | "change" | "binding", listener: Function): this {
        if (event === "action") {
            Event.removeListener(this, "change", listener);

            return this;
        }

        return super.off(event, listener);
    }

    /**
     * Subclass hook: translate a click or keyboard gesture at `idx` into
     * a new selection set. The modifier-key flags are normalised so the
     * same reducer runs for mouse and keyboard origins.
     *
     * @param idx - The row index targeted by the gesture.
     * @param ev - Normalised modifier flags. `ctrl` covers both Ctrl and
     *   Cmd (macOS).
     */
    protected abstract reduceSelection(idx: number, ev: { ctrl: boolean, shift: boolean }): void;

    /**
     * Subclass hook used by user-driven gestures: encode the current
     * selection set into the subclass's `TValue` shape and fire change /
     * binding listeners. Called from the click and keyboard reducers
     * after {@link reduceSelection} mutates the selection set.
     */
    protected abstract notifyUserChange(): void;

    /**
     * Rebuilds `_items` from the bound store's current records. Preserves
     * the previously-selected key when possible — if the key still maps
     * to an item, the selection survives; otherwise the selection is
     * cleared and the focus collapses to row 0 (matching the native
     * `<select>` refresh behaviour the prior `List` inherited).
     */
    protected refreshFromStore(): void {
        const store        = this._options.store;
        const displayField = this._options.displayField;
        const valueField   = this._options.valueField;

        if (!store || !displayField) {
            return;
        }

        // Remember the active selection key so we can re-locate it in
        // the new item set; survives partial reorderings / additions.
        const previousAnchorKey = this._anchorIndex !== null && this._items[this._anchorIndex]
            ? this._items[this._anchorIndex].key
            : null;

        this._items = [];
        this._selectedSet.clear();
        this._anchorIndex  = null;

        const records = store.getRecords();
        let restoredAnchor = -1;

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const label  = String(record.get(displayField));
            const key    = valueField
                               ? String(record.get(valueField))
                               : String(record.getId());

            this._items.push({ key, label });

            if (previousAnchorKey !== null && key === previousAnchorKey) {
                restoredAnchor = i;
            }
        }

        if (restoredAnchor >= 0) {
            this._selectedSet.add(restoredAnchor);
            this._anchorIndex  = restoredAnchor;
            this._focusedIndex = restoredAnchor;
        } else {
            this._focusedIndex = this._items.length > 0 ? 0 : -1;
        }

        this.pauseLayout();
        this.syncRows();
        this.resumeLayout();
        this.updateActiveDescendant();
    }

    /**
     * Reconciles the row pool with `_items`. Overlapping rows have their
     * label, index, selected, and focused state updated; surplus items
     * spawn new rows; surplus rows are removed.
     */
    protected syncRows(): void {
        const newLen  = this._items.length;
        const oldLen  = this._rowPool.length;
        const overlap = Math.min(newLen, oldLen);

        for (let i = 0; i < overlap; i++) {
            const row = this._rowPool[i];
            row.setLabel(this._items[i].label);
            row.setIndex(i);
            row.setSelected(this._selectedSet.has(i));
            row.setFocused(i === this._focusedIndex);
        }

        if (newLen > oldLen) {
            for (let i = oldLen; i < newLen; i++) {
                const row = new CustomListRow((idx, e) => this.handleRowClick(idx, e), i);
                row.setLabel(this._items[i].label);
                row.setSelected(this._selectedSet.has(i));
                row.setFocused(i === this._focusedIndex);
                this._innerPanel.addComponent(row);
                this._rowPool.push(row);
            }
        } else if (newLen < oldLen) {
            for (let i = newLen; i < oldLen; i++) {
                this._innerPanel.removeComponent(this._rowPool[i]);
            }
            this._rowPool.splice(newLen);
        }
    }

    /**
     * Pushes the cached selection / focus state into every pool row.
     * Called after a selection mutation (click / keyboard reducer or
     * programmatic write) so the visible chrome catches up without a
     * full `syncRows` reconciliation.
     */
    protected refreshRowVisualState(): void {
        for (let i = 0; i < this._rowPool.length; i++) {
            const row = this._rowPool[i];
            row.setSelected(this._selectedSet.has(i));
            row.setFocused(i === this._focusedIndex);
        }
    }

    /**
     * Mirrors `_focusedIndex` onto `aria-activedescendant` so assistive
     * tech tracks the keyboard-focus row. Clears the attribute when no
     * row holds focus. Points at the row's framework-generated id — the
     * Event system already keys listeners off that id, so rewriting the
     * DOM id to a synthetic value (e.g. `ListRow-N`) would break row
     * click / pointerdown delivery.
     */
    protected updateActiveDescendant(): void {
        if (this._focusedIndex < 0 || this._focusedIndex >= this._rowPool.length) {
            this.getAria().setActiveDescendant("");

            return;
        }

        this.getAria().setActiveDescendant(this._rowPool[this._focusedIndex].getId());
    }

    /**
     * Fires the `change` event so `on("change", fn)` subscribers and
     * `notifyChange`-fed bindings run. Subclasses route their own
     * `notifyUserChange` through this after the reducer commits.
     */
    protected fireChange(): void {
        const element = this.getElement();

        if (element) {
            Event.fireEvent(this, "change");
        }

        this.notifyChange(this.getValue());
    }

    /**
     * Handles a click on a pool row: dispatches the gesture through the
     * subclass's {@link reduceSelection}, syncs the visible chrome, and
     * fires user-change notifications. The list root takes focus on
     * click (rows are not focusable) so subsequent keyboard navigation
     * starts from the clicked row.
     *
     * @param idx - The row index that was clicked.
     * @param e - The original mouse event — modifier-key flags drive the
     *   reducer's multi-select branch.
     */
    protected handleRowClick(idx: number, e: MouseEvent): void {
        if (!this.isEnabled() || this.isReadOnly()) {
            return;
        }

        if (idx < 0 || idx >= this._items.length) {
            return;
        }

        this.reduceSelection(idx, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
        this.refreshRowVisualState();
        this.updateActiveDescendant();

        if (this._focusOnRowClick) {
            // Pull DOM focus back to the list root so subsequent keystrokes
            // route through `handleKeyDown` — rows themselves are not
            // focusable, only the listbox surface is. Suppressed when the
            // list is hosted by a focus-managing parent (e.g. the
            // ComboBox dropdown) so a programmatic focus shift can't
            // tear down a wrapping cell editor's input.
            this.focus();
        }

        this.notifyUserChange();
    }

    /**
     * Toggles whether a row-click gesture pulls DOM focus to the list
     * root after the commit. Hosts that own their own focus surface
     * (the ComboBox dropdown is the canonical example) call
     * `setFocusOnRowClick(false)` so the embedded list never steals
     * focus from a wrapping input or cell editor.
     *
     * @param value - `false` to suppress the focus call.
     *
     * @returns This component, for method chaining.
     */
    setFocusOnRowClick(value: boolean): this {
        this._focusOnRowClick = value;

        return this;
    }

    /**
     * Toggles whether keyboard navigation (ArrowUp/Down/Home/End/PageUp/Down)
     * commits the focused row as the selection. When `false`, the focus
     * highlight moves but the selection set is untouched and the `change`
     * event does not fire. Enter / Space / click still commit. The
     * [`AutoCompleteField`](/api/component/input/classes/AutoCompleteField)
     * dropdown sets this to `false` so ArrowUp/Down previews a row
     * without writing it into the host TextField.
     *
     * @param value - `false` to disable the selection-follows-focus
     *   coupling on keyboard navigation.
     *
     * @returns This component, for method chaining.
     */
    setSelectFollowsFocus(value: boolean): this {
        this._selectFollowsFocus = value;

        return this;
    }

    /**
     * Returns the current keyboard-focus index, or `-1` when no row
     * holds focus.
     *
     * @returns The zero-based focus index, or `-1`.
     */
    getFocusedIndex(): number {
        return this._focusedIndex;
    }

    /**
     * Returns the framework-generated DOM element id of the keyboard-focus
     * row, suitable for writing into a host input's `aria-activedescendant`.
     * Returns `null` when no row holds focus or the focused row hasn't
     * been instantiated in the pool yet (rows materialise lazily as the
     * pool reconciles against the item array).
     *
     * @returns The focused row's element id, or `null`.
     */
    getFocusedRowId(): string | null {
        if (this._focusedIndex < 0 || this._focusedIndex >= this._rowPool.length) {
            return null;
        }

        return this._rowPool[this._focusedIndex].getId();
    }

    /**
     * Public entry point used by hosts that keep DOM focus on their own
     * surface while embedding this list (e.g. the [`ComboBox`](/api/component/input/classes/ComboBox)
     * dropdown forwarding keystrokes from the ComboBox surface).
     * Returns `true` when the list consumed the key — the caller
     * should then `e.preventDefault()` and stop further processing.
     * Escape is intentionally NOT consumed here so the host can use
     * it to close the wrapping overlay; the list-focused entry point
     * (the protected `handleKeyDown` registered as the list's own
     * `keydown` listener) still handles Escape inline.
     *
     * @param e - The keyboard event captured by the host.
     *
     * @returns `true` when the list consumed the key.
     */
    handleKey(e: KeyboardEvent): boolean {
        if (!this.isEnabled() || this.isReadOnly()) {
            return false;
        }

        if (this._items.length === 0) {
            return false;
        }

        if (e.key === "Escape") {
            return false;
        }

        const ctrl = e.ctrlKey || e.metaKey;

        if (this.handleNavigationKey(e, ctrl)) {
            return true;
        }

        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this.commitFocusedRow(ctrl, e.shiftKey);

            return true;
        }

        if (!ctrl && !e.altKey && e.key.length === 1) {
            this.handleTypeAhead(e.key);

            return true;
        }

        return false;
    }

    /**
     * Handles keydown on the list root: ArrowUp/Down/Home/End move the
     * focus index, PageUp/Down move by visible-row count, Enter/Space
     * commits the focused row, Ctrl+A in subclasses extends to select
     * all (handled in {@link MultiSelectList}), Escape clears the
     * type-ahead buffer, and printable characters feed the type-ahead
     * search.
     *
     * @param e - The keyboard event.
     */
    protected handleKeyDown(e: KeyboardEvent): void {
        if (!this.isEnabled() || this.isReadOnly()) {
            return;
        }

        if (this._items.length === 0) {
            return;
        }

        const ctrl = e.ctrlKey || e.metaKey;

        if (e.key === "Escape") {
            this._typeAheadBuf = "";

            return;
        }

        if (this.handleNavigationKey(e, ctrl)) {
            return;
        }

        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this.commitFocusedRow(ctrl, e.shiftKey);

            return;
        }

        // Printable single-character key — feed the type-ahead buffer.
        // `key.length === 1` filters out named keys (`"Tab"`, `"Shift"`,
        // `"ArrowDown"`, …) without an explicit allow-list.
        if (!ctrl && !e.altKey && e.key.length === 1) {
            this.handleTypeAhead(e.key);
        }
    }

    /**
     * Subset of `handleKeyDown` that processes the arrow / Home / End /
     * Page-* navigation keys. Returns `true` when a key was handled so
     * the caller can skip the remaining branches.
     *
     * @param e - The keyboard event.
     * @param ctrl - Pre-computed Ctrl-or-Cmd flag.
     *
     * @returns `true` when the key was handled.
     */
    protected handleNavigationKey(e: KeyboardEvent, ctrl: boolean): boolean {
        const navigable = new Set([
            "ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp",
        ]);

        if (!navigable.has(e.key)) {
            return false;
        }

        e.preventDefault();

        const viewportH = this.getHeight() || ROW_HEIGHT_PX;
        const pageSize  = Math.max(1, Math.floor(viewportH / ROW_HEIGHT_PX));
        const curr      = this._focusedIndex < 0 ? 0 : this._focusedIndex;
        let next: number;

        if (e.key === "ArrowDown") {
            next = Math.min(curr + 1, this._items.length - 1);
        } else if (e.key === "ArrowUp") {
            next = Math.max(curr - 1, 0);
        } else if (e.key === "PageDown") {
            next = Math.min(curr + pageSize, this._items.length - 1);
        } else if (e.key === "PageUp") {
            next = Math.max(curr - pageSize, 0);
        } else if (e.key === "Home") {
            next = 0;
        } else {
            next = this._items.length - 1;
        }

        this.moveFocus(next, ctrl, e.shiftKey);

        return true;
    }

    /**
     * Moves the keyboard focus to `idx`. By default the move also runs
     * the subclass's {@link reduceSelection} so single-select lists track
     * the focus highlight; pass `ctrl: true` to move the focus without
     * touching the selection (the standard "browse without committing"
     * gesture). `shift: true` forwards the range-extend hint to the
     * reducer. When the list-wide {@link setSelectFollowsFocus} flag is
     * `false`, the commit branch is suppressed entirely — the focus
     * highlight moves but the selection set is untouched and
     * `notifyUserChange` does not fire.
     *
     * @param idx - The new focus index.
     * @param ctrl - When `true`, skip the selection update.
     * @param shift - When `true`, ask the reducer to extend the
     *   selection from `_anchorIndex` to `idx`.
     */
    protected moveFocus(idx: number, ctrl: boolean, shift: boolean): void {
        this._focusedIndex = idx;

        const commit = !ctrl && this._selectFollowsFocus;

        if (commit) {
            this.reduceSelection(idx, { ctrl: false, shift });
        }

        this.refreshRowVisualState();
        this.updateActiveDescendant();
        this.scrollIndexIntoView(idx);

        if (commit) {
            this.notifyUserChange();
        }
    }

    /**
     * Commits the focused row through {@link reduceSelection}. Mirrors
     * the gesture of clicking that row with the same modifier keys.
     *
     * @param ctrl - Ctrl-or-Cmd modifier flag at the time of the keypress.
     * @param shift - Shift modifier flag at the time of the keypress.
     */
    protected commitFocusedRow(ctrl: boolean, shift: boolean): void {
        if (this._focusedIndex < 0) {
            return;
        }

        this.reduceSelection(this._focusedIndex, { ctrl, shift });
        this.refreshRowVisualState();
        this.updateActiveDescendant();
        this.notifyUserChange();
    }

    /**
     * Appends `ch` to the type-ahead buffer (after timing out the
     * previous buffer when more than {@link TYPE_AHEAD_TIMEOUT_MS}
     * elapsed since the last key) and jumps the focus to the first item
     * whose lower-cased label starts with the buffer.
     *
     * @param ch - The character key pressed.
     */
    protected handleTypeAhead(ch: string): void {
        const now = Date.now();

        if (now - this._typeAheadAt > TYPE_AHEAD_TIMEOUT_MS) {
            this._typeAheadBuf = "";
        }

        this._typeAheadBuf += ch.toLowerCase();
        this._typeAheadAt   = now;

        const buf = this._typeAheadBuf;
        const idx = this._items.findIndex(item => item.label.toLowerCase().startsWith(buf));

        if (idx < 0) {
            return;
        }

        // Type-ahead moves only the focus highlight; selection is
        // unaffected (same behaviour as the native `<select>` it
        // replaces — typing a letter previews the row without
        // committing).
        this._focusedIndex = idx;
        this.refreshRowVisualState();
        this.updateActiveDescendant();
        this.scrollIndexIntoView(idx);
    }

    /**
     * Scrolls the inner panel so the row at `idx` is fully visible, with
     * no movement when it already is. Reads / writes the panel's native
     * `scrollTop` directly — the framework's typed scroll setter only
     * lives on the `VirtualScroller`-backed components (`Table.Body`,
     * `Tree`); the `Panel`-with-`autoScroll: "y"` surface relies on
     * native browser overflow and exposes no setter.
     *
     * @param idx - The row index to scroll into view.
     */
    protected scrollIndexIntoView(idx: number): void {
        if (idx < 0 || idx >= this._items.length) {
            return;
        }

        const panelEl = this._innerPanel.getElement();

        if (!panelEl) {
            return;
        }

        const metrics       = DOM.source.getScrollMetrics(panelEl);
        const top           = idx * ROW_HEIGHT_PX;
        const bottom        = top + ROW_HEIGHT_PX;
        const scrollTop     = metrics.scrollTop;
        const visibleBottom = scrollTop + metrics.clientHeight;

        if (top < scrollTop) {
            DOM.sink.apply(panelEl, { scrollTop: top });
        } else if (bottom > visibleBottom) {
            DOM.sink.apply(panelEl, { scrollTop: bottom - metrics.clientHeight });
        }
    }
}

export { AbstractCustomList, CustomListRow };
