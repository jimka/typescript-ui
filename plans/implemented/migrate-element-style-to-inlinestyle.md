# Migrate Direct `HTMLElement.style.*` Writes To The `InlineStyle` Buffer — Implementation Plan

## Overview

[ARCHITECTURE.md](../ARCHITECTURE.md) forbids direct writes to `HTMLElement.style` (`element.style.X = …`, `element.style.setProperty(…)`, `element.style.cssText = …`, `Object.assign(element.style, …)`). The single allowed seam is the `InlineStyle` deferred-write buffer in [core/StyleTarget.ts:155](../src/typescript/lib/core/StyleTarget.ts#L155). Component's [`setElementStyle` / `setElementStyles`](../src/typescript/lib/core/Component.ts#L548) already route through `_inlineStyle`; the remaining sites bypass it.

This is the sibling plan to [migrate-rule-style-to-stylerule.md](migrate-rule-style-to-stylerule.md) — that plan addresses `CSSStyleRule.style.*` (the `StyleRule` destination); this one addresses `HTMLElement.style.*` (the `InlineStyle` destination). Together they close the two write paths ARCHITECTURE.md owns.

`grep -rnE 'element\.style\.|Object\.assign\([^,]*\.style' src/typescript` currently returns hits across five clusters:

1. **The framework's own render-time inline writes** inside [Component.applyStyle:2664-2734](../src/typescript/lib/core/Component.ts#L2664-L2734) — `width` / `top` / `left` / `height` / `pointerEvents` / `zIndex` / `transition`. These bypass `_inlineStyle` even though it is already attached by the time `applyStyle` runs (see Architecture Decisions below).
2. **`Component.setDisplayed`** at [Component.ts:828](../src/typescript/lib/core/Component.ts#L828) writes `element.style.display = …` directly.
3. **Component-owned single setters**: [TextArea.ts:245](../src/typescript/lib/component/input/TextArea.ts#L245) (`resize`), [SplitGutter.ts:185](../src/typescript/lib/component/container/SplitGutter.ts#L185) (`cursor`), [WindowBorder.ts:189](../src/typescript/lib/component/container/WindowBorder.ts#L189) (`cursor`), [VirtualScroller.ts:77](../src/typescript/lib/component/container/VirtualScroller.ts#L77) (`touch-action`).
4. **`Object.assign(el.style, …)`** in [Animation.ts:95,105,130](../src/typescript/lib/core/Animation.ts#L95) (the `play()` transition driver, ×3 sites) plus the in-flight transition writes at [Animation.ts:101,120](../src/typescript/lib/core/Animation.ts#L101) (`el.style.transition = …`).
5. **`HTMLElement.style.cssText`** writes on measurement probes in [Util.ts:80,96](../src/typescript/lib/core/Util.ts#L80) (`probe.style.cssText`, `ref.style.cssText`).

After migration, the grep checkpoint `grep -rnE 'element\.style\.|Object\.assign\([^,]*\.style|\.style\.cssText' src/typescript` returns **0 matches** (excluding `StyleTarget.ts` internals).

---

## Architecture Decisions

### The materialisation ordering "problem" the sibling plan flagged is a non-issue

[migrate-rule-style-to-stylerule.md](migrate-rule-style-to-stylerule.md) explicitly punted on the seven `element.style.X` writes inside `Component.applyStyle`, calling out that `_inlineStyle` is "not attached to the element inside `applyStyle` (it materialises in `init()`)". A re-read of [Component.init](../src/typescript/lib/core/Component.ts#L3168-L3206) shows the opposite: `init()` calls `this._inlineStyle.attach(element)` at [line 3180](../src/typescript/lib/core/Component.ts#L3180) **before** calling `this.applyStyle(element)` at [line 3195](../src/typescript/lib/core/Component.ts#L3195). So by the time the seven inline writes fire, `_inlineStyle` is materialised; calls to `_inlineStyle.set(...)` write straight through.

This means each `element.style.X = …` line inside `applyStyle` converts mechanically to `this._inlineStyle.set("X", value)` (or `this.setElementStyle("X", value)` — the public wrapper). No new API on `StyleTarget`, no re-ordering of `init()`, no new lifecycle hook. The sibling plan's caveat was based on a misread.

`applyStyle` starts with `element.removeAttribute("style")` at [line 2614](../src/typescript/lib/core/Component.ts#L2614). After the wipe, the buffer's dirty bag is already empty (`attach()` flushed it). Subsequent `_inlineStyle.set(...)` calls go through the live-target path and land on the now-blank inline style. No behavioural change.

### Typed setters first, raw buffer second

For the four single-property Component-owned sites (TextArea `resize`, SplitGutter `cursor`, WindowBorder `cursor`, VirtualScroller `touchAction`), the right migration is a typed setter on the owning class (cache field + `applyOptions` dispatch), per ARCHITECTURE.md's "Three non-negotiable rules". `setCursor` already exists on `Component` (see [Component.ts:1144](../src/typescript/lib/core/Component.ts#L1144)) — SplitGutter and WindowBorder route their cursor writes through it. `setTouchAction` and `setResize` need to be added — `setTouchAction` on `Component` (general utility) and `setResize` on `TextArea` (specific to that subclass).

For the seven `applyStyle` sites, the writes are private framework plumbing — they don't deserve typed setters with their own backing fields, because `_width`, `_height`, `_top`, `_left`, `_transition`, and the option-derived `pointerEvents`/`zIndex` already have backing state. `applyStyle`'s job is to **flush that cached state to the DOM**, not to be another seam. Route directly through `this._inlineStyle.set(...)` from inside `applyStyle` — the existing typed setters (`setWidth`, `setHeight`, `setTop`, `setLeft`, `setTransition`, `setPointerEvents`, `setZIndex`) already exist and already write through `setElementStyle` for the *non-applyStyle* update path; they just don't fire from `applyStyle`.

### `Animation.play` wraps a transient `InlineStyle` per call

`Animation.play(el, config)` operates on arbitrary `HTMLElement` references — the element may not be a `Component`. The three `Object.assign(el.style, …)` sites map onto a transient `InlineStyle` wrapping the element: `const buf = new InlineStyle(); buf.attach(el); buf.setMany(config.to)`. `attach()` is the existing public method; no new factory needed.

The two inline `el.style.transition = …` assignments at [Animation.ts:101](../src/typescript/lib/core/Animation.ts#L101) and [Animation.ts:120](../src/typescript/lib/core/Animation.ts#L120) also migrate to the same buffer (`buf.set("transition", value)`). The buffer is cheap (one allocation, one materialise) and re-use within a single `play()` call keeps the writes coherent.

The buffer is local to `play()`; we don't cache or share it. Each `play()` invocation gets a fresh one.

### `Util` measurement probes wrap a transient `InlineStyle` per probe

The two `cssText = …` writes at [Util.ts:80,96](../src/typescript/lib/core/Util.ts#L80) install up to 10 layout properties on a detached `<span>` for one-shot measurement. They migrate to the same transient-`InlineStyle` shape — parse the existing `cssText` string into camelCase key/value pairs, call `buf.setMany({...})`.

The probe is appended to `document.body`, measured, then removed. Materialise the buffer **before** measurement (which forces layout) so the writes are live by then. `attach()` flushes the dirty bag synchronously — measurement immediately afterwards sees the styled element.

### `Component.setDisplayed` routes through `setElementStyle`

Line 828's `element.style.display = …` is the same pattern as the seven `applyStyle` sites — write through `setElementStyle("display", value)`. By the time `setDisplayed` runs in the post-init path (the guard at line 824 returns early if `getElement()` is null), `_inlineStyle` is already attached, so `setElementStyle` writes through directly.

The pre-init path (when the caller fires `setDisplayed` before `init()`) is handled by `applyStyle`'s opt-driven `display` write at [Component.ts:2642](../src/typescript/lib/core/Component.ts#L2642), which goes through `rule.style.display` (the sibling plan migrates that to `_styleRule.set("display", …)`). Both paths converge on the same buffer machinery.

### `Animation.ts` and `Util.ts` `el.addEventListener` stays out of scope

`Animation.play` registers a `transitionend` listener via `el.addEventListener("transitionend", finish, { once: true })` at [Animation.ts:125](../src/typescript/lib/core/Animation.ts#L125), and `Animation.afterTransition` does the same at line 218. These are listener-side violations, not style-side — sibling concern, separate plan ([migrate-listeners-to-event.md](migrate-listeners-to-event.md) per the architecture-violations report).

---

## Public API (TypeScript Signatures)

### `Component` — new typed setters

```typescript
// src/typescript/lib/core/Component.ts

export interface ComponentOptions {
    touchAction?: string | null;   // new
    // … existing fields
}

class _Component<TOptions extends ComponentOptions = ComponentOptions> {
    declare private _touchAction: string | null;

    setTouchAction(value: string): this;
    getTouchAction(): string | null;
    clearTouchAction(): this;
}
```

`setTouchAction` routes through `setElementStyle("touchAction", value)` and writes the backing field. `clearTouchAction` calls `setTouchAction(null as any)` (or sets directly to `null`). `applyOptions(options)` forwards `options.touchAction` to the setter when defined. Follows the canonical three-non-negotiables (typed setter + backing field + options field) per ARCHITECTURE.md.

### `TextArea` — new typed setter

```typescript
// src/typescript/lib/component/input/TextArea.ts

export interface TextAreaOptions extends InputOptions {
    resize?: string | null;   // new
    // … existing fields
}

class _TextArea extends Input<TextAreaOptions> {
    declare private _resize: string | null;

    setResize(value: string): this;
    getResize(): string | null;
    clearResize(): this;
}
```

Same shape — backing field, options forwarding, routes through `setElementStyle("resize", value)`. The current hard-coded `"none"` becomes the construction-time default applied via `setElementStyle("resize", "none")` if no `options.resize` override is supplied.

### No changes to `InlineStyle`'s public surface

`new InlineStyle()` + `attach(el)` already exposes everything `Animation.play` and `Util` need. No factory method (`InlineStyle.of`) added — the inline two-liner is short enough to stay at each call site.

---

## Internal Structure

### `Component.applyStyle` after migration (seven sites)

```typescript
// Before:
if (!Number.isNaN(this._width)) {
    element.style.width = this._width + "px";
}
// After:
if (!Number.isNaN(this._width)) {
    this._inlineStyle.set("width", this._width + "px");
}
```

Same shape for `top` / `left` / `height` / `pointerEvents` / `zIndex` / `transition`. The `element` parameter to `applyStyle` is unused after migration (the `removeAttribute("style")` at line 2614 still needs it — leave that line as is). No other change.

### `Component.setDisplayed` after migration

```typescript
// Before (Component.ts:828):
element.style.display = v ? this._display : "none";

// After:
this.setElementStyle("display", v ? this._display : "none");
```

The leading `getElement()` check (line 823) stays — `setElementStyle` is safe to call before init, but the early-return at line 825 short-circuits the path so a pre-init setter call doesn't double-write.

### `Animation.play` after migration

```typescript
// Before (Animation.ts:90-136):
export function play(el: HTMLElement, config: PlayConfig): void {
    const easing   = config.easing ?? "ease-out";
    const fallback = config.fallbackBufferMs ?? 40;

    if (isReducedMotion()) {
        Object.assign(el.style, config.to);
        config.onComplete?.();
        return;
    }
    // … applyTransitionAndTo() with el.style.transition = … and Object.assign(el.style, config.to)
    // … finally if (config.from) Object.assign(el.style, config.from) before rAF chain
}

// After:
export function play(el: HTMLElement, config: PlayConfig): void {
    const easing   = config.easing ?? "ease-out";
    const fallback = config.fallbackBufferMs ?? 40;

    const buf = new InlineStyle();
    buf.attach(el);

    if (isReducedMotion()) {
        buf.setMany(config.to);
        config.onComplete?.();
        return;
    }

    const applyTransitionAndTo = (): void => {
        buf.set(
            "transition",
            config.properties.map(p => `${p} ${config.durationMs}ms ${easing}`).join(", "),
        );
        buf.setMany(config.to);
        // …
    };
    // …
}
```

The `el.style.transition = ""` clear at line 120 becomes `buf.set("transition", null)`. The `finish` callback closes over `buf` so the clear lands on the same buffer instance.

`afterTransition` (lines 194-220) doesn't touch styles — only registers a `transitionend` listener — so no style migration needed there; the `el.addEventListener` call is the listener plan's concern.

### `Util.ts` probe migration

```typescript
// Before (Util.ts:78-83):
const probe = document.createElement("span");
probe.style.cssText = [
    "position:absolute",
    "visibility:hidden",
    // …
].join(";");

// After:
const probe = document.createElement("span");
const buf   = new InlineStyle();
buf.attach(probe);
buf.setMany({
    position:   "absolute",
    visibility: "hidden",
    // …
});
```

CamelCase the keys. Same shape for the `ref` probe at line 95.

### Single-property setter migrations

```typescript
// TextArea.ts:245 (in render() after super.render()):
// Before:
element.style.resize = "none";
// After (if no setResize call has fired by render time):
this.setElementStyle("resize", "none");
// Or — cleaner — set in constructor as the class default:
//   this.setResize("none");  // via the new typed setter

// SplitGutter.ts:185 (cursor selection by direction):
// Before:
element.style.cursor = this._direction == "horizontal" ? "ew-resize" : "ns-resize";
// After:
this.setCursor(this._direction == "horizontal" ? "ew-resize" : "ns-resize");

// WindowBorder.ts:189:
// Before:
element.style.cursor = cursor;
// After:
this.setCursor(cursor);

// VirtualScroller.ts:77:
// Before:
element.style.touchAction = "none";
// After (via the new typed setter):
this.setTouchAction("none");
```

---

## Ordered Implementation Steps

Each step ends with a targeted grep checkpoint. The cumulative grep is the final gate.

1. **Component.ts — add `setTouchAction` / `getTouchAction` / `clearTouchAction`.** Backing field `_touchAction: string | null = null` declared with `declare` (per the class-field super-cascade trap memory — fields written by setters during `super()` must be declared, not initialised). `applyOptions` forwards `options.touchAction` when defined. `setTouchAction` routes through `setElementStyle("touchAction", value)`. **Verify:** `grep -n 'setTouchAction\|_touchAction\|touchAction?' src/typescript/lib/core/Component.ts` → at least 4 hits (interface, field, setter, applyOptions).

2. **TextArea.ts — add `setResize` / `getResize` / `clearResize`.** Same shape. Add `resize?: string` to `TextAreaOptions`. Replace the constructor's hard-coded inline write (line 245) with `this.setResize("none")` so the class default flows through the typed setter. **Verify:** `grep -n 'setResize\|_resize\|resize?' src/typescript/lib/component/input/TextArea.ts` → at least 4 hits; `grep -n 'element\.style\.' src/typescript/lib/component/input/TextArea.ts` → 0.

3. **SplitGutter.ts — route through `setCursor`.** Replace the `element.style.cursor = …` line at 185 with `this.setCursor(...)`. **Verify:** `grep -n 'element\.style\.' src/typescript/lib/component/container/SplitGutter.ts` → 0.

4. **WindowBorder.ts — route through `setCursor`.** Same as step 3 for line 189. **Verify:** `grep -n 'element\.style\.' src/typescript/lib/component/container/WindowBorder.ts` → 0.

5. **VirtualScroller.ts — route through `setTouchAction`.** Replace the line 77 inline write with `this.setTouchAction("none")` (called from constructor after `super()`). **Verify:** `grep -n 'element\.style\.' src/typescript/lib/component/container/VirtualScroller.ts` → 0.

6. **Component.setDisplayed — route through `setElementStyle`.** Replace line 828's `element.style.display = …` with `this.setElementStyle("display", v ? this._display : "none")`. Keep the leading `getElement()` guard. **Verify:** `grep -n 'element\.style\.display' src/typescript/lib/core/Component.ts` → 0.

7. **Component.applyStyle — route the seven inline writes through `_inlineStyle.set`.** Each `element.style.X = value` line at 2665 / 2669 / 2673 / 2677 / 2721 / 2725 / 2734 converts to `this._inlineStyle.set("X", value)`. The `element.removeAttribute("style")` at line 2614 stays. `element` is still used for that one call — keep the parameter, just stop writing to its `.style`. **Verify:** `grep -n 'element\.style\.' src/typescript/lib/core/Component.ts` → 0.

8. **Animation.play — wrap each call in a transient `InlineStyle`.** Allocate `const buf = new InlineStyle(); buf.attach(el)` at the top of `play()`. Replace the three `Object.assign(el.style, …)` calls with `buf.setMany(...)`, the `el.style.transition = …` writes with `buf.set("transition", value)`, and the `el.style.transition = ""` clear with `buf.set("transition", null)`. The `applyTransitionAndTo` closure captures `buf`; the `finish` callback also captures it for the transition clear. **Verify:** `grep -n 'el\.style\.\|Object\.assign(.*el\.style' src/typescript/lib/core/Animation.ts` → 0.

9. **Util.ts — wrap each measurement probe in a transient `InlineStyle`.** For the `probe` at lines 78-83 and the `ref` at lines 95-96: keep `document.createElement("span")`, then `const buf = new InlineStyle(); buf.attach(probe); buf.setMany({...})`. Parse the existing `cssText` string into a camelCase key/value bag — `position: "absolute"`, `visibility: "hidden"`, etc. **Verify:** `grep -n '\.style\.cssText' src/typescript/lib/core/Util.ts` → 0.

10. **Final grep gate.** `grep -rnE 'element\.style\.|Object\.assign\([^,]*\.style|\.style\.cssText' src/typescript` excluding `StyleTarget.ts` → **0 matches**. Any non-zero output is a blocker for declaring step 9 done.

11. **Typecheck.** `npx tsc --noEmit` → 0 errors.

12. **Smoke verification** (matches `plans/migrate-rule-style-to-stylerule.md`'s smoke step). Open `http://localhost:8015`:
    - Drag-resize a `Split` panel — cursor changes to `ew-resize` / `ns-resize` (steps 3).
    - Drag a `Window`'s edge — border cursor updates (step 4).
    - Open the slow table in `MiscPanel`, scroll via touch on a touch device — `touch-action: none` keeps native scroll suppressed (step 5).
    - Toggle a component's visibility via a `setDisplayed(false)` / `setDisplayed(true)` cycle (step 6) — paint reflows correctly.
    - Open any panel that animates in via `Animation.play` (Notification appearance, AnimatedDropdown show) — transition still fires; reduced-motion still synchronous (step 8). Toggle `prefers-reduced-motion` in DevTools to exercise both branches.
    - Type into a `TextArea` — corner resize handle absent (step 2).
    - Theme-toggle to dark mode; everything still renders.

13. **`graphify update .`** — refresh the graph; commit `graphify-out/**` as its own commit per the `implement` skill's three-commit structure.

---

## Files to Create / Modify / Delete

| Action | File                                                                                          |
|--------|-----------------------------------------------------------------------------------------------|
| Modify | `src/typescript/lib/core/Component.ts` — add `setTouchAction`; migrate `applyStyle` seven sites + `setDisplayed` |
| Modify | `src/typescript/lib/component/input/TextArea.ts` — add `setResize`; migrate constructor inline write |
| Modify | `src/typescript/lib/component/container/SplitGutter.ts` — route through `setCursor`           |
| Modify | `src/typescript/lib/component/container/WindowBorder.ts` — route through `setCursor`          |
| Modify | `src/typescript/lib/component/container/VirtualScroller.ts` — route through `setTouchAction`  |
| Modify | `src/typescript/lib/core/Animation.ts` — transient `InlineStyle` wrapping in `play()`         |
| Modify | `src/typescript/lib/core/Util.ts` — transient `InlineStyle` wrapping for measurement probes   |

No files created, no files deleted. No new theme tokens. No new public components.

---

## Verification

- `grep -rnE 'element\.style\.|Object\.assign\([^,]*\.style|\.style\.cssText' src/typescript` → **0 matches** (excluding `StyleTarget.ts`).
- `grep -rn 'setTouchAction\b' src/typescript` → at least 2 matches (Component declaration + VirtualScroller call site).
- `grep -rn 'setResize\b' src/typescript` → at least 2 matches (TextArea declaration + constructor call site).
- `npx tsc --noEmit` → 0 errors.
- `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning). `Component.setTouchAction` and `TextArea.setResize` appear in the regenerated API pages.
- Manual smoke per step 12 in light and dark themes.
- `graphify update .` succeeds; the `InlineStyle` node's connectivity grows; the seven `element.style.*` edges disappear from `graphify-out/GRAPH_REPORT.md`'s community 4 (StyleRule/InlineStyle cluster).

---

## Documentation Impact

- **Per-subpath barrel exports**: `Component` and `TextArea` already export through their respective subpath barrels (`src/typescript/lib/core/index.ts` and `src/typescript/lib/component/input/index.ts`); the new typed setters land on existing exported classes, no barrel changes needed.
- **Curated catalog pages**: if `docs/core/Component.md` or `docs/component/input/TextArea.md` exist, mention `setTouchAction` / `setResize` in the catalog table. Verify after `npm run docs:build` regenerates the API pages.
- **Cross-bucket JSDoc**: `setTouchAction` and `setResize` JSDoc may reference `setElementStyle` — both live on the same class, so no cross-bucket markdown-link rewriting needed.
- No renames, no removals — purely additive.

---

## Potential Challenges

- **`Animation.play` buffer lifetime.** `buf` is allocated per call. The `finish` closure (which runs on `transitionend` or via the `setTimeout` fallback) writes `buf.set("transition", null)` — the buffer must outlive the closure. JS closure capture handles this; no explicit cleanup needed because `buf` and `el` both go out of scope together. Mitigation: confirm by inspection that `buf` is referenced after the `applyTransitionAndTo` closure returns.

- **`Util.ts` probe materialisation timing.** `attach()` flushes the dirty bag synchronously, so `buf.attach(probe)` followed by `buf.setMany({...})` writes through immediately. Subsequent `document.body.appendChild(probe)` and `getBoundingClientRect()` see the styled element. Mitigation: keep the `attach` → `setMany` → `appendChild` → measure order. If a future change moves `attach` after `appendChild`, the writes still land — just less efficiently (queued then flushed at attach time).

- **`setDisplayed` early-return guard.** Line 824's `if (!element) return this;` runs *after* line 821 wrote `this._options.displayed = v`. After migration, the post-init path calls `setElementStyle("display", …)`, which routes through `_inlineStyle.set` (live writes through; pre-init writes queue). Removing the guard would let the pre-init path queue the write, which is correct — but the guard is intentionally preserving "no-op when there's no element to update", and removing it would change observable behaviour for callers that fire `setDisplayed` *before* render. Keep the guard.

- **`applyStyle` after the `removeAttribute("style")` wipe.** `_inlineStyle.set` writes through the live target. The buffer's `_target` field still points at the same `HTMLElement` — `removeAttribute("style")` doesn't detach the target. Mitigation: confirm by inspection that `attach()` doesn't store a snapshot of `element.style.cssText`; it stores the element reference (per `materialize` in [StyleTarget.ts:89-95](../src/typescript/lib/core/StyleTarget.ts#L89-L95)).

- **Camelcase key conversion in `Util.ts`.** The current `cssText` strings use kebab-case property names with `:` separators. Mistranslating `display:inline-block` as `display: "inlineBlock"` (camelising the *value*) is a common foot-gun. Mitigation: only the **key** is camelCased; the value stays as the literal string. Manual review of each parsed pair before commit.

- **`setTouchAction` cascade dispatch.** Per the class-field super-cascade trap memory, the backing field must be `declare private _touchAction: string | null` (no initialiser, no `!`). A field initialiser would clobber the value the cascade-driven setter wrote during `super()` from `applyOptions`. Same trap shape as the recent `SortPriorityBadge` / `ResizeHandle` work documented in the migrated-plans folder.

---

## Critical Files

- [src/typescript/lib/core/StyleTarget.ts](../src/typescript/lib/core/StyleTarget.ts) — `InlineStyle`, `StyleTarget` API. The `attach` / `set` / `setMany` / `materialize` / `write` contract is the seam this plan threads everything through.
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — `_inlineStyle` field declaration (line 205), `setElementStyle` / `setElementStyles` methods (lines 548, 567), `setCursor` (line 1144), `setDisplayed` (line 815), `init()` materialisation (line 3180), `applyStyle` (lines 2613-2761).
- [src/typescript/lib/core/Animation.ts](../src/typescript/lib/core/Animation.ts) — `play()` (lines 90-136), the three `Object.assign` sites and the two `el.style.transition` writes.
- [src/typescript/lib/core/Util.ts](../src/typescript/lib/core/Util.ts) — the two `cssText` measurement probes (lines 78-96).
- [plans/migrate-rule-style-to-stylerule.md](migrate-rule-style-to-stylerule.md) — the sibling plan; verification gates and step structure follow the same template.
- [ARCHITECTURE.md](../ARCHITECTURE.md), section "CSS writes go through `StyleRule` / `InlineStyle`" — the binding rule this plan implements.

---

## Non-Goals

- **`CSSStyleRule.style.*` writes.** Covered by [migrate-rule-style-to-stylerule.md](migrate-rule-style-to-stylerule.md). Includes AccordionHeader, Glyph keyframes, DateTimePickerDropdown, ComboBox.
- **`element.addEventListener(...)` calls in `Animation.ts` and `VirtualScroller.ts`.** Listener-side concern; handled by the `migrate-listeners-to-event` plan.
- **`element.setAttribute(...)` calls in input-type initialisation.** Attribute-side concern; handled by the `migrate-setattribute-to-typed-setters` plan.
- **Promoting `setCursor` / `setDisplay` / `setPointerEvents` to fully optionable in subclasses that don't already opt in.** Those typed setters are already first-class on `Component`; this plan only ensures the bypass sites route through them, not the broader question of which subclasses should expose `cursor` etc. on their own options bags.
- **A general `Object.assign(target.style, …)` lint or eslint rule.** Out of scope; the grep checkpoint is the per-PR guard for now.
- **Refactoring `Animation.play`'s overall control flow.** The `requestAnimationFrame` double-pump, the `setTimeout` fallback, the reduced-motion synchronous branch — all stay. This plan only swaps the seam through which style writes pass.
