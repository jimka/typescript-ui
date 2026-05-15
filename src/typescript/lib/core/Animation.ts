// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";

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
        return matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    export function play(el: HTMLElement, config: PlayConfig): void {
        const easing   = config.easing ?? "ease-out";
        const fallback = config.fallbackBufferMs ?? 40;

        if (isReducedMotion()) {
            Object.assign(el.style, config.to);
            config.onComplete?.();
            return;
        }

        const applyTransitionAndTo = (): void => {
            el.style.transition = config.properties
                .map(p => `${p} ${config.durationMs}ms ${easing}`)
                .join(", ");

            Object.assign(el.style, config.to);

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
                el.style.transition = "";

                config.onComplete?.();
            };

            el.addEventListener("transitionend", finish, { once: true });
            setTimeout(finish, config.durationMs + fallback);
        };

        if (config.from) {
            Object.assign(el.style, config.from);
            requestAnimationFrame(() => {
                requestAnimationFrame(applyTransitionAndTo);
            });
        } else {
            applyTransitionAndTo();
        }
    }

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

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const component = factory();
                host.addComponent(component);

                const el = component.getElement(true);
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
