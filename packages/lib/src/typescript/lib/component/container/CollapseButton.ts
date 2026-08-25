// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { COLLAPSE_STRIP_SIZE } from "~/layout/CollapseSupport.js";
import { callable } from "~/core/Callable.js";

// The chevron handle's thickness across the host gutter in its two states: a
// narrow grip while the gutter is an expanded divider, widening to the full
// collapse-strip width so the restore handle fills the strip once collapsed.
// The length along the gutter is constant in both states.
const GRIP_ACROSS  = 10;
const HANDLE_ALONG = 40;

/**
 * The four directions a {@link CollapseButton}'s chevron can point — the
 * direction the pane/region travels when the button is activated (collapse) or
 * restored.
 *
 * @category Components
 */
export type CollapseDirection = "north" | "south" | "east" | "west";

/**
 * The gesture that activates a {@link CollapseButton}: `"dblclick"` (the
 * default) or `"click"` for a single click.
 *
 * @category Components
 */
export type CollapseTrigger = "click" | "dblclick";

/**
 * String-literal union of the events emitted by {@link CollapseButton}.
 *
 * @category Components
 */
export type CollapseButtonEvent = "collapse" | "contextmenu";

/**
 * Construction-time options for {@link CollapseButton}.
 *
 * @category Components
 */
export interface CollapseButtonOptions extends ComponentOptions {
    direction?: CollapseDirection;
    /**
     * The gesture that fires `collapse`: `"dblclick"` (the default,
     * preserving today's behaviour) or `"click"` for a single click.
     */
    trigger?: CollapseTrigger;
    /**
     * Multi-event listener bag dispatched to {@link CollapseButton.on} at
     * construction time.
     */
    listeners?: {
        collapse?:    () => void;
        /** Fires when the chevron is right-clicked, receiving the pointer's viewport coordinates. */
        contextmenu?: (x: number, y: number) => void;
    };
}

/**
 * Degrees of rotation applied to the base east-pointing chevron glyph (`▶`) to
 * make it point in each {@link CollapseDirection}. Keyed so {@link CollapseButton}
 * can resolve the per-instance transform without a `switch`.
 */
const _rotationByDirection: Record<CollapseDirection, number> = {
    east:   0,
    south:  90,
    west:   180,
    north:  -90,
};

let _classRule: StyleRule | null = null;

/**
 * Registers the shared `.CollapseButton` class rule once on first use. The rule
 * holds the centred overlay geometry, chevron colour, and the raised themed
 * grip styling (the button overflows its thin host gutter so it stays
 * clickable).
 *
 * Idempotent and module-local; safe across hot reloads.
 */
function ensureCollapseButtonClassRule(): void {
    if (_classRule) {
        return;
    }

    _classRule = new StyleRule({
        scope:  "class",
        name:   "CollapseButton",
        styles: {
            position:      "absolute",
            top:           "50%",
            left:          "50%",
            // Fallback centring transform; each instance overrides it via a
            // per-instance rule that layers on the direction rotation.
            transform:     "translate(-50%, -50%)",
            // A raised, themed grip handle rather than a bare glyph, so the
            // whole thing is an easy double-click target. The box is uniform
            // (thin across the track, long along it) and the per-instance
            // rotation orients it: a tall handle on a vertical (west/east)
            // gutter, a wide one on a horizontal (north/south) gutter. Reuses
            // the button tokens so it matches the theme's raised controls.
            boxSizing:     "border-box",
            width:         `${GRIP_ACROSS}px`,
            height:        `${HANDLE_ALONG}px`,
            borderRadius:  "2px",
            background:    "var(--ts-ui-button-bg, #e8e8e8)",
            border:        "1px solid var(--ts-ui-button-border, #c8c8c8)",
            boxShadow:     "var(--ts-ui-button-shadow, 0 1px 2px rgba(0, 0, 0, 0.2))",
            textAlign:     "center",
            fontSize:      "9px",
            lineHeight:    `${HANDLE_ALONG - 2}px`,
            color:         "var(--ts-ui-collapse-button-color, rgb(100,100,100))",
            // The handle keeps its own pointer events so it stays clickable
            // even where it overhangs the thin host gutter. The clickable
            // `cursor: pointer` is applied per-instance (the Component default
            // `cursor: default` would otherwise override a class-rule cursor).
            pointerEvents: "auto",
            userSelect:    "none",
        },
    });
}

/**
 * A small chevron button carried by a [`SplitGutter`](/api/component/container/classes/SplitGutter)
 * that triggers a collapse in the gutter's divider state or a restore in its
 * collapsed-strip state.
 *
 * Activation defaults to a **double-click**; `trigger: "click"` switches it to
 * a single click instead. In either mode, grabbing the button for a drag can
 * never activate it by accident — a genuine drag (press, move, release
 * elsewhere) produces neither `click` nor `dblclick`, and the button's
 * `mousedown` is separately stopped from reaching the host so it never begins
 * a gutter resize.
 *
 * @category Components
 */
class CollapseButton extends Component<CollapseButtonOptions> {

    declare private _direction: CollapseDirection;
    private _trigger: CollapseTrigger = "dblclick";
    private _listeners: ListenerBag<CollapseButtonEvent> = this.registerListenerBag(new ListenerBag<CollapseButtonEvent>());

    /**
     * Constructs a collapse button. The chevron points east unless
     * `options.direction` says otherwise.
     *
     * @param options - Optional configuration bag (chevron direction,
     *   activation trigger, listener bag, plus common Component fields).
     */
    constructor(options?: CollapseButtonOptions) {
        ensureCollapseButtonClassRule();

        // `cursor: "pointer"` is set here (not only in the class rule) because
        // Component defaults `cursor` to `"default"` and writes it per-instance,
        // which would override a class-rule cursor. A caller-supplied cursor
        // still wins via the trailing spread.
        super({ tag: "span", cursor: "pointer", ...(options ?? {}) });

        this._direction ??= "east";
        this._trigger = options?.trigger ?? "dblclick";

        this.applyRotation();

        // Listener wiring runs here — NOT inside `applyOptions` — because
        // Component's constructor calls `applyOptions` from inside super(),
        // before the class-field `_listeners` initializer has run.
        this.applyListeners(options?.listeners);

        Event.addListener(this, this._trigger === "click" ? "click" : "dblclick", this.onActivate);
        Event.addListener(this, "mousedown", { button: "any", handler: this.onMouseDown });
        Event.addListener(this, "contextmenu", this.onContextMenu);
    }

    /**
     * Applies a {@link CollapseButtonOptions} bag, dispatching the chevron
     * direction after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: CollapseButtonOptions): this {
        super.applyOptions(options);

        if (options.direction !== undefined) {
            this.setDirection(options.direction);
        }

        return this;
    }

    /**
     * Renders the root span, writes the chevron glyph, and applies the cached
     * rotation for the current direction at first paint.
     *
     * @returns The rendered root element.
     */
    protected render(): Handle {
        const element = super.render();

        DOM.sink.apply(element, { text: "▶" });

        return element;
    }

    /**
     * Writes the per-instance `transform` (centring plus the rotation for the
     * current direction) onto a `createStyleRule` rule, overriding the shared
     * class rule's centring-only transform. Routed through `createStyleRule`
     * rather than `setTransform` because that builder's rules are replayed by
     * `applyStyle` at render time, whereas a main-rule write made before render
     * is dropped when the rule is rebuilt.
     */
    private applyRotation(): void {
        const degrees = _rotationByDirection[this._direction];

        this.createStyleRule("").set("transform", `translate(-50%, -50%) rotate(${degrees}deg)`);
    }

    /**
     * Toggles the handle between its expanded-grip and collapsed-strip widths.
     * Collapsed, it widens to the collapse-strip size so the restore handle
     * fills the entire width of the gutter's strip; expanded, it removes its
     * own `width` entry and falls back to the shared `.CollapseButton` rule's
     * grip width. The width rides the per-instance rule
     * (replayed by `applyStyle`) so it survives a render. The rotation maps this
     * `width` to the across-gutter axis for every chevron direction.
     *
     * @param filled - True for the collapsed strip-filling width, false for the grip.
     * @returns This component, for method chaining.
     */
    setStripMode(filled: boolean): this {
        // Expanded, the width entry is removed rather than rewritten: the shared
        // `.CollapseButton` rule already declares `width: ${GRIP_ACROSS}px`, and the
        // per-instance `#id` rule outranks it, so repeating the value here would put
        // an identical declaration on every instance for nothing.
        this.createStyleRule("").set("width", filled ? `${COLLAPSE_STRIP_SIZE}px` : null);

        return this;
    }

    /**
     * Returns the cached chevron direction.
     *
     * @returns The direction the chevron currently points.
     */
    getDirection(): CollapseDirection {
        return this._direction;
    }

    /**
     * Returns the configured activation trigger.
     *
     * @returns `"dblclick"` (the default) or `"click"`.
     */
    getTrigger(): CollapseTrigger {
        return this._trigger;
    }

    /**
     * Sets the chevron direction, rotating the glyph to match.
     *
     * @param direction - The direction the chevron should point.
     * @returns This component, for method chaining.
     */
    setDirection(direction: CollapseDirection): this {
        this._direction = direction;

        this.applyRotation();

        return this;
    }

    /**
     * Registers a listener for this button's `collapse` event, fired on the
     * configured activation trigger (double-click by default, or a single
     * click when `trigger: "click"` was set).
     *
     * @param event - `"collapse"` on the configured activation trigger
     *   (double-click by default, or a single click); `"contextmenu"` on
     *   right-click, receiving the pointer's viewport coordinates.
     * @param listener - The callback to invoke.
     * @returns This component, for method chaining.
     */
    on(event: "collapse", listener: () => void): this;
    on(event: "contextmenu", listener: (x: number, y: number) => void): this;
    on(event: CollapseButtonEvent, listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     * @returns This component, for method chaining.
     */
    off(event: CollapseButtonEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event`, in registration order.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "collapse"): void;
    protected emit(event: "contextmenu", x: number, y: number): void;
    protected emit(event: CollapseButtonEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Emits `collapse` on whichever DOM event `_trigger` registered
     * (`click` or `dblclick`).
     *
     * @param _evnt - The click/dblclick event; propagation is stopped so the
     *   host never also reacts.
     * @returns `true`, consuming the event so it does not also reach the header behind the button.
     */
    private onActivate(_evnt: MouseEvent): Event.ListenerResult {
        this.emit("collapse");

        return true;
    }

    /**
     * Stops a `mousedown` on the button from reaching the host gutter, so
     * grabbing the chevron never begins a resize drag.
     *
     * @param _evnt - The mousedown event to suppress.
     * @returns `true`, consuming the press so it does not start a drag on the header behind the button.
     */
    private onMouseDown(_evnt: MouseEvent): Event.ListenerResult {
        return true;
    }

    /**
     * Emits `contextmenu` with the pointer's viewport coordinates on a
     * right-click, consuming the press and suppressing the browser's own
     * context menu.
     *
     * @param evnt - The contextmenu event; its `clientX`/`clientY` seed the emit.
     * @returns Stops propagation and prevents the browser's default context menu.
     */
    private onContextMenu(evnt: MouseEvent): Event.ListenerResult {
        this.emit("contextmenu", evnt.clientX, evnt.clientY);

        return { stop: true, prevent: true };
    }

}

const CollapseButtonCallable = callable(CollapseButton);
type CollapseButtonCallable = CollapseButton;
export {
    CollapseButton         as _CollapseButton,
    CollapseButtonCallable as CollapseButton
};
