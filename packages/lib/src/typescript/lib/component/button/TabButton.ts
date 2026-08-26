// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import { ThemeManager } from "~/core/Theme.js";
import { ToggleButton, ToggleButtonOptions } from "~/component/button/ToggleButton.js";
import { TabCloseButton } from "~/component/button/TabCloseButton.js";
import { callable } from "~/core/Callable.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Component, ComponentOptions } from "~/core/Component.js";
import { Animation } from "~/core/Animation.js";
import { BorderOptions } from "~/primitive/Border.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";
import { GLYPH_XS_INK_TRAIT } from "~/core/StyleTraits.js";

/**
 * Construction-time options for {@link TabButton}.
 *
 * `text` (the label), `glyph`, and `selected` are inherited from
 * {@link ToggleButtonOptions}.
 *
 * @category Components
 */
export interface TabButtonOptions extends ToggleButtonOptions {
    /** When true, builds and overlays the close (✕) affordance. Default false. */
    closeable?: boolean;
}

const BUSY_PULSE_KEYFRAME = "ts-ui-tab-busy-pulse";
// Peak alpha of the pulse. Low enough that the label and the identity glyph
// stay legible through the wash on both the light and dark themes.
const BUSY_STATIC_OPACITY = 0.22;

StyleRule.ensureKeyframes(
    BUSY_PULSE_KEYFRAME,
    "0% { opacity: 0.10; } 50% { opacity: 0.30; } 100% { opacity: 0.10; }"
);

let _busyClassRule: StyleRule | null = null;

/**
 * Registers the shared `.TabBusyIndicator` class rule once on first use. It
 * holds only the overlay geometry (absolute fill of the host button, no hit
 * testing); the colour, opacity and animation are per-instance setter writes.
 *
 * Idempotent and module-local; safe across hot reloads.
 */
function ensureBusyIndicatorClassRule(): void {
    if (_busyClassRule) {
        return;
    }

    _busyClassRule = new StyleRule({
        scope: "class",
        name: "TabBusyIndicator",
        styles: {
            position     : "absolute",
            top          : "0",
            right        : "0",
            bottom       : "0",
            left         : "0",
            pointerEvents: "none",
        },
    });
}

const _defaultTabBusyIndicatorOptions: Partial<ComponentOptions> = {
    backgroundColor: "var(--ts-ui-tab-busy-color, var(--ts-ui-tab-indicator-color, #1a73e8))"
};

/**
 * The per-tab loading wash: a translucent accent-coloured overlay filling its
 * host {@link TabButton}, pulsing while the tab's content builds. Raw-appended
 * onto the button's element rather than laid out, so it never changes the tab's
 * size, and left at the default z-index so the overlaid close ✕ stays above it.
 */
class TabBusyIndicator extends Component {

    // Exposes the same bag the constructor already merges into its defaults
    // at the class level, so `ensureClassStyleRule` can hoist `backgroundColor`
    // onto the shared `.TabBusyIndicator` rule instead of every instance
    // writing its own `#id` declaration.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultTabBusyIndicatorOptions;

    constructor(options?: ComponentOptions, subclassDefaults?: Partial<ComponentOptions>) {
        ensureBusyIndicatorClassRule();

        super(options, {
            ..._defaultTabBusyIndicatorOptions,
            ...(subclassDefaults ?? {})
        } as Partial<ComponentOptions>
        );
    }
}

/**
 * User-overridable default fill for the unselected state; a caller-supplied
 * `backgroundColor`/`backgroundImage` wins. Reaches `Button` through
 * `ToggleButton`'s `subclassDefaults` parameter (see `ToggleButton.ts`).
 */
const _defaultTabButtonOptions: Partial<TabButtonOptions> = {
    backgroundColor: "var(--ts-ui-tab-button-bg, #b8b8c3)",
    backgroundImage: "var(--ts-ui-tab-button-bg, #b8b8c3)",
    border: {
        borderTop   : "var(--ts-ui-tab-button-border-top,    var(--ts-ui-tab-button-border, none))",
        borderRight : "var(--ts-ui-tab-button-border-right,  var(--ts-ui-tab-button-border, none))",
        borderBottom: "var(--ts-ui-tab-button-border-bottom, var(--ts-ui-tab-button-border, none))",
        borderLeft  : "var(--ts-ui-tab-button-border-left,   var(--ts-ui-tab-button-border, none))",
    },
    // Explicit `undefined` keys — not omitted — so these two win over Button's
    // own non-empty `_defaultButtonOptions.borderRadius`/`.shadow` in the
    // spread merge at ComponentDefaults.ts's resolveClassDefaults. Omitting
    // the keys would let Button's rounded/shadowed look leak through once the
    // unconditional `clearBorderRadius()`/`clearShadow()` calls below are
    // deleted.
    borderRadius        : undefined,
    shadow              : undefined,
    hoverBackgroundColor: "var(--ts-ui-tab-button-hover-bg, #c4c4cf)",
    hoverBackgroundImage: "var(--ts-ui-tab-button-hover-bg, #c4c4cf)",
    hoverShadow         : "none",
};

const TAB_BUTTON_HOVER_BORDER: BorderOptions = {
    borderTop   : "var(--ts-ui-tab-button-hover-border-top,    var(--ts-ui-tab-button-hover-border, none))",
    borderRight : "var(--ts-ui-tab-button-hover-border-right,  var(--ts-ui-tab-button-hover-border, none))",
    borderBottom: "var(--ts-ui-tab-button-hover-border-bottom, var(--ts-ui-tab-button-hover-border, none))",
    borderLeft  : "var(--ts-ui-tab-button-hover-border-left,   var(--ts-ui-tab-button-hover-border, none))",
};

const TAB_BUTTON_SELECTED_BORDER: BorderOptions = {
    borderTop   : "var(--ts-ui-tab-button-selected-border-top,    var(--ts-ui-tab-button-selected-border, none))",
    borderRight : "var(--ts-ui-tab-button-selected-border-right,  var(--ts-ui-tab-button-selected-border, none))",
    borderBottom: "var(--ts-ui-tab-button-selected-border-bottom, var(--ts-ui-tab-button-selected-border, none))",
    borderLeft  : "var(--ts-ui-tab-button-selected-border-left,   var(--ts-ui-tab-button-selected-border, none))",
};

const TAB_BUTTON_SELECTED_FILL = {
    backgroundColor: "var(--ts-ui-tab-button-selected-bg, rgb(255, 255, 255))",
    backgroundImage: "var(--ts-ui-tab-button-selected-bg, rgb(255, 255, 255))",
    boxShadow      : "none",
} as const;

/**
 * A tab-styled toggle button: a {@link ToggleButton} that paints its own
 * unselected/hover/selected fill from the `--ts-ui-tab-button-*` theme tokens
 * and optionally overlays a close (✕) affordance built from
 * {@link TabCloseButton}.
 *
 * `TabButton` is a [`TabBar`](/api/component/container/classes/TabBar)
 * collaborator, not a general-purpose button. It owns the per-tab styling and
 * close-button *construction* that the strip previously replayed inline for
 * every cell; the strip keeps every geometry concern — insets, writing mode,
 * min/max clamp, and the per-layout re-pin of the overlaid close button (which
 * is positioned via the exposed {@link getCloseButton}). It adds no selection
 * or roving-tab-index logic of its own — those slot through the inherited
 * `ToggleButton` surface.
 *
 * @category Components
 */
class TabButton extends ToggleButton {

    // Opts the resting tier into the hierarchy-aware class cascade — see
    // plans/implemented/class-hierarchy-cascade.md. The same constant this
    // class's constructor forwards as `subclassDefaults`, exposed at the
    // class level so `.TabButton`'s rule carries only its own deviation from
    // `.Button`'s.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultTabButtonOptions;

    // Restates ToggleButton's `.pressed` entry unchanged (own-property-declared,
    // exactly like `ownClassStyleDefaults` — see `resolveStyleStates`'s own
    // comment), declares its own `:hover` entry (tab-specific fill plus
    // border — genuinely different from `Button`'s generic hover, so it can
    // only ever dedupe against `TabButton`'s own class rule, never Button's),
    // and widens `.selected` with `TAB_BUTTON_SELECTED_BORDER` alongside the
    // tab's own white fill. Both `.hover` and `.selected`'s border used to be
    // a deliberate scope cut (see plans/implemented/state-tier-full-unification.md);
    // every value here is a fixed constant with no per-instance variance, so
    // declaring them is safe — see plans/implemented/button-meta-class-dedup.md.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        ToggleButton.ownStyleStates[0],   // .pressed, restated unchanged
        {
            selector: ":hover",
            extract: (): StyleBag => ({
                backgroundColor: _defaultTabButtonOptions.hoverBackgroundColor,
                backgroundImage: _defaultTabButtonOptions.hoverBackgroundImage,
                shadow:          _defaultTabButtonOptions.hoverShadow,
                border:          TAB_BUTTON_HOVER_BORDER,
            }),
        },
        {
            selector: ".selected",
            extract: (): StyleBag => ({
                backgroundColor: TAB_BUTTON_SELECTED_FILL.backgroundColor,
                backgroundImage: TAB_BUTTON_SELECTED_FILL.backgroundImage,
                shadow:          TAB_BUTTON_SELECTED_FILL.boxShadow,
                border:          TAB_BUTTON_SELECTED_BORDER,
            }),
        },
    ];

    // Whether this tab carries a close affordance. Construction-time only (the
    // close button is built or not when the tab is created), so it is set once
    // in the constructor and never via an option-dispatched setter — hence a
    // plain field rather than a `declare`d cascade-written one.
    private _closeable: boolean = false;

    // The overlaid close button, or null when the tab is not closeable. Built
    // in the constructor and raw-appended onto this button's own element (the
    // standard overlay pattern); TabBar reads it to wire its "action" and to
    // position/re-pin it each layout.
    private _closeButton: TabCloseButton | null = null;

    // Whether this tab is marked busy. Runtime state (a load starts and ends), not
    // configuration, so it carries no options-bag field.
    private _busy: boolean = false;

    // The busy wash, built on the first setBusy(true) and reused thereafter.
    private _busyIndicator: TabBusyIndicator | null = null;

    /**
     * Builds a tab-styled toggle button with the given label, applying the
     * `--ts-ui-tab-button-*` fill/border/hover/selected styling and, when
     * `closeable` is set, building and overlaying the close affordance.
     *
     * @param text - The visible label for the tab.
     * @param options - Tab button options; `closeable` gates the close button.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(text: string, options?: TabButtonOptions, subclassDefaults?: Partial<TabButtonOptions>) {
        // ToggleButton (via Button) builds its inner text/HBox content row in
        // its constructor body, so forward the positional `text` to super,
        // ... (options still isn't forwarded, only the defaults bag is); the
        // styling setters below then fire on a fully-built button.
        super(text, undefined, { ..._defaultTabButtonOptions, ...(subclassDefaults ?? {}) });

        this._closeable = options?.closeable ?? false;

        if (options) {
            this.applyOptions(options);
        }

        // Paint the tab styling AFTER applyOptions, not before: the cascade
        // re-applies Button's chrome defaults from _defaultButtonOptions (the
        // "2px ridge" border, the 4px border-radius, the button drop-shadow), so
        // tab styling applied earlier would be clobbered back to a rounded,
        // ridged, shadowed button. Running it last lets the flat tab tokens and
        // the cleared radius/shadow win — matching the legacy createBarEntry,
        // which styled a no-options ToggleButton with nothing applied afterward.
        this.applyTabStyling(options);

        // Button's constructor late-dispatches `setGlyph` from the options bag
        // once, before this subclass's `applyOptions` runs; a glyph passed to a
        // ToggleButton subclass is therefore only pure-written to `_options` and
        // never rendered. Dispatch it explicitly here, mirroring how TabBar
        // called `setGlyph(constraints.glyph)` after construction.
        if (options?.glyph !== undefined) {
            this.setGlyph(options.glyph);
        }

        if (this._closeable) {
            this.buildCloseButton();
        }

        // ToggleButton's constructor wired the listener bag from the options it
        // received — but `super(text, ...)` above passed none, so it wired nothing.
        // Wire the bag here, as the leaf, after super() and applyOptions, so a
        // `new TabButton(name, { listeners: { action } })` is not silently
        // dropped (ARCHITECTURE.md, Event handling).
        this.applyListeners(options?.listeners);
    }

    /**
     * Disposes the overlaid close button and busy indicator, then runs the
     * inherited teardown. Both are raw-appended onto this button's own element
     * rather than registered via `addComponent` (see `buildCloseButton`'s doc
     * comment), so `super.destructor()`'s child recursion cannot reach them.
     */
    protected destructor(): void {
        this._closeButton?.dispose();
        this._busyIndicator?.dispose();

        super.destructor();
    }

    /**
     * Paints the tab's selected states from the `--ts-ui-tab-button-*` theme
     * tokens. Runs after `applyOptions()` so these overrides win over
     * `Button`'s inherited chrome defaults — see the call site's comment.
     *
     * The resting fill, border, radius, shadow, and the three hover
     * colour/shadow fields all resolve from `_defaultTabButtonOptions` (top of
     * this file), which layers through `ToggleButton`'s `subclassDefaults`
     * forwarding — `Button`'s own chrome dispatch folds each of those
     * correctly, so nothing needs reasserting here. Only `hoverBorder` is
     * reasserted below: `getHoverBorder()` has no `_defaultOptions` fold (it
     * returns a private field), so a bag entry for it would be dead data.
     *
     * @param options - The options this `TabButton` was constructed with, so
     *   the hover-border fold below still reads an explicit caller value.
     */
    private applyTabStyling(options?: TabButtonOptions): void {
        this.setHoverBorder(options?.hoverBorder ?? TAB_BUTTON_HOVER_BORDER);

        // Selected (active) state fill/shadow/border now all come from this
        // class's own `ownStyleStates` entry (see above); this call is left
        // in place as the caller-override seam a default-styled instance's
        // call now dedupes against, exactly like `.pressed`'s fields already do.
        this.setSelectedBorder(TAB_BUTTON_SELECTED_BORDER);
    }

    /**
     * Builds the close (✕) affordance and overlays its element on this button's
     * own element. Transparent so the tab's background shows through, with a
     * faint rounded hover tint giving the ✕ its affordance. The ✕ is overlaid
     * (raw-appended) rather than enrolled in a layout so it floats at the corner
     * of the tab; TabBar pins its precise position each layout.
     */
    private buildCloseButton(): void {
        const closeButton = new TabCloseButton();

        // The flattened resting/hover chrome (transparent, borderless, faint
        // rounded hover tint) comes from TabCloseButton's own class defaults
        // now, not an imperative re-assert here — see TabCloseButton.ts's
        // `_defaultTabCloseButtonOptions`.
        closeButton.setZIndex(1);

        // Shrink the ✕ glyph to roughly half the close-button hit box, centred —
        // the button stays the click target while the mark reads lighter. Pin it
        // (Glyph.setPreferredSize locks min/max too) so the line-height sync
        // never re-tracks the glyph to the title line height; TabBar's
        // per-layout re-pin keeps it at the base-scaled size.
        // Size the box here, not only in TabBar's per-layout pass. The ✕ is
        // raw-appended rather than enrolled in a layout, so nothing else gives
        // it a width until that pass runs — and a Button whose own width is
        // still unresolved centres its content at 0,0 and keeps it there, which
        // is what left the ✕ jammed into the corner on every tab that existed
        // at the strip's first layout.
        const closeScale = ThemeManager.getResolvedScale();

        closeButton.setWidth(closeScale.tabClose);
        closeButton.setHeight(closeScale.tabClose);
        closeButton.pinGlyphSize(closeScale.glyphXs);
        closeButton.getGlyph()?.setStyleTrait(GLYPH_XS_INK_TRAIT);

        // Overlay it on this button's own element rather than enrolling it in a
        // layout (which would stretch it over the whole tab); TabBar pins it to
        // the right edge each layout.
        DOM.sink.appendChild(this.getElement(true)!, closeButton.getElement(true)!);

        this._closeButton = closeButton;
    }

    /**
     * Returns the overlaid close button, or `null` when this tab is not
     * closeable. TabBar wires its `"action"` event and positions/re-pins it on
     * each layout pass.
     *
     * @returns The close button, or `null`.
     */
    getCloseButton(): TabCloseButton | null {
        return this._closeButton;
    }

    /**
     * Returns whether this tab carries a close affordance. Construction-time
     * only — there is no runtime toggle.
     *
     * @returns True when the tab was built closeable.
     */
    isCloseable(): boolean {
        return this._closeable;
    }

    /**
     * Shows or hides the busy overlay — a translucent pulsing wash over the
     * whole button that marks this tab's content as still loading. Displaces
     * nothing: the label, the glyph and the close affordance are unchanged and
     * the button does not resize. Honours `prefers-reduced-motion` by painting
     * a static wash instead of a pulse.
     *
     * @param busy - True to show the overlay, false to hide it.
     *
     * @returns This button, for method chaining.
     */
    setBusy(busy: boolean): this {
        if (this._busy === busy) {
            return this;
        }

        this._busy = busy;

        if (!busy) {
            // Drop the animation as well as the visibility: a hidden element with a
            // live infinite keyframe keeps the compositor working for nothing.
            this._busyIndicator?.clearAnimation();
            this._busyIndicator?.setVisible(false);

            return this;
        }

        if (!this._busyIndicator) {
            this._busyIndicator = new TabBusyIndicator();

            // Overlay it on this button's own element, the same way the close
            // affordance is mounted; a laid-out child would resize the tab.
            DOM.sink.appendChild(this.getElement(true)!, this._busyIndicator.getElement(true)!);
        }

        this._busyIndicator.setVisible(true);

        if (Animation.isReducedMotion()) {
            this._busyIndicator.clearAnimation();
            this._busyIndicator.setOpacity(BUSY_STATIC_OPACITY);
        } else {
            this._busyIndicator.setAnimation(`${BUSY_PULSE_KEYFRAME} 1.2s ease-in-out infinite`);
        }

        return this;
    }

    /**
     * Reports whether the busy overlay is currently shown.
     *
     * @returns True when this tab is marked busy.
     */
    isBusy(): boolean {
        return this._busy;
    }
}

const TabButtonCallable = callable(TabButton);
type TabButtonCallable = TabButton;
export {
    TabButton         as _TabButton,
    TabButtonCallable as TabButton
};
