---
depends-on: [w3-0-bounding-sweep]
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/concepts/performance.md
  - ARCHITECTURE.md
  - packages/qa/README.md
  - packages/qa/src/panels/diagram-graph.ts
---

# Motion Transform Inline — Implementation Plan

## Overview

G28 `continuous-motion-pattern` is wave 3's second-largest measured lever. `Component.setTransform` writes the component's `#id` stylesheet rule ([`core/Component.ts:3552`](packages/lib/src/typescript/lib/core/Component.ts#L3552)). In WebKitGTK a stylesheet-rule mutation restyles the whole document, even when nothing else changed. W3.0's `g28.transform-inline` ablation wrote the same value to the element's inline style instead, with identical geometry: a `diagram-graph` pan frame went 53.5 → 17.2 ms and a `form-flat` toggle click 34.7 → 17.4 ms ([`96-w3-0-bounding-sweep.md`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L99)).

This plan ships that change in the library. `setTransform` and `clearTransform` write inline, the way `setTranslate` already does ([`core/Component.ts:5089`](packages/lib/src/typescript/lib/core/Component.ts#L5089)). The two setters then share one inline `transform` declaration, so the element's transform becomes one composed value: the translate first, then the `setTransform` value. `applyStyle`'s render-time replay writes that composed value ([`core/Component.ts:6980`](packages/lib/src/typescript/lib/core/Component.ts#L6980)). No public signature changes.

The change reaches every `setTransform` call the census below found on a motion path: the `DiagramView` pan and zoom, the `Toggle` thumb, and the `ComboBox` and `SplitButton` carets. It also writes down, in `ARCHITECTURE.md`, the rule the codebase already follows for choosing inline over the rule. Around the code change, the plan touches the docs, the changelog, two QA files and two test files.

---

## Architecture Decisions

### `setTransform` writes inline, following `setTranslate`

`setTransform` and `clearTransform` write through `setElementStyle("transform", …)` into the component's `InlineStyle` buffer, instead of `setElementCSSRule`. They keep the `_transform` cache field and `setTransform`'s same-value guard. The precedent is `setTranslate` itself, together with every other property the library changes during an interaction: geometry, `opacity`, `transition`, `willChange`, `zIndex`, `pointerEvents`. Each of these writes inline, caches its value in a field, and is replayed by `applyStyle`.[^precedent]

### One inline declaration, composed from the translate and the transform

Both setters now own the same inline `transform` declaration, so neither may overwrite the other. A new private `composeTransform()` builds the value from the three cached fields. A new private `writeTransform()` writes it. `setTranslate`, `setTransform` and `clearTransform` all call `writeTransform()`. This mirrors `writeHorizontalGeometry` ([`core/Component.ts:4776`](packages/lib/src/typescript/lib/core/Component.ts#L4776)), which derives one inline declaration from two cached fields and is called from every setter that changes either field.[^compose]

The translate comes first, then the transform. An empty or `null` transform contributes nothing:

| `_translateX`, `_translateY` | `_transform` | Inline `transform` written |
|---|---|---|
| 0, 0 | `null` | removed (`null`) |
| 3, 4 | `null` | `translate3d(3px,4px,0)` — byte-identical to today |
| 0, 0 | `rotate(180deg)` | `rotate(180deg)` |
| 3, 4 | `rotate(180deg)` | `translate3d(3px,4px,0) rotate(180deg)` |
| 2.6, 0 | `translate(10px, 20px) scale(1.5)` | `translate3d(3px,0px,0) translate(10px, 20px) scale(1.5)` |
| 3, 4 | `""` | `translate3d(3px,4px,0)` |

### `getTransform` keeps returning the authored value

`getTransform()` returns `_transform`, the value last passed to `setTransform`. It does not return the composed value. `getTranslateX()` / `getTranslateY()` already report the other half.[^getter]

### The render-time replay writes the composed value

`replayGeometryStyles` replays `composeTransform()` in place of today's translate-only replay. It skips the write when the composed value is `null`, the same shape as today's `(0, 0)` skip. That keeps a transform declared by a stylesheet rule applying: `.CollapseButton`'s centring and its per-instance rotation rule.[^replay]

### Nothing clears the value when motion ends or the theme changes

Every current caller's transform is state, not a gesture: a pan offset, a thumb position, a caret turned open or closed. It stays until the caller changes it or calls `clearTransform`. A theme change re-runs no `applyStyle`, and no transform value names a theme token, so a theme change needs no refresh either. The translate half keeps its own lifetime.[^lifetime]

### `transformOrigin` stays on the rule

`setTransformOrigin` is unchanged. Its only library caller sets it once, at construction, and an origin on the rule combines with a transform inline because they are separate properties.[^origin]

### The rule-vs-inline choice is written into `ARCHITECTURE.md`

A new subsection, *Motion properties write inline*, states the rule the codebase already follows. A property the library changes per frame or per event writes inline through a cached, replayed setter. A property that takes part in the class and state tiers stays on the rule, and changes per event by toggling a declared style state. A collapse toggle's three or four rule writes are named there as a known deviation. That follows `ARCHITECTURE.md`'s own precedent for `List.setSelectedIndex`.[^policy]

### The shipped change against the ablation

The ablation ([`packages/qa/src/harness/ablations.ts:2383`](packages/qa/src/harness/ablations.ts#L2383)) proved the saving with identical geometry. The shipped change differs from it wherever a runtime patch could skip what a library change cannot:

| Aspect | Ablation | Shipped change |
|---|---|---|
| Surface and value | `setElementStyle('transform', value)` | the same surface, with the same string when no translate is set |
| Same-value guard in `setTransform` | kept | kept |
| A translate on the same element | ignored: a transform write replaced it, and `clearTransform` wrote `null` over it | composed into one declaration |
| Re-render (`setId`, `sync`) | none: the inline value was lost to `applyStyle`'s wipe | replayed by `replayGeometryStyles` |
| Transforms set before the patch | moved from the rule at install | none to move: no transform ever reaches the rule |
| `clearTransform` with nothing set | wrote `null` | returns early |
| Bookkeeping | a `skipped.g28.transform-inline.ruleWrite` counter | none: the saving shows as `seam.sink.setRuleStyles` falling |
| New state | none | none: composes from the existing `_translateX`, `_translateY` and `_transform` |

The first two rows are where the geometry evidence carries over. The rest are the parts a shipped setter owes that the measured panels never exercised.[^ablation-gaps]

### What of G28 is in and what is out

The census below finds two kinds of rule write on motion paths: `setTransform`, and the three or four declarations a collapse toggle writes. W3.0's status pass (its audit of every wave-3 candidate, in `plans/implemented/w3-0-bounding-sweep.md`) also left three G28 items without a bound. Each is decided here:

| Item | Decision | Reason |
|---|---|---|
| `setTransform` on the rule (F27.1, F15.5, F02.2's transform half) | **in** | measured by W3.0 |
| The collapse toggle's rule writes (a pane's or region's `clip-path`, the `CollapseButton`'s rotation and width, a `Split` gutter's cursor) | out | three or four writes in one event; moving one leaves the toggle's restyle in place; unbounded[^collapse] |
| The drag ghost (F10.1) | out | already inline (`setX` / `setY`); no panel drives a ghost drag[^ghost] |
| The layer hints (F27.4, F20.1, F10.11, F15.3) | out | both bounded cells already land at the display's 16.7 ms refresh interval with no hint[^hints] |
| The event coalescing (F15.4, F27.1's per-raw-event half, F09.11) | out | every driver sends one move per frame, so it cannot be measured; it does not depend on the surface[^coalesce] |

### The `g28.transform-inline` ablation stays in the QA app

This plan does not retire the ablation, its test (A25) or its README entry. The README entry gains a note that the ablation must not be applied to a build carrying this change.[^ablation-stays]

### The offline test DOM is unchanged

`TestDOM`'s modelled geometry already folds an inline `transform`'s first `translate(…)` / `translate3d(…)` into an element's rectangle ([`packages/lib/tests/dom/TestDOM.ts:1561`](packages/lib/tests/dom/TestDOM.ts#L1561)). A translate-only value is unchanged by construction. Toggle, caret and chevron values do not match the parser and still read as no offset. `DiagramView`'s content host now reports its pan offset in the model, as `AbstractWindow`'s genie animation already does.[^testdom]

---

## Census

Every write on a continuous-motion or per-event path that reaches a stylesheet rule on the base commit. "Probe" counts are real rule mutations: the rule's `cssText` changed, measured offline in jsdom through the production sink.[^census-method]

| Path | Event | Property and surface today | Rule mutations per event | This plan |
|---|---|---|---|---|
| `DiagramView.applyTransformToHost` ([`component/diagram/DiagramView.ts:1003`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1003)) | every pan move, zoom notch, resize anchor, centring | `transform`, `#id` rule | 1 (probe) | in |
| `Toggle.applyValue` ([`component/input/Toggle.ts:385`](packages/lib/src/typescript/lib/component/input/Toggle.ts#L385)) | each flip | `transform`, `#id` rule | 1; the first flip also inserts the thumb's rule (probe) | in |
| `ComboBox.setCaretOpen` ([`component/input/ComboBox.ts:1001`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1001)) | each open and close | `transform`, `#id` rule | 1, the only one after the first open (probe) | in |
| `SplitButton._setChevronOpen` ([`component/button/SplitButton.ts:266`](packages/lib/src/typescript/lib/component/button/SplitButton.ts#L266)) | each open and close | `transform`, `#id` rule | 1 (probe) | in |
| Table header glyph ([`component/table/cell/Header.ts:368`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L368)), `Popover` arrow ([`overlay/Popover.ts:854`](packages/lib/src/typescript/lib/overlay/Popover.ts#L854)) | once, at creation | `transform`, `#id` rule | not per event | in (same setter) |
| `Split` collapse toggle | each collapse and expand | pane `clip-path`; `CollapseButton` rotation `transform` and `width` on its per-instance rule ([`component/container/CollapseButton.ts:219`](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L219)); gutter `cursor` | 4 (probe) | out |
| `Border` collapse toggle | each collapse and expand | region `clip-path`; `CollapseButton` `transform` and `width` | 3 (probe) | out |
| `Split` gutter drags in `shell-deep` (dock and sidebar) | every drag frame | layout-pass declarations | 0 of 12–21 seam calls: all same-value, skipped by the DOM seam's same-value filter (probe) | — |
| `Slider` thumb ([`component/input/Slider.ts:491`](packages/lib/src/typescript/lib/component/input/Slider.ts#L491)) | each value change and drag sample | `left` / `top` inline | 0 (probe, through `setValue`) | — |
| `DragGhost.moveTo`, `AbstractWindow` move, table `Header.setScrollX`, `Scrollbar` thumb, `TabBar`, `VirtualRowView` rows, `VirtualScroller`, `commitBounds`' fast path (a size-stable move written as a translate) | per move or scroll | inline: `left` / `top`, `setTranslate`, or a direct `translate3d` | 0 (code; W3.0's `wh` header drag reads 0 per move) | — |

---

## Public API

No signature changes. The contracts change as follows:

```typescript
class Component {
    /** Now writes the element's inline `transform`, composed after any setTranslate offset. */
    setTransform(value: string): this;
    /** Now writes inline; returns early when no transform is set. */
    clearTransform(): this;
    /** Unchanged: the value last passed to setTransform (not the composed value). */
    getTransform(): string | null;
    /** Unchanged surface; the value it writes now carries any setTransform value after the translate. */
    setTranslate(x: number, y: number): this;
}
```

`ComponentOptions.transform` still dispatches to `setTransform` ([`core/Component.ts:943`](packages/lib/src/typescript/lib/core/Component.ts#L943)). No new option, field or export.

---

## Internal Structure

Two private helpers, placed directly below `setTranslate`:

```typescript
/**
 * The element's inline `transform`: `setTranslate`'s rounded
 * `translate3d(x, y, 0)` first, then the `setTransform` value, or `null` when
 * neither is set. The translate goes first so the transform applies about the
 * element's own origin and the offset then moves the result unchanged.
 *
 * @returns The composed value, or `null`.
 */
private composeTransform(): string | null {
    const hasTranslate = this._translateX !== 0 || this._translateY !== 0;
    const translate    = hasTranslate ? "translate3d(" + Math.round(this._translateX) + "px," + Math.round(this._translateY) + "px,0)" : null;
    const transform    = this._transform || null;

    if (translate !== null && transform !== null) {
        return translate + " " + transform;
    }

    return translate ?? transform;
}

/**
 * Writes {@link composeTransform}'s value to the element's inline
 * `transform`. Called by every setter that changes the translate or the
 * transform.
 */
private writeTransform(): void {
    this.setElementStyle("transform", this.composeTransform());
}
```

The setters:

```typescript
setTransform(value: string): this {
    if (this._transform === value) {
        return this;
    }

    this._transform = value;
    this.writeTransform();

    return this;
}

clearTransform(): this {
    if (this._transform === null) {
        return this;
    }

    this._transform = null;
    this.writeTransform();

    return this;
}
```

In `setTranslate`, the two guards stay as they are. The `if (x === 0 && y === 0) … else …` write block becomes `this.writeTransform();`.

In `replayGeometryStyles`, the block after the four geometry replays becomes:

```typescript
// Replay the composed transform so a `setTranslate` offset and a
// `setTransform` value survive the inline-style wipe above, the same way
// width/top/left/height are replayed. Skipped when neither is set, so a
// transform a stylesheet rule declares (`.CollapseButton`'s centring, its
// per-instance rotation) still applies.
const transform = this.composeTransform();

if (transform !== null) {
    this._inlineStyle.set("transform", transform);
}
```

---

## Ordered Implementation Steps

Work test-first. **Never run `packages/qa/runqa.sh`, `packages/qa/sweeps/*.sh` in a running mode, MiniBrowser or the Tauri `qa-host`**: each opens a full-screen window on the user's desktop. The in-engine A/B under *Verification* belongs to the orchestrator.

1. **Create `packages/lib/tests/core/ComponentTransform.test.ts`**, modelled on `ComponentTransition.test.ts` (`installTestDOM(CONFIG)`, `afterEach(() => DOM.reset())`). Add two local helpers: `inlineTransformWrites(sink)`, returning every `style.transform` value (including `null`) recorded on an `apply` op, in order; and `ruleTransformWrites(sink)`, returning `ruleStyleWrites(sink).filter(r => r.key === 'transform')`. Write one `it` per case T1–T14 in *Expected Behaviour* (T15 is the existing diagram suite). Run `npx vitest run tests/core/ComponentTransform.test.ts` from `packages/lib`. Expect T1, T3–T7, T10, T11 and T14 to fail; the others pin behaviour that must not change.
2. **Update `packages/lib/tests/core/ComponentSetterGuards.test.ts`'s `Component.setTransform — same-value guard` block** ([line 130](packages/lib/tests/core/ComponentSetterGuards.test.ts#L130)). The first case asserts `inlineStyleKeys(sink)` holds no `transform` and `ruleStyleWrites(sink)` is empty. The second case asserts that the recorded inline values include `translateY(-2px)`, that no rule row has key `transform`, and that `getTransform()` is `translateY(-2px)`. The file's `inlineStyleKeys` gives the keys, so add a sibling helper for the values. Expect the second case to fail.
3. **`core/Component.ts`: add `composeTransform()` and `writeTransform()`** below `setTranslate` (line 5089), exactly as in *Internal Structure*.
4. **`core/Component.ts`: rewrite `setTransform` and `clearTransform`** (lines 3552 and 3569) as in *Internal Structure*. Replace their JSDoc:
   - `setTransform`: "Sets the CSS transform on the element's inline style. Use {@link clearTransform} to remove." Add a `@remarks`: the value is written inline, not to the component's stylesheet rule, because it can change per frame or per event (a pan, a toggle flip) and a stylesheet-rule write restyles the whole document in WebKitGTK while an inline write restyles only this element. The element's transform is {@link setTranslate}'s offset followed by this value. Inline style outranks every stylesheet rule, so a state rule cannot override it.
   - `clearTransform`: "Removes the value set by {@link setTransform}; a {@link setTranslate} offset stays."
5. **`core/Component.ts`: replace `getTransform`'s `@remarks`** (lines 3535–3539). The new text: it returns the value last passed to {@link setTransform}, not the element's whole inline transform, which also carries any {@link setTranslate} offset (read that through `getTranslateX` / `getTranslateY`).
6. **`core/Component.ts`: `setTranslate`** — replace the write block with `this.writeTransform();`. In its JSDoc, change "Writes the element's `transform` to translate3d(x, y, 0)" to say it writes the element's inline `transform` as `translate3d(x, y, 0)`, followed by any {@link setTransform} value.
7. **`core/Component.ts`: `replayGeometryStyles`** (line 6980) — replace the translate block and its comment (lines 6999–7005) with the block in *Internal Structure*.
8. **Check:** `grep -n 'setElementCSSRule("transform"' packages/lib/src/typescript/lib/core/Component.ts` finds nothing. From `packages/lib`: `npx vitest run tests/core/ComponentTransform.test.ts tests/core/ComponentSetterGuards.test.ts tests/component/diagram tests/component/button/SplitButton.test.ts tests/component/layout` passes. Then `npm test` (typecheck of the tests plus the whole suite) passes.
9. **`ARCHITECTURE.md`**: insert a `### Motion properties write inline` subsection at the end of *CSS writes go through `StyleRule` / `InlineStyle`*, after the paragraph ending "…that should own that write." (line 282). Text in *Documentation Impact*.
10. **`packages/lib/docs/concepts/performance.md`**: insert `## Motion writes the element's inline style` before `## Compositor-layer hints` (line 68). Text in *Documentation Impact*.
11. **`packages/lib/docs/reference/changelog/next.md`**: add the entry in *Documentation Impact* as the first bullet under `## Changed` → `### Core` (line 53).
12. **`packages/qa/src/panels/diagram-graph.ts`** (line 21): in `description`, replace `F27.1 (a pan move writes a stylesheet rule): 1 setRuleStyles per pan unit` with `F27.1 (fixed: a pan move wrote a stylesheet rule, 1 setRuleStyles per pan unit; it now writes the view's inline style, 1 apply)`.
13. **`packages/qa/README.md`**: two cell edits.
    - In the `diagram-graph` row's checks (line 330), replace `M17, F27.1: \`pan\` with \`seam=1\` gives \`seam.sink.setRuleStyles\` 1.00.` with `M17, F27.1 (fixed by \`motion-transform-inline\`): \`pan\` with \`seam=1\` gives \`seam.sink.setRuleStyles\` 0 and \`seam.sink.apply\` 1.00 — the pan's transform is an inline write; it was \`setRuleStyles\` 1.00 before the fix.` Leave the *Validated* cell to the orchestrator.
    - In the `g28.transform-inline` row of *Built-in ablations* (line 483), append: `Redundant once \`motion-transform-inline\` is in the build, and wrong there: it writes the raw value and drops a \`setTranslate\` offset, so apply it only to a build without that change.`
14. **Verify** as in *Verification*'s offline list. Then hand the in-engine A/B to the orchestrator.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Create | `packages/lib/tests/core/ComponentTransform.test.ts` |
| Modify | `packages/lib/tests/core/ComponentSetterGuards.test.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/concepts/performance.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/qa/src/panels/diagram-graph.ts` |
| Modify | `packages/qa/README.md` |

---

## Expected Behaviour

Unit-testable, in `ComponentTransform.test.ts` under the modelled DOM, on a `new Component({})` rendered with `getElement(true)` and the recorded writes then cleared, unless the case says otherwise. "Inline" means a `style.transform` on an `apply` op; "rule" means a `setRuleStyles` row with key `transform`.

| # | Case | Expected |
|---|---|---|
| T1 | `setTransform('rotate(180deg)')` | inline `rotate(180deg)`; no rule write; `getTransform()` is `rotate(180deg)` |
| T2 | T1, clear the writes, then `setTransform('rotate(180deg)')` again | no write of any kind |
| T3 | `setTranslate(3, 4)`, then `setTransform('rotate(180deg)')` | last inline value `translate3d(3px,4px,0) rotate(180deg)` |
| T4 | `setTransform('rotate(180deg)')`, then `setTranslate(3, 4)` | last inline value `translate3d(3px,4px,0) rotate(180deg)` |
| T5 | T4, then `setTranslate(0, 0)` | last inline value `rotate(180deg)`, not `null` |
| T6 | `setTranslate(3, 4)`, `setTransform('rotate(1deg)')`, `clearTransform()` | last inline value `translate3d(3px,4px,0)`; no rule write in the sequence; `getTransform()` is `null`; `getTranslateX()` is 3 |
| T7 | `setTransform('scale(2)')`, then `clearTransform()` | last inline value `null` |
| T8 | `clearTransform()` with no transform set | no write of any kind |
| T9 | `setTranslate(3, 4)` with no transform, then `setTranslate(0, 0)` | inline `translate3d(3px,4px,0)`, then `null`: byte-identical to today |
| T10 | `new Component({ transform: 'rotate(45deg)' })` with a fresh sink, then `getElement(true)` | after the recorded `removeAttr: ['style']`, an inline `rotate(45deg)`; no rule write |
| T11 | `setTranslate(2.6, 0)` and `setTransform('translate(10px, 20px) scale(1.5)')`, clear the writes, then `setId('g28-probe')` | after the recorded wipe, inline `translate3d(3px,0px,0) translate(10px, 20px) scale(1.5)` |
| T12 | `setTranslate(3, 4)`, then `setTransform('')` | last inline value `translate3d(3px,4px,0)`; `getTransform()` is `''` |
| T13 | `setTransform('rotate(1deg)')`, then `setTranslate(NaN, 4)` | no write after the first; `getTranslateX()` is 0 |

Integration, in the same file:

- **T14** — a mounted `Toggle`: `setValue(true)` records no rule write whose selector is the thumb's `#id`, and records an inline `translateX(16px)` on the thumb. Reach the thumb as `(toggle as any)._thumb`, as `SplitButton.test.ts` reaches `_chevron`.
- **T15** — a `DiagramView`'s existing suite (`tests/component/diagram/`) passes unchanged: its `_contentHost.getTransform()` assertions still read `translate(Xpx, Ypx) scale(Z)`.

Manual, in the engine only (the orchestrator's A/B under *Verification*): frame time, the rendered geometry of every labelled rectangle, and whether the toggle, caret and chevron still animate as before.

---

## Verification

**Offline, by the implementer:**

1. From the repository root: `npm run typecheck`, `npm run lint`, `npm test` (the whole library suite: T1–T15 and every existing test).[^prototype]
2. `npm run build:lib`, then `npm -w packages/qa run typecheck` and `npm -w packages/qa run test`. Ablation A25 still passes: it patches the prototype it tests.
3. `npm run docs:api`: no warning beyond the 14 on the base commit. Compare the warning list against a run on the base commit, not against zero.
4. `npm run docs:llms:check` passes.
5. `grep -rn 'setElementCSSRule("transform"' packages/lib/src` finds nothing. `grep -rn 'setTransform\|getTransform' packages/lib/docs` finds only the new performance section and the changelog.

**In the engine, by the orchestrator, with the user's go-ahead** (never by the implementer). This is a same-session A/B. The `wt` arm is the library built at the commit this plan's branch started from; the `main` arm is the branch with the fix. Every run carries `work=1&seam=1&geom=1`. Each cell is run base-a, fix-1, base-b, fix-2, base-c, so the base arm sits at both ends and a linear drift cancels. `ffk` and `dgp` are the W3.0 cells that bounded G28. `fnk` is `ffk`'s deep partner, `ffc` is a cell the fix reaches that W3.0 did not bound, and `sdh` guards the translate path in the deepest panel.[^deep]

```sh
# From the repository root.
BASE=$(git merge-base feature/motion-transform-inline feature/w3-0-results)   # the commit the plan's branch started from
git diff --stat "$BASE" feature/motion-transform-inline -- packages/lib/src     # expect core/Component.ts only; if more, set BASE to the commit the branch was cut from
git worktree add .worktrees/_g28-base "$BASE" --detach
ln -sfn "$PWD/node_modules" .worktrees/_g28-base/node_modules
(cd .worktrees/_g28-base/packages/lib && npm run build:lib)
export QA_WT_LIB="$PWD/.worktrees/_g28-base/packages/lib"

cd .worktrees/motion-transform-inline && npm run build:lib    # a checkout of the branch; the main arm is its packages/lib
F='work=1&seam=1&geom=1'
ab() {    # ab <cell> <params>: base-a fix-1 base-b fix-2 base-c; stops at the first failed run
    packages/qa/runqa.sh "g28v-$1-base-a" wt   "$2&$F" &&
    packages/qa/runqa.sh "g28v-$1-fix-1"  main "$2&$F" &&
    packages/qa/runqa.sh "g28v-$1-base-b" wt   "$2&$F" &&
    packages/qa/runqa.sh "g28v-$1-fix-2"  main "$2&$F" &&
    packages/qa/runqa.sh "g28v-$1-base-c" wt   "$2&$F"
}
ab ffk 'panel=form-flat&click=toggle&drive=click' &&
ab dgp 'panel=diagram-graph&drive=pan' &&
ab fnk 'panel=form-nested&click=toggle&drive=click' &&
ab ffc 'panel=form-flat&click=combo&drive=click' &&
ab sdh 'panel=shell-deep&drive=drag'

for c in ffk dgp fnk ffc sdh; do python3 packages/qa/bin/qa-table.py packages/qa/results "g28v-$c-" --seam; done
```

That is 25 runs, about 8 minutes. `qa-ab.py` cannot score these cells, because it expects every non-plain arm to be an `abl=` ablation. Read each cell from `qa-table.py` by the W3.0 rule instead:

- **bracket** is the largest base `avg` minus the smallest.
- **Δms** is the mean of the two fix `avg`s minus the mean of the three base `avg`s. It is a `win` below −bracket.
- **counter** is `seam.sink.setRuleStyles` per unit from the `--seam` line, 0 when absent.
- **geom** must read `=` on every row (`base` on base-a, the reference).

Expected readings. The absolute figures are W3.0's; a new session drifts 8–14%.[^expected]

| Cell | Base `avg` (W3.0 plain) | Fix `avg` (W3.0 arm) | `setRuleStyles` base → fix | `apply` | `sink/u` | geom |
|---|---|---|---|---|---|---|
| `ffk` | ≈ 34.7 (bracket ≈ 0.6) | ≈ 17.4: Δms ≈ −17, `win` | 0.50 → 0; `ensureStyleRule` 0.01 → 0 | 2.5 → 3.0 | 3.5, unchanged | `=` |
| `dgp` | ≈ 53.5 (bracket ≈ 1.4) | ≈ 17.2: Δms ≈ −36, `win` | 1.00 → 0 | 0 → 1.00 | 1.0, unchanged | `=` |
| `fnk` | not measured | a `win` expected | 0.50 → 0 | + 0.5 | unchanged | `=` |
| `ffc` | ≈ 64 | a `win` expected; size not bounded | 1.07 → ≈ 0.07 | + 1.0 | unchanged | `=` |
| `sdh` | ≈ 55.6 | `flat` (inside the bracket) | 6.01 → 6.01 | unchanged | 139.1, unchanged | `=` |

The change passes when all three gates hold:

1. **Geometry:** every fix run reads `=` in all five cells. A `DIFF` fails the change, whatever the timing.
2. **Work:** `setRuleStyles` falls exactly as in the table, and `apply` rises by the same amount. A rule write has become an inline write, not been dropped.
3. **Time:** `ffk` and `dgp` read `win`, of the order of the ablation's saving, with the fix arm near the display's 16.7 ms refresh interval — the lowest frame time the harness can record.

If gates 1 and 2 hold but gate 3 fails on `ffk` or `dgp`, the rule write is gone and the frame did not move, which contradicts the ablation. Stop and investigate before merging.

After the run, record the five cells' readings in this plan's implementation notes. Add the `dgp` and `ffk` readings to the *Validated* cells of the QA README's `diagram-graph` and `form-flat` rows, naming the run prefix `g28v-` and the commit, as W3.0 did for its baseline.

---

## Documentation Impact

- **API reference** (TypeDoc, from JSDoc): `Component.setTransform`, `clearTransform`, `getTransform` and `setTranslate`, as written in steps 4–6. The JSDoc links only public members.
- **`ARCHITECTURE.md`**, new subsection (step 9):

  > ### Motion properties write inline
  >
  > A typed setter writes the component's `#id` rule unless the library changes its property during an interaction. Those setters write inline through `setElementStyle`, cache the value in a field, and are replayed by `applyStyle`: geometry (`setX` / `setY` / `setWidth` / `setHeight`), `transform` (`setTranslate` and `setTransform`, composed into one declaration with the translate first), `opacity`, `transition`, `willChange`, `zIndex`, `pointerEvents`, `touchAction` and `writingMode`. The reason is cost. A stylesheet-rule write makes WebKitGTK restyle the whole document even when nothing else changed — one per `DiagramView` pan frame measured 53.5 ms against 17.2 ms inline — while an inline write restyles one element.
  >
  > A property that takes part in the class and state tiers (`StyleBag`) stays on the rule, because the tiers dedupe against it. When one of those must change per event, toggle a declared style state rather than rewriting the rule: a class token restyles only the element's subtree. `ToggleButton`'s `.selected` and `AccordionIndicator`'s `.expanded` do this. A new setter whose property changes per frame or per event writes inline from the start.
  >
  > **Known deviation:** a `Split` or `Border` collapse toggle still writes three or four rule declarations in one event — the pane's or region's `clip-path`, the `CollapseButton`'s rotation and width, and, for a `Split`, the gutter's cursor. They change together, so they are to move together, in their own change.

- **`packages/lib/docs/concepts/performance.md`**, new section (step 10):

  > ## Motion writes the element's inline style
  >
  > [`Component.setTranslate`](/api/core/classes/Component#settranslate) and [`Component.setTransform`](/api/core/classes/Component#settransform) write the element's inline `transform` — one value, the translate first — never a stylesheet rule, like `setX` / `setY`, [`setOpacity`](/api/core/classes/Component#setopacity) and [`setWillChange`](/api/core/classes/Component#setwillchange). Drive per-frame or per-event motion through them. A setter that writes the component's stylesheet rule instead, such as a colour, a border or a cursor, makes WebKitGTK restyle the whole document on every call, even when nothing else changed.

- **`packages/lib/docs/reference/changelog/next.md`**, `## Changed` → `### Core` (step 11):[^not-breaking]

  > - **`Component.setTransform()` writes the element's inline style, not the component's stylesheet rule, and composes with `setTranslate()`.** A stylesheet-rule write makes WebKitGTK restyle the whole document even when nothing else changes. Every transform the library changes per event paid that cost: a `DiagramView` pan or zoom frame, a `Toggle` flip, a `ComboBox` or `SplitButton` caret turning. The element's transform is now one inline value: `setTranslate()`'s `translate3d(x, y, 0)`, then the `setTransform()` value. So the two no longer mask each other; before, a translate hid the transform for as long as it was set. `getTransform()` still returns the value last passed to `setTransform()`. One consequence: a `transform` declared in a per-instance state rule (the `styleRules` option, for example `:hover`) no longer overrides a `setTransform()` value, because inline style outranks every rule. Set such a transform with `setTransform()` from the state's own event instead.

- **`packages/qa`**: the `diagram-graph` description and the README's M17 check and ablation row (steps 12–13).
- No page is renamed and no symbol removed, so no link sweep is needed.

---

## Potential Challenges

- **The seam counter counts calls, not mutations.** `seam.sink.setRuleStyles` also counts same-value calls that the seam then skips; a shell gutter drag makes 12–21 of them per frame and mutates nothing. Read the A/B's counter only as "this write left the rule". Where the transform was the only write, as in `ffk` and `dgp`, the call and the mutation are the same thing.
- **A consumer's state-rule `transform` no longer overrides `setTransform`.** No caller in the library, Loom, SQLAdmin or the docs site combines the two. The changelog states it.
- **The composed order matters.** `rotate(180deg) translate3d(3px,4px,0)` would rotate the offset and put the element at (−3, −4). T3 and T4 pin the order.
- **`applyStyle`'s wipe and replay around a running transition.** The wipe and the replay happen in the same task, so the computed transform never changes and a `Toggle` or caret transition does not restart. This is already true of the translate and the `transition` itself.
- **The engine may re-serialise a composed value.** Then the seam's same-value skip misses on a repeated identical write, and the write happens: the safe direction. The setters' own guards stop repeats before the seam anyway.
- **Modelled geometry now includes `DiagramView`'s pan.** If a diagram test fails on a rectangle, the model is now closer to the engine, which applies the pan. Update the expectation to include it; do not special-case the model.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `setTransform` / `clearTransform` / `getTransform` (3529–3574), `setTranslate` (5089), `writeHorizontalGeometry` (4776, the composition precedent), `setTransition`'s JSDoc (5552–5569, the inline-and-replay precedent), `replayGeometryStyles` (6980), `applyMiscInlineStyles`.
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts:588`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L588) — `commitBounds`, which calls `setTranslate` on every child it places.
- [`packages/lib/tests/core/ComponentTransition.test.ts`](packages/lib/tests/core/ComponentTransition.test.ts) — the test pattern to mirror.
- [`packages/lib/tests/core/ComponentSetterGuards.test.ts:130`](packages/lib/tests/core/ComponentSetterGuards.test.ts#L130) — the rule-reading assertions to move inline.
- [`packages/lib/tests/dom/TestDOM.ts:506`](packages/lib/tests/dom/TestDOM.ts#L506) and [`:1561`](packages/lib/tests/dom/TestDOM.ts#L1561) — how the modelled DOM reads an inline `transform`.
- [`packages/qa/src/harness/ablations.ts:2383`](packages/qa/src/harness/ablations.ts#L2383) — the ablation this change ships.
- [`packages/lib/src/typescript/lib/core/DOM.ts:351`](packages/lib/src/typescript/lib/core/DOM.ts#L351) — the seam's same-value skip and the cost model it records.
- [`plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md) — the measured result and the cells.

---

## Non-Goals

- **The collapse toggle's rule writes** — `clip-path`, `CollapseButton`'s rotation and width, a `Split` gutter's cursor: the known deviation named in `ARCHITECTURE.md`.[^collapse]
- **`setTransformOrigin` and the other set-once rule setters** (`setContain`, `setAnimation`, `setAppearance`, `setBorderImage`, `setColorScheme`, `setVerticalAlign`): written once, not per event.
- **The drag ghost, the layer hints and the event coalescing** — see *What of G28 is in and what is out*.
- **Retiring the `g28.transform-inline` ablation** from `packages/qa`.[^ablation-stays]
- **`Animation.play`'s inline `transform` writes**, which bypass the component's cache. No component that calls `setTransform` is also animated through `Animation.play`, so nothing here changes how they interact.
- **Modelling `scale` / `rotate` in `TestDOM`.**

---

## Notes

[^precedent]: `setTranslate`'s own JSDoc presents it as the compositor-friendly transform setter, and `ARCHITECTURE.md` never stated which surface a setter uses. The synthesis names that silence as G28's enabling defect (`99-synthesis.md`, X7). `setTransition`'s JSDoc gives the second half of the precedent: a value replayed inline by `applyStyle` must also be written inline at runtime, or the replay shadows it. Three other designs were considered and rejected. First, extend `setTranslate` to carry a scale, the synthesis's other option: it covers `DiagramView`'s translate-and-scale but not the `Toggle`, caret and chevron values, and it still leaves `setTransform` on the rule. Second, turn each two-state rotation into a declared style state toggled by class, `AccordionIndicator`'s pattern: that fixes `Toggle`, `ComboBox` and `SplitButton` but not `DiagramView`'s continuous pan, and it changes three components instead of one setter. Third, route by property name inside `setElementCSSRule`: that hides the surface choice from the typed setter that owns the write, against *Three non-negotiable rules for every DOM write*.

[^compose]: With both setters on one inline declaration, the last writer would otherwise win. `commitBounds` calls `setTranslate(0, 0)` on every child it places slowly. That is a write whenever the element does not exist yet, and a size-stable move writes a real translate through the fast path. Either would erase a rotation, and `clearTransform` would erase a live layout offset. Today the surfaces never clash in a steady state: no caller of `setTransform` is moved through the fast path, since `Absolute` keeps children at their own position and the header glyph and `Popover` arrow are placed directly. So composition changes no rendered output today. It prevents the clash the move would create, and fixes the latent case where a fast-path frame's translate hid a rotation. CSS applies the listed functions right to left about the origin, and a pure translation commutes with the origin shift. So `translate3d(…) rotate(…)` rotates the element about its own centre and then moves it, which is what both callers mean.

[^getter]: `DiagramView.test.ts` calls `getTransform()` 81 times, and `SplitButton.test.ts` reads the chevron's. Returning the composed value would leak `commitBounds`' transient layout offset into consumers' reads of their own value.

[^replay]: `applyStyle` removes the whole `style` attribute at every render (`init`, `setId`, `sync`) and replays each cached inline property. The ablation never met this, because no measured panel re-renders a component during a phase. Today's replay skips at `(0, 0)` so that a transform some rule declares is not overridden. The composed replay keeps that shape: it writes only when there is something of the component's own to write.

[^lifetime]: `commitBounds` and `AbstractWindow`'s drag end their motion with `setTranslate(0, 0)` and `setWillChange(null)`, as before; with composition that release now leaves a `setTransform` value in place instead of removing the whole declaration. Nothing serialises a transform: `LayoutSerialization` stores none. The only reader of a component's rule text is the diagnostics style-audit view (`styleRuleEntries`, [`core/StyleTarget.ts:372`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L372)), which will no longer list these transforms, correctly, since they no longer live on a rule.

[^origin]: `DiagramView`'s constructor sets `"0 0"` once. The origin on the `#id` rule and the transform inline combine, because each property resolves on its own. Moving the origin inline would add a replay entry for a write that costs nothing per event.

[^policy]: The inline set already exists and is consistent: `setX`, `setY`, `setWidth`, `setHeight`, `setTranslate`, `setOpacity`, `setTransition`, `setWillChange`, `setZIndex`, `setPointerEvents`, `setTouchAction`, `setWritingMode`, each replayed by `replayGeometryStyles` or `applyMiscInlineStyles`. Writing the rule down is what stops the next motion setter repeating `setTransform`'s mistake. A class-token toggle is an attribute write, which invalidates only the subtree it matches rather than the whole document, as `00-baseline.md` records in its attribute section. Naming the collapse writes as a known deviation, rather than leaving them unmentioned, follows how `ARCHITECTURE.md` records `List.setSelectedIndex`.

[^ablation-gaps]: An ablation runs against fixed panels for 150 units. It can ignore a re-render that never happens, a translate no measured component carried, and a clear nobody calls. Each gap is safe in the sweep and wrong in a library. The geometry evidence transfers because, for every value the panels wrote, the shipped change writes the same string to the same surface.

[^collapse]: The census probe counts four rule mutations per `Split` collapse and three per `Border` collapse, all in one event. A rule mutation dirties the whole document until the next style recalculation, so the event pays one full restyle for as long as any of the four remains. Moving one alone saves nothing measurable. No W3.0 arm bounded these writes. A collapse also re-lays out the panes, and G12 F06.9, planned on its own, works in the same code (`CollapseSupport`, `Split`, `Border`).

[^ghost]: `DragGhost.moveTo` already writes `left` / `top` inline, so it pays no document restyle. What F10.1 asks for is the other half of the motion pattern: a translate instead of `left` / `top`, a layer hint, and one move per frame. No QA panel drives a `DragManager` drag with a ghost, and the sweep excludes `grip=tab`. So nothing could measure it, and the campaign plans only what was bounded.

[^hints]: The ablation arm ran at 17.2 ms (`dgp`) and 17.4 ms (`ffk`), against the display's 16.7 ms interval, with no `will-change` anywhere. A hint could only show a saving on a frame above that floor, and none of the four hint items has such a cell. A hint also costs GPU memory, and the browser ignores hints past a page-wide threshold (`performance.md`, *Compositor-layer hints*). F20.1's misplaced header hint belongs to whichever plan next changes the table header.

[^coalesce]: The QA drivers send exactly one pointer move per animation frame, so coalescing moves per frame changes nothing they can measure; the W3.0 status pass leaves these items unbounded for this reason. After this change a raw `DiagramView` pan event costs one inline write and a residency check. Several inline writes within one frame still resolve in one style recalculation, so coalescing is independent of which surface the write uses. Measuring it needs a driver that sends several moves per frame.

[^ablation-stays]: `packages/qa/tests/sweep.test.ts` (W4) requires every `abl=` that `sweeps/w3-0.sh` names to be registered. The sweep names `g28.transform-inline` in batches `b12` and `b18`, and it is the re-runnable record of W3.0 against its own base. Retiring an ablation touches `ablations.ts`, its tests, the README and the sweep script. Every wave-3 plan would edit those same files in parallel, so the retirement is one QA change for the whole wave once it has landed. It is not repeated in each plan.

[^testdom]: The parser takes the first `translate(` or `translate3d(` with two `px` arguments. `translateX(16px)` and `rotate(…)` do not match it and read as no offset, exactly as a rule-side transform did. `AbstractWindow`'s genie animation already writes an inline `translate(…px, …px) scale(…)` that the model folds as its translate alone. A runtime prototype of this plan's change ran the whole library suite, and every diagram test passed.

[^census-method]: The census came from a throwaway jsdom test. It builds each component standalone, drives the event through the component's own API, and wraps `DOM.sink.setRuleStyles` to compare the rule's `cssText` before and after each call, so a same-value call the seam skips does not count. The shell drags were driven through `Split.onDragStart` / `onDrag` on a `shell-deep` built at `n=1`. Paths marked "code" were read, not probed; each writes through `setX` / `setY` or `setTranslate`. For the window move, W3.0's `b00` run `wh` confirms it in the engine: its second drag phase, 80 moves, records no `setRuleStyles` at all, so the first phase's 0.35 per unit came from its press, release and first-time rule inserts, not from the moves.

[^prototype]: A runtime prototype of this change, installed as a Vitest setup file that patches `Component.prototype`, ran the whole library suite: 8,035 passed and 1 failed. The failure was `ComponentSetterGuards`' `still writes a genuinely different transform`, which reads the rule and which step 2 rewrites. The QA suite passed, 338 of 338. A green suite is still not the gate for a style-write change (`97-wave2-measurement.md`: a wrong memo key once passed all 7,519 tests). The in-engine geometry gate is.

[^expected]: W3.0's `b12` and `b18` measured the ablation arm, not this build: `ffk` 34.66 → 17.40 (bracket 0.64) and `dgp` 53.54 → 17.23 (bracket 1.37). The ablation added one `apply` for each rule write it removed, so `sink/u` stayed at 3.5 and 1.0. Absolute frame times drift 8–14% between sessions (`00-baseline.md`), so only the in-cell Δms and the counters carry over. `ffc`'s residual ≈ 0.07 is the first open's rule inserts for the dropdown, which this change does not touch.

[^deep]: `97-wave2-measurement.md` requires geometry equality in a deep and a shallow panel for any write-path change, so `fnk` pairs with `ffk` as the nested partner (744 elements against 556). `diagram-graph` mounts only the nodes near the viewport, so a larger `n` does not deepen it, and it keeps its one W3.0 cell. `sdh` is S1's gesture on the deepest panel (2,484 elements). It exercises `commitBounds`' fast-path translate on every moved pane, the path whose output this plan must keep byte-identical.

[^not-breaking]: No signature changes, and no caller in the library, Loom, SQLAdmin or the docs site uses `setTransform` with a state rule declaring `transform`. The one observable difference, that inline outranks a state rule, is an edge case with no known user. So the entry goes under *Changed* with the consequence stated, not under *Breaking changes* with a migration note.

---

## Implementation Notes

**BASE_SHA:** `e2196b25413991458a2a5f2e5ad51938d50ba742` — the tip of `feature/chart-repaint-gate` ("Mark the chart repaint gate plan implemented"), which this branch starts from. That branch stacks `text-measurement-without-reflow` and `chart-repaint-gate`, both implemented and not yet merged to `master`. The *Verification* script's `git merge-base feature/motion-transform-inline feature/w3-0-results` would therefore name an older commit, and its own `git diff --stat` check would list those two plans' library changes as well as `core/Component.ts`; per the script's own fallback, the base arm is BASE_SHA.

**Offline verification, all passing.** (Figures from the run after audit round 3's fixes.) `npm run typecheck` and `npm run lint` clean; `npm test` 487 files, 8,115 passed, 2 todo; `npm run build:lib` clean; `npm -w packages/qa run typecheck` clean and `npm -w packages/qa run test` 17 files, 336 passed (the plan's 338 was the prototype's count on an older base); `npm run docs:api` 0 errors and the same 14 warnings as a run at BASE_SHA, compared line by line; `npm run docs:llms:check` OK. `grep -rn 'setElementCSSRule("transform"' packages/lib/src` finds nothing. `grep -rn 'setTransform\|getTransform' packages/lib/docs` (outside the generated `docs/api`) finds the new performance section, the new changelog entry, and one older changelog entry (`getClipPath`) saying `setTransform` caches its value, which is still true.

**Test-first record.** Before the `Component.ts` change, T1, T3–T7, T10, T11 and T14 failed and T2, T8, T9, T12 and T13 passed, exactly as step 1 predicted; step 2's second case failed and its first passed. Audit round 3's cases were written the same way: T17 and T18 failed before the keyword rule existed, and three mutations of it were each caught (dropping the rule; dropping the keyword with no translate as well; matching case-sensitively and untrimmed). A25's new case failed without the ablation's switch-off, and its first case failed without the rule-side setters put back.

**Test helpers beyond the plan's two.** `ComponentTransform.test.ts` also has `rendered()` (the plan's "rendered with `getElement(true)` and the writes then cleared"), `lastInlineTransform(sink)`, and `keepWritesAfterStyleWipe(sink)` for T10 and T11's "after the recorded wipe". `inlineTransformWrites` takes an optional handle, so T14 reads the thumb's own writes. `ComponentSetterGuards.test.ts` gains `inlineStyleValues(recorder, key)`, the sibling of `inlineStyleKeys` that step 2 asks for.

**Edits beyond the plan's list.** `replayGeometryStyles`' JSDoc summary said it replays "the translate transform"; it now says "the composed transform", since the plan's step 7 changed what it replays. Audit round 1 added two more. (1) `CollapseButton.applyRotation`'s comment said the rotation used `createStyleRule` rather than `setTransform` because a main-rule write made before render is dropped; with `setTransform` now inline and replayed, that reason is gone, so the comment now names the rotation as the known deviation `ARCHITECTURE.md` records. (2) The new `ARCHITECTURE.md` subsection named only the collapse toggle as a deviation, but the plan's census covered transform and collapse writes only, and at least two other per-event `StyleBag` rule writes exist: `DiagramView`'s pan cursor (`setCursor("grabbing")` on press, `"grab"` on release) and `ScrollArrowButton`'s hover background. The *Known deviations* paragraph now names both and says the list is not a complete census.

**Bucketing.** The `diagram-graph` panel `description` (step 12) rides in the code commit, as `chart-repaint-gate` did for its panel descriptions; the QA README cells ride in the documentation commit; `ARCHITECTURE.md` is its own tooling commit. Step 7 (a demo) does not apply: the change adds no API.

**Line drift.** The plan's line numbers for `changelog/next.md` (`## Changed` → `### Core`, now line 72) and the README's ablation row (now line 484) moved with the two stacked plans; the anchors themselves were unchanged.

**Audit round 3 — two BLOCKING findings, both decided by the user, both departures from the plan.** (1) *`none` and the CSS-wide keywords.* `composeTransform` dropped only the empty string, so `setTranslate(3, 4)` followed by `setTransform("none")` built `translate3d(3px,4px,0) none`, which CSS rejects as a whole, leaving the element on its previous transform; `inherit`, `initial`, `unset`, `revert` and `revert-layer` behaved the same way. The plan's composition table covered only `""`. The user's decision: matched case-insensitively and ignoring surrounding whitespace, such a keyword adds nothing while a translate is set, so the element carries the offset alone — what the screen showed before this branch, when the inline translate won over the rule — and with no translate it is written as given. That is the module-level `STANDALONE_TRANSFORM_KEYWORD` in `core/Component.ts`, a line in `setTransform`'s JSDoc, a sentence in the changelog entry, and cases T16–T20 in `ComponentTransform.test.ts` (T20 pins `revert-layer`, which the orchestrator's hand-verification of round 3 found missing from the first keyword list). (2) *The `g28.transform-inline` ablation switches itself off.* The plan decided the ablation keeps working and gains a README warning, and left `packages/qa/src/harness/ablations.ts` and its test out of the Files table. But this branch's own base, `chart-repaint-gate`, had already set the precedent in those same files (`libraryGatesChartRepaint` / `CHART_GATED_NOTE`), and harness test A2's convention is that an ablation whose target is absent notes it and patches nothing. The user's decision: follow that precedent. `libraryWritesTransformInline` now detects a library whose `Component` carries `writeTransform`, and the ablation returns `TRANSFORM_INLINE_NOTE` (`no rule-side transform: setTransform writes inline`) instead of wrapping the setters. A25 gains a third case for that, and its first two cases put the base library's rule-writing `setTransform` / `clearTransform` / `setTranslate` back on `Component.prototype` first (`installRuleSideTransform`), so both libraries are covered. The README's warning is replaced by what now happens, worded as the two chart rows are.

**Pending — in-engine A/B (the user runs this; not run here).** Every run opens a full-screen window, so it was left undone. From the repository root (`/home/jika/typescript/typescript-ui`):

```sh
BASE=e2196b25413991458a2a5f2e5ad51938d50ba742
git diff --stat "$BASE" feature/motion-transform-inline -- packages/lib/src   # expect core/Component.ts and component/container/CollapseButton.ts (a comment-only edit)
git worktree add .worktrees/_g28-base "$BASE" --detach
ln -sfn "$PWD/node_modules" .worktrees/_g28-base/node_modules
(cd .worktrees/_g28-base/packages/lib && npm run build:lib)
export QA_WT_LIB="$PWD/.worktrees/_g28-base/packages/lib"
cd .worktrees/motion-transform-inline && npm run build:lib
```

then, from that worktree, the `F=…`, `ab()` and five `ab …` lines of *Verification → In the engine*, then the `qa-table.py … --seam` loop, read against the three gates and the expected-readings table; finally `git worktree remove --force .worktrees/_g28-base` from the repository root. The five cells' readings go into these notes, and the `dgp` and `ffk` readings into the *Validated* cells of the QA README's `diagram-graph` and `form-flat` rows, naming the run prefix `g28v-` and the commit. The same session is the place for the plan's manual check under *Expected Behaviour*: that the `Toggle` thumb, the `ComboBox` caret and the `SplitButton` chevron still animate as before (`form-flat`'s toggle and combo, and the live demos on the docs site's `Toggle`, `ComboBox` and `SplitButton` pages under `npm run docs:dev`; the A/B commands do not cover it). Until then, the geometry gate (`=` on every fix run), the counter shift (`setRuleStyles` down, `apply` up by the same amount), the frame-time win and the animations are unverified; the offline tests pin only the sink-call census.
