// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { InlineStyle } from "~/core/StyleTarget.js";

/**
 * Small helpers for playing CSS transitions on raw DOM elements.
 *
 * @remarks
 * The framework's animation surface today is intentionally narrow: a single
 * `play(element, config)` function that drives an entrance OR exit transition
 * on one element, plus an `isReducedMotion()` predicate the call sites use
 * to short-circuit. Both [`Notification`](/api/core/classes/Notification) and
 * [`Dialog`](/api/core/classes/Dialog) build their entrance/dismiss flows
 * on top of this utility so the two-RAF flush, transition wiring, and
 * `transitionend`-with-fallback bookkeeping live in one place.
 *
 * @category Core
 */
export namespace Animation {

    /**
     * Configuration for {@link Animation.play}.
     *
     * @category Core
     */
    export interface PlayConfig {
        /**
         * Optional styles applied to the element BEFORE the transition kicks
         * in. Use this for entrance animations to set the off-screen / invisible
         * "from" state. Omit for exit transitions whose start state is whatever
         * the element currently renders.
         */
        from?: Partial<CSSStyleDeclaration>;

        /** Styles applied with the transition active — the "to" state. */
        to: Partial<CSSStyleDeclaration>;

        /** Transition duration in milliseconds. */
        durationMs: number;

        /**
         * CSS property names included in the generated `transition` shorthand.
         * Example: `["opacity", "transform"]`.
         */
        properties: string[];

        /** CSS easing function. Defaults to `"ease-out"`. */
        easing?: string;

        /**
         * Called when the transition completes (or is skipped because of
         * reduced motion). Always fires exactly once.
         */
        onComplete?: () => void;

        /**
         * Milliseconds added to {@link PlayConfig.durationMs} for the fallback
         * `setTimeout` that fires if `transitionend` never arrives (tab switch,
         * interrupted transition, …). Defaults to 40 ms.
         */
        fallbackBufferMs?: number;
    }

    /**
     * Returns `true` when the user has requested reduced motion via
     * `prefers-reduced-motion: reduce`.
     *
     * @returns Whether motion-reducing UI rules should apply.
     */
    export function isReducedMotion(): boolean {
        return DOM.source.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    /**
     * Plays a CSS transition on the given element.
     *
     * @param el - Target element.
     * @param config - Animation parameters.
     *
     * @remarks
     * When {@link PlayConfig.from} is supplied the helper applies it first,
     * lets the browser settle for two animation frames (one alone still races
     * layout in Firefox), then applies the transition shorthand and the `to`
     * styles. Without `from` the transition fires immediately, taking the
     * element's current inline styles as the start state.
     *
     * Honours `prefers-reduced-motion: reduce`: when set, the `to` styles are
     * applied synchronously and `onComplete` fires on the same tick.
     */
    export function play(el: Handle, config: PlayConfig): void {
        const easing   = config.easing ?? "ease-out";
        const fallback = config.fallbackBufferMs ?? 40;

        // Route every write through the framework's deferred inline-style
        // buffer rather than touching `el.style` directly. `attach()` flushes
        // synchronously so subsequent `set` / `setMany` calls land on the
        // live element. The buffer is scoped to this `play()` invocation;
        // each call gets a fresh wrapper bound to `el`.
        const buf = new InlineStyle();
        buf.attach(el);

        if (isReducedMotion()) {
            buf.setMany(config.to as Record<string, string | null>);
            config.onComplete?.();
            return;
        }

        const applyTransitionAndTo = (): void => {
            buf.set(
                "transition",
                config.properties
                    .map(p => `${p} ${config.durationMs}ms ${easing}`)
                    .join(", "),
            );

            buf.setMany(config.to as Record<string, string | null>);

            let done = false;
            const finish = (): void => {
                if (done) {
                    return;
                }
                done = true;

                // Clear the transition rule so subsequent style changes
                // (e.g. a Window drag setting `transform: translate(...)`
                // after the entrance fade) aren't retroactively animated
                // through it. Done before `onComplete` so callers that
                // start a fresh `play()` from the callback can install
                // their own transition without it being clobbered.
                buf.set("transition", null);

                config.onComplete?.();
            };

            DOM.sink.addListener(el, "transitionend", finish, { once: true });
            setTimeout(finish, config.durationMs + fallback);
        };

        if (config.from) {
            buf.setMany(config.from as Record<string, string | null>);
            DOM.sink.requestAnimationFrame(() => {
                DOM.sink.requestAnimationFrame(applyTransitionAndTo);
            });
        } else {
            applyTransitionAndTo();
        }
    }

    /**
     * Configuration for {@link Animation.afterTransition}.
     *
     * @category Core
     */
    export interface AfterTransitionConfig {
        /**
         * Component whose `transitionend` event to listen for. The event must
         * fire on this component's own element (not a descendant) for the
         * filter to match.
         */
        component: Component;

        /**
         * Optional CSS property filter — `onComplete` fires only when the
         * transition of the named property ends. Other property completions
         * (e.g. a concurrent `top` transition on a multi-property declaration)
         * are ignored. Omit to fire on the first transitionend of any property.
         */
        property?: string;

        /**
         * Transition duration in milliseconds, used to size the fallback timer
         * that guarantees `onComplete` fires even when `transitionend` doesn't
         * (toggling between identical values, tab switch mid-transition, …).
         */
        durationMs: number;

        /**
         * Milliseconds added to {@link AfterTransitionConfig.durationMs} for
         * the fallback `setTimeout`. Defaults to 40 ms.
         */
        fallbackBufferMs?: number;

        /**
         * Invoked when the transition completes (via `transitionend`) or when
         * the fallback timer fires. Always called exactly once.
         */
        onComplete: () => void;
    }

    /**
     * Wires up a one-shot completion handler for a CSS transition installed
     * on a Component out-of-band — i.e. when the "to" styles are written by
     * something other than this helper, so {@link Animation.play} doesn't fit.
     *
     * @param config - The component, property filter, duration, and callback.
     *
     * @remarks Mirrors the `transitionend`-with-`setTimeout`-fallback
     * bookkeeping in {@link Animation.play} so layouts that install
     * transitions outside `play()` (notably the
     * [`Accordion`](/api/layout/classes/Accordion), whose section heights are
     * written by the parent layout's `getPreferredSize` query) stay
     * consistent with the framework's one-finish-only contract.
     */
    export function afterTransition(config: AfterTransitionConfig): void {
        const el = config.component.getElement();

        if (!el) {
            config.onComplete();
            return;
        }

        let done = false;
        const finish = (): void => {
            if (done) {
                return;
            }
            done = true;
            DOM.sink.removeListener(el, "transitionend", onEnd);
            config.onComplete();
        };
        const onEnd = (event: TransitionEvent): void => {
            if (config.property !== undefined && event.propertyName !== config.property) {
                return;
            }
            finish();
        };

        DOM.sink.addListener(el, "transitionend", onEnd);
        setTimeout(finish, config.durationMs + (config.fallbackBufferMs ?? 40));
    }

    /**
     * Configuration for {@link Animation.tween}.
     *
     * @category Core
     */
    export interface TweenConfig<T extends { [K in keyof T]: number }> {
        /** Starting values, keyed by property name. */
        from: T;

        /** Ending values. Must carry the same keys as `from`. */
        to: T;

        /** Tween duration in milliseconds. */
        durationMs: number;

        /**
         * Easing function mapping linear progress `t` (0..1) to eased progress.
         * Defaults to cubic ease-out (`1 - (1 - t)^3`).
         */
        easing?: (t: number) => number;

        /**
         * Invoked on every frame with the interpolated values for that tick.
         * Use this to route the values through typed setters or any other
         * write channel — `tween` does not assume DOM access.
         */
        onStep: (values: T) => void;

        /** Invoked once when the tween completes naturally. Not called on cancel. */
        onComplete?: () => void;
    }

    /**
     * Handle returned by {@link Animation.tween}. Call `cancel()` to stop the
     * tween mid-flight; subsequent calls are no-ops.
     *
     * @category Core
     */
    export interface TweenHandle {
        /** Stops the rAF loop. Idempotent. */
        cancel(): void;
    }

    /**
     * Drives a JS-side numeric tween via `requestAnimationFrame`, interpolating
     * every key in `from` toward the matching key in `to` over `durationMs`.
     *
     * @param config - Start/end values, duration, easing, step / complete hooks.
     * @returns A handle whose `cancel()` aborts the rAF loop.
     *
     * @remarks Honours `prefers-reduced-motion: reduce` by invoking
     * `onStep(to)` and `onComplete` synchronously, then returning a no-op
     * handle. Each frame's interpolated values are passed as a freshly
     * allocated object — callers may keep the reference. Use this for
     * numeric tweens that have to route through the framework's typed setters
     * (window-rect transitions, scroll-to, animated layout swaps); for raw
     * CSS-property transitions use {@link Animation.play} instead.
     */
    export function tween<T extends { [K in keyof T]: number }>(config: TweenConfig<T>): TweenHandle {
        if (isReducedMotion()) {
            config.onStep(config.to);
            config.onComplete?.();

            return { cancel: (): void => {} };
        }

        const startTime = performance.now();
        const ease      = config.easing ?? defaultTweenEase;

        let frameId: number | null = null;

        const step = (now: number): void => {
            const elapsed = now - startTime;
            const t       = Math.min(1, elapsed / config.durationMs);
            const k       = ease(t);

            const values = {} as T;
            for (const key in config.from) {
                const f      = config.from[key];
                const target = config.to[key];
                values[key]  = (f + (target - f) * k) as T[Extract<keyof T, string>];
            }

            config.onStep(values);

            if (t < 1) {
                frameId = DOM.sink.requestAnimationFrame(step);

                return;
            }

            frameId = null;
            config.onComplete?.();
        };

        frameId = DOM.sink.requestAnimationFrame(step);

        return {
            cancel: (): void => {
                if (frameId === null) {
                    return;
                }

                DOM.sink.cancelAnimationFrame(frameId);
                frameId = null;
            },
        };
    }

    const defaultTweenEase = (t: number): number => {
        const u = 1 - t;

        return 1 - u * u * u;
    };

    /** Default duration of the cross-fade between spinner and materialized content. */
    const MATERIALIZE_FADE_DURATION_MS = 160;

    /**
     * Configuration for {@link Animation.materialize}.
     *
     * @category Core
     */
    export interface MaterializeConfig {
        /**
         * Container that hosts the spinner during the yield and receives the
         * factory's output once it has been built. The spinner is added as a
         * child of this component and removed once the cross-fade completes.
         */
        host: Component;

        /**
         * Synchronous component factory. Runs after the two-rAF yield so the
         * spinner has reached the screen before the main-thread build cost
         * is incurred.
         */
        factory: () => Component;

        /**
         * Caller-constructed spinner component (typically a `ProgressSpinner`
         * wrapped in a centring layout). Passed in rather than created here
         * so `~/core/Animation` stays free of `~/component/display` imports
         * — and so call sites can customise the spinner shape per surface.
         */
        spinnerComponent: Component;

        /**
         * Duration of the opacity transition that fades the built component
         * in over the spinner.
         *
         * @defaultValue 160
         */
        fadeMs?: number;

        /**
         * Fires after the materialized component's fade-in completes (or
         * immediately when reduced-motion is set). Receives the component
         * the factory returned so the caller can wire up post-attach state.
         */
        onReady?: (component: Component) => void;
    }

    /**
     * Mounts the spinner, yields two animation frames so it actually reaches
     * the screen, runs the factory, then cross-fades the built component in
     * over the spinner. Both `Tab.materializeAsync` and `Window.show` (when
     * a content factory is set) drive activation through this helper so the
     * yield-and-fade lifecycle lives in one place.
     *
     * @param config - Host, factory, spinner, and fade options.
     *
     * @remarks Two `requestAnimationFrame` callbacks are needed because a
     * single rAF still races layout in Firefox — the same two-rAF dance
     * `play()` performs for entrance transitions. The spinner is removed in
     * the fade's `onComplete` so the brief overlap reads as "spinner fades
     * into content" without an extra animation.
     */
    export function materialize(config: MaterializeConfig): void {
        const host    = config.host;
        const factory = config.factory;
        const spinner = config.spinnerComponent;
        const fadeMs  = config.fadeMs ?? MATERIALIZE_FADE_DURATION_MS;

        host.addComponent(spinner);
        host.scheduleLayout();

        DOM.sink.requestAnimationFrame(() => {
            DOM.sink.requestAnimationFrame(() => {
                const component = factory();
                host.addComponent(component);

                const el = component.getElement(true)!;
                host.scheduleLayout();

                play(el, {
                    from:       { opacity: "0" },
                    to:         { opacity: "1" },
                    durationMs: fadeMs,
                    properties: ["opacity"],
                    onComplete: () => {
                        host.removeComponent(spinner);
                        host.scheduleLayout();
                        config.onReady?.(component);
                    },
                });
            });
        });
    }
}
