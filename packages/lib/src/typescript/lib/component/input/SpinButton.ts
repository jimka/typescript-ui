// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button, ButtonEvent, ButtonOptions, ClickListener } from "~/component/button/Button.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { AutoRepeat } from "~/core/AutoRepeat.js";
import { Util } from "~/core/Util.js";
import { ThemeManager } from "~/core/Theme.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";
import { Glyph } from "~/component/display/Glyph.js";
import { chevron_up } from "~/glyphs/solid/chevron_up.js";
import { chevron_down } from "~/glyphs/solid/chevron_down.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";
import { GLYPH_XS_INK_TRAIT } from "~/core/StyleTraits.js";

/**
 * String-literal union of the events emitted by {@link SpinButton}. Extends
 * the inherited `ButtonEvent` union with the spin-specific events.
 *
 * @category Components
 */
export type SpinButtonEvent = ButtonEvent | "tick";

Glyph.register(chevron_up, chevron_down);

/**
 * Construction-time options for {@link SpinButton}.
 *
 * @category Components
 */
export interface SpinButtonOptions extends ButtonOptions {
    /**
     * Multi-event listener bag dispatched to {@link SpinButton.on} at
     * construction time.
     */
    listeners?: {
        action?: ClickListener;
        tick?:   () => void;
    };
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * Strips [`Button`](/api/component/button/classes/Button)'s chrome (border /
 * radius / insets) so the spinner sits flush in its NumberSpinner cell. The
 * `shadow`/`pressedShadow` clears can't ride here — they're `clear*` calls
 * with no equivalent option value — so they stay in the constructor body
 * guarded on the consumer options bag.
 */
const _defaultSpinButtonOptions: Partial<SpinButtonOptions> = {
    border:       "none",
    borderRadius: "0",
    insets:       new Insets(0, 0, 0, 0),
};

/**
 * A small up- or down-arrow button used inside a NumberSpinner.
 *
 * Extends Button to inherit the pressed-state appearance and click handling, then
 * adds a hold-repeat gesture: pressing and holding fires `tick` events at an
 * accelerating cadence (initial 400 ms, multiplied by 0.75 per tick, floored at 40 ms).
 *
 * @category Components
 */
class SpinButton extends Button<SpinButtonOptions> {

    // Opts the resting tier into the hierarchy-aware class cascade — see
    // plans/implemented/class-hierarchy-cascade.md. The same constant this
    // class's constructor forwards as part of `subclassDefaults`, exposed at
    // the class level so `.SpinButton`'s rule carries only its own deviation
    // (the flush `border`/`borderRadius`/`insets`) from `.Button`'s.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultSpinButtonOptions;

    // Restates Button's state list in Button's own order — the declared list
    // governs order as a whole (see `resolveStyleStates`'s own comment), so
    // naming only `.pressed` here would drop `:hover` from SpinButton's
    // resolution and narrow the resting tier's `:not(...)` guard. Only
    // `.pressed`'s shadow deviates: a spin button sits flush in its
    // NumberSpinner cell with no resting shadow, so it has no pressed shadow
    // either. Content merges per level, so `.pressed`'s colour and background
    // keys still resolve from `.Button.pressed` and are not repeated here.
    // The constructor's `clearPressedShadow()` call below now dedupes against
    // this shared value instead of writing `box-shadow: none` on every
    // instance's own `#id.pressed` rule.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".pressed",
            extract: (): StyleBag => ({ shadow: "none" }),
        },
        Button.ownStyleStates[1],   // :hover, restated unchanged
    ];

    private _listeners    : ListenerBag<SpinButtonEvent> = this.registerListenerBag(new ListenerBag<SpinButtonEvent>());
    private _repeat       : AutoRepeat;

    /**
     * @param symbol - The arrow rendered inside the button (`"▲"` or `"▼"`).
     *                 Mapped internally to the matching SVG glyph in the
     *                 framework's glyph registry.
     */
    constructor(
        symbol:            "▲" | "▼",
        options?:          SpinButtonOptions,
        subclassDefaults?: Partial<SpinButtonOptions>,
    ) {
        // Hand defaults plus the symbol-derived glyph to Button via the
        // subclass-defaults arg so they land in `_defaultOptions`. User
        // options still win because Component merges `{...defaults, ...options}`
        // at dispatch time.
        super(undefined, options, {
            ..._defaultSpinButtonOptions,
            glyph: symbol === "▲" ? "chevron-up" : "chevron-down",
            ...(subclassDefaults ?? {}),
        });

        this.updateSize();
        this.subscribeTheme(() => this.updateSize());

        // `clearShadow` / `clearPressedShadow` have no representable option
        // value (they write `box-shadow: none` and `_options.shadow = undefined`
        // — distinct from `setShadow("none")` which stores the literal string),
        // so they stay in the body, guarded on the consumer bag.
        if (options?.shadow === undefined) {
            this.clearShadow();
        }
        if (options?.pressedShadow === undefined) {
            this.clearPressedShadow();
        }

        // Shrink the glyph so it fits the half-height spin-button, to the
        // theme's compact-control glyphXs icon step. The 1 px upward translate
        // compensates for sub-pixel rounding in the Button's centring math:
        // the measured input height is often odd, making `(halfHeight - ink) /
        // 2` a fractional value that the browser resolves toward the bottom of
        // the cell.
        // Pin the chevron so a theme change never re-tracks it to the title
        // line height; the 1px upward nudge corrects the centring rounding noted
        // above.
        this.pinGlyphSize(ThemeManager.getResolvedScale().glyphXs);
        this.getGlyph()?.setStyleTrait(GLYPH_XS_INK_TRAIT);
        this.getGlyph()?.setTranslate(0, -1);

        this._repeat = new AutoRepeat({
            initialDelay: 400,   // ms before the first hold-repeat tick
            decay:        0.75,  // accelerate the cadence by ×0.75 each tick
            floor:        40,    // fastest steady cadence, in ms
            onTick:       () => this.emit("tick"),
        });

        Event.addListener(this, "mousedown", () => this.onMouseDown());
        Event.addViewportListener(this, "mouseup", () => this.onMouseUp());
        Event.addViewportListener(this, "mouseleave", () => this.onMouseUp());

        this.applyListeners(options?.listeners);
    }

    /**
     * Recalculates preferred and maximum size from the native input height divided in half.
     *
     * Called at construction time and after each theme change so font-size adjustments
     * propagate to the layout hint automatically.
     */
    private updateSize(): void {
        // Mirror the host NumberSpinner's computed outer box (its own
        // `updateHeight`): one `Util.lineHeightPx()` line box, plus the inner
        // TextField's default 3 px top + bottom padding, plus the spinner's
        // 1 px top + bottom border. SpinButton can't read the spinner it lives
        // in, so the inner padding (6) and spinner border (2) are stated here as
        // the host's known chrome.
        const INNER_INPUT_VERTICAL_PADDING = 6;
        const SPINNER_VERTICAL_BORDER      = 2;

        const fullHeight = Util.lineHeightPx() + INNER_INPUT_VERTICAL_PADDING + SPINNER_VERTICAL_BORDER;
        // Subtract the host NumberSpinner's 1 px top + bottom border so two
        // stacked buttons fit inside the spinner's inner rect — without this,
        // an odd `fullHeight` produces `2 * floor(h/2) = h - 1` which exceeds
        // the inner height `h - 2` and clips the bottom button.
        const halfHeight = Math.floor((fullHeight - SPINNER_VERTICAL_BORDER) / 2);

        this.setPreferredSize({ width: 18, height: halfHeight });
        // Min = preferred = max so the parent's shrink-on-overallocation
        // doesn't collapse the chevron away when the spinner cell is
        // narrow.
        this.setMinSize({ width: 18, height: halfHeight });
        this.setMaxSize({ width: 18, height: halfHeight });
    }

    /**
     * Registers a listener for one of this spin button's events.
     *
     * @param event - `"action"` is the inherited DOM-routed click;
     *   `"tick"` fires on each logical tick (initial click plus every
     *   subsequent hold-repeat tick).
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This spin button, for method chaining.
     */
    on(event: "action",         listener: ClickListener): this;
    on(event: "tick",           listener: () => void): this;
    on(event: SpinButtonEvent,  listener: Function): this {
        if (event === "action") {
            Event.addListener(this, "click", listener as ClickListener);
        } else {
            this._listeners.add(event, listener);
        }

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This spin button, for method chaining.
     */
    off(event: "action",        listener: ClickListener): this;
    off(event: "tick",          listener: () => void): this;
    off(event: SpinButtonEvent, listener: Function): this {
        if (event === "action") {
            Event.removeListener(this, "click", listener as ClickListener);
        } else {
            this._listeners.remove(event, listener);
        }

        return this;
    }

    /**
     * Fires every listener registered for `event` (excluding `"click"`, which
     * routes through the framework's DOM event surface) with no arguments.
     *
     * @param event - The event to emit. Only non-DOM events (currently
     *   `"tick"`) are dispatched through this method.
     */
    protected emit(event: "tick"): void;
    protected emit(event: "tick", ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Fires the first tick immediately and schedules subsequent accelerating ticks.
     */
    private onMouseDown(): void {
        this._repeat.start();
    }

    /**
     * Cancels the hold-repeat schedule when the pointer is released or leaves the viewport.
     */
    private onMouseUp(): void {
        if (!this._repeat.isRunning()) {
            return;
        }

        this._repeat.stop();
    }
}

const SpinButtonCallable = callable(SpinButton);
type SpinButtonCallable = SpinButton;
export {
    SpinButton         as _SpinButton,
    SpinButtonCallable as SpinButton
};
