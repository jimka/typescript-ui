// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link AccordionIndicator}.
 *
 * @category Components
 */
export interface AccordionIndicatorOptions extends ComponentOptions {
    expanded?: boolean;
}

let _classRule: StyleRule | null = null;

/**
 * Registers the shared `.AccordionIndicator` class rule once on first use. The
 * rule holds the overlay geometry (position, right, top, transform,
 * pointer-events, font-size, line-height) plus the chevron colour and the
 * default `transform` transition shared across every indicator.
 *
 * Idempotent and module-local; safe across hot reloads.
 */
function ensureAccordionIndicatorClassRule(): void {
    if (_classRule) {
        return;
    }

    _classRule = new StyleRule({
        scope:  "class",
        name:   "AccordionIndicator",
        styles: {
            position:      "absolute",
            right:         "10px",
            top:           "50%",
            transform:     "translateY(-50%)",
            pointerEvents: "none",
            fontSize:      "10px",
            lineHeight:    "1",
            color:         "var(--ts-ui-accordion-indicator-color, rgb(100,100,100))",
            transition:    "transform 200ms ease",
        },
    });
}

/**
 * The expand/collapse chevron used by {@link AccordionHeader}.
 *
 * Lives as a side-loaded overlay on the host button element (its
 * `position:absolute` plus the host's Fit layout keep it out of the button's
 * content flow). When expanded, a per-instance state rule rotates the chevron
 * 90° via a CSS class toggle on `.expanded`.
 *
 * The static overlay geometry lives in a shared `.AccordionIndicator` class
 * rule registered on first use. The per-instance `.expanded` rotation rule is
 * allocated through `Component.createStyleRule` so the framework
 * materialises it at render time.
 *
 * @category Components
 */
class AccordionIndicator extends Component<AccordionIndicatorOptions> {

    declare private _expanded: boolean;

    /**
     * Constructs an accordion indicator. The chevron starts collapsed unless
     * `options.expanded` is `true`.
     *
     * @param options - Optional configuration bag (initial expanded state plus
     *   common Component fields).
     */
    constructor(options?: AccordionIndicatorOptions) {
        ensureAccordionIndicatorClassRule();

        super({ tag: "span", ...(options ?? {}) });

        this._expanded ??= false;

        const expandedRule = this.createStyleRule(".expanded");
        expandedRule.set("transform", "translateY(-50%) rotate(90deg)");
    }

    /**
     * Applies an {@link AccordionIndicatorOptions} bag. The expanded field is
     * dispatched through {@link setExpanded} so the cached state and class
     * toggle stay in sync; inherited Component fields cascade through
     * `super.applyOptions`.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: AccordionIndicatorOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as AccordionIndicatorOptions;

        if (opts.expanded !== undefined) {
            this.setExpanded(opts.expanded);
        }

        return this;
    }

    /**
     * Renders the root span, writes the chevron glyph as its text content, and
     * applies the cached `.expanded` class when the indicator is in the
     * expanded state at first paint.
     *
     * @returns The rendered root element.
     */
    protected render(): HTMLElement {
        const element = super.render();

        element.textContent = "▶";

        if (this._expanded) {
            element.classList.add("expanded");
        }

        return element;
    }

    /**
     * Returns the cached expanded state.
     *
     * @returns True when the indicator is in the expanded (rotated) state.
     */
    getExpanded(): boolean {
        return this._expanded;
    }

    /**
     * Sets the expanded state of the indicator. Toggles the live `.expanded`
     * class when the element is rendered; otherwise the cached state is
     * applied on first paint by `render`.
     *
     * @param value - True to rotate the chevron to the expanded position.
     * @returns This component, for method chaining.
     */
    setExpanded(value: boolean): this {
        this._expanded = value;

        const element = this.getElement();

        if (element) {
            element.classList.toggle("expanded", value);
        }

        return this;
    }

    /**
     * Clears the expanded state (equivalent to `setExpanded(false)`).
     *
     * @returns This component, for method chaining.
     */
    clearExpanded(): this {
        return this.setExpanded(false);
    }

    /**
     * Overrides the chevron's `transform` transition timing so it matches the
     * duration and easing of the owning Accordion's panel-height transition.
     * Routes through [`Component.setTransition`](/api/core/classes/Component#settransition), which writes to the
     * indicator's own per-instance CSS rule — each instance keeps its own
     * timing without affecting siblings.
     *
     * @param durationMs - Transition duration in milliseconds.
     * @param easing - CSS easing function string.
     * @returns This component, for method chaining.
     */
    setAnimationTiming(durationMs: number, easing: string): this {
        this.setTransition(`transform ${durationMs}ms ${easing}`);

        return this;
    }
}

const AccordionIndicatorCallable = callable(AccordionIndicator);
type AccordionIndicatorCallable = AccordionIndicator;
export {
    AccordionIndicator         as _AccordionIndicator,
    AccordionIndicatorCallable as AccordionIndicator
};
