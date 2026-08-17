// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Internal helper backing `Component._defaultOptions`. Not exported from
// `core/index.ts` — this module exists purely to give every concrete
// `Component` subclass one shared, frozen defaults bag instead of a fresh
// object literal per instance. See
// plans/implemented/per-class-component-defaults.md for the rationale.

import { UNBOUNDED } from "~/primitive/Size.js";
import { Insets } from "~/primitive/Insets.js";

const ZERO_INSETS   = Object.freeze(new Insets(0, 0, 0, 0));
const ZERO_MIN_SIZE = Object.freeze({ width: 0,         height: 0 });
const UNBOUNDED_MAX = Object.freeze({ width: UNBOUNDED, height: UNBOUNDED });

const BASE_DEFAULTS = Object.freeze({
    cursor    : "default",
    // Framework-wide "chrome is not selectable" default, the peer of `cursor`
    // above: `getUserSelect()` folds `_defaultOptions` and is read at render by
    // `applyMiscInlineStyles`, so the base value has to live here rather than in
    // a constructor seed — otherwise every stock component reports null and the
    // `:where(.ts-ui-component)` rule's `user-select: none` is the only thing
    // holding the behaviour up. A class that wants selectable text overrides it
    // through its own defaults bag (see `SelectableText`, `Link`, `Markdown`).
    userSelect: "none",
    insets    : ZERO_INSETS,
    minSize   : ZERO_MIN_SIZE,
    maxSize   : UNBOUNDED_MAX,
    // `hidden` is deliberate and load-bearing beyond just clipping: it
    // visually EXPOSES layout-calculation bugs. When a layout lays a
    // child out larger than the box its parent sized for it — i.e. when
    // `getPreferredSize`/`getMinSize` under-report what `doLayout`
    // actually produces — the overflow is clipped rather than silently
    // spilling, so the size-negotiation mistake shows up on screen
    // instead of hiding. Don't relax this to "fix" a clip; find the
    // preferred-vs-doLayout discrepancy it revealed.
    overflow  : "hidden",
    zIndex    : 0,
    displayed : true,
});

interface CacheEntry { bag: object; keys: string[]; }

// Keyed on the class constructor itself, not `constructor.name` — class
// names are not unique in this tree (e.g. `class Body` is declared twice)
// and a name key would also depend on minifier `keepNames` settings. See
// the plan's `[^ctor-key]` footnote.
const cache = new Map<Function, CacheEntry>();

/**
 * Returns `true` when `supplied` carries exactly the same defaulted keys as
 * `entry`, each equal by reference/value to what `entry.bag` already holds —
 * i.e. `entry.bag` is safe to reuse for this construction. The length check
 * matters: without it, a class that supplies a key on one construction and
 * omits it on the next would silently inherit the stale value from the
 * cached bag.
 */
function matches(entry: CacheEntry, supplied: Record<string, unknown>, keys: string[]): boolean {
    if (entry.keys.length !== keys.length) {
        return false;
    }

    return keys.every(key => (entry.bag as Record<string, unknown>)[key] === supplied[key]);
}

/**
 * Resolves the shared, frozen `_defaultOptions` bag for a `Component`
 * subclass, caching the first bag built for each class constructor so every
 * later instance of that class reuses the same object instead of allocating
 * a fresh literal.
 *
 * @param ctor - The concrete class constructor (`this.constructor` from the
 *   `Component` constructor), used as the cache key.
 * @param subclassDefaults - The subclass's own default bag, as passed to
 *   `super(options, subclassDefaults)`. `layoutManager` is excluded from both
 *   the cache key and the returned bag — it never shares across instances,
 *   see `Component._defaultLayoutManager`.
 *
 * @returns A frozen defaults bag: the base `Component` defaults overlaid
 *   with `subclassDefaults`. Reused across instances of the same class when
 *   `subclassDefaults` is identical to the first construction's; a class
 *   whose `subclassDefaults` vary per instance (e.g. `Panel`'s `flush`
 *   option) gets its own private frozen bag on a mismatch, without
 *   disturbing the cached entry.
 */
export function resolveClassDefaults<TOptions>(
    ctor: Function,
    subclassDefaults: Partial<TOptions> | undefined,
): Readonly<TOptions> {
    const supplied = (subclassDefaults ?? {}) as Record<string, unknown>;
    const keys     = Object.keys(supplied).filter(k => k !== "layoutManager");
    const entry    = cache.get(ctor);

    if (entry && matches(entry, supplied, keys)) {
        return entry.bag as Readonly<TOptions>;
    }

    const bag: Record<string, unknown> = { ...BASE_DEFAULTS };
    for (const key of keys) {
        bag[key] = supplied[key];
    }
    Object.freeze(bag);

    if (!entry) {
        cache.set(ctor, { bag, keys });
    }

    return bag as Readonly<TOptions>;
}
