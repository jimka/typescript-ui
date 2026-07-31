// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button } from "~/component/button/Button.js";
import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { Container, ContainerOptions } from "~/core/Container.js";
import { Event } from "~/core/Event.js";
import { HBox } from "~/layout/HBox.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { VBox } from "~/layout/VBox.js";
import { Insets } from "~/primitive/Insets.js";
import { RovingTabIndex } from "~/core/RovingTabIndex.js";
import { Menu } from "~/overlay/Menu.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { Spacer } from "~/component/container/Spacer.js";
import { Glyph } from "~/component/display/Glyph.js";
import { ellipsis_v } from "~/glyphs/solid/ellipsis_v.js";
import { callable } from "~/core/Callable.js";
import type { AxisOrientation, AxisEnd } from "~/primitive/Axis.js";

// Register the overflow trigger's chevron eagerly at module load — same pattern
// as SplitButton registering its caret_down — so the lazily-created "more"
// affordance always resolves its glyph without the consumer pre-registering it.
Glyph.register(ellipsis_v);

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
    orientation?: AxisOrientation;
    compact?:     boolean;
    overflow?:    ToolBarOverflow;
    /**
     * Edge the `"menu"` overflow trigger sits on — `"end"` (default) or
     * `"start"`. No visible effect unless `overflow` is `"menu"`. Runtime
     * counterpart `setOverflowSide`.
     */
    overflowSide?: AxisEnd;
    /**
     * When `true` (the default), `Button` / `ToggleButton` children added to the
     * bar are switched to flat appearance for the classical toolbar look — no
     * resting frame, a light frame on hover, and a sunken inset frame on press.
     * Set `false` to keep raised buttons. Runtime counterpart `setFlat`.
     */
    flat?:        boolean;
}

/**
 * Fallback inter-child spacing in pixels for the overflow reserve math only.
 * `_computeOverflowed` reserves a gap between children when measuring the
 * fit-set; it reads the live `getComponentSpacing()` and falls back to this
 * constant only when the layout manager isn't an `HBox`. The bar no longer
 * drives any gap itself (spacing defaults to 0), so this is purely the typed
 * fallback that keeps the overflow arithmetic well-defined.
 */
const TOOLBAR_GAP_DEFAULT: number = 4;

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
    compact:         true,
    overflow:        "clip",
    overflowSide:    "end",
    flat:            true,
    backgroundColor: "var(--ts-ui-toolbar-bg, rgb(245, 245, 245))",
};

/**
 * A horizontal (or vertical) strip of related controls — e.g. Bold / Italic
 * / Underline in a text editor, or Cut / Copy / Paste in a file manager.
 *
 * `ToolBar` extends [`Container`](/api/core/classes/Container) and defaults to
 * compact mode (`compact: true`), so at construction it drops its own panel
 * insets to zero and renders its `Button` / `ToggleButton` children compact;
 * `setCompact(false)` restores the 4-pixel panel insets and the children's
 * default rendering. Layout defaults to a horizontal
 * [`HBox`](/api/layout/classes/HBox); pass `orientation: "vertical"` (or call
 * `setOrientation("vertical")`) to swap to a [`VBox`](/api/layout/classes/VBox).
 *
 * Children can be any [`Component`](/api/core/classes/Component) — typically
 * [`Button`](/api/component/button/classes/Button),
 * [`ToggleButton`](/api/component/button/classes/ToggleButton),
 * [`ButtonGroup`](/api/overlay/classes/ButtonGroup) members,
 * [`ComboBox`](/api/component/input/classes/ComboBox), or {@link ToolBarSeparator}.
 * Focusable children (`tabindex >= 0`) are auto-registered with an internal
 * [`RovingTabIndex`](/api/core/classes/RovingTabIndex) so Arrow keys cycle
 * focus between them, matching the
 * [`ButtonGroup`](/api/overlay/classes/ButtonGroup) keyboard-nav pattern.
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

    declare private _orientation:  AxisOrientation;
    declare private _compact:      boolean;
    declare private _overflowMode: ToolBarOverflow;
    declare private _overflowSide: AxisEnd;
    declare private _flat:         boolean;
    declare private _rovingTabIndex: RovingTabIndex;
    declare private _onKeyDown:    (e: KeyboardEvent) => void;
    declare private _overflowButton: Button | null;
    declare private _overflowMenu:   Menu | null;
    declare private _overflowSpacer: Spacer | null;

    /**
     * Constructs a `ToolBar`.
     *
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     *
     * @remarks The parameter is typed as the concrete {@link ToolBarOptions}
     * rather than the class's `TOptions` parameter so that passing an options
     * literal (e.g. `new ToolBar({ compact: true })`) cannot narrow `TOptions`
     * to that literal — which would type the instance as `ToolBar<{ compact:
     * true }>` and fail the weak-type assignability check when it is later used
     * as a base `Component` (e.g. `container.addComponent(toolbar)`). `TOptions`
     * stays at its `ToolBarOptions` default.
     */
    constructor(options?: ToolBarOptions, subclassDefaults?: Partial<ToolBarOptions>);
    constructor(options?: ToolBarOptions, subclassDefaults?: Partial<TOptions>) {
        super(
            options as TOptions,
            { ..._defaultToolBarOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
        );

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

        // These fields all carry a class default and seed construction-time
        // backing state, so dispatch the caller value or the class default —
        // never leave the setter unfired (mirrors Panel.setAutoScroll).
        this.setOrientation(options.orientation ?? this.getOrientation());
        this.setCompact(options.compact ?? this.isCompact());
        // Dispatched before `overflow` so the trigger, created on entry to
        // `"menu"` mode, is positioned on the configured side from the start.
        this.setOverflowSide(options.overflowSide ?? this.getOverflowSide());
        this.setOverflow(options.overflow ?? this.getOverflow());
        this.setFlat(options.flat ?? this.isFlat());

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
    setOrientation(value: AxisOrientation): this {
        if (value === this._orientation) {
            return this;
        }

        const oldLM = this.getLayoutManager();
        // Default to flush (0) — the bar no longer drives a gap; child density
        // comes from the buttons' own compact insets. A consumer-set spacing on
        // an existing HBox/VBox is preserved across the orientation swap.
        const gap   = (oldLM instanceof HBox || oldLM instanceof VBox)
            ? oldLM.getComponentSpacing()
            : 0;

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
    getOrientation(): AxisOrientation {
        return this._orientation ?? this._defaultOptions.orientation!;
    }

    /**
     * Toggles compact mode. In compact mode the bar's own panel insets shrink
     * from `(4, 4, 4, 4)` to `(0, 0, 0, 0)` and every `Button` / `ToggleButton`
     * child is switched to compact rendering (tighter button insets), the same
     * way {@link setFlat} drives the flat appearance onto its button children.
     * Child spacing is left untouched — the bar packs its children flush and the
     * density comes from the buttons themselves.
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

        // Compact packs flush to its edges (zero inset) so a toolbar sits tight
        // against the surrounding chrome; the density between children still
        // comes from the buttons' own compact insets. Non-compact restores the
        // roomy 4px panel insets.
        const inset = value ? 0 : 4;

        this.setInsets(new Insets(inset, inset, inset, inset));

        for (const child of this.getComponents()) {
            if (child instanceof Button) {
                child.setCompact(value);
            }
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
        return this._compact ?? this._defaultOptions.compact!;
    }

    /**
     * Sets the overflow strategy. `"clip"` lets children spill into the parent's
     * clipping region. `"menu"` hides the `Button` / `ToggleButton` children
     * that don't fit and surfaces them in a dropdown opened by a trailing
     * chevron affordance; the trigger and its rebuild-mode
     * [`Menu`](/api/overlay/classes/Menu) are created lazily on first entry to
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

        trigger.on("action", () => { this._toggleOverflowMenu(); });

        this._overflowButton = trigger;
        this._overflowMenu   = new Menu();
        // Flex spacer that pushes a right-side trigger to the bar's far edge; it
        // is only parented while the side is `"right"` (see _positionOverflowTrigger).
        this._overflowSpacer = Spacer.flex();

        super.addComponent(trigger);

        this._positionOverflowTrigger();
    }

    /**
     * Pins the overflow trigger to the configured edge. For `"end"` a flex
     * {@link Spacer} is parented just before the trigger so the chevron is
     * driven to the bar's trailing edge (rather than sitting flush against the
     * last visible button); the final child order is `[content…, spacer, trigger]`.
     * For `"start"` the spacer is detached and the trigger leads as the first
     * child. A no-op when no trigger exists yet. Re-run whenever content is added
     * (the trigger must stay at the edge) or the side changes; the trailing run
     * of buttons still overflows regardless of the trigger's side.
     */
    private _positionOverflowTrigger(): void {
        const trigger = this._overflowButton;
        const spacer  = this._overflowSpacer;
        if (trigger === undefined || trigger === null || spacer === undefined || spacer === null) {
            return;
        }

        if (this._overflowSide === "end") {
            if (spacer.getParentComponent() !== this) {
                super.addComponent(spacer);
            }

            // Order the tail as [spacer, trigger]: move the trigger last, then
            // slot the spacer immediately before it. `moveComponent` recomputes
            // the index after splicing the moved child out, so the pre-move
            // length-relative targets land both at the end.
            this.moveComponent(trigger, this.getComponents().length - 1);
            this.moveComponent(spacer,  this.getComponents().length - 2);
        } else {
            if (spacer.getParentComponent() === this) {
                this.removeComponent(spacer);
            }

            this.moveComponent(trigger, 0);
        }
    }

    /**
     * Returns the current overflow strategy.
     *
     * @returns `"clip"` or `"menu"`.
     */
    getOverflow(): ToolBarOverflow {
        return this._overflowMode ?? this._defaultOptions.overflow!;
    }

    /**
     * Sets which edge the `"menu"` overflow trigger sits on. `"end"` (the
     * default) trails the visible buttons; `"start"` leads them. Only the
     * trigger's position changes — the overflowing buttons are the trailing run
     * either way. No visible effect until `overflow` is `"menu"`.
     *
     * @param value - `"start"` or `"end"`.
     *
     * @returns This component, for method chaining.
     */
    setOverflowSide(value: AxisEnd): this {
        if (value === this._overflowSide) {
            return this;
        }

        this._overflowSide = value;

        this._positionOverflowTrigger();
        this.doLayout();

        return this;
    }

    /**
     * Returns the edge the overflow trigger sits on.
     *
     * @returns `"start"` or `"end"`.
     */
    getOverflowSide(): AxisEnd {
        return this._overflowSide ?? this._defaultOptions.overflowSide!;
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
        return this._flat ?? this._defaultOptions.flat!;
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

        if (this._compact && component instanceof Button) {
            component.setCompact(true);
        }

        // Keep the overflow trigger pinned to its edge: a content child appended
        // after the trigger (the trigger is created before the demo's buttons
        // for a construction-time `overflow: "menu"`) would otherwise leave the
        // chevron stranded mid-row. No-op when no trigger exists.
        this._positionOverflowTrigger();

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

        const children = this.getComponents().filter(child => child !== trigger && child !== this._overflowSpacer);
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
     * toggles the rebuild-mode dropdown anchored under the trigger — opening it,
     * or closing it when the trigger is pressed again. Each row's `action`
     * re-fires the source button's `"click"` (the DOM event behind its
     * `"action"`) so the dropdown drives the original handler.
     */
    private _toggleOverflowMenu(): void {
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

        const triggerEl = trigger.getElement();

        if (!triggerEl) {
            return;
        }

        const rect = DOM.source.getViewportRect(trigger);

        // toggleFor excludes the trigger from the menu's outside-click dismissal
        // and remembers it, so re-pressing the overflow button closes the menu
        // instead of the close-then-reopen flash a bare show() would produce.
        menu.toggleFor(triggerEl, rect, configs);
    }
}

const ToolBarCallable = callable(ToolBar);
type ToolBarCallable<TOptions extends ToolBarOptions = ToolBarOptions> = ToolBar<TOptions>;
export {
    ToolBar         as _ToolBar,
    ToolBarCallable as ToolBar
};
