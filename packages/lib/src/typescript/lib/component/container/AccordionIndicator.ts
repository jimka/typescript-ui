// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { StyleRule } from "~/core/StyleTarget.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link AccordionIndicator}.
 *
 * @category Components
 */
export interface AccordionIndicatorOptions extends ComponentOptions {
    expanded?: boolean;
    /** The character drawn as the chevron. Defaults to `"▶"` (a right-pointing triangle). */
    character?: string;
}

/**
 * Width of the chevron's HBox cell, in pixels. Wide enough to seat the chevron
 * glyph plus a little breathing room; the height is governed by the header's
 * stretching HBox, so only the width is fixed here.
 */
const CHEVRON_CELL_WIDTH: number = 14;

/**
 * Default chevron character — a right-pointing triangle that the `.expanded`
 * rule rotates 90° to point down. A single rotating character covers both
 * states, which is why the chevron is a plain character rather than a registry
 * glyph.
 */
const DEFAULT_CHEVRON: string = "▶";

let _classRule: StyleRule | null = null;

/**
 * Registers the shared `.AccordionIndicator` class rule once on first use. The
 * rule holds the chevron's typography (font-size), horizontal centring,
 * colour, and the default `transform` transition. Vertical centring is done by
 * tracking `line-height` to the stretched cell height (see {@link setHeight}),
 * and position is owned by the framework's absolute layout (the indicator is an
 * ordinary in-flow cell, no longer an overlay), so neither lives here.
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
            pointerEvents: "none",
            transition:    "transform 200ms ease",
        },
    });
}

/**
 * Resting-tier typography/colour — `foregroundColor`/`font` are confirmed
 * `StyleBag` fields (`core/ClassStyleRules.ts`), so they hoist onto
 * `ownClassStyleDefaults` instead of the hand-rolled module rule above, which
 * now carries only the two declarations `StyleBag` has no field for
 * (`pointerEvents`, `transition`).
 */
const _defaultAccordionIndicatorStyleDefaults: StyleBag = {
    foregroundColor: "var(--ts-ui-accordion-indicator-color, rgb(100,100,100))",
    font: {
        fontSize:  "10px",
        textAlign: "center",
    },
};

/**
 * The expand/collapse chevron used by {@link AccordionHeader}.
 *
 * An ordinary in-flow cell in the header's HBox row (positioned by the
 * framework's absolute layout like any other Component). When expanded, a
 * per-instance state rule rotates the chevron 90° via a CSS class toggle on
 * `.expanded`.
 *
 * The static typography + centring lives in a shared `.AccordionIndicator`
 * class rule registered on first use. The per-instance `.expanded` rotation
 * rule is allocated through `Component.createStyleRule` so the framework
 * materialises it at render time.
 *
 * @category Components
 */
class AccordionIndicator extends Component<AccordionIndicatorOptions> {

    protected static readonly ownClassStyleDefaults: StyleBag = _defaultAccordionIndicatorStyleDefaults;

    // Declares `.expanded` so `styleLayers()`/`restingGuardSuffix` know about
    // it — see `Button`'s `ownStyleStates` for the full mechanism. Empty
    // extract: the state's only declaration is the `transform` rotation set
    // below, a shorthand no `StyleBag` key covers (mirrors `Button`'s empty
    // `:hover` entry).
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".expanded",
            extract:  (): StyleBag => ({}),
        },
    ];

    declare private _expanded: boolean;
    declare private _character: string;
    private _lineHeight: number | null = null;

    /**
     * Constructs an accordion indicator. The chevron starts collapsed unless
     * `options.expanded` is `true`.
     *
     * @param options - Optional configuration bag (initial expanded state plus
     *   common Component fields).
     */
    constructor(options?: AccordionIndicatorOptions) {
        ensureAccordionIndicatorClassRule();

        super({ tag: "span", preferredSize: { width: CHEVRON_CELL_WIDTH, height: CHEVRON_CELL_WIDTH }, ...(options ?? {}) });

        this._expanded ??= false;
        this._character ??= DEFAULT_CHEVRON;

        const expandedRule = this.createStyleRule(".expanded");
        expandedRule.set("transform", "rotate(90deg)");
    }

    /**
     * Sets the chevron's `line-height`. Vertical centring relies on a single
     * text line whose `line-height` equals the element's height, so
     * {@link setHeight} keeps this in lockstep with the stretched cell height —
     * the same idiom row renderers use to centre a glyph in a sized row.
     *
     * @param px - Line height in pixels.
     *
     * @returns This indicator, for method chaining.
     */
    private setLineHeight(px: number): this {
        if (this._lineHeight === px) {
            return this;
        }

        this._lineHeight = px;
        this.setElementCSSRule("lineHeight", px + "px");

        return this;
    }

    /**
     * Sets the chevron's height and re-syncs `line-height` to it so the single
     * chevron glyph stays vertically centred at whatever height the header's
     * stretching HBox assigns.
     *
     * @param height - Height in pixels.
     *
     * @returns This indicator, for method chaining.
     */
    setHeight(height: number): this {
        super.setHeight(height);
        this.setLineHeight(height);

        return this;
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

        if (options.expanded !== undefined) {
            this.setExpanded(options.expanded);
        }

        if (options.character !== undefined) {
            this.setCharacter(options.character);
        }

        return this;
    }

    /**
     * Returns the chevron character.
     *
     * @returns The current chevron character.
     */
    getCharacter(): string {
        return this._character ?? DEFAULT_CHEVRON;
    }

    /**
     * Sets the chevron character, updating the live text when rendered.
     *
     * @param character - The character to draw as the chevron.
     *
     * @returns This indicator, for method chaining.
     */
    setCharacter(character: string): this {
        this._character = character;

        const element = this.getElement();

        if (element) {
            DOM.sink.apply(element, { text: character });
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
    protected render(): Handle {
        const element = super.render();

        DOM.sink.apply(element, { text: this._character ?? DEFAULT_CHEVRON });

        if (this._expanded) {
            DOM.sink.apply(element, { addClass: ["expanded"] });
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

        // Unconditional, not gated on `this.getElement()`: `setStyleState`
        // updates `_activeStates` regardless of whether an element exists
        // yet (only its own DOM write is internally element-gated) — see
        // `ToggleButton.setSelected`'s own comment for the full reasoning.
        this.setStyleState(".expanded", value);

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
     * Routes through [`Component.setTransition`](/api/core/classes/Component#settransition), which writes the
     * shorthand to the indicator's own inline style — each instance keeps its
     * own timing without affecting siblings.
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
