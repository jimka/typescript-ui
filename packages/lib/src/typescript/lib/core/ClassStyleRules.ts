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
// plans/implemented/hoist-button-tabbar-state-chrome-rules.md. This module
// also exposes `StateStyleRule`, the wrapper `Component.createStateStyleRule`
// returns — see plans/implemented/state-style-rule-auto-dedup.md.

import { StyleRule }   from "~/core/StyleTarget.js";
import { Position }    from "~/primitive/Position.js";
import { isUnbounded } from "~/primitive/Size.js";
import { type BorderOptions, borderToStyle } from "~/primitive/Border.js";

/** The CSS class every rendered component element carries. */
export const COMPONENT_CLASS = "ts-ui-component";

// `:where()` computes to zero specificity, so both `.ClassName` and `#id`
// outrank this rule whatever order the sheet ends up in.
const FRAMEWORK_SELECTOR = ":where(." + COMPONENT_CLASS + ")";

/**
 * The class-default fields a rule body is derived from — the subset of
 * `Component._defaultOptions` that feeds the hoistable declarations, some
 * unconditional and some (the chrome group and `font`) only present when the
 * class actually defaults them. Typed structurally rather than as
 * `ComponentOptions` so this module does not import from `core/Component.ts`
 * and no import cycle forms.
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
    backgroundColor?: string | null;
    backgroundImage?: string | null;
    shadow?:          string | null;
    borderRadius?:    string | null;
    border?:          BorderOptions | string | null;
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

// The `ClassStyleDefaults` input that reproduces `FRAMEWORK_DECLARATIONS` via
// `resolveDeclarations` — i.e. `Component`'s own true base defaults, used as
// the hierarchy walk's base case (the "ancestor" above `Component` itself).
// Every hoistable field's absent-value fallback inside `resolveDeclarations`
// already coincides with `FRAMEWORK_DECLARATIONS` *except* `minSize` and
// `overflow`, whose fallbacks (`"auto"` / `"visible"`) diverge from the
// framework's hoisted baseline (`"0px"` / `"hidden"`) — those two are
// restated here so a participating class that leaves them untouched (e.g.
// `Cell`, which customises only colour/background/border) still resolves
// them to the framework baseline instead of spuriously "deviating" on them,
// matching what an un-migrated (flat) class's own `_defaultOptions` merge
// chain already produces automatically via `Component`'s real base bag.
const FRAMEWORK_DEFAULTS: ClassStyleDefaults = Object.freeze({
    minSize:  { width: 0, height: 0 },
    overflow: "hidden",
});

// Per-class inherited declarations: the framework body with this class's
// deviations merged over it. A `null` entry means the class opted out (its
// selector is owned by a different constructor, or it is anonymous).
const _bags: Map<Function, ClassStyleBag | null> = new Map();

// Selector owner, so a name shared by two classes is detected.
const _owners: Map<string, Function> = new Map();

// The `Component` class itself, registered once by `core/Component.ts` at
// module load via `registerStyleChainRoot` — this module cannot import
// `Component` directly (it would form an import cycle, since Component
// imports this module). Every hierarchy walk (`resolveClassLevel`,
// `getStyleClassChain`) treats this constructor as the top: it never
// recurses past it (so `BaseObject` and anything above are never visited),
// and its own name never joins a DOM class list or claims a `.ClassName`
// rule — `Component` was never a meaningful CSS-styling target before this
// plan (only a concrete subclass's `this.constructor.name` was ever added),
// and this mechanism preserves that.
let _rootCtor: Function | null = null;

/**
 * Registers the topmost class the hierarchy walk should ever visit. Called
 * once, by `core/Component.ts` at module load. Canonicalized (see
 * `canonicalCtor`) so it matches regardless of whether the caller passes the
 * raw class or its `callable()` wrapper.
 */
export function registerStyleChainRoot(ctor: Function): void {
    _rootCtor = canonicalCtor(ctor);
}

let _frameworkRuleCreated = false;

function ensureFrameworkStyleRule(): void {
    if (_frameworkRuleCreated) {
        return;
    }

    _frameworkRuleCreated = true;

    new StyleRule({ scope: "selector", name: FRAMEWORK_SELECTOR, styles: { ...FRAMEWORK_DECLARATIONS } });
}

/**
 * The declarations an instance of this class produces from defaults alone. A
 * key the phase would *not* write gets the value that reproduces "no
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

    if (defaults.backgroundColor) declarations.backgroundColor = defaults.backgroundColor;
    if (defaults.backgroundImage) declarations.backgroundImage = defaults.backgroundImage;
    if (defaults.shadow)          declarations.boxShadow       = defaults.shadow;
    if (defaults.borderRadius)    declarations.borderRadius    = defaults.borderRadius;

    const border = defaults.border;
    if (border) {
        // `borderToStyle` always yields all four longhands, resolving each side
        // through `side ?? border ?? "none"` — the same expansion Component's own
        // border writers use, so the two tiers compare key for key.
        Object.assign(declarations, borderToStyle(typeof border === "string" ? { border } : border));
    }

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
 * A class's own, subclass-independent contribution to the hoistable style
 * defaults — the same shape as `ClassStyleDefaults`, but declared once per
 * class (not resolved per instance). A class that adds no hoistable default
 * of its own declares no field at all; `Component` declares none.
 *
 * Read only via an own-property check (`Object.prototype.hasOwnProperty`) —
 * never via a plain property read, which would report an inherited value
 * from whichever ancestor last declared the field. See
 * plans/implemented/class-hierarchy-cascade.md's Architecture Decisions.
 */
interface ClassStyleLevelHost {
    ownClassStyleDefaults?: ClassStyleDefaults;
}

/**
 * Normalizes a constructor reference — the raw class or its `callable()`
 * wrapper — to the same canonical (raw) reference, via
 * `ctor.prototype.constructor`. A `callable()` Proxy only traps `apply`;
 * every other operation (including a `prototype` read) forwards to the
 * wrapped target by default, and `callable()` never reassigns
 * `prototype.constructor`, so this always lands on the original class
 * regardless of which reference was passed in.
 *
 * This matters because the *same* conceptual class is reached through
 * *different* references depending on the path: `this.constructor` (an
 * instance's own leaf class) is always raw, but `Object.getPrototypeOf` on a
 * subclass returns whatever reference appeared in that subclass's `extends`
 * clause — always the callable, per ARCHITECTURE.md's "Imports always use
 * the callable name... This holds even for extends clauses." Without
 * normalizing, a class constructed directly (raw reference) and the same
 * class reached as a subclass's ancestor (callable reference) would be keyed
 * under two different `Map` entries, silently splitting its registration and
 * defeating the `_owners` name-collision check.
 */
function canonicalCtor(ctor: Function): Function {
    const proto = (ctor as { prototype?: { constructor?: Function } }).prototype;

    return proto?.constructor ?? ctor;
}

/** This class's fully-merged declaration bag plus the resolved CSS it
 *  produces — see {@link resolveClassLevel}. */
interface ResolvedClassLevel {
    /** This class's fully-merged `ClassStyleDefaults` — its own contribution
     *  layered onto every ancestor's, in the same shape `resolveDeclarations`
     *  consumes. */
    defaults: ClassStyleDefaults;
    /** `resolveDeclarations(defaults)` — this class's full resolved CSS bag,
     *  used both to diff the next level down and, at the leaf, as the
     *  instance-comparison bag `_inheritedStyleBag` needs. */
    resolved: ClassStyleBag;
}

// (ctor -> resolved level). Memoizes the hierarchy walk so a deep chain is
// only ever traversed once per constructor across the whole process.
const _levels: Map<Function, ResolvedClassLevel> = new Map();

/**
 * Own-property read of a class's `ownClassStyleDefaults` field — `null` when
 * this exact class doesn't declare one, regardless of what an ancestor
 * declares. A plain property read would silently return the nearest
 * ancestor's field once any ancestor defines one (normal JS static-member
 * inheritance), making every subclass that doesn't override it look like it
 * declares its parent's fields all over again — exactly wrong for a delta
 * computation.
 */
function ownDefaultsOf(ctor: Function): ClassStyleDefaults | null {
    return Object.prototype.hasOwnProperty.call(ctor, "ownClassStyleDefaults")
        ? ((ctor as unknown as ClassStyleLevelHost).ownClassStyleDefaults ?? null)
        : null;
}

/** Shallow merge — a subclass that redeclares `border` or `font` replaces
 *  the whole sub-value, matching how `_default<Name>Options` bags already
 *  merge through `subclassDefaults` object-spread forwarding. */
function mergeClassStyleDefaults(parent: ClassStyleDefaults, child: ClassStyleDefaults): ClassStyleDefaults {
    return { ...parent, ...child };
}

/** The subset of `resolved` that differs from `against` — `classDeviations`,
 *  generalised to diff against any resolved bag, not only the framework one. */
function deviationsFrom(resolved: ClassStyleBag, against: ClassStyleBag): Record<string, string | null> {
    const out: Record<string, string | null> = {};

    for (const key of Object.keys(resolved)) {
        if (resolved[key] !== against[key]) {
            out[key] = resolved[key];
        }
    }

    return out;
}

/**
 * Whether `ctor` or any ancestor up its `Object.getPrototypeOf` chain
 * declares an `ownClassStyleDefaults` field. A class outside this set is
 * untouched by this hierarchy mechanism — `ensureClassStyleRule` falls back
 * to its pre-hierarchy flat behaviour for it, since only a participating
 * chain's static fields can be trusted to reproduce a caller-supplied
 * instance's actual defaults (see `ensureClassStyleRule`'s own comment).
 */
function chainParticipates(ctor: Function): boolean {
    let cur: Function | null = canonicalCtor(ctor);

    while (typeof cur === "function" && cur.name) {
        if (ownDefaultsOf(cur) !== null) {
            return true;
        }

        const parent = Object.getPrototypeOf(cur) as Function | null;

        cur = parent ? canonicalCtor(parent) : null;
    }

    return false;
}

/**
 * Hierarchy-aware resolution of `ctor`'s class-tier declarations. Walks
 * `Object.getPrototypeOf(ctor)` upward, resolving (and, for a class that owns
 * a genuine deviation, inserting) each ancestor's `.ClassName` rule before
 * this class's own — so a plain, unweighted `.ClassName` selector is always
 * correct with no `:where()` needed between hierarchy levels (an ancestor's
 * rule is always in the stylesheet before a descendant's by the time either
 * could match a rendered element). Memoized per `ctor`.
 *
 * A class with no own contribution (`ownDefaultsOf` returns null) resolves to
 * exactly its parent's level — no new rule, no new cache work beyond
 * memoizing the pass-through. Every level, participating or not, still claims
 * its own name in `_owners` (when unclaimed) so a later same-named class is
 * detected as colliding even if this level itself inserted no rule.
 */
function resolveClassLevel(rawCtor: Function): ResolvedClassLevel {
    const ctor = canonicalCtor(rawCtor);
    const cached = _levels.get(ctor);

    if (cached) {
        return cached;
    }

    // `_rootCtor` (Component) is a terminal node for this walk — never
    // recurse above it, regardless of which class the walk started from.
    const rawParentCtor = ctor === _rootCtor ? null : (Object.getPrototypeOf(ctor) as Function | null);
    const parentCtor = rawParentCtor ? canonicalCtor(rawParentCtor) : null;
    const parent = (typeof parentCtor === "function" && parentCtor.name)
        ? resolveClassLevel(parentCtor)
        : { defaults: FRAMEWORK_DEFAULTS, resolved: FRAMEWORK_DECLARATIONS };

    const name    = ctor.name;
    const owner   = _owners.get(name);
    const collides = !name || (owner !== undefined && owner !== ctor);

    const own = collides ? null : ownDefaultsOf(ctor);

    if (!own) {
        const level = { defaults: parent.defaults, resolved: parent.resolved };

        _levels.set(ctor, level);

        if (!collides && name) {
            _owners.set(name, ctor);
        }

        return level;
    }

    ensureFrameworkStyleRule();
    _owners.set(name, ctor);

    const defaults   = mergeClassStyleDefaults(parent.defaults, own);
    const resolved   = resolveDeclarations(defaults);
    const deviations = deviationsFrom(resolved, parent.resolved);

    if (Object.keys(deviations).length > 0) {
        new StyleRule({ scope: "class", name, styles: deviations });
    }

    const level = Object.freeze({ defaults, resolved: Object.freeze(resolved) });

    _levels.set(ctor, level);

    return level;
}

/** A class's own resolved declarations for one state suffix — see
 *  {@link resolveClassStateLevel}. */
interface ResolvedClassStateLevel {
    resolved: ClassStyleBag;
}

/** A `protected static` extraction method's shape — e.g.
 *  `Button.extractPressedClassDeclarations`. Takes a plain defaults bag
 *  (never an instance) so the hierarchy walk can call it against any
 *  ancestor's own `ownClassStyleDefaults`, not just a live instance's
 *  merged `_defaultOptions`. */
type StaticExtractor = (defaults: ClassStyleDefaults) => Record<string, string | null>;

// (ctor -> (suffix -> resolved level)). State-tier sibling of `_levels`,
// memoizing `resolveClassStateLevel`'s walk per class *and* per suffix,
// since one class can own several state rules (Button: .pressed,
// :hover:not(.pressed)).
const _stateLevels: Map<Function, Map<string, ResolvedClassStateLevel>> = new Map();

/**
 * Hierarchy-aware resolution of `ctor`'s class-tier declarations for one
 * state suffix (`.pressed`, `.selected:not(:hover)`, …) — the state-tier
 * sibling of {@link resolveClassLevel}, mirroring its recursive shape
 * (resolve the parent first, merge this level's own contribution over it,
 * diff, insert only a genuine deviation) and reusing its `_owners`
 * collision registry, so a name claimed by one tier is respected by the
 * other regardless of which one claims it first.
 *
 * The one place this walk cannot simply reuse {@link resolveClassLevel}'s
 * shape verbatim: "this level's own contribution" is not a fixed field
 * (`ownClassStyleDefaults`) but a *named* `protected static` method
 * (`extractorMethodName`) that only some levels declare, and — critically —
 * whether a level declares a *resting*-tier `ownClassStyleDefaults` is
 * independent of whether it declares a *state*-tier extractor for a given
 * suffix (`ToggleButton` declares `extractSelectedClassDeclarations` but no
 * `ownClassStyleDefaults` of its own — it contributes nothing new to the
 * resting tier, see `button-family-hierarchy-cascade.md`'s Architecture
 * Decisions). Gating a level's own contribution on `ownClassStyleDefaults`
 * being non-null (as well as owning the extractor) would therefore wrongly
 * report `ToggleButton` as having no `.selected` contribution at all. The
 * own-property check on `extractorMethodName` is the *sole* gate for
 * whether this level contributes; `ownDefaultsOf(ctor) ?? {}` is only the
 * *argument* handed to that extractor (empty when this level has no
 * resting-tier defaults of its own to read from) — never a second
 * precondition.
 */
function resolveClassStateLevel(
    rawCtor: Function,
    suffix: string,
    extractorMethodName: string,
): ResolvedClassStateLevel {
    const ctor = canonicalCtor(rawCtor);

    let bySuffix = _stateLevels.get(ctor);
    if (!bySuffix) {
        bySuffix = new Map();
        _stateLevels.set(ctor, bySuffix);
    }

    const cached = bySuffix.get(suffix);
    if (cached) {
        return cached;
    }

    // `_rootCtor` (Component) is a terminal node for this walk too, exactly
    // like `resolveClassLevel` — Component and whatever it extends never
    // declare a state extractor, so there is nothing to gain by walking
    // further, and stopping here keeps the two tiers' walks symmetric.
    const rawParentCtor = ctor === _rootCtor ? null : (Object.getPrototypeOf(ctor) as Function | null);
    const parentCtor = rawParentCtor ? canonicalCtor(rawParentCtor) : null;
    const parent = (typeof parentCtor === "function" && parentCtor.name)
        ? resolveClassStateLevel(parentCtor, suffix, extractorMethodName)
        : { resolved: Object.freeze({}) as ClassStyleBag };

    const name    = ctor.name;
    const owner   = _owners.get(name);
    const collides = !name || (owner !== undefined && owner !== ctor);

    // Own-property checked, exactly like `ownDefaultsOf` — a level that
    // doesn't declare `extractorMethodName` itself contributes nothing for
    // this suffix, regardless of what an ancestor or a same-named method
    // inherited from further up the static prototype chain would answer.
    const hasOwnExtractor = !collides && Object.prototype.hasOwnProperty.call(ctor, extractorMethodName);
    const own: Record<string, string | null> = hasOwnExtractor
        ? (ctor as unknown as Record<string, StaticExtractor>)[extractorMethodName](ownDefaultsOf(ctor) ?? {})
        : {};

    if (Object.keys(own).length === 0) {
        const level = { resolved: parent.resolved };

        bySuffix.set(suffix, level);

        // Every level, participating or not, still claims its own name in
        // `_owners` (when unclaimed) so a later same-named class is
        // detected as colliding even if this level itself inserted no
        // rule — mirrors `resolveClassLevel`'s pass-through branch.
        if (!collides && name) {
            _owners.set(name, ctor);
        }

        return level;
    }

    const resolved   = { ...parent.resolved, ...own };
    const deviations = deviationsFrom(resolved, parent.resolved);

    _owners.set(name, ctor);
    if (Object.keys(deviations).length > 0) {
        new StyleRule({ scope: "class", name, suffix, styles: deviations });
    }

    const level = Object.freeze({ resolved: Object.freeze(resolved) });

    bySuffix.set(suffix, level);

    return level;
}

/**
 * Ensures the framework-wide `:where(.ts-ui-component)` rule exists and,
 * when `ctor`'s resolved defaults deviate from it, ensures a `.ClassName`
 * rule carrying only those deviations. Idempotent per `ctor` — the first
 * call for a class computes and registers the rule(s); every later call
 * (including from other instances of the same class) returns the cached
 * result without touching the stylesheet again.
 *
 * For a class participating in the hierarchy mechanism (`ctor` or an
 * ancestor declares `ownClassStyleDefaults`), the returned bag is
 * `resolveClassLevel(ctor).resolved` — a delta against the nearest
 * ancestor's rule rather than the framework tier directly, so a subclass
 * that changes nothing shares its ancestor's rule instead of repeating it.
 * A class outside the hierarchy mechanism falls back to the original flat
 * behaviour: `defaults` (the caller's own fully-merged
 * `getClassStyleDefaults()` result) diffed directly against
 * `FRAMEWORK_DECLARATIONS`, unchanged from before this mechanism existed —
 * this is what keeps every not-yet-migrated class, and any subclass that
 * customises a hoistable field without registering its own
 * `ownClassStyleDefaults`, exactly as correct as it was before.
 *
 * @param ctor - The concrete component class constructor (`this.constructor`
 *   from `Component`), used as the cache key. `ctor.name` is not unique in
 *   this tree, so the constructor itself — not its name — is what identifies
 *   the class; the name is only used to derive the CSS selector.
 * @param defaults - The class's frozen `_defaultOptions` bag (or a
 *   structurally-compatible subset of it) — for a participating class, must
 *   agree with its `ownClassStyleDefaults` chain (see
 *   plans/implemented/class-hierarchy-cascade.md's Internal Structure).
 *
 * @returns The inherited declaration bag — the framework declarations with
 *   this class's (and, for a participating class, every ancestor's)
 *   deviations merged over them, mirroring what the cascade delivers to one
 *   of its elements from the lower tiers. `null` when `ctor`'s name is empty
 *   (an anonymous class) or already claimed by a different constructor — the
 *   name-collision opt-out — in which case the caller must write every
 *   hoistable declaration to its own `#id` rule.
 */
export function ensureClassStyleRule(
    rawCtor: Function,
    defaults: ClassStyleDefaults,
): ClassStyleBag | null {
    const ctor = canonicalCtor(rawCtor);
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

    if (!chainParticipates(ctor)) {
        const deviations = classDeviations(defaults);

        // Claim the selector whether or not a rule is inserted, so a second
        // class of the same name still opts out. An empty body would insert
        // a rule that declares nothing, so skip it.
        _owners.set(name, ctor);

        if (Object.keys(deviations).length > 0) {
            new StyleRule({ scope: "class", name, styles: deviations });
        }

        const inherited = Object.freeze({ ...FRAMEWORK_DECLARATIONS, ...deviations });

        _bags.set(ctor, inherited);

        return inherited;
    }

    const level = resolveClassLevel(ctor);

    _bags.set(ctor, level.resolved);

    return level.resolved;
}

const _classChains: Map<Function, readonly string[]> = new Map();

/**
 * Every ancestor's own class name, from the topmost ancestor down to `ctor`
 * itself — the full list `Component.init()` adds to the element. Memoized
 * per constructor; independent of which *level* has registered
 * `ownClassStyleDefaults`, so a chain that has opted in anywhere gets its
 * full ancestor chain even through a non-contributing middle level (e.g.
 * `DefaultCell`, between `Cell` and `HeaderCell`).
 *
 * Gated on `chainParticipates`, though, at the top: a chain with **no**
 * `ownClassStyleDefaults` *anywhere* keeps today's exact pre-hierarchy
 * behaviour — this class's own name only, not its ancestors'. Widening such
 * a chain would be actively unsafe, not merely useless: `Button` /
 * `ToggleButton` / `TabButton` / `SpinButton` (and `MenuButton` /
 * `PopupButton`) each still have their own independent flat `.ClassName`
 * rule (including an independently-created state-tier `.pressed` rule) via
 * the pre-hierarchy mechanism, at the same `(0,1,0)` specificity as every
 * other level's rule. Widening their DOM classes without also making the
 * state tier hierarchy-aware would let two same-specificity rules start
 * matching one element, with the winner decided by stylesheet insertion
 * order — the exact hazard `plans/implemented/class-hierarchy-cascade.md`'s
 * "Rollout is scoped to the confirmed-safe chains" decision documents for
 * that family specifically; `chainParticipates` generalises the exclusion to
 * every non-participating chain rather than naming `Button`'s family only,
 * since the same hazard recurs for any other pre-existing multi-level flat
 * hierarchy this plan doesn't touch.
 */
export function getStyleClassChain(rawCtor: Function): readonly string[] {
    const ctor = canonicalCtor(rawCtor);
    const cached = _classChains.get(ctor);

    if (cached) {
        return cached;
    }

    // `_rootCtor` (Component) is excluded from every chain — a bare
    // `Component` instance's chain is `[]`, matching every concrete
    // subclass never seeing "Component" as an ancestor's own class name.
    if (ctor === _rootCtor) {
        const chain: readonly string[] = [];

        _classChains.set(ctor, chain);

        return chain;
    }

    if (!chainParticipates(ctor)) {
        const chain: readonly string[] = ctor.name ? Object.freeze([ctor.name]) : [];

        _classChains.set(ctor, chain);

        return chain;
    }

    const parentCtor = canonicalCtor(Object.getPrototypeOf(ctor) as Function);
    const parentChain = (typeof parentCtor === "function" && parentCtor.name)
        ? getStyleClassChain(parentCtor)
        : [];

    const chain = ctor.name ? Object.freeze([...parentChain, ctor.name]) : parentChain;

    _classChains.set(ctor, chain);

    return chain;
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
 *   suffixed state — the non-hierarchy-aware fallback bag, used only when
 *   `extractorMethodName` is omitted or `ctor`'s chain doesn't participate
 *   in the hierarchy mechanism (see `extractorMethodName` below).
 * @param extractorMethodName - The name of the `protected static`
 *   extraction method (e.g. `"extractPressedClassDeclarations"`) each
 *   participating ancestor may declare its own copy of. When supplied and
 *   `ctor`'s chain participates in the hierarchy mechanism (i.e.
 *   {@link chainParticipates}), resolution delegates to
 *   {@link resolveClassStateLevel} instead of the flat per-`(ctor, suffix)`
 *   cache below — this is what makes a subclass sharing its nearest
 *   contributing ancestor's rule (rather than always creating its own)
 *   safe now that `class-hierarchy-cascade.md`'s DOM widening applies to
 *   this chain too. Omitted (or `ctor` non-participating) keeps today's
 *   exact flat behaviour, so every other `createStateStyleRule` call site
 *   in the library needs no change.
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
    extractorMethodName?: string,
): ClassStyleBag | null {
    if (extractorMethodName && chainParticipates(ctor)) {
        const name  = ctor.name;
        const owner = _owners.get(name);

        if (!name || (owner !== undefined && owner !== ctor)) {
            return null;
        }

        return resolveClassStateLevel(ctor, suffix, extractorMethodName).resolved;
    }

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
 * substitute); the one concrete case this surfaces (`Button`'s
 * `pressedShadow`/`pressedBackgroundColor`/`pressedBackgroundImage`, cleared
 * by `SpinButton`/`Dialog`/`Notification`'s close buttons) stays correct by
 * having each caller pin the current resting value instead of writing
 * `null` — see `Button.clearPressedShadow`, `clearPressedBackgroundColor`,
 * and `clearPressedBackgroundImage`.
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

/**
 * Wraps a per-instance state `StyleRule` together with the class-tier
 * comparison bag `ensureClassStateRule` resolves for it. `set()` / `setMany()`
 * skip a write that already matches the class rule and materialise the
 * underlying rule when a real write just queued on an already-rendered
 * component — exactly like `writeClassStateDeclaration` /
 * `writeManyClassStateDeclarations` plus a materialisation nudge — so a
 * caller gets both by calling the object's own write methods, with nothing
 * else to opt into.
 *
 * Constructed via `Component.createStateStyleRule`; not intended for direct
 * construction elsewhere.
 */
export class StateStyleRule {
    private readonly _rule:       StyleRule;
    private readonly _bag:        ClassStyleBag | null;
    private readonly _hasElement: () => boolean;

    constructor(
        ctor: Function,
        suffix: string,
        rule: StyleRule,
        resolveDefaults: () => Record<string, string | null>,
        hasElement: () => boolean,
        extractorMethodName?: string,
    ) {
        this._rule       = rule;
        this._bag        = ensureClassStateRule(ctor, suffix, resolveDefaults(), extractorMethodName);
        this._hasElement = hasElement;
    }

    /**
     * The resolved class-tier bag `set()` / `setMany()` compare against;
     * `null` when this class opted out of dedup (see `ensureClassStateRule`).
     * Read-only — a caller that needs the bag's own keys (`Button.pinPressedToResting`
     * is the one in-repo example) reads this instead of bypassing the
     * comparison `set()` / `setMany()` perform.
     */
    get classBag(): ClassStyleBag | null {
        return this._bag;
    }

    /**
     * Writes a single state-rule declaration, deduping against the class-tier
     * bag and materialising the underlying rule when this write just queued a
     * real declaration on an already-rendered component.
     *
     * @param key - The CSS property name (camelCase).
     * @param value - The value to set, or null to remove the property.
     */
    set(key: string, value: string | null): void {
        writeClassStateDeclaration(this._rule, this._bag, key, value);
        this._materialise();
    }

    /**
     * Bulk variant of {@link StateStyleRule.set}.
     *
     * @param values - Camel-cased property keys mapped to string values (or null to clear).
     */
    setMany(values: Record<string, string | null>): void {
        writeManyClassStateDeclarations(this._rule, this._bag, values);
        this._materialise();
    }

    /**
     * Inserts the rule when a write just queued a real declaration and the
     * component is already rendered — the choke point `Button`'s
     * `materialisePressedRule` used to be, generalised so no future caller
     * can forget it. A rule that never queued anything real (every write so
     * far matched the class bag) is left unmaterialised, same as any other
     * deferred rule.
     */
    private _materialise(): void {
        if (this._hasElement() && this._rule.hasQueuedDeclarations()) {
            this._rule.ensure();
        }
    }
}
