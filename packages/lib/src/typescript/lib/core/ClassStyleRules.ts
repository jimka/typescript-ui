// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Internal helper backing Component's three-tier style-rule split (framework
// / class / instance). Not exported from `core/index.ts` — this module
// exists purely to derive and register the framework-wide and per-class
// shared `StyleRule`s that `Component.applyStyle` consults through
// `writeRuleDeclaration`. See
// plans/implemented/class-scoped-style-rules.md for the rationale.
//
// Also backs Button/ToggleButton's state-rule (`.pressed` / `:hover` /
// `.selected`) dedup, via the `ensureClassStateRule` / `writeClassStateDeclaration`
// / `writeManyClassStateDeclarations` sibling mechanism below — see
// plans/implemented/hoist-button-tabbar-state-chrome-rules.md.

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
 * `Component._defaultOptions` that feeds the fifteen hoistable
 * declarations. Typed structurally rather than as `ComponentOptions` so this
 * module does not import from `core/Component.ts` and no import cycle forms.
 */
export interface ClassStyleDefaults {
    visible?:         boolean | null;
    displayed?:       boolean;
    minSize?:         { width: number; height: number } | null;
    maxSize?:         { width: number; height: number } | null;
    overflow?:        string | null;
    cursor?:          string | null;
    userSelect?:      string | null;
    outline?:         string | null;
    foregroundColor?: string | null;
    font?:            TextClassStyleDefaults | null;
}

/**
 * The class-uniform font/text declarations a `Text`-family class produces
 * from its own defaults alone. Namespaced under `ClassStyleDefaults.font`
 * rather than added as flat keys: `Glyph` (component/display/Glyph.ts),
 * `TabBar` (component/container/TabBar.ts), and `TextInput`
 * (component/input/TextInput.ts) each declare their own, differently-typed
 * `fontSize`/`lineHeight`/`textAlign` options — flat keys of the same name
 * would silently leak their unrelated defaults into this bag, since
 * `Component.applyStyle`'s default `getClassStyleDefaults()` passes
 * `_defaultOptions` through verbatim for every class that doesn't override
 * it. Only `Text.getClassStyleDefaults()` ever sets `font`.
 */
interface TextClassStyleDefaults {
    fontFamily?:     string | null;
    fontKerning?:    string | null;
    fontSize?:       string | null;   // CSS-ready value, e.g. "var(--ts-ui-font-size, 14px)"
    fontSizeAdjust?: string | null;
    fontStretch?:    string | null;
    fontStyle?:      string | null;
    fontVariant?:    string | null;
    fontWeight?:     string | null;
    textAlign?:      string | null;
    textShadow?:     string | null;
    lineHeight?:     string | null;   // CSS-ready value, e.g. "calc(1em + var(--ts-ui-line-padding, 2px))"
    textOverflow?:   string | null;   // pre-resolved from `truncate`; see Text.getClassStyleDefaults
}

type ClassStyleBag = Readonly<Record<string, string | null>>;

// The fifteen hoistable keys at the value Component's own defaults resolve to.
const FRAMEWORK_DECLARATIONS: ClassStyleBag = Object.freeze({
    boxSizing:  "border-box",
    position:   Position.ABSOLUTE,
    display:    "block",
    visibility: "inherit",
    whiteSpace: "nowrap",
    userSelect: "none",
    cursor:     "default",
    border:     null,
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
 * The fifteen declarations an instance of this class produces from defaults
 * alone. A key the phase would *not* write gets the value that reproduces "no
 * declaration", so the framework rule's value is undone rather than inherited.
 */
function resolveDeclarations(defaults: ClassStyleDefaults): Record<string, string | null> {
    const minSize  = defaults.minSize  ?? null;
    const maxSize  = defaults.maxSize  ?? null;
    const overflow = defaults.overflow ?? null;

    const declarations: Record<string, string | null> = {
        boxSizing:  "border-box",
        position:   Position.ABSOLUTE,
        display:    (defaults.displayed ?? true) ? "block" : "none",
        visibility: (defaults.visible ?? null) === false ? "hidden" : "inherit",
        whiteSpace: "nowrap",
        userSelect: defaults.userSelect ?? "none",
        cursor:     defaults.cursor ?? "default",
        border:     null,
        margin:     "0px 0px 0px 0px",
        minWidth:   minSize ? minSize.width  + "px" : "auto",
        minHeight:  minSize ? minSize.height + "px" : "auto",
        maxWidth:   maxSize ? (isUnbounded(maxSize.width)  ? "none" : maxSize.width  + "px") : "none",
        maxHeight:  maxSize ? (isUnbounded(maxSize.height) ? "none" : maxSize.height + "px") : "none",
        overflowX:  overflow ?? "visible",
        overflowY:  overflow ?? "visible",
    };

    // outline/color are conditional: most classes declare neither, and
    // Component only ever writes them when non-null (see applyChromeStyles /
    // applyBoxAndVisibilityStyles), so an absent key here must stay absent —
    // never introduce a key with value `undefined`.
    if (defaults.outline)         declarations.outline = defaults.outline;
    if (defaults.foregroundColor) declarations.color   = defaults.foregroundColor;

    const font = defaults.font;
    if (font?.fontFamily)     declarations.fontFamily     = font.fontFamily;
    if (font?.fontKerning)    declarations.fontKerning    = font.fontKerning;
    if (font?.fontSize)       declarations.fontSize       = font.fontSize;
    if (font?.fontSizeAdjust) declarations.fontSizeAdjust = font.fontSizeAdjust;
    if (font?.fontStretch)    declarations.fontStretch    = font.fontStretch;
    if (font?.fontStyle)      declarations.fontStyle      = font.fontStyle;
    if (font?.fontVariant)    declarations.fontVariant    = font.fontVariant;
    if (font?.fontWeight)     declarations.fontWeight     = font.fontWeight;
    if (font?.textAlign)      declarations.textAlign      = font.textAlign;
    if (font?.textShadow)     declarations.textShadow     = font.textShadow;
    if (font?.lineHeight)     declarations.lineHeight     = font.lineHeight;
    if (font?.textOverflow)   declarations.textOverflow   = font.textOverflow;

    return declarations;
}

/** The subset of `resolveDeclarations` that differs from the framework rule. */
function classDeviations(defaults: ClassStyleDefaults): Record<string, string | null> {
    const resolved = resolveDeclarations(defaults);
    const out: Record<string, string | null> = {};

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

// (ctor -> (suffix -> bag)). Parallel to `_bags`, but keyed on suffix too, since
// one class can own several state rules (Button: .pressed, :hover:not(.pressed)).
const _stateBags: Map<Function, Map<string, ClassStyleBag | null>> = new Map();

/**
 * State-rule sibling of {@link ensureClassStyleRule}. Ensures a shared
 * `.ClassName<suffix>` rule exists carrying `declarations` and returns the
 * bag, so the caller's setters can skip a write that already matches it.
 * Cached per `(ctor, suffix)` — the first call for a given class+suffix
 * computes and registers the rule; every later call (any instance, any
 * suffix already seen for that class) returns the cached result.
 *
 * Unlike `ensureClassStyleRule`, there is no framework-level tier beneath a
 * state rule to diff against — `declarations` is the caller's own fully
 * resolved bag, not a set of deviations from a lower tier.
 *
 * @param ctor - The concrete component class constructor.
 * @param suffix - The selector suffix, verbatim (e.g. `".pressed"`,
 *   `":hover:not(.pressed)"`), matching whatever the instance rule's own
 *   `createStyleRule(suffix)` call uses.
 * @param declarations - This class's resolved declarations for the
 *   suffixed state.
 *
 * @returns The declarations bag, or `null` when `ctor`'s name is empty or
 *   already claimed by a different constructor (the same name-collision
 *   opt-out `ensureClassStyleRule` uses) — the caller must then write every
 *   declaration to its own instance rule.
 */
export function ensureClassStateRule(
    ctor: Function,
    suffix: string,
    declarations: Record<string, string | null>,
): ClassStyleBag | null {
    let bySuffix = _stateBags.get(ctor);
    if (!bySuffix) {
        bySuffix = new Map();
        _stateBags.set(ctor, bySuffix);
    }

    const existing = bySuffix.get(suffix);
    if (existing !== undefined) {
        return existing;
    }

    const name  = ctor.name;
    const owner = _owners.get(name);

    if (!name || (owner !== undefined && owner !== ctor)) {
        bySuffix.set(suffix, null);

        return null;
    }

    _owners.set(name, ctor);

    if (Object.keys(declarations).length > 0) {
        new StyleRule({ scope: "class", name, suffix, styles: declarations });
    }

    const bag = Object.freeze({ ...declarations });
    bySuffix.set(suffix, bag);

    return bag;
}

/**
 * Routes one state-rule declaration to the rule that should carry it:
 * dropped when `bag` already delivers the same key/value, written to `rule`
 * otherwise. `writeRuleDeclaration`'s shape, generalised to take the target
 * rule and comparison bag as parameters instead of reading `this._styleRule`
 * / `this._inheritedStyleBag` — a state-rule setter can fire from many call
 * sites (construction, a runtime setter, a chrome-mode toggle), not from one
 * `applyStyle` pass, so there is no single per-render cache to read from.
 *
 * @remarks A `null` write can never itself win the cascade over a *non-null*
 * class-bag value for `key`: `null` maps to a CSSOM `removeProperty`, and a
 * declaration block that never declares `key` doesn't compete for it at
 * all — an unmaterialised (or materialised-but-empty) instance rule leaves
 * the class-tier rule's value in sole possession of the property regardless
 * of the instance rule's higher specificity. This routing function cannot
 * fix that generically (it has no per-property "neutral value" table to
 * substitute); see this plan's Implementation Notes for how the one
 * concrete case this surfaces (`Button`'s `pressedShadow`/`hoverShadow`,
 * cleared by `SpinButton`/`Dialog`/`Notification`'s close buttons) stays
 * correct today via each call site's paired base-tier `clearShadow()`.
 */
export function writeClassStateDeclaration(
    rule: StyleRule,
    bag: ClassStyleBag | null,
    key: string,
    value: string | null,
): void {
    if (bag !== null && bag[key] === value) {
        return;
    }

    rule.set(key, value);
}

/** Bulk form of {@link writeClassStateDeclaration}, one call per key of `values`. */
export function writeManyClassStateDeclarations(
    rule: StyleRule,
    bag: ClassStyleBag | null,
    values: Record<string, string | null>,
): void {
    for (const key of Object.keys(values)) {
        writeClassStateDeclaration(rule, bag, key, values[key]);
    }
}
