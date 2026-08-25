// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Button, ButtonOptions } from "~/component/button/Button.js";
import { AccordionIndicator } from "~/component/container/AccordionIndicator.js";
import { HBox } from "~/layout/HBox.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";
import type { AxisEnd } from "~/primitive/Axis.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";

/**
 * Themed-mode CSS values for the accordion theme tokens, with fallbacks
 * mirroring the default light theme. Applied to each header only when the
 * owning Accordion's `themed` option is on, so an un-themed accordion stays
 * chromeless. The header border is a single bottom divider (not a four-side
 * box): stacked headers then read as a flat list whose dividers never
 * double, so no separate `flat`/collapse option is needed — the look is
 * driven entirely by the `accordion.header.border` token. Declared here (not
 * `layout/Accordion.ts`) and exported so this class's own `ownClassStyleDefaults`
 * can share the same constant `Accordion.applySectionTheming` writes
 * imperatively — see plans/implemented/class-hierarchy-cascade.md.
 */
export const THEMED_HEADER_BG:     string = "var(--ts-ui-accordion-header-bg, rgb(243,244,246))";
export const THEMED_HEADER_BORDER: string = "var(--ts-ui-accordion-header-border, 1px solid rgb(214,217,222))";
export const THEMED_HEADER_COLOR:  string = "var(--ts-ui-accordion-header-color, inherit)";

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
 * Resting + pressed + hover defaults for {@link AccordionHeaderTitleButton} —
 * transparent background, no border, no shadow, matching what
 * `chromeless: true` used to compute imperatively. Same shape as
 * `PickerButton`'s own defaults (`component/input/PickerButton.ts`) — see
 * plans/implemented/button-chromeless-followup-dedup.md's Implementation
 * Notes for why the hover pin is needed despite the plan's Architecture
 * Decisions originally concluding otherwise.
 */
const _defaultAccordionHeaderTitleButtonOptions: Partial<ButtonOptions> = {
    backgroundColor:        "transparent",
    backgroundImage:        "none",
    border:                 "none",
    borderRadius:           undefined,
    shadow:                 "none",
    pressedForegroundColor: "var(--ts-ui-text-color, black)",
    pressedBackgroundColor: "transparent",
    pressedBackgroundImage: "none",
    pressedShadow:          "none",
    hoverBackgroundColor:   "transparent",
    hoverBackgroundImage:   "none",
    hoverShadow:            "none",
};

/**
 * The section-label title button built inline by every {@link AccordionHeader}
 * — the clickable toggle target and focusable element. Declares its own
 * resting chrome instead of `chromeless: true`, for the same reason and in
 * the same shape as `PickerButton` (see
 * plans/implemented/button-chromeless-followup-dedup.md). Both the `.pressed`
 * and `:hover` states are pinned to the same resting values, so neither
 * shows any visual change — identical to its previous chromeless behaviour
 * (see that plan's Implementation Notes for why the hover pin is needed).
 * Module-private: built only by `AccordionHeader`'s own constructor.
 */
class AccordionHeaderTitleButton extends Button {
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultAccordionHeaderTitleButtonOptions;

    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".pressed",
            extract: (): StyleBag => ({
                foregroundColor: _defaultAccordionHeaderTitleButtonOptions.pressedForegroundColor,
                backgroundColor: _defaultAccordionHeaderTitleButtonOptions.pressedBackgroundColor,
                backgroundImage: _defaultAccordionHeaderTitleButtonOptions.pressedBackgroundImage,
                shadow:          _defaultAccordionHeaderTitleButtonOptions.pressedShadow,
            }),
        },
        {
            selector: ":hover",
            extract: (): StyleBag => ({
                backgroundColor: _defaultAccordionHeaderTitleButtonOptions.hoverBackgroundColor,
                backgroundImage: _defaultAccordionHeaderTitleButtonOptions.hoverBackgroundImage,
                shadow:          _defaultAccordionHeaderTitleButtonOptions.hoverShadow,
            }),
        },
    ];

    constructor(label: string, glyph?: string, subclassDefaults?: Partial<ButtonOptions>) {
        super(
            label,
            { anchor: AnchorType.WEST, glyph },
            { ..._defaultAccordionHeaderTitleButtonOptions, ...(subclassDefaults ?? {}) },
        );
    }
}

/**
 * Construction-time options for {@link AccordionHeader}.
 *
 * @category Components
 */
export interface AccordionHeaderOptions extends ComponentOptions {
    /** Initial expanded state of the chevron indicator. */
    expanded?:    boolean;
    /** Which end of the header the chevron sits at. Defaults to `"end"`. */
    chevronSide?: AxisEnd;
    /** Optional registry glyph name shown leading the title label. */
    glyph?:       string;
    /** Whether the header uses compact (tighter) padding. Defaults to `false`. */
    compact?:     boolean;
    /** Character drawn as the expand/collapse chevron. Defaults to `"▶"`. */
    chevronGlyph?: string;
}

/**
 * Themed resting chrome every {@link AccordionHeader} shares by default —
 * mirrors what `Accordion.applySectionTheming` writes imperatively on every
 * themed header. Fed to both `ownClassStyleDefaults` and the constructor's
 * `super()` call, mirroring `Cell`/`PickerInput`'s identical shape.
 */
const _defaultAccordionHeaderOptions: Partial<AccordionHeaderOptions> = {
    background:      THEMED_HEADER_BG,
    foregroundColor: THEMED_HEADER_COLOR,
    border:          { border: "none", borderBottom: THEMED_HEADER_BORDER },
};

/**
 * A section header used by [`Accordion`](/api/layout/classes/Accordion) (from `@jimka/typescript-ui/layout`)
 * to represent one collapsible section.
 *
 * The header is a plain styled {@link Component} that lays its children out with
 * an {@link HBox} row, left-to-right:
 *
 * 1. the {@link AccordionIndicator} chevron — **only** when `chevronSide` is `"start"`;
 * 2. the title {@link Button} (the section label, the clickable toggle
 *    target and the focusable element), given a flex `weight` so it spans the
 *    whole clickable region while its label stays left-anchored;
 * 3. the tool group container (an `HBox` row of per-section / re-parented tools);
 * 4. the chevron — **only** when `chevronSide` is `"end"` (the default), so the
 *    chevron sits outermost and tools sit inboard of it.
 *
 * Because the tools are *siblings* of the title button rather than descendants,
 * a click on a tool is simply not a click on the title button — there is nothing
 * to stop from propagating and no marker to maintain.
 *
 * @category Components
 */
class AccordionHeader extends Component<AccordionHeaderOptions> {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. Mirrors what the owning
    // Accordion's applySectionTheming writes imperatively on every themed
    // header; a non-themed accordion clears all three per instance.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultAccordionHeaderOptions;

    declare private _indicator: AccordionIndicator;
    declare private _title:     Button;
    declare private _toolGroup: Component;
    private _tools: Component[] = [];
    private _chevronSide: AxisEnd = "end";

    /**
     * @param label - Text displayed in the header's title button.
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Additional class defaults for a subclass to forward.
     */
    constructor(label: string, options?: AccordionHeaderOptions, subclassDefaults?: Partial<AccordionHeaderOptions>) {
        super(
            { tag: "div", ...options },
            { ..._defaultAccordionHeaderOptions, ...(subclassDefaults ?? {}) },
        );

        // The chevron, title and tool group are independent child Components in
        // an HBox row — one DOM element per class, no side-loaded overlay.
        this._indicator = new AccordionIndicator({ character: options?.chevronGlyph });
        this._title     = new AccordionHeaderTitleButton(label, options?.glyph);
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

        this._chevronSide = options?.chevronSide ?? "end";
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
     * Inserts the chevron cell at the head (when `chevronSide` is `"start"`) or
     * the tail (when `"end"`) of the HBox row, removing it from its current
     * slot first so repeated calls re-position rather than duplicate.
     */
    private placeIndicator(): void {
        if (this.getComponents().includes(this._indicator)) {
            this.removeComponent(this._indicator);
        }

        if (this._chevronSide === "start") {
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
     * @param side - `"start"` or `"end"`.
     *
     * @returns This header, for method chaining.
     */
    setChevronSide(side: AxisEnd): this {
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
     * @returns `"start"` or `"end"`.
     */
    getChevronSide(): AxisEnd {
        return this._chevronSide;
    }

    /**
     * Sets the character drawn as the chevron.
     *
     * @param glyph - The chevron character.
     *
     * @returns This header, for method chaining.
     */
    setChevronGlyph(glyph: string): this {
        this._indicator?.setCharacter(glyph);

        return this;
    }

    /**
     * Adds a tool to this header's tool group (the cell between the title and the
     * trailing chevron). Used both for per-section tools and for the manager's
     * re-parented global tool. A no-op if the tool is already present.
     *
     * A {@link Button} tool is forced into `flat` appearance so header tools read
     * as flat icons regardless of how the caller configured them. Re-applied on
     * every add because `setFlat` is idempotent and a re-parented global tool
     * flows back through here on each header it lands on.
     *
     * @param tool - The tool component to add.
     *
     * @returns This header, for method chaining.
     */
    addTool(tool: Component): this {
        if (tool instanceof Button) {
            tool.setFlat(true);
        }

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
