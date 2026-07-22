---
depends-on: [per-class-component-defaults]
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
---

# Class-Scoped Style Rules — Implementation Plan

## Overview

Every `Component` owns a per-instance `#uuid` CSS rule on the framework's shared `<style id="Base">` sheet, and [`Component.applyStyle`](packages/lib/src/typescript/lib/core/Component.ts#L4336) writes roughly two dozen declarations into it on every render. For the classes that dominate a large table window, those declarations are byte-identical across every instance: 1,186 `Text` instances wrote 15 declaration keys with **zero** distinct values between them, and five cell classes did the same over 20 keys.[^measurement]

This plan moves the declarations that come from a class's defaults out of the per-instance rule and into a **class-scoped rule** — one `.ClassName` rule per concrete component class, created the first time an instance of that class renders. An instance whose value for a declaration matches the class rule's value skips the write entirely; an instance that deviates writes to `#uuid` as it does today, and wins on specificity. The inline geometry channel (`width` / `top` / `left` / `height` / `transform`) genuinely varies per instance and is untouched.

The work adds one internal module, `packages/lib/src/typescript/lib/core/ClassStyleRules.ts`, and changes the six `applyStyle` phase methods in [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) to route their rule writes through one new private helper. No exported symbol changes.

Release target: **library 0.3.0** (`packages/lib/package.json` currently reads `0.2.0`; this plan does not bump it).

This plan **depends on** [`plans/per-class-component-defaults.md`](per-class-component-defaults.md), which makes `Component._defaultOptions` a frozen bag shared by every instance of a class. That shared bag is what makes a class rule derivable: the rule's body is computed from it, so it is class-uniform by construction rather than by observation.

---

## Architecture Decisions

### The class rule is a module-level `StyleRule` with `scope: "class"`, keyed on the class constructor

`core/ClassStyleRules.ts` holds a `Map<Function, Entry>` from the concrete class constructor to its rule body, and creates the rule with `new StyleRule({ scope: "class", name, styles })` — the shipped pattern for a module-level shared class rule, used by [`SortPriorityBadge`](packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts#L34) and [`ResizeHandle`](packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts#L56), both of which already name their rule after their component class.[^precedent] The key is the constructor, not the class name, for the same reasons the defaults cache uses one.[^ctor-key]

### The rule's body is computed from the class defaults, never observed from an instance

`ensureClassStyleRule(ctor, defaults)` builds the rule body from the shared frozen defaults bag alone. It never reads an instance's `_options`, so the body cannot be skewed by whichever instance happened to render first.[^derive-not-observe]

### Only declarations that every instance writes on every render may be hoisted

A closed list of thirteen keys is hoistable. A key qualifies only when `applyStyle` writes it for **every** component on **every** render — otherwise the class rule could hold a declaration that an instance never counteracts, and the instance would silently inherit it.[^unconditional-rule]

| Hoisted key | Value in the class rule | Phase that writes it |
|---|---|---|
| `boxSizing` | `"border-box"` | `applyBoxAndVisibilityStyles` |
| `position` | `"absolute"` (`Position.ABSOLUTE`) | `applyBoxAndVisibilityStyles` |
| `visibility` | `defaults.visible === false ? "hidden" : "inherit"` | `applyBoxAndVisibilityStyles` |
| `display` | `defaults.displayed ? "block" : "none"` | `applyBoxAndVisibilityStyles` |
| `minWidth` / `minHeight` | `defaults.minSize.width + "px"` / `.height + "px"` | `applySizeConstraintStyles` |
| `maxWidth` / `maxHeight` | `"none"` when unbounded, else `+ "px"` | `applySizeConstraintStyles` |
| `overflowX` / `overflowY` | `defaults.overflow` | `applyOverflowStyles` |
| `whiteSpace` | `"nowrap"` | `applyMiscInlineStyles` |
| `userSelect` | `"none"` | `applyMiscInlineStyles` |
| `margin` | `"0px 0px 0px 0px"` | `applyMiscInlineStyles` |

Everything else `applyStyle` writes into the rule — `cursor`, `color`, `backgroundColor`, `backgroundImage`, `border`, `outline`, `borderRadius`, `boxShadow`, `padding` — is written behind an `if`, so it stays on `#uuid` unconditionally.

### The per-declaration decision is a value comparison, made in one helper

Each of the six phase methods stops calling `this._styleRule` directly and calls a new private `Component.writeRuleDeclaration(key, value)`. The helper drops the write when the class rule already carries that exact key/value pair, and otherwise writes to `#uuid` exactly as today.

| Class | `applyStyle` produces | Class rule holds | Result |
|---|---|---|---|
| `Text` (no options) | `overflowX: "hidden"` | `overflowX: "hidden"` | skipped — `.Text` serves it |
| `Text({ overflow: "auto" })` | `overflowX: "auto"` | `overflowX: "hidden"` | written to `#uuid` |
| `Text` after `setMinSize({width:180,height:0})` | `minWidth: "180px"` | `minWidth: "0px"` | written to `#uuid` |
| `Glyph("user")` sized per instance | `maxWidth: "16px"` | `maxWidth: "none"` | written to `#uuid` |
| any component | `margin: "0px 0px 0px 0px"` | same | skipped |

### `#uuid` outranks `.ClassName`, so a deviation and every runtime setter still win

An id selector scores (1,0,0,0) against a class selector's (0,0,1,0), so the per-instance rule wins every hoisted key it carries. Runtime setters are unchanged: `setOverflowY("auto")` after render still routes through `setElementCSSRule` into `this._styleRule`, and lands on `#uuid`. The framework writes no `!important` anywhere (`grep -rn '!important' packages/lib/src` is empty), so nothing disturbs that ordering.

### A class rule is never torn down

`ensureClassStyleRule` deliberately does **not** call `Component.trackSelector`. The two teardown paths — the eager `destructor()` at [Component.ts:789](packages/lib/src/typescript/lib/core/Component.ts#L789) and the GC finalizer at [Component.ts:296](packages/lib/src/typescript/lib/core/Component.ts#L296) — only dispose tracked, component-scoped selectors, so the last instance of a class dying leaves `.ClassName` on the sheet. A later instance of that class finds the registry entry already present and renders against the same rule.[^lifecycle]

### Two classes with the same name: the first to render claims the selector, the second opts out

`.ClassName` is derived from `ctor.name`, and two component classes in this tree share a name.[^duplicate-names] The registry keeps a second map from selector to owning constructor. A class that finds its selector already claimed by a *different* constructor is recorded with a `null` body and hoists nothing — every one of its declarations stays on `#uuid`, exactly as today. An anonymous class (empty `ctor.name`) takes the same opt-out branch.

---

## Public API

No exported symbol is added, removed, or changed. `core/ClassStyleRules.ts` is internal and **must not** be added to [`core/index.ts`](packages/lib/src/typescript/lib/core/index.ts).

Internal signatures the implementer writes:

```typescript
// core/ClassStyleRules.ts
export function ensureClassStyleRule(
    ctor:     Function,
    defaults: ClassStyleDefaults,
): Readonly<Record<string, string>> | null;
```

```typescript
// core/Component.ts — new private member and field
private writeRuleDeclaration(key: string, value: string | null): void;
private _classStyleBag: Readonly<Record<string, string>> | null = null;
```

`_classStyleBag` is a render-time cache, not consumer configuration, so per ARCHITECTURE.md it stays off the options bag. It is written only from `applyStyle`, which never runs during the `super()` cascade (it requires a rendered element), so a plain field initializer is correct and `declare` is not needed.

---

## Internal Structure

### `core/ClassStyleRules.ts`

The defaults are typed structurally rather than as `ComponentOptions`, so this module does not import from `core/Component.ts` and no import cycle appears.

```typescript
import { StyleRule } from "~/core/StyleTarget.js";
import { Position }  from "~/primitive/Position.js";
import { isUnbounded } from "~/primitive/Size.js";

/** The class-default fields a class rule's body is derived from. */
interface ClassStyleDefaults {
    visible?:   boolean | null;
    displayed?: boolean;
    minSize?:   { width: number; height: number } | null;
    maxSize?:   { width: number; height: number } | null;
    overflow?:  string | null;
}

type ClassStyleBag = Readonly<Record<string, string>>;

// Per-class rule bodies. A `null` body means the class opted out (its
// selector is owned by a different constructor, or it is anonymous).
const _bags: Map<Function, ClassStyleBag | null> = new Map();

// Selector owner, so a name shared by two classes is detected.
const _owners: Map<string, Function> = new Map();

function buildBag(defaults: ClassStyleDefaults): Record<string, string> {
    const bag: Record<string, string> = {
        boxSizing:  "border-box",
        position:   Position.ABSOLUTE,
        visibility: (defaults.visible ?? null) === false ? "hidden" : "inherit",
        display:    (defaults.displayed ?? true) ? "block" : "none",
        whiteSpace: "nowrap",
        userSelect: "none",
        margin:     "0px 0px 0px 0px",
    };

    const minSize = defaults.minSize ?? null;

    if (minSize) {
        bag.minWidth  = minSize.width  + "px";
        bag.minHeight = minSize.height + "px";
    }

    const maxSize = defaults.maxSize ?? null;

    if (maxSize) {
        bag.maxWidth  = isUnbounded(maxSize.width)  ? "none" : maxSize.width  + "px";
        bag.maxHeight = isUnbounded(maxSize.height) ? "none" : maxSize.height + "px";
    }

    const overflow = defaults.overflow ?? null;

    if (overflow !== null) {
        bag.overflowX = overflow;
        bag.overflowY = overflow;
    }

    return bag;
}

export function ensureClassStyleRule(
    ctor: Function,
    defaults: ClassStyleDefaults,
): ClassStyleBag | null {
    const existing = _bags.get(ctor);

    if (existing !== undefined) {
        return existing;
    }

    const name  = ctor.name;
    const owner = _owners.get(name);

    if (!name || (owner !== undefined && owner !== ctor)) {
        _bags.set(ctor, null);

        return null;
    }

    const bag = Object.freeze(buildBag(defaults));

    new StyleRule({ scope: "class", name, styles: bag });

    _owners.set(name, ctor);
    _bags.set(ctor, bag);

    return bag;
}
```

The `new StyleRule(...)` return value is intentionally unused: the constructor materialises the rule and flushes `styles` onto it, and nothing ever writes to the rule again. This mirrors the module-level shared class rules in `Glyph.ts` and `Markdown.ts`, which also discard the instance.

### `Component.writeRuleDeclaration`

```typescript
/**
 * Routes one `applyStyle` rule declaration to the rule that should carry it:
 * dropped when this component's class rule already declares the same
 * key/value, written to the per-component `#id` rule otherwise.
 */
private writeRuleDeclaration(key: string, value: string | null): void {
    if (this._classStyleBag !== null && this._classStyleBag[key] === value) {
        return;
    }

    this._styleRule.set(key, value);
}
```

`StyleTarget.set` queues while the rule is unmaterialised and writes through once it is, so this one call is correct whether `applyStyle` materialises the rule before the phases (today) or after them (once the batched-flush plan lands).

### `Component.applyStyle`'s new first line

```typescript
// Resolve this class's shared `.ClassName` rule before the phases run, so
// each phase can skip a declaration the class rule already carries.
this._classStyleBag = ensureClassStyleRule(this.constructor, this._defaultOptions);
```

`this.constructor` is the concrete class even through the `callable()` Proxy, and `ctor.name` is the same string [`init`](packages/lib/src/typescript/lib/core/Component.ts#L5354) already applies to the element as a CSS class — the two must stay identical or the rule never matches.

---

## Ordered Implementation Steps

Test-first: step 1 writes the failing tests, steps 2–4 make them pass.

1. **Write `packages/lib/tests/core/ClassStyleRules.test.ts`** covering every *unit* case in `## Expected Behaviour`. Copy the harness preamble (`DOM_CONFIG`, `installTestDOM`, `beforeEach` / `afterEach` with `DOM.reset()`) from [tests/component/Component.test.ts:1-20](packages/lib/tests/component/Component.test.ts#L1-L20). Two rules the file must follow, both explained in `## Expected Behaviour`: **every test declares its own uniquely-named local `Component` subclass**, and **measurements are taken on the second instance of a class**. Run the file; the hoisting cases must fail.

2. **Create `packages/lib/src/typescript/lib/core/ClassStyleRules.ts`** exactly as in `## Internal Structure`, with full JSDoc on the module, on `ClassStyleDefaults`, and on `ensureClassStyleRule`. Do **not** add it to `core/index.ts`. Check: `grep -n 'ClassStyleRules' packages/lib/src/typescript/lib/core/index.ts` → expect zero matches.

3. **`core/Component.ts` — add the import, the field, and the helper.** Add `import { ensureClassStyleRule } from "~/core/ClassStyleRules.js";` beside the existing `StyleTarget` import (line 18). Add `private _classStyleBag: Readonly<Record<string, string>> | null = null;` immediately after the `_styleRule` / `_inlineStyle` declarations (lines 405-406), with a comment saying it is the per-render cache of this class's shared `.ClassName` rule body. Add the `writeRuleDeclaration` method from `## Internal Structure` directly above `applyStyle` (line 4336).

4. **`core/Component.ts` — route the phases.** Insert the `ensureClassStyleRule` line from `## Internal Structure` as the first statement of `applyStyle`'s body (after the `DOM.sink.apply(element, { removeAttr: ["style"] })` call at line 4337). Then, **inside the six phase methods only** (`applyBoxAndVisibilityStyles` 4361, `replayGeometryStyles` 4414, `applySizeConstraintStyles` 4446, `applyOverflowStyles` 4469, `applyChromeStyles` 4490, `applyMiscInlineStyles` 4518), replace every single-property `this._styleRule.set(` — or `this._styleRule.queue(`, if the batched-flush plan has already landed — with `this.writeRuleDeclaration(`. Leave three things alone: every `this._inlineStyle.set(` call, the bulk `this._styleRule.setMany(borderToStyle(this._border))` at line 4492, and `materialiseDeferredRules`. Check: `grep -n '_styleRule\.\(set\|queue\)(' packages/lib/src/typescript/lib/core/Component.ts` → exactly one surviving match, inside `setElementCSSRule` (line 1450). The bulk forms (`setMany` at 4492, `queueMany` at 1432) do not match this pattern and are deliberately left in place.

5. **Run the new test file.** `cd packages/lib && npx vitest run tests/core/ClassStyleRules.test.ts` — all unit cases pass.

6. **Run the whole suite** and fix any assertion that counted a *render-time* write of a hoisted key. A survey of the current tests found none: the four `setRuleStyle` assertions in [tests/component/Component.test.ts:157-169](packages/lib/tests/component/Component.test.ts#L157) fire after `getElement(true)` from `setMinSize` / `setMaxSize`, and the `visibility` assertions in [tests/component/EffectiveVisibility.test.ts:198-244](packages/lib/tests/component/EffectiveVisibility.test.ts#L198) are before/after deltas around `setVisible` calls. If one does fail, the fix is to assert on the delta or on the class rule, never to widen the hoist list.

7. **Update the JSDoc** on `applyStyle` (line 4327-4334) and on `getCSSRule` (line 866): both currently imply a component's declarations live in one rule. Say instead that class-uniform declarations live on the shared `.ClassName` rule and `#id` carries the per-instance deviations. Per CODE_CONVENTIONS.md, describe the mechanism in prose — do not `{@link}` `ensureClassStyleRule` or `ClassStyleRules`, which are not in the rendered docs.

8. **Run the full verification list** in `## Verification`, including the manual browser checks.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Create | `packages/lib/tests/core/ClassStyleRules.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |

---

## Expected Behaviour

**Two constraints on how these cases are tested.** First, the registry and the `_ruleCache` in `core/StyleTarget.ts` are module state that survives `DOM.reset()`, so a class name reused across two tests emits its `ensureStyleRule` op only in the first — **every test declares its own uniquely-named local `Component` subclass**. Second, the recording sink's `setRuleStyle` op does not carry the rule's selector, so a render that also creates the class rule mixes both rules' writes together; **measure on the second instance of a class**, by which point the class rule exists and every recorded rule write belongs to that instance's `#id` rule. A local helper in the test file captures that window:

```typescript
/** Rule declarations written while `fn()` ran. Valid only once the class rule exists. */
function declarationsDuring(sink: RecordingDOMSink, fn: () => void): Record<string, string | null> {
    const start = sink.writes.length;
    fn();

    const out: Record<string, string | null> = {};

    for (const w of sink.writes.slice(start)) {
        if (w.op === 'setRuleStyle') {
            out[w.args[0] as string] = w.args[1] as string | null;
        }
    }

    return out;
}
```

| # | Case | Expected | How |
|---|---|---|---|
| 1 | **A default-valued declaration lands on the class rule.** Render one `Probe`, then measure a second `Probe`'s render. | The captured declarations contain **none** of `position`, `visibility`, `display`, `boxSizing`, `whiteSpace`, `userSelect`, `margin`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `overflowX`, `overflowY`. | unit |
| 2 | **The class rule is created once, with the right body.** As case 1. | `ensureStyleRule` is recorded for `.Probe` exactly **once** across both renders, and the `setRuleStyle` writes during the *first* render include `position` → `"absolute"` and `margin` → `"0px 0px 0px 0px"`. | unit |
| 3 | **An explicitly-set value lands on `#uuid`.** Render one `Probe`, then measure `new Probe({ overflow: 'auto' }).getElement(true)`. | The captured declarations contain `overflowX` → `"auto"` and `overflowY` → `"auto"`; they still contain no `position` and no `margin`. | unit |
| 4 | **A runtime setter after render writes `#uuid`.** Render two `Probe`s, then measure `b.setMinSize({ width: 180, height: 0 })`. | The captured declarations contain `minWidth` → `"180px"` and `minHeight` → `"0px"`. | unit |
| 5 | **A runtime setter that restores the default still writes `#uuid`.** After case 4, measure `b.setOverflowY('hidden')` on a `Probe` whose default overflow is already `hidden`. | The captured declarations contain `overflowY` → `"hidden"` — the helper only skips writes issued from `applyStyle`, never from a setter. | unit |
| 6 | **Two instances share one class rule.** Render three `Probe`s. | `ensureStyleRule` recorded for `.Probe` exactly once; the second and third renders each write no `position`. | unit |
| 7 | **A subclass gets its own rule carrying inherited defaults.** `class SubProbe extends Probe` passing `{ overflow: 'auto' }` as its `subclassDefaults`. Render two `SubProbe`s and two `Probe`s. | `ensureStyleRule` recorded for both `.Probe` and `.SubProbe`. The second `SubProbe` writes no `overflowX`/`overflowY` (its class rule holds `auto`) **and** no `position` (inherited from the base defaults). The second `Probe` also writes no `overflowX` — the two class rules are independent. | unit |
| 8 | **Destroying an instance leaves the class rule intact.** Render two `Probe`s, call `destructor()` on both. | No `deleteStyleRule` op is recorded for `.Probe`; `_ruleCacheHas('.Probe')` from `~/core/StyleTarget` is `true`. Both components' own `#id` selectors *are* deleted. | unit |
| 9 | **A new instance after that still renders styled.** After case 8, render a third `Probe` and measure it. | No new `ensureStyleRule` for `.Probe`; the captured declarations still contain no `position` — the surviving class rule serves it. | unit |
| 10 | **Two classes with the same name — the second opts out.** Two local classes both named `Twin`, each rendered twice. | `ensureStyleRule` recorded for `.Twin` exactly once. The second instance of the *claiming* class writes no `position`; the second instance of the *other* class writes `position` → `"absolute"` and every other hoistable key to its `#id` rule. | unit |
| 11 | **Conditional declarations are never hoisted.** Render two `Probe`s, the second with `{ cursor: 'pointer', backgroundColor: '#fff' }`. | The captured declarations contain `cursor` → `"pointer"`, `backgroundColor` → `"#fff"`, and `border` → `null` (written unconditionally by the else-branch of `applyChromeStyles`); none of these three keys is in the hoist table, so none can appear in the `.Probe` rule body. | unit |
| 12 | **No class rule for a component that never renders.** Construct a `Probe` without calling `getElement(true)`. | No `ensureStyleRule` op for `.Probe` is recorded — the rule is created at render time, per ARCHITECTURE.md's *Defer DOM work to render time*. | unit |
| 13 | **Real cascade resolution.** In the browser, a component with an explicit `overflow: auto` renders scrollable while its siblings do not. | `#uuid` beats `.ClassName`; no component picks up a sibling's deviation. | manual |
| 14 | **Visual parity.** The demo app renders identically before and after. | No change to sizing, visibility, overflow, or spacing anywhere — in particular for `ResizeHandle` and `SortPriorityBadge`, whose existing module class rules now share a `CSSStyleRule` object with the hoisted one. | manual |

---

## Verification

Run from `packages/lib` unless noted:

1. `npx vitest run --no-file-parallelism` — **`Tests N passed` is not sufficient**. The `Errors` line must read zero and the process exit code must be `0`.
2. `npm run typecheck` — exactly the **7** known pre-existing errors, no more.
3. `npm run typecheck:test`.
4. `npm run lint` — clean. `core/ClassStyleRules.ts` touches no raw DOM (it goes through `StyleRule`), so the `local/no-raw-dom` rule's empty baseline must hold.
5. `grep -n 'ClassStyleRules' packages/lib/src/typescript/lib/core/index.ts` — zero matches.
6. `grep -n '_styleRule\.\(set\|queue\)(' packages/lib/src/typescript/lib/core/Component.ts` — matches only inside `setElementCSSRule` and `setElementCSSRules`.
7. `grep -rn 'trackSelector' packages/lib/src/typescript/lib/core/ClassStyleRules.ts` — zero matches (a class rule must never be tracked for teardown).
8. `npm run docs:build` from the repo root — zero warnings (step 7 edits rendered JSDoc). The build needs several GB of heap; the script pins `NODE_OPTIONS`, but on a memory-starved machine it can be OOM-killed (exit 137) — free memory rather than raising the limit.
9. **Manual, browser** (`npm run dev`, http://localhost:8015). Confirm cases 13 and 14:
   - Open the wide-table demo, a `Tab` demo, and a `Button` demo. Everything must be positioned, sized, clipped, and hidden/shown exactly as before.
   - In DevTools, inspect `<style id="Base">` and confirm a `.Text` (or `.StringCell`) rule exists carrying `position`, `visibility`, `display`, `margin`, min/max and overflow, and that a `#uuid` rule for one of those components no longer repeats them.
   - Select a table header cell and confirm its `ResizeHandle` still sits at the right edge at full height, and that a multi-sorted column still shows its priority badge in the top-right corner. These two classes own pre-existing `.ResizeHandle` / `.SortPriorityBadge` rules that now share a `CSSStyleRule` with the hoisted body.
   - Switch a `Panel` demo with `autoScroll` on and confirm it still scrolls (its `overflow` deviation must reach `#uuid`).
   - Close and reopen a floating window and confirm the reopened one is styled — the class rules must have survived the first window's teardown.

---

## Documentation Impact

No exported symbol is added, removed, or renamed, so no doc page, catalog entry, or sidebar entry changes.

- Step 7 edits the JSDoc of `Component.applyStyle` (public) and `Component.getCSSRule` (protected, not rendered). Run `npm run docs:build` and confirm zero warnings.
- The split is worth one line in the 0.3.0 release notes: a component's CSS declarations are now spread across a shared `.ClassName` rule and its `#id` rule. A consumer stylesheet that targets a component by class (`.Button { … }`) now ties on specificity with the framework's own class rule, where before the framework's `#id` rule always won.
- [`ARCHITECTURE.md`](ARCHITECTURE.md)'s *CSS writes go through `StyleRule` / `InlineStyle`* section already lists "shared class rules" as a `StyleRule` target and needs no edit.

---

## Potential Challenges

- **This changes what CSS every component emits — the widest blast radius of the four sibling plans.** Every rendered component takes the new path. Mitigation: the hoist list is closed and small, the fallback for any mismatch is the current behaviour, and the manual browser pass in `## Verification` covers table, tab, button, panel-scroll, and window-reopen paths. Land it as its own commit so a bisect isolates it.
- **The offline harness cannot prove the cascade.** `RecordingDOMSink` records sink calls; it never resolves CSS. So the tests prove *which rule a declaration was written to*, not that `#uuid` actually beats `.ClassName` in a browser, and not that the rendered result is unchanged. Cases 13 and 14 are the substitute and must actually be performed.
- **The recording sink does not carry the rule selector.** `RecordingDOMSink.setRuleStyle` records only key and value ([tests/dom/TestDOM.ts:383](packages/lib/tests/dom/TestDOM.ts#L383)), which is why the tests measure the *second* instance of a class. If [`plans/stylerule-batched-flush.md`](stylerule-batched-flush.md) lands first, the recorded op becomes `setRuleStyles(selector, bag)` — then only the `declarationsDuring` helper in the new test file changes, to flatten `args[1]` and filter on `args[0]`. Nothing else in this plan depends on the op shape.
- **`ResizeHandle` and `SortPriorityBadge` already own a rule with the selector this plan generates.** Both go through the same `_ruleCache` in `core/StyleTarget.ts`, so the hoisted body and the existing body merge into one `CSSStyleRule`, last write per property winning. The only key they share with the hoist list is `position`, and both already set it to `absolute`, so the merge is a no-op today. A future module-level class rule named after a component class that sets one of the thirteen hoisted keys to a *different* value would silently fight the hoist. Mitigation: `grep -rn 'scope: *"class"' packages/lib/src` before adding one, and check the name against the hoist table above. `Glyph` and `Markdown` are not affected — their class rules use the `ts-ui-glyph-` / `ts-ui-md-` prefixes, so they never collide with `.Glyph` / `.Markdown`.
- **A consumer stylesheet targeting `.ComponentName` now ties with the framework's rule.** Source order decides, and the framework's `<style id="Base">` is injected at runtime, so it usually wins where it previously lost. This is a real consumer-visible change; it is recorded in `## Documentation Impact` for the release notes rather than mitigated.
- **`getCSSRule()` no longer returns a component's full effective style.** It returns the `#id` rule, which now holds only the deviations. It is `protected` and has no call site in the library (`grep -rn 'getCSSRule' packages/lib/src` finds only the definition), so nothing breaks; step 7's JSDoc edit is what keeps a future caller honest.
- **`setWhiteSpace("")` or `setUserSelect("")` would strand the class value.** Both phases guard on truthiness, so an empty string would skip the write and leave the class rule's `nowrap` / `none` in force. No call site passes an empty string today (`grep -rn 'setWhiteSpace(\|setUserSelect(' packages/lib/src`), and the setters are typed `string`. Mitigation: none needed; recorded so a future `clearWhiteSpace()` is added with a real reset value rather than an empty one.
- **A class rule for a class whose defaults vary per instance.** The four classes whose `subclassDefaults` depend on constructor arguments — `Panel` (`flush`), `Glyph` (`tag`), `SpinButton` (`glyph`), `AbstractMarkerList` (`itemStyle`) — vary in **no** hoisted key, so whichever variant renders first produces the same thirteen declarations. Any future instance-varying default that touched `minSize`, `maxSize`, `overflow`, `visible`, or `displayed` would make the class rule reflect one variant; the other variant's instances would simply write those keys to `#uuid`, so correctness holds and only the saving is lost.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) — `_styleRule` / `_inlineStyle` (405-406), `_defaultOptions` (452), `destructor` (726-800) and `trackSelector` (828), `getCSSRule` (866), `setElementCSSRule` / `commitCSSRule` (1447-1482), `setId`'s rule re-point (1505), `applyStyle` and its six phases (4336-4581), and `init`'s `addClass: [this.constructor.name]` (5354).
- [packages/lib/src/typescript/lib/core/StyleTarget.ts](packages/lib/src/typescript/lib/core/StyleTarget.ts) — `StyleTarget.set` (the queue-vs-write-through branch this plan relies on), `StyleRuleScope`, the `StyleRule` constructor's `materialize` handling, `_ruleCache` / `_ruleFor` / `disposeStyleRule`, and the `@internal` `_ruleCacheHas` the tests use.
- [packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts:29-48](packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts#L29) and [component/table/cell/ResizeHandle.ts:51-69](packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts#L51) — **the precedent**: a module-level `StyleRule` scoped to the component's own class name, holding the declarations that never vary per instance. Read both before writing `ClassStyleRules.ts`.
- [packages/lib/src/typescript/lib/component/display/Glyph.ts:60-98](packages/lib/src/typescript/lib/component/display/Glyph.ts#L60) and [component/display/Markdown.ts:53-120](packages/lib/src/typescript/lib/component/display/Markdown.ts#L53) — the prefixed class rules, confirming they do not collide with `.Glyph` / `.Markdown`.
- [plans/per-class-component-defaults.md](per-class-component-defaults.md) — the prerequisite. Its `core/ComponentDefaults.ts` is what makes `_defaultOptions` a shared frozen per-class bag, and its constructor-keyed `Map` is the pattern `ClassStyleRules.ts` copies.
- [packages/lib/tests/dom/TestDOM.ts:383-395](packages/lib/tests/dom/TestDOM.ts#L383) — `RecordingDOMSink`'s `setRuleStyle` / `ensureStyleRule` / `deleteStyleRule` recording shapes, which the new tests read.
- [packages/lib/tests/component/Component.test.ts:1-20](packages/lib/tests/component/Component.test.ts#L1) — the harness preamble to copy.

---

## Non-Goals

- **The inline geometry channel.** `width` / `top` / `left` / `height` / `transform` are written through `_inlineStyle` and genuinely vary per instance; the existing geometry-inline / appearance-rule split is correct and stays.
- **Hoisting the conditional declarations** (`cursor`, `color`, `backgroundColor`, `backgroundImage`, `border`, `outline`, `borderRadius`, `boxShadow`, `padding`). A class rule may only hold a key every instance writes on every render; these are all behind an `if`, and hoisting one would need a neutral reset value per property.
- **Batching the `StyleRule` flush** and **making `ensureStyleRule` O(1)**. Sibling plans own `core/StyleTarget.ts` and `core/DOM.ts`; this plan touches neither.
- **Making `_defaultOptions` per-class.** The prerequisite plan owns it.
- **A shared rule for declarations that are identical across *all* classes** (`margin`, `boxSizing`, `whiteSpace`, `userSelect`, `position`). A single framework-wide rule would collapse them further, but it needs a selector every component carries and none exists today; adding one is a separate change.
- **Removing the per-instance `#uuid` rule for components that deviate in nothing.** The rule is still allocated (and still carries the conditional keys); shrinking the rule count is not in scope.
- **Bumping the package version.** The 0.3.0 target is recorded here; the bump happens at release.

---

## Notes

[^measurement]: From a profiling run of a 45-column × 400-row table demo, instrumented to record how many *distinct values* each declaration key took across all instances of a class in one window open. `Text`: 1,186 instances, 15 keys, 0 keys with more than one distinct value, 17,790 writes. `StringCell`: 384 / 20 / 0 / 7,680. `StringRenderer`: 474 / 15 / 0 / 7,110. `NumberCell`, `DateCell`, `BooleanCell`: 352 / 20 / 0 / 7,040 each. `Glyph`: 364 / 16 / 4 varying (`minWidth`, `minHeight`, `maxWidth`, `maxHeight`) / 5,812. `Component`: 719 / 21 / 11 varying / 12,903. The whole window issued 113,016 `StyleTarget.set` calls. The inline geometry channel took 14,651 writes over 16 keys of which 10 varied — correctly per-instance. Every write into the shared `<style id="Base">` sheet invalidates style for the whole document, so the build's next forced read pays a full-document recalc over ~7,000 elements and ~7,000 rules. These are ratios from a timing-inflated environment; no wall-clock speedup is promised.

[^precedent]: Both files register their rule from an idempotent module-local `ensureXClassRule()` guarded by a module variable, exactly the shape ARCHITECTURE.md prescribes for a module-level shared class rule. This plan generalises that from two hand-written rules to one rule per component class, and keeps the same three properties: created once, module-scoped, never disposed. The alternative — giving each `Component` an extra per-instance `StyleRule` with a class selector — was rejected: it would allocate one buffer per component to write a body that is by definition identical, which is the cost the plan exists to remove.

[^ctor-key]: `ctor.name` is not unique in this tree, so a name-keyed registry would hand one class another's rule body. The constructor object is unique regardless of name, survives minification, and is the same key `core/ComponentDefaults.ts` uses in the prerequisite plan. `core/Callable.ts` forwards `[[Construct]]` through `Reflect.construct(target, args)`, so `instance.constructor` is the original class object for both `new Text(…)` and `Text(…)`. The *selector* still has to come from `ctor.name` — it must match the CSS class `init` applies — which is why the name collision is handled separately, by the opt-out branch.

[^derive-not-observe]: Deciding class-uniformity by observation — watch the values instances produce and hoist once they agree — was rejected. It is order-dependent in a way that affects correctness, not just savings: a rule seeded from an atypical first instance would hold a declaration that later instances must *remove* rather than override, and CSS has no per-property "unset back to absent" that reproduces the declaration never having been written. Deriving the body from the shared defaults bag sidesteps that entirely: the body is a pure function of state that is already class-scoped, and an instance that deviates only ever *adds* a higher-specificity declaration.

[^unconditional-rule]: The soundness argument for the thirteen keys, one branch at a time. `position` and `margin` are written unconditionally. `visibility` is written on both branches of its `if`. `display` is gated on `isDisplayed() != null`, and [`isDisplayed`](packages/lib/src/typescript/lib/core/Component.ts#L1758) returns a `boolean` sourced from `_options.displayed ?? _defaultOptions.displayed`, which the base defaults always populate. `boxSizing`, `whiteSpace`, and `userSelect` are gated on truthiness of private fields the constructor seeds to `"border-box"` / `"nowrap"` / `"none"`, and their setters are typed `string`. `minWidth` / `minHeight` and `maxWidth` / `maxHeight` are gated on `getMinSizeConstraint()` / `getMaxSizeConstraint()`, which read `_options.X ?? _defaultOptions.X` — so clearing the option re-resolves the always-present class default rather than yielding `null`. `overflowX` / `overflowY` are gated on non-null, and `getOverflowX` / `getOverflowY` fall back to `_defaultOptions.overflow`, which the base defaults set to `"hidden"`; `clearOverflowX()` nulls the private field and the default resolves again. Every other rule declaration in `applyStyle` is gated on a value that can legitimately be absent, which is why the list stops at thirteen.

[^lifecycle]: Three teardown paths could reach a rule, and none reaches a class rule. `Component.destructor` calls `this._styleRule.dispose()` and disposes each entry of `_deferredStyleRules` — both are per-instance `StyleRule` objects this plan never touches. The `FinalizationRegistry` at [Component.ts:296](packages/lib/src/typescript/lib/core/Component.ts#L296) calls `disposeStyleRule(selector)` for each entry of `_ownedSelectors`, which is populated only by the private `trackSelector`, called from the `#id` rule creation sites (484, 1506) and `createStyleRule` (914). `StyleRule.dispose()` is a method on the instance, and the only `StyleRule` bound to a class selector is the one `ensureClassStyleRule` constructs and immediately drops — no reference survives for anything to call `dispose()` on. So the rule outlives every instance, which is what makes case 9 in `## Expected Behaviour` pass: a new instance finds the registry entry, gets the same bag back, and skips the same declarations. Had the rule been torn down with the last instance, the next instance would still skip those declarations (the registry entry would be intact) and would render with none of them — an unstyled, statically-positioned component.

[^duplicate-names]: `grep -rhoP '^(export )?(abstract )?class \K\w+' over the library and `uniq -d` reports exactly two duplicated class names: `Body` and `Table`. Both `Body` declarations are `Component` subclasses — [core/Body.ts:21](packages/lib/src/typescript/lib/core/Body.ts#L21) (the page root) and [component/table/Body.ts:111](packages/lib/src/typescript/lib/component/table/Body.ts#L111) (the table's row host) — so they genuinely contend for `.Body`. `Table` is declared at `layout/Table.ts:40` (a `LayoutManager`, which owns no CSS class) and `component/table/Table.ts:74` (a `Component`), so only one of the two ever reaches `ensureClassStyleRule` and there is no contention. Note that the two `Body` classes already share the CSS class `Body` today — `init` applies `this.constructor.name` unconditionally — so the collision is pre-existing; this plan only has to avoid *acting* on it. Minification does not add a new failure mode for the same reason: the CSS class already comes from `constructor.name`, so the class rule inherits whatever guarantees `vite.config.ts`'s `keepNames` settings and `plans/minification-safe-class-names.md` provide, and the opt-out branch fails safe if two classes ever collapse onto one name.
