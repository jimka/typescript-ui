// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Panel, PanelOptions } from "~/core/Panel.js";
import { Event } from "~/core/Event.js";
import { HBox } from "~/layout/HBox.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { VBox } from "~/layout/VBox.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Insets } from "~/primitive/Insets.js";
import { RovingTabIndex } from "~/core/RovingTabIndex.js";
import { callable } from "~/core/Callable.js";

/**
 * Layout direction of a {@link ToolBar}. `"horizontal"` packs children
 * left-to-right via [`HBox`](/api/layout/classes/HBox); `"vertical"` packs
 * them top-to-bottom via [`VBox`](/api/layout/classes/VBox).
 *
 * @category Components
 */
export type ToolBarOrientation = "horizontal" | "vertical";

/**
 * Overflow behaviour for a {@link ToolBar} whose children exceed its measured
 * extent. `"clip"` (the v1 default) lets the children spill into the parent's
 * clipping region. `"menu"` is reserved for a follow-up release that will
 * render a trailing affordance opening a dropdown of overflowed children; for
 * now it is accepted and cached but behaves like `"clip"`.
 *
 * @category Components
 */
export type ToolBarOverflow = "clip" | "menu";

/**
 * Construction-time options for {@link ToolBar}.
 *
 * @category Components
 */
export interface ToolBarOptions extends PanelOptions {
    orientation?: ToolBarOrientation;
    compact?:     boolean;
    overflow?:    ToolBarOverflow;
}

/**
 * Default child spacing in pixels — matches the `--ts-ui-toolbar-gap` token.
 * Encoded as a JS literal because `getComputedStyle` returns empty strings for
 * custom properties before the element is in the DOM tree; the literal is the
 * safe construction-time fallback. See `MENU_BAR_BUTTON_HEIGHT` for the
 * same hard-coded-literal pattern.
 */
const TOOLBAR_GAP_DEFAULT: number = 4;

/**
 * Compact-mode child spacing in pixels — children sit flush together.
 */
const TOOLBAR_COMPACT_GAP: number = 0;

/**
 * User-overridable defaults forwarded to `super` via the options bag.
 */
const _defaultToolBarOptions: Partial<ToolBarOptions> = {
    orientation:     "horizontal",
    compact:         false,
    overflow:        "clip",
    backgroundColor: "var(--ts-ui-toolbar-bg, rgb(245, 245, 245))",
};

/**
 * A horizontal (or vertical) strip of related controls — e.g. Bold / Italic
 * / Underline in a text editor, or Cut / Copy / Paste in a file manager.
 *
 * `ToolBar` extends [`Panel`](/api/core/classes/Panel) so it inherits the
 * standard 4-pixel insets. Layout defaults to a horizontal
 * [`HBox`](/api/layout/classes/HBox); pass `orientation: "vertical"` (or call
 * `setOrientation("vertical")`) to swap to a [`VBox`](/api/layout/classes/VBox).
 *
 * Children can be any [`Component`](/api/core/classes/Component) — typically
 * [`Button`](/api/component/button/classes/Button),
 * [`ToggleButton`](/api/component/button/classes/ToggleButton),
 * [`ButtonGroup`](/api/core/classes/ButtonGroup) members,
 * [`ComboBox`](/api/component/input/classes/ComboBox), or {@link ToolBarSeparator}.
 * Focusable children (`tabindex >= 0`) are auto-registered with an internal
 * [`RovingTabIndex`](/api/core/classes/RovingTabIndex) so Arrow keys cycle
 * focus between them, matching the
 * [`ButtonGroup`](/api/core/classes/ButtonGroup) keyboard-nav pattern.
 *
 * @example
 * ```typescript
 * import { ToolBar, ToolBarSeparator } from '@jimka/typescript-ui/component/menubar';
 * import { Button } from '@jimka/typescript-ui/component/button';
 *
 * const bar = new ToolBar();
 * bar.addComponent(new Button('Cut'));
 * bar.addComponent(new Button('Copy'));
 * bar.addComponent(new Button('Paste'));
 * bar.addComponent(new ToolBarSeparator());
 * bar.addComponent(new Button('Find'));
 * ```
 *
 * @category Components
 */
class ToolBar<TOptions extends ToolBarOptions = ToolBarOptions> extends Panel<TOptions> {

    declare private _orientation:  ToolBarOrientation;
    declare private _compact:      boolean;
    declare private _overflowMode: ToolBarOverflow;
    declare private _rovingTabIndex: RovingTabIndex;
    declare private _onKeyDown:    (e: KeyboardEvent) => void;

    /**
     * Constructs a `ToolBar`.
     *
     * @param options - Optional construction-time options.
     */
    constructor(options?: TOptions) {
        super(options, _defaultToolBarOptions as Partial<TOptions>);

        this.getAria().setRole("toolbar");
        this.getAria().setTabIndex(0);

        this._onKeyDown = (e: KeyboardEvent) => {
            const isHoriz = this._orientation === "horizontal";
            const fwd     = isHoriz ? "ArrowRight" : "ArrowDown";
            const back    = isHoriz ? "ArrowLeft"  : "ArrowUp";

            if (e.key === fwd) {
                e.preventDefault();
                this._rovingTabIndex.moveNext();
            } else if (e.key === back) {
                e.preventDefault();
                this._rovingTabIndex.movePrev();
            }
        };

        Event.addSubtreeListener(this, "keydown", this._onKeyDown);
    }

    /**
     * Applies a {@link ToolBarOptions} bag. Inherited `Panel` fields cascade
     * through `super.applyOptions`; the `ToolBar`-specific fields
     * (orientation, compact, overflow) are dispatched here when set.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as TOptions;

        if (opts.orientation !== undefined) this.setOrientation(opts.orientation);
        if (opts.compact     !== undefined) this.setCompact(opts.compact);
        if (opts.overflow    !== undefined) this.setOverflow(opts.overflow);

        return this;
    }

    /**
     * Sets the layout direction. Horizontal toolbars pack children
     * left-to-right via [`HBox`](/api/layout/classes/HBox); vertical toolbars
     * pack them top-to-bottom via [`VBox`](/api/layout/classes/VBox). Child
     * spacing is preserved across the swap; the trailing-edge border flips
     * from bottom to right (or vice versa) to match the new direction.
     *
     * Existing {@link ToolBarSeparator} children are **not** auto-flipped —
     * see the architecture note in the plan.
     *
     * @param value - The new orientation.
     *
     * @returns This component, for method chaining.
     */
    setOrientation(value: ToolBarOrientation): this {
        if (value === this._orientation) {
            return this;
        }

        const oldLM = this.getLayoutManager();
        const gap   = (oldLM instanceof HBox || oldLM instanceof VBox)
            ? oldLM.getComponentSpacing()
            : TOOLBAR_GAP_DEFAULT;

        const newLM: HBox | VBox = value === "horizontal" ? new HBox() : new VBox();
        newLM.setComponentSpacing(gap);
        newLM.setStretching(true);

        this.setLayoutManager(newLM);
        this._orientation = value;

        this.getAria().setOrientation(value);

        const ruleColor = "var(--ts-ui-toolbar-border, rgb(220, 220, 220))";

        if (value === "horizontal") {
            this.setBorder({ bottom: { style: BorderStyle.SOLID, width: 1, color: ruleColor } });
        } else {
            this.setBorder({ right: { style: BorderStyle.SOLID, width: 1, color: ruleColor } });
        }

        return this;
    }

    /**
     * Returns the current orientation.
     *
     * @returns `"horizontal"` or `"vertical"`.
     */
    getOrientation(): ToolBarOrientation {
        return this._orientation;
    }

    /**
     * Toggles compact mode. In compact mode the panel insets shrink from
     * `(4, 4, 4, 4)` to `(2, 2, 2, 2)` and child spacing collapses to `0`.
     *
     * @param value - `true` to enable compact mode, `false` to restore defaults.
     *
     * @returns This component, for method chaining.
     */
    setCompact(value: boolean): this {
        if (value === this._compact) {
            return this;
        }

        this._compact = value;

        const inset = value ? 2 : 4;
        const gap   = value ? TOOLBAR_COMPACT_GAP : TOOLBAR_GAP_DEFAULT;

        this.setInsets(new Insets(inset, inset, inset, inset));

        const lm = this.getLayoutManager();
        if (lm instanceof HBox || lm instanceof VBox) {
            lm.setComponentSpacing(gap);
        }

        this.doLayout();

        return this;
    }

    /**
     * Returns whether compact mode is currently active.
     *
     * @returns `true` if compact mode is enabled.
     */
    isCompact(): boolean {
        return this._compact;
    }

    /**
     * Sets the overflow strategy. v1 supports `"clip"` (children spill into
     * the parent's clipping region) and accepts `"menu"` as a forward-compat
     * placeholder — `"menu"` behaves like `"clip"` until a follow-up plan
     * lands the dropdown affordance.
     *
     * @param value - `"clip"` or `"menu"`.
     *
     * @returns This component, for method chaining.
     */
    setOverflow(value: ToolBarOverflow): this {
        // TODO: menu overflow — render a trailing "more" affordance that opens
        // a dropdown of children that didn't fit. Deferred to a follow-up plan;
        // for now the field is cached and the v1 behaviour is "clip".
        this._overflowMode = value;

        return this;
    }

    /**
     * Returns the current overflow strategy.
     *
     * @returns `"clip"` or `"menu"`.
     */
    getOverflow(): ToolBarOverflow {
        return this._overflowMode;
    }

    /**
     * Appends a child component and, when its tab-index marks it focusable,
     * registers it with the internal roving-tabindex group so Arrow keys
     * cycle focus through it.
     *
     * @param component - The child component to add.
     *
     * @returns This component, for method chaining.
     */
    override addComponent(component: Component, constraints?: LayoutConstraints): this {
        super.addComponent(component, constraints);

        if (this._rovingTabIndex === undefined) {
            this._rovingTabIndex = new RovingTabIndex();
        }

        if (component.getAria().getTabIndex() !== -1) {
            this._rovingTabIndex.add(component);
        }

        return this;
    }
}

const ToolBarCallable = callable(ToolBar);
type ToolBarCallable<TOptions extends ToolBarOptions = ToolBarOptions> = ToolBar<TOptions>;
export {
    ToolBar         as _ToolBar,
    ToolBarCallable as ToolBar
};
