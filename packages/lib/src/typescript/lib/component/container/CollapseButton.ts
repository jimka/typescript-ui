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
 * String-literal union of the events emitted by {@link CollapseButton}.
 *
 * @category Components
 */
export type CollapseButtonEvent = "collapse";

/**
 * Construction-time options for {@link CollapseButton}.
 *
 * @category Components
 */
export interface CollapseButtonOptions extends ComponentOptions {
    direction?: CollapseDirection;
    /**
     * Multi-event listener bag dispatched to {@link CollapseButton.on} at
     * construction time.
     */
    listeners?: {
        collapse?: () => void;
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
 * Activation is a **double-click**, never a single click, so grabbing the button
 * for a drag can never collapse by accident — a drag produces no `dblclick`, and
 * the button's `mousedown` is stopped from reaching the host so it never begins
 * a gutter resize.
 *
 * @category Components
 */
class CollapseButton extends Component<CollapseButtonOptions> {

    declare private _direction: CollapseDirection;
    private _listeners: ListenerBag<CollapseButtonEvent> = new ListenerBag<CollapseButtonEvent>();

    /**
     * Constructs a collapse button. The chevron points east unless
     * `options.direction` says otherwise.
     *
     * @param options - Optional configuration bag (chevron direction, listener
     *   bag, plus common Component fields).
     */
    constructor(options?: CollapseButtonOptions) {
        ensureCollapseButtonClassRule();

        // `cursor: "pointer"` is set here (not only in the class rule) because
        // Component defaults `cursor` to `"default"` and writes it per-instance,
        // which would override a class-rule cursor. A caller-supplied cursor
        // still wins via the trailing spread.
        super({ tag: "span", cursor: "pointer", ...(options ?? {}) });

        this._direction ??= "east";

        this.applyRotation();

        // Listener wiring runs here — NOT inside `applyOptions` — because
        // Component's constructor calls `applyOptions` from inside super(),
        // before the class-field `_listeners` initializer has run.
        this.applyListeners(options?.listeners);

        Event.addListener(this, "dblclick", this.onDoubleClick);
        Event.addListener(this, "mousedown", this.onMouseDown);
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
     * fills the entire width of the gutter's strip; expanded, it returns to the
     * narrow grip. The width rides the per-instance rule
     * (replayed by `applyStyle`) so it survives a render. The rotation maps this
     * `width` to the across-gutter axis for every chevron direction.
     *
     * @param filled - True for the collapsed strip-filling width, false for the grip.
     * @returns This component, for method chaining.
     */
    setStripMode(filled: boolean): this {
        this.createStyleRule("").set("width", `${filled ? COLLAPSE_STRIP_SIZE : GRIP_ACROSS}px`);

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
     * Registers a listener for this button's `collapse` event, fired on a
     * double-click.
     *
     * @param event - Always `"collapse"`.
     * @param listener - The callback to invoke on double-click.
     * @returns This component, for method chaining.
     */
    on(event: "collapse", listener: () => void): this;
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
     */
    protected emit(event: CollapseButtonEvent): void {
        this._listeners.fire(event);
    }

    /**
     * Emits `collapse` on a double-click.
     *
     * @param _evnt - The dblclick event; propagation is stopped so the host
     *   never also reacts.
     */
    private onDoubleClick(_evnt: MouseEvent): Event.ListenerResult {
        this.emit("collapse");

        return true;
    }

    /**
     * Stops a `mousedown` on the button from reaching the host gutter, so
     * grabbing the chevron never begins a resize drag.
     *
     * @param _evnt - The mousedown event to suppress.
     */
    private onMouseDown(_evnt: MouseEvent): Event.ListenerResult {
        return true;
    }

    /**
     * Removes the double-click and mousedown listeners.
     */
    destroy(): void {
        Event.removeListener(this, "dblclick", this.onDoubleClick);
        Event.removeListener(this, "mousedown", this.onMouseDown);
    }
}

const CollapseButtonCallable = callable(CollapseButton);
type CollapseButtonCallable = CollapseButton;
export {
    CollapseButton         as _CollapseButton,
    CollapseButtonCallable as CollapseButton
};
