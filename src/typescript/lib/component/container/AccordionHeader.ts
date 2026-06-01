// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button, ButtonOptions } from "~/component/button/Button.js";
import { AccordionIndicator } from "~/component/container/AccordionIndicator.js";
import { Insets } from "~/primitive/Insets.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link AccordionHeader}.
 *
 * @category Components
 */
export interface AccordionHeaderOptions extends ButtonOptions {
    expanded?: boolean;
}

/**
 * A flat header button used by [`Accordion`](/api/layout/classes/Accordion) (from `@jimka/typescript-ui/layout`) to represent a collapsible section.
 *
 * Extends {@link Button} with an {@link AccordionIndicator} Component child,
 * side-loaded onto the button element so it sits outside Button's `Fit`
 * layout. The indicator child handles its own queue-then-flush ordering for
 * the expanded class toggle and the per-instance animation timing.
 *
 * @category Components
 */
class AccordionHeader extends Button<AccordionHeaderOptions> {

    declare private _indicator: AccordionIndicator;

    /**
     * @param label - Text displayed in the header button.
     */
    constructor(label: string, options?: AccordionHeaderOptions) {
        // Left-anchor the label row via Button's own `anchor` option (consumed
        // once when the constructor adds the content row to the outer Fit), so
        // the header text reads left-aligned. An explicit caller `anchor`
        // still wins.
        super(label, { ...options, anchor: options?.anchor ?? AnchorType.WEST });

        this._indicator = new AccordionIndicator();
        this._indicator.setExpanded(this._options.expanded ?? false);

        // Reproduce the former 8px left gap (previously applied to the inner
        // label) by widening the button's own left inset by 8 over its
        // resolved default — keeping the other three sides untouched.
        const insets = this.getInsets();

        this.setInsets(new Insets(insets.getTop(), insets.getRight(), insets.getBottom(), insets.getLeft() + 8));
    }

    /**
     * Applies an {@link AccordionHeaderOptions} bag, dispatching the indicator
     * `expanded` state after inherited Button/Component fields. The indicator
     * child caches the expanded state regardless of when this fires; if the
     * super-cascade dispatch lands before the constructor body builds the
     * child, the value is buffered on `_options.expanded` and applied by the
     * constructor's `setExpanded` flush.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: AccordionHeaderOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as AccordionHeaderOptions;

        if (opts.expanded !== undefined) {
            this.setExpanded(opts.expanded);
        }

        return this;
    }

    /**
     * Appends the indicator child element to the button element after the DOM
     * node is created.
     *
     * @param element - Optional element passed from the framework init chain.
     */
    protected init(element?: HTMLElement): this {
        super.init(element);

        const el = element || this.getElement();

        if (!el) {
            return this;
        }

        el.appendChild(this._indicator.getElement(true)!);

        return this;
    }

    /**
     * Toggles the expanded visual state of the indicator arrow.
     *
     * @param expanded - True to rotate the indicator to the expanded position.
     */
    setExpanded(expanded: boolean): this {
        this._options.expanded = expanded;
        this._indicator?.setExpanded(expanded);

        return this;
    }

    /**
     * Returns whether the indicator is currently in the expanded state.
     *
     * @returns True if expanded.
     */
    isExpanded(): boolean {
        return this._options.expanded ?? false;
    }

    /**
     * Overrides the indicator's `transform` transition timing so it matches
     * the duration and easing of the owning Accordion's panel-height
     * transition. Called by [`Accordion`](/api/layout/classes/Accordion) (from `@jimka/typescript-ui/layout`)
     * from `createSection`; not exposed via {@link AccordionHeaderOptions}
     * since the timing is a wiring detail, not a configuration knob.
     *
     * @param durationMs - Transition duration in milliseconds.
     * @param easing - CSS easing function string.
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
