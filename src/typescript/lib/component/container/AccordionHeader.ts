// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button, ButtonOptions } from "~/component/button/Button.js";
import { CSS } from "~/core/CSS.js";
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
 * A flat header button used by `Accordion` (from `@jimka/typescript-ui/layout`) to represent a collapsible section.
 *
 * Extends {@link Button} with a triangular expand/collapse indicator appended as a
 * raw `<span>` inside the button element (analogous to the resize handle in HeaderCell).
 * The indicator rotates 90° when the section is expanded via a CSS class toggle.
 *
 * @category Components
 */
class AccordionHeader extends Button {

    private static _stylesCreated: boolean = false;

    private _expanded: boolean = false;
    private _indicatorEl: HTMLSpanElement | null = null;

    /**
     * Creates CSS class rules for the indicator once, shared across all instances.
     */
    private static createStyles(): void {
        if (AccordionHeader._stylesCreated) {
            return;
        }

        AccordionHeader._stylesCreated = true;

        const baseRule = CSS.createClassRule('ts-accordion-indicator');

        if (baseRule) {
            baseRule.style.setProperty('position', 'absolute');
            baseRule.style.setProperty('right', '10px');
            baseRule.style.setProperty('top', '50%');
            baseRule.style.setProperty('transform', 'translateY(-50%)');
            baseRule.style.setProperty('pointer-events', 'none');
            baseRule.style.setProperty('font-size', '10px');
            baseRule.style.setProperty('line-height', '1');
            baseRule.style.setProperty('color', 'var(--ts-ui-accordion-indicator-color, rgb(100,100,100))');
            baseRule.style.setProperty('transition', 'transform 200ms ease');
        }

        const expandedRule = CSS.createRule('.ts-accordion-indicator.expanded');

        if (expandedRule) {
            expandedRule.style.setProperty('transform', 'translateY(-50%) rotate(90deg)');
        }
    }

    /**
     * @param label - Text displayed in the header button.
     */
    constructor(label: string, options?: AccordionHeaderOptions) {
        super(label);

        AccordionHeader.createStyles();

        this.getText().setTextAlign('left');
        this.getText().setInsets(new Insets(0, 0, 0, 8));

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies an {@link AccordionHeaderOptions} bag, dispatching the indicator
     * `expanded` state after inherited Button/Component fields.
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

        el.appendChild(this._indicatorEl);

        return this;
    }

    /**
     * Toggles the expanded visual state of the indicator arrow.
     *
     * @param expanded - True to rotate the indicator to the expanded position.
     */
    setExpanded(expanded: boolean): this {
        this._expanded = expanded;

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
        return this._expanded;
    }
}

const AccordionHeaderCallable = callable(AccordionHeader);
type AccordionHeaderCallable = AccordionHeader;
export {
    AccordionHeader         as _AccordionHeader,
    AccordionHeaderCallable as AccordionHeader
};
