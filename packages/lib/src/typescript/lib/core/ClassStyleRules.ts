// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Internal helper backing Component's three-tier style-rule split (framework
// / class / instance). Not exported from `core/index.ts` — this module
// exists purely to derive and register the framework-wide and per-class
// shared `StyleRule`s that `Component.applyStyle` consults through
// `writeRuleDeclaration`. See
// plans/implemented/class-scoped-style-rules.md for the rationale.

import { StyleRule }   from "~/core/StyleTarget.js";
import { Position }    from "~/primitive/Position.js";
import { isUnbounded } from "~/primitive/Size.js";

/** The CSS class every rendered component element carries. */
export const COMPONENT_CLASS = "ts-ui-component";

// `:where()` computes to zero specificity, so both `.ClassName` and `#id`
// outrank this rule whatever order the sheet ends up in.
const FRAMEWORK_SELECTOR = ":where(." + COMPONENT_CLASS + ")";

/**
 * The class-default fields a rule body is derived from — the subset of
 * `Component._defaultOptions` that feeds the thirteen hoistable
 * declarations. Typed structurally rather than as `ComponentOptions` so this
 * module does not import from `core/Component.ts` and no import cycle forms.
 */
interface ClassStyleDefaults {
    visible?:   boolean | null;
    displayed?: boolean;
    minSize?:   { width: number; height: number } | null;
    maxSize?:   { width: number; height: number } | null;
    overflow?:  string | null;
}

type ClassStyleBag = Readonly<Record<string, string>>;

// The thirteen hoistable keys at the value Component's own defaults resolve to.
const FRAMEWORK_DECLARATIONS: ClassStyleBag = Object.freeze({
    boxSizing:  "border-box",
    position:   Position.ABSOLUTE,
    display:    "block",
    visibility: "inherit",
    whiteSpace: "nowrap",
    userSelect: "none",
    margin:     "0px 0px 0px 0px",
    minWidth:   "0px",
    minHeight:  "0px",
    maxWidth:   "none",
    maxHeight:  "none",
    overflowX:  "hidden",
    overflowY:  "hidden",
});

// Per-class inherited declarations: the framework body with this class's
// deviations merged over it. A `null` entry means the class opted out (its
// selector is owned by a different constructor, or it is anonymous).
const _bags: Map<Function, ClassStyleBag | null> = new Map();

// Selector owner, so a name shared by two classes is detected.
const _owners: Map<string, Function> = new Map();

let _frameworkRuleCreated = false;

function ensureFrameworkStyleRule(): void {
    if (_frameworkRuleCreated) {
        return;
    }

    _frameworkRuleCreated = true;

    new StyleRule({ scope: "selector", name: FRAMEWORK_SELECTOR, styles: { ...FRAMEWORK_DECLARATIONS } });
}

/**
 * The thirteen declarations an instance of this class produces from defaults
 * alone. A key the phase would *not* write gets the value that reproduces "no
 * declaration", so the framework rule's value is undone rather than inherited.
 */
function resolveDeclarations(defaults: ClassStyleDefaults): Record<string, string> {
    const minSize  = defaults.minSize  ?? null;
    const maxSize  = defaults.maxSize  ?? null;
    const overflow = defaults.overflow ?? null;

    return {
        boxSizing:  "border-box",
        position:   Position.ABSOLUTE,
        display:    (defaults.displayed ?? true) ? "block" : "none",
        visibility: (defaults.visible ?? null) === false ? "hidden" : "inherit",
        whiteSpace: "nowrap",
        userSelect: "none",
        margin:     "0px 0px 0px 0px",
        minWidth:   minSize ? minSize.width  + "px" : "auto",
        minHeight:  minSize ? minSize.height + "px" : "auto",
        maxWidth:   maxSize ? (isUnbounded(maxSize.width)  ? "none" : maxSize.width  + "px") : "none",
        maxHeight:  maxSize ? (isUnbounded(maxSize.height) ? "none" : maxSize.height + "px") : "none",
        overflowX:  overflow ?? "visible",
        overflowY:  overflow ?? "visible",
    };
}

/** The subset of `resolveDeclarations` that differs from the framework rule. */
function classDeviations(defaults: ClassStyleDefaults): Record<string, string> {
    const resolved = resolveDeclarations(defaults);
    const out: Record<string, string> = {};

    for (const key of Object.keys(resolved)) {
        if (resolved[key] !== FRAMEWORK_DECLARATIONS[key]) {
            out[key] = resolved[key];
        }
    }

    return out;
}

/**
 * Ensures the framework-wide `:where(.ts-ui-component)` rule exists and,
 * when `ctor`'s resolved defaults deviate from it, ensures a `.ClassName`
 * rule carrying only those deviations. Idempotent per `ctor` — the first
 * call for a class computes and registers the rule(s); every later call
 * (including from other instances of the same class) returns the cached
 * result without touching the stylesheet again.
 *
 * @param ctor - The concrete component class constructor (`this.constructor`
 *   from `Component`), used as the cache key. `ctor.name` is not unique in
 *   this tree, so the constructor itself — not its name — is what identifies
 *   the class; the name is only used to derive the CSS selector.
 * @param defaults - The class's frozen `_defaultOptions` bag (or a
 *   structurally-compatible subset of it).
 *
 * @returns The inherited declaration bag — the framework declarations with
 *   this class's deviations merged over them, mirroring what the cascade
 *   delivers to one of its elements from the two lower tiers. `null` when
 *   `ctor`'s name is empty (an anonymous class) or already claimed by a
 *   different constructor — the name-collision opt-out — in which case the
 *   caller must write every hoistable declaration to its own `#id` rule.
 */
export function ensureClassStyleRule(
    ctor: Function,
    defaults: ClassStyleDefaults,
): ClassStyleBag | null {
    const existing = _bags.get(ctor);

    if (existing !== undefined) {
        return existing;
    }

    ensureFrameworkStyleRule();

    const name  = ctor.name;
    const owner = _owners.get(name);

    if (!name || (owner !== undefined && owner !== ctor)) {
        _bags.set(ctor, null);

        return null;
    }

    const deviations = classDeviations(defaults);

    // Claim the selector whether or not a rule is inserted, so a second class
    // of the same name still opts out. An empty body would insert a rule that
    // declares nothing, so skip it.
    _owners.set(name, ctor);

    if (Object.keys(deviations).length > 0) {
        new StyleRule({ scope: "class", name, styles: deviations });
    }

    const inherited = Object.freeze({ ...FRAMEWORK_DECLARATIONS, ...deviations });

    _bags.set(ctor, inherited);

    return inherited;
}
