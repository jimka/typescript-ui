// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Panel } from "~/core/Panel.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Event } from "~/core/Event.js";
import { Text } from "~/component/input/Text.js";
import { Insets } from "~/primitive/Insets.js";
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
    const header = new StyleRule({ scope: "class", name: "PickerColumnHeader" });
    header.set("opacity", "0.7");
    header.ensure();

    // Visual properties only. `cursor` is set per-instance via `setCursor`
    // because Component's per-element `#id { cursor: … }` CSS rule (emitted
    // from `applyStyle` using the cached default `"default"`) wins on
    // specificity over any class-level cursor declaration.
    const cell = new StyleRule({ scope: "class", name: "PickerCell" });
    cell.set("borderRadius", "3px");
    cell.ensure();

    const cellHover = new StyleRule({ scope: "selector", name: ".PickerCell:hover" });
    cellHover.set("backgroundColor",
        "var(--ts-ui-autocomplete-item-hover-bg, rgba(30, 100, 200, 0.08))");
    cellHover.ensure();

    // Disabled cells: no hover effect, dim foreground, optional background
    // shading from the theme token. The `:hover` selector above is overridden
    // because the more specific `.PickerCell.disabled` selector wins for
    // properties declared here. Cursor is per-instance — see
    // `PickerCell.setDisabled`.
    const cellDisabled = new StyleRule({ scope: "selector", name: ".PickerCell.disabled" });
    cellDisabled.setMany({
        pointerEvents:   "none",
        color:           "var(--ts-ui-autocomplete-item-disabled-color, rgb(170, 170, 170))",
        backgroundColor: "var(--ts-ui-picker-cell-disabled-bg, transparent)",
    });
    cellDisabled.ensure();
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

        Event.addListener(this, "pointerdown", this.handlePointerDown);
        Event.addListener(this, "click",       this.handleClick);
    }

    /**
     * Suppresses focus loss when the cell is pointed at so the host input's
     * blur-to-commit path doesn't fire mid-click.
     *
     * @param e - The pointerdown event.
     */
    private handlePointerDown(e: PointerEvent): void {
        e.preventDefault();
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
            element.classList.toggle("disabled", disabled);
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
    protected render(): HTMLElement {
        const element = super.render();

        if (this._disabled) {
            element.classList.add("disabled");
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
            header.setPreferredSize(0, HEADER_HEIGHT);
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
        this._cellList.removeAllComponents();

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
     * overflow (the same pattern `AbstractCustomList.scrollIndexIntoView` uses).
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
        const cellTop      = cellEl.offsetTop;
        const cellHeight   = cellEl.offsetHeight;
        const viewportH    = panelEl.clientHeight;
        const desiredTop   = cellTop - (viewportH - cellHeight) / 2;
        const maxScrollTop = panelEl.scrollHeight - viewportH;
        const clamped      = Math.max(0, Math.min(maxScrollTop, desiredTop));

        panelEl.scrollTop = clamped;

        return this;
    }
}

export {
    PickerCell,
    PickerCellList,
    PickerColumn,
    PickerColumnHeader,
    CELL_HEIGHT as PICKER_CELL_HEIGHT,
    HEADER_HEIGHT as PICKER_HEADER_HEIGHT,
};
