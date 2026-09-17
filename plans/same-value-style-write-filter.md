---
touches-shared: [packages/lib/src/typescript/lib/core/DOM.ts]
---

# Same-value style write filter — Implementation Plan

## Overview

The library writes a large number of style properties per frame whose value is already the value the declaration holds. A harness ablation that skips exactly those writes, measured in WebKitGTK against Loom's real shell, took a 2×2 editor-grid dock-gutter drag from **111.0 ms/frame to 70.6** — **−40.7 ms, −37%**, reproducing to 0.3 ms across repeats.[^ceiling] That 40.7 is a **ceiling**: what a filter saves if it costs nothing and reaches every write on the page. Even discounted it is the largest remaining single opportunity in this codebase.

This plan builds that filter into the library's one terminal style write, [`writeDeclaration`](packages/lib/src/typescript/lib/core/DOM.ts#L304) in [core/DOM.ts](packages/lib/src/typescript/lib/core/DOM.ts) — the DOM seam, the only module in the library that touches the real DOM — and adds the matching guard to the whole-rule-body write in [`ProductionDOMSink.setRuleStyles`](packages/lib/src/typescript/lib/core/DOM.ts#L1667). Both compare the incoming value against **the declaration they are about to mutate**, read live. Two functions change in one file; nothing above the seam is touched, and no public signature moves.

The traffic is mostly geometry. [`writeHorizontalGeometry`](packages/lib/src/typescript/lib/core/Component.ts#L4525) writes `left` *and* `width` whenever either changes, because [`roundedExtent`](packages/lib/src/typescript/lib/core/Component.ts#L354) derives the committed width from the left edge; [`writeVerticalGeometry`](packages/lib/src/typescript/lib/core/Component.ts#L4540) mirrors it for `top` and `height`. So a tree row that only resizes re-writes its unchanged `left`, and a pane that only grows re-writes its unchanged `top`. The per-frame counters line up one-for-one with that: the file-tree scenario records 75.6 same-value `left` writes beside 74.6 changed `width` writes, one pair per visible row.[^counters]

---

## Architecture Decisions

### The filter lives at the seam, in `writeDeclaration`

Every style write the library performs on a live element or a stylesheet rule — single inline property, batched inline patch, single rule property, merged rule body — funnels through `writeDeclaration`. Putting the comparison there covers all four in one place and leaves every layer above unchanged.[^seam-choice]

### The comparison reads the live declaration; there is no last-written cache

`writeDeclaration` compares against the target declaration's current value, fetched at write time. It keeps no memo of what it wrote before.[^no-cache]

This is what makes the filter safe against the three things that would otherwise have to be tracked by hand:

- **`applyStyle`'s inline wipe.** [`Component.applyStyle`](packages/lib/src/typescript/lib/core/Component.ts#L6603) opens with `DOM.sink.apply(element, { removeAttr: ["style"] })` and then replays the cached geometry. After the wipe the element's inline `top` reads `""`, so the replay writes for real. Nothing has to invalidate anything.
- **Shared `CSSStyleRule` objects.** Two `StyleRule` instances built for the same selector share one underlying rule through the module cache in [`_ruleFor`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L334). A per-instance cache would let one instance's writes make the other's cache wrong. Reading the rule's own body cannot go stale.
- **Writers that bypass `StyleTarget` entirely.** [`VirtualScroller`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L449) commits its clip box and its rows-container transform straight through `DOM.sink.apply`, as do `Markdown`, `AbstractChart`, `Tooltip`, `DragManager`, `PointerDrag` and `Theme`. A buffer-level filter would not see any of them.

### `setRuleStyles` guards its whole-body write as well

When a rule flush carries more than one property, [`setRuleStyles`](packages/lib/src/typescript/lib/core/DOM.ts#L1667) merges the bag on a detached scratch declaration and then assigns `rule.style.cssText` back in one go. That final assignment is a stylesheet mutation, and a stylesheet mutation forces a full-document restyle in WebKitGTK even when the text is unchanged. The function already reads `rule.style.cssText` to seed the scratch, so it compares the merged text against that same string and only assigns when the merge changed something.

### A same-value write at this seam has no side effect to swallow

This campaign has hit three callers that deliberately re-call a **setter** with an unchanged value and need the call to do something: `Card.componentRemoved` firing mid-`moveComponent`, a combo editor dropped on the return to normal mode, and [`TabBar`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2558) re-calling `setTextAlign` after flipping the writing mode. Every one of those effects — a layout schedule, a re-derived anchor, a cache repair, a child rebuild — happens inside the setter, above this seam, and has already run by the time a write arrives at `writeDeclaration`. Below the seam there is nothing left but the CSSOM value.[^no-side-effects]

[`Component.pinStateStyle`](packages/lib/src/typescript/lib/core/Component.ts#L6015) survives for a related reason. Its purpose is to put a declaration on the instance's own `#id<state>` rule so that rule outranks the class-tier rule *even when the two values coincide* — a **tier** comparison `pinStateStyle` must never make. The filter makes no tier comparison: it compares the rule's own body against the write aimed at that same body. If the declaration is already there, the rule already outranks the class tier and re-asserting it changes nothing.

### Reading an inline declaration is a CSSOM read, not a layout read

`style.top` returns the specified value stored in that element's own inline declaration. No style resolution and no layout is needed to answer it, unlike `getComputedStyle` or `getBoundingClientRect`.[^read-cost]

ARCHITECTURE.md's second non-negotiable rule for DOM writes — *"Always cache in memory. Reads return cached state, never re-query the DOM"* — governs component state: a getter must answer from a field, not from the document. It does not reach this read. `core/DOM.ts` **is** the DOM, the value read here feeds no getter and no component state, and the same function already reads `rule.style.cssText` before writing it. The plan states the distinction rather than assuming it, and adds one sentence to ARCHITECTURE.md saying so.

### G04's same-value filter lands here; the rest of G04 stays open

The render review's group G04 `style-write-dedup-at-the-seam` proposed a same-value filter on `StyleTarget`, aimed at stylesheet-rule writes and ranked first among the performance groups. Measured, that rule-write path is worth 1.3 ms on Loom's trees. This plan supersedes G04's filter at a seam that measures 40.7 ms instead, and it is the *only* part of G04 it supersedes.

| G04 item | Status after this plan |
|---|---|
| `StyleTarget` compares before it writes | **Superseded** — done at `writeDeclaration`, with wider coverage and no cache |
| The sink stops writing unchanged rule bodies | **Superseded** — the `setRuleStyles` `cssText` guard |
| Empty-bag guard in the shared `flush()` | **Open.** [`StyleTarget.flush`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L79) calls `flushDirty({})` for an empty bag, and `InlineStyle.flushDirty` turns that into `apply(handle, { style: {} })` — the review measured 200 such empty applies over a 201-component tree |
| `ProductionDOMSink.apply` empty-patch short-circuit | **Open** |
| `StyleTarget.setMany` batches instead of one `apply` per key | **Open** |
| `ElementAttributes` stops writing unchanged values | **Open** — [`ElementAttributes`](packages/lib/src/typescript/lib/core/ElementAttributes.ts) already retains a last-written map and does not consult it |
| `Aria.setRole` / `setTabIndex` route through the guarded private setter | **Open** |

What remains of G04 is JS-side call and allocation overhead, not engine restyle cost. It is a separate plan.

---

## Internal Structure

### `writeDeclaration`

Replaces the body at [DOM.ts:304-316](packages/lib/src/typescript/lib/core/DOM.ts#L304). The camelCase branch collapses, because assigning `""` is how that path already removes a property.

```typescript
function writeDeclaration(style: CSSStyleDeclaration, key: string, value: string | null): void {
    // `null` means "remove", which both paths express as the empty value —
    // and an absent property reads back as the empty value too, so one
    // comparison covers set-to-same and remove-what-is-not-there.
    const next = value ?? "";

    if (key.includes("-")) {
        if (style.getPropertyValue(key) === next) {
            return;
        }

        if (value === null) {
            style.removeProperty(key);
        } else {
            style.setProperty(key, value);
        }

        return;
    }

    const indexed = style as unknown as Record<string, string>;

    if (indexed[key] === next) {
        return;
    }

    indexed[key] = next;
}
```

Worked cases — the comparison is always against the declaration being written, never against a computed style or another tier:

| Declaration holds | Call | Native operation | Why |
|---|---|---|---|
| `top: 12px` | `("top", "12px")` | none | the value is already there |
| `top: 12px` | `("top", "13px")` | `style.top = "13px"` | changed |
| `top: 12px` | `("top", null)` | `style.top = ""` | a present property is removed |
| no `top` | `("top", null)` | none | already absent |
| `--gap: 4px` | `("--gap", "4px")` | none | hyphenated path, `getPropertyValue` matches |
| `--gap: 4px` | `("--gap", null)` | `removeProperty("--gap")` | present |
| `transform: translate3d(1px, 2px, 0px)` | `("transform", "translate3d(1px,2px,0)")` | `style.transform = …` | the engine's serialised form differs, so the write goes through |

The last row is the filter's only failure mode, and it fails the safe way: a value that does not match is written. A skip is possible only when the declaration already holds the exact string being written.

### `ProductionDOMSink.setRuleStyles`

Two changes to the body at [DOM.ts:1667-1694](packages/lib/src/typescript/lib/core/DOM.ts#L1667): capture the rule's text before seeding the scratch, and only assign it back when the merge changed it.

```typescript
    const before = rule.style.cssText;

    scratch.cssText = before;

    for (const key of keys) {
        writeDeclaration(scratch, key, styles[key]);
    }

    // The scratch merge is free — it is a detached element. Assigning the
    // result back is a stylesheet mutation, which forces a full-document
    // restyle in WebKitGTK whether or not the text changed.
    if (scratch.cssText !== before) {
        rule.style.cssText = scratch.cssText;
    }
```

| Rule body before | `styles` bag | What happens |
|---|---|---|
| empty | `{ top: "0px" }` | single-key path, `writeDeclaration` writes |
| `top: 0px` | `{ top: "0px" }` | single-key path, `writeDeclaration` skips — no sheet mutation |
| `left: 0px; top: 0px` | `{ top: "0px", left: "0px" }` | scratch merge unchanged — `cssText` not assigned |
| `left: 0px; top: 0px` | `{ top: "4px", left: "0px" }` | scratch merge changed — one `cssText` assignment |

---

## Ordered Implementation Steps

All paths are from the repository root.

1. **Record the pre-change commit.** `git rev-parse HEAD` — write the SHA down. *Verification* step 5 builds this exact commit into a detached worktree as the A/B control arm, and it must be the parent of this work.

2. **Edit `writeDeclaration`** in `packages/lib/src/typescript/lib/core/DOM.ts` ([:304](packages/lib/src/typescript/lib/core/DOM.ts#L304)) to the body in *Internal Structure*. Extend its doc comment with one sentence: a write whose value already matches the declaration is skipped. `npm run typecheck`.

3. **Edit `ProductionDOMSink.setRuleStyles`** in the same file ([:1667](packages/lib/src/typescript/lib/core/DOM.ts#L1667)) to the body in *Internal Structure*. Do not touch the single-key branch or the no-scratch (headless) branch — both already route through `writeDeclaration` and inherit the filter. Extend the `@inheritDoc`-adjacent comment to say the rule body is only assigned when the merge changed it. `npm run typecheck`.

4. **Confirm nothing else terminates a style write.** `grep -n 'element\.style\|rule\.style\|scratch\.cssText\|\.cssText = ' packages/lib/src/typescript/lib/core/DOM.ts` — expect exactly six hits, and no others: the `_applyProbeStyles` assignment (the off-screen measurement probe, deliberately out of scope), one prose mention inside a doc comment, `applyPatchTo`'s call to `writeDeclaration`, `setRuleStyles`' single-key call to `writeDeclaration`, its read of `rule.style.cssText` into the scratch, and its now-guarded assignment back. Any seventh hit is a write that bypasses the filter and must be routed through it.

5. **Confirm no `!important` write exists.** `grep -rn '!important' packages/lib/src/typescript/lib` — expect zero matches, and `grep -rn 'setProperty(' packages/lib/src/typescript/lib` — expect exactly one, inside `writeDeclaration`. The filter compares values only; a priority-carrying write would need the comparison extended (see *Potential Challenges*).

6. **Add the new test suite** `packages/lib/tests/dom/same-value-write-filter.test.ts`, covering behaviours 1-10, per *Verification* step 2.

7. **Run the offline checks** in *Verification* step 1.

8. **Update the docs** per *Documentation Impact*.

9. **Run the engine A/B and the counter runs** per *Verification* steps 5 and 6, then the manual checks in step 7.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Create | `packages/lib/tests/dom/same-value-write-filter.test.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Unit-testable — the new jsdom suite, driving `ProductionDOMSink` against a real `document`

1. Writing an inline camelCase property, then writing the identical value again, performs **one** native set. The declaration still reads that value afterwards.
2. Writing a different value after the first write performs a second native set, and the declaration reads the new value.
3. `null` for a property the declaration holds removes it (the declaration then reads `""`). `null` for a property the declaration does not hold performs **no** native set.
4. A custom property (`--gap`, which takes the hyphenated path) behaves the same way across all three cases: identical value skipped, changed value written, `null` on an absent property skipped.
5. A standard hyphenated key (`background-color`) behaves the same way as `--gap`.
6. After `apply(handle, { removeAttr: ["style"] })`, writing the value that was there before the wipe performs a native set and the declaration reads it back. No stale state survives the wipe.
7. Mutating an element's inline style outside the sink, then writing that same value through the sink, performs no native set; writing a different value performs one. The filter reads the live declaration, not a record of its own writes.
8. `setRuleStyles(rule, { top: "0px" })` on a rule already holding `top: 0px` performs no native set on the rule's declaration, and the rule still carries `top: 0px`. The same call on a rule holding `top: 4px` performs one set and leaves `top: 0px`.
9. `setRuleStyles(rule, { top: "0px", left: "0px" })` on a rule already holding both leaves `rule.style.cssText` unassigned. With one of the two changed, `rule.style.cssText` is assigned exactly once and the rule body carries both declarations.
10. Two `StyleRule` instances constructed over the same selector share one `CSSStyleRule`: a write through the first, then the identical write through the second, performs one native set, and the rule still carries the declaration.

Behaviour 10 is the case a per-instance last-written cache would get wrong, and behaviour 8 is the one that keeps `Component.pinStateStyle` correct — a rule that already carries the pinned declaration still carries it after the skipped write.

### Manual verification

Nothing in the modelled test harness reaches this code (see *Potential Challenges*), and CSS transitions and animations cannot be exercised offline. Each check below is a place where a wrongly-skipped write would show as a dead or stuck animation.

11. **Accordion**: a section still animates open and closed, and still settles at the right height.
12. **Split / Border collapse**: collapsing and restoring a pane still slides rather than snapping, and the gutter ends in the right place.
13. **Menu, Popover, Tooltip**: each still fades in and out, and a dismissed panel still detaches from the DOM (the fade's completion callback still runs).
14. **Checkbox, Toggle, RadioButton**: state changes still animate.
15. **ProgressSpinner and the `TabButton` busy indicator**: both still rotate / pulse continuously.
16. **TabBar**: the selected-tab indicator still slides between tabs; a `SplitGutter` still fades on hover.
17. **Drags**: the 2×2 dock gutter and the explorer gutter both still track the pointer, with panes and tree rows landing at the right geometry — this is the path with the most skipped writes.
18. **DragManager**: the document cursor still changes for the duration of a drag and is restored afterwards.

---

## Verification

1. `npm run typecheck`, `npm test`, `npm run lint`, `npm run test:lint`, `npm run docs:api` (zero warnings), `npm run docs:llms:check`.

2. **New suite** `packages/lib/tests/dom/same-value-write-filter.test.ts`, covering behaviours 1-10. Take the `// @vitest-environment jsdom` pragma and the `afterEach` teardown shape from [tests/dom/style-rule-index.test.ts:1-41](packages/lib/tests/dom/style-rule-index.test.ts#L1) — that suite already drives a real `ProductionDOMSink` against a real `document` and a real `<style id="Base">` sheet.

   Counting native sets needs a wrapper over the accessor, because the camelCase path is a property assignment rather than a method call. Walk the prototype chain from a live `element.style` to find the object that owns the accessor — under jsdom it is `CSSStyleProperties.prototype`, not `CSSStyleDeclaration.prototype`, so a hard-coded prototype will silently find nothing:

   ```typescript
   function countSets(sample: CSSStyleDeclaration, key: string): { count: () => number; restore: () => void } {
       let host: object | null = sample;

       while (host && !Object.getOwnPropertyDescriptor(host, key)) {
           host = Object.getPrototypeOf(host) as object | null;
       }

       const desc = Object.getOwnPropertyDescriptor(host!, key)!;
       const set  = desc.set!;
       let   n    = 0;

       Object.defineProperty(host!, key, {
           ...desc,
           set(this: CSSStyleDeclaration, value: string) { n += 1; set.call(this, value); },
       });

       return { count: () => n, restore: () => Object.defineProperty(host!, key, desc) };
   }
   ```

   Restore in `afterEach`. For the hyphenated and custom-property cases, `vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')` and `'removeProperty'` are enough — both methods do live on that prototype under jsdom, so no walking is needed there. Use widely-implemented longhands (`top`, `left`, `width`, `height`, `backgroundColor`); jsdom drops properties its CSS parser does not know, which would make a test pass for the wrong reason.

3. **Confirm the existing suites do not move.** `npm test` must be green with **no expectation edits**. The recording sink used by every offline test implements `DOMSink` directly and never calls `applyPatchTo` or `writeDeclaration`, so the filter is invisible to it. A test that *does* change is a sign the edit reached further than intended.

4. **Grep invariants** from steps 4 and 5 of *Ordered Implementation Steps*.

5. **Engine A/B — same session, interleaved.** Harness absolutes do not survive a session: the same bytes measured 8-14% differently a day apart, which produced two false regressions before it was caught. Comparing today's number against any figure recorded in `plans/research/render-review-2026-09-15/` is invalid. The only valid comparison builds both arms and interleaves them in one sweep.[^ab-recipe]

   ```
   git worktree add .worktrees/_prefilter <sha from step 1> --detach
   ln -sfn <repo>/node_modules                   .worktrees/_prefilter/node_modules
   ln -sfn <repo>/packages/lib/node_modules      .worktrees/_prefilter/packages/lib/node_modules
   (cd .worktrees/_prefilter/packages/lib && npm run build:lib)
   (cd <repo>/packages/lib && npm run build:lib)

   cp <harness>/vite.config.qa.ts <loom>/vite.config.ts     # never commit this
   export QA_WT_LIB=<repo>/.worktrees/_prefilter/packages/lib

   S1="mode=filetree&tabs=4&grid=2x2&gutter=dock-h&count=1"
   S3="mode=filetree&tabs=1&gutter=explorer&count=1"

   runqa.sh svf-s1-post-r1 main "$S1" ; runqa.sh svf-s1-pre-r1 wt "$S1"
   runqa.sh svf-s3-post-r1 main "$S3" ; runqa.sh svf-s3-pre-r1 wt "$S3"
   runqa.sh svf-s1-post-r2 main "$S1" ; runqa.sh svf-s1-pre-r2 wt "$S1"
   runqa.sh svf-s3-post-r2 main "$S3" ; runqa.sh svf-s3-pre-r2 wt "$S3"

   python3 qa-table.py svf- --writes
   cd <loom> && git checkout -- vite.config.ts
   ln -sfn <repo>/packages/lib <loom>/node_modules/@jimka/typescript-ui
   ```

   `runqa.sh` leaves Loom's symlink pointing at whichever arm ran last, so the final `ln -sfn` is not optional.

   **Reading the result.** S1 is the signal: budget **30-37 ms/frame faster**, treat **≥ 25 ms** as success and **< 15 ms** as a reason to check the counters before anything else.[^forecast] Idle should also fall by 1-2 ms on S1, which it did in the ablation (12.2 / 11.0 → 10.1 / 10.6); if it does not move at all, suspect the harness resolved a stale bundle. S3's two arms were noisy in the ablation and stayed inconclusive — run it, report it, and do not treat a flat or slightly negative S3 as a failure on its own.

6. **Counter runs — prove the writes actually stopped.** Same scenarios with `count=1&deepwrites=1` appended, one run per scenario per arm. The deep counters hook the camelCase accessors (865 of them in WebKitGTK) and bump `prop@<key>.same` using the identical `get() === value` comparison the filter makes, so they name exactly the writes the filter should now skip.

   | Counter | S1 before | S1 after | S3 before | S3 after |
   |---|---:|---:|---:|---:|
   | `inline.prop.same` | 69.5 | small residual | 98.8 | small residual |
   | `prop@top.same` | 35.7 | ≈ 0 | 6.0 | ≈ 0 |
   | `prop@left.same` | 8.0 | ≈ 0 | 75.6 | ≈ 0 |
   | `prop@width.same` | 10.0 | ≈ 0 | 8.5 | ≈ 0 |
   | `prop@height.same` | 10.0 | ≈ 0 | 7.0 | ≈ 0 |
   | `rule.prop.same` | 6.0 | 0 | not recorded | 0 or absent |
   | `inline.prop.changed` | 42.6 | unchanged | 83.1 | unchanged |

   The `.changed` counters must not move: a drop there means a real write was skipped. The residual in `inline.prop.same` is the share of same-value traffic the library does not own — CodeMirror's own per-frame writes — and measuring it is what converts the 40.7 ms ceiling into a number. Record it.

   `deepwrites=1` wraps several hundred accessors and shifts every frame timing, so never read a millisecond figure from a `deepwrites` run, and never mix one into the step-5 sweep.

7. **Manual checks 11-18**, in `npm run dev`.

---

## Documentation Impact

- **`ARCHITECTURE.md`**, *Minimize direct DOM access*, in the paragraph describing the DOM seams. Add one sentence: the seam's terminal style write compares the incoming value against the declaration it is about to change and skips a write that would not change it; that comparison is not a state read, and rule 2's "reads return cached state, never re-query the DOM" continues to govern component getters only.
- **`packages/lib/docs/reference/changelog/next.md`** — a *Changed → Core* entry. The seam now skips an inline-style or stylesheet-rule write whose value already matches the declaration, and skips the whole-rule-body assignment when a batched rule flush changes nothing. State the consumer-facing consequence plainly: none, because the resulting declaration is identical either way; the change is engine work, not behaviour. Match the surrounding entries' bold-lead-sentence style.
- **No migration note.** No signature changes and no observable end state changes, so `packages/lib/docs/reference/migration/next.md` is untouched.
- **`packages/lib/llms.txt`** needs no change: no class is added, removed or renamed.

---

## Potential Challenges

- **No existing test covers this code.** The offline recording sink never reaches `writeDeclaration`, so `npm test` passing says nothing about the filter, and no existing suite would catch a regression in it. The new jsdom suite is the only automated cover; do not trim it.
- **`!important` is compared away.** `getPropertyValue` and the camelCase getter both return the value without its priority, so a write of the same value against an `!important` declaration would be skipped and the priority would survive. The library writes no priorities today (step 5 checks this), but a future write that passes a priority to `setProperty` must extend the comparison to `getPropertyPriority`. Put that in the function's doc comment.
- **Serialisation round-trips cost a miss, never a wrong skip.** An engine that re-serialises a value (`translate3d(1px,2px,0)` → `translate3d(1px, 2px, 0px)`) makes the comparison fail and the write happen. S1 records 4.0 same-value `transform` writes per frame, so at least some transform strings do round-trip in WebKitGTK; jsdom does not re-serialise at all. Never write a test that depends on either behaviour.
- **jsdom drops properties it does not implement.** A test using an exotic property would see no write in both arms and pass vacuously. Stick to the longhands named in *Verification* step 2.
- **A consumer-authored inline `style` attribute on an element the library adopts** (`Body` interns `document.body`) could carry a value the library later writes identically; the filter then leaves the author's declaration in place instead of replacing it with its own byte-identical one. The computed result is the same. Worth knowing, not worth guarding.
- **The forecast is a range, not a number.** The ablation reaches writes the library does not own. If the A/B lands well below 25 ms, read the step-6 counters *before* concluding anything about the change — a stale bundle and an unreachable write population look identical in the timing column alone.

---

## Critical Files

| File | Why |
|---|---|
| [packages/lib/src/typescript/lib/core/DOM.ts:298-316](packages/lib/src/typescript/lib/core/DOM.ts#L298) | `writeDeclaration` — the function this plan changes, and its doc comment explaining the hyphenated / camelCase split. |
| [packages/lib/src/typescript/lib/core/DOM.ts:335-400](packages/lib/src/typescript/lib/core/DOM.ts#L335) | `applyPatchTo` — the inline-style caller, and the fixed order in which a patch is applied. |
| [packages/lib/src/typescript/lib/core/DOM.ts:1666-1694](packages/lib/src/typescript/lib/core/DOM.ts#L1666) | `ProductionDOMSink.setRuleStyles` — the scratch-merge path, and the read-before-write this plan mirrors. |
| [packages/lib/src/typescript/lib/core/StyleTarget.ts:24-120](packages/lib/src/typescript/lib/core/StyleTarget.ts#L24) | `StyleTarget` — the buffer G04 proposed filtering, and the `flush()` empty-bag path this plan leaves open. |
| [packages/lib/src/typescript/lib/core/StyleTarget.ts:334-400](packages/lib/src/typescript/lib/core/StyleTarget.ts#L334) | `StyleRule` and the module `_ruleCache` — two instances over one selector share a `CSSStyleRule`, which is why a per-instance cache was rejected. |
| [packages/lib/src/typescript/lib/core/Component.ts:6603-6696](packages/lib/src/typescript/lib/core/Component.ts#L6603) | `applyStyle` — the `removeAttr: ["style"]` wipe and the geometry replay that follows it. |
| [packages/lib/src/typescript/lib/core/Component.ts:4525-4552](packages/lib/src/typescript/lib/core/Component.ts#L4525) | `writeHorizontalGeometry` / `writeVerticalGeometry` — the pair that produces most of the same-value traffic. |
| [packages/lib/src/typescript/lib/core/Component.ts:6008-6036](packages/lib/src/typescript/lib/core/Component.ts#L6008) | `pinStateStyle` — the write that must never be deduped against a lower tier, and why comparing a rule against its own body is not that comparison. |
| [packages/lib/src/typescript/lib/component/container/VirtualScroller.ts:440-505](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L440) | Style writes that bypass `StyleTarget` entirely, plus `setShadowEdge` — a same-value skip the codebase already does at a call site. |
| [packages/lib/src/typescript/lib/core/Animation.ts:106-228](packages/lib/src/typescript/lib/core/Animation.ts#L106) | `Animation.play` — the `from` / `to` transition driver, and the unconditional fallback timer that makes a transition that never starts safe. |
| [packages/lib/src/typescript/lib/layout/CollapseSupport.ts:132-175](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L132) | `primeCollapse` — installs a transition and relies on the next pass writing a *changed* geometry, which the filter does not touch. |
| [packages/lib/tests/dom/style-rule-index.test.ts:1-41](packages/lib/tests/dom/style-rule-index.test.ts#L1) | The jsdom-pragma production-seam suite the new tests copy. |
| [plans/implemented/component-setter-guards.md](plans/implemented/component-setter-guards.md) | Wave 1's nineteen setter guards — the compare-then-return shape this plan mirrors one layer down, and the record of what a setter-level guard can and cannot be safely given. |
| [plans/research/render-review-2026-09-15/00-baseline.md](plans/research/render-review-2026-09-15/00-baseline.md) | The A/B recipe, the cross-session drift correction, and the instrumentation-defect banner. |
| [ARCHITECTURE.md](ARCHITECTURE.md) *Minimize direct DOM access* / *Three non-negotiable rules for every DOM write* | The seam rule this change sits inside, and rule 2's caching requirement the decision section distinguishes from. |

---

## Non-Goals

- **Everything else in G04** — the empty-bag `flush()` guard, the empty-patch short-circuit in `ProductionDOMSink.apply`, `StyleTarget.setMany` batching, the `ElementAttributes` same-value filter, and the `Aria.setRole` / `setTabIndex` routing. All are JS-side call and allocation overhead rather than restyle cost, most live in files this plan does not open, and each needs its own measurement. See the G04 table in *Architecture Decisions*.
- **A last-written-value cache anywhere.** Rejected on correctness, not cost; the reasoning is in *Architecture Decisions* and its footnote, and re-proposing it needs to answer the three drift cases named there.
- **Splitting `writeHorizontalGeometry` / `writeVerticalGeometry`.** A component that only resizes does not need its unchanged `left` (or `top`) re-derived at all, so the redundant call could be removed at the source as well as filtered at the seam. But `roundedExtent` makes the committed extent depend on the origin, so the split has to reason about which of the two changed — a change to a rounding rule that every layout manager depends on, and worth its own plan once the filter's numbers are in.
- **`_applyProbeStyles`** ([DOM.ts:19](packages/lib/src/typescript/lib/core/DOM.ts#L19)), the off-screen text-measurement probe. It writes a fixed style set onto a detached probe element and does not participate in per-frame commits.
- **Writes the library does not own.** CodeMirror writes its own cursor and selection layers directly; nothing at this seam can reach them.
- **New counters, flags or diagnostics in production code.** The harness already measures this; the library gains no instrumentation.

---

## Addendum: reading the 40.7 ms

**What was measured.** The harness ablation `abl=nosamewrites` walks the prototype chain from a live `element.style`, finds every camelCase CSS accessor (865 in WebKitGTK — they are not on `CSSStyleDeclaration.prototype` there), and replaces each setter with one that reads the current value and returns early when it matches. Run against Loom's real shell in MiniBrowser, full-screen, software-rendered:

| Scenario | base | `nosamewrites` | delta |
|---|---:|---:|---:|
| S1 — 2×2 editor grid, 4 editors, 2387 elements, dock-h gutter drag | 111.02 / 111.07 | **70.58 / 70.32** | **−40.7 ms/frame (−37%)** |
| S3 — file tree, 1 editor, 992 elements, explorer gutter drag | 85.02 / 72.78 | 89.75 / 68.71 | inconclusive, both arms noisy |

S1's repeats agree to 0.05 and 0.26 ms, so its delta is solid. S1's idle also fell, 12.24 / 11.00 → 10.14 / 10.61.

**Why the ceiling is not the forecast, and why it is closer than it looks.** The ablation's replacement setter calls the original getter and compares before deciding — the same work `writeDeclaration` will do. So the comparison cost is already inside the 40.7 ms, and the ablation pays *more* than the real filter will: it adds a property-descriptor wrapper on every style write in the page, where the filter adds nothing but two lines inside a function that already runs.

What the ablation gets that the filter cannot is coverage. It intercepts every style write in the document, including CodeMirror's. On S1, of 69.5 same-value inline property writes per frame, roughly 8 carry key names and counts that track the editor count rather than the component tree (`right` 4.0 and `minHeight` 3.8, with four editors mounted) — about 10-15% of the same-value population, unreachable from inside the library.

Pulling in the other direction, the filter guards one write the ablation leaves alone: the whole-rule-body `cssText` assignment in `setRuleStyles`, which the ablation's accessor hooks do not cover and which is a full-document restyle each time.

Net: **budget 30-37 ms on S1.** *Verification* step 6 settles the split for real — the residual `inline.prop.same` after the change is, by definition, the part the library does not own.

**Why the older write counts in the research directory cannot be used.** Until 2026-09-17 the harness hooked only `setProperty`, `removeProperty` and `cssText`. `writeDeclaration` routes a key containing `-` through `setProperty` but every other key through direct property assignment, and the library writes camelCase throughout — so essentially every single-property style write was invisible to the counters, and the `norules` ablation did not suppress them either. `00-baseline.md` carries the correction banner in full. Its statement that S1 "writes nothing but 12 same-value attributes" describes what the harness could see, not what the library does.

---

## Notes

[^ceiling]: Full figures, provenance and the forecast arithmetic are in *Addendum: reading the 40.7 ms*. The ablation is `abl=nosamewrites`, added to the harness on 2026-09-17; raw results are `qa-results/ceil-s1-{base,nosame}-r{1,2}-*.json` and `ceil-s3-*`.

[^counters]: From a `count=1&deepwrites=1` run on each scenario. S1 per drag frame: 69.5 same-value inline property writes and 42.6 changed, led by `top` 35.7, `height` 10.0, `width` 10.0, `left` 8.0, `transform` 4.0, `right` 4.0, `minHeight` 3.8, plus 6.0 same-value rule property writes. S3 per drag frame: 98.8 same-value and 83.1 changed, led by `left` 75.6, `width` 8.5, `height` 7.0, `top` 6.0. The S3 pairing is the clearest attribution in the set: 75.6 same-value `left` beside 74.6 changed `width`, which is one visible tree row each — `setWidth` calling `writeHorizontalGeometry`, which writes both properties because `roundedExtent(origin, extent)` is `round(origin + extent) − round(origin)` and so depends on the origin. S1's 35.7 same-value `top` beside 28.6 changed `height` is the same mechanism on the vertical axis.

[^seam-choice]: The alternative seam was `StyleTarget` / `InlineStyle` / `StyleRule`, which is what the render review's cross-cutting defect X1 proposed. It was rejected on coverage as well as correctness: a filter there sees only writes routed through a component's own style buffers, and a survey of `DOM.sink.apply` call sites carrying a `style` patch found seven modules that bypass those buffers entirely — `VirtualScroller` (clip box, rows-container transform, scroll-shadow overlay), `Markdown`, `AbstractChart`, `Tooltip`, `DragManager`, `PointerDrag` and `Theme`. `VirtualScroller` alone is a per-scroll and per-layout hot path. A hybrid — cache in the buffer *and* filter at the seam — would add the cache's drift exposure back for the sake of skipping a `Map` lookup and one small object allocation, which is not where the 40 ms is. The codebase already has the right two-layer split without it: semantic dedup at the typed setter, where skipping the call also skips its side effects (wave 1's nineteen guards), and mechanical dedup at the seam, where there are no side effects left to skip.

[^no-cache]: Three concrete drift cases, each of which a cache would have to handle by hand and the live read handles by construction. (1) `Component.applyStyle` wipes the whole inline declaration with `removeAttr: ["style"]` on every render pass and then replays the cached geometry; a cache not cleared at that point would skip the entire replay and leave the element unpositioned. (2) `StyleTarget.ts`'s module-level `_ruleCache` hands two `StyleRule` instances built for the same selector the *same* `CSSStyleRule`, so a per-instance cache is wrong the moment both write — and `Component.createStyleRule` plus the class-tier rule builders can produce exactly that pairing. (3) Seven modules write element styles through `DOM.sink.apply` without going through any `StyleTarget` at all, so a buffer-level cache would be blind to what those writes left in the declaration. The cost of avoiding all three is one CSSOM property read per write.

[^no-side-effects]: This is the structural difference between this plan and wave 1's `component-setter-guards`, and it is why the audit that plan needed — every caller that re-calls a setter with an unchanged value on purpose — does not have to be repeated here. A setter guard skips the whole method: its assignment, its cache updates, its attribute writes, its `scheduleLayout()`. Getting that wrong is silent, which is how `TabBar`'s writing-mode-then-text-align sequence nearly lost vertical tab justification with no test failing. `writeDeclaration` is the last statement on a write's path; by the time control reaches it every effect above has already run, and the only thing a skip can change is whether the CSSOM is assigned a value it already holds. A caller cannot depend on that assignment, because no observable in CSS distinguishes a declaration that was assigned twice from one assigned once — transitions and animations key off changes in computed value, which is why `CollapseSupport.primeCollapse` is unaffected: it installs a transition and the *next* layout pass writes a genuinely different geometry, which the filter lets through. `Animation.play` is safe for a second reason as well — it arms `setTimeout(finish, durationMs + fallback)` unconditionally, so a transition that never starts still completes and still detaches its panel.

[^read-cost]: The claim rests on what the two kinds of read are. `getComputedStyle(el).top` and `getBoundingClientRect()` ask for a *resolved* value, which obliges the engine to bring style and layout up to date first — that is what makes them forced reads. `el.style.top` asks the element's own inline declaration for a *specified* value it already stores, so no resolution is involved. The harness's forced-read detector reflects the same distinction: it hooks `getBoundingClientRect`, `scrollTop` and `getComputedStyle`, not inline property reads. There is also direct evidence in the target engine: the `nosamewrites` ablation performs exactly this read on **every** style write in the page, across 865 wrapped accessors, and S1 came out 37% *faster*. If the read forced layout, that arm would have been catastrophically slower rather than the fastest measurement the campaign has produced. Finally, `DOM.ts` already treats the read as ordinary — `getInlineStyle` ([DOM.ts:2629](packages/lib/src/typescript/lib/core/DOM.ts#L2629)) exposes it on the read seam and `DragManager` calls it mid-drag.

[^ab-recipe]: The recipe is `00-baseline.md`'s *The only valid comparison: same-session A/B*. Its correction banner records why: on 2026-09-17 the exact pre-wave-0 build was rebuilt and re-run and came back 8.0% (S1) and 14.2% (S3) slower than its own numbers from the night before — same bytes, same scenarios, same harness. The machine varies between sessions by more than most effects this campaign measures, and comparing against a recorded absolute produced two false regressions before it was caught. `runqa.sh`'s `main` / `wt` switch exists for this, and is how the scroll-strip fix was validated at 220 → 107 ms/frame.

[^forecast]: The arithmetic is in *Addendum: reading the 40.7 ms*. In short: the 40.7 already includes the cost of the comparison, because the ablation performs the same getter read the filter will; it excludes the rule-body `cssText` guard, which the filter adds; and it includes same-value writes made by CodeMirror rather than the library, which the filter cannot reach and which look like roughly 10-15% of S1's same-value population.
