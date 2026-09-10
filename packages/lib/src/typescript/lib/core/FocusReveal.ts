// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

/**
 * A container that can bring one of its hidden descendants into a focusable
 * state — select its tab, expand its collapsed region, scroll it into view.
 * Implemented by [`Tab`](/api/layout/classes/Tab), [`Border`](/api/layout/classes/Border),
 * [`Accordion`](/api/layout/classes/Accordion), [`Split`](/api/layout/classes/Split),
 * and the scroll {@link Panel}.
 *
 * @category Core
 */
export interface FocusRevealer {
    /** The container's own element, used for containment + outermost-first ordering. Null when unrendered. */
    getRevealElement(): Handle | null;
    /** Reveal whichever of this container's regions/children is on the DOM path to `target`. */
    revealDescendant(target: Handle): void;
}

const _revealers = new Set<FocusRevealer>();

/**
 * Broker that lets {@link FocusHistory} (or any other consumer) surface a
 * hidden focus target before focusing it. Hiding containers register
 * themselves as {@link FocusRevealer}s; {@link reveal} invokes every
 * registered revealer whose element contains a given target, outermost-first,
 * so an outer container (e.g. a `Tab` selecting the tab that makes an inner
 * scroll `Panel` measurable) acts before an inner one.
 *
 * @category Core
 */
export namespace FocusReveal {
    /**
     * Registers `revealer` so future {@link reveal} / {@link containing} calls
     * consider it. Idempotent — registering an already-registered revealer is a
     * no-op (backed by a `Set`).
     *
     * @param revealer - The container entering the registry.
     */
    export function register(revealer: FocusRevealer): void {
        _revealers.add(revealer);
    }

    /**
     * Unregisters `revealer`. Idempotent — unregistering one not currently
     * registered is a no-op.
     *
     * @param revealer - The container leaving the registry.
     */
    export function unregister(revealer: FocusRevealer): void {
        _revealers.delete(revealer);
    }

    /**
     * Registered revealers whose element contains `target`, outermost-first.
     * Prunes any revealer whose element has *rendered and then gone* (a
     * container GC'd without `detach` — the leak guard); one whose element is
     * still `null` (not yet rendered — `attach()` can run before first render)
     * is skipped for this call but stays registered.
     *
     * @param target - The element to find containing revealers for.
     * @returns The containing revealers, outermost-first.
     */
    export function containing(target: Handle): FocusRevealer[] {
        const found: Array<{ revealer: FocusRevealer; el: Handle }> = [];

        for (const revealer of _revealers) {
            const el = revealer.getRevealElement();

            if (el === null) {
                continue;
            }

            if (!DOM.source.isConnected(el)) {
                _revealers.delete(revealer);
                continue;
            }

            if (DOM.source.contains(el, target)) {
                found.push({ revealer, el });
            }
        }

        // Outermost-first: an outer container must select/expand before an inner
        // one can measure. All entries are nested (each contains `target`), so
        // this containment comparator is a total order over them.
        found.sort((a, b) =>
            DOM.source.contains(a.el, b.el) ? -1 : DOM.source.contains(b.el, a.el) ? 1 : 0);

        return found.map(entry => entry.revealer);
    }

    /**
     * Reveals `target` by invoking `revealDescendant` on every registered
     * revealer containing it, outermost-first.
     *
     * @param target - The element to reveal.
     * @returns `false` when `target` is disconnected (nothing to reveal);
     *   `true` otherwise.
     */
    export function reveal(target: Handle): boolean {
        if (!DOM.source.isConnected(target)) {
            return false;
        }

        for (const revealer of containing(target)) {
            revealer.revealDescendant(target);
        }

        return true;
    }
}
