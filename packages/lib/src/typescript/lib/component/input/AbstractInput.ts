// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Bindable } from "~/core/Bindable.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { UNBOUNDED } from "~/primitive/Size.js";

/**
 * String-literal union of the events emitted by every {@link AbstractInput}
 * subclass.
 *
 * @category Components
 */
export type AbstractInputEvent = "change" | "binding";

/**
 * Construction-time options for {@link AbstractInput}. Extended by every
 * value-bearing input control so the `enabled` / `readOnly` flags share a
 * single options surface.
 *
 * @category Components
 */
export interface AbstractInputOptions extends ComponentOptions {
    enabled?:  boolean;
    readOnly?: boolean;
    /**
     * Construction-time listener bag — the declarative form of `on()`. Each
     * entry is wired as if `on(event, fn)` had been called. Concrete subclasses
     * that expose `on("action", …)` widen this with their own `action?` key.
     */
    listeners?: {
        change?:  (value: any) => void;
        binding?: () => void;
    };
}

/**
 * Abstract base for every value-bearing input control in the framework.
 *
 * Owns the [`Bindable`](/api/core/interfaces/Bindable) value contract, the
 * change/binding listener bookkeeping, and the cached `_options.enabled` /
 * `_options.readOnly` state. Concrete subclasses own their value storage
 * and implement the `applyEnabled` / `applyReadOnly` hooks for their own
 * visual + ARIA wiring.
 *
 * Not wrapped with `callable()` — abstract classes are never instantiated;
 * the [ARCHITECTURE.md](/ARCHITECTURE.md) rule about callable-wrapping
 * applies only to concrete component subclasses.
 *
 * @category Components
 */
abstract class AbstractInput<
    TValue,
    TOptions extends AbstractInputOptions = AbstractInputOptions
>
    extends Component<TOptions>
    implements Bindable<TValue>
{
    private _listeners: ListenerBag<AbstractInputEvent> = this.registerListenerBag(new ListenerBag<AbstractInputEvent>());

    /**
     * @param options - Caller-supplied options bag.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; forwarded to `Component` so the cascade can merge
     *   it before dispatching setters.
     */
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(options, subclassDefaults);

        // Listener wiring runs here — NOT inside `applyOptions` — because
        // Component's constructor calls `applyOptions` from inside super(),
        // before the class-field `_listeners` initializer has run. Wiring
        // after super() guarantees `_listeners` exists. A subclass that adds
        // `action` to its bag is wired by this same call (it iterates every
        // key), so leaves must not call `applyListeners` again.
        this.applyListeners(options?.listeners);
    }

    /**
     * Returns the current value. Concrete subclasses define the storage —
     * `Checkbox` aliases `isSelected`, `Slider` reads `_options.value`,
     * picker fields keep a private `_value` outside the options bag.
     *
     * @returns The current value.
     */
    abstract getValue(): TValue;

    /**
     * Sets the current value. Concrete subclasses implement the storage
     * write, normalisation, and any listener-firing for user-driven
     * commits.
     *
     * @param value - The new value.
     *
     * @returns This component, for method chaining.
     */
    abstract setValue(value: TValue): this;

    /**
     * Returns whether the control is enabled.
     *
     * @returns `true` when enabled (defaults to `true` when unset).
     */
    isEnabled(): boolean {
        return this._options.enabled ?? true;
    }

    /**
     * Enables or disables the control. Dispatches `applyEnabled` so the
     * subclass can reflect the state in its visuals + ARIA tree.
     *
     * @param value - `true` to enable, `false` to disable.
     *
     * @returns This component, for method chaining.
     */
    setEnabled(value: boolean): this {
        this._options.enabled = !!value;
        this.applyEnabled(this._options.enabled);

        return this;
    }

    /**
     * Returns whether the control is read-only.
     *
     * @returns `true` when read-only (defaults to `false` when unset).
     */
    isReadOnly(): boolean {
        return this._options.readOnly ?? false;
    }

    /**
     * Marks the control as read-only. Dispatches `applyReadOnly` so the
     * subclass can reflect the state in its visuals + ARIA tree.
     *
     * @param value - `true` to mark read-only.
     *
     * @returns This component, for method chaining.
     */
    setReadOnly(value: boolean): this {
        this._options.readOnly = !!value;
        this.applyReadOnly(this._options.readOnly);

        return this;
    }

    /**
     * Registers a listener for one of this input's events.
     *
     * @param event - `"change"` fires on every committed value change with
     *   the new value; `"binding"` fires on every user-driven change with
     *   no arguments (consumed by [`Binding`](/api/core/classes/Binding)).
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This component, for method chaining.
     */
    on(event: "change",  listener: (value: TValue) => void): this;
    on(event: "binding", listener: () => void): this;
    on(event: AbstractInputEvent, listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback
     * reference must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This component, for method chaining.
     */
    off(event: AbstractInputEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every registered listener for `event` with `payload`, in
     * registration order. Subclasses call this after committing a
     * user-driven value change.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "change",  value: TValue): void;
    protected emit(event: "binding"): void;
    protected emit(event: AbstractInputEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Fires `"change"` listeners with `value` and `"binding"` listeners
     * with no arguments. Subclasses call this after committing a
     * user-driven value change.
     *
     * @param value - The newly committed value.
     */
    protected notifyChange(value: TValue): void {
        this.emit("change", value);
        this.emit("binding");
    }

    /**
     * Subclass hook: reflect the enabled state in visuals + ARIA. Called
     * from {@link setEnabled} after the cached state is updated.
     *
     * @param value - The new enabled state.
     */
    protected abstract applyEnabled(value: boolean): void;

    /**
     * Subclass hook: reflect the read-only state in visuals + ARIA. Called
     * from {@link setReadOnly} after the cached state is updated.
     *
     * @param value - The new read-only state.
     */
    protected abstract applyReadOnly(value: boolean): void;

    /**
     * Recalculates preferred, minimum and maximum size from an already-computed
     * single-line box height, shared by every `AbstractInput` leaf that renders
     * one line of text in a box.
     *
     * @param h - The single-line box height in pixels, as
     *   {@link Util.singleLineBoxHeight} computed it.
     * @param defaultWidth - The preferred width to use on the very first call,
     *   before any caller constraint has been resolved.
     *
     * @remarks Box height is `Util.lineHeightPx()` plus the component's own
     * chrome (insets, padding, border); recomputed on every theme change so
     * font-size adjustments propagate to the layout hint automatically. Width
     * is read back from the already-resolved constraint — a caller override,
     * or `defaultWidth` on the very first call — so only the height component
     * changes on a theme change.
     */
    protected applySingleLineBox(h: number, defaultWidth: number): void {
        this.pinSingleLineBoxHeight(h);

        const width = this.getPreferredSizeConstraint()?.width ?? defaultWidth;
        this.setPreferredSize({ width, height: h });

        const maxWidth = this.getMaxSizeConstraint()?.width ?? UNBOUNDED;
        this.setMaxSize({ width: maxWidth, height: h });

        // Min-height pinned to the single-line box so the field can't be
        // vertically compressed below one line; min-width preserves whatever
        // was already resolved (a caller override, or 0 by default) instead of
        // re-asserting a literal on every call.
        const minWidth = this.getMinSizeConstraint()?.width ?? 0;
        this.setMinSize({ width: minWidth, height: h });
    }

    /**
     * Points this instance at the shared `.ClassName.h<px>` rule for a
     * single-line box height, so every instance of this concrete class that
     * resolves the same height shares one CSS rule instead of each writing its
     * own `min-height`/`max-height` pair. Called from {@link applySingleLineBox}
     * *before* the matching `setPreferredSize`/`setMaxSize`/`setMinSize` writes:
     * on an already-rendered component those setters flush immediately, and a
     * flush that runs against the previous height's value class writes the new
     * height to this instance's own rule, where it outranks the shared one for
     * good.
     *
     * @param h - The single-line box height in pixels, as
     *   {@link Util.singleLineBoxHeight} computed it.
     *
     * @remarks The widths in the patch are pinned to the framework baseline
     * (`0` / `UNBOUNDED`) rather than read back from this instance, so the
     * shared rule's `min-width`/`max-width` declarations are the same inert
     * pair for every instance. Reading this instance's real widths instead
     * would bake whichever instance minted the rule first into every later
     * instance's comparison, and a field with a different width would then
     * write a width declaration to its own rule that it does not write today.
     */
    private pinSingleLineBoxHeight(h: number): void {
        this.setValueStyleState("h", h + "px", {
            minSize: { width: 0,         height: h },
            maxSize: { width: UNBOUNDED, height: h },
        });
    }

    /**
     * Applies an {@link AbstractInputOptions} bag, caching the `enabled` /
     * `readOnly` flags on `_options`. The setters are intentionally NOT
     * dispatched here: subclasses build their children after `super()`
     * returns and dispatch `applyEnabled` / `applyReadOnly` themselves from
     * the constructor tail once those children exist (otherwise the abstract
     * `applyX` hooks would fire against half-built state).
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        if (options.enabled  !== undefined) this._options.enabled  = options.enabled;
        if (options.readOnly !== undefined) this._options.readOnly = options.readOnly;

        return this;
    }
}

export { AbstractInput };
