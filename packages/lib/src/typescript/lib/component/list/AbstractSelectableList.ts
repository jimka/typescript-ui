// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Panel } from "~/core/Panel.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { Tooltip } from "~/overlay/Tooltip.js";
import { Type } from "~/core/Type.js";
import { Insets } from "~/primitive/Insets.js";
import { Fit } from "~/layout/Fit.js";
import { _VBox } from "~/layout/VBox.js";
import { Size } from "~/primitive/Size.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { ListItemRenderer } from "~/component/list/ListItemRenderer.js";
import { LabelListItemRenderer } from "~/component/list/renderer/Label.js";
import { COMPONENT_CLASS, type StyleBag } from "~/core/ClassStyleRules.js";
import { Text } from "~/component/input/Text.js";

/**
 * One entry in a [`List`](/api/component/list/classes/List) /
 * [`MultiSelectList`](/api/component/list/classes/MultiSelectList) item
 * array. Plain data — the row pool is the view layer.
 *
 * @category Components
 */
export interface SelectableListItem {
    /** Binding identifier — what `getValue` / `setValue` round-trip. */
    key:   string;
    /** Display text rendered in the row. */
    label: string;
    /**
     * Optional registry glyph name, read by
     * [`GlyphListItemRenderer`](/api/component/list/classes/GlyphListItemRenderer)
     * to paint an icon beside the label. Ignored by the default label
     * renderer. Array-supplied items carry it directly; store-bound items
     * resolve it from the record field named by the list's `glyphField`.
     */
    glyph?: string;
    /**
     * Optional hover-tooltip text for the row, shown after the standard hover
     * delay via [`Tooltip`](/api/overlay/classes/Tooltip). Lets a host surface
     * the full value behind a truncated label without reaching into the row DOM.
     * Array-supplied items carry it directly; store-bound items resolve it from
     * the record field named by the list's `tooltipField`.
     */
    tooltip?: string;
}

/**
 * Accepted form for a single item passed to a custom list's `setItems` /
 * `addItem`: either a plain string (which becomes both the item's key and its
 * label, so a selection is written and read back as the string itself) or a
 * pre-formed {@link SelectableListItem} with an explicit caller-supplied key.
 *
 * @category Components
 */
export type SelectableListItemSpec = String | SelectableListItem;

/**
 * Pixel height of one rendered row. Matches `SelectableListRow`'s cached
 * `preferredSize(0, 22)` and the `lineHeight: 22px` declaration in the
 * shared `.SelectableListRow` class rule. Keep these three values in lockstep
 * if the row chrome changes — keyboard `PageUp`/`PageDown` derives its
 * page size from this constant divided into the visible viewport height.
 */
const ROW_HEIGHT_PX = 22;

/**
 * Horizontal padding on each side of a row, between the row edge and its
 * renderer. Read by {@link SelectableListRow.publishContentWidth} to convert a
 * renderer's content width into the row's own natural width, so keep it in step
 * with the row's `setPadding` call.
 */
const ROW_PADDING_X_PX = 8;

/**
 * Maximum time (in milliseconds) between successive printable-character
 * keypresses before the type-ahead search buffer resets. Picked to match
 * the native `<select>` type-ahead window the custom list replaces — a
 * burst of letters within this window builds a single search prefix; a
 * pause longer than this starts a fresh search.
 */
const TYPE_AHEAD_TIMEOUT_MS = 700;

/**
 * Construction-time options for {@link AbstractSelectableList}.
 *
 * @category Components
 */
export interface AbstractSelectableListOptions extends AbstractInputOptions {
    items?:        String | Array<String>;
    store?:        AbstractStore;
    displayField?: string;
    valueField?:   string;
    /**
     * Record field whose value becomes each store-bound item's `glyph`, read
     * by [`GlyphListItemRenderer`](/api/component/list/classes/GlyphListItemRenderer).
     * Array-supplied items carry their glyph on the item instead.
     */
    glyphField?:   string;
    /**
     * Record field whose value becomes each store-bound item's `tooltip` (the
     * hover text). Array-supplied items carry their tooltip on the item instead.
     */
    tooltipField?: string;
    /**
     * Zero-argument factory producing the renderer for each row. Defaults to a
     * label renderer reproducing the plain-text rows. Supply
     * `() => new GlyphListItemRenderer()` to paint each item's `glyph` beside
     * its label.
     */
    rendererFactory?: () => ListItemRenderer;
    /**
     * Construction-time listener bag — the declarative form of `on()`. Adds the
     * list's `action` shorthand to the inherited `change` / `binding`.
     */
    listeners?: {
        action?:  () => void;
        change?:  (value: any) => void;
        binding?: () => void;
    };
    /**
     * Muted placeholder text shown inside the scroll area when the list is
     * empty. Opt-in: with neither `emptyText` nor `emptyComponent` set, an empty
     * list has no placeholder child.
     */
    emptyText?:      string;
    /**
     * Factory for a custom empty-state placeholder, shown inside the scroll area
     * when the list is empty. Takes precedence over `emptyText`. The returned
     * component should report an unbounded max (the `Component` default) so the
     * empty list still fills its region and drag-resizes.
     */
    emptyComponent?: () => Component;
    /**
     * Construction-time shortcut for
     * [`setHorizontalScrolling`](/api/component/list/classes/List#sethorizontalscrolling).
     * Defaults to `false` — a label wider than the row ellipsises.
     */
    horizontalScrolling?: boolean;
}

/**
 * Shared visual defaults for every {@link AbstractSelectableList} subclass.
 * Layered into the defaults bag passed to `super` from the abstract
 * constructor so {@link List} and {@link MultiSelectList} share row
 * chrome without duplicating the bag at every leaf.
 */
const _defaultAbstractSelectableListOptions: Partial<AbstractSelectableListOptions> = {
    tag:             "div",
    backgroundColor: "var(--ts-ui-list-bg, rgb(255, 255, 255))",
    foregroundColor: "var(--ts-ui-text-color, black)",
    border:          "1px solid var(--ts-ui-list-border, rgb(200, 200, 200))",
    borderRadius:    "var(--ts-ui-border-radius, 4px)",
    preferredSize:   { width: 200, height: 200 },
    // 100×100 keeps a short empty/placeholder list a usable size. A class
    // default, not a constructor `setMinSize`, so the declaration lands once on
    // the shared `.AbstractSelectableList` rule instead of on every list's own
    // `#id` rule; a caller-supplied `minSize` still wins because it lands in the
    // higher-priority instance layer.
    minSize:         { width: 100, height: 100 },
    maxSize:         { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
};

/**
 * Static styling registered once at module init. The container surface
 * carries the focus ring (matched against the framework auto-added
 * `.List` / `.MultiSelectList` classes that `Component.init()` derives
 * from `constructor.name`); `.SelectableListRow` carries the row chrome
 * (single-line text with ellipsis truncation); the row's theme-controlled
 * separator is a real border set through `setBorder` in the row constructor,
 * not a class rule, so the framework's box math can see it. The
 * `.selected` / `.focused` modifier classes layer the
 * selection wash and keyboard-focus outline on top.
 *
 * The `:focus` ring is attached via a compound selector covering both
 * concrete subclass names rather than the abstract base — TypeScript
 * `class.constructor.name` is the leaf class, so the framework adds
 * `"List"` / `"MultiSelectList"` (not `"AbstractSelectableList"`) to the
 * surface's classList. Keep this list in sync if a new concrete
 * subclass extends `AbstractSelectableList`.
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
        name:   "SelectableListRow",
        styles: {
            lineHeight:   "22px",
            whiteSpace:   "nowrap",
            overflow:     "hidden",
            textOverflow: "ellipsis",
            cursor:       "pointer",
        },
    });

    new StyleRule({
        scope:  "selector",
        name:   ".SelectableListRow:hover",
        styles: {
            backgroundColor: "var(--ts-ui-list-row-hover-bg, rgba(30, 100, 200, 0.08))",
        },
    });

    new StyleRule({
        scope:  "selector",
        name:   ".SelectableListRow.selected",
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
        name:   ".SelectableListRow.focused",
        styles: {
            outline: "var(--ts-ui-indicator-selection, 1px dashed rgb(120, 170, 240))",
        },
    });
})();

const _defaultSelectableListRowOptions: Partial<ComponentOptions> = {
    cursor:  "pointer",
    border:  { borderBottom: "1px solid var(--ts-ui-list-row-separator, transparent)" },
    padding: new Insets(0, ROW_PADDING_X_PX, 0, ROW_PADDING_X_PX),
};

/**
 * A single row inside an {@link AbstractSelectableList}. Holds the static
 * row styling via the `.SelectableListRow` / `.SelectableListRow:hover` /
 * `.SelectableListRow.selected` / `.SelectableListRow.focused` class rules —
 * except the bottom separator, which is a real border set in the constructor so
 * it is measurable — and exposes typed setters for the label, the pool index,
 * the selected flag, and the focused flag.
 *
 * Internal — not re-exported from the per-subpath barrel; the public
 * surface lives on `List` / `MultiSelectList`.
 */
class SelectableListRow extends Component {
    // Cached so setter calls made before the element renders survive to
    // be applied at render time.
    private _selected: boolean = false;
    private _focused:  boolean = false;
    /** Zero-based index in the row pool; forwarded to the handlers on a gesture. */
    private _index:    number;
    /** Owner-supplied gesture handlers, each invoked with this row's `_index`. */
    private readonly _handlers: RowHandlers;
    /** Whether a tooltip is currently attached, so `updateItem` can detach it. */
    private _tooltipAttached: boolean = false;
    /**
     * The renderer owning this row's content (label, optional glyph). Built
     * from the owning list's factory, appended straight into the row DOM in
     * {@link init}, and positioned from {@link doLayout}. Rendered
     * `pointer-events: none` so a click on the label falls through to the
     * row element, whose exact-target `click` listener drives selection.
     */
    private _renderer: ListItemRenderer;

    /**
     * @param handlers - Owner-supplied gesture callbacks (click, contextmenu,
     *   dblclick), each invoked with the row's index and the raw mouse event.
     * @param index - Initial pool index.
     * @param rendererFactory - Zero-argument factory producing this row's
     *   content renderer.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; forwarded so a subclass can seed a default without
     *   editing this constant.
     */
    constructor(
        handlers: RowHandlers,
        index: number,
        rendererFactory: () => ListItemRenderer,
        subclassDefaults?: Partial<ComponentOptions>,
    ) {
        super({ tag: "div" }, { ..._defaultSelectableListRowOptions, ...(subclassDefaults ?? {}) });

        this._handlers = handlers;
        this._index    = index;
        this._renderer = rendererFactory();
        this._renderer.setPointerEvents("none");

        this.getAria().setRole("option");
        this.setPreferredSize({ width: 0, height: ROW_HEIGHT_PX });
        // Do NOT cap the row's max height. A finite per-row height max makes the
        // list's VBox sum to a finite content max (VBox.aggregateMaxSize), which
        // shrink-wraps the whole list to its content and breaks stretch/scroll
        // and the accordion's resizable drag. The row is already pinned to
        // ROW_HEIGHT_PX by its preferredSize above; leave its max unbounded (the
        // Component default).
        this.setPadding(new Insets(0, ROW_PADDING_X_PX, 0, ROW_PADDING_X_PX));
        // The border is a registered class default (_defaultSelectableListRowOptions),
        // not a hand-rolled module-level class rule — Component.applyChromeOptions
        // always-dispatches it through the real setBorder() setter once at
        // construction, populating this._border, the exact field getBorderSize()
        // reads. A hand-rolled `.SelectableListRow { border-bottom: ... }` rule
        // would be invisible to the framework's box math, and the renderer would
        // be sized a pixel too tall and clipped.

        Event.addListener(this, "pointerdown", { prevent: true, handler: this.onPointerDown });
        Event.addListener(this, "click",       this.onClick);
        Event.addListener(this, "contextmenu", this.onContextMenu);
        Event.addListener(this, "dblclick",    this.onDblClick);
    }

    /**
     * Rebinds this row's renderer to a new item, replacing the plain-text
     * label write the pool sync used before renderers existed.
     *
     * @param item - The item to display.
     * @param index - The item's zero-based index.
     *
     * @returns This row, for method chaining.
     */
    updateItem(item: SelectableListItem, index: number): this {
        this._renderer.update({ item, index });
        this.applyTooltip(item.tooltip);

        return this;
    }

    /**
     * Attaches (or detaches) the row's hover tooltip to match the item. Called
     * from {@link updateItem} so a pooled row reused for a different item tracks
     * the new item's `tooltip` — attaching when set, detaching when cleared.
     *
     * @param text - The item's tooltip text, or `undefined` for no tooltip.
     */
    private applyTooltip(text: string | undefined): void {
        if (text) {
            // Tooltip.attach replaces any prior attachment, so re-attaching with
            // new text on pool reuse is safe. The renderer is pointer-events:none,
            // so hover events target the row element and the component-level
            // attach matches (no need to reach the label child).
            Tooltip.attach(this, text);
            this._tooltipAttached = true;
        } else if (this._tooltipAttached) {
            Tooltip.detach(this);
            this._tooltipAttached = false;
        }
    }

    /**
     * Returns the row's natural width — its renderer's content width plus the
     * row's own horizontal padding — i.e. the width at which the bound item
     * renders without clipping.
     *
     * Read by {@link ListRowColumn.computeTotalMinSize}, and only while the
     * owning list scrolls horizontally, so a list with the setting off never
     * calls this and never makes its renderers measure.
     *
     * Deliberately *not* published as the row's `minSize`: a minimum is a
     * constraint that propagates outward (`VBox.getMinSize` → the inner
     * `Panel` → the list's `Fit` → `Component.clampWidth`), so a wide row would
     * inflate the whole `List` element inside its host rather than scroll
     * within it. The natural width is an input to the column's own overflow
     * inflation only.
     *
     * @returns The row's natural width in pixels.
     */
    getNaturalWidth(): number {
        return this._renderer.getContentWidth() + ROW_PADDING_X_PX * 2;
    }

    /**
     * Swaps in a new content renderer, removing the old renderer's element
     * and appending the new one. Used when the owning list's renderer factory
     * changes. The new renderer is left blank until the next
     * {@link updateItem}.
     *
     * @param renderer - The replacement renderer.
     *
     * @returns This row, for method chaining.
     */
    setRenderer(renderer: ListItemRenderer): this {
        const el = this.getElement();

        if (el) {
            const oldEl = this._renderer.getElement();
            if (oldEl && DOM.source.getParentNode(oldEl) === el) {
                DOM.sink.removeChild(el, oldEl);
            }
        }

        this._renderer = renderer;
        this._renderer.setPointerEvents("none");

        if (el) {
            DOM.sink.appendChild(el, this._renderer.getElement(true)!);
        }

        return this;
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
     * Renders the row's `<div>` with its current class set. The label content
     * lives in the renderer child, appended by {@link init}.
     *
     * @returns The created element handle.
     */
    protected render(): Handle {
        const element = super.render();
        this.applyRowClass();

        return element;
    }

    /**
     * Appends the renderer's element to the row DOM. The renderer's own
     * children (label, optional glyph) are appended by the renderer's `init`.
     *
     * @param element - Optional element passed by the rendering pipeline;
     *   falls back to getElement().
     *
     * @returns This row, for method chaining.
     */
    protected init(element?: Handle): this {
        super.init(element);

        const el = element || this.getElement();
        if (el) {
            DOM.sink.appendChild(el, this._renderer.getElement(true)!);
        }

        return this;
    }

    /**
     * Positions the renderer to fill the row's content box, then lets it lay
     * out its own children. Only writes setters (no geometry reads), so it is
     * safe under the `commitBounds` auto-commit path that drives it.
     *
     * @returns This row, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const box = this.getContentBounds();
        if (!box) {
            return this;
        }

        this._renderer.setAutoCommitStyle(false);
        this._renderer.setX(box.x);
        this._renderer.setY(box.y);
        this._renderer.setWidth(box.width);
        this._renderer.setHeight(box.height);
        this._renderer.setAutoCommitStyle(true);

        this._renderer.layoutChildren(box.width, box.height);

        return this;
    }

    /**
     * Computes the row's class list from the cached selected/focused
     * state. Writes via `setElementAttribute("class", …)` so the framework
     * defer-write seam owns the DOM write.
     *
     * The write replaces the whole `class` attribute, so it must re-state the
     * framework `COMPONENT_CLASS` that `Component.init` adds — otherwise a
     * post-init rewrite (a selection change) drops it, and with it the
     * `:where(.ts-ui-component)` rule that supplies `position: absolute`,
     * collapsing every row to `top: auto` so they stack on top of each other.
     */
    private applyRowClass(): void {
        const classes = [COMPONENT_CLASS, "SelectableListRow"];

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
    private onPointerDown(_e: PointerEvent): void {
    }

    /**
     * Forwards the row's index and the raw mouse event to the owner-supplied
     * click callback.
     *
     * @param e - The click event.
     */
    private onClick(e: MouseEvent): void {
        this._handlers.onClick(this._index, e);
    }

    /**
     * Forwards the row's index and the raw mouse event to the owner-supplied
     * context-menu callback.
     *
     * @param e - The contextmenu event.
     */
    private onContextMenu(e: MouseEvent): void {
        this._handlers.onContextMenu(this._index, e);
    }

    /**
     * Forwards the row's index and the raw mouse event to the owner-supplied
     * double-click callback.
     *
     * @param e - The dblclick event.
     */
    private onDblClick(e: MouseEvent): void {
        this._handlers.onDblClick(this._index, e);
    }
}

/**
 * The row stack inside a list's scroll panel: a `VBox` that additionally knows
 * how wide its rows want to be.
 *
 * Exists for one reason — the framework's cross-axis overflow inflation reads
 * the children's *minimum* width (`LayoutManager.inflateForOverflow` →
 * {@link computeTotalMinSize}), but a row's natural width must not become a
 * minimum. A minimum propagates outward — `VBox.getMinSize` → the scroll
 * `Panel` → the list's `Fit` → `Component.clampWidth` — and would inflate the
 * `List` element itself inside its host, so a long label would widen the whole
 * rail instead of scrolling inside it.
 *
 * Overriding `computeTotalMinSize` alone separates the two: the inflation
 * target picks up the widest row's natural width, while `getMinSize` (untouched
 * from `VBox`) keeps reporting the rows' real minimum of zero. So the column
 * lays out wide and scrolls, and nothing outside the scroll panel ever learns
 * of the content's width.
 *
 * Inert unless the host has opted into horizontal overflow — `inflateForOverflow`
 * ignores an axis the host does not scroll, so with `horizontalScrolling` off
 * this behaves exactly as a plain `VBox` and never measures a renderer.
 */
class ListRowColumn extends _VBox {

    /**
     * Widens the inflation target to the widest row's natural width, so a list
     * scrolling horizontally lays its rows out at full content width.
     *
     * @returns The children's combined min size, with the width raised to the
     *   widest row's natural width.
     */
    protected computeTotalMinSize(): Size {
        const total     = super.computeTotalMinSize();
        const container = this.getContainer();

        // Only the X-overflow path consumes the width, and the scan below makes
        // every row measure its renderer — so skip it whenever the host isn't
        // scrolling X. Not merely an optimisation: a list has always scrolled Y,
        // so `inflateForOverflow` calls this on every layout of every list, and
        // an ungated scan would put a per-row text measure into all of them.
        if (!container || !this.isOverflowingX()) {
            return total;
        }

        let natural = 0;

        for (const component of container.getLaidOutComponents()) {
            // The empty-state placeholder shares the column with the rows and has
            // no natural width to contribute — it tracks the viewport instead.
            if (component instanceof SelectableListRow) {
                natural = Math.max(natural, component.getNaturalWidth());
            }
        }

        return { width: Math.max(total.width, natural), height: total.height };
    }
}

/**
 * Owner-supplied gesture callbacks for a {@link SelectableListRow}, each invoked
 * with the row's current pool index and the originating mouse event. The row
 * owns no selection or event-dispatch logic itself — it forwards to the list.
 */
interface RowHandlers {
    /** Invoked on a left-click of the row. */
    onClick:       (index: number, event: MouseEvent) => void;
    /** Invoked on a right-click of the row (before the list suppresses the native menu). */
    onContextMenu: (index: number, event: MouseEvent) => void;
    /** Invoked on a double-click of the row. */
    onDblClick:    (index: number, event: MouseEvent) => void;
}

/**
 * Abstract base for the framework's custom selectable list controls.
 *
 * Owns the item array, the store binding, the row pool (one
 * {@link SelectableListRow} per visible item), the selection set, the
 * keyboard model (ArrowUp/Down, Home/End, PageUp/Down, Enter/Space,
 * type-ahead), and the ARIA listbox wiring. Concrete subclasses
 * ({@link List}, {@link MultiSelectList}) supply the
 * {@link AbstractSelectableList.reduceSelection} reducer that translates a
 * click or keyboard gesture into a new selection set, and the
 * {@link AbstractSelectableList.setValue} / `getValue` round-trip used by
 * [`Bindable`](/api/core/interfaces/Bindable).
 *
 * Not wrapped with `callable()` — abstract classes are never instantiated;
 * the wrapping rule applies only to concrete component subclasses.
 *
 * @category Components
 */
abstract class AbstractSelectableList<
    TValue,
    TOptions extends AbstractSelectableListOptions = AbstractSelectableListOptions
>
    extends AbstractInput<TValue, TOptions>
{
    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultAbstractSelectableListOptions;

    protected _items:        Array<SelectableListItem> = [];
    protected _rowPool:      Array<SelectableListRow>  = [];
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
    /**
     * Whether over-long rows scroll horizontally instead of ellipsising.
     * Written only by {@link setHorizontalScrolling}, dispatched from the
     * constructor body once `_innerPanel` exists, so the field-initializer
     * default survives the `super()` cascade without a `declare`.
     */
    private _horizontalScrolling: boolean = false;
    protected _innerPanel:   Panel;
    /** Cached empty-state placeholder, built lazily on first need; null until then. */
    private _emptyPlaceholder: Component | null = null;
    /** Whether `_emptyPlaceholder` is currently a child of `_innerPanel`. */
    private _placeholderAttached: boolean = false;
    private _storeRefresh:   (() => void) | null   = null;
    /**
     * Factory producing each row's content renderer. Defaults to a label
     * renderer reproducing the plain-text rows. Written only by
     * {@link setRendererFactory}, dispatched from the constructor body, so the
     * field-initializer default survives the `super()` cascade without a
     * `declare`.
     */
    private _rendererFactory: () => ListItemRenderer = () => new LabelListItemRenderer();
    /**
     * Listeners for the row-gesture events that carry a row index payload
     * (`contextmenu`, `dblclick`) — kept off the DOM `Event` bus, which fires
     * bare DOM events without the index. `change` / `action` stay on the DOM
     * bus via {@link on}. Mirrors [`Tree`](/api/component/tree/classes/Tree)'s
     * `contextmenu` / `dblclick` wiring.
     */
    private _rowListeners: ListenerBag<"contextmenu" | "dblclick"> = this.registerListenerBag(new ListenerBag());

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
                ..._defaultAbstractSelectableListOptions,
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
            layoutManager: new ListRowColumn({ spacing: 0, stretching: true }),
            autoScroll:    "y",
            insets:        new Insets(0, 0, 0, 0),
        });
        this.addComponent(this._innerPanel);

        Event.addListener(this, "keydown", this.handleKeyDown);

        // Late-built state: `rendererFactory` / `store` / `items` / `enabled` /
        // `readOnly` were written pure to `_options` by the super-time cascade.
        // Dispatch them now that `_innerPanel` and `_rowPool` exist. The
        // factory is dispatched first so the row pool is built (by `setStore` /
        // `setItems` below) with the caller's renderer on first paint.
        if (this._options.rendererFactory !== undefined) {
            this.setRendererFactory(this._options.rendererFactory);
        }

        if (this._options.horizontalScrolling !== undefined) {
            this.setHorizontalScrolling(this._options.horizontalScrolling);
        }

        if (this._options.store !== undefined && this._options.displayField !== undefined) {
            this.setStore(this._options.store, this._options.displayField, this._options.valueField, this._options.glyphField, this._options.tooltipField);
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

        // Dispatch the empty-state options last, after items/store — a list built
        // *with* items must show no placeholder. Needed because an empty list
        // configured with only `emptyText`/`emptyComponent` never calls syncRows
        // during construction.
        if (this._options.emptyText !== undefined || this._options.emptyComponent !== undefined) {
            this.syncEmptyPlaceholder();
        }
    }

    /**
     * Unsubscribes from the currently-bound store (see {@link setStore}),
     * then runs the inherited teardown. The store is owned by the caller,
     * not this list, and can outlive it, so an un-unsubscribed listener
     * would pin this list in the store's own `ListenerBag` for as long as
     * the store itself lives.
     */
    protected destructor(): void {
        this.unbindStore(this._options.store);

        super.destructor();
    }

    /**
     * Unsubscribes the callbacks installed by {@link setStore} from `store`.
     *
     * @param store - The store to unsubscribe from, or `undefined` if none is bound.
     */
    private unbindStore(store: AbstractStore | undefined): void {
        if (!this._storeRefresh || !store) {
            return;
        }

        (['load', 'add', 'remove', 'datachange', 'sync'] as const)
            .forEach(e => store.off(e, this._storeRefresh!));
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
     * Applies an {@link AbstractSelectableListOptions} bag. Item / store
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

        if (options.items           !== undefined) this._options.items           = options.items;
        if (options.store           !== undefined) this._options.store           = options.store;
        if (options.displayField    !== undefined) this._options.displayField    = options.displayField;
        if (options.valueField      !== undefined) this._options.valueField      = options.valueField;
        if (options.glyphField      !== undefined) this._options.glyphField      = options.glyphField;
        if (options.tooltipField    !== undefined) this._options.tooltipField    = options.tooltipField;
        if (options.rendererFactory !== undefined) this._options.rendererFactory = options.rendererFactory;
        if (options.emptyText       !== undefined) this._options.emptyText       = options.emptyText;
        if (options.emptyComponent  !== undefined) this._options.emptyComponent  = options.emptyComponent;

        if (options.horizontalScrolling !== undefined) this._options.horizontalScrolling = options.horizontalScrolling;

        return this;
    }

    /**
     * Sets whether a row wider than the viewport scrolls horizontally instead of
     * ellipsising.
     *
     * Off by default, which is the behaviour every list has always had: rows track
     * the viewport width and a label too long for its row clips with an ellipsis.
     * That is the right default for a narrow rail, and for the dropdown surfaces
     * (`ComboBox`, `AutoCompleteField`) where a horizontal bar under a popup reads
     * as a glitch. Turn it on for a list whose labels carry meaning past the
     * truncation point — a file path, a query — and whose host is too narrow to
     * show them.
     *
     * When on, every row is sized to the widest bound row's natural width (see
     * {@link ListItemRenderer.getContentWidth}) or the viewport, whichever is
     * larger, and the scroll area raises a horizontal scrollbar once the content
     * exceeds it. Rows stay full-width relative to each other, so the selection
     * wash still spans the whole row when scrolled. A custom renderer that does
     * not override `getContentWidth` reports no intrinsic width, so its rows stay
     * at the viewport width and nothing scrolls.
     *
     * @param value - True to scroll over-long rows horizontally.
     *
     * @returns This component, for method chaining.
     */
    setHorizontalScrolling(value: boolean): this {
        if (this._horizontalScrolling === value) {
            return this;
        }

        this._horizontalScrolling = value;

        // `"auto"` adds the X axis to the Y the list has always scrolled. That
        // alone drives everything: it is what lets `ListRowColumn` inflate past
        // the viewport, and what raises the bar once the rows do.
        this._innerPanel.setAutoScroll(value ? "auto" : "y");
        this.scheduleLayout();

        return this;
    }

    /**
     * Returns whether over-long rows scroll horizontally rather than ellipsising.
     *
     * @returns True when horizontal scrolling is on.
     */
    isHorizontalScrolling(): boolean {
        return this._horizontalScrolling;
    }

    /**
     * Sets the muted placeholder text shown inside the scroll area when the list
     * is empty. Pass `null` to clear it. Takes effect immediately: an already
     * empty list shows (or drops) the placeholder on the next layout.
     *
     * @param text - The placeholder text, or `null` to remove it.
     *
     * @returns This component, for method chaining.
     */
    setEmptyText(text: string | null): this {
        this._options.emptyText = text ?? undefined;
        this.resetEmptyPlaceholder();
        this.syncEmptyPlaceholder();

        return this;
    }

    /**
     * Returns the configured empty-state placeholder text.
     *
     * @returns The placeholder text, or `null` if none is set.
     */
    getEmptyText(): string | null {
        return this._options.emptyText ?? null;
    }

    /**
     * Sets a factory for a custom empty-state placeholder, shown inside the
     * scroll area when the list is empty. Takes precedence over
     * {@link setEmptyText}. Pass `null` to clear it. The returned component
     * should report an unbounded max so the empty list still fills its region.
     *
     * @param factory - The placeholder factory, or `null` to remove it.
     *
     * @returns This component, for method chaining.
     */
    setEmptyComponent(factory: (() => Component) | null): this {
        this._options.emptyComponent = factory ?? undefined;
        this.resetEmptyPlaceholder();
        this.syncEmptyPlaceholder();

        return this;
    }

    /**
     * Returns the configured empty-state placeholder factory.
     *
     * @returns The placeholder factory, or `null` if none is set.
     */
    getEmptyComponent(): (() => Component) | null {
        return this._options.emptyComponent ?? null;
    }

    /**
     * Adds or removes the empty-state placeholder against the current item
     * count. Attaches the placeholder (building it lazily on first need) to
     * `_innerPanel` when an empty-state is configured and the list is empty;
     * detaches it otherwise. A no-op when no empty-state is configured — an
     * opted-out empty list keeps no placeholder child.
     *
     * Called at the tail of {@link syncRows}, from the empty-state setters, and
     * once at construction for a list built empty with an empty-state option.
     */
    protected syncEmptyPlaceholder(): void {
        const configured = this._options.emptyComponent !== undefined || this._options.emptyText !== undefined;
        const wants      = configured && this._items.length === 0;

        if (wants) {
            if (!this._emptyPlaceholder) {
                this._emptyPlaceholder = this.buildEmptyPlaceholder();
            }

            if (!this._placeholderAttached) {
                // weight: 1 makes the single child absorb all leftover main-axis
                // (height) space so the placeholder fills the scroll area; the
                // inner VBox's stretching:true fills the width.
                this._innerPanel.addComponent(this._emptyPlaceholder, { weight: 1 });
                this._placeholderAttached = true;
            }
        } else if (this._placeholderAttached && this._emptyPlaceholder) {
            this._innerPanel.removeComponent(this._emptyPlaceholder);
            this._placeholderAttached = false;
        }
    }

    /**
     * Builds the empty-state placeholder: the `emptyComponent` factory's output
     * if set, otherwise a muted, horizontally-centered single-line `Text` from
     * `emptyText` using the list-scoped disabled token.
     *
     * @returns The placeholder component.
     */
    private buildEmptyPlaceholder(): Component {
        const factory = this._options.emptyComponent;
        if (factory) {
            return factory();
        }

        const text = new Text(this._options.emptyText ?? "", { textAlign: "center" });
        text.setForegroundColor("var(--ts-ui-list-row-disabled-color, rgb(170, 170, 170))");

        return text;
    }

    /**
     * Detaches the cached placeholder (if attached) and drops it, so the next
     * {@link syncEmptyPlaceholder} rebuilds it from the current options. Used by
     * the empty-state setters when the configuration changes.
     */
    private resetEmptyPlaceholder(): void {
        if (this._placeholderAttached && this._emptyPlaceholder) {
            this._innerPanel.removeComponent(this._emptyPlaceholder);
            this._placeholderAttached = false;
        }

        this._emptyPlaceholder = null;
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
    getItems(): Array<SelectableListItem> {
        return this._items.slice();
    }

    /**
     * Replaces all items with the given specs. Each entry is either a plain
     * string — keyed by the string itself (`{ key: label }`), so `getValue` /
     * `setValue` round-trip the visible text for the common "list of names"
     * case — or a pre-formed {@link SelectableListItem} whose explicit key is kept
     * verbatim. Selection and focus are reset; the row pool is reconciled
     * against the new length.
     *
     * @param items - A single spec or an array of specs. Each spec is a string
     *   (keyed by its own value) or a `{ key, label }` object (explicit key).
     *
     * @remarks The caller owns key uniqueness — repeated strings, or an explicit
     *   key colliding with a string value, produce duplicate keys, and
     *   `getValue` / `setValue` resolve to the first row whose `key` matches, so
     *   a duplicate key is merely addressed by its lowest matching row.
     *
     * @returns This component, for method chaining.
     */
    setItems(items: SelectableListItemSpec | Array<SelectableListItemSpec>): this {
        if (!Type.isArray(items)) {
            items = [items as SelectableListItemSpec];
        }

        const list = items as Array<SelectableListItemSpec>;
        const built: Array<SelectableListItem> = [];

        for (const entry of list) {
            built.push(
                typeof entry === "string"
                    ? { key: entry, label: entry }
                    : { key: (entry as SelectableListItem).key, label: (entry as SelectableListItem).label, glyph: (entry as SelectableListItem).glyph, tooltip: (entry as SelectableListItem).tooltip },
            );
        }

        return this.setItemsArray(built);
    }

    /**
     * Replaces all items with the given pre-formed `{key, label}` pairs.
     * Mirrors {@link setItems} but skips the key-from-label step so a host
     * that already owns typed items (e.g. the [`ComboBox`](/api/component/input/classes/ComboBox)
     * dropdown pushing a `SelectableListItem` array) can hand them over
     * without the keys being overwritten by their labels. Selection and focus are reset; the row pool
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
    protected setItemsArray(items: Array<SelectableListItem>): this {
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
     * Appends a new item to the end of the list. A plain string is keyed by the
     * string itself (`{ key: label }`), so `getValue` / `setValue` round-trip the
     * visible text; a pre-formed {@link SelectableListItem} keeps its explicit key
     * verbatim.
     *
     * @param item - A string (keyed by its own value) or a `{ key, label }`
     *   object (explicit key).
     *
     * @remarks The caller owns key uniqueness — appending a string equal to an
     *   earlier string or explicit key produces a duplicate key, and `getValue` /
     *   `setValue` resolve to the first matching row.
     *
     * @returns This component, for method chaining.
     */
    addItem(item: SelectableListItemSpec): this {
        this._items.push(
            typeof item === "string"
                ? { key: item, label: item }
                : { key: (item as SelectableListItem).key, label: (item as SelectableListItem).label, glyph: (item as SelectableListItem).glyph, tooltip: (item as SelectableListItem).tooltip },
        );

        this.pauseLayout();
        this.syncRows();
        this.resumeLayout();

        return this;
    }

    /**
     * Binds this list to a store. Records are pulled via `displayField` /
     * `valueField` whenever the store fires `load` / `add` / `remove` /
     * `datachange` / `sync`. Re-binding to a new store de-registers the
     * previous handlers first.
     *
     * @param store - The store to bind to.
     * @param displayField - The record field whose value becomes the row label.
     * @param valueField - Optional. The record field used as the row key;
     *   defaults to the record's primary key when omitted.
     * @param glyphField - Optional. The record field whose value becomes each
     *   item's `glyph` (read by the glyph renderer); omitted leaves items
     *   glyph-less.
     * @param tooltipField - Optional. The record field whose value becomes each
     *   item's hover `tooltip`; omitted leaves items tooltip-less.
     *
     * @returns This component, for method chaining.
     */
    setStore(store: AbstractStore, displayField: string, valueField?: string, glyphField?: string, tooltipField?: string): this {
        this.unbindStore(this._options.store);

        this._options.store        = store;
        this._options.displayField = displayField;
        this._options.valueField   = valueField;
        this._options.glyphField   = glyphField;
        this._options.tooltipField = tooltipField;

        const refresh = (): void => this.refreshFromStore();
        this._storeRefresh = refresh;

        store.on('load',        refresh);
        store.on('add',         refresh);
        store.on('remove',      refresh);
        store.on('datachange', refresh);
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
     * Replaces the renderer factory. Every existing pool row swaps to a fresh
     * renderer from the new factory and the pool is re-synced so each renderer
     * rebinds to its item before the next layout. New rows built afterwards use
     * the new factory too.
     *
     * @param factory - Zero-argument factory producing a renderer per row.
     *
     * @returns This component, for method chaining.
     */
    setRendererFactory(factory: () => ListItemRenderer): this {
        this._rendererFactory = factory;

        for (const row of this._rowPool) {
            row.setRenderer(factory());
        }

        this.pauseLayout();
        this.syncRows();
        this.resumeLayout();

        return this;
    }

    /**
     * Returns the renderer factory currently in use.
     *
     * @returns The zero-argument renderer factory.
     */
    getRendererFactory(): () => ListItemRenderer {
        return this._rendererFactory;
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
     * `"contextmenu"` fires when a row is right-clicked, with the row index and
     * the raw {@link MouseEvent} (the native menu is suppressed); `"dblclick"`
     * fires on a row double-click with the same payload. Both carry the row
     * index directly, so hosts need not walk the row DOM to resolve it.
     *
     * @param event - The event name.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This component, for method chaining.
     */
    on(event: "action",      listener: Event.Listener): this;
    on(event: "change",      listener: (value: TValue) => void): this;
    on(event: "binding",     listener: () => void): this;
    on(event: "contextmenu", listener: (index: number, event: MouseEvent) => void): this;
    on(event: "dblclick",    listener: (index: number, event: MouseEvent) => void): this;
    on(event: "action" | "change" | "binding" | "contextmenu" | "dblclick", listener: Function): this {
        if (event === "action") {
            Event.addListener(this, "change", listener as Event.Listener);

            return this;
        }

        if (event === "contextmenu" || event === "dblclick") {
            this._rowListeners.add(event, listener);

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
    off(event: "action" | "change" | "binding" | "contextmenu" | "dblclick", listener: Function): this {
        if (event === "action") {
            Event.removeListener(this, "change", listener as Event.Listener);

            return this;
        }

        if (event === "contextmenu" || event === "dblclick") {
            this._rowListeners.remove(event, listener);

            return this;
        }

        return super.off(event as "change" | "binding", listener);
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
        const glyphField   = this._options.glyphField;
        const tooltipField = this._options.tooltipField;

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
            const glyph  = glyphField ? String(record.get(glyphField)) : undefined;
            const tooltip = tooltipField ? String(record.get(tooltipField)) : undefined;

            this._items.push({ key, label, glyph, tooltip });

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
            row.updateItem(this._items[i], i);
            row.setIndex(i);
            row.setSelected(this._selectedSet.has(i));
            row.setFocused(i === this._focusedIndex);
        }

        if (newLen > oldLen) {
            for (let i = oldLen; i < newLen; i++) {
                const row = new SelectableListRow(
                    {
                        onClick:       (idx, e) => this.handleRowClick(idx, e),
                        onContextMenu: (idx, e) => this.handleRowContextMenu(idx, e),
                        onDblClick:    (idx, e) => this.handleRowDblClick(idx, e),
                    },
                    i,
                    this._rendererFactory,
                );
                row.updateItem(this._items[i], i);
                row.setSelected(this._selectedSet.has(i));
                row.setFocused(i === this._focusedIndex);
                this._innerPanel.addComponent(row);
                this._rowPool.push(row);
            }
        } else if (newLen < oldLen) {
            for (let i = newLen; i < oldLen; i++) {
                // Drop the row's tooltip attachment (a static id-keyed map) before
                // discarding the row, so a shrinking pool doesn't leak entries.
                Tooltip.detach(this._rowPool[i]);
                this._innerPanel.removeComponent(this._rowPool[i]);
            }
            this._rowPool.splice(newLen);
        }

        // Toggle the empty-state placeholder against the new item count. Runs
        // after the row reconciliation, so on a 0→N transition the rows are in
        // place before the placeholder is dropped (and on N→0, dropped rows are
        // gone before the placeholder attaches). syncRows runs inside a paused
        // layout, so the transient coexistence never renders.
        this.syncEmptyPlaceholder();
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
     * Handles a right-click on a pool row: suppresses the browser's native
     * context menu and fires the `"contextmenu"` event with the row index and
     * the raw event. Deliberately does not change the selection — a host that
     * wants the right-clicked row highlighted calls {@link setSelectedIndex}
     * from its listener (mirrors [`Tree`](/api/component/tree/classes/Tree)'s
     * contextmenu contract). Out-of-range indices are ignored.
     *
     * @param idx - The row index that was right-clicked.
     * @param e - The original contextmenu event.
     */
    protected handleRowContextMenu(idx: number, e: MouseEvent): void {
        if (idx < 0 || idx >= this._items.length) {
            return;
        }

        e.preventDefault();
        this._rowListeners.fire("contextmenu", idx, e);
    }

    /**
     * Handles a double-click on a pool row: fires the `"dblclick"` event with
     * the row index and the raw event. The first click of the pair already ran
     * through {@link handleRowClick} and set the selection, so this only layers
     * an activation signal on top. Out-of-range indices are ignored.
     *
     * @param idx - The row index that was double-clicked.
     * @param e - The original dblclick event.
     */
    protected handleRowDblClick(idx: number, e: MouseEvent): void {
        if (idx < 0 || idx >= this._items.length) {
            return;
        }

        this._rowListeners.fire("dblclick", idx, e);
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
    protected handleKeyDown(e: KeyboardEvent): Event.ListenerResult {
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
            this.commitFocusedRow(ctrl, e.shiftKey);

            return { prevent: true };
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

export { AbstractSelectableList, SelectableListRow };
