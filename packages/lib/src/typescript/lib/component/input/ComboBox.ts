// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { AnimatedDropdown, AnimatedDropdownOptions } from "~/core/AnimatedDropdown.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Event } from "~/core/Event.js";
import { Util } from "~/core/Util.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { SelectableListItem, SelectableListItemSpec } from "~/component/list/AbstractSelectableList.js";
import { ListItemRenderer } from "~/component/list/ListItemRenderer.js";
import { LabelListItemRenderer } from "~/component/list/renderer/Label.js";
import { List } from "~/component/list/List.js";
import { Insets } from "~/primitive/Insets.js";
import { UNBOUNDED } from "~/primitive/Size.js";
import { Fit } from "~/layout/Fit.js";
import { Glyph, GlyphOptions } from "~/component/display/Glyph.js";
import { chevron_down } from "~/glyphs/solid/chevron_down.js";
import { callable } from "~/core/Callable.js";
import type { StyleBag, StyleTrait } from "~/core/ClassStyleRules.js";
import { GLYPH_MD_INK_TRAIT, INPUT_CHROME_TRAIT } from "~/core/StyleTraits.js";
import { ThemeManager } from "~/core/Theme.js";

Glyph.register(chevron_down);

// Preferred width on the very first call, before any caller constraint has
// been resolved.
const COMBO_BOX_DEFAULT_WIDTH = 200;

/**
 * Construction-time options for {@link ComboBox}.
 *
 * @category Components
 */
export interface ComboBoxOptions extends AbstractInputOptions {
    // Matches `setItems` (SelectableListItemSpec = a plain-string key or a
    // { key, label } item), so an options-bag `items` accepts the same shapes the
    // runtime setter does — a plain-string list or explicit keyed items.
    items?:             SelectableListItemSpec | Array<SelectableListItemSpec>;
    store?:             AbstractStore;
    displayField?:      string;
    valueField?:        string;
    /**
     * Record field whose value becomes each store-bound option's `glyph`, read
     * by [`GlyphListItemRenderer`](/api/component/list/classes/GlyphListItemRenderer).
     * Forwarded to the embedded list's `glyphField`.
     */
    glyphField?:        string;
    /**
     * Zero-argument factory producing the renderer for each dropdown row and
     * the collapsed control. Defaults to a label renderer. Supply
     * `() => new GlyphListItemRenderer()` to show each option's `glyph` in both
     * the open dropdown and on the closed combo box.
     */
    rendererFactory?:   () => ListItemRenderer;
    selectedIndex?:     number;
    value?:             string;
    selectedItem?:      string;
    /** When false, the dropdown opens/closes instantly. Default: true. */
    dropdownAnimated?:  boolean;
    /**
     * Lower bound (in pixels) on the dropdown width. Defaults to `200`. The
     * dropdown sizes to the widest label by default and is floored at the
     * input's width; this floor additionally guarantees the panel is at
     * least this wide even when both the input and the widest label are
     * narrower. Long labels that exceed it still widen the dropdown further
     * (capped at the viewport).
     */
    dropdownMinWidth?:  number;
    /**
     * Construction-time listener bag — the declarative form of `on()`. Adds the
     * combo box's `action` shorthand to the inherited `change` / `binding`.
     */
    listeners?: {
        action?:  () => void;
        change?:  (value: string) => void;
        binding?: () => void;
    };
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins.
 */
const _defaultComboBoxOptions: Partial<ComboBoxOptions> = {
    tag:             "div",
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
    foregroundColor: "var(--ts-ui-text-color, black)",
    cursor:          "pointer",
    insets:          new Insets(3, 6, 3, 6),
};

/**
 * Floating dropdown that lists the parent {@link ComboBox}'s options. Inherits
 * fade lifecycle from [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown).
 *
 * @category Components
 */
/** Maximum dropdown height in pixels. Long option lists scroll inside this cap. */
const COMBOBOX_DROPDOWN_MAX_HEIGHT_PX = 200;

/** Pixel height of a single row inside the dropdown. Matches `SelectableListRow`'s cached `preferredSize(0, 22)`. */
const COMBOBOX_DROPDOWN_ROW_HEIGHT_PX = 22;

/** Combined left + right padding inside a `SelectableListRow` (Insets(0, 8, 0, 8)). */
const COMBOBOX_DROPDOWN_ROW_PADDING_PX = 16;

/**
 * Default lower bound on dropdown width. Ensures the panel is always at least
 * this wide even when both the input and the widest label are narrower;
 * override per-instance via {@link ComboBox.setDropdownMinWidth} or
 * `dropdownMinWidth` in the options bag.
 */
const COMBOBOX_DROPDOWN_MIN_WIDTH_PX = 200;

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * Split out from the constructor's inline literal (which also carries a
 * fresh-per-instance `layoutManager: new Fit()`) so the CSS-relevant subset
 * alone can double as this class's `ownClassStyleDefaults` — sharing a
 * `Fit()` instance across every dropdown would be a real bug, so that field
 * stays inline at the call site.
 */
const _defaultComboBoxDropdownOptions: Partial<AnimatedDropdownOptions> = {
    backgroundColor: "var(--ts-ui-autocomplete-bg, rgb(255, 255, 255))",
    border:          "var(--ts-ui-input-border)",
    borderRadius:    "var(--ts-ui-border-radius, 4px)",
    shadow:          "var(--ts-ui-autocomplete-shadow, 2px 4px 8px rgba(0,0,0,0.15))",
};

class ComboBoxDropdown extends AnimatedDropdown<AnimatedDropdownOptions> {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. `ComboBoxDropdown`
    // deviates from `AnimatedDropdown` on `backgroundColor`/`border`/
    // `borderRadius`/`shadow` (`AnimatedDropdown` itself declares none of
    // these), so it needs its own registration or the hierarchy walk would
    // silently pass through to `AnimatedDropdown`'s shared rule and lose
    // its entire visible chrome.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultComboBoxDropdownOptions;

    /**
     * Inner [`List`](/api/component/list/classes/List) hosting the option rows.
     * The list owns the row pool, the keyboard model (ArrowUp/Down /
     * Home/End / PageUp/Down / Enter / Space / type-ahead), the ARIA
     * `option`-role wiring, and the per-row hover / selected / focused
     * chrome. The dropdown wrapper handles only the overlay lifecycle
     * (fade, anchored positioning, viewport clamp) and the
     * dropdown-specific width math.
     */
    private readonly _list: List;
    /** Lower bound on the dropdown width — see `COMBOBOX_DROPDOWN_MIN_WIDTH_PX`. */
    private _minWidth: number = COMBOBOX_DROPDOWN_MIN_WIDTH_PX;

    /**
     * @param onSelect - Called with the index of the row the user picked.
     *   Fired on click (`SelectableListRow.onClick`) and on Enter / Space
     *   forwarded into the inner list — both paths route through the
     *   list's `change` event.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults. Forwarded even though no subclass exists yet, per
     *   the framework's `subclassDefaults` convention.
     */
    constructor(onSelect: (index: number) => void, subclassDefaults?: Partial<AnimatedDropdownOptions>) {
        super(undefined, {
            layoutManager: new Fit(),
            ..._defaultComboBoxDropdownOptions,
            ...(subclassDefaults ?? {}),
        });

        // The inner List already exposes `role="listbox"` from
        // `AbstractSelectableList`; the dropdown wrapper just provides the
        // overlay chrome and must not duplicate the listbox role
        // (nested listboxes break assistive-tech enumeration of the
        // `option` rows).
        this.setContain("layout");

        // `Fit` makes the inner list fill the dropdown's content box. The
        // list's own border is stripped — the dropdown root carries the
        // visible chrome (border + radius + shadow) so the two never
        // double-stack. Focus-on-row-click is disabled because the host
        // ComboBox keeps DOM focus throughout the dropdown's lifetime;
        // letting the list grab focus on a row click would blur a
        // wrapping cell-editor / picker input and tear down the parent
        // overlay before `onRowSelected` runs `closeDropdown`.
        this._list = new List();
        this._list.setBorder("none");
        this._list.setBorderRadius("0");
        this._list.setFocusOnRowClick(false);
        this.addComponent(this._list);

        // Click and keyboard commits both arrive through the list's
        // `change` event (fired by `notifyUserChange` after the click /
        // keyboard reducer mutates the selection set). Programmatic
        // writes (`setItemsArray`, `setSelectedIndex(idx, false)` used
        // by `showAt`) bypass this path, so re-opening the dropdown
        // doesn't trigger a spurious commit.
        this._list.on("action", () => onSelect(this._list.getSelectedIndex()));
    }

    /**
     * Forwards a keystroke from the host {@link ComboBox} (which keeps
     * DOM focus while the dropdown is open) into the inner list's
     * keyboard reducer. Mirrors {@link AnimatedDropdown.handleKey}.
     * Returns `true` when the list consumed the key so the host can
     * `preventDefault` and stop further processing.
     *
     * Keeping focus on the host (rather than calling `_list.focus()`
     * when the dropdown opens) is what lets a ComboBox embedded inside
     * a wrapping picker (e.g. the time selects inside
     * `DateTimePickerDropdown`, especially in a table-cell variant)
     * avoid stealing focus from the parent's input — a programmatic
     * focus shift bypasses the parent's `pointerdown.preventDefault`
     * focus-loss guard.
     *
     * @param e - The keyboard event captured by the host.
     *
     * @returns `true` when the list consumed the key.
     */
    handleKey(e: KeyboardEvent): boolean {
        return this._list.handleKey(e);
    }

    /**
     * Replaces the rendered row list with one entry per item, seeds the
     * inner list's selection from `selectedIndex`, and lays out the panel
     * anchored below `anchorEl`. The dropdown height is capped at
     * {@link COMBOBOX_DROPDOWN_MAX_HEIGHT_PX} so long option lists
     * scroll inside the panel rather than overflowing the viewport.
     *
     * @param anchorEl - Element the dropdown is anchored to.
     * @param items - The option pairs to display.
     * @param selectedIndex - The row to seed as currently selected, or
     *   `-1` for no initial selection.
     */
    showAt(anchorEl: Handle, items: Array<SelectableListItem>, selectedIndex: number): this {
        this.pauseLayout();
        this._list.setItemsArray(items);
        this._list.setSelectedIndex(selectedIndex, false);
        this.resumeLayout();

        // Add the dropdown's border to the natural row stack so the inner List
        // (which receives `outerHeight - border`) has room for the rows without
        // overflowing by 2 px and triggering an unnecessary scrollbar.
        const perim    = this.getPerimeterSize();
        const chromeH  = perim.top + perim.bottom;
        const chromeW  = perim.left + perim.right;
        const naturalH = items.length * COMBOBOX_DROPDOWN_ROW_HEIGHT_PX + chromeH;
        const panelH   = Math.min(naturalH, COMBOBOX_DROPDOWN_MAX_HEIGHT_PX);
        const rect     = DOM.source.getElementRect(anchorEl);

        // Dropdown lives outside the host's layout tree (overlay on
        // documentElement), so it isn't bound to the anchor's width.
        //
        // Sizing model:
        //   floor   = anchor.width                       (never narrower than input)
        //   ceiling = max(anchor.width, _minWidth)       (configured floor widens it
        //                                                 when the input is narrow,
        //                                                 but a wide input is the cap
        //                                                 — labels beyond it truncate)
        //   width   = clamp(naturalLabelWidth, floor, ceiling), capped at viewport
        const labelW       = this.measureWidestLabel(items);
        const naturalW     = labelW + COMBOBOX_DROPDOWN_ROW_PADDING_PX + chromeW;
        const floorW       = rect.width;
        const ceilingW     = Math.max(rect.width, this._minWidth);
        const dropdownW    = Math.min(Math.max(naturalW, floorW), ceilingW, DOM.source.getViewportSize().width);

        this.setWidth(dropdownW);
        this.setHeight(panelH);

        this.placeAnchored(rect);

        this.showAnimated();

        // VBox-backed list positions rows via framework setters that no-op
        // while the dropdown element is detached. Run the layout pass
        // after `showAnimated` mounts the panel so rows land at the
        // correct y offsets on first open.
        this.doLayout();

        // Focus stays on the host ComboBox — `ComboBox.onKeyDown`
        // forwards keystrokes into `handleKey` so the list's keyboard
        // reducer runs without a DOM focus shift. Programmatically
        // focusing the list would blur whatever held focus before the
        // dropdown opened (a wrapping table-cell editor's input, the
        // parent picker's text input, …) and tear down the host above
        // us.
        return this;
    }

    /**
     * Sets the lower bound applied to the dropdown width. The dropdown is
     * always rendered at least this wide; if the widest label or the input
     * is wider, the dropdown grows beyond this floor.
     *
     * @param px - The minimum width in pixels.
     *
     * @returns This dropdown, for method chaining.
     */
    setMinWidth(px: number): this {
        this._minWidth = px;

        return this;
    }

    /**
     * Returns the configured lower bound on the dropdown width.
     *
     * @returns The minimum width in pixels.
     */
    getMinWidth(): number {
        return this._minWidth;
    }

    /**
     * Returns the inner [`List`](/api/component/list/classes/List) so the
     * host can forward store binding, value writes, and other list-side
     * operations directly. Used by [`ComboBox.setStore`](/api/component/input/classes/ComboBox#setstore)
     * to mirror its store onto the embedded list.
     *
     * @returns The hosted list instance.
     */
    getList(): List {
        return this._list;
    }

    /**
     * Returns the widest label measured at the row's font, in pixels. Used to
     * size the dropdown wide enough to display the longest entry without
     * truncation (capped at the viewport in `showAt`).
     *
     * @param items - The items to measure (only `label` is read).
     *
     * @returns The maximum measured width across all labels, or `0` when empty.
     */
    private measureWidestLabel(items: Array<SelectableListItem>): number {
        let max = 0;

        for (const item of items) {
            const w = Util.measureTextWidth(item.label);
            if (w > max) {
                max = w;
            }
        }

        return max;
    }
}

// Static typography for the ComboBox surface. Layout (label + caret
// placement) is handled by the framework's HBox manager so no class
// rule needs to write `display: flex` here. The dropdown's row chrome
// comes from the shared `.SelectableListRow` / `.SelectableListRow:hover` /
// `.SelectableListRow.selected` / `.SelectableListRow.focused` rules in
// AbstractSelectableList — no ComboBox-side row styling is required.
(() => {
    new StyleRule({
        scope:  "class",
        name:   "ComboBox",
        styles: {
            userSelect: "none",
            whiteSpace: "nowrap",
        },
    });

    // No `flex` here — `HBox` sizes the label component directly. `overflow`
    // and `text-overflow` keep long labels truncating with an ellipsis when
    // HBox clamps the label width to fit the row.
    new StyleRule({
        scope:  "class",
        name:   "ComboBoxLabel",
        styles: {
            overflow:     "hidden",
            textOverflow: "ellipsis",
        },
    });

    // The dropdown wrapper already carries the visible chrome (border /
    // radius / shadow); the embedded List inherits a `:focus::after`
    // ring from `AbstractSelectableList`, which would paint a second ring
    // inside the dropdown when it takes focus on open. Suppress the
    // pseudo so the dropdown chrome reads as a single surface.
    new StyleRule({
        scope:  "selector",
        name:   ".ComboBoxDropdown .List:focus::after",
        styles: {
            content: "none",
        },
    });
})();

/**
 * The visible label `<span>` inside a {@link ComboBox}. Hosts one
 * {@link ListItemRenderer} — built from the ComboBox's renderer factory — so
 * the collapsed control renders the selected entry exactly as the dropdown row
 * does (a glyph renderer shows the selected option's glyph here too). Positioned
 * by the parent `ComboBox`'s `doLayout` (flush left, taking the row's remaining
 * width after the fixed-size caret); the label's own `doLayout` forwards its box
 * to the renderer. Rendered `pointer-events: none` so clicks fall through to the
 * ComboBox surface that toggles the dropdown.
 */
class ComboBoxLabel extends Component {
    private _lineHeight: string | null = null;
    // True when `_lineHeight`'s current value was written through the
    // instance layer (the string branch of setLineHeight). The numeric
    // branch reads it to know whether it must clear a real #id
    // declaration before pointing this instance at the shared
    // `.ComboBoxLabel.lh<value>` rule, whose (0,2,0) specificity an #id
    // declaration would otherwise outrank. False in the numeric-only
    // lifetime every in-library caller actually produces.
    private _lineHeightOnInstanceLayer = false;
    /** The renderer painting the selected entry on the collapsed control. */
    private _renderer:   ListItemRenderer;

    /**
     * @param rendererFactory - Zero-argument factory producing this label's
     *   content renderer, shared with the dropdown list.
     */
    constructor(rendererFactory: () => ListItemRenderer) {
        super({ tag: "span" });
        this.setPointerEvents("none");

        this._renderer = rendererFactory();
    }

    /**
     * Rebinds the hosted renderer to the selected item. The empty /
     * no-selection state passes a blank item (`{ key: "", label: "" }`) at
     * index `-1`, so the label renders empty and a glyph renderer shows no
     * glyph.
     *
     * @param item - The selected item, or the blank item when nothing is
     *   selected.
     * @param index - The selected index, or `-1`.
     *
     * @returns This component, for method chaining.
     */
    setItem(item: SelectableListItem, index: number): this {
        this._renderer.update({ item, index });

        return this;
    }

    /**
     * Swaps in a new content renderer, re-skinning the collapsed control in
     * step with the dropdown when the ComboBox's renderer factory changes.
     *
     * @param renderer - The replacement renderer.
     *
     * @returns This component, for method chaining.
     *
     * @remarks The replaced renderer is disposed, so a caller holding a
     * reference to it must not reuse it afterward.
     */
    setRenderer(renderer: ListItemRenderer): this {
        const el = this.getElement();

        this._renderer.dispose();

        this._renderer = renderer;

        if (el) {
            DOM.sink.appendChild(el, this._renderer.getElement(true)!);
        }

        return this;
    }

    /**
     * Sets the CSS `line-height` so a single line of label text vertically
     * centers within the label's allocated height. Numeric values are stored
     * with a `"px"` suffix; string values pass through unchanged. Retained
     * because `ComboBox.doLayout` still drives it; the hosted label renderer
     * also matches its own line-height to the box in `layoutChildren`, so the
     * collapsed line stays centred either way. The numeric form paints
     * through a shared `.ComboBoxLabel.lh<value>` rule rather than this
     * instance's own `#id` rule, since the value is theme-derived and every
     * ComboBox under one theme resolves the same line box.
     *
     * @param value - A pixel count (number) or a CSS line-height string.
     *
     * @returns This component, for method chaining.
     */
    setLineHeight(value: number | string): this {
        const numeric  = typeof value === "number";
        const resolved = numeric ? value + "px" : value;

        if (this._lineHeight === resolved && this._lineHeightOnInstanceLayer === !numeric) {
            return this;
        }

        if (numeric) {
            if (this._lineHeightOnInstanceLayer) {
                this.writeStyle({ font: { lineHeight: null } });
                this._lineHeightOnInstanceLayer = false;
            }

            this.setValueStyleState("lh", resolved, { font: { lineHeight: resolved } });
        } else {
            this.clearValueStyleState("lh");
            this.writeStyle({ font: { lineHeight: resolved } });
            this._lineHeightOnInstanceLayer = true;
        }

        this._lineHeight = resolved;

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

    /**
     * Appends the renderer's element to the label DOM. The renderer's own
     * children (label, optional glyph) are appended by the renderer's `init`.
     *
     * @param element - Optional element passed by the rendering pipeline; falls
     *   back to getElement().
     *
     * @returns This component, for method chaining.
     */
    protected init(element?: Handle): this {
        super.init(element);

        const el = element || this.getElement();
        if (el) {
            DOM.sink.appendChild(el, this._renderer.getElement(true)!);

            // Re-assert a value-class token recorded by setLineHeight before
            // this element existed — setValueStyleState's own DOM write is
            // gated on getElement(). Mirrors Text.render()'s catch-up and
            // Component.init's own re-apply of declared state tokens.
            const lineHeightToken = this.getValueStyleToken("lh");
            if (lineHeightToken) {
                DOM.sink.apply(el, { addClass: [lineHeightToken] });
            }
        }

        return this;
    }

    /**
     * Sizes the renderer to fill the label's content box, then lets it lay out
     * its own children. Only writes setters (no geometry reads).
     *
     * @returns This component, for method chaining.
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
     * Disposes the renderer, then runs the inherited teardown. `_renderer`
     * is raw-appended rather than registered, so the base destructor's
     * recursion over `_components` cannot reach it.
     */
    protected destructor(): void {
        this._renderer.dispose();

        super.destructor();
    }
}

// Cancels `Glyph`'s own glyphLg-sized minSize/maxSize default (see
// `glyphDefaultSize()` in Glyph.ts), which would otherwise still deviate from
// the framework baseline and reinstate a `.ComboBoxCaretGlyph` class rule
// carrying the wrong (glyphLg, not glyphMd) size. These values resolve to
// exactly the framework's own minWidth/minHeight ("0px") and maxWidth/
// maxHeight ("none"), so this class contributes no CSS deviation of its own —
// GLYPH_MD_INK_TRAIT alone supplies the shared size, and `ComboBoxCaret`'s own
// constructor still pins the real per-instance value on top of it.
const NO_OWN_SIZE_DEFAULT: Partial<GlyphOptions> = {
    minSize: { width: 0, height: 0 },
    maxSize: { width: UNBOUNDED, height: UNBOUNDED },
};

/**
 * The chevron glyph inside a {@link ComboBoxCaret}. Opts into
 * `GLYPH_MD_INK_TRAIT`, so every ComboBox's chevron shares one CSS rule
 * with `WindowHeaderTitleGlyph`'s title icon instead of each repeating the
 * same theme-matched size on its own class rule.
 */
class ComboBoxCaretGlyph extends Glyph {
    protected static readonly ownStyleTraits: readonly StyleTrait[] = [GLYPH_MD_INK_TRAIT];

    constructor() {
        super("chevron-down", undefined, NO_OWN_SIZE_DEFAULT);
    }
}

/**
 * The fixed-size caret container inside a {@link ComboBox}. Framework-absolute
 * (the default) so the caret's own inline `left`/`top` from `ComboBox.doLayout`
 * pins it relative to the ComboBox padding box, not its in-flow position
 * (which would otherwise be offset by the parent's padding-left and push the
 * caret past the right edge into `overflow: hidden`).
 */
class ComboBoxCaret extends Component {
    private _glyph: Glyph = new ComboBoxCaretGlyph();
    private _size:  number;

    constructor() {
        // Size the caret to the theme's text-matched glyphMd icon step so the
        // chevron matches the trigger icons of sibling fields (DateField/
        // TimeField), whose Button-hosted glyphs already sync to the text
        // line. A bare Glyph otherwise keeps its static default and renders
        // visibly larger than every other field icon. Lock min == max so the
        // box stays square regardless of content (the glyph child contributes
        // no intrinsic height); the glyph fills the box so it centres trivially.
        const size = ThemeManager.getResolvedScale().glyphMd;

        super({ tag: "span" }, { minSize: { width: size, height: size }, maxSize: { width: size, height: size } });

        this._size = size;
        this.setPointerEvents("none");

        this._glyph.setPreferredSize({ width: this._size, height: this._size });
        this._glyph.setPointerEvents("none");
        this.addComponent(this._glyph);
    }

    /**
     * Returns the square caret box size in pixels (the field's text font size),
     * so the owning {@link ComboBox}'s layout reserves a matching caret column.
     *
     * @returns The caret box edge length in pixels.
     */
    getCaretSize(): number {
        return this._size;
    }

    /**
     * Exposes the trigger glyph so the owning {@link ComboBox} can rotate it in
     * step with the dropdown's open / close animation.
     *
     * @returns The chevron glyph centered in the caret box.
     */
    getGlyph(): Glyph {
        return this._glyph;
    }
}

/**
 * A drop-down combo box backed by a styled `<div>` surface and an
 * `AnimatedDropdown` panel.
 *
 * Manages an internal list of [`SelectableListItem`](/api/component/list/interfaces/SelectableListItem) entries and an active selection.
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
class ComboBox<TOptions extends ComboBoxOptions = ComboBoxOptions> extends AbstractInput<string, TOptions> {

    // Shares the border/borderRadius pair with TextInput, AbstractPickerField,
    // and FieldSet via one generated CSS rule — see
    // plans/cross-class-style-groups.md. `ComboBox` has no `ownClassStyleDefaults`
    // of its own, and declaring this alone does not make its chain participate
    // in the hierarchy cascade (`chainParticipates` only reads `ownClassStyleDefaults`).
    protected static readonly ownStyleTraits: readonly StyleTrait[] = [INPUT_CHROME_TRAIT];

    private readonly _dropdown:    ComboBoxDropdown;
    private _label:                ComboBoxLabel;
    private _caret:                ComboBoxCaret;
    /**
     * Cached value passed to {@link setValue} before items / store are
     * available. The inner list silently drops unknown keys (its
     * `findIndex` returns -1 and clears the selection), so this field
     * holds the pending key until an items-load resolves it.
     */
    private _pendingValue:         string | null = null;
    /** The store currently subscribed for option refreshes, or null. */
    private _boundStore:           AbstractStore | null = null;
    /** Handler re-asserting selection + label after the inner list rebuilds from a store event. */
    private readonly _onStoreRefresh: () => void;

    /**
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: ComboBoxOptions, subclassDefaults?: Partial<ComboBoxOptions>);
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(
            options,
            { ..._defaultComboBoxOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
        );

        this.getAria().setRole("combobox");
        this.getAria().setExpanded(false);
        this.getAria().setTabIndex(0);

        this._label = new ComboBoxLabel(this._options.rendererFactory ?? (() => new LabelListItemRenderer()));
        this._caret = new ComboBoxCaret();
        this.addComponent(this._label);
        this.addComponent(this._caret);

        // Eager dropdown construction: the inner List now owns every items /
        // selection / store-binding state and must exist before the
        // late-dispatch block below routes `setItems` / `setValue` /
        // `setStore` / `setSelectedIndex` into it. The dropdown's outer
        // `<div>` is still lazy (built by `getElement(true)` on first show),
        // and the list's row DOM only mounts when the dropdown root mounts,
        // so the net cost is three JS instances and one `Fit` layout.
        this._dropdown = new ComboBoxDropdown(idx => this.onRowSelected(idx));

        // Forward the dropdown-specific options that were captured pure by
        // `applyOptions`. These run unconditionally now that the dropdown
        // is always present.
        if (this._options.dropdownAnimated !== undefined) {
            this._dropdown.setAnimated(this._options.dropdownAnimated);
        }
        if (this._options.dropdownMinWidth !== undefined) {
            this._dropdown.setMinWidth(this._options.dropdownMinWidth);
        }

        // Forward the renderer factory onto the embedded list before the
        // items / store late-dispatch so the first row build already paints
        // through it. The collapsed `_label` was constructed with the same
        // factory above.
        if (this._options.rendererFactory !== undefined) {
            this._dropdown.getList().setRendererFactory(this._options.rendererFactory);
        }

        this.refreshLabel();

        this.updateHeight();
        this.subscribeTheme(() => this.updateHeight());

        Event.addListener(this, "click",   ()                 => this.toggleDropdown());
        Event.addListener(this, "keydown", (e: KeyboardEvent) => this.onKeyDown(e));

        // The manager closes the dropdown on an outside click via its
        // "click-outside" mode; route that through closeDropdown. The anchor
        // (the ComboBox surface, excluded so the toggle click doesn't
        // re-close) is set lazily in toggleDropdown — `getElement(true)` must
        // not run during construction.
        this._dropdown.setCloseHandler(() => this.closeDropdown());

        this._onStoreRefresh = () => this.onStoreRefresh();

        // Late-built state: store / items / selection were written pure to
        // `_options` by the super-time cascade. Dispatch them now that the
        // dropdown's inner list is initialised.
        if (this._options.store !== undefined && this._options.displayField !== undefined) {
            this.setStore(this._options.store, this._options.displayField, this._options.valueField, this._options.glyphField);
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

        if (this._options.enabled !== undefined) {
            this.applyEnabled(this._options.enabled);
        }

        if (this._options.readOnly !== undefined) {
            this.applyReadOnly(this._options.readOnly);
        }

        // Establishes the clean baseline for dirty-state tracking — see AbstractInput.markClean().
        this.markClean();
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
        if (options.glyphField       !== undefined) this._options.glyphField       = options.glyphField;
        if (options.rendererFactory  !== undefined) this._options.rendererFactory  = options.rendererFactory;
        if (options.selectedIndex    !== undefined) this._options.selectedIndex    = options.selectedIndex;
        if (options.value            !== undefined) this._options.value            = options.value;
        if (options.selectedItem     !== undefined) this._options.selectedItem     = options.selectedItem;
        if (options.dropdownAnimated !== undefined) this._options.dropdownAnimated = options.dropdownAnimated;
        if (options.dropdownMinWidth !== undefined) this.setDropdownMinWidth(options.dropdownMinWidth);

        return this;
    }

    /**
     * Recalculates preferred and maximum height from the unified line box plus
     * this control's own chrome.
     *
     * @remarks Box height is `Util.lineHeightPx()` (the same line box every text
     * control renders at) plus the ComboBox's own vertical insets, padding, and
     * border — the identical sum `wrapInnerBaseline` re-adds — so a `ComboBox`
     * placed next to a `TextField` shares its row height and baseline without a
     * UA `<input>` probe.
     */
    protected updateHeight(): void {
        this.applySingleLineBox(
            Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize()),
            COMBO_BOX_DEFAULT_WIDTH,
        );
    }

    /**
     * Places the label against the content box's left edge and the caret
     * against its right edge, both vertically centered within its height. Replaces the prior `display: flex`
     * arrangement on the surface element so every child position is committed
     * via framework setters.
     */
    doLayout(): this {
        super.doLayout();

        const box = this.getContentBounds();
        if (!box) {
            return this;
        }

        // Layout constants. `gap` matches the prior `gap: 6px` on the
        // `.ComboBox` class rule; `caretSize` reads the caret's own square box
        // size (the field's text font size) so the reserved column tracks it.
        // The label fills the remaining width.
        const gap       = 6;
        const caretSize = this._caret.getCaretSize();

        const labelW    = Math.max(0, box.width - caretSize - gap);
        const caretX    = box.x + labelW + gap;
        const caretY    = box.y + Math.max(0, (box.height - caretSize) / 2);

        this._label.setX(box.x);
        this._label.setY(box.y);
        this._label.setWidth(labelW);
        this._label.setHeight(box.height);
        // `lineHeight` equals the label's height so the single line of label
        // text vertically centers without `display: flex` on the parent.
        this._label.setLineHeight(box.height);
        // Position the label's hosted renderer now that its box is sized.
        this._label.doLayout();

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
        return this.wrapInnerBaseline(Util.measureTextBaseline());
    }

    /**
     * Pops the option dropdown if it is currently closed; a no-op when it
     * is already open. Lets an embedding host (e.g. a table cell editor)
     * land the user straight in the option list on focus instead of
     * requiring a second click or keystroke to open the panel.
     *
     * @returns This component, for method chaining.
     */
    openDropdown(): this {
        if (!this._dropdown.isOpen()) {
            this.toggleDropdown();
        }

        return this;
    }

    /**
     * Toggles the dropdown's open state.
     */
    private toggleDropdown(): void {
        if (this._dropdown.isOpen()) {
            this.closeDropdown();
            return;
        }

        const surface = this.getElement(true)!;
        const list    = this._dropdown.getList();

        // Exclude the ComboBox surface from the manager's outside-click test.
        this._dropdown.setAnchorElement(surface);

        // `showAt` re-applies the items / selectedIndex onto its own inner
        // list. Passing the list's current state round-trips harmlessly and
        // keeps the public `showAt` signature unchanged.
        this._dropdown.showAt(surface, list.getItems(), list.getSelectedIndex());
        this.getAria().setExpanded(true);
        this.setCaretOpen(true);
    }

    /**
     * Rotates the caret glyph to mirror the dropdown's open state, timed to the
     * dropdown's own fade so the arrow and panel move in lock-step. When the
     * dropdown is non-animated the rotation snaps instantly.
     *
     * @param open - `true` to point the chevron up (panel open), `false` to point it down (closed).
     */
    private setCaretOpen(open: boolean): void {
        const glyph = this._caret.getGlyph();
        const ms    = this._dropdown.isAnimated() ? this._dropdown.getDurationMs() : 0;

        glyph.setTransition(`transform ${ms}ms ease`);
        glyph.setTransform(open ? "rotate(180deg)" : "rotate(0deg)");
    }

    /**
     * Closes the dropdown if open. Focus is never re-asserted onto the
     * ComboBox surface — the dropdown lifecycle keeps focus on the
     * ComboBox throughout (keystrokes route through {@link onKeyDown}
     * which forwards to `dropdown.handleKey`), and a wrapping picker /
     * cell-editor that owns its own input must not have its input
     * stolen by a child ComboBox dismissing.
     */
    private closeDropdown(): void {
        if (this._dropdown.isOpen()) {
            this._dropdown.hideAnimated();
            this.getAria().setExpanded(false);
            this.setCaretOpen(false);
        }
    }

    /**
     * Handles keydown on the ComboBox surface. While the dropdown is
     * open, keystrokes are forwarded into the inner list via
     * `dropdown.handleKey` so the list's keyboard reducer
     * (ArrowUp/Down/Home/End/PageUp/Down/Enter/Space/type-ahead) can
     * run without the dropdown ever taking DOM focus. When the
     * dropdown is closed, the open gesture (ArrowDown/Up/Enter/Space)
     * pops it. Escape closes the dropdown.
     *
     * @param e - The keyboard event.
     */
    private onKeyDown(e: KeyboardEvent): Event.ListenerResult {
        if (this._dropdown.isOpen()) {
            if (this._dropdown.handleKey(e)) {
                return { prevent: true };
            }

            if (e.key === "Escape") {
                this.closeDropdown();

                return { prevent: true };
            }

            return;
        }

        switch (e.key) {
            case "ArrowDown":
            case "ArrowUp":
            case "Enter":
            case " ":
                this.toggleDropdown();

                return { prevent: true };
            case "Escape":
                // Nothing to close.
                break;
            default:
                break;
        }
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
     * Returns the selected item and its index for the collapsed control to
     * render. Falls back to a blank item at index `-1` when nothing is
     * selected, so the label renders empty and a glyph renderer shows no glyph.
     *
     * @returns The selected `{ item, index }`, or the blank item at `-1`.
     */
    private computeSelectedItem(): { item: SelectableListItem; index: number } {
        const list  = this._dropdown.getList();
        const idx   = list.getSelectedIndex();
        const items = list.getItems();

        if (idx >= 0 && idx < items.length) {
            return { item: items[idx], index: idx };
        }

        return { item: { key: "", label: "" }, index: -1 };
    }

    /**
     * Refreshes the collapsed control after a value or selection change by
     * rebinding the label's renderer to the selected item.
     */
    private refreshLabel(): void {
        const { item, index } = this.computeSelectedItem();
        this._label.setItem(item, index);
    }

    /**
     * Registers a listener for one of this combo box's events. `"action"` is
     * the semantic alias of `"change"` — both fire on every committed
     * selection through the inherited {@link AbstractInput} listener bag;
     * `"binding"` is the inherited data-binding event.
     *
     * @param event - The event name.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This component, for method chaining.
     */
    on(event: "action",  listener: Function): this;
    on(event: "change",  listener: (value: string) => void): this;
    on(event: "binding", listener: () => void): this;
    on(event: "action" | "change" | "binding", listener: Function): this {
        return super.on(
            (event === "action" ? "change" : event) as "change",
            listener as (value: string) => void,
        );
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
        return super.off(event === "action" ? "change" : event, listener);
    }

    /**
     * Sets the field value by matching the option's key. The key is also
     * cached in `_pendingValue` so a pre-items {@link setValue} survives a
     * later items / store load (the inner list silently drops unknown keys
     * by clearing its selection, which would otherwise lose the write).
     *
     * @param value - The option key to select. Falls back to no-op when unmatched.
     */
    setValue(value: string): this {
        this._pendingValue = value;
        this._dropdown.getList().setValue(value);
        this.refreshLabel();

        return this;
    }

    /**
     * Returns the current value (the key of the selected option). Falls back
     * to the cached pending value when no items have landed yet, so the
     * pre-items {@link setValue} contract survives store / items refreshes.
     *
     * @returns The selected option's key, or the last value passed to {@link setValue}.
     */
    getValue(): string {
        const v = this._dropdown.getList().getValue();

        // The list returns "" for "nothing selected". Surface the cached
        // pending value so the pre-items setValue contract survives until
        // items arrive and the key resolves to a real selection.
        return v || (this._pendingValue ?? "");
    }

    /**
     * Returns the zero-based index of the currently selected option.
     *
     * @returns The selected index, or -1 when nothing is selected.
     */
    getSelectedIndex(): number {
        return this._dropdown.getList().getSelectedIndex();
    }

    /**
     * Sets the selected index and optionally fires a 'change' event.
     *
     * @param idx - The zero-based index to select.
     * @param fireEvent - Optional. When true (default), fires the 'change' event after updating.
     */
    setSelectedIndex(idx: number, fireEvent: boolean = true): this {
        // Pass `false` to the inner list so its own `change` doesn't fire on
        // `this._dropdown.getList()`; ComboBox fans the committed value out
        // through AbstractInput's change / binding listeners directly below.
        this._dropdown.getList().setSelectedIndex(idx, false);
        this._pendingValue = null;
        this.refreshLabel();

        if (fireEvent) {
            this.notifyChange(this.getValue());
        }

        return this;
    }

    /**
     * Returns a copy of the current [`SelectableListItem`](/api/component/list/interfaces/SelectableListItem) array.
     *
     * @returns A shallow copy of the internal item array.
     */
    getItems(): Array<SelectableListItem> {
        return this._dropdown.getList().getItems();
    }

    /**
     * Replaces all options with the given specs. Each entry is either a plain
     * string — auto-keyed by its array position — or a pre-formed
     * [`SelectableListItem`](/api/component/list/interfaces/SelectableListItem) whose
     * explicit key is kept verbatim, in which case `getValue()` returns that
     * key instead of the positional index. The caller owns key uniqueness.
     *
     * @param items - A single spec or an array of specs. Each spec is a string
     *   (auto-keyed by position) or a `{ key, label }` object (explicit key).
     */
    setItems(items: SelectableListItemSpec | Array<SelectableListItemSpec>): this {
        this._dropdown.getList().setItems(items);
        this.reapplyPendingValue();
        this.autoSelectFirstIfEmpty();
        this.refreshLabel();

        return this;
    }

    /**
     * Appends a new option to the end of the list. A plain string is auto-keyed
     * by the appended position; a pre-formed
     * [`SelectableListItem`](/api/component/list/interfaces/SelectableListItem) keeps
     * its explicit key verbatim.
     *
     * @param item - A string (auto-keyed by final position) or a `{ key, label }`
     *   object (explicit key).
     */
    addItem(item: SelectableListItemSpec): this {
        this._dropdown.getList().addItem(item);
        this.reapplyPendingValue();
        this.autoSelectFirstIfEmpty();
        this.refreshLabel();

        return this;
    }

    /**
     * Binds this component to a store, populating options from the given display field.
     *
     * @param store - The store to bind to.
     * @param displayField - The record field whose value is shown as the option label.
     * @param valueField - Optional. The record field used as the option value; defaults to the record's primary key.
     * @param glyphField - Optional. The record field whose value becomes each
     *   option's `glyph`; forwarded to the embedded list.
     */
    setStore(store: AbstractStore, displayField: string, valueField?: string, glyphField?: string): this {
        // Keep `_options.store` / `displayField` / `valueField` / `glyphField`
        // in sync so anything still inspecting them (constructor-time dispatch
        // on re-entry, future option-bag introspection) reads the current
        // binding.
        this._options.store        = store;
        this._options.displayField = displayField;
        this._options.valueField   = valueField;
        this._options.glyphField   = glyphField;

        this.unbindStore();

        // Bind the inner list first so its own store handler is registered —
        // and therefore fires — before the combo's `_onStoreRefresh`, which
        // relies on the list having already rebuilt its rows.
        this._dropdown.getList().setStore(store, displayField, valueField, glyphField);

        this._boundStore = store;

        (['load', 'add', 'remove', 'datachange'] as const).forEach(e =>
            store.on(e, this._onStoreRefresh)
        );

        this.reapplyPendingValue();
        this.autoSelectFirstIfEmpty();
        this.refreshLabel();

        return this;
    }

    /**
     * Unsubscribes `_onStoreRefresh` from the currently-bound store, if any.
     * Extracted from {@link setStore} so {@link destructor} can call the same
     * unbind on teardown.
     */
    private unbindStore(): void {
        if (!this._boundStore) {
            return;
        }

        (['load', 'add', 'remove', 'datachange'] as const).forEach(e =>
            this._boundStore!.off(e, this._onStoreRefresh)
        );
    }

    /**
     * Unsubscribes from the bound store (see {@link setStore}) and disposes
     * the dropdown, then runs the inherited teardown. The store is owned by
     * the caller, not this combo box, and can outlive it, so an
     * un-unsubscribed listener would pin this component in the store's own
     * `ListenerBag` for as long as the store itself lives. `_dropdown` is a
     * `Position.FIXED` overlay (see ARCHITECTURE.md's carve-out for
     * `AnimatedDropdown`), never a registered child, so `super.destructor()`'s
     * recursion cannot reach it on its own.
     */
    protected destructor(): void {
        this.unbindStore();
        this._dropdown.dispose();

        super.destructor();
    }

    /**
     * Returns the currently bound store, or null if none is set.
     *
     * @returns The bound store, or null.
     */
    getStore(): AbstractStore | null {
        return this._dropdown.getList().getStore();
    }

    /**
     * Replaces the renderer factory for both the dropdown rows and the
     * collapsed control, then rebinds the collapsed control so the selected
     * entry renders through the new renderer immediately.
     *
     * @param factory - Zero-argument factory producing a renderer per row.
     *
     * @returns This component, for method chaining.
     */
    setRendererFactory(factory: () => ListItemRenderer): this {
        this._options.rendererFactory = factory;
        this._dropdown.getList().setRendererFactory(factory);
        this._label.setRenderer(factory());
        this.refreshLabel();

        return this;
    }

    /**
     * Returns the renderer factory currently in use by the embedded list (and
     * mirrored on the collapsed control).
     *
     * @returns The zero-argument renderer factory.
     */
    getRendererFactory(): () => ListItemRenderer {
        return this._dropdown.getList().getRendererFactory();
    }

    /**
     * Returns the store record corresponding to the currently selected option.
     *
     * @returns The selected ModelRecord, or undefined if no store is bound or no item is selected.
     */
    getSelectedRecord(): ModelRecord | undefined {
        return this._dropdown.getList().getSelectedRecord();
    }

    /**
     * Re-attempts the pending {@link setValue} write after an items / store
     * load. The inner list rejects unknown keys by clearing its selection;
     * `_pendingValue` survives until a write resolves to a real index, at
     * which point it's cleared so later reads pick up the live selection.
     */
    private reapplyPendingValue(): void {
        if (this._pendingValue === null) {
            return;
        }

        const list = this._dropdown.getList();
        list.setValue(this._pendingValue);

        if (list.getSelectedIndex() >= 0) {
            this._pendingValue = null;
        }
    }

    /**
     * Selects the first row when none is selected and the list has at least
     * one item. Mirrors the prior ComboBox behaviour where `setItems` /
     * `addItem` / `setStore` would land on index 0 by default — the inner
     * List leaves nothing selected, so the auto-select happens here to keep
     * the surface's `getValue` non-empty for the typical "fill items, render
     * the first label" flow.
     */
    private autoSelectFirstIfEmpty(): void {
        const list = this._dropdown.getList();

        if (list.getSelectedIndex() < 0 && list.getItems().length > 0) {
            list.setSelectedIndex(0, false);
        }
    }

    /**
     * Re-asserts the surface selection and label after the inner list
     * rebuilds its rows from a deferred store event (an async `load`, or a
     * later `add` / `remove` / `datachange`). The inner list clears its
     * selection whenever it rebuilds from the store, so without this the
     * combo would show populated options but a blank label on first paint
     * when the store loads after construction.
     */
    private onStoreRefresh(): void {
        this.reapplyPendingValue();
        this.autoSelectFirstIfEmpty();
        this.refreshLabel();
    }

    /**
     * Enables or disables the fade animation on the dropdown.
     *
     * @param value - true to fade, false for instant open/close.
     */
    setDropdownAnimated(value: boolean): this {
        this._options.dropdownAnimated = value;
        this._dropdown.setAnimated(value);

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

    /**
     * Sets the lower bound on the dropdown width. The dropdown is always at
     * least this wide; long labels exceeding the floor still widen it further
     * (capped at the viewport).
     *
     * @param px - The minimum width in pixels. Defaults to `200`.
     *
     * @returns This component, for method chaining.
     */
    setDropdownMinWidth(px: number): this {
        this._options.dropdownMinWidth = px;
        this._dropdown.setMinWidth(px);

        return this;
    }

    /**
     * Returns the configured lower bound on the dropdown width.
     *
     * @returns The minimum width in pixels.
     */
    getDropdownMinWidth(): number {
        return this._options.dropdownMinWidth ?? COMBOBOX_DROPDOWN_MIN_WIDTH_PX;
    }

    /**
     * Reflects the enabled flag in the ARIA tree and the tabindex. Closes
     * the dropdown when transitioning to disabled so a stale panel doesn't
     * outlast the state change.
     */
    protected applyEnabled(value: boolean): void {
        this.getAria().setDisabled(!value);
        this.getAria().setTabIndex(value ? 0 : -1);
        this.setCursor(value ? "pointer" : "default");
        if (!value) {
            this.closeDropdown();
        }
    }

    /**
     * Reflects the read-only flag in the ARIA tree. Read-only ComboBoxes
     * stay focusable and announce their state but the click handler
     * intentionally still opens the dropdown for inspection; the inherited
     * `isReadOnly` flag is what callers query to gate writes.
     */
    protected applyReadOnly(value: boolean): void {
        this.getAria().setReadOnly(value);
    }
}

const ComboBoxCallable = callable(ComboBox);
type ComboBoxCallable = ComboBox;
export {
    ComboBox            as _ComboBox,
    ComboBoxDropdown    as _ComboBoxDropdown,
    ComboBoxCallable    as ComboBox
};
