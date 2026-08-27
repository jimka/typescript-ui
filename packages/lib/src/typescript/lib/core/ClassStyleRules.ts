// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Internal helper backing Component's three-tier style-rule split (framework
// / class / instance). Not exported from `core/index.ts` — this module
// exists purely to derive and register the framework-wide and per-class
// shared `StyleRule`s that `Component.applyStyle` consults through
// `writeRuleDeclaration`. See
// plans/implemented/class-scoped-style-rules.md for the rationale.
//
// Also backs the state tier (`.pressed` / `:hover` / `.selected` / …) —
// `ownStyleStates`'s hierarchy-aware per-level content walk
// (`resolveStateLevels`/`resolveStyleStates`) for the shared class-tier
// rules, and `ensureClassStateRule` for the handful of sites that only ever
// publish a shared rule and never write per-instance (reached through
// `Component.ensureSharedStateRule`) — see
// plans/implemented/state-tier-full-unification.md.
//
// Also backs the trait tier — a named, hand-authored `StyleTrait` bag any
// number of unrelated classes or instances can opt into and share one CSS
// rule for, ranked above the class tier — see plans/cross-class-style-groups.md.

import { StyleRule }   from "~/core/StyleTarget.js";
import { DOM }         from "~/core/DOM.js";
import { Position }    from "~/primitive/Position.js";
import { isUnbounded } from "~/primitive/Size.js";
import { type BorderOptions, borderToStyle } from "~/primitive/Border.js";
import { Insets }      from "~/primitive/Insets.js";

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
export interface StyleBag {
    visible?:         boolean | null;
    displayed?:       boolean;
    minSize?:         { width: number; height: number } | null;
    maxSize?:         { width: number; height: number } | null;
    overflow?:        string | null;
    overflowX?:       string | null;
    overflowY?:       string | null;
    cursor?:          string | null;
    userSelect?:      string | null;
    outline?:         string | null;
    foregroundColor?: string | null;
    font?:            TextStyleBag | null;
    /** CSS `background` shorthand. An alternative to `backgroundColor` /
     *  `backgroundImage`: one bag declares the shorthand or the longhands,
     *  never both. */
    background?:      string | null;
    backgroundColor?: string | null;
    backgroundImage?: string | null;
    shadow?:          string | null;
    borderRadius?:    string | null;
    border?:          BorderOptions | string | null;
    // Longhand override for the `margin` shorthand `resolveDeclarations`
    // hardcodes below. Class-authored only — no `Component` setter writes it
    // and no `ComponentOptions` field of this name exists. See
    // `Legend.ownClassStyleDefaults`.
    marginLeft?:      string | null;
    // The three properties `applyStyle` writes today outside the authored-bag
    // path — from a raw field (`boxSizing`, `whiteSpace`) or a hardcoded
    // literal (`margin`). `position` used to belong to this group too, but
    // `resolveDeclarations` below now reads it (falling back to
    // `Position.ABSOLUTE` when a class declares no deviation), so a class's
    // `ownClassStyleDefaults` can author it like any other hoistable field —
    // see `Legend.ownClassStyleDefaults`. `padding` used to belong to this
    // group too (via its own options getter), but `resolveDeclarations` below
    // now reads it too — unlike `position`, the framework tier has no
    // baseline padding value, so a class only gets a declaration when it
    // actually sets one (see `SelectableListRow.classStyleDefaults` and
    // `TextField.ownClassStyleDefaults`).
    boxSizing?:       string | null;
    position?:        Position;
    whiteSpace?:      string | null;
    margin?:          string | null;
    padding?:         Insets | null;
}

/**
 * The class-uniform font/text declarations a `Text`-family class produces
 * from its own defaults alone. Namespaced under `StyleBag.font`
 * rather than added as flat keys: `Glyph` (component/display/Glyph.ts),
 * `TabBar` (component/container/TabBar.ts), and `TextInput`
 * (component/input/TextInput.ts) each declare their own, differently-typed
 * `fontSize`/`lineHeight`/`textAlign` options — flat keys of the same name
 * would silently leak their unrelated defaults into this bag, since
 * `Component.applyStyle`'s default `getClassStyleDefaults()` passes
 * `_defaultOptions` through verbatim for every class that doesn't override
 * it. `Text.getClassStyleDefaults()`, `TextInput.getClassStyleDefaults()`,
 * and `ScrollArrowGlyph.getClassStyleDefaults()`
 * (component/container/Scrollbar.ts) are the three methods that set `font`.
 */
export interface TextStyleBag {
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

export type ResolvedStyleBag = Readonly<Record<string, string | null>>;

// The fifteen hoistable keys at the value Component's own defaults resolve to.
const FRAMEWORK_DECLARATIONS: ResolvedStyleBag = Object.freeze({
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

// The `StyleBag` input that reproduces `FRAMEWORK_DECLARATIONS` via
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
const FRAMEWORK_DEFAULTS: StyleBag = Object.freeze({
    minSize:  { width: 0, height: 0 },
    overflow: "hidden",
});

// Per-class inherited declarations: the framework body with this class's
// deviations merged over it. A `null` entry means the class opted out (its
// selector is owned by a different constructor, or it is anonymous).
const _bags: Map<Function, StyleLayer | null> = new Map();

// Selector owner, so a name shared by two classes is detected.
const _owners: Map<string, object> = new Map();

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
 *
 * Exported (module otherwise stays internal) so `core/Component.ts`'s
 * `resolveInstanceStyleDeclarations` can reuse it unchanged to resolve one
 * *instance's* own hoistable style for `ensureStyleGroupRule`, instead of a
 * class's plain `getClassStyleDefaults()` bag — see
 * plans/implemented/shared-instance-style-groups.md.
 *
 * Deliberately not built on {@link STYLE_WRITERS} / {@link
 * resolvePartialDeclarations}: this function's absent-key fallbacks and
 * truthy gates are the class-tier defaulting rules (a static class default
 * has no "explicit clear" concept, so a `null` field and an omitted one must
 * resolve identically here), while `resolvePartialDeclarations` is
 * presence-driven so the instance/state layers can tell `clearX()` apart
 * from never-set. Routing this body through the presence-driven table would
 * turn an explicit `null` sub-field (e.g. `Text`'s `font` bag, which sets
 * several optional sub-keys to `?? null`) into a spurious removal
 * declaration instead of the absent-key silence this function's callers
 * (and its byte-identical-output regression tests) require.
 */
export function resolveDeclarations(defaults: StyleBag): Record<string, string | null> {
    const minSize  = defaults.minSize  ?? null;
    const maxSize  = defaults.maxSize  ?? null;
    const overflow = defaults.overflow ?? null;

    const declarations: Record<string, string | null> = {
        boxSizing:  "border-box",
        position:   defaults.position ?? Position.ABSOLUTE,
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
        overflowX:  defaults.overflowX ?? overflow ?? "visible",
        overflowY:  defaults.overflowY ?? overflow ?? "visible",
    };

    // outline/color are conditional: most classes declare neither, and
    // Component only ever writes them when non-null (see applyChromeStyles /
    // applyBoxAndVisibilityStyles), so an absent key here must stay absent —
    // never introduce a key with value `undefined`.
    if (defaults.outline)         declarations.outline = defaults.outline;
    if (defaults.foregroundColor) declarations.color   = defaults.foregroundColor;

    // `background` is emitted first: the shorthand resets both longhands it
    // covers, so a bag that declared both (none does — see StyleBag's own
    // comment) would want the longhands as the refinement, not wiped by
    // declaration order.
    if (defaults.background)      declarations.background      = defaults.background;
    if (defaults.backgroundColor) declarations.backgroundColor = defaults.backgroundColor;
    if (defaults.backgroundImage) declarations.backgroundImage = defaults.backgroundImage;
    if (defaults.shadow)          declarations.boxShadow       = defaults.shadow;
    if (defaults.borderRadius)    declarations.borderRadius    = defaults.borderRadius;

    // Truthy-gated like the chrome group above: absent for every class that
    // declares none, so no class gains a spurious deviation against the
    // framework rule (which has no `marginLeft` key to compare against).
    // Emitted after the `margin` shorthand in key order, so a rule that ever
    // carried both would apply the longhand last.
    if (defaults.marginLeft)      declarations.marginLeft      = defaults.marginLeft;

    const border = defaults.border;
    if (border) {
        // `borderToStyle` always yields all four longhands, resolving each side
        // through `side ?? border ?? "none"` — the same expansion Component's own
        // border writers use, so the two tiers compare key for key.
        Object.assign(declarations, borderToStyle(typeof border === "string" ? { border } : border));
    }

    // Unlike `position` above, `padding` has no framework-tier baseline to
    // fall back to (`FRAMEWORK_DECLARATIONS` carries no `padding` key — most
    // classes declare none), so this stays gated on presence, matching
    // `backgroundColor`/`shadow`/`borderRadius` above: an unconditional entry
    // would inject a spurious `padding: null` deviation onto every class
    // that has never touched padding. See `## Architecture Decisions`.
    if (defaults.padding) declarations.padding = defaults.padding.render() as string;

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

/**
 * One CSS-declaration writer per `StyleBag` key, keyed on the authored value
 * as-is — including `null`, which every writer maps to a removal declaration
 * for its own CSS key(s) (not a fallback), since this table backs
 * {@link resolvePartialDeclarations}, the presence-driven resolver the
 * instance and state layers use to support `clearX()` semantics. This is
 * deliberately a different contract from `resolveDeclarations` below, whose
 * absent-key fallbacks and truthy gates encode the *class-tier* defaulting
 * rules (no "explicit clear" concept exists for a static class default) —
 * see `resolveDeclarations`'s own comment for why it does not build on this
 * table.
 */
const STYLE_WRITERS: { [K in keyof StyleBag]-?: (v: StyleBag[K]) => Record<string, string | null> } = {
    visible:         (v) => ({ visibility: v === false ? "hidden" : "inherit" }),
    displayed:       (v) => ({ display: v === false ? "none" : "block" }),
    minSize:         (v) => ({ minWidth: v ? v.width + "px" : null, minHeight: v ? v.height + "px" : null }),
    maxSize:         (v) => ({
        maxWidth:  v ? (isUnbounded(v.width)  ? "none" : v.width  + "px") : null,
        maxHeight: v ? (isUnbounded(v.height) ? "none" : v.height + "px") : null,
    }),
    overflow:        (v) => ({ overflowX: v ?? null, overflowY: v ?? null }),
    overflowX:       (v) => ({ overflowX: v ?? null }),
    overflowY:       (v) => ({ overflowY: v ?? null }),
    cursor:          (v) => ({ cursor: v ?? null }),
    userSelect:      (v) => ({ userSelect: v ?? null }),
    outline:         (v) => ({ outline: v ?? null }),
    foregroundColor: (v) => ({ color: v ?? null }),
    font:            (v) => resolvePartialFontDeclarations(v),
    background:      (v) => ({ background: v ?? null }),
    backgroundColor: (v) => ({ backgroundColor: v ?? null }),
    backgroundImage: (v) => ({ backgroundImage: v ?? null }),
    shadow:          (v) => ({ boxShadow: v ?? null }),
    borderRadius:    (v) => ({ borderRadius: v ?? null }),
    border:          (v) => v
        ? borderToStyle(typeof v === "string" ? { border: v } : v)
        : { borderTop: null, borderRight: null, borderBottom: null, borderLeft: null },
    boxSizing:       (v) => ({ boxSizing: v ?? null }),
    position:        (v) => ({ position: v ?? null }),
    whiteSpace:      (v) => ({ whiteSpace: v ?? null }),
    margin:          (v) => ({ margin: v ?? null }),
    marginLeft:      (v) => ({ marginLeft: v ?? null }),
    padding:         (v) => ({ padding: v ? (v.render() as string) : null }),
};

/** One CSS-declaration writer per `TextStyleBag` key — the `font` sub-bag's
 *  own {@link STYLE_WRITERS} table, same presence-driven contract. */
const FONT_WRITERS: { [K in keyof TextStyleBag]-?: (v: TextStyleBag[K]) => Record<string, string | null> } = {
    fontFamily:     (v) => ({ fontFamily:     v ?? null }),
    fontKerning:    (v) => ({ fontKerning:    v ?? null }),
    fontSize:       (v) => ({ fontSize:       v ?? null }),
    fontSizeAdjust: (v) => ({ fontSizeAdjust: v ?? null }),
    fontStretch:    (v) => ({ fontStretch:    v ?? null }),
    fontStyle:      (v) => ({ fontStyle:      v ?? null }),
    fontVariant:    (v) => ({ fontVariant:    v ?? null }),
    fontWeight:     (v) => ({ fontWeight:     v ?? null }),
    textAlign:      (v) => ({ textAlign:      v ?? null }),
    textShadow:     (v) => ({ textShadow:     v ?? null }),
    lineHeight:     (v) => ({ lineHeight:     v ?? null }),
    textOverflow:   (v) => ({ textOverflow:   v ?? null }),
};

/** Only the sub-keys `font` itself declares — the `font`-nested sibling of
 *  {@link resolvePartialDeclarations}. */
function resolvePartialFontDeclarations(font: TextStyleBag | null | undefined): Record<string, string | null> {
    const out: Record<string, string | null> = {};

    if (!font) {
        return out;
    }

    for (const key of Object.keys(font) as (keyof TextStyleBag)[]) {
        // `key` correlates `FONT_WRITERS[key]`'s parameter with `font[key]`'s
        // value by loop construction; TS cannot prove that correlation across
        // a union of function types, so the writer is called through an
        // `unknown`-parameter view rather than widening `FONT_WRITERS`' own
        // (precisely-typed) signature.
        const writer = FONT_WRITERS[key] as (v: unknown) => Record<string, string | null>;

        Object.assign(out, writer(font[key]));
    }

    return out;
}

/**
 * Only the keys `bag` actually declares (own-property presence, not
 * truthiness — a key present with value `null` resolves to a removal
 * declaration, distinct from a key absent entirely, which resolves to
 * nothing at all). Used by the instance and state layers, where that
 * distinction is exactly `clearX()` vs. never-set.
 */
export function resolvePartialDeclarations(bag: StyleBag): Record<string, string | null> {
    const out: Record<string, string | null> = {};

    for (const key of Object.keys(bag) as (keyof StyleBag)[]) {
        // See the matching comment in `resolvePartialFontDeclarations` — same
        // correlated-union limitation.
        const writer = STYLE_WRITERS[key] as (v: unknown) => Record<string, string | null>;

        Object.assign(out, writer(bag[key]));
    }

    return out;
}

/** The subset of `resolveDeclarations` that differs from the framework rule. */
function classDeviations(defaults: StyleBag): Record<string, string | null> {
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
 * defaults — the same shape as `StyleBag`, but declared once per
 * class (not resolved per instance). A class that adds no hoistable default
 * of its own declares no field at all; `Component` declares none.
 *
 * Read only via an own-property check (`Object.prototype.hasOwnProperty`) —
 * never via a plain property read, which would report an inherited value
 * from whichever ancestor last declared the field. See
 * plans/implemented/class-hierarchy-cascade.md's Architecture Decisions.
 */
interface ClassStyleLevelHost {
    ownClassStyleDefaults?: StyleBag;
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

/**
 * One layer of a component's style stack: an authored bag plus the CSS
 * declarations it resolves to. Every tier — instance, meta-class, group,
 * class — shares this shape; {@link ResolvedClassLevel} is the class tier's
 * own instance of it (same two fields, its own JSDoc for that tier's
 * specifics).
 */
export interface StyleLayer {
    readonly authored: StyleBag;
    readonly resolved: ResolvedStyleBag;
}

/** This class's fully-merged declaration bag plus the resolved CSS it
 *  produces — see {@link resolveClassLevel}. Structurally a {@link StyleLayer}. */
interface ResolvedClassLevel {
    /** This class's fully-merged `StyleBag` — its own contribution
     *  layered onto every ancestor's, in the same shape `resolveDeclarations`
     *  consumes. */
    authored: StyleBag;
    /** `resolveDeclarations(authored)` — this class's full resolved CSS bag,
     *  used both to diff the next level down and, at the leaf, as the
     *  instance-comparison bag `_classLayer` needs. */
    resolved: ResolvedStyleBag;
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
function ownDefaultsOf(ctor: Function): StyleBag | null {
    return Object.prototype.hasOwnProperty.call(ctor, "ownClassStyleDefaults")
        ? ((ctor as unknown as ClassStyleLevelHost).ownClassStyleDefaults ?? null)
        : null;
}

/** Shallow merge — a subclass that redeclares `border` or `font` replaces
 *  the whole sub-value, matching how `_default<Name>Options` bags already
 *  merge through `subclassDefaults` object-spread forwarding. */
function mergeClassStyleDefaults(parent: StyleBag, child: StyleBag): StyleBag {
    return { ...parent, ...child };
}

/** The subset of `resolved` that differs from `against` — `classDeviations`,
 *  generalised to diff against any resolved bag, not only the framework one. */
function deviationsFrom(resolved: ResolvedStyleBag, against: ResolvedStyleBag): Record<string, string | null> {
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
        : { authored: FRAMEWORK_DEFAULTS, resolved: FRAMEWORK_DECLARATIONS };

    const name    = ctor.name;
    const owner   = _owners.get(name);
    const collides = !name || (owner !== undefined && owner !== ctor);

    const own = collides ? null : ownDefaultsOf(ctor);

    if (!own) {
        const level = { authored: parent.authored, resolved: parent.resolved };

        _levels.set(ctor, level);

        if (!collides && name) {
            _owners.set(name, ctor);
        }

        return level;
    }

    ensureFrameworkStyleRule();
    _owners.set(name, ctor);

    const authored   = mergeClassStyleDefaults(parent.authored, own);
    const resolved   = resolveDeclarations(authored);
    const deviations = deviationsFrom(resolved, parent.resolved);

    if (Object.keys(deviations).length > 0) {
        new StyleRule({ scope: "class", name, styles: deviations });
    }

    const level = Object.freeze({ authored, resolved: Object.freeze(resolved) });

    _levels.set(ctor, level);

    return level;
}


/**
 * One declared toggle state (`.pressed`, `:hover`, `.selected`, …). Array
 * order — wherever a class declares its full list, via `ownStyleStates` — is
 * priority: the first entry wins when several are active at once.
 */
export interface StyleStateSpec {
    /** Selector fragment the state activates on, e.g. `".pressed"`, `":hover"`. */
    readonly selector: string;
    /** This state's own contribution, read from the declaring class's own
     *  `ownClassStyleDefaults` (empty `{}` for a class outside the
     *  hierarchy-cascade mechanism — see `resolveStyleStates`'s own comment
     *  on why an extractor is free to ignore this and close over its own
     *  module-level defaults instead, the way `Button`'s pressed/hover
     *  extractors do). */
    readonly extract: (defaults: StyleBag) => StyleBag;
}

/** One resolved entry from a class's declared `ownStyleStates` — its own
 *  selector, the generated `:not(...)`-guarded suffix that makes it mutually
 *  exclusive with every higher-priority entry, and the `StyleLayer` (authored
 *  + resolved CSS) it contributes when active. */
export interface ResolvedStyleState {
    /** e.g. `".pressed"`. */
    readonly selector:      string;
    /** e.g. `":hover:not(.pressed)"` — `selector` plus a `:not(...)` guard
     *  against every entry earlier in the declared order. This is the
     *  suffix the generated `.ClassName<guardedSuffix>` rule actually uses. */
    readonly guardedSuffix: string;
    readonly layer:         StyleLayer;
}

interface StyleStateLevelHost {
    ownStyleStates?: readonly StyleStateSpec[];
}

/** Own-property read of a class's `ownStyleStates` field — `null` when this
 *  exact class doesn't declare one, regardless of what an ancestor declares.
 *  Mirrors `ownDefaultsOf`'s own-property discipline (see its own comment):
 *  a plain property read would report an inherited array from whichever
 *  ancestor last declared it. */
function ownStyleStatesOf(ctor: Function): readonly StyleStateSpec[] | null {
    return Object.prototype.hasOwnProperty.call(ctor, "ownStyleStates")
        ? ((ctor as unknown as StyleStateLevelHost).ownStyleStates ?? null)
        : null;
}

/** `selector` guarded against every entry before it in `specs` — the
 *  suffix construction {@link resolveStyleStates} and {@link restingGuardSuffix}
 *  both use. `index === 0` guards against nothing, matching the plan's own
 *  "first entry wins" contract needing no `:not(...)` at all. */
function guardedSuffixFor(selector: string, specs: readonly StyleStateSpec[], index: number): string {
    let suffix = selector;

    for (let i = 0; i < index; i++) {
        suffix += ":not(" + specs[i].selector + ")";
    }

    return suffix;
}

// (concrete ctor -> its resolved states). Keyed on the concrete class a
// lookup was made for — not the declaring class the order list resolves
// to — since two subclasses that share one declaring ancestor's order can
// still resolve different *content* per level (see `resolveStateLevels`).
const _resolvedStates: Map<Function, readonly ResolvedStyleState[]> = new Map();

// (ctor -> (order signature -> per-selector resolved layers for that one
// class level)). State-tier sibling of `_levels`, but keyed on a second axis
// — the resolving order's signature — since `ownStyleStates` content, unlike
// `ownClassStyleDefaults`, is read against whichever order the *leaf* of a
// given resolution declared; two subclasses whose lists differ never share a
// cache entry here, because their guard suffixes (computed against their own
// order) differ too.
const _stateLevelLayers: Map<Function, Map<string, ReadonlyMap<string, StyleLayer>>> = new Map();

/** The `scope:"class"` rule-name a state-tier level resolves under —
 *  `ctor.name` for a normal class, but the universal `COMPONENT_CLASS`
 *  token for `_rootCtor` itself. `getStyleClassChain` never adds
 *  `_rootCtor`'s own name to any element's DOM classList, so a state
 *  `Component` declares directly needs a rule anchored to the one class
 *  token every rendered element actually carries — `ts-ui-component` — or
 *  the generated `.Component.<suffix>` selector would never match anything. */
function stateRuleName(ctor: Function): string {
    return ctor === _rootCtor ? COMPONENT_CLASS : ctor.name;
}

/**
 * Per-selector resolved layers for one class level — the state-tier sibling
 * of {@link resolveClassLevel}, mirroring its recursive shape (resolve the
 * parent first, merge this level's own contribution over it, diff, insert
 * only a genuine deviation) but producing a map of layers (one per declared
 * selector) instead of a single merged bag, and reading *content* from every
 * level that declares its own `ownStyleStates`, not only the level `order`
 * was found on.
 *
 * `order` is the full declared list the *leaf* of this resolution resolved
 * (whichever class nearest the concrete constructor declares `ownStyleStates`
 * — see {@link resolveStyleStates}), fixed for the whole recursive walk: it
 * is what `guardedSuffixFor` guards every level's own contribution against,
 * so two classes can never disagree on where a shared selector sits in the
 * `:not(...)` chain. `signature` is `order`'s own cache key (its selectors,
 * joined) — passed down unchanged so every level of one resolution shares it.
 *
 * A level that declares no `ownStyleStates` of its own (own-property check,
 * exactly like `ownDefaultsOf`) — or whose name collides with a different
 * constructor already registered under it — contributes nothing: its parent's
 * map is memoized and returned unchanged. Otherwise, for each of *this*
 * level's own declared specs that also appears in `order`, this level's
 * authored bag is its parent's authored bag (if any) for that selector,
 * overlaid with `spec.extract(ownDefaultsOf(ctor) ?? {})` — the same
 * `defaults` shape `resolveClassLevel`'s own walk feeds its per-level
 * contribution. Only a genuine deviation from the parent's resolved bag
 * inserts this level's own `.ClassName<guardedSuffix>` rule and claims
 * `ctor`'s name in the shared `_owners` registry — a spec restated unchanged
 * (`ToggleButton`'s `.pressed`/`:hover`, restated from `Button` verbatim)
 * shares its parent's rule instead of getting its own.
 */
function resolveStateLevels(
    rawCtor:   Function,
    order:     readonly StyleStateSpec[],
    signature: string,
): ReadonlyMap<string, StyleLayer> {
    const ctor = canonicalCtor(rawCtor);

    let bySignature = _stateLevelLayers.get(ctor);
    if (!bySignature) {
        bySignature = new Map();
        _stateLevelLayers.set(ctor, bySignature);
    }

    const cached = bySignature.get(signature);
    if (cached) {
        return cached;
    }

    // `_rootCtor` (Component) is a terminal node for this walk too, exactly
    // like `resolveClassLevel` — it has no parent level this mechanism
    // covers, so there is nothing to gain by walking further, regardless of
    // whether Component itself declares an `ownStyleStates` entry (it does,
    // as of `.invisible` — see `stateRuleName`).
    const rawParentCtor = ctor === _rootCtor ? null : (Object.getPrototypeOf(ctor) as Function | null);
    const parentCtor = rawParentCtor ? canonicalCtor(rawParentCtor) : null;
    const parentLayers = (typeof parentCtor === "function" && parentCtor.name)
        ? resolveStateLevels(parentCtor, order, signature)
        : (new Map() as ReadonlyMap<string, StyleLayer>);

    const own      = ownStyleStatesOf(ctor);
    const name     = stateRuleName(ctor);
    const owner    = _owners.get(name);
    const collides = !name || (owner !== undefined && owner !== ctor);

    if (!own || collides) {
        bySignature.set(signature, parentLayers);

        return parentLayers;
    }

    const layers = new Map(parentLayers);

    for (const spec of own) {
        const index = order.findIndex((s) => s.selector === spec.selector);
        if (index < 0) {
            continue;
        }

        const guarded     = guardedSuffixFor(spec.selector, order, index);
        const parentLayer = parentLayers.get(spec.selector);
        const authored    = { ...parentLayer?.authored, ...spec.extract(ownDefaultsOf(ctor) ?? {}) };
        const resolved    = resolvePartialDeclarations(authored);
        const delta       = deviationsFrom(resolved, parentLayer?.resolved ?? {});

        if (Object.keys(delta).length > 0) {
            _owners.set(name, ctor);
            new StyleRule({ scope: "class", name, suffix: guarded, styles: delta });
        }

        layers.set(spec.selector, { authored, resolved });
    }

    bySignature.set(signature, layers);

    return layers;
}

/**
 * A class's declared toggle states, resolved and ordered highest-priority
 * first — the state-tier sibling of {@link ensureClassStyleRule}, but for an
 * array (priority order) rather than a single merged bag, so it does not
 * reuse that function's hierarchy-merge shape.
 *
 * Unlike `ownClassStyleDefaults` (merged down through every participating
 * ancestor — see `resolveClassLevel`), `ownStyleStates` is a whole-list,
 * own-property declaration for **order**: whichever class in `ctor`'s chain
 * nearest declares it (own-property-checked exactly like `ownDefaultsOf`)
 * owns the entire list's *order* for this whole subtree, until some deeper
 * subclass redeclares its own (typically restating the inherited entries and
 * appending its own — see `ToggleButton`, which restates `Button`'s
 * `.pressed`/`:hover` and appends `.selected`). A class that declares no
 * `ownStyleStates` anywhere in its chain resolves to `[]`. **Content**, by
 * contrast, is a per-level merge — see {@link resolveStateLevels} — so a
 * subclass that restates an entry unchanged shares its ancestor's rule for
 * that selector rather than getting its own.
 *
 * Each entry's `extract` runs against the *declaring* class's own
 * `ownDefaultsOf(...)` bag (`{}` when that class has none) — the same
 * `defaults` shape `resolveClassLevel`'s hierarchy walk feeds its own
 * per-level contribution. A class outside that hierarchy mechanism (e.g.
 * `Button`, whose pressed/hover tokens live in a module-level
 * `_defaultButtonOptions` constant, not a static `ownClassStyleDefaults`
 * field) is free to have its `extract` closures ignore the parameter
 * entirely and close over their own module-level source instead — the
 * signature exists for the classes that *do* have a genuine
 * `ownClassStyleDefaults` to read from, not as a requirement every
 * extractor must use.
 *
 * Cached per **concrete** constructor (not the declaring one), since two
 * subclasses sharing one declaring ancestor's order can still resolve
 * different per-level content through {@link resolveStateLevels}.
 */
export function resolveStyleStates(rawCtor: Function): readonly ResolvedStyleState[] {
    const concreteCtor = canonicalCtor(rawCtor);

    const cachedForConcrete = _resolvedStates.get(concreteCtor);
    if (cachedForConcrete) {
        return cachedForConcrete;
    }

    let cur: Function | null = concreteCtor;

    while (typeof cur === "function" && cur.name) {
        const specs = ownStyleStatesOf(cur);

        if (specs) {
            const resolved = buildResolvedStates(cur, specs);
            _resolvedStates.set(concreteCtor, resolved);

            return resolved;
        }

        cur = cur === _rootCtor ? null : canonicalCtor(Object.getPrototypeOf(cur) as Function);
    }

    _resolvedStates.set(concreteCtor, []);

    return [];
}

/** The one-time resolution `resolveStyleStates` memoizes per concrete class —
 *  a thin assembler over {@link resolveStateLevels}'s per-selector map. */
function buildResolvedStates(declaringCtor: Function, specs: readonly StyleStateSpec[]): readonly ResolvedStyleState[] {
    const name     = stateRuleName(declaringCtor);
    const owner    = _owners.get(name);
    const collides = !name || (owner !== undefined && owner !== declaringCtor);

    if (collides) {
        // Same name-collision opt-out every tier uses: no shared rule for
        // any entry, so the caller must materialise every declaration on
        // its own instance rule (`Component.flushStyleBag`'s null-`_classLayer`
        // fallback already does this for the resting tier; a state layer
        // with an empty resolved bag never "matches" for dedup purposes,
        // which is the same effect).
        return specs.map((spec, i) => ({
            selector:      spec.selector,
            guardedSuffix: guardedSuffixFor(spec.selector, specs, i),
            layer:         { authored: {}, resolved: {} },
        }));
    }

    const signature = specs.map((spec) => spec.selector).join(",");
    const layers    = resolveStateLevels(declaringCtor, specs, signature);

    return specs.map((spec, i) => ({
        selector:      spec.selector,
        guardedSuffix: guardedSuffixFor(spec.selector, specs, i),
        layer:         layers.get(spec.selector) ?? { authored: {}, resolved: {} },
    }));
}

/**
 * The generated `:not(...)` chain guarding a class's resting chrome from
 * every one of its own declared states — replaces the hand-maintained,
 * per-class suffix-override chain each state-using class used to write by
 * hand. Empty when `ctor` declares no states anywhere in its chain, matching
 * that old override chain's own `[]` base case.
 */
export function restingGuardSuffix(ctor: Function): string {
    return resolveStyleStates(ctor).map((state) => ":not(" + state.selector + ")").join("");
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
    defaults: StyleBag,
): StyleLayer | null {
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
        const layer = Object.freeze({ authored: defaults, resolved: inherited });

        _bags.set(ctor, layer);

        return layer;
    }

    const level = resolveClassLevel(ctor);

    _bags.set(ctor, level);

    return level;
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
 * behaviour — this class's own name only, not its ancestors'. The gate is
 * for chains like that, not for the Button family: `Button` / `ToggleButton`
 * / `TabButton` / `SpinButton` (and `MenuButton` / `PopupButton`) all declare
 * or inherit `ownClassStyleDefaults` somewhere in the chain, so
 * `chainParticipates` returns true and their DOM classes widen like any
 * other participating chain (`plans/implemented/button-family-hierarchy-cascade.md`).
 * `chainParticipates` still generalises the exclusion to every
 * non-participating chain rather than a hand-picked list, since the same
 * unsafe-widening hazard this gate exists to avoid recurs for any other
 * pre-existing multi-level flat hierarchy that opts in nowhere.
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
const _stateBags: Map<Function, Map<string, ResolvedStyleBag | null>> = new Map();

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
): ResolvedStyleBag | null {
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

// (ctor -> (group -> bag)). Parallel to `_stateBags`, but keyed by a
// caller-supplied `styleGroup` token instead of a framework-defined state
// suffix — see plans/implemented/shared-instance-style-groups.md.
const _groupBags: Map<Function, Map<string, StyleLayer | null>> = new Map();

/**
 * The safe `ClassName--<suffix>` contribution a `styleGroup` token makes to a
 * literal DOM class name. Unlike a component id (only ever written through
 * `DOM.sink.setId`/an escaped selector string, never through `classList`), a
 * `styleGroup` token becomes part of a literal token `core/Component.ts`'s
 * `init()` passes straight to `classList.add` — and CSS-escaping alone (see
 * {@link ensureStyleGroupRule}'s selector construction) does not help there:
 * `CSS.escape` backslash-prefixes a space rather than removing it, so an
 * escaped token can still contain a raw ASCII space character and
 * `classList.add` still rejects it. ASCII whitespace is replaced with `-` so
 * the token is always a valid single class; `core/Component.ts`'s `init()`
 * and {@link ensureStyleGroupRule} both call this before building their
 * respective class name / selector, so the two always agree on the same
 * literal suffix regardless of what characters the caller's token contains.
 */
export function styleGroupClassSuffix(group: string): string {
    return group.replace(/\s+/g, "-");
}

/**
 * Ensures a shared `.ClassName--<group>` rule exists carrying `declarations`
 * — the first instance in this `(ctor, group)` pair to call this function
 * determines the shared content; every later instance compares against it.
 * Mirrors {@link ensureClassStateRule}'s cache shape, keyed by a
 * caller-supplied token instead of a framework-defined state suffix. Always
 * keyed on the concrete class alone — never an ancestor, regardless of
 * whether `ctor`'s chain participates in the hierarchy mechanism above.
 *
 * @param ctor - The concrete component class constructor.
 * @param group - The caller-supplied `styleGroup` token, verbatim (not yet
 *   escaped — see the selector construction below).
 * @param authored - This instance's own hoistable style bag
 *   (`core/Component.ts`'s `resolveInstanceStyleDeclarations`) — the *first*
 *   call for a given `(ctor, group)` pair determines what every later
 *   instance in the same group compares against. Run through
 *   `resolveDeclarations` internally to produce the layer's resolved half.
 *
 * @returns The group's style layer, or `null` when the selector name
 *   (`ClassName--group`) is already claimed by a different constructor — the
 *   same name-collision opt-out the base and state tiers use, in which case
 *   the caller must write every declaration to its own `#id` rule.
 */
export function ensureStyleGroupRule(
    ctor: Function,
    group: string,
    authored: StyleBag,
): StyleLayer | null {
    // Cached by the *normalised* suffix (see `styleGroupClassSuffix`), not
    // the raw token — the DOM class and CSS selector this function produces
    // are both derived from the normalised form, so two raw tokens that
    // normalise to the same suffix (e.g. "brand warning" and "brand-warning")
    // must be treated as the same group, not two independent cache entries
    // racing to overwrite one rule.
    const normalizedGroup = styleGroupClassSuffix(group);

    let byGroup = _groupBags.get(ctor);
    if (!byGroup) {
        byGroup = new Map();
        _groupBags.set(ctor, byGroup);
    }

    const existing = byGroup.get(normalizedGroup);
    if (existing !== undefined) {
        return existing;
    }

    const className = ctor.name;
    if (!className) {
        byGroup.set(normalizedGroup, null);

        return null;
    }

    // The group token is caller-supplied (unlike a state suffix, which the
    // framework itself defines) and becomes part of a `.ClassName--<group>`
    // selector, so it is CSS-escaped here — the same treatment a component id
    // already gets in `core/StyleTarget.ts`'s `component`-scope selector.
    const selectorName = className + "--" + DOM.source.escapeSelector(normalizedGroup);
    const owner = _owners.get(selectorName);

    if (owner !== undefined && owner !== ctor) {
        byGroup.set(normalizedGroup, null);

        return null;
    }

    _owners.set(selectorName, ctor);

    const declarations = resolveDeclarations(authored);

    if (Object.keys(declarations).length > 0) {
        new StyleRule({ scope: "class", name: selectorName, styles: declarations });
    }

    const layer = Object.freeze({ authored, resolved: Object.freeze({ ...declarations }) });
    byGroup.set(normalizedGroup, layer);

    return layer;
}

// ---------------------------------------------------------------------------
// Trait tier — a named, hand-authored bag of declarations any number of
// unrelated component classes, or a single instance, can opt into. Every
// opt-in for the same trait shares exactly one generated CSS rule. See
// plans/cross-class-style-groups.md.
// ---------------------------------------------------------------------------

/** A named bag of declarations any class or instance can opt into. */
export interface StyleTrait {
    /** Kebab-case, no whitespace; becomes the `ts-ui-trait-<name>` DOM class. */
    readonly name: string;
    readonly declarations: StyleBag;
}

/** Prefix of every trait DOM class token and selector. */
export const TRAIT_CLASS_PREFIX = "ts-ui-trait-";

/** `TRAIT_CLASS_PREFIX + trait.name`. */
export function traitClassName(trait: StyleTrait): string {
    return TRAIT_CLASS_PREFIX + trait.name;
}

/** A class with no declared traits shares this single frozen bag, so
 *  `resolveTraitStyleDefaults` is a no-op allocation for every component in
 *  the framework that never opts into a trait. */
const EMPTY_TRAIT_DEFAULTS: StyleBag = Object.freeze({});

interface StyleTraitLevelHost {
    ownStyleTraits?: readonly StyleTrait[];
}

/** Own-property read of a class's `ownStyleTraits` field — `null` when this
 *  exact class doesn't declare one, regardless of what an ancestor declares.
 *  Mirrors `ownDefaultsOf`'s own-property discipline (see its own comment). */
function ownTraitsOf(ctor: Function): readonly StyleTrait[] | null {
    return Object.prototype.hasOwnProperty.call(ctor, "ownStyleTraits")
        ? ((ctor as unknown as StyleTraitLevelHost).ownStyleTraits ?? null)
        : null;
}

// (ctor -> resolved trait list). Memoizes the hierarchy walk so a deep chain
// is only ever traversed once per constructor across the whole process.
const _resolvedTraits: Map<Function, readonly StyleTrait[]> = new Map();

/** Every trait `ctor` declares through `ownStyleTraits`, ancestor-most first,
 *  deduped by name. Memoized. No CSS side effect. */
export function resolveStyleTraits(rawCtor: Function): readonly StyleTrait[] {
    const ctor = canonicalCtor(rawCtor);
    const cached = _resolvedTraits.get(ctor);

    if (cached) {
        return cached;
    }

    const rawParentCtor = ctor === _rootCtor ? null : (Object.getPrototypeOf(ctor) as Function | null);
    const parentCtor    = rawParentCtor ? canonicalCtor(rawParentCtor) : null;
    const parentTraits  = (typeof parentCtor === "function" && parentCtor.name)
        ? resolveStyleTraits(parentCtor)
        : [];

    const own = ownTraitsOf(ctor);

    if (!own || own.length === 0) {
        _resolvedTraits.set(ctor, parentTraits);

        return parentTraits;
    }

    const seen   = new Set(parentTraits.map((trait) => trait.name));
    const merged = [...parentTraits];

    for (const trait of own) {
        if (!seen.has(trait.name)) {
            merged.push(trait);
            seen.add(trait.name);
        }
    }

    const resolved = Object.freeze(merged);
    _resolvedTraits.set(ctor, resolved);

    return resolved;
}

// (ctor -> merged declared bag). Memoizes the merge so it is only ever
// computed once per constructor across the whole process.
const _traitStyleDefaults: Map<Function, StyleBag> = new Map();

/** Every declared class-level trait's `declarations`, merged nearest-class-last.
 *  Memoized. No CSS side effect. */
export function resolveTraitStyleDefaults(rawCtor: Function): StyleBag {
    const ctor = canonicalCtor(rawCtor);
    const cached = _traitStyleDefaults.get(ctor);

    if (cached) {
        return cached;
    }

    const traits = resolveStyleTraits(ctor);

    if (traits.length === 0) {
        _traitStyleDefaults.set(ctor, EMPTY_TRAIT_DEFAULTS);

        return EMPTY_TRAIT_DEFAULTS;
    }

    let merged: StyleBag = {};
    for (const trait of traits) {
        merged = { ...merged, ...trait.declarations };
    }

    const frozen = Object.freeze(merged);
    _traitStyleDefaults.set(ctor, frozen);

    return frozen;
}

// (trait object -> its resolved layer, or null on a name collision). Keyed
// on the `StyleTrait` object's own identity — not its `name` string — so two
// *different* trait objects that happen to share a `name` each still get
// their own fresh evaluation (and therefore their own `_owners` check); a
// string-keyed cache would let the first trait's cached result shadow the
// second's lookup before its collision could ever be detected.
const _traitBags: Map<StyleTrait, StyleLayer | null> = new Map();

/**
 * Ensures the shared `.ts-ui-component.ts-ui-trait-<name>` rule exists for
 * `trait` and returns its layer. The rule itself is keyed on the trait's own
 * name — not a constructor — so two unrelated classes, or a class and an
 * unrelated instance, sharing the same `StyleTrait` object share one rule
 * for free. Mirrors {@link ensureStyleGroupRule}'s cache/insert shape.
 *
 * @param trait - The declared trait to ensure a rule for.
 *
 * @returns The trait's style layer, or `null` when `trait.name` is already
 *   owned by a different `StyleTrait` object — the same name-collision
 *   opt-out every other tier uses.
 */
export function ensureTraitStyleRule(trait: StyleTrait): StyleLayer | null {
    const existing = _traitBags.get(trait);

    if (existing !== undefined) {
        return existing;
    }

    const className = traitClassName(trait);
    const owner     = _owners.get(className);
    if (owner !== undefined && owner !== trait) {
        _traitBags.set(trait, null);

        return null;
    }
    _owners.set(className, trait);

    // Seeded with `FRAMEWORK_DEFAULTS` for the same reason `resolveClassLevel`
    // needs it: an absent `minSize`/`overflow` in `trait.declarations` would
    // otherwise resolve against `resolveDeclarations`'s own fallbacks
    // (`"auto"`/`"visible"`), which diverge from the framework baseline
    // (`"0px"`/`"hidden"`), producing spurious deviations.
    const resolved   = resolveDeclarations({ ...FRAMEWORK_DEFAULTS, ...trait.declarations });
    const deviations = deviationsFrom(resolved, FRAMEWORK_DECLARATIONS);

    if (Object.keys(deviations).length > 0) {
        // Built via `scope: "selector"` (a verbatim selector string), not
        // `scope: "class"` — a trait's rule is a compound selector
        // (`.ts-ui-component.ts-ui-trait-<name>`), pairing the universal
        // component token with the trait's own token so its specificity
        // `(0,2,0)` beats the class tier's `(0,1,0)` regardless of
        // stylesheet order (see the plan's Architecture Decisions).
        new StyleRule({
            scope:  "selector",
            name:   "." + COMPONENT_CLASS + "." + DOM.source.escapeSelector(className),
            styles: deviations,
        });
    }

    const layer = Object.freeze({ authored: trait.declarations, resolved: Object.freeze(deviations) });
    _traitBags.set(trait, layer);

    return layer;
}

/**
 * The real CSS property keys `trait`'s rule would paint that also appear in
 * `ctor`'s own top-priority (unguarded) declared state, if it has one — the
 * one case where a trait's `(0,2,0)` selector can tie in specificity with a
 * declared state's own bare `.ClassName.state` selector (see the plan's
 * Architecture Decisions on the state-tier specificity tie). At most one
 * entry in `resolveStyleStates(ctor)` can lack a `:not(...)` guard —
 * `guardedSuffixFor`'s own loop only skips entirely for index `0` — so
 * `.find` never needs to consider more than the one real candidate.
 *
 * @param ctor - The concrete component class constructor.
 * @param trait - The trait to check for a conflict against `ctor`'s own
 *   top-priority declared state.
 *
 * @returns The conflicting CSS property keys, or an empty array when there
 *   is no conflict (including when `ctor` declares no unguarded state at
 *   all). Pure — never throws, never inserts CSS.
 */
export function traitTopStateConflictKeys(ctor: Function, trait: StyleTrait): readonly string[] {
    const bare = resolveStyleStates(ctor).find((state) => !state.guardedSuffix.includes(":not("));

    if (!bare) {
        return [];
    }

    const resolved   = resolveDeclarations({ ...FRAMEWORK_DEFAULTS, ...trait.declarations });
    const deviations = deviationsFrom(resolved, FRAMEWORK_DECLARATIONS);

    return Object.keys(bare.layer.resolved).filter((key) => key in deviations);
}

