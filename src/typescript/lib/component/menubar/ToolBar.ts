// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button } from "~/component/button/Button.js";
import { Component } from "~/core/Component.js";
import { Container, ContainerOptions } from "~/core/Container.js";
import { Event } from "~/core/Event.js";
import { HBox } from "~/layout/HBox.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { VBox } from "~/layout/VBox.js";
import { Insets } from "~/primitive/Insets.js";
import { RovingTabIndex } from "~/core/RovingTabIndex.js";
import { Menu } from "~/core/Menu.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
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
 * extent. `"clip"` (the default) lets the children spill into the parent's
 * clipping region. `"menu"` hides the `Button` / `ToggleButton` children that
 * don't fit and surfaces them in a dropdown opened by a trailing chevron
 * affordance. Menu overflow is horizontal-only; vertical bars always clip.
 *
 * @category Components
 */
export type ToolBarOverflow = "clip" | "menu";

/**
 * Construction-time options for {@link ToolBar}.
 *
 * @category Components
 */
export interface ToolBarOptions extends ContainerOptions {
    orientation?: ToolBarOrientation;
    compact?:     boolean;
    overflow?:    ToolBarOverflow;
    /**
     * When `true` (the default), `Button` / `ToggleButton` children added to the
     * bar are switched to flat appearance for the classical toolbar look — no
     * resting frame, a light frame on hover, and a sunken inset frame on press.
     * Set `false` to keep raised buttons. Runtime counterpart `setFlat`.
     */
    flat?:        boolean;
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
 * Registry glyph rendered on the overflow ("more") trigger button. Verified
 * present in the solid glyph set (`glyphs/solid/ellipsis_v.ts`); the vertical
 * ellipsis is the conventional overflow affordance for a horizontal bar.
 */
const OVERFLOW_TRIGGER_GLYPH: string = "ellipsis-v";

/**
 * User-overridable defaults forwarded to `super` via the options bag.
 */
const _defaultToolBarOptions: Partial<ToolBarOptions> = {
    orientation:     "horizontal",
    compact:         false,
    overflow:        "clip",
    flat:            true,
    backgroundColor: "var(--ts-ui-toolbar-bg, rgb(245, 245, 245))",
};

/**
 * A horizontal (or vertical) strip of related controls — e.g. Bold / Italic
 * / Underline in a text editor, or Cut / Copy / Paste in a file manager.
 *
 * `ToolBar` extends [`Container`](/api/core/classes/Container) and sets its own
 * resting 4-pixel insets at construction via `setCompact(false)` (compact mode
 * tightens them to 2 pixels). Layout defaults to a horizontal
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
class ToolBar<TOptions extends ToolBarOptions = ToolBarOptions> extends Container<TOptions> {

    declare private _orientation:  ToolBarOrientation;
    declare private _compact:      boolean;
    declare private _overflowMode: ToolBarOverflow;
    declare private _flat:         boolean;
    declare private _rovingTabIndex: RovingTabIndex;
    declare private _onKeyDown:    (e: KeyboardEvent) => void;
    declare private _overflowButton: Button | null;
    declare private _overflowMenu:   Menu | null;

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
     * Applies a {@link ToolBarOptions} bag. Inherited `Container` fields cascade
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
        if (opts.flat        !== undefined) this.setFlat(opts.flat);

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
            this.setBorder({ borderBottom: `1px solid ${ruleColor}` });
        } else {
            this.setBorder({ borderRight: `1px solid ${ruleColor}` });
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
     * Sets the overflow strategy. `"clip"` lets children spill into the parent's
     * clipping region. `"menu"` hides the `Button` / `ToggleButton` children
     * that don't fit and surfaces them in a dropdown opened by a trailing
     * chevron affordance; the trigger and its rebuild-mode
     * [`Menu`](/api/core/classes/Menu) are created lazily on first entry to
     * `"menu"` mode. Menu overflow applies to horizontal bars only — a vertical
     * bar always clips.
     *
     * @param value - `"clip"` or `"menu"`.
     *
     * @returns This component, for method chaining.
     */
    setOverflow(value: ToolBarOverflow): this {
        this._overflowMode = value;

        if (value === "menu" && this._overflowButton === undefined) {
            this._createOverflowAffordance();
        }

        this.doLayout();

        return this;
    }

    /**
     * Lazily builds the overflow trigger — a flat, glyph-only `Button` carrying
     * the chevron glyph — and the rebuild-mode `Menu` it opens. The trigger is
     * appended through `super.addComponent` so it bypasses the flatten-children
     * pass in {@link addComponent} and is excluded from the overflow set by
     * identity. It starts hidden; {@link doLayout} shows it only once at least
     * one button has overflowed.
     */
    private _createOverflowAffordance(): void {
        const trigger = new Button({ flat: true, glyph: OVERFLOW_TRIGGER_GLYPH });

        trigger.setDisplayed(false);
        trigger.getAria().setLabel("More");
        trigger.getAria().setHasPopup("menu");

        trigger.on("action", () => { this._openOverflowMenu(); });

        this._overflowButton = trigger;
        this._overflowMenu   = new Menu();

        super.addComponent(trigger);
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
     * Toggles the classical flat appearance for the bar's `Button` /
     * `ToggleButton` children. When `true` (the default), each such child is
     * switched to flat mode — no resting frame, a light frame on hover, a sunken
     * inset frame on press, and a depressed look for a toggled-on
     * `ToggleButton`. Glyph-only flat buttons also tighten to compact squares.
     * Setting `false` reverts existing button children to raised chrome.
     *
     * Non-`Button` children (separators, combo boxes, spacers) are left
     * untouched. The flag also governs children added later through
     * {@link addComponent}.
     *
     * @param value - `true` to flatten button children, `false` to restore them.
     *
     * @returns This component, for method chaining.
     */
    setFlat(value: boolean): this {
        if (value === this._flat) {
            return this;
        }

        this._flat = value;

        for (const child of this.getComponents()) {
            if (child instanceof Button) {
                child.setFlat(value);
            }
        }

        return this;
    }

    /**
     * Returns whether the bar flattens its `Button` children.
     *
     * @returns `true` if flat mode is enabled.
     */
    isFlat(): boolean {
        return this._flat;
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

        if (this._flat && component instanceof Button) {
            component.setFlat(true);
        }

        return this;
    }

    /**
     * Lays the bar out and, in `"menu"` overflow mode on a horizontal bar,
     * reflows the `Button` / `ToggleButton` children that no longer fit into the
     * trailing chevron dropdown. The base pass runs first so children report
     * their resolved preferred widths; the reflow then re-derives the fit-set
     * from scratch each pass, so widening the bar restores previously-hidden
     * buttons. Vertical bars and `"clip"` mode skip the reflow entirely.
     *
     * @returns This component, for method chaining.
     */
    override doLayout(): this {
        super.doLayout();

        if (this._overflowMode !== "menu" || this._orientation !== "horizontal") {
            return this;
        }

        if (this._overflowButton === undefined || this._overflowButton === null) {
            return this;
        }

        this._reflowOverflow(this._overflowButton);

        return this;
    }

    /**
     * Re-derives which `Button` / `ToggleButton` children overflow the bar's
     * inner width and toggles their `display` accordingly, reserving room for
     * the trigger whenever at least one button is hidden. Only mutates child
     * visibility when the fit-set actually changed, so the
     * `setDisplayed`-triggered re-layout converges instead of thrashing. The
     * trigger itself is shown only while ≥1 button is overflowed and is then
     * positioned for the dropdown anchor.
     *
     * @param trigger - The lazily-created overflow trigger button.
     */
    private _reflowOverflow(trigger: Button): void {
        const insets = this.getInsets();
        const inner  = this.getWidth() - insets.getLeft() - insets.getRight();

        const lm  = this.getLayoutManager();
        const gap = (lm instanceof HBox) ? lm.getComponentSpacing() : TOOLBAR_GAP_DEFAULT;

        const children = this.getComponents().filter(child => child !== trigger);
        const overflowed = this._computeOverflowed(children, trigger, inner, gap);

        let changed = false;

        for (const child of children) {
            const shouldHide = overflowed.includes(child);

            if (child.isDisplayed() === shouldHide) {
                child.setDisplayed(!shouldHide);
                changed = true;
            }
        }

        const wantTrigger = overflowed.length > 0;

        if (trigger.isDisplayed() !== wantTrigger) {
            trigger.setDisplayed(wantTrigger);
            changed = true;
        }

        if (changed) {
            super.doLayout();
        }
    }

    /**
     * Walks the (non-trigger) children left-to-right, accumulating preferred
     * widths plus inter-child gaps, and returns the `Button` / `ToggleButton`
     * children that cross the inner width. When nothing overflows the result is
     * empty; otherwise the trigger's own width is reserved so the chevron has
     * room. Non-`Button` children that don't fit are left in place (clipped) —
     * only buttons have a well-defined menu-row representation.
     *
     * @param children - The bar's children, excluding the trigger.
     * @param trigger - The overflow trigger, measured for its reserved width.
     * @param inner - The bar's inner content width in pixels.
     * @param gap - The inter-child spacing in pixels.
     *
     * @returns The overflowed button children, in document order.
     */
    private _computeOverflowed(children: Component[], trigger: Button, inner: number, gap: number): Component[] {
        const widthOf = (child: Component): number => child.getPreferredSize()?.width ?? 0;

        let total = 0;

        for (let i = 0; i < children.length; i++) {
            total += widthOf(children[i]);

            if (i > 0) {
                total += gap;
            }
        }

        if (total <= inner) {
            return [];
        }

        const reserve   = widthOf(trigger) + gap;
        const available = inner - reserve;

        const overflowed: Component[] = [];

        let used    = 0;
        let crossed = false;

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const next  = used + widthOf(child) + (i > 0 ? gap : 0);

            if (next > available) {
                crossed = true;
            }

            // Once the width crosses the available extent, every following
            // Button overflows so the hidden set stays a contiguous trailing
            // run; non-Button children past the crossover stay put (clipped).
            if (crossed && child instanceof Button) {
                overflowed.push(child);
            } else {
                used = next;
            }
        }

        return overflowed;
    }

    /**
     * Builds one {@link MenuItemConfig} per currently-overflowed button and
     * opens the rebuild-mode dropdown anchored under the trigger. Each row's
     * `action` re-fires the source button's `"click"` (the DOM event behind its
     * `"action"`) so the dropdown drives the original handler.
     */
    private _openOverflowMenu(): void {
        const trigger = this._overflowButton;
        const menu    = this._overflowMenu;

        if (trigger === null || trigger === undefined || menu === null || menu === undefined) {
            return;
        }

        const configs: MenuItemConfig[] = [];

        for (const child of this.getComponents()) {
            if (child === trigger || child.isDisplayed() || !(child instanceof Button)) {
                continue;
            }

            const glyph = child.getGlyph()?.getGlyphName();

            configs.push({
                text:   child.getText(),
                glyph:  glyph,
                action: () => { child.click(); },
            });
        }

        const rect = trigger.getElement()?.getBoundingClientRect();

        if (rect === undefined) {
            return;
        }

        menu.show(rect.left, rect.bottom, configs);
    }
}

const ToolBarCallable = callable(ToolBar);
type ToolBarCallable<TOptions extends ToolBarOptions = ToolBarOptions> = ToolBar<TOptions>;
export {
    ToolBar         as _ToolBar,
    ToolBarCallable as ToolBar
};
