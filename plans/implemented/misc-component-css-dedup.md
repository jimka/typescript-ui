# Misc Component CSS Dedup — Implementation Plan

## Overview

The live Style Audit panel ([`packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts`](packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts)) flags `#id`-scoped CSS rules whose body every instance of a class writes identically — a value that belongs on a shared rule instead of on each instance's own. A capture named six candidates. Four survive verification against the current source and are fixed here:

- [`Spacer`](packages/lib/src/typescript/lib/component/container/Spacer.ts#L91) writes `background-color: transparent` on every instance.
- [`CollapseButton.setStripMode`](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L236) rewrites `width: 10px` — the value its own shared `.CollapseButton` rule already declares.
- [`ProgressSpinner`](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L80) builds its inner arc as a bare `Component` and paints `border-radius` and `border` on it per instance.
- [`ParentHeaderCell`](packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts#L133) writes a fixed two-part `box-shadow` and a `transparent` background on every instance.

The other two candidates are dropped — `MenuBarButton` already dedupes and the proposed change to it would break two things, and `SplitGutter` needs a mechanism this plan does not introduce. Both are recorded in `## Non-Goals` with the evidence.

This plan is the same recipe [`class-tier-default-hoists-batch.md`](plans/implemented/class-tier-default-hoists-batch.md) ran against a previous capture: small, independent, individually revertable hoists bundled into one plan because no step touches a file another step touches.[^bundle] Every claim below was checked against the current source, and the before/after CSS in `## Architecture Decisions` was read off a throwaway probe run against the real `RecordingDOMSink` harness on `master`.

---

## Architecture Decisions

### Each class uses the mechanism its own situation already calls for

Three mechanisms exist in this codebase for getting a construction-time-uniform value off an instance's own rule. This plan picks between them per class and introduces none of its own.

| Class | Mechanism | Precedent | Why this one |
|---|---|---|---|
| `Spacer` | Flat `_defaultOptions`, via a `subclassDefaults` argument on `super()` | [`HiddenFileInput`](packages/lib/src/typescript/lib/component/input/FileField.ts#L44) | No subclasses, and no ancestor declares `ownClassStyleDefaults`, so the flat route is both sufficient and the smaller diff[^spacer-flat] |
| `CollapseButton` | Neither tier — write `null` instead of the repeated value | [`Component.clearShadow`](packages/lib/src/typescript/lib/core/Component.ts#L2839) | Its shared rule is a hand-registered `StyleRule`, invisible to both class tiers[^collapse-hand-rule] |
| `ProgressSpinnerArc` (new) | Dedicated private subclass with `ownClassStyleDefaults` | [`TabBusyIndicator`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L75) | A single-purpose internal subcomponent with fixed chrome is exactly what that class is |
| `ParentHeaderCell` | `ownClassStyleDefaults` | [`Cell`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L55) | Its chain already participates through `Cell`, so the hierarchy-aware path is already the one running |

### A first `ownClassStyleDefaults` can lose a flat-bag sibling — checked, not assumed

A class's **first** `ownClassStyleDefaults` declaration makes `ensureClassStyleRule` take the hierarchy-aware path, which stops consulting the flat `_defaultOptions` bag for that class's rule ([`ClassStyleRules.ts:928`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L928)). Any sibling field that lived only in the flat bag then vanishes from the class rule. Two of this plan's four items add an `ownClassStyleDefaults` field, so both were checked:

| Class | Chain already participating? | Flat bag it would stop consulting | Verdict |
|---|---|---|---|
| `ParentHeaderCell` | Yes — `Cell` declares one | `_defaultCellOptions` only; `ParentHeaderCell` forwards no `subclassDefaults` of its own (`DefaultCell`'s constructor has no such parameter) | Safe — `Cell.ownClassStyleDefaults` already **is** `_defaultCellOptions`, so nothing is lost |
| `ProgressSpinnerArc` | New class, no history | The same constant it forwards to `super()` | Safe — one constant feeds both tiers, mirroring `TabBusyIndicator` |

### Every constructor write stays, except the two the framework re-dispatches on its own

The imperative setter call stays in place in `Spacer` and `ParentHeaderCell`. Keeping it is what keeps the getter, the layout state, and the theme-listener behaviour exactly as they are today; the class tier only gives `flushStyleBag`'s per-key comparison ([`Component.ts:5468`](packages/lib/src/typescript/lib/core/Component.ts#L5468)) something to match against, which turns the write into a `null` removal on the instance's own rule.

`ProgressSpinnerArc` is the exception, and only for `border` and `borderRadius`. Those two are in `applyChromeOptions`'s always-dispatch group ([`Component.ts:843-853`](packages/lib/src/typescript/lib/core/Component.ts#L843-L853)), which fires `setBorder`/`setBorderRadius` from `_defaultOptions` during `super()`. Once both values live in the arc's own defaults bag they are dispatched from there, so the explicit calls are deleted rather than kept — the same shape `TabBusyIndicator` uses, whose constructor forwards its bag and calls no setter at all.

Here is what each instance's own rule carries before and after, read from a probe of the current code:

| Class | Instance rule today | Class-tier source after | Instance rule after |
|---|---|---|---|
| `Spacer` | `background-color: transparent` | `.Spacer` (new) | `backgroundColor: null` — rule never materialises[^all-null] |
| `CollapseButton` after `setStripMode(false)` | `width: 10px` | `.CollapseButton` (already declares `width: 10px`) | no `width` entry written at all |
| `ProgressSpinner`'s arc | `border-radius: 50%`, four `border-*` sides, `animation` | `.ProgressSpinnerArc` (new) | `animation` only — the four sides and the radius null out |
| `ParentHeaderCell` (no `color`) | `background-color: transparent`, `box-shadow: inset …` | `.ParentHeaderCell` (new) | both `null` — rule never materialises |
| `ParentHeaderCell` (`color: "red"`) | `background-color: red`, `box-shadow: inset …` | same | `background-color: red` only |

### `ParentHeaderCell` keeps its `setBackgroundColor(color ?? "transparent")` call unchanged

Adding `backgroundColor: "transparent"` to `ParentHeaderCell.ownClassStyleDefaults` is enough on its own: for the common `color === null` case the instance writes `"transparent"`, the class tier declares `"transparent"`, they match, and the instance rule gets a `null` removal. Skipping the call instead would paint the wrong colour.[^phc-keep-call]

### `CollapseButton`'s width rule, stated as its two cases

`setStripMode` writes the collapsed strip width when filled, and removes its own `width` entry when not — leaving `.CollapseButton`'s own `width: 10px` to apply. `GRIP_ACROSS` stops being referenced by the setter and stays the single source of the class rule's value.

| Call | Written to `#id` | Effective width | Source |
|---|---|---|---|
| `setStripMode(true)` | `width: 18px` | 18px | the instance's own rule (`COLLAPSE_STRIP_SIZE`) |
| `setStripMode(false)` | `width: null` | 10px | `.CollapseButton` (`GRIP_ACROSS`) |
| never called | nothing | 10px | `.CollapseButton` (`GRIP_ACROSS`) |

Row 3 is why the removal is written unconditionally rather than guarded: a `setStripMode(false)` before any `setStripMode(true)` removes a property that was never there, which is a no-op.

---

## Internal Structure

### `component/container/Spacer.ts` — one `super()` argument

```typescript
// Before (Spacer.ts:81):
super();

// After:
super(undefined, { backgroundColor: "transparent" });
```

Line 91's `this.setBackgroundColor("transparent");` and line 92's `this.setPointerEvents("none");` are both untouched. No import changes.

### `component/container/CollapseButton.ts` — `setStripMode` writes a removal for the grip case

```typescript
// Before (CollapseButton.ts:237):
this.createStyleRule("").set("width", `${filled ? COLLAPSE_STRIP_SIZE : GRIP_ACROSS}px`);

// After:
// Expanded, the width entry is removed rather than rewritten: the shared
// `.CollapseButton` rule already declares `width: ${GRIP_ACROSS}px`, and the
// per-instance `#id` rule outranks it, so repeating the value here would put
// an identical declaration on every instance for nothing.
this.createStyleRule("").set("width", filled ? `${COLLAPSE_STRIP_SIZE}px` : null);
```

`GRIP_ACROSS` (line 16) keeps one live use — the class rule's `width` at line 110 — plus the explanatory comment above. The method's doc comment gains one sentence saying the expanded case falls back to the class rule.

### `component/display/ProgressSpinner.ts` — extract `ProgressSpinnerArc`

A new module-level constant and class, placed after `ARC_BORDER_WIDTH` (line 22) and before `readThemeFontSizePx`:

```typescript
import type { StyleBag } from "~/core/ClassStyleRules.js";

/** The arc's fixed ring geometry: a full circle with one transparent side,
 *  which the rotation keyframe sweeps around. Identical on every spinner. */
const _defaultProgressSpinnerArcOptions: Partial<ComponentOptions> = {
    borderRadius: "50%",
    border: {
        border:    `${ARC_BORDER_WIDTH}px solid var(--ts-ui-progress-spinner-color, rgb(30, 100, 200))`,
        borderTop: `${ARC_BORDER_WIDTH}px solid transparent`,
    },
};

/**
 * The rotating ring inside a {@link ProgressSpinner}. Its geometry never
 * varies by instance, so it lives on the shared `.ProgressSpinnerArc` class
 * rule; only the rotation animation stays a per-instance write, because
 * `Component.onEffectiveVisibilityChange` pauses it by reading
 * `getAnimation()`.
 */
class ProgressSpinnerArc extends Component {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. The same constant the
    // constructor forwards as `subclassDefaults`, so both tiers agree.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultProgressSpinnerArcOptions;

    constructor(options?: ComponentOptions, subclassDefaults?: Partial<ComponentOptions>) {
        super(options, {
            ..._defaultProgressSpinnerArcOptions,
            ...(subclassDefaults ?? {})
        });

        this.setAnimation("ts-ui-progress-spinner-rotate 0.8s linear infinite");
    }
}
```

`ProgressSpinner`'s own constructor loses four lines and its field changes type:

```typescript
// Before (ProgressSpinner.ts:49 and :80-86):
private _arc: Component;
…
this._arc = new Component();
this._arc.setBorderRadius("50%");
this._arc.setBorder({ … });
this._arc.setAnimation("ts-ui-progress-spinner-rotate 0.8s linear infinite");

// After:
private _arc: ProgressSpinnerArc;
…
this._arc = new ProgressSpinnerArc();
```

`super.addComponent(this._arc)` (line 88) and everything in `doLayout` (lines 277-279) are unchanged.

### `component/table/cell/ParentHeader.ts` — hoist the divider shadow and the transparent resting fill

The two-part shadow string moves to a module constant next to the existing font constants, and `ParentHeaderCell` gains its first `ownClassStyleDefaults`:

```typescript
/** Inter-group divider (right edge) and parent-row separator (bottom edge),
 *  in the same resize-handle gray that paints the standard cell separators in
 *  the column row beneath. Composed into one value so it rides `shadow`
 *  rather than `border`, which `Cell`'s theme-change listener rewrites. */
const PARENT_HEADER_CELL_DIVIDER_SHADOW = [
    "inset -1px 0 0 0 var(--ts-ui-table-resize-handle-color, rgba(0, 0, 0, 0.2))",
    "inset 0 -1px 0 0 var(--ts-ui-table-resize-handle-color, rgba(0, 0, 0, 0.2))",
].join(", ");

class ParentHeaderCell extends DefaultCell {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. Both values are what the
    // constructor below already writes for the no-`color` case; a cell given
    // a real `groupColor` still writes its own background on top.
    protected static readonly ownClassStyleDefaults: StyleBag = {
        backgroundColor: "transparent",
        shadow:          PARENT_HEADER_CELL_DIVIDER_SHADOW,
    };

    private _text: string;
    // ... unchanged from here
```

The constructor's two calls stay, with the shadow call now referencing the constant:

```typescript
this.setBackgroundColor(color ?? "transparent");   // unchanged
this.setShadow(PARENT_HEADER_CELL_DIVIDER_SHADOW); // was an inline array + join
```

`StyleBag` is already imported at line 12.

---

## Ordered Implementation Steps

1. **`Spacer.ts`** — change `super();` (line 81) to `super(undefined, { backgroundColor: "transparent" });`. Per `## Internal Structure`.
   *Check:* `npm run typecheck` from `packages/lib`.

2. **New file `packages/lib/tests/component/container/Spacer.classStyleDefaults.test.ts`.** Copy the `CONFIG` / `idSelector` / `declarationsDuring` helpers from [`packages/lib/tests/component/table/cell/ParentHeader.classStyleDefaults.test.ts`](packages/lib/tests/component/table/cell/ParentHeader.classStyleDefaults.test.ts) (lines 15-53), which already has the positive-plus-negative shape every test in this plan uses.

   ```typescript
   it('a rendered Spacer carries no backgroundColor on its own #id rule, and .Spacer declares transparent', () => {
       const sink   = installTestDOM(CONFIG);
       const spacer = new Spacer(16);

       const start        = sink.writes.length;
       const declarations = declarationsDuring(sink, idSelector(spacer), () => spacer.getElement(true));

       const classDeclarations: Record<string, string | null> = {};
       for (const w of sink.writes.slice(start)) {
           if (w.op === 'setRuleStyles' && w.args[0] === '.Spacer') {
               Object.assign(classDeclarations, w.args[1]);
           }
       }

       expect(classDeclarations.backgroundColor).toBe('transparent');
       expect(declarations.backgroundColor).toBeUndefined();
       expect(_ruleCacheHas('.Spacer')).toBe(true);
       expect(spacer.getBackgroundColor()).toBe('transparent');

       // The flat route leaves the chain non-participating, so the class
       // list must not widen (Expected Behaviour row 2).
       const added = sink.writes
           .slice(start)
           .filter((w) => w.op === 'apply' && (w.args[1] as any)?.addClass)
           .map((w) => (w.args[1] as any).addClass);
       expect(added).toContainEqual(['ts-ui-component', 'Spacer']);
   });
   ```

   `.toBeUndefined()`, not `.toBeNull()`: once `backgroundColor` dedupes, every remaining entry in the Spacer's batch is a `null` removal, and an all-`null` batch never materialises the rule at all.[^all-null]

   *Check:* `npx vitest run tests/component/container/Spacer.classStyleDefaults.test.ts` from `packages/lib`.

3. **`CollapseButton.ts`** — rewrite `setStripMode`'s single statement per `## Internal Structure` and extend its doc comment.
   *Check:* `npm run typecheck`. `grep -n 'GRIP_ACROSS' packages/lib/src/typescript/lib/component/container/CollapseButton.ts` — three matches: the `const` (line 16), the class rule's `width` (line 110), and the new explanatory comment; none inside `setStripMode`'s own expression.

4. **`packages/lib/tests/component/container/CollapseButton.test.ts`** — extend the existing `CollapseButton stripMode` describe block (line 103) with a declaration-level case. It currently only asserts the setter returns `this`, under a comment saying the width write is "a CSS-rule side effect" not worth asserting offline — replace that comment, since the write is now exactly what this step pins.

   ```typescript
   it('writes the strip width when filled and removes its own width entry when not', () => {
       const sink   = installTestDOM(CONFIG);
       const button = new CollapseButton();
       button.getElement(true);

       expect(declarationsDuring(sink, idSelector(button), () => { button.setStripMode(true); }).width)
           .toBe('18px');   // COLLAPSE_STRIP_SIZE
       expect(declarationsDuring(sink, idSelector(button), () => { button.setStripMode(false); }).width)
           .toBeNull();
   });
   ```

   `.toBeNull()` here, not `.toBeUndefined()`: the rule is already materialised by this point, so the removal is written through as an explicit `null`. The file already has `CONFIG` and imports `installTestDOM`; add `RecordingDOMSink` to that import, capture `installTestDOM`'s return value as `sink`, and add the `idSelector` / `declarationsDuring` helpers copied from `ParentHeader.classStyleDefaults.test.ts`.

   *Check:* `npx vitest run tests/component/container/CollapseButton.test.ts` from `packages/lib` — the whole file green, including the four pre-existing describe blocks.

5. **`ProgressSpinner.ts`** — add the `StyleBag` type import, the `_defaultProgressSpinnerArcOptions` constant and the `ProgressSpinnerArc` class; retype `_arc`; replace the four construction lines with one. Per `## Internal Structure`.
   *Check:* `npm run typecheck`. `grep -n 'setBorderRadius\|setBorder(' packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts` — zero matches.

6. **New file `packages/lib/tests/component/display/ProgressSpinnerArc.classStyleDefaults.test.ts`.** Reach the arc as `(spinner as unknown as { _arc: Component })._arc`, the pattern [`ProgressSpinner.test.ts:64`](packages/lib/tests/component/display/ProgressSpinner.test.ts#L64) already uses.

   ```typescript
   it("a rendered spinner's arc carries only its animation on its own #id rule; .ProgressSpinnerArc carries the ring", () => {
       const sink    = installTestDOM(CONFIG);
       const spinner = new ProgressSpinner(24);
       const arc     = (spinner as unknown as { _arc: Component })._arc;

       const start        = sink.writes.length;
       const declarations = declarationsDuring(sink, idSelector(arc), () => spinner.getElement(true));

       const classDeclarations: Record<string, string | null> = {};
       for (const w of sink.writes.slice(start)) {
           if (w.op === 'setRuleStyles' && w.args[0] === '.ProgressSpinnerArc') {
               Object.assign(classDeclarations, w.args[1]);
           }
       }

       expect(classDeclarations.borderRadius).toBe('50%');
       expect(classDeclarations.borderTop).toBe('3px solid transparent');
       expect(classDeclarations.borderRight).toBe('3px solid var(--ts-ui-progress-spinner-color, rgb(30, 100, 200))');

       expect(declarations.borderRadius).toBeNull();
       expect(declarations.borderTop).toBeNull();
       expect(declarations.borderRight).toBeNull();
       expect(declarations.borderBottom).toBeNull();
       expect(declarations.borderLeft).toBeNull();
       expect(declarations.animation).toBe('ts-ui-progress-spinner-rotate 0.8s linear infinite');
   });
   ```

   `.toBeNull()` here: the surviving `animation` declaration keeps the arc's own rule materialised, so the removals are written through.

   *Check:* `npx vitest run tests/component/display/ProgressSpinnerArc.classStyleDefaults.test.ts tests/component/display/ProgressSpinner.test.ts` from `packages/lib` — both green, including `ProgressSpinner.test.ts`'s effective-visibility pause case.

7. **`ParentHeader.ts`** — add the `PARENT_HEADER_CELL_DIVIDER_SHADOW` constant, add `ParentHeaderCell.ownClassStyleDefaults`, and point the constructor's `setShadow` at the constant. Per `## Internal Structure`.
   *Check:* `npm run typecheck`. `grep -n 'inset -1px' packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts` — exactly one match (inside the new constant).

8. **`packages/lib/tests/component/table/cell/ParentHeader.classStyleDefaults.test.ts`** — add two cases to the existing file, alongside its `ParentHeaderCellText style hoisting` block. The cell's own rule is guarded by the resting-isolation suffix, so its selector is not the bare `#id`:

   ```typescript
   /** The cell's resting-isolation rule selector — Cell's states guard it. */
   function restingSelector(cell: { getId(): string }): string {
       return idSelector(cell) + ':not(.rangeSelected):not(.readOnly):not(.requiredEmpty)';
   }

   it('a ParentHeaderCell with no colour writes neither background nor shadow on its own rule; .ParentHeaderCell carries both', () => {
       const sink = installTestDOM(CONFIG);
       const cell = new ParentHeaderCell('Group', null);

       const start        = sink.writes.length;
       const declarations = declarationsDuring(sink, restingSelector(cell), () => cell.getElement(true));

       const classDeclarations: Record<string, string | null> = {};
       for (const w of sink.writes.slice(start)) {
           if (w.op === 'setRuleStyles' && w.args[0] === '.ParentHeaderCell') {
               Object.assign(classDeclarations, w.args[1]);
           }
       }

       expect(classDeclarations.backgroundColor).toBe('transparent');
       expect(classDeclarations.boxShadow).toContain('inset -1px 0 0 0');
       expect(declarations.backgroundColor).toBeUndefined();
       expect(declarations.boxShadow).toBeUndefined();
       expect(cell.getBackgroundColor()).toBe('transparent');
   });

   it('a ParentHeaderCell with a groupColor still writes that colour, and only that', () => {
       const sink = installTestDOM(CONFIG);
       const cell = new ParentHeaderCell('Group', 'red');

       const declarations = declarationsDuring(sink, restingSelector(cell), () => cell.getElement(true));

       expect(declarations.backgroundColor).toBe('red');
       expect(declarations.boxShadow).toBeNull();
       expect(cell.getBackgroundColor()).toBe('red');
   });
   ```

   *Check:* `npx vitest run tests/component/table/cell/ParentHeader.classStyleDefaults.test.ts` from `packages/lib` — all six cases green, including the four pre-existing ones.

9. **`packages/lib/docs/reference/changelog/next.md`** — add the entries in `## Documentation Impact`.
   *Check:* `npm run docs:api` finishes with zero new warnings (the baseline is 0 errors, 1 warning).

10. **Full verification.** See `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/Spacer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/CollapseButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts` |
| Modify | `packages/lib/tests/component/container/CollapseButton.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/ParentHeader.classStyleDefaults.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Create | `packages/lib/tests/component/container/Spacer.classStyleDefaults.test.ts` |
| Create | `packages/lib/tests/component/display/ProgressSpinnerArc.classStyleDefaults.test.ts` |

---

## Expected Behaviour

Rows 1-8 are unit-testable with the existing `installTestDOM` / `RecordingDOMSink` harness. Rows 9-10 are manual.

| # | Case | Expected |
|---|---|---|
| 1 | A rendered `Spacer` | `.Spacer` declares `background-color: transparent`; the spacer's own `#id` rule carries no `background-color` entry at all; `getBackgroundColor()` still returns `"transparent"` |
| 2 | A rendered `Spacer` | Its rendered class list is unchanged (`ts-ui-component Spacer`) — the flat route does not widen the chain |
| 3 | `setStripMode(true)` on a rendered `CollapseButton` | Writes `width: 18px` (`COLLAPSE_STRIP_SIZE`) to its own rule |
| 4 | `setStripMode(false)` on a rendered `CollapseButton` | Writes `width: null`; the effective width falls back to `.CollapseButton`'s `10px` (`GRIP_ACROSS`) |
| 5 | `setStripMode(false)` with no prior `setStripMode(true)` | No error; removes a property that was never set |
| 6 | A rendered `ProgressSpinner`'s arc | `.ProgressSpinnerArc` declares `border-radius: 50%` and all four `border-*` sides; the arc's own rule carries only `animation` |
| 7 | `spinner.setVisible(false)` then `Component.flushEffectiveVisibility()` | The arc's `getAnimationPlayState()` is `"paused"`, and `null` again after `setVisible(true)` — the pre-existing case in `ProgressSpinner.test.ts`, which must stay green because `animation` stays a per-instance write |
| 8 | A rendered `ParentHeaderCell` | With `color: null`: `.ParentHeaderCell` declares both `background-color: transparent` and the two-part `box-shadow`, and the cell's own resting rule carries neither. With `color: "red"`: the cell's own rule carries `background-color: red` and `box-shadow: null` |
| 9 | Demo app: a toolbar or status bar using `Spacer`, a `Split` gutter's chevron, a `ProgressSpinner`, and a table with grouped columns | Every one is visually identical to before — no rendered pixel changes, only which CSS rule supplies each value. Collapsing and restoring a `Split` pane must show the chevron widening to the strip and shrinking back |
| 10 | Style Audit panel (`#/style-audit`), before and after, having rendered each of the four components | The four duplicate-body rows this plan targets are gone from the ranked list |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # zero new warnings against the 0-error / 1-warning baseline
```

Run from `packages/lib`. Grep invariants:

- `grep -n 'GRIP_ACROSS' packages/lib/src/typescript/lib/component/container/CollapseButton.ts` — three matches, none inside `setStripMode`'s own expression.
- `grep -n 'setBorderRadius\|setBorder(' packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts` — zero matches.
- `grep -n 'inset -1px' packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts` — exactly one match.
- `grep -c 'ownClassStyleDefaults' packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts` — 1 and 2 respectively (`ParentHeader.ts` already has one on `ParentHeaderCellText`).

**Manual verification (rows 9-10) is required.** Start a dev server from this worktree on a spare port — not the user's existing one — and exercise a `Split` collapse/restore, a `ProgressSpinner`, a grouped-column table header, and any panel using `Spacer`, then open `#/style-audit` and refresh.

---

## Documentation Impact

No exported symbol changes. `ProgressSpinnerArc` is module-private and not re-exported; `ownClassStyleDefaults` is `protected`; `Spacer`'s and `CollapseButton`'s public signatures are untouched. Two entries in `packages/lib/docs/reference/changelog/next.md` under `## Changed` → `### Components`:

> **`Spacer`, `CollapseButton`, `ProgressSpinner`, and `ParentHeaderCell` no longer duplicate their fixed styling on every instance's own CSS rule.** Each now shares one rule per piece across every instance in the app. Nothing changes visually; no consumer action needed.

> **A progress spinner's inner arc element now carries a `ProgressSpinnerArc` class** (`ts-ui-component ProgressSpinnerArc`, previously `ts-ui-component` alone). This is additive — no existing class is removed — but a consumer stylesheet selector written to match the arc by position rather than by name may now also be matched by a more specific `.ProgressSpinnerArc` rule.

No other DOM class list changes: `Spacer` stays outside the hierarchy mechanism, and a `ParentHeaderCell` element already carries `ts-ui-component Cell DefaultCell ParentHeaderCell` today (its chain participates through `Cell`).

---

## Potential Challenges

- **`.ParentHeaderCell`'s hoisted `box-shadow` is less specific than `Cell`'s required-empty ring.** Today the divider shadow rides the cell's own `#id:not(…)` rule, which outranks `.Cell.requiredEmpty:not(…)`; on the class rule it does not. A parent header cell is never marked required-empty, read-only, or range-selected (only `Row` sets those, and only on data cells), so no rendered case changes — but do not extend those flags to parent cells without revisiting this.
- **`ProgressSpinnerArc`'s constructor must take both `options` and `subclassDefaults`.** The `local/require-subclass-defaults` ESLint rule fires on a `super()` argument that spreads a `_default<Name>Options` constant without also referencing a constructor parameter; `TabBusyIndicator`'s two-parameter shape is what satisfies it.
- **`Spacer`'s inline bag must stay an inline literal.** The same rule ignores `super(undefined, { backgroundColor: "transparent" })` precisely because it names no `_default<Name>Options` constant. Do not promote it to one.
- **Assertion polarity differs per test.** `.toBeUndefined()` where the deduped property was the instance's only real declaration (the rule never materialises); `.toBeNull()` where another real declaration in the same batch keeps the rule alive. Each step above says which and why.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/button/TabButton.ts` (lines 46-92) | `TabBusyIndicator` — the dedicated-private-subcomponent shape `ProgressSpinnerArc` mirrors, including its decision to leave the animation as a per-instance write |
| `packages/lib/src/typescript/lib/component/input/FileField.ts` (line 44) | `HiddenFileInput` — the inline-`subclassDefaults`-bag shape `Spacer` mirrors |
| `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` | `_defaultCellOptions` / `ownClassStyleDefaults` / `ownStyleStates` / the constructor's own `setBackgroundColor` seed — everything `ParentHeaderCell`'s hoist sits on top of |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `resolveDeclarations`, `chainParticipates`, `resolveClassLevel`, `ensureClassStyleRule` — how a class rule is built and when the flat bag stops being consulted |
| `packages/lib/src/typescript/lib/core/Component.ts` | `applyChromeOptions` (the always-dispatch group), `flushStyleBag` (the per-key comparison every hoist here relies on), `clearShadow` (the null-when-a-lower-tier-supplies-it decision `setStripMode` mirrors) |
| `packages/lib/tests/component/table/cell/ParentHeader.classStyleDefaults.test.ts` | The existing test file steps 2, 6, and 8 copy their helpers and positive-plus-negative shape from, and which step 8 extends |
| `plans/implemented/class-tier-default-hoists-batch.md` | Direct precedent for this plan's shape; its Implementation Notes carry the first-`ownClassStyleDefaults` trap and the `.toBeUndefined()`-vs-`.toBeNull()` finding |

---

## Non-Goals

- **`MenuBarButton.setActive`.** The audit's claim is stale and its proposed fix would be a regression. `setActive(false)` already produces `backgroundColor: null` on the instance's rule — `flushStyleBag` matches the literal against `.MenuBarButton`'s own class-tier value and writes a removal, so there is no duplicate to remove. Replacing the call with `clearBackgroundColor()` would break two things: that method also asserts a literal `"transparent"` whenever `_defaultOptions.backgroundColor` is set ([`Component.ts:2411-2413`](packages/lib/src/typescript/lib/core/Component.ts#L2411-L2413)), putting a real declaration back on every instance *and* overriding the theme token `var(--ts-ui-menu-bar-btn-bg, transparent)`; and `getBackgroundColor()` would start returning `null` instead of that token.[^menubar-probe]
- **`SplitGutter`.** Its three writes each need a different fix and none is a class-tier hoist. `setBackgroundColor(this._expandedBackground)` reads a public per-instance option, so a class default only helps the value all three in-tree call sites happen to pass. `applyCursor()` picks one of `ew-resize` / `ns-resize` / `default` from orientation, movability, and opaque state — a three-way runtime combination the class tier cannot express and `ownStyleStates` has no orientation key for. `setOpaque` is a genuine two-state toggle across four properties, which belongs in the state tier. Bundling any of them here would break this plan's one-mechanical-hoist-per-class profile, so `SplitGutter` gets its own plan.
- **`Spacer`'s `pointer-events: none`.** It is written as an inline element style, not a rule declaration, so it never appears in a `#id` rule and was never a Style Audit row.
- **`ProgressSpinner`'s arc animation.** It stays a per-instance write. `animation` is not a `StyleBag` key, and `Component.onEffectiveVisibilityChange` pauses a hidden component's animation only when `getAnimation()` is non-null — moving the value to a class rule would silently disable that pause, which is load-bearing on high-refresh displays.
- **Any other Style Audit duplicate.** Out of scope for this round.
- **Bumping the package version.** Release-time bookkeeping.

---

## Implementation Notes

- **`ParentHeader.classStyleDefaults.test.ts`'s two new cases could not be
  appended after the existing four as literally written in step 8.**
  `ensureClassStyleRule` caches each class's rule per-constructor for the
  file's whole lifetime (a module-level cache that outlives `DOM.reset()`),
  and `cell.getElement(true)` renders the entire cell subtree in one pass — so
  the *first* full render of a `ParentHeaderCell` in the file establishes
  both `.ParentHeaderCell`'s and `.ParentHeaderCellText`'s class rules
  together, and only that one render's captured writes can observe either
  rule's positive-half content. Appending the two new cases after the
  existing first test (as step 8 specified) put them behind that already-
  consumed first render, so their `classDeclarations` assertions saw nothing.
  Reordering them earlier in the file just moved the same problem onto the
  pre-existing test instead. The fix folds both class-content assertions (the
  pre-existing `.ParentHeaderCellText` checks plus the new
  `.ParentHeaderCell` checks) into one combined first test that captures a
  single render's writes and checks every selector against that one capture;
  the groupColor case, which only checks per-instance (`#id`-rule / getter)
  behaviour, stays a separate, order-independent test. Net count is five
  tests instead of six, covering the same behaviour.
- **Two pre-existing tests broke and needed updates, neither listed in the
  plan's Files to Create/Modify/Delete table.** Both are direct, correctly-
  predicted consequences of this plan's own `## Architecture Decisions`
  tables, not defects in the implementation:
  - `tests/component/table/Header.disposal.test.ts` asserted that the first
    grouped-column `ParentHeaderCell` in its fixture (no `groupColor`) had
    its own `#id`-prefixed rule before a rebuild. Per this plan's own
    before/after table, a no-`color` `ParentHeaderCell` now writes
    `backgroundColor`/`shadow` as `null` (both match the new class default),
    so `hasQueuedDeclarations` never materialises the rule at all — the
    `[^all-null]` case, this time hitting a *different* file's assertion
    than the one the plan already anticipated in its own new tests. Fixed by
    giving the fixture's grouped columns a `groupColor`, which keeps a real
    `#id` rule alive so the test still exercises its actual subject
    (`rebuildParentCells` disposing replaced cells), without changing what
    it's regression-testing.
  - `tests/core/ComponentDispose.test.ts` asserted no new permanent
    (never-disposed) rule-cache keys survive a spinner's disposal beyond an
    explicit allowlist (`FRAMEWORK_SELECTOR`, `BUSY_INDICATOR_SELECTOR`,
    `INVISIBLE_STATE_SELECTOR`). `.ProgressSpinnerArc` is exactly this same
    shape — a module-scoped, first-use, never-disposed class rule, like
    `TabBusyIndicator`'s `.TabBusyIndicator` before it — so it needed the
    same allowlist treatment (`PROGRESS_SPINNER_ARC_SELECTOR`), following the
    file's own established pattern for this exact situation.
- **The plan's `grep -c 'ownClassStyleDefaults'` invariant for
  `ParentHeader.ts` predicted 2, not the actual 3.** The file already
  contained a second, pre-existing match the plan's count missed: line 43's
  `...Text.ownClassStyleDefaults.font` (a *read* of `Text`'s field, inside
  `ParentHeaderCellText`'s own `ownClassStyleDefaults` initializer), which
  the substring grep counts alongside the two `protected static readonly
  ownClassStyleDefaults` declarations. The code matches `## Internal
  Structure` exactly; only the plan's own verification arithmetic was off.
- **Manual verification (Expected Behaviour rows 9-10) performed.** Started a
  dev server from this worktree on a spare port (8025, not the user's own
  8015/8019 instances) and drove it via `mcp__chrome-devtools__*`. Row 9:
  double-clicking a `Split` pane's `CollapseButton` chevron on `#/split`
  collapsed it to the full collapse-strip width and restored it back to the
  narrow grip on a second double-click, confirmed via screenshot both times;
  the inline `ProgressSpinner` on `#/misc` rendered as a normal rotating blue
  ring (screenshot); the grouped-wide-table window (`#/misc` → "Show window
  with grouped wide table") rendered its four `ParentHeaderCell` group bands
  ("Identity", "Activity", "Financials", "Metadata") with the divider shadow
  visible at each group's right/bottom edge and no background-colour
  mismatch against the header band's gradient (screenshot). Row 10: on
  `#/style-audit`, after visiting `#/split` and the grouped-table window, the
  refreshed audit table's ranked list contains no row for `Spacer`'s
  `background-color: transparent`, `CollapseButton`'s `width: 10px`,
  `ProgressSpinner`'s arc ring geometry, or `ParentHeaderCell`'s
  background/shadow — confirmed by reading the full row list via an
  accessibility-tree snapshot (`Total rules: 229 · Per-instance (#id) rules:
  85 · Unique bodies: 46`). `CollapseButton` and `Glyph` each still appear in
  the ranked list, but for different, out-of-scope bodies (`{ cursor:
  pointer; transform: … }` and `{ animation-play-state: paused; }`
  respectively) — not the ones this plan targeted.

## Notes

[^bundle]: The four items touch four disjoint source files and four disjoint test files, and none depends on another's outcome, so they are four sequential steps in one plan rather than four plans. This mirrors `class-tier-default-hoists-batch.md`'s own framing of its six items as "six independently revertable steps".

[^spacer-flat]: `Spacer` has no subclasses and no ancestor declaring `ownClassStyleDefaults`, so `chainParticipates(Spacer)` stays `false` and `ensureClassStyleRule` keeps taking its flat path — the class rule is built from `getClassStyleDefaults()`, whose base body returns `_defaultOptions` verbatim. Registering `backgroundColor` there is therefore enough to create a `.Spacer` rule and give `flushStyleBag` something to match, with no chain widening and no new mechanism. Using `ownClassStyleDefaults` instead would work too but is the larger diff and would opt the class into a hierarchy walk it gains nothing from — the same reasoning `class-tier-default-hoists-batch.md` applied to `HiddenFileInput`.

[^collapse-hand-rule]: `.CollapseButton` is registered by `ensureCollapseButtonClassRule` as a raw `new StyleRule({ scope: "class", … })`, not through either class-defaults tier, so its `width: 10px` is invisible to `_classLayer` and `matchesLowerTier("width", "10px")` would return `false`. `width` is not a `StyleBag` key either, and the write goes through `createStyleRule("")` — a deferred `#id` rule outside the style-bag path entirely. So the comparison cannot be delegated to the framework; the setter makes it itself, from the same module constant the class rule was built from. Moving the whole rule onto `ownClassStyleDefaults` was considered and rejected: most of its body (`top`, `left`, `transform`, `background`, `text-align`, `font-size`, `line-height`, `pointer-events`) has no `StyleBag` key, so the hand-registered rule has to stay regardless and splitting it across two mechanisms would make it harder to read, not easier.

[^all-null]: `StyleTarget.hasQueuedDeclarations` treats a batch whose every entry is `null` as nothing to write, and `Component.commitCSSRule` gates materialisation on it — so the rule is never inserted and the key is simply *absent* from the render rather than present with value `null`. `class-tier-default-hoists-batch.md`'s Implementation Notes hit this the hard way, after writing five tests with `.toBeNull()` that all failed with `expected undefined to be null`.

[^phc-keep-call]: Skipping `setBackgroundColor` when `color` is `null` looks equivalent but is not. `Cell`'s own constructor unconditionally calls `this.setBackgroundColor('var(--ts-ui-table-cell-bg, transparent)')` to seed the instance layer for `_applyStateTint`'s equality guard. With `ParentHeaderCell`'s call removed, that seeded token would be the instance's authored value; it would not match a class default of `"transparent"`, so it would be written through and the cell would paint the ordinary cell background instead of showing the header band's gradient. Keeping the call costs nothing — the values match, so the write becomes a removal — and leaves `_baseBackground` and every `Cell` state tint exactly as they are.

[^menubar-probe]: Measured on the current `master` with the `RecordingDOMSink` harness. `setActive(true)` on a rendered `MenuBarButton` writes `{ backgroundColor: "var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))" }` to its own rule and `setActive(false)` writes `{ backgroundColor: null }`, with `getBackgroundColor()` reporting `"var(--ts-ui-menu-bar-btn-bg, transparent)"` afterward. Calling `clearBackgroundColor()` on the same instance instead writes `{ backgroundColor: null }` followed by `{ backgroundColor: "transparent" }`, with `getBackgroundColor()` reporting `null`.
