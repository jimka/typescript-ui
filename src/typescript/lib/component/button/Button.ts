// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Fit } from "~/layout/Fit.js";
import { HBox } from "~/layout/HBox.js";
import { Text } from "~/component/input/Text.js";
import { Glyph } from "~/component/display/Glyph.js";
import { FillType } from "~/layout/FillType.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Border, BorderOptions } from "~/primitive/Border.js";
import { Insets } from "~/primitive/Insets.js";
import { ThemeManager } from "~/core/Theme.js";
import { callable } from "~/core/Callable.js";

/**
 * String-literal union of the events emitted by {@link Button}. A typed
 * shorthand over [`Event.addListener`](/api/core/classes/Component) /
 * [`Event.removeListener`](/api/core/classes/Component) — Button does not
 * own a [`ListenerBag`](/api/core/classes/ListenerBag); the DOM `"click"`
 * event is dispatched through the framework's window-level capture handler.
 *
 * @category Components
 */
export type ButtonEvent = "click";

/**
 * The handler shape consumers register for the `"click"` button event.
 *
 * @category Components
 */
export type ClickListener = (event: MouseEvent) => void;

/**
 * Construction-time options for {@link Button}.
 *
 * @category Components
 */
export interface ButtonOptions extends ComponentOptions {
    text?:                   string;
    glyph?:                  string;
    enabled?:                boolean;
    pressedBackgroundColor?: string;
    pressedBackgroundImage?: string;
    pressedForegroundColor?: string;
    pressedBorder?:          BorderOptions;
    pressedBorderRadius?:    string;
    pressedShadow?:          string;
    hoverBackgroundColor?:   string;
    hoverBackgroundImage?:   string;
    hoverForegroundColor?:   string;
    hoverBorder?:            BorderOptions;
    hoverBorderRadius?:      string;
    hoverShadow?:            string;

    /**
     * Suppresses the framework's visual-chrome defaults — `border`,
     * `borderRadius`, `shadow`, `backgroundImage`, the twelve `pressedX` /
     * `hoverX` fields, and the UA `<button>` background. Use for buttons
     * that want only the cursor, color, and inset behaviour of `Button`
     * without the ridge border, drop shadow, and gradient background.
     * Runtime-toggle counterpart is `setChromeless`; read with
     * `isChromeless`. Used by [`PickerButton`](/api/component/input/classes/PickerButton)
     * and [`MenuBarButton`](/api/component/menubar/classes/MenuBarButton).
     *
     * `applyOptions({ chromeless: true })` on a previously-chromeful button
     * writes the flag pure into `_options` and gates future chrome
     * dispatches, but does not clear the chrome already on the element —
     * callers wanting a runtime flip should call `setChromeless(true)`
     * directly.
     */
    chromeless?:             boolean;

    /**
     * Anchor for the inner content row (glyph + label) within Button's outer
     * `Fit` layout. Defaults to {@link AnchorType.CENTER}. Pass
     * {@link AnchorType.WEST} for left-anchored menubar-style buttons.
     */
    anchor?:                 AnchorType;

    /**
     * Fill mode for the inner content row within Button's outer `Fit`
     * layout. Defaults to {@link FillType.NONE} (content sits at preferred
     * size, anchor decides displacement). `BOTH` stretches it to fill.
     */
    fill?:                   FillType;
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins. Includes the
 * `pressedX` and `hoverX` defaults because both `pressedStyleRule` and
 * `hoverStyleRule` are lazy getters — those setters are safe to fire during
 * the super cascade and queue their writes until the rule materialises.
 */
const _defaultButtonOptions: Partial<ButtonOptions> = {
    tag:                    "button",
    cursor:                 "pointer",
    foregroundColor:        "var(--ts-ui-text-color, black)",
    border:                 { style: BorderStyle.RIDGE, width: 2, color: "var(--ts-ui-button-border, rgb(200, 200, 200))" },
    borderRadius:           "var(--ts-ui-border-radius, 4px)",
    shadow:                 "var(--ts-ui-button-shadow, 1px 2px 5px 0 rgba(0, 0, 0, 0.2))",
    backgroundImage:        "var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))",
    insets:                 new Insets(4, 4, 4, 4),
    anchor:                 AnchorType.CENTER,
    fill:                   FillType.NONE,
    pressedForegroundColor: "var(--ts-ui-button-pressed-fg, rgb(150, 150, 150))",
    pressedBackgroundColor: "var(--ts-ui-button-pressed-bg, rgb(200, 200, 200))",
    pressedBackgroundImage: "var(--ts-ui-button-pressed-bg, none)",
    pressedShadow:          "var(--ts-ui-button-pressed-shadow, 1px 2px 5px 0 rgba(0, 0, 0, 0.2) inset)",
    hoverBackgroundColor:   "var(--ts-ui-button-hover-bg, rgb(252, 252, 252))",
    hoverBackgroundImage:   "var(--ts-ui-button-hover-bg, none)",
    hoverShadow:            "var(--ts-ui-button-hover-shadow, 1px 3px 6px 0 rgba(0, 0, 0, 0.25))",
};

/**
 * A push button component with a text label and configurable pressed-state appearance.
 *
 * Maintains separate CSS rules for the normal and `:active` states, allowing
 * independent control of border, shadow, background, and foreground color when pressed.
 *
 * @example
 * ```typescript
 * import { Event } from '@jimka/typescript-ui/core';
 * import { Button } from '@jimka/typescript-ui/component/button';
 *
 * const button = new Button('Save');
 * Event.addListener(button, 'click', () => save());
 * panel.addComponent(button);
 * ```
 *
 * @category Components
 */
class Button<TOptions extends ButtonOptions = ButtonOptions> extends Component<TOptions> {

    private _text!:    Text;
    /**
     * The button's content-row container. Holds the optional leading
     * [`Glyph`](/api/component/display/classes/Glyph) plus the `_text` label,
     * laid out by an `HBox`. Exposed as `protected` so subclasses can
     * re-anchor (`removeComponent` + `addComponent`) or rebuild the row
     * without having to opt into `customLayout: true`. Treat as part of the
     * subclass contract — future restructuring of Button's content row
     * needs to keep this field's identity and shape stable.
     */
    protected _content!: Component;
    private _glyph: Glyph | null = null;

    /**
     * Flipped to `true` the first time a consumer calls `setPreferredSize`
     * (directly or via the options bag). When set, the native auto-sizing
     * pipeline (see `recomputePreferredSize`) no-ops so the consumer's
     * explicit intent wins permanently. There's no public surface to
     * re-enable auto-sizing — a future plan can add a `clearPreferredSize`
     * method that resets this flag and re-fires the recompute.
     *
     * `declare` rather than `= false` so the class-field super-cascade trap
     * doesn't clobber the value when `Component.applyOptions` dispatches
     * `setPreferredSize` during the super-time cascade (an `= false`
     * initializer runs *after* super returns and would silently revert the
     * setter's `_consumerSetPreferredSize = true` write — letting the
     * end-of-constructor `recomputePreferredSize` overwrite the consumer's
     * preferred size with the content-derived value). The early-return
     * check at the top of `recomputePreferredSize` treats `undefined` as
     * falsy, so the no-cascade-write case still auto-sizes correctly.
     */
    private declare _consumerSetPreferredSize?: boolean;

    /**
     * Bound theme-change handler. The auto-sizing pipeline reads font-size
     * and glyph metrics that can shift with the active theme, so the
     * recompute re-fires whenever the theme cascade flips. Held on the
     * instance so a future `dispose` path can unregister it.
     */
    private readonly _onThemeChange: () => void = () => this.recomputePreferredSize();

    // Lazy `:active` rule. The slot is just a fast-path cache — the
    // `createStyleRule` builder on Component dedupes by selector suffix, so
    // even if the slot is reset between calls (e.g. by TypeScript class-field
    // init after super returns), the next access still returns the same
    // wrapper that the super-cascade allocated. `declare` keeps the slot off
    // the runtime class so the fast-path doesn't pay an unnecessary Map
    // lookup after construction.
    private declare _pressedStyleRule?: StyleRule;
    private get pressedStyleRule(): StyleRule {
        return this._pressedStyleRule ??= this.createStyleRule(":active");
    }
    private _pressedBorder: Border | null = null;

    // Lazy `:hover:not(:active)` rule. The `:not(:active)` guard makes the
    // cascade unambiguous regardless of source order — the moment the
    // pointer goes down, `:active` matches and `:hover:not(:active)` stops
    // matching, so the pressed treatment always wins.
    private declare _hoverStyleRule?: StyleRule;
    private get hoverStyleRule(): StyleRule {
        return this._hoverStyleRule ??= this.createStyleRule(":hover:not(:active)");
    }
    private _hoverBorder: Border | null = null;

    private _enabledCursor: string = "pointer";

    /**
     * Constructs a Button. `text` (positional or via options) and `glyph` are
     * both optional — an empty Button renders as a chrome-shaped placeholder
     * whose label / glyph can be filled in later via `setText` / `setGlyph`.
     *
     * @example
     * ```typescript
     * new Button('Save');
     * new Button({ glyph: 'times' });
     * new Button('Save', { glyph: 'check-circle' });
     * ```
     */
    constructor(text?: string, options?: ButtonOptions, subclassDefaults?: Partial<ButtonOptions>);
    constructor(options: ButtonOptions);
    constructor(
        textOrOptions?:    string | ButtonOptions,
        options?:          ButtonOptions,
        subclassDefaults?: Partial<ButtonOptions>,
    ) {
        // Normalise the overload: a non-string first argument is the options bag.
        let text: string | undefined;
        if (typeof textOrOptions === "string") {
            text = textOrOptions;
        } else if (textOrOptions !== undefined) {
            options = textOrOptions;
        }

        // Hand defaults to Component via the second super arg so they land in
        // `_defaultOptions` and survive subsequent `applyOptions` re-merges.
        // Subclass defaults (forwarded by callers via the third constructor
        // arg) layer on top so the deepest class's overrides win.
        super(
            options as TOptions,
            { ..._defaultButtonOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
        );

        // Structural state — can't go through the bag because consumers must
        // not be able to override it.
        this.setLayoutManager(new Fit());

        // Build the text/glyph content row.
        this._text    = new Text();
        this._content = new Component();
        this._content.setLayoutManager(new HBox({ spacing: 2 }));
        this._content.setInsets(new Insets(0, 0, 0, 0));
        this._content.setPointerEvents("none");
        this._content.addComponent(this._text);

        this._text.setPointerEvents("none");
        this._text.setTextAlign("center");
        this._text.setFontWeight("bold");
        this._text.setFontSize("--ts-ui-button-font-size");

        this.addComponent(this._content, {
            fill:   (this._options.fill   ?? this._defaultOptions.fill)   as FillType,
            anchor: (this._options.anchor ?? this._defaultOptions.anchor) as AnchorType,
        });

        // Late-built state: applyOptions wrote `text`/`glyph` into `_options`
        // pure (no setter dispatch) because `this.text`/`_content` didn't exist
        // yet. Dispatch them now that children are wired up.
        const effectiveText = this._options.text ?? text;
        if (effectiveText !== undefined) {
            this._text.setText(effectiveText);
        }
        if (this._options.glyph !== undefined) {
            this.setGlyph(this._options.glyph);
        }

        // Initial auto-sized preferred-size pass. No-ops when the consumer
        // already supplied `preferredSize` (the override of `setPreferredSize`
        // below flips `_consumerSetPreferredSize`).
        this.recomputePreferredSize();

        // Re-fire the auto-sized recompute on theme changes so any
        // font-size / glyph-metric shifts cascade into the button's preferred
        // size without explicit consumer prodding.
        ThemeManager.onThemeChange(this._onThemeChange);
    }

    /**
     * Applies a {@link ButtonOptions} bag. Inherited Component fields cascade
     * through `super.applyOptions`; pressed-state, hover-state, and `enabled`
     * fields cascade through their own setters (the lazy `pressedStyleRule`
     * and `hoverStyleRule` getters make them safe to fire during the
     * super-time cascade). `text` and `glyph` are written pure into
     * `_options` here and dispatched from the constructor body once children
     * exist.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        // Read from defaults-merged opts so subclass defaults (e.g. SpinButton's
        // symbol-derived glyph) dispatch alongside caller-supplied values.
        const opts = { ...this._defaultOptions, ...options } as TOptions;

        if (opts.text         !== undefined) this._options.text         = opts.text;
        if (opts.glyph        !== undefined) this._options.glyph        = opts.glyph;

        if (opts.enabled      !== undefined) this.setEnabled(opts.enabled);

        // chromeless / anchor / fill are pure writes — no setter dispatch.
        // Runtime flag flips for chromeless go through setChromeless(), which
        // also reconciles the DOM via clearChrome / restoreChrome. anchor and
        // fill are consumed by the constructor body when adding `_content` to
        // the outer Fit layout; later applyOptions calls don't reanchor.
        if (opts.chromeless   !== undefined) this._options.chromeless   = opts.chromeless;
        if (opts.anchor       !== undefined) this._options.anchor       = opts.anchor;
        if (opts.fill         !== undefined) this._options.fill         = opts.fill;

        return this;
    }

    /**
     * Gates Component's chrome dispatch on the `chromeless` flag and, when
     * the flag is off, extends it with Button's twelve `pressedX` / `hoverX`
     * chrome fields. Reads the flag from the runtime cache first so a flag
     * previously written (by an earlier `applyOptions` or `setChromeless`)
     * keeps gating future re-applies that omit `chromeless`.
     *
     * @param opts - The merged options bag passed by {@link applyOptions}.
     */
    protected override applyChromeOptions(opts: TOptions): void {
        const chromeless = (this._options.chromeless ?? opts.chromeless) === true;
        if (chromeless) {
            // `Component.applyStyle` reads `borderRadius`, `shadow`, and
            // `backgroundImage` from `{...defaults, ...options}` directly, so
            // chromeful defaults baked into `_defaultOptions` would otherwise
            // leak through at render time. Write `undefined` into `_options`
            // so the spread merge masks the defaults and `applyStyle`'s
            // `if (opts.X)` falsy gates skip the property.
            //
            // Border goes through private `_border` / `_borderCSS` fields, so
            // `clearBorder` resets those to a 0-width none-style border that
            // overrides the UA `<button>` ridge.
            //
            // Finally, the UA `<button>` element has a non-transparent
            // background-color; set transparent unless the caller specified
            // their own backgroundColor.
            this.clearBorder();
            this._options.borderRadius    = undefined;
            this._options.shadow          = undefined;
            this._options.backgroundImage = undefined;
            if ((this._options.backgroundColor ?? this._defaultOptions.backgroundColor) === undefined) {
                this._options.backgroundColor = "transparent";
            }
            return;
        }

        super.applyChromeOptions(opts);

        if (opts.pressedForegroundColor !== undefined) this.setPressedForegroundColor(opts.pressedForegroundColor);
        if (opts.pressedBackgroundColor !== undefined) this.setPressedBackgroundColor(opts.pressedBackgroundColor);
        if (opts.pressedBackgroundImage !== undefined) this.setPressedBackgroundImage(opts.pressedBackgroundImage);
        if (opts.pressedShadow          !== undefined) this.setPressedShadow         (opts.pressedShadow);
        if (opts.pressedBorder          !== undefined) this.setPressedBorder         (opts.pressedBorder);
        if (opts.pressedBorderRadius    !== undefined) this.setPressedBorderRadius   (opts.pressedBorderRadius);

        if (opts.hoverForegroundColor   !== undefined) this.setHoverForegroundColor  (opts.hoverForegroundColor);
        if (opts.hoverBackgroundColor   !== undefined) this.setHoverBackgroundColor  (opts.hoverBackgroundColor);
        if (opts.hoverBackgroundImage   !== undefined) this.setHoverBackgroundImage  (opts.hoverBackgroundImage);
        if (opts.hoverShadow            !== undefined) this.setHoverShadow           (opts.hoverShadow);
        if (opts.hoverBorder            !== undefined) this.setHoverBorder           (opts.hoverBorder);
        if (opts.hoverBorderRadius      !== undefined) this.setHoverBorderRadius     (opts.hoverBorderRadius);
    }

    /**
     * Returns the Text child component used to display the button text.
     *
     * @returns The internal Text instance.
     */
    getText() {
        return this._text;
    }

    /**
     * Sets or clears an optional leading [`Glyph`](/api/component/display/classes/Glyph) shown alongside the button's text.
     *
     * @param name - Registry glyph name to display, or `null` to clear an existing glyph.
     *
     * @returns This component, for method chaining.
     *
     * @remarks
     * The button's text always lives inside an [`HBox`](/api/layout/classes/HBox)-laid-out
     * content row anchored by the outer [`Fit`](/api/layout/classes/Fit) layout. This setter
     * just swaps the leading glyph child of that row in or out — adding the glyph as the
     * first child and re-appending the text after it to preserve the `[glyph, text]` order.
     * Empty text combined with `setGlyph(name)` therefore renders as a glyph-only button
     * with no visual artifacts at the default 0px spacing.
     */
    setGlyph(name: string): this {
        if (this._glyph) {
            this._content.removeComponent(this._glyph);
            this._glyph = null;
        }

        const glyph = new Glyph(name);
        glyph.setPointerEvents("none");
        this._glyph = glyph;

        this._content.insertComponent(glyph, 0);

        // The content row's preferred size shifted — re-sync the button's
        // auto-derived preferred size unless the consumer has pinned it.
        this.recomputePreferredSize();

        return this;
    }

    /**
     * Removes the leading glyph from the button, if one is present.
     *
     * @returns This component, for method chaining.
     */
    clearGlyph(): this {
        if (this._glyph) {
            this._content.removeComponent(this._glyph);
            this._glyph = null;
        }

        this.recomputePreferredSize();

        return this;
    }

    /**
     * Returns the current leading glyph component, or null if none is set.
     *
     * @returns The [`Glyph`](/api/component/display/classes/Glyph) instance, or null.
     */
    getGlyph(): Glyph | null {
        return this._glyph;
    }

    /**
     * Returns the offset from the top of the button to the label's text baseline.
     *
     * @returns The baseline offset in pixels, or `null` when the label has no baseline.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(this._text.getBaseline());
    }

    /**
     * Registers a listener for one of this button's events. A typed
     * shorthand over {@link Event.addListener} — `"click"` is currently the
     * only allowed event name. Future DOM events Button wants to expose are
     * added by widening `ButtonEvent`.
     *
     * @param event - The event name. Only `"click"` is accepted.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This button, for method chaining.
     */
    on(event: "click",     listener: ClickListener): this;
    on(event: ButtonEvent, listener: ClickListener): this {
        Event.addListener(this, event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. A typed shorthand over
     * {@link Event.removeListener}; the exact callback reference must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This button, for method chaining.
     */
    off(event: "click",     listener: ClickListener): this;
    off(event: ButtonEvent, listener: ClickListener): this {
        Event.removeListener(this, event, listener);

        return this;
    }

    /**
     * Registers a `pointerdown` event listener on this button. The named
     * surface lets external consumers (e.g.
     * [`AbstractPickerField`](/api/component/input/classes/AbstractPickerField))
     * route through the component rather than reaching for
     * `Event.addListener(button, "pointerdown", ...)` directly, preserving
     * the framework's named-listener contract.
     *
     * @param listener - Called with the originating PointerEvent.
     *
     * @returns This component, for method chaining.
     */
    addPointerDownListener(listener: Function): this {
        Event.addListener(this, "pointerdown", listener);

        return this;
    }

    /**
     * Returns whether this button is currently in `chromeless` mode (no
     * border / shadow / gradient / pressed-hover treatments).
     *
     * @returns True when chrome dispatches are gated off.
     */
    isChromeless(): boolean {
        return this._options.chromeless ?? false;
    }

    /**
     * Toggles the `chromeless` flag and reconciles the DOM. When flipping
     * to `true`, clears every chrome property currently on the element
     * before recording the flag. When flipping to `false`, restores the
     * chromeful defaults from `_defaultOptions` (which retains both
     * Button's base defaults and any subclass chrome layered in at
     * construction, so the round-trip is loss-free for both sources).
     *
     * @param value - The new chromeless state.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Consumer-supplied chrome that came in via the caller's
     * `options` bag (rather than the subclass's `_defaultOptions`) is not
     * recovered by `setChromeless(false)` — only the defaults round-trip.
     */
    setChromeless(value: boolean): this {
        if ((this._options.chromeless ?? false) === value) {
            return this;
        }

        if (value) {
            // Clear the DOM before flipping the flag. The clear* setters
            // are not gated today, but the ordering keeps the intent
            // self-evident if a future change does gate them.
            this._clearChrome();
            this._options.chromeless = true;
        } else {
            // Flip the flag first so the clear/set side-effects on the
            // restore path are not intercepted by anything that might
            // later gate them.
            this._options.chromeless = false;
            this._restoreChrome();
        }

        return this;
    }

    /**
     * Clears every chrome property the framework defaults touch. Pressed
     * and hover rules are only touched when their lazy backing slots have
     * already been allocated — calling the `clearX` setters when nothing
     * was ever installed would touch the lazy getters and acquire empty
     * orphan rules.
     */
    private _clearChrome(): void {
        this.clearBorder();
        this.clearBorderRadius();
        this.clearShadow();
        this.clearBackgroundImage();

        if (this._pressedStyleRule !== undefined) {
            this.clearPressedBackgroundColor();
            this.clearPressedBackgroundImage();
            this.clearPressedForegroundColor();
            this.clearPressedShadow();
            this.clearPressedBorderRadius();
            // `clearPressedBorder` doesn't exist today; consumers that set
            // a pressed border live with it across a chromeless toggle.
        }

        if (this._hoverStyleRule !== undefined) {
            this.clearHoverBackgroundColor();
            this.clearHoverBackgroundImage();
            this.clearHoverForegroundColor();
            this.clearHoverShadow();
            this.clearHoverBorderRadius();
            // `clearHoverBorder` doesn't exist today — same story as
            // `clearPressedBorder`.
        }
    }

    /**
     * Re-applies chrome from `_defaultOptions`, which carries both Button's
     * base defaults and any subclass chrome layered in at construction via
     * the third constructor arg. Consumer-supplied chrome (from the
     * caller's options bag, not `_defaultOptions`) is not recovered here.
     */
    private _restoreChrome(): void {
        const d = this._defaultOptions as ButtonOptions;

        if (d.border                 !== undefined) this.setBorder(d.border);
        if (d.borderRadius           !== undefined) this.setBorderRadius(d.borderRadius);
        if (d.shadow                 !== undefined) this.setShadow(d.shadow);
        if (d.backgroundImage        !== undefined) this.setBackgroundImage(d.backgroundImage);

        if (d.pressedForegroundColor !== undefined) this.setPressedForegroundColor(d.pressedForegroundColor);
        if (d.pressedBackgroundColor !== undefined) this.setPressedBackgroundColor(d.pressedBackgroundColor);
        if (d.pressedBackgroundImage !== undefined) this.setPressedBackgroundImage(d.pressedBackgroundImage);
        if (d.pressedShadow          !== undefined) this.setPressedShadow         (d.pressedShadow);
        if (d.pressedBorder          !== undefined) this.setPressedBorder         (d.pressedBorder);
        if (d.pressedBorderRadius    !== undefined) this.setPressedBorderRadius   (d.pressedBorderRadius);

        if (d.hoverForegroundColor   !== undefined) this.setHoverForegroundColor  (d.hoverForegroundColor);
        if (d.hoverBackgroundColor   !== undefined) this.setHoverBackgroundColor  (d.hoverBackgroundColor);
        if (d.hoverBackgroundImage   !== undefined) this.setHoverBackgroundImage  (d.hoverBackgroundImage);
        if (d.hoverShadow            !== undefined) this.setHoverShadow           (d.hoverShadow);
        if (d.hoverBorder            !== undefined) this.setHoverBorder           (d.hoverBorder);
        if (d.hoverBorderRadius      !== undefined) this.setHoverBorderRadius     (d.hoverBorderRadius);
    }

    /**
     * Updates the button's insets. Overrides Component's setter so the
     * auto-sized preferred size re-syncs to the new inset perimeter
     * without explicit consumer prodding (subclasses like `MenuBarButton`
     * change insets in their constructor body).
     *
     * @param insets - The new perimeter insets.
     * @returns This component, for method chaining.
     */
    setInsets(insets: Insets): this {
        super.setInsets(insets);
        this.recomputePreferredSize();

        return this;
    }

    /**
     * Records a consumer-supplied preferred size. Flips
     * `_consumerSetPreferredSize` so future auto-fires from
     * `recomputePreferredSize` no-op — the consumer's explicit intent
     * wins permanently for the lifetime of this instance.
     *
     * @param width - The preferred width in pixels.
     * @param height - The preferred height in pixels.
     * @returns This component, for method chaining.
     */
    setPreferredSize(width: number, height: number): this {
        this._consumerSetPreferredSize = true;
        super.setPreferredSize(width, height);

        return this;
    }

    /**
     * Re-derives this button's preferred size from its content row +
     * perimeter and pushes the result through Component's setter (bypassing
     * the consumer-flag flip). Auto-fires from the end of the constructor,
     * `setGlyph`, `clearGlyph`, `setInsets`, and the registered
     * `ThemeManager.onThemeChange` handler.
     *
     * No-ops when the consumer has supplied an explicit `preferredSize`
     * (Button's `setPreferredSize` override records that intent).
     *
     * Subclasses customise the size by overriding {@link computePreferredSize}
     * rather than touching this method — the consumer-flag and auto-fire
     * wiring stays here.
     */
    protected recomputePreferredSize(): void {
        if (this._consumerSetPreferredSize) {
            return;
        }

        const size = this.computePreferredSize();

        // Bypass our own override of setPreferredSize so the consumer flag
        // doesn't flip on an auto-fire. `super` is `Component`.
        super.setPreferredSize(size.width, size.height);
    }

    /**
     * Computes the auto-sized preferred size from the content row's
     * preferred size plus this button's perimeter (insets + border).
     * Mirrors `Fit.getPreferredSize`'s use of `getPerimiterSize` so the
     * border width isn't truncated off the text. Subclasses override to
     * alter — the typical case is replacing the derived height with a
     * fixed token (see `MenuBarButton`).
     *
     * @returns The `{ width, height }` Button reports as its preferred size
     *   while the consumer hasn't pinned one.
     */
    protected computePreferredSize(): { width: number; height: number } {
        const content = this._content?.getPreferredSize() ?? { width: 0, height: 0 };
        const perim   = this.getPerimiterSize();

        return {
            width:  content.width  + perim.left + perim.right,
            height: content.height + perim.top  + perim.bottom,
        };
    }

    /**
     * Returns the background color applied when the button is in the :active state.
     *
     * @returns The CSS color string, or null if not set.
     */
    getPressedBackgroundColor(): string | null {
        return this._options.pressedBackgroundColor ?? null;
    }

    /**
     * Sets the background color for the :active CSS rule.
     *
     * @param backgroundColor - A CSS color string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setPressedBackgroundColor(backgroundColor: string): this {
        this._options.pressedBackgroundColor = backgroundColor;
        this.pressedStyleRule.set("backgroundColor", backgroundColor);

        return this;
    }

    /**
     * Removes the background-color from the :active CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedBackgroundColor(): this {
        this._options.pressedBackgroundColor = undefined;
        this.pressedStyleRule.set("backgroundColor", null);

        return this;
    }

    /**
     * Returns the background image applied when the button is in the :active state.
     *
     * @returns The CSS background-image string, or null if not set.
     */
    getPressedBackgroundImage(): string | null {
        return this._options.pressedBackgroundImage ?? null;
    }

    /**
     * Sets the background image for the :active CSS rule.
     *
     * @param backgroundImage - Optional. A CSS background-image string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setPressedBackgroundImage(backgroundImage: string): this {
        this._options.pressedBackgroundImage = backgroundImage;
        this.pressedStyleRule.set("backgroundImage", backgroundImage);

        return this;
    }

    /**
     * Removes the background-image from the :active CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedBackgroundImage(): this {
        this._options.pressedBackgroundImage = undefined;
        this.pressedStyleRule.set("backgroundImage", null);

        return this;
    }

    /**
     * Returns the text color applied when the button is in the :active state.
     *
     * @returns The CSS color string, or null if not set.
     */
    getPressedForegroundColor(): string | null {
        return this._options.pressedForegroundColor ?? null;
    }

    /**
     * Sets the text color for the :active CSS rule.
     *
     * @param foregroundColor - A CSS color string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setPressedForegroundColor(foregroundColor: string): this {
        this._options.pressedForegroundColor = foregroundColor;
        this.pressedStyleRule.set("color", foregroundColor);

        return this;
    }

    /**
     * Removes the color (foreground) from the :active CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedForegroundColor(): this {
        this._options.pressedForegroundColor = undefined;
        this.pressedStyleRule.set("color", null);

        return this;
    }

    /**
     * Returns the border applied when the button is in the :active state.
     *
     * @returns The Border instance for the :active state, or null if not set.
     */
    getPressedBorder(): Border | null {
        return this._pressedBorder;
    }

    /**
     * Sets the border for the :active CSS rule.
     *
     * @param options - Optional. Border configuration (style, width, color). Omit to apply a default border.
     *
     * @returns This component, for method chaining.
     */
    setPressedBorder(options?: BorderOptions): this {
        this._pressedBorder = new Border(options);
        this.pressedStyleRule.setMany(this._pressedBorder.toStyle());

        return this;
    }

    /**
     * Returns the border radius applied when the button is in the :active state.
     *
     * @returns The CSS border-radius string, or null if not set.
     */
    getPressedBorderRadius(): string | null {
        return this._options.pressedBorderRadius ?? null;
    }

    /**
     * Sets the border radius for the :active CSS rule.
     *
     * @param borderRadius - Optional. A CSS border-radius string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setPressedBorderRadius(borderRadius: string): this {
        this._options.pressedBorderRadius = borderRadius;
        this.pressedStyleRule.set("borderRadius", borderRadius);

        return this;
    }

    /**
     * Removes the border-radius from the :active CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedBorderRadius(): this {
        this._options.pressedBorderRadius = undefined;
        this.pressedStyleRule.set("borderRadius", null);

        return this;
    }

    /**
     * Returns the box shadow applied when the button is in the :active state.
     *
     * @returns The CSS box-shadow string, or null if not set.
     */
    getPressedShadow(): string | null {
        return this._options.pressedShadow ?? null;
    }

    /**
     * Sets the box shadow for the :active CSS rule.
     *
     * @param shadow - A CSS box-shadow string, or null to set the shadow to "none".
     *
     * @returns This component, for method chaining.
     */
    setPressedShadow(shadow: string): this {
        this._options.pressedShadow = shadow;
        this.pressedStyleRule.set("boxShadow", shadow);

        return this;
    }

    /**
     * Removes the box-shadow from the :active CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedShadow(): this {
        this._options.pressedShadow = undefined;
        this.pressedStyleRule.set("boxShadow", null);

        return this;
    }

    /**
     * Returns the background color applied when the pointer is over the button (but not pressed).
     *
     * @returns The CSS color string, or null if not set.
     */
    getHoverBackgroundColor(): string | null {
        return this._options.hoverBackgroundColor ?? null;
    }

    /**
     * Sets the background color for the `:hover:not(:active)` CSS rule.
     *
     * @param backgroundColor - A CSS color string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setHoverBackgroundColor(backgroundColor: string): this {
        this._options.hoverBackgroundColor = backgroundColor;
        this.hoverStyleRule.set("backgroundColor", backgroundColor);

        return this;
    }

    /**
     * Removes the background-color from the `:hover:not(:active)` CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearHoverBackgroundColor(): this {
        this._options.hoverBackgroundColor = undefined;
        this.hoverStyleRule.set("backgroundColor", null);

        return this;
    }

    /**
     * Returns the background image applied when the pointer is over the button (but not pressed).
     *
     * @returns The CSS background-image string, or null if not set.
     */
    getHoverBackgroundImage(): string | null {
        return this._options.hoverBackgroundImage ?? null;
    }

    /**
     * Sets the background image for the `:hover:not(:active)` CSS rule.
     *
     * @param backgroundImage - A CSS background-image string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setHoverBackgroundImage(backgroundImage: string): this {
        this._options.hoverBackgroundImage = backgroundImage;
        this.hoverStyleRule.set("backgroundImage", backgroundImage);

        return this;
    }

    /**
     * Removes the background-image from the `:hover:not(:active)` CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearHoverBackgroundImage(): this {
        this._options.hoverBackgroundImage = undefined;
        this.hoverStyleRule.set("backgroundImage", null);

        return this;
    }

    /**
     * Returns the text color applied when the pointer is over the button (but not pressed).
     *
     * @returns The CSS color string, or null if not set.
     */
    getHoverForegroundColor(): string | null {
        return this._options.hoverForegroundColor ?? null;
    }

    /**
     * Sets the text color for the `:hover:not(:active)` CSS rule.
     *
     * @param foregroundColor - A CSS color string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setHoverForegroundColor(foregroundColor: string): this {
        this._options.hoverForegroundColor = foregroundColor;
        this.hoverStyleRule.set("color", foregroundColor);

        return this;
    }

    /**
     * Removes the color (foreground) from the `:hover:not(:active)` CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearHoverForegroundColor(): this {
        this._options.hoverForegroundColor = undefined;
        this.hoverStyleRule.set("color", null);

        return this;
    }

    /**
     * Returns the border applied when the pointer is over the button (but not pressed).
     *
     * @returns The [`Border`](/api/primitive/classes/Border) instance for the hover state, or null if not set.
     */
    getHoverBorder(): Border | null {
        return this._hoverBorder;
    }

    /**
     * Sets the border for the `:hover:not(:active)` CSS rule.
     *
     * @param options - Optional. Border configuration (style, width, color). Omit to apply a default border.
     *
     * @returns This component, for method chaining.
     */
    setHoverBorder(options?: BorderOptions): this {
        this._hoverBorder = new Border(options);
        this.hoverStyleRule.setMany(this._hoverBorder.toStyle());

        return this;
    }

    /**
     * Returns the border radius applied when the pointer is over the button (but not pressed).
     *
     * @returns The CSS border-radius string, or null if not set.
     */
    getHoverBorderRadius(): string | null {
        return this._options.hoverBorderRadius ?? null;
    }

    /**
     * Sets the border radius for the `:hover:not(:active)` CSS rule.
     *
     * @param borderRadius - A CSS border-radius string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setHoverBorderRadius(borderRadius: string): this {
        this._options.hoverBorderRadius = borderRadius;
        this.hoverStyleRule.set("borderRadius", borderRadius);

        return this;
    }

    /**
     * Removes the border-radius from the `:hover:not(:active)` CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearHoverBorderRadius(): this {
        this._options.hoverBorderRadius = undefined;
        this.hoverStyleRule.set("borderRadius", null);

        return this;
    }

    /**
     * Returns the box shadow applied when the pointer is over the button (but not pressed).
     *
     * @returns The CSS box-shadow string, or null if not set.
     */
    getHoverShadow(): string | null {
        return this._options.hoverShadow ?? null;
    }

    /**
     * Sets the box shadow for the `:hover:not(:active)` CSS rule.
     *
     * @param shadow - A CSS box-shadow string, or null to set the shadow to "none".
     *
     * @returns This component, for method chaining.
     */
    setHoverShadow(shadow: string): this {
        this._options.hoverShadow = shadow;
        this.hoverStyleRule.set("boxShadow", shadow);

        return this;
    }

    /**
     * Removes the box-shadow from the `:hover:not(:active)` CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearHoverShadow(): this {
        this._options.hoverShadow = undefined;
        this.hoverStyleRule.set("boxShadow", null);

        return this;
    }

    /**
     * Enables or disables the button.
     *
     * @param enabled - True to enable, false to disable.
     *
     * @remarks
     * When disabled, sets the native `disabled` attribute on the underlying
     * `<button>` element (which suppresses pointer events and `:active`),
     * dims the button to 0.5 opacity, and switches the cursor to `not-allowed`.
     * Re-enabling restores the previous cursor and clears the opacity override.
     */
    setEnabled(enabled: boolean): this {
        if ((this._options.enabled ?? true) === enabled) {
            return this;
        }

        this._options.enabled = enabled;

        if (enabled) {
            this.setDisabledAttribute(false);
            this.clearOpacity();
            this.setCursor(this._enabledCursor);
        } else {
            this._enabledCursor = this.getCursor() ?? "pointer";
            this.setDisabledAttribute(true);
            this.setOpacity(0.5);
            this.setCursor("not-allowed");
        }

        return this;
    }

    /**
     * Returns whether the button is currently enabled.
     *
     * @returns True if the button accepts user interaction.
     */
    isEnabled(): boolean {
        return this._options.enabled ?? true;
    }
}

const ButtonCallable = callable(Button);
type ButtonCallable<TOptions extends ButtonOptions = ButtonOptions> = Button<TOptions>;
export {
    Button         as _Button,
    ButtonCallable as Button
};
