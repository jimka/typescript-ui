// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Util } from "~/core/Util.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Panel } from "~/core/Panel.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Event } from "~/core/Event.js";
import { Text } from "~/component/input/Text.js";
import { Insets } from "~/primitive/Insets.js";
import { Size } from "~/primitive/Size.js";
import { VBox } from "~/layout/VBox.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";

/** Pixel height of each clickable cell row. Mirrors `TimePickerDropdown`'s historical layout. */
const CELL_HEIGHT:   number = 22;

/** Pixel height of the column header row. Mirrors `TimePickerDropdown`'s historical layout. */
const HEADER_HEIGHT: number = 18;

// Static typography, hover effect, and disabled-state shading defined once via
// class rules. Layout (column widths, cell stacking, scrolling) is driven by
// the framework HBox / VBox managers and Panel.autoScroll — no display:flex/grid here.
(() => {
    new StyleRule({
        scope:  "class",
        name:   "PickerColumnHeader",
        styles: {
            opacity: "0.7",
        },
    });

    // Visual properties only. `cursor` is set per-instance via `setCursor`
    // because Component's per-element `#id { cursor: … }` CSS rule (emitted
    // from `applyStyle` using the cached default `"default"`) wins on
    // specificity over any class-level cursor declaration.
    new StyleRule({
        scope:  "class",
        name:   "PickerCell",
        styles: {
            borderRadius: "3px",
        },
    });

    new StyleRule({
        scope:  "selector",
        name:   ".PickerCell:hover",
        styles: {
            backgroundColor: "var(--ts-ui-autocomplete-item-hover-bg, rgba(30, 100, 200, 0.08))",
        },
    });

    // Disabled cells: no hover effect, dim foreground, optional background
    // shading from the theme token. The `:hover` selector above is overridden
    // because the more specific `.PickerCell.disabled` selector wins for
    // properties declared here. Cursor is per-instance — see
    // `PickerCell.setDisabled`.
    new StyleRule({
        scope:  "selector",
        name:   ".PickerCell.disabled",
        styles: {
            pointerEvents:   "none",
            color:           "var(--ts-ui-autocomplete-item-disabled-color, rgb(170, 170, 170))",
            backgroundColor: "var(--ts-ui-picker-cell-disabled-bg, transparent)",
        },
    });
})();

/** Column header label ("Hour" / "Min" / "Sec" / …). Centred within its row. */
class PickerColumnHeader extends Text {
    /**
     * @param text - The header text.
     */
    constructor(text: string) {
        super(text, { textAlign: "center", fontSize: 12 });
    }
}

/**
 * Scrollable list of picker cells. A {@link Panel} with `autoScroll: 'y'` and a
 * stretching {@link VBox} so cells render at the full column width — giving the
 * mouse-hover region the full row, not just the digits' bounding box.
 *
 * @category Components
 */
class PickerCellList extends Panel {

    /**
     * Constructs an empty scrollable cell list. Cells are added via
     * {@link PickerColumn.addCell}.
     */
    constructor() {
        super({
            layoutManager: new VBox({ spacing: 0, stretching: true }),
            autoScroll:    "y",
            insets:        new Insets(0, 0, 0, 0),
        });
    }

    /**
     * Reports **no vertical content minimum**: this list is an `autoScroll: "y"`
     * surface, so it may be allocated less height than its stacked cells need and
     * scroll the overflow rather than demand its full content height.
     *
     * Without this override the inherited `Component.getMinSize` sums the
     * cells' minimums — and each {@link PickerCell} (a {@link Text}) reports a
     * one-line height floor — so the list's min height equals its entire content
     * height. The parent {@link PickerColumn}'s `VBox` then floors the weighted
     * list at that min, pinning it to its content size: the list never overflows,
     * the inner scroll never engages, and the fixed-height
     * {@link TimePickerDropdown} panel is inflated past the viewport. The
     * horizontal minimum is left untouched so the column still reserves room for
     * the widest label.
     *
     * @returns The inherited minimum with its height floored to `0`, or `null`
     *   when there is no inherited minimum.
     */
    getMinSize(): Size | null {
        const base = super.getMinSize();

        if (!base) {
            return base;
        }

        return { width: base.width, height: 0 };
    }
}

/**
 * A single picker cell — text label, hover + selection styling, click + focus
 * guard. The row width is set by the parent's stretching {@link VBox} so the
 * cell's `text-align: center` actually centres across the column.
 *
 * @category Components
 */
class PickerCell extends Text {

    private _selected: boolean = false;
    private _disabled: boolean = false;
    private readonly _onClick: () => void;

    /**
     * @param label - Text shown inside the cell.
     * @param onClick - Called when the cell is clicked. Suppressed while disabled.
     */
    constructor(label: string, onClick: () => void) {
        super(label, {
            textAlign:     "center",
            preferredSize: { width: 0, height: CELL_HEIGHT },
        });

        this._onClick = onClick;

        // `lineHeight = CELL_HEIGHT` centres the single line of digits vertically
        // within the row so the hover area looks consistent.
        this.setLineHeight(CELL_HEIGHT);
        // Component's per-instance CSS rule emits the cached cursor at render
        // time, which beats the `.PickerCell { cursor: pointer }` class rule
        // on specificity. The cursor must be set on this instance.
        this.setCursor("pointer");

        Event.addListener(this, "pointerdown", { prevent: true, handler: this.handlePointerDown });
        Event.addListener(this, "click",       this.handleClick);
    }

    /**
     * Suppresses focus loss when the cell is pointed at so the host input's
     * blur-to-commit path doesn't fire mid-click. `preventDefault` is
     * applied by the registration's `prevent: true` floor.
     *
     * @param e - The pointerdown event.
     */
    private handlePointerDown(_e: PointerEvent): void {
    }

    /**
     * Forwards a click to the constructor-supplied callback. No-op while the
     * cell is disabled.
     */
    private handleClick(): void {
        if (this._disabled) {
            return;
        }

        this._onClick();
    }

    /**
     * Toggles the selected (highlighted) state.
     *
     * @param selected - True to highlight this cell as the active value.
     * @returns This component, for method chaining.
     */
    setSelected(selected: boolean): this {
        if (this._selected === selected) {
            return this;
        }

        this._selected = selected;

        if (selected) {
            this.setBackgroundColor("var(--ts-ui-autocomplete-item-highlight-bg, rgba(30, 100, 200, 0.18))");
            this.setFontWeight("bold");
        } else {
            this.clearBackgroundColor();
            this.setFontWeight("normal");
        }

        return this;
    }

    /**
     * Returns the current selected state.
     *
     * @returns True when this cell is highlighted.
     */
    isSelected(): boolean {
        return this._selected;
    }

    /**
     * Toggles the disabled state. Disabled cells render with the
     * `.PickerCell.disabled` rule (dim colour, no pointer cursor, no hover)
     * and ignore clicks. State is cached on `_disabled`; the live DOM class
     * is toggled on first paint and via `classList.toggle` thereafter,
     * matching the cached-state pattern from `AccordionIndicator.setExpanded`.
     *
     * @param disabled - True to disable interaction.
     * @returns This component, for method chaining.
     */
    setDisabled(disabled: boolean): this {
        if (this._disabled === disabled) {
            return this;
        }

        this._disabled = disabled;
        // Component's per-instance cursor rule wins over the `.PickerCell.disabled`
        // class rule, so the cursor flip has to be mirrored on the instance.
        this.setCursor(disabled ? "default" : "pointer");

        const element = this.getElement();

        if (element) {
            DOM.sink.apply(element, { toggleClass: { disabled: disabled } });
        }

        return this;
    }

    /**
     * Returns the current disabled state.
     *
     * @returns True when this cell is disabled.
     */
    isDisabled(): boolean {
        return this._disabled;
    }

    /**
     * Renders the cell and applies the cached `.disabled` class so the first
     * paint reflects state set before the element was realised.
     *
     * @returns The rendered root element.
     */
    protected render(): Handle {
        const element = super.render();

        if (this._disabled) {
            DOM.sink.apply(element, { addClass: ["disabled"] });
        }

        return element;
    }
}

/**
 * A single picker column. Stacks an optional header above the scrollable cell
 * list via a stretching {@link VBox} — no `display: flex` on the column element.
 *
 * @category Components
 */
class PickerColumn extends Component {

    private _cellList: PickerCellList;

    /**
     * @param headerText - Header label, or null to render the column with no header row.
     */
    constructor(headerText: string | null) {
        super();
        this.setLayoutManager(new VBox({ spacing: 2, stretching: true }));

        if (headerText !== null) {
            const header = new PickerColumnHeader(headerText);
            header.setPreferredSize({ width: 0, height: HEADER_HEIGHT });
            this.addComponent(header);
        }

        this._cellList = new PickerCellList();
        // Weight=1 so the list takes all remaining vertical space after the
        // fixed-height header.
        const listConstraints = new LayoutConstraints();
        listConstraints.weight = 1;
        this.addComponent(this._cellList, listConstraints);
    }

    /**
     * Adds a cell to this column's scrollable list.
     *
     * @param cell - The cell to append.
     * @returns This component, for method chaining.
     */
    addCell(cell: PickerCell): this {
        this._cellList.addComponent(cell);

        return this;
    }

    /**
     * Clears every cell from this column's scrollable list.
     *
     * @returns This component, for method chaining.
     */
    clearCells(): this {
        this._cellList.disposeAllComponents();

        return this;
    }

    /**
     * Returns the inner scrollable list component, for callers that need to
     * reach the underlying DOM (e.g. to measure the column's own scroll state).
     *
     * @returns The inner cell-list panel.
     */
    getCellList(): PickerCellList {
        return this._cellList;
    }

    /**
     * Scrolls the inner panel so the first {@link PickerCell} whose
     * {@link PickerCell.isSelected} is `true` lands mid-viewport. Reads and
     * writes the panel's native `scrollTop` directly — the framework's typed
     * scroll setter lives only on the `VirtualScroller`-backed components, and
     * a `Panel`-with-`autoScroll: "y"` surface relies on native browser
     * overflow (the same pattern `AbstractSelectableList.scrollIndexIntoView` uses).
     *
     * @returns This component, for method chaining.
     */
    scrollSelectedIntoView(): this {
        const panelEl = this._cellList.getElement();

        if (!panelEl) {
            return this;
        }

        const children = this._cellList.getComponents();
        let target: PickerCell | null = null;

        for (const child of children) {
            if (child instanceof PickerCell && child.isSelected()) {
                target = child;
                break;
            }
        }

        if (!target) {
            return this;
        }

        const cellEl = target.getElement();

        if (!cellEl) {
            return this;
        }

        // `offsetTop` is the cell's top edge relative to its offsetParent (the
        // panel). Centring = top minus half the viewport plus half the cell.
        const cellBox      = DOM.source.getOffsetSize(cellEl);
        const panelMetrics = DOM.source.getScrollMetrics(panelEl);
        const cellTop      = cellBox.offsetTop;
        const cellHeight   = cellBox.offsetHeight;
        const viewportH    = panelMetrics.clientHeight;
        const desiredTop   = cellTop - (viewportH - cellHeight) / 2;
        const maxScrollTop = panelMetrics.scrollHeight - viewportH;
        const clamped      = Util.clamp(desiredTop, 0, maxScrollTop);

        DOM.sink.apply(panelEl, { scrollTop: clamped });

        return this;
    }

    /**
     * Re-highlights cells in place: the first {@link PickerCell} whose label
     * equals `value` is selected and every other cell is cleared. Passing
     * `null` clears the whole column. Unlike a rebuild this touches no DOM
     * structure and leaves `scrollTop` untouched, so a click-driven selection
     * change doesn't jump the scroll position. Mirrors the in-place
     * `refreshYearSelection` pattern in `AbstractCalendarDropdown`.
     *
     * @param value - The cell label to select, or null to clear the column.
     * @returns This component, for method chaining.
     */
    setSelectedValue(value: string | null): this {
        for (const child of this._cellList.getComponents()) {
            if (child instanceof PickerCell) {
                child.setSelected(child.getText().valueOf() === value);
            }
        }

        return this;
    }
}

export {
    PickerCell,
    PickerCellList,
    PickerColumn,
    PickerColumnHeader,
    CELL_HEIGHT as PICKER_CELL_HEIGHT,
};
