// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Button } from "~/component/button/Button.js";
import { AccordionIndicator } from "~/component/container/AccordionIndicator.js";
import { HBox } from "~/layout/HBox.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";

/**
 * Left padding of the header row, in pixels. Reproduces the 8px gap the former
 * Button-based header added to its label's left inset, so the title text keeps
 * the same start offset under the new HBox structure.
 */
const HEADER_PADDING_LEFT: number = 8;

/**
 * Right padding of the header row, in pixels. Mirrors the former `right: 10px`
 * offset the chevron overlay used, so the trailing chevron keeps the same gap
 * from the header's right edge now that it is an in-flow cell.
 */
const HEADER_PADDING_RIGHT: number = 10;

/**
 * Horizontal gap between the header's HBox cells (title, tool group, chevron),
 * in pixels. Keeps the chevron and tools from butting against the label or each
 * other; small because the title's flex weight already absorbs the slack.
 */
const HEADER_CELL_SPACING: number = 4;

/**
 * Compact-mode counterparts of the header's horizontal padding and cell gap,
 * in pixels. Tighter than the defaults so a compact accordion reads denser
 * without changing the text or glyph sizes.
 */
const COMPACT_PADDING_LEFT:  number = 6;
const COMPACT_PADDING_RIGHT: number = 6;
const COMPACT_CELL_SPACING:  number = 2;

/**
 * Construction-time options for {@link AccordionHeader}.
 *
 * @category Components
 */
export interface AccordionHeaderOptions extends ComponentOptions {
    /** Initial expanded state of the chevron indicator. */
    expanded?:    boolean;
    /** Which end of the header the chevron sits at. Defaults to `"right"`. */
    chevronSide?: "left" | "right";
    /** Optional registry glyph name shown leading the title label. */
    glyph?:       string;
    /** Whether the header uses compact (tighter) padding. Defaults to `false`. */
    compact?:     boolean;
}

/**
 * A section header used by [`Accordion`](/api/layout/classes/Accordion) (from `@jimka/typescript-ui/layout`)
 * to represent one collapsible section.
 *
 * The header is a plain styled {@link Component} that lays its children out with
 * an {@link HBox} row, left-to-right:
 *
 * 1. the {@link AccordionIndicator} chevron — **only** when `chevronSide` is `"left"`;
 * 2. a `chromeless` title {@link Button} (the section label, the clickable toggle
 *    target and the focusable element), given a flex `weight` so it spans the
 *    whole clickable region while its label stays left-anchored;
 * 3. the tool group container (an `HBox` row of per-section / re-parented tools);
 * 4. the chevron — **only** when `chevronSide` is `"right"` (the default), so the
 *    chevron sits outermost and tools sit inboard of it.
 *
 * Because the tools are *siblings* of the title button rather than descendants,
 * a click on a tool is simply not a click on the title button — there is nothing
 * to stop from propagating and no marker to maintain.
 *
 * @category Components
 */
class AccordionHeader extends Component<AccordionHeaderOptions> {

    declare private _indicator: AccordionIndicator;
    declare private _title:     Button;
    declare private _toolGroup: Component;
    private _tools: Component[] = [];
    private _chevronSide: "left" | "right" = "right";

    /**
     * @param label - Text displayed in the header's title button.
     * @param options - Optional construction-time options.
     */
    constructor(label: string, options?: AccordionHeaderOptions) {
        super({ tag: "div", ...options });

        // The chevron, title and tool group are independent child Components in
        // an HBox row — one DOM element per class, no side-loaded overlay.
        this._indicator = new AccordionIndicator();
        this._title     = new Button(label, { chromeless: true, anchor: AnchorType.WEST, glyph: options?.glyph });
        this._toolGroup = new Component();

        this._toolGroup.setLayoutManager(new HBox({ spacing: HEADER_CELL_SPACING, stretching: true }));
        this._toolGroup.setBackgroundColor("transparent");

        // Stretching so each cell fills the header height and centres its own
        // content (the title button and tool buttons centre vertically; the
        // chevron centres via its own rule). Padding + cell gap are applied by
        // `setCompact` at the end of construction.
        this.setLayoutManager(new HBox({ spacing: HEADER_CELL_SPACING, stretching: true }));

        // Flex weight on the title makes the whole left region clickable while
        // the label stays left (anchor WEST); tools/chevron keep their preferred
        // width at the trailing edge.
        const titleConstraints = new LayoutConstraints();

        titleConstraints.weight = 1;

        this.addComponent(this._title, titleConstraints);
        this.addComponent(this._toolGroup);

        this._chevronSide = options?.chevronSide ?? "right";
        this.placeIndicator();

        this.setExpanded(options?.expanded ?? false);
        this.setCompact(options?.compact ?? false);
    }

    /**
     * Toggles compact padding: tighter horizontal insets and a smaller inter-cell
     * gap so the header reads denser. The header *height* is driven by the
     * owning [`Accordion`](/api/layout/classes/Accordion); this method only
     * affects the row's own padding.
     *
     * @param value - True for compact padding, false for the defaults.
     *
     * @returns This header, for method chaining.
     */
    setCompact(value: boolean): this {
        const left  = value ? COMPACT_PADDING_LEFT  : HEADER_PADDING_LEFT;
        const right = value ? COMPACT_PADDING_RIGHT : HEADER_PADDING_RIGHT;

        this.setInsets(new Insets(0, right, 0, left));
        (this.getLayoutManager() as HBox).setComponentSpacing(value ? COMPACT_CELL_SPACING : HEADER_CELL_SPACING);

        // Compact the title button too: its tighter insets lower the header's
        // content-min height so the compact header height can actually take
        // effect (otherwise the title's min floors the row taller).
        this._title?.setCompact(value);
        this.scheduleLayout();

        return this;
    }

    /**
     * Inserts the chevron cell at the head (when `chevronSide` is `"left"`) or
     * the tail (when `"right"`) of the HBox row, removing it from its current
     * slot first so repeated calls re-position rather than duplicate.
     */
    private placeIndicator(): void {
        if (this.getComponents().includes(this._indicator)) {
            this.removeComponent(this._indicator);
        }

        if (this._chevronSide === "left") {
            this.insertComponent(this._indicator, 0);
        } else {
            this.addComponent(this._indicator);
        }
    }

    /**
     * Returns the title button — the clickable toggle target and the focusable
     * element. The owning [`Accordion`](/api/layout/classes/Accordion) wires its
     * `action` / `keydown` listeners and calls `focus()` on it.
     *
     * @returns The title button.
     */
    getTitleButton(): Button {
        return this._title;
    }

    /**
     * Toggles the expanded visual state: rotates the chevron and updates the
     * title button's `aria-expanded`.
     *
     * @param expanded - True to show the section as expanded.
     *
     * @returns This header, for method chaining.
     */
    setExpanded(expanded: boolean): this {
        this._indicator?.setExpanded(expanded);
        this._title?.getAria().setExpanded(expanded);

        return this;
    }

    /**
     * Returns whether the chevron is in the expanded state.
     *
     * @returns True if expanded.
     */
    isExpanded(): boolean {
        return this._indicator?.getExpanded() ?? false;
    }

    /**
     * Moves the chevron to the given end of the header and re-runs layout.
     *
     * @param side - `"left"` or `"right"`.
     *
     * @returns This header, for method chaining.
     */
    setChevronSide(side: "left" | "right"): this {
        if (this._chevronSide === side) {
            return this;
        }

        this._chevronSide = side;
        this.placeIndicator();
        this.scheduleLayout();

        return this;
    }

    /**
     * Returns which end the chevron currently sits at.
     *
     * @returns `"left"` or `"right"`.
     */
    getChevronSide(): "left" | "right" {
        return this._chevronSide;
    }

    /**
     * Adds a tool to this header's tool group (the cell between the title and the
     * trailing chevron). Used both for per-section tools and for the manager's
     * re-parented global tool. A no-op if the tool is already present.
     *
     * @param tool - The tool component to add.
     *
     * @returns This header, for method chaining.
     */
    addTool(tool: Component): this {
        if (this._tools.includes(tool)) {
            return this;
        }

        this._tools.push(tool);
        this._toolGroup.addComponent(tool);
        this.scheduleLayout();

        return this;
    }

    /**
     * Removes a previously-added tool from this header's tool group. A no-op if
     * the tool is not present.
     *
     * @param tool - The tool component to remove.
     *
     * @returns This header, for method chaining.
     */
    removeTool(tool: Component): this {
        const index = this._tools.indexOf(tool);

        if (index === -1) {
            return this;
        }

        this._tools.splice(index, 1);
        this._toolGroup.removeComponent(tool);
        this.scheduleLayout();

        return this;
    }

    /**
     * Shows or hides the tool group as a whole. The manager calls this to
     * implement hover-reveal: hidden at rest, shown while the header is hovered.
     * Uses `display` (not `visibility`) so a hidden group reserves no width and
     * the flex-weighted title fills the row.
     *
     * @param revealed - True to show the tool group, false to hide it.
     *
     * @returns This header, for method chaining.
     */
    setToolsRevealed(revealed: boolean): this {
        this._toolGroup.setDisplayed(revealed);

        return this;
    }

    /**
     * Overrides the chevron's `transform` transition timing so it matches the
     * duration and easing of the owning Accordion's panel-height transition.
     * Called by [`Accordion`](/api/layout/classes/Accordion) from
     * `createSection`; not exposed via {@link AccordionHeaderOptions} since the
     * timing is a wiring detail, not a configuration knob.
     *
     * @param durationMs - Transition duration in milliseconds.
     * @param easing - CSS easing function string.
     *
     * @returns This header, for method chaining.
     */
    setAnimationTiming(durationMs: number, easing: string): this {
        this._indicator?.setAnimationTiming(durationMs, easing);

        return this;
    }
}

const AccordionHeaderCallable = callable(AccordionHeader);
type AccordionHeaderCallable = AccordionHeader;
export {
    AccordionHeader         as _AccordionHeader,
    AccordionHeaderCallable as AccordionHeader
};
