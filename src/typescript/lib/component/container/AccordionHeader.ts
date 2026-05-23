// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button, ButtonOptions } from "~/component/button/Button.js";
import { CSS } from "~/core/CSS.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Insets } from "~/primitive/Insets.js";
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
 * Extends {@link Button} with a triangular expand/collapse indicator appended as a
 * raw `<span>` inside the button element (analogous to the resize handle in HeaderCell).
 * The indicator rotates 90° when the section is expanded via a CSS class toggle.
 *
 * @category Components
 */
class AccordionHeader extends Button<AccordionHeaderOptions> {

    private static _stylesCreated: boolean = false;

    private _indicatorEl:        HTMLSpanElement | null = null;
    private _animationDurationMs: number | null         = null;
    private _animationEasing:     string | null         = null;

    /**
     * Creates CSS class rules for the indicator once, shared across all instances.
     */
    private static createStyles(): void {
        if (AccordionHeader._stylesCreated) {
            return;
        }

        AccordionHeader._stylesCreated = true;

        const baseRule = new StyleRule(() =>
            (CSS.getClassRule('ts-accordion-indicator')
                ?? CSS.createClassRule('ts-accordion-indicator')) as CSSStyleRule);

        baseRule.setMany({
            position:      'absolute',
            right:         '10px',
            top:           '50%',
            transform:     'translateY(-50%)',
            pointerEvents: 'none',
            fontSize:      '10px',
            lineHeight:    '1',
            color:         'var(--ts-ui-accordion-indicator-color, rgb(100,100,100))',
            transition:    'transform 200ms ease',
        });
        baseRule.ensure();

        const expandedRule = new StyleRule(() =>
            (CSS.getRule('.ts-accordion-indicator.expanded')
                ?? CSS.createRule('.ts-accordion-indicator.expanded')) as CSSStyleRule);

        expandedRule.set('transform', 'translateY(-50%) rotate(90deg)');
        expandedRule.ensure();
    }

    /**
     * @param label - Text displayed in the header button.
     */
    constructor(label: string, options?: AccordionHeaderOptions) {
        // Forward `options` through Button's constructor so the super-time
        // cascade dispatches inherited Component/Button fields plus this
        // class's `expanded` (via `applyOptions` polymorphism). `setExpanded`
        // is guarded on `_indicatorEl`, so it's safe to fire before `init`
        // creates the indicator element.
        super(label, options);

        AccordionHeader.createStyles();

        this.getText().setTextAlign('left');
        this.getText().setInsets(new Insets(0, 0, 0, 8));
    }

    /**
     * Applies an {@link AccordionHeaderOptions} bag, dispatching the indicator
     * `expanded` state after inherited Button/Component fields. The `expanded`
     * setter is guarded on `_indicatorEl`, so a super-time cascade dispatch
     * before `init()` runs is a no-op write to `_options.expanded`; the
     * indicator picks up the value when it appears.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: AccordionHeaderOptions): this {
        super.applyOptions(options);

        if (options.expanded !== undefined) {
            this.setExpanded(options.expanded);
        }

        return this;
    }

    /**
     * Appends the indicator span to the button element after the DOM node is created.
     *
     * @param element - Optional element passed from the framework init chain.
     */
    protected init(element?: HTMLElement): this {
        super.init(element);

        const el = element || this.getElement();

        if (!el) {
            return this;
        }

        this._indicatorEl = document.createElement('span');
        this._indicatorEl.className = 'ts-accordion-indicator';
        this._indicatorEl.textContent = '▶';

        if (this._animationDurationMs !== null && this._animationEasing !== null) {
            this._indicatorEl.style.transition = `transform ${this._animationDurationMs}ms ${this._animationEasing}`;
        }

        el.appendChild(this._indicatorEl);

        return this;
    }

    /**
     * Toggles the expanded visual state of the indicator arrow.
     *
     * @param expanded - True to rotate the indicator to the expanded position.
     */
    setExpanded(expanded: boolean): this {
        this._options.expanded = expanded;

        if (this._indicatorEl) {
            if (expanded) {
                this._indicatorEl.classList.add('expanded');
            } else {
                this._indicatorEl.classList.remove('expanded');
            }
        }

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
     * Overrides the indicator's `transform` transition timing inline so it
     * matches the duration and easing of the owning Accordion's panel-height
     * transition. Called by [`Accordion`](/api/layout/classes/Accordion) (from `@jimka/typescript-ui/layout`)
     * from `createSection`; not exposed via {@link AccordionHeaderOptions} since
     * the timing is a wiring detail, not a configuration knob.
     *
     * @param durationMs - Transition duration in milliseconds.
     * @param easing - CSS easing function string.
     */
    setAnimationTiming(durationMs: number, easing: string): this {
        this._animationDurationMs = durationMs;
        this._animationEasing = easing;

        if (this._indicatorEl) {
            this._indicatorEl.style.transition = `transform ${durationMs}ms ${easing}`;
        }

        return this;
    }
}

const AccordionHeaderCallable = callable(AccordionHeader);
type AccordionHeaderCallable = AccordionHeader;
export {
    AccordionHeader         as _AccordionHeader,
    AccordionHeaderCallable as AccordionHeader
};
