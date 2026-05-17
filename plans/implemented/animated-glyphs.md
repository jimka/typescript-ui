# Animated Glyphs — Implementation Plan

## Overview

Extend [`Glyph`](../src/typescript/lib/component/display/Glyph.ts) so any registered glyph can play one of three named, continuous, presentation-only animations — `spin`, `pulse`, `beat` — without rebuilding the DOM element or touching the registry. The animation is added by toggling a stable CSS class on the glyph's root element; the matching `@keyframes` blocks live in the shared "Base" stylesheet and are injected once on first use via the existing [`CSS.ensureKeyframes`](../src/typescript/lib/core/CSS.ts#L163) helper.

Animation is **presentation**, not identity. A `times` glyph spun in one place and static in another must work without two registry entries, so this lives as runtime state on the `Glyph` instance rather than as a third arm of the `GlyphDef` tagged union at [Glyphs.ts:39-41](../src/typescript/lib/component/display/Glyphs.ts#L39-L41). The semantics deliberately mirror FontAwesome's `fa-spin` / `fa-pulse` / `fa-beat` so the mental model carries over for anyone already familiar with that vocabulary.

The same class toggle applies cleanly to both `kind: "svg"` (root is `<svg>`) and `kind: "char"` (root is `<span>`) — CSS `transform` works on either element. Reduced-motion handling, theme-token-driven durations, and `will-change` priming are all in scope so the feature lands complete rather than as a stub.

---

## Architecture Decisions

### Three named animations — `spin`, `pulse`, `beat`

`spin` is a continuous 360° rotate, for loading and refresh affordances. `pulse` is an 8-step rotate (stepped easing, faux-loading), useful where the smoothness of `spin` reads as "live" but the consumer wants a more mechanical tick. `beat` is a transform-scale pulse for notification dots and similar attention nudges. These three match FontAwesome's vocabulary exactly so docs and call sites read naturally; users coming from FA hit the same names.

### Runtime presentation state, not a `GlyphDef` arm

A glyph's animation is per-instance and per-context. Extending the tagged union at [Glyphs.ts:39-41](../src/typescript/lib/component/display/Glyphs.ts#L39-L41) with a third arm `{ kind: "animated", base: GlyphDef, animation: … }` would force two registry entries when the same `times` is spun in one panel and static in another, and would also force a DOM rebuild whenever the user wanted to start or stop the animation. Keep `GlyphDef` static; add typed setters/getters on the `Glyph` instance.

### CSS class toggle, not inline animation shorthand

[`Component.setAnimation`](../src/typescript/lib/core/Component.ts#L2026) already exists and takes a raw CSS animation shorthand string. Reusing it (passing the assembled shorthand inline) would defeat keyframe deduplication, force per-instance theme-token resolution, and bypass the cheap class-name pathway browsers optimise for. Inject the keyframes once via [`CSS.ensureKeyframes`](../src/typescript/lib/core/CSS.ts#L163), declare three class rules (`.ts-ui-glyph-spin`, `.ts-ui-glyph-pulse`, `.ts-ui-glyph-beat`) that reference those keyframes plus the per-kind theme-token duration, and toggle the class on the glyph's root via `element.classList.add/remove`. The existing `setAnimation` stays untouched; the per-component `#id { animation: … }` rule still works for any consumer who wants inline control.

### New method names — `setAnimated` / `getAnimated` / `clearAnimated`

`Glyph` cannot override `setAnimation(value: string)` with a narrower `GlyphAnimation` enum signature — TypeScript would reject the incompatible override, and breaking the parent contract is the wrong fix. Use `setAnimated(kind: GlyphAnimation | null)`, `getAnimated()`, `clearAnimated()` on `Glyph`. Reads slightly differently from `setAnimation` but the type guarantees and class-based dispatch justify the rename. The `Glyph`-only typed setter coexists with the inherited raw `setAnimation`.

### Optional duration override

Each animation kind ships with a sensible default duration baked into its CSS rule via a theme token. Callers who need a faster or slower beat (e.g. a high-urgency notification) get `setAnimationDuration(ms: number)` which writes `animation-duration: <ms>ms` directly on the element's inline style — overriding the class-level rule via specificity. `getAnimationDuration()` returns the cached override or `0` when none is set (caller reads the active token for the live value).

### Reduced motion — skip the class, listen for live changes

When [`Animation.isReducedMotion()`](../src/typescript/lib/core/Animation.ts#L70) reports `true`, do not add the animation class. Static appearance is the correct fallback for all three kinds — `spin`/`pulse` shouldn't half-speed (still motion); `beat` shouldn't pump (still motion). On `setAnimated(kind)` cache the requested kind in `_animation` and only mount the class when not reduced-motion. Register one shared `matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", …)` listener at module scope that walks a `WeakSet<Glyph>` of currently-animated instances and toggles their classes in step with the OS preference. Tearing the listener down on disposal isn't needed — the `WeakSet` lets the GC collect un-rooted glyphs.

### `will-change: transform` while animated

All three kinds animate `transform`. Hint via the existing [`Component.setWillChange`](../src/typescript/lib/core/Component.ts#L2172) on `setAnimated(kind)` when a non-null kind is requested AND the animation actually mounts (i.e. reduced-motion is off). Clear it on `clearAnimated()` and on a reduced-motion live transition that pulls the class. Per the [will-change-hints](implemented/will-change-hints.md) plan: hint while motion is active, release otherwise.

### Theme-token-driven durations

Three new tokens — `--ts-ui-glyph-spin-duration`, `--ts-ui-glyph-pulse-duration`, `--ts-ui-glyph-beat-duration` — let consumers tune animation speed alongside the rest of the visual scale. Defaults: spin 2000 ms, pulse 1000 ms, beat 1000 ms (matches FA defaults). The class rules reference the tokens via `var(--ts-ui-glyph-spin-duration, 2000ms)` so a value can be unset entirely and the fallback still works.

### Both render modes work uniformly

`transform: rotate(...)` and `transform: scale(...)` apply to both `<svg>` and `<span>` elements without per-kind branching. The same class rule covers a `times` SVG glyph and an `arrow-right` Unicode glyph. No conditional logic in `Glyph` based on `_def.kind` for the animation.

---

## Public API (TypeScript Signatures)

### `Glyph` — `src/typescript/lib/component/display/Glyph.ts`

```typescript
/**
 * Named animation kinds supported by Glyph.setAnimated.
 *
 * @category Components
 */
export type GlyphAnimation = "spin" | "pulse" | "beat";

export interface GlyphOptions extends ComponentOptions {
    // ... existing fields (lineHeight, textAlign) ...

    /** Optional animation kind to play on this glyph from construction. */
    animation?:         GlyphAnimation;

    /**
     * Optional override (ms) for the active animation's duration. Wins over
     * the theme-token default while non-zero. Ignored when `animation` is unset.
     */
    animationDuration?: number;
}

class Glyph extends Component<GlyphOptions> {
    // ... existing members ...

    /** Returns the currently-playing animation kind, or null if none. */
    getAnimated(): GlyphAnimation | null;

    /**
     * Starts the named animation, or stops the current one when `kind` is null.
     * No-op when the requested kind already matches the current one.
     */
    setAnimated(kind: GlyphAnimation | null): this;

    /** Stops the current animation. Equivalent to setAnimated(null). */
    clearAnimated(): this;

    /** Returns the override duration (ms), or 0 when none has been set. */
    getAnimationDuration(): number;

    /**
     * Overrides the active animation's duration. Pass 0 to clear the override
     * and fall back to the theme-token default. No-op when no animation is
     * currently set.
     */
    setAnimationDuration(ms: number): this;
}
```

`setAnimated`, `getAnimated`, `clearAnimated`, `setAnimationDuration`, `getAnimationDuration` are the typed setters. Cached backing fields are `_animation: GlyphAnimation | null` and `_animationDuration: number`. Both new option keys (`animation`, `animationDuration`) route through `applyOptions` to their setters per the project's three-rule contract (setter / cached field / `XOptions` entry).

Existing `Component.setAnimation(value: string)` / `Component.getAnimation()` / `Component.clearAnimation()` are untouched and remain available on `Glyph` instances for callers who want raw shorthand control.

---

## Theme Tokens

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-glyph-spin-duration`  | `2000ms` | `2000ms` | Period of the continuous `spin` rotate. |
| `--ts-ui-glyph-pulse-duration` | `1000ms` | `1000ms` | Period of the 8-step `pulse` rotate. |
| `--ts-ui-glyph-beat-duration`  | `1000ms` | `1000ms` | Period of the `beat` scale pulse. |

Add a `glyph` block to the [`Theme` interface](../src/typescript/lib/core/Theme.ts#L17) alongside `progressSpinner` at [Theme.ts:247-251](../src/typescript/lib/core/Theme.ts#L247-L251):

```typescript
glyph: {
    spinDuration:  string;
    pulseDuration: string;
    beatDuration:  string;
};
```

Add matching entries to `DefaultTheme` ([Theme.ts:259](../src/typescript/lib/core/Theme.ts#L259)), `DarkTheme` ([Theme.ts:413](../src/typescript/lib/core/Theme.ts#L413)), and the `themeToVars` map ([Theme.ts:565-665](../src/typescript/lib/core/Theme.ts#L565-L665)). Light and dark defaults match — animation speed is not a colour-mode concern.

---

## Internal Structure

### Module-level setup (`Glyph.ts`)

```typescript
const CLASS_PREFIX = "ts-ui-glyph-";
const KINDS: ReadonlyArray<GlyphAnimation> = ["spin", "pulse", "beat"];

// Track currently-animated instances so reduced-motion live-toggles can
// mount/unmount the class on each affected glyph. WeakSet permits GC.
const animatedInstances = new WeakSet<_Glyph>();

let keyframesInjected = false;
function ensureGlyphKeyframes(): void {
    if (keyframesInjected) {
        return;
    }
    keyframesInjected = true;

    CSS.ensureKeyframes("ts-ui-glyph-spin",
        "from { transform: rotate(0deg); } to { transform: rotate(360deg); }");

    CSS.ensureKeyframes("ts-ui-glyph-pulse",
        "0%, 12.5%   { transform: rotate(0deg); }   " +
        "12.5%, 25%  { transform: rotate(45deg); }  " +
        "25%, 37.5%  { transform: rotate(90deg); }  " +
        "37.5%, 50%  { transform: rotate(135deg); } " +
        "50%, 62.5%  { transform: rotate(180deg); } " +
        "62.5%, 75%  { transform: rotate(225deg); } " +
        "75%, 87.5%  { transform: rotate(270deg); } " +
        "87.5%, 100% { transform: rotate(315deg); }");

    CSS.ensureKeyframes("ts-ui-glyph-beat",
        "0%, 90% { transform: scale(1); } 45% { transform: scale(1.25); }");

    // Class rules — declared once, reference tokens so theme cascades work.
    CSS.createClassRule(CLASS_PREFIX + "spin")!.style.cssText =
        "animation: ts-ui-glyph-spin var(--ts-ui-glyph-spin-duration, 2000ms) linear infinite;";

    CSS.createClassRule(CLASS_PREFIX + "pulse")!.style.cssText =
        "animation: ts-ui-glyph-pulse var(--ts-ui-glyph-pulse-duration, 1000ms) steps(8) infinite;";

    CSS.createClassRule(CLASS_PREFIX + "beat")!.style.cssText =
        "animation: ts-ui-glyph-beat var(--ts-ui-glyph-beat-duration, 1000ms) ease-in-out infinite;";
}

// One module-level listener; flips class membership in lockstep with the OS.
matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => {
    // animatedInstances is opaque; the live toggle walks via per-instance
    // re-application — see Glyph.setAnimated, which reads isReducedMotion()
    // each time it touches the class. The module listener exists so that an
    // already-animated glyph re-evaluates without the user re-calling setAnimated.
    // A registry of WeakRef<_Glyph> is the implementation route — see Step 5.
});
```

### Per-instance state

```typescript
private _animation:         GlyphAnimation | null = null;
private _animationDuration: number                = 0;
```

### `setAnimated` body sketch

```typescript
setAnimated(kind: GlyphAnimation | null): this {
    if (this._animation === kind) {
        return this;
    }

    // Drop the previous class, if any.
    const prev = this._animation;
    if (prev) {
        this.getElement(true).classList.remove(CLASS_PREFIX + prev);
        this.setWillChange(null);
    }

    this._animation = kind;

    if (kind === null) {
        // Also drop any duration override.
        this.setElementStyle("animationDuration", null);
        return this;
    }

    ensureGlyphKeyframes();

    if (!Animation.isReducedMotion()) {
        this.getElement(true).classList.add(CLASS_PREFIX + kind);
        this.setWillChange("transform");
    }

    if (this._animationDuration > 0) {
        this.setElementStyle("animationDuration", this._animationDuration + "ms");
    }

    return this;
}
```

`setElementStyle` is `protected` on `Component`; `Glyph` is a subclass so it can call it. `setWillChange` is public ([Component.ts:2172](../src/typescript/lib/core/Component.ts#L2172)).

---

## Ordered Implementation Steps

1. **Add `GlyphAnimation` type and `GlyphOptions` fields** in [Glyph.ts](../src/typescript/lib/component/display/Glyph.ts) (after the existing `GlyphOptions` interface).
2. **Add `_animation`, `_animationDuration` fields** and the module-level constants (`CLASS_PREFIX`, `KINDS`, `animatedInstances` WeakSet) to [Glyph.ts](../src/typescript/lib/component/display/Glyph.ts).
3. **Write `ensureGlyphKeyframes()`** — injects three `@keyframes` rules via [`CSS.ensureKeyframes`](../src/typescript/lib/core/CSS.ts#L163) plus three class rules via [`CSS.createClassRule`](../src/typescript/lib/core/CSS.ts#L137), guarded by a module-level `keyframesInjected` boolean.
4. **Add typed setters** `setAnimated`, `getAnimated`, `clearAnimated`, `setAnimationDuration`, `getAnimationDuration` on `Glyph`. Class toggle via `element.classList.add/remove`; will-change set/clear via existing `setWillChange`; duration override via `setElementStyle("animationDuration", …)`.
5. **Wire the reduced-motion live listener.** Maintain a module-level `Set<WeakRef<_Glyph>>` of currently-animated instances. On a `matchMedia` `change` event, iterate the set, drop dead refs, and call each live instance's class re-application path (private method `_syncReducedMotion()` that adds/removes the class to match `Animation.isReducedMotion()`). Register/deregister the WeakRef on `setAnimated(kind)` / `clearAnimated()`.
6. **Route options through `applyOptions`** at the existing dispatch site ([Glyph.ts:200-212](../src/typescript/lib/component/display/Glyph.ts#L200-L212)): `if (options.animation !== undefined) this.setAnimated(options.animation);` then the duration block.
7. **Add `glyph` block to `Theme` interface, `DefaultTheme`, `DarkTheme`, and `themeToVars`** in [Theme.ts](../src/typescript/lib/core/Theme.ts).
8. **JSDoc the new symbols.** `@category Components` on `GlyphAnimation`, one usage example on `setAnimated`. Same-bucket links to `Glyph` via `{@link}`; cross-bucket references to `Animation` / `Component.setWillChange` via markdown links per [CLAUDE.md](../CLAUDE.md).
9. **Regression checkpoint:** `grep -rn 'setAnimation(' src/typescript/lib/component/display/Glyph.ts` — expect zero matches (we did not override the parent method).
10. **Regression checkpoint:** `grep -n 'glyph' src/typescript/lib/core/Theme.ts` — expect three new entries in each of `Theme` interface, `DefaultTheme`, `DarkTheme`, and `themeToVars`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/display/Glyph.ts` — new type, options fields, setters, module-level keyframe + class-rule injection, WeakRef registry, reduced-motion listener. |
| Modify | `src/typescript/lib/core/Theme.ts` — `glyph` block on the `Theme` interface, defaults in `DefaultTheme` and `DarkTheme`, three new entries in `themeToVars`. |

No new files. No deletions. `Glyphs.ts`, `Component.ts`, and `CSS.ts` are unchanged — the helpers exist and are reused as-is.

---

## Verification

1. **Type-check:**
   ```
   npm run typecheck
   ```
2. **Library build:**
   ```
   npm run build:lib
   ```
3. **Docs build clean** (per [CLAUDE.md](../CLAUDE.md) — zero errors, zero new link warnings; typedoc's "unsupported TypeScript version" is the only acceptable warning):
   ```
   npm run docs:build
   ```
4. **Manual smoke** on the dev server (`npm run dev`, http://localhost:8015) — pick the demo screen that already mounts a `Glyph` (e.g. MiscPanel) and add temporarily:
   ```typescript
   const g = new Glyph("times");
   g.setAnimated("spin");
   panel.addComponent(g);
   ```
   Confirm: continuous rotation. Call `g.setAnimated("pulse")` from devtools console — animation switches without DOM rebuild. Call `g.setAnimated("beat")` — scale pulse. Call `g.clearAnimated()` — stops; `will-change` clears.
5. **Theme toggle:** switch from `DefaultTheme` to `DarkTheme` — animation continues at the same speed (durations identical across themes). Edit `--ts-ui-glyph-spin-duration` live in DevTools — speed changes immediately.
6. **Reduced-motion toggle:** flip OS preference (Linux: `gsettings set org.gnome.desktop.interface enable-animations false` or DevTools "Emulate CSS prefers-reduced-motion: reduce"). All three kinds visibly stop on the active glyph without a `setAnimated` call. Flip back — they resume.
7. **Will-change sanity** in DevTools Layers panel: an animated glyph appears as its own compositor layer; `clearAnimated` releases it.
8. **Grep invariants:**
   ```
   grep -rn 'ts-ui-glyph-' src/typescript/lib/component/display/Glyph.ts
   ```
   Expect: nine matches (three keyframe names + three class names + three `var(--…)` references) — i.e. all class/keyframe names live in this one file.
9. **Refresh the knowledge graph:**
   ```
   graphify update . --directed
   ```

---

## Documentation Impact

- `Glyph` and `GlyphOptions` are already exported from the `component/display` barrel at [src/typescript/lib/component/display/index.ts:7-8](../src/typescript/lib/component/display/index.ts#L7-L8); `GlyphAnimation` is added to the same export.
- The curated docs page is [docs/components/Glyph.md](../docs/components/Glyph.md) (sidebar entry at [docs/.vitepress/config.mts:87](../docs/.vitepress/config.mts#L87)). Add a short subsection covering `setAnimated`, the three kinds, the duration override, and reduced-motion behaviour. No new page; no sidebar change.
- Cross-bucket JSDoc references to `Animation.isReducedMotion` and `Component.setWillChange` must use markdown links — both live outside `component/display`. `{@link}` to own-bucket symbols (`Glyph`, `GlyphOptions`) is fine.

---

## Potential Challenges

- **Name shadowing with `Component.setAnimation`.** The inherited raw setter still exists on `Glyph`; readers may confuse it with `setAnimated`. Mitigation: the JSDoc on `setAnimated` explicitly contrasts it with `setAnimation` and points to the typed-enum guarantee.
- **`createClassRule` returns null when the rule already exists.** The `!` non-null assertion in the sketch is correct only on first call (guarded by `keyframesInjected`). Mitigation: the boolean guard ensures `ensureGlyphKeyframes` runs exactly once per page.
- **WeakRef availability.** `WeakRef` is widely supported (Chrome 84+, Firefox 79+, Safari 14.1+), which exceeds the project's existing baseline. Mitigation: none needed — the dev URL is Chrome-only.
- **Class added before `element` exists.** `getElement(true)` is the eager form and guarantees the element is materialised; the `setElementCSSRule` precedent in the existing setters does the same.
- **Char-mode glyphs already inherit `text-align: center` and `line-height: 1`** from the constructor. The `transform` animation operates on the element box, not the text, so the inherited rules don't interfere — but verify visually on at least one char-mode kind during smoke.

---

## Critical Files

- [src/typescript/lib/component/display/Glyph.ts](../src/typescript/lib/component/display/Glyph.ts) — the only file gaining significant code.
- [src/typescript/lib/component/display/Glyphs.ts](../src/typescript/lib/component/display/Glyphs.ts) — read to confirm `GlyphDef` stays untouched.
- [src/typescript/lib/core/CSS.ts](../src/typescript/lib/core/CSS.ts) — uses `ensureKeyframes` at [line 163](../src/typescript/lib/core/CSS.ts#L163) and `createClassRule` at [line 137](../src/typescript/lib/core/CSS.ts#L137); no edits.
- [src/typescript/lib/core/Animation.ts](../src/typescript/lib/core/Animation.ts) — `isReducedMotion()` at [line 70](../src/typescript/lib/core/Animation.ts#L70); no edits.
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — existing `setAnimation` at [line 2026](../src/typescript/lib/core/Component.ts#L2026) (the name collision to design around) and `setWillChange` at [line 2172](../src/typescript/lib/core/Component.ts#L2172) (the will-change hook to reuse).
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — four touch points: `Theme` interface, `DefaultTheme`, `DarkTheme`, `themeToVars`.
- [plans/implemented/embedded-glyph.md](implemented/embedded-glyph.md) — original design rationale (`currentColor`, no-name-swap, callable export).
- [plans/implemented/will-change-hints.md](implemented/will-change-hints.md) — the contract for setting `will-change` only across active-motion lifetimes.

---

## Non-Goals

- **No additional animation kinds.** Bounce, flip, fade, shake — all common in icon libraries but each adds CSS rules, theme tokens, and JSDoc surface. Three kinds cover the loading / faux-loading / attention triad. Add more only when a real call site asks for one.
- **No `setAnimationIterationCount` / `setAnimationDelay` / per-axis controls.** The class-rule approach intentionally fixes those to `infinite` and `0s`. A consumer who needs one-shot or delayed animation falls back to the inherited `Component.setAnimation(value: string)` shorthand.
- **No animation queueing / chaining.** One kind active at a time; `setAnimated("spin")` after `setAnimated("beat")` cuts the beat dead. Tweening, sequencing, or composition is out.
- **No registry-level `defaultAnimation` per glyph.** The `bell` glyph doesn't beat by default; the consumer opts in per-instance.
- **No removal or override of the inherited `Component.setAnimation`.** The two APIs coexist; the typed-enum surface is additive.
- **No `Glyph.stopOnVisibilityChange()` or page-visibility integration.** Browsers already throttle off-screen animations to ~1 fps; adding a manual stop/start ladder is premature.
