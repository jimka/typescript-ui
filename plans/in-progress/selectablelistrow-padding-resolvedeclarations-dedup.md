---
touches-shared:
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Padding Class-Tier Resolution — Implementation Plan

## Overview

A live Style Audit scan found `SelectableListRow`'s `padding` CSS as the single biggest duplicate-CSS-rule row by instance count in the framework (~135 instances) — every row writes an identical `padding` declaration to its own `#id` rule instead of sharing one class-tier rule. The cause is a real gap in [`resolveDeclarations`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L204) — the function that builds every class's shared `.ClassName` rule. It has cases for `backgroundColor`, `shadow`, `borderRadius`, `border`, `position`, and eleven other fields, but none for `padding`; confirmed by reading the function in full (lines 204–261) and by grep (`padding` appears nowhere in its body). `SelectableListRow` writes its padding imperatively in its constructor ([`AbstractSelectableList.ts:327`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L327)), so with no class-tier value to dedupe against, every instance's real value lands on its own `#id` rule.

This plan closes that gap, following the exact precedent commit `5d63a9bd` ("Hoist Legend's static position into its class default") set for the same kind of fix on `position` — but the correct shape here is not a literal copy of that commit's diff. `position` already had a framework-tier baseline value (`Position.ABSOLUTE`, one of `FRAMEWORK_DECLARATIONS`'s fifteen keys) to fall back to; `padding` has none. `## Architecture Decisions` explains why that difference changes the shape of the fix.

Widening `resolveDeclarations` is a single shared function, so the fix activates *every* class that already has a `padding` value sitting inertly in its class-tier defaults bag — not just `SelectableListRow`, which needs a new registration. An exhaustive grep (`## Architecture Decisions`) found six already-registered, currently-inert classes: the five [`plans/implemented/class-tier-default-hoists-batch.md`](plans/implemented/class-tier-default-hoists-batch.md) already flagged as an "open follow-up" in its Implementation Notes (`TextField`, `TextArea`, `PasswordField`, `UsernameField`, `AbstractPickerField`), plus one this plan's own search found beyond that list: `AbstractMarkerList` (`BulletedList`/`NumberedList`). Every one of the six needs to be reasoned through individually: unlike `SelectableListRow`'s own hoist, which only moves an already-painted value onto a shared rule, all six activate CSS the framework has never painted before — a genuine, first-time visible change, not an invisible dedup — and two of the six (`AbstractPickerField`, `AbstractMarkerList`) also place child components whose positioning needs checking for interaction with the newly-real padding. This plan requires live verification of all six, not just `SelectableListRow`.

---

## Architecture Decisions

### `resolveDeclarations` gains a truthy-gated `padding` case — not `position`'s unconditional-fallback shape

[`FRAMEWORK_DECLARATIONS`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L107) is the fifteen-key baseline every class's resolved bag is diffed against. `position` is one of those fifteen keys (`Position.ABSOLUTE`), so the position fix could safely write `position: defaults.position ?? Position.ABSOLUTE` unconditionally — every class's resolved bag already had *some* `position` value to compare, so adding the fallback changed nothing for a class that declares none.

`padding` is not one of the fifteen keys — `FRAMEWORK_DECLARATIONS` has no `padding` entry at all, because most components declare no default padding. Mirroring `position`'s unconditional shape (`declarations.padding = defaults.padding ?? "0px 0px 0px 0px"` or similar, always present) would inject a real `padding` key into *every* class's resolved bag, including the hundreds that never touch it. Diffed against `FRAMEWORK_DECLARATIONS.padding` (`undefined`), a class's own `null`-or-any resolved value would never equal `undefined`, so every such class would spuriously "deviate" and gain a `padding: null` (or worse, an unwanted real value) declaration on its own `.ClassName` rule — the opposite of "byte-identical to today" and a regression at framework scale, not a fix.

The correct shape instead matches the *other* conditional fields already in the same function — `backgroundColor`, `backgroundImage`, `shadow`, `borderRadius` (lines 234–237): a plain truthy gate that adds the key only when a class actually declares a value, leaving every other class's resolved bag byte-identical to today:

```typescript
if (defaults.padding) declarations.padding = defaults.padding.render() as string;
```

Grep-verified this is safe and complete: exactly six classes anywhere in `packages/lib/src` register a literal `padding: new Insets(...)` inside a `subclassDefaults`/`ownClassStyleDefaults`-style class-defaults bag (`## Files to Create / Modify / Delete` names them all); every other class's `defaults.padding` is `undefined`, so the new line is a no-op for it.[^grep-sweep]

### `SelectableListRow`'s padding moves into its existing flat `_defaultSelectableListRowOptions` bag, not a new `ownClassStyleDefaults` field

`SelectableListRow extends Component` directly, and neither it nor `Component` declares `ownClassStyleDefaults` today ([`AbstractSelectableList.ts:276`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L276) — confirmed by reading the class body and by `chainParticipates`' own contract in [`ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L484): a class outside the hierarchy mechanism falls back to the flat, `classDeviations`-against-`FRAMEWORK_DECLARATIONS` path). `SelectableListRow` already dedupes `cursor` and `border` this way, through `_defaultSelectableListRowOptions` ([`AbstractSelectableList.ts:260`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L260)), forwarded to `super()` as `subclassDefaults` and read back by `getClassStyleDefaults()`'s default body (`return this._defaultOptions;`). Adding `padding` to that same bag is the smallest change and mirrors the already-shipped `border` hoist for this exact class ([`delegate-class-style-defaults-followups.md`](plans/implemented/delegate-class-style-defaults-followups.md)), and matches `class-tier-default-hoists-batch.md`'s own `## Architecture Decisions` table, which picked this exact mechanism for this exact class for this exact reason before the `resolveDeclarations` gap blocked it.

This means the regression trap the task brief calls out — giving a class `ownClassStyleDefaults` for the *first* time flips it onto the hierarchy-aware `resolveClassLevel` path, which stops consulting the flat `_defaultOptions` bag for that class's rule entirely, silently dropping any other field that only lives in the flat bag ([`class-tier-default-hoists-batch.md`](plans/implemented/class-tier-default-hoists-batch.md)'s own "ToolBar" audit finding is the worked example) — **does not apply here**. This plan never adds `ownClassStyleDefaults` to `SelectableListRow`; `cursor` and `border` stay exactly where they are, in the same flat bag `padding` joins, so nothing about how they're read changes.

The constructor's imperative `this.setPadding(new Insets(0, ROW_PADDING_X_PX, 0, ROW_PADDING_X_PX));` ([`AbstractSelectableList.ts:327`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L327)) stays exactly as it is, per every prior hoist in this lineage — deleting it is out of scope (`## Non-Goals`) and nothing else needs the value gone from the instance layer.

### The six already-registered `padding` fields are dead CSS today — this plan's fix is what activates them, not a new registration

`TextField`, `TextArea`, `PasswordField`, `UsernameField`, and `AbstractPickerField` already declare `padding: new Insets(3, 3, 3, 3)` inside their `ownClassStyleDefaults` bag (respectively [`TextField.ts:26`](packages/lib/src/typescript/lib/component/input/TextField.ts#L26), [`TextArea.ts:51`](packages/lib/src/typescript/lib/component/input/TextArea.ts#L51), [`PasswordField.ts:28`](packages/lib/src/typescript/lib/component/input/PasswordField.ts#L28), [`UsernameField.ts:26`](packages/lib/src/typescript/lib/component/input/UsernameField.ts#L26), [`AbstractPickerField.ts:45`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L45)) — this is exactly what [`class-tier-default-hoists-batch.md`](plans/implemented/class-tier-default-hoists-batch.md)'s Implementation Notes found and left as an "open follow-up," naming these five specifically. None of the five calls `setPadding()` on itself anywhere in its own constructor (grep-verified across all five files), so today its registered padding value reaches nothing: `resolveDeclarations` never emits it onto the shared `.ClassName` rule (the gap this plan closes), and there is no instance-level write either for the flush-time dedup to compare against. `padding` is already listed in `Component.ts`'s own `SKIP_ON_MATCH_KEYS` set ([`Component.ts:385-392`](packages/lib/src/typescript/lib/core/Component.ts#L385-L392)) — the set of keys `flushStyleBag` skips outright (line 5365) when the instance itself never authored them, "a class/group-default-only value always 'matches' its own source, so this can never produce a write either way." This is independent, already-shipped confirmation that a class-only `padding` value was always meant to resolve purely through the class tier with zero instance-level write — exactly the mechanism `resolveDeclarations`'s missing case currently defeats, and exactly why activating it produces no `#id` writes for any of the five (or `AbstractMarkerList`, below): `flushStyleBag` traced end to end for `TextField` — `declaredByInstance` is `false` (no `writeStyle({ padding })` call ever fires), `SKIP_ON_MATCH_KEYS.has("padding")` is `true`, so the key is skipped at line 5365 before it ever reaches a write decision. `packages/lib/tests/component/input/TextInputClassTier.test.ts`'s own "row 1" test proves this today — a rendered `TextField`'s own `#id` rule carries exactly `['maxHeight', 'minHeight']` and nothing else (line 119); `padding` is absent from both its `#id` rule and (unasserted, but confirmed by reading `resolveDeclarations`) its `.TextField` class rule.

This plan's own search additionally found a sixth, previously unflagged case: `AbstractMarkerList` forwards `padding: new Insets(0, 0, 0, 25)` through `subclassDefaults` in its constructor ([`AbstractMarkerList.ts:89`](packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts#L89)), with no `ownClassStyleDefaults` registered anywhere in its chain (grep-confirmed) — so, like `SelectableListRow`, it takes the flat `classDeviations`-against-`FRAMEWORK_DECLARATIONS` path. Neither `AbstractMarkerList` nor either of its two concrete subclasses (`BulletedList`, `NumberedList`) calls `setPadding()` anywhere (grep-confirmed), so this value is equally dead today. `packages/lib/tests/component/list/AbstractMarkerList.classStyleDefaults.test.ts` already exists and dedupes a *different* field (`listStyleType`, via a hand-rolled shared-rule mechanism unrelated to `resolveDeclarations`) — it makes no assertion about `padding` at all.

Because `resolveDeclarations` is one shared function, fixing its `padding` gap **simultaneously activates real CSS for all six classes** the moment it ships — this plan cannot scope the fix to `SelectableListRow` alone while leaving the other five inert. No source change is needed for any of the six beyond `SelectableListRow`'s bag addition; the next decision covers why this is safe to ship, and `## Expected Behaviour` / `## Verification` require confirming it live for every one of them, not just `SelectableListRow`.

### The two children-placing classes among the six are unaffected by real CSS padding

`AbstractPickerField` and `AbstractMarkerList` are the two of the six that place children (`AbstractPickerField._input`/`_button`; `AbstractMarkerList`'s VBox-laid-out items) rather than rendering their own leaf content — the case worth checking for a double-offset, since every framework component's children are absolutely positioned (`getContentInsets()`'s own doc comment, [`Component.ts:2291`](packages/lib/src/typescript/lib/core/Component.ts#L2291): *"Framework components are absolutely positioned, so a child's containing block is its parent's padding box... the browser does not shift it inward by the padding."*). This is the CSS spec behavior, not an incidental effect of padding being currently unrendered: the containing block for a `position: absolute` child is the ancestor's *padding box*, whose **outer edge coincides with the border's inner edge regardless of the padding value** — a real, non-zero CSS `padding` shrinks the padding box's *inner* edge, not its outer one, so it never moves where a child's `left: 0`/`top: 0` lands. `getContentInsets()` (`insets + padding`, border excluded) is the offset a layout manager must add on top of that fixed origin to reach the actual content edge — this was already true, and already relied on, before this plan; nothing about making padding *real* CSS instead of a JS-only value changes where that origin sits.

Both children-placing classes already route through the canonical accessors this invariant assumes: `AbstractPickerField.doLayout` uses `getContentBounds()` ([`AbstractPickerField.ts:218`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L218)), and `VBox.doLayout` (the layout manager `AbstractMarkerList` uses) reads `getInnerSize()`/`getContentInsets()` directly ([`VBox.ts:272,278`](packages/lib/src/typescript/lib/layout/VBox.ts#L272)) rather than assembling an origin by hand. `AbstractPickerField.doLayout` was previously one of eleven hand-written methods that got this wrong by reading the *border* box instead ([`bordered-field-content-box-layout.md`](plans/implemented/bordered-field-content-box-layout.md), site #1) — already fixed, and that fix's own worked table (*"2px border, 3px padding, no insets → `{3, 3, ...}`"*) is the same math this plan relies on, verified live in a browser by that plan under the exact regime this plan changes (padding present in `getPadding()` but not yet real CSS). Making the CSS real does not change the math; it only makes the padding band's background paint correctly instead of being supplied by nothing.

`TextField`/`TextArea`/`PasswordField`/`UsernameField` render no framework-positioned children at all (each is a bare `<input>`/`<textarea>` leaf), so this question does not apply to them — their only effect from this fix is the native element's own text-rendering inset, covered by the next decision.

### This is a visible fix for the six already-registered classes, not an invisible dedup — the changelog and verification must say so

Every prior plan in this lineage (`delegate-class-style-defaults-followups.md`, `class-tier-default-hoists-batch.md`) could truthfully promise "nothing changes visually" in its changelog entry, because each one moved an *already-painted* value from an instance rule onto a shared class rule. `SelectableListRow`'s own padding hoist in this plan is the same: its padding is already real (imperatively set every construction), so dedupe changes nothing rendered.

The other five classes are different in kind: their registered padding has never been painted by the framework before this fix (`## Architecture Decisions` above). Activating it is a genuine, first-time visible change — `TextField`/`TextArea`/`PasswordField`/`UsernameField`'s `<input>`/`<textarea>` elements gain real `padding: 3px 3px 3px 3px` where they previously rendered with whatever thin browser-default input padding applied, and `AbstractPickerField`'s three concrete fields (`DateField`/`TimeField`/`DateTimeField`) gain the same on a container whose children were already positioned assuming it, and `BulletedList`/`NumberedList` gain `padding: 0px 0px 0px 25px` on their own root element. This is very likely the intended, designed appearance all along — `getPadding()` already reports these values today and every height/layout calculation that reads it (`Util.singleLineBoxHeight`, `AbstractPickerField.updateHeight`, `VBox`'s content math) was already sized as if the padding painted — but "very likely correct" is not the same as verified, so `## Verification` requires a live look at all six, and `## Documentation Impact`'s changelog entry states this plainly rather than the lineage's usual "nothing changes visually" line.

---

## Internal Structure

### `core/ClassStyleRules.ts` — `resolveDeclarations`'s new `padding` case

Inserted directly after the existing `border` block and before the `font` block ([`ClassStyleRules.ts:239–247`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L239-L247)):

```typescript
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
```

`FRAMEWORK_DEFAULTS` (the `StyleBag` used as the hierarchy walk's base case, standing in for `Component` itself, [`ClassStyleRules.ts:131`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L131)) needs no change: it has no `padding` key today, and none is added — `Component` declares no default padding, so `resolveDeclarations(FRAMEWORK_DEFAULTS)` correctly continues to produce no `padding` key, matching `FRAMEWORK_DECLARATIONS`.

### `core/ClassStyleRules.ts` — `StyleBag`'s doc comment update

The comment above `padding`'s own field declaration currently groups it with `boxSizing`/`whiteSpace`/`margin` as "written outside the authored-bag path" and separately calls out that `position` used to belong there too ([`ClassStyleRules.ts:58–67`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L58-L67)). Update it to also drop `padding` from that group, mirroring the existing `position` sentence:

```typescript
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
```

### `component/list/AbstractSelectableList.ts` — `SelectableListRow`'s bag gains `padding`

```typescript
const _defaultSelectableListRowOptions: Partial<ComponentOptions> = {
    cursor:  "pointer",
    border:  { borderBottom: "1px solid var(--ts-ui-list-row-separator, transparent)" },
    padding: new Insets(0, ROW_PADDING_X_PX, 0, ROW_PADDING_X_PX),
};
```

No other line in the file changes. `Insets` is already imported ([`AbstractSelectableList.ts:13`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L13)).

---

## Ordered Implementation Steps

1. **`core/ClassStyleRules.ts` — add the `padding` case to `resolveDeclarations` and update the `StyleBag` comment.** Per `## Internal Structure`.
   *Check:* `npm run typecheck` from `packages/lib`.

2. **`grep -rn "padding: new Insets" packages/lib/src/typescript/lib`** — confirm exactly the six sites named in `## Architecture Decisions` (`TextField`, `TextArea`, `PasswordField`, `UsernameField`, `AbstractPickerField`, `AbstractMarkerList`) still exist and no new one appeared since this plan was written. If a new one has appeared, add it to `## Expected Behaviour`/`## Verification`'s live-check list before continuing — the fix activates it too.

3. **`component/list/AbstractSelectableList.ts`** — add `padding` to `_defaultSelectableListRowOptions`. Per `## Internal Structure`.
   *Check:* `npm run typecheck`.

4. **`packages/lib/tests/component/list/SelectableListRow.classStyleDefaults.test.ts`** — fix the stale file-header comment (it currently explains that `resolveDeclarations` "never gained a matching case" for `padding` — no longer true) and add a new `it()` case in the same `describe` block, following the file's own `idSelector`/`declarationsDuring` helpers and the "positive + negative half" shape `Legend.classStyleDefaults.test.ts` uses ([`Legend.classStyleDefaults.test.ts`](packages/lib/tests/component/container/Legend.classStyleDefaults.test.ts)):

   ```typescript
   it('a rendered row carries no real padding declaration on its own #id rule, and .SelectableListRow carries it', () => {
       const sink = installTestDOM(CONFIG);

       const start = sink.writes.length;
       const list  = new _List({ items: ['Apple', 'Banana'] });
       const row   = (list as any)._rowPool[0];

       const declarations = declarationsDuring(sink, idSelector(row), () => list.getElement(true));

       const classDeclarations: Record<string, string | null> = {};
       for (const w of sink.writes.slice(start)) {
           if (w.op === 'setRuleStyles' && w.args[0] === '.SelectableListRow') {
               Object.assign(classDeclarations, w.args[1]);
           }
       }
       expect(classDeclarations.padding).toBe('0px 8px 0px 8px');

       // The row's constructor always calls setPadding(), so padding is
       // always a key in `this._instanceStyle` (`writeStyle({ padding })`,
       // Component.ts:2265) — `flushStyleBag`'s per-key loop
       // (Component.ts:5362) therefore always takes the `declaredByInstance`
       // branch for it, and once the class tier's resolved value matches,
       // `matchesLower` is true and it queues an explicit `null` removal
       // (Component.ts:5421), the same shape `border` already has in this
       // same test — not an omitted/`undefined` key, which only happens for
       // a key the instance never wrote at all (e.g. `cursor`, just above).
       expect(declarations.padding).toBeNull();
       expect(_ruleCacheHas('.SelectableListRow')).toBe(true);
       expect(row.getPadding()?.getLeft()).toBe(8); // ROW_PADDING_X_PX
   });
   ```

   *Check:* `npx vitest run tests/component/list/SelectableListRow.classStyleDefaults.test.ts` from `packages/lib` — both cases green, including the pre-existing `row 5` case unmodified.

5. **New file `packages/lib/tests/component/input/TextInputPaddingActivation.test.ts`** — one test per already-registered `TextInput`-family class, each constructing that class fresh (first-ever construction of it in this new, isolated test file — Vitest's default `isolate: true` gives every test file its own module registry, so this needs no priming call and cannot collide with `TextInputClassTier.test.ts`'s own file-scoped construction-order requirements). Full worked example for `TextField`; mirror it for the other four per the table below.

   ```typescript
   // Coverage for TextField/TextArea/PasswordField/UsernameField/
   // AbstractPickerField's `padding` — registered in `ownClassStyleDefaults`
   // since each class shipped, but never painted as real CSS until this
   // plan's `resolveDeclarations` fix (padding-resolvedeclarations-dedup.md).
   // A fresh, separate file (not an addition to TextInputClassTier.test.ts)
   // so each class's `.ClassName` rule is captured on its first-ever
   // construction, without disturbing that file's own construction-order
   // requirements (see its own file banner comment).
   import { describe, it, expect, afterEach } from 'vitest';
   import { DOM } from '~/core/DOM';
   import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
   import fontMetrics from '../../dom/font-metrics.test-font.json';
   import { _ruleCacheHas } from '~/core/StyleTarget';
   import { TextField } from '~/component/input/TextField';

   const CONFIG = {
       rootMountOffset: { x: 0, y: 0 },
       viewport:        { width: 1280, height: 800 },
       scrollBarWidth:  15,
       fontMetrics,
       themeVars:       {},
   };

   function idSelector(component: { getId(): string }): string {
       return '#' + DOM.source.escapeSelector(component.getId());
   }

   function declarationsDuring(
       sink: RecordingDOMSink,
       selector: string,
       fn: () => void,
   ): Record<string, string | null> {
       const start = sink.writes.length;
       fn();

       const out: Record<string, string | null> = {};
       for (const w of sink.writes.slice(start)) {
           if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
               continue;
           }
           const styles = w.args[1] as Record<string, string | null>;
           for (const key of Object.keys(styles)) {
               out[key] = styles[key];
           }
       }
       return out;
   }

   describe('TextInput-family padding activation', () => {
       afterEach(() => DOM.reset());

       it('a rendered TextField carries no real padding on its own #id rule, and .TextField carries it', () => {
           const sink = installTestDOM(CONFIG);

           const start = sink.writes.length;
           const field = new TextField();
           const declarations = declarationsDuring(sink, idSelector(field), () => field.getElement(true));

           const classDeclarations: Record<string, string | null> = {};
           for (const w of sink.writes.slice(start)) {
               if (w.op === 'setRuleStyles' && w.args[0] === '.TextField') {
                   Object.assign(classDeclarations, w.args[1]);
               }
           }
           expect(classDeclarations.padding).toBe('3px 3px 3px 3px');
           expect(declarations.padding).toBeUndefined(); // TextField never calls setPadding itself
           expect(_ruleCacheHas('.TextField')).toBe(true);
           expect(field.getPadding()?.getTop()).toBe(3);
       });
   });
   ```

   Mirror the one `it()` block above for the other four, changing only the constructed class, its module import, and the class selector/import checked in the loop:

   | Class | Import | Construction | Class selector | Expected `classDeclarations.padding` |
   |---|---|---|---|---|
   | `TextArea` | `~/component/input/TextArea` | `new TextArea()` | `.TextArea` | `'3px 3px 3px 3px'` |
   | `PasswordField` | `~/component/input/PasswordField` | `new PasswordField()` | `.PasswordField` | `'3px 3px 3px 3px'` |
   | `UsernameField` | `~/component/input/UsernameField` | `new UsernameField()` | `.UsernameField` | `'3px 3px 3px 3px'` |
   | `AbstractPickerField` (via `DateField`) | `~/component/input/DateField` | `new DateField()` | `.AbstractPickerField` | `'3px 3px 3px 3px'` |

   For the `DateField` case, assert `declarations.padding` (the field's own `#id` rule, not `(field as any)._input`'s — the inner `PickerInput` has its own, separate, already-real `0px 3px 0px 3px` padding from `AbstractPickerField.ts:106`, untouched by this plan) and `field.getPadding()?.getLeft()` (expect `3`).

   *Check:* `npx vitest run tests/component/input/TextInputPaddingActivation.test.ts` from `packages/lib` — all five cases green.

6. **`packages/lib/tests/component/list/AbstractMarkerList.classStyleDefaults.test.ts`** — add two new `it()` cases to the existing `describe` block, following its own `idSelector`/`declarationsDuring` helpers already in the file. `AbstractMarkerList` takes the flat (non-hierarchy) `resolveDeclarations` path, same as `SelectableListRow` — `BulletedList` and `NumberedList` are two independent concrete classes with no `ownClassStyleDefaults` anywhere in their chain, so each gets its **own** `.BulletedList`/`.NumberedList` rule (not the shared `.MarkerList` selector the existing `listStyleType` tests use — that one is a hand-rolled rule unrelated to `resolveDeclarations`/`ownClassStyleDefaults`, per this file's own header comment). Neither class registers any other `StyleBag` field today, so before this fix `classDeviations` resolves to `{}` for both and no `.BulletedList`/`.NumberedList` rule exists at all (`_ruleCacheHas` false for both) — after this fix, each independently gains a real `padding` deviation:

   ```typescript
   it('a rendered BulletedList carries no real padding on its own #id rule, and .BulletedList carries it', () => {
       const sink = installTestDOM(CONFIG);

       const start = sink.writes.length;
       const list  = new _BulletedList();
       const declarations = declarationsDuring(sink, idSelector(list), () => list.getElement(true));

       const classDeclarations: Record<string, string | null> = {};
       for (const w of sink.writes.slice(start)) {
           if (w.op === 'setRuleStyles' && w.args[0] === '.BulletedList') {
               Object.assign(classDeclarations, w.args[1]);
           }
       }
       expect(classDeclarations.padding).toBe('0px 0px 0px 25px');
       expect(declarations.padding).toBeUndefined(); // BulletedList never calls setPadding itself
       expect(_ruleCacheHas('.BulletedList')).toBe(true);
       expect(list.getPadding()?.getLeft()).toBe(25);
   });

   it('a rendered NumberedList carries no real padding on its own #id rule, and .NumberedList carries it independently', () => {
       const sink = installTestDOM(CONFIG);

       const start = sink.writes.length;
       const list  = new _NumberedList();
       const declarations = declarationsDuring(sink, idSelector(list), () => list.getElement(true));

       const classDeclarations: Record<string, string | null> = {};
       for (const w of sink.writes.slice(start)) {
           if (w.op === 'setRuleStyles' && w.args[0] === '.NumberedList') {
               Object.assign(classDeclarations, w.args[1]);
           }
       }
       expect(classDeclarations.padding).toBe('0px 0px 0px 25px');
       expect(declarations.padding).toBeUndefined();
       expect(_ruleCacheHas('.NumberedList')).toBe(true);
       expect(list.getPadding()?.getLeft()).toBe(25);
   });
   ```

   *Check:* `npx vitest run tests/component/list/AbstractMarkerList.classStyleDefaults.test.ts` from `packages/lib` — all four cases green, including the two pre-existing `listStyleType` cases unmodified.

7. **`packages/lib/docs/reference/changelog/next.md` changelog entry.** See `## Documentation Impact`.
   *Check:* `npm run docs:api` finishes with zero warnings.

8. **Full offline verification.** See `## Verification`.

9. **Live browser verification — non-negotiable, covers all six activated classes plus `SelectableListRow`.** See `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/tests/component/list/SelectableListRow.classStyleDefaults.test.ts` |
| Modify | `packages/lib/tests/component/list/AbstractMarkerList.classStyleDefaults.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Create | `packages/lib/tests/component/input/TextInputPaddingActivation.test.ts` |

No source change to `TextField.ts`, `TextArea.ts`, `PasswordField.ts`, `UsernameField.ts`, `AbstractPickerField.ts`, or `AbstractMarkerList.ts` — each already declares the padding value that this plan's `resolveDeclarations` fix activates (`## Architecture Decisions`).

---

## Expected Behaviour

Rows 1–2 and 8 are unit-testable with the existing `installTestDOM`/`RecordingDOMSink` harness. Rows 3–7 and 9–10 require a live browser (`## Verification`).

| # | Case | Expected |
|---|---|---|
| 1 | A rendered `SelectableListRow` (via `List`) | No real `padding` on its own `#id` rule (`null`, matching `border`'s existing shape); `.SelectableListRow` gains `padding: 0px 8px 0px 8px`; `getPadding()` still reports the row's 8px horizontal inset |
| 2 | A rendered `TextField`/`TextArea`/`PasswordField`/`UsernameField` | No `padding` at all on its own `#id` rule (`undefined` — none of the four calls `setPadding()` itself); its `.ClassName` rule gains `padding: 3px 3px 3px 3px` for the first time; `getPadding()` is unchanged (already reported this value) |
| 3 | A rendered `DateField`/`TimeField`/`DateTimeField` | Same shape as row 2, on the shared `.AbstractPickerField` rule; the inner `PickerInput`'s own separate, already-real `0px 3px 0px 3px` padding (`#id`-scoped) is unaffected |
| 4 | A rendered `BulletedList`/`NumberedList` | No `padding` on its own `#id` rule; its class rule gains `padding: 0px 0px 0px 25px` for the first time; `getPadding()` unchanged |
| 5 | Demo app: wherever `List`/`MultiSelectList` render | Row appearance identical to before — `SelectableListRow`'s padding was already real, only its CSS tier changes |
| 6 | Demo app: `TextField`/`TextArea`/`PasswordField`/`UsernameField` instances | Visibly gain a crisper, larger inset around their typed text (3px on every side) where the framework previously supplied none — a genuine, expected appearance change, not a regression, per `## Architecture Decisions` |
| 7 | Demo app: `DateField`/`TimeField`/`DateTimeField` | The picker glyph button and the text input stay correctly positioned relative to the field's border (no double-offset — `## Architecture Decisions`' `getContentInsets()` reasoning); the field gains the same crisper inset as row 6 |
| 8 | Demo app: wherever `BulletedList`/`NumberedList` render | List items stay aligned exactly as before (the 25px marker-column padding was already being reserved by `getPadding()`); no visible position change expected, but confirm |
| 9 | `#/style-audit` panel, before/after, exercising a view with each of the seven affected classes | `SelectableListRow`'s padding duplicate-rule row disappears from the ranked list |
| 10 | A class with no `padding` value anywhere in its defaults bag (spot-check two or three unrelated classes, e.g. `Button`, `Cell`) | Resolved CSS bag and rendered appearance are byte-identical to before this plan — confirms the truthy gate, not just the six affected classes |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Run from `packages/lib` unless noted.

**Manual browser verification (rows 3, 5–9) is required, and must cover all six activated classes, not only `SelectableListRow`.**

- Start a dev server on a spare port from *this worktree*, not the user's existing server.
- Exercise a `List`/`MultiSelectList`, a `TextField`/`TextArea`/`PasswordField`/`UsernameField`, a `DateField`/`TimeField`/`DateTimeField`, and a `BulletedList`/`NumberedList`.
- Read **computed styles**, not just screenshots, for each: confirm the new `padding` value is present, and for `DateField`/`TimeField`/`DateTimeField` specifically confirm the picker button's rendered rectangle is still flush with the field's content box (not shifted an extra 3px inward).
- Open `#/style-audit` and confirm `SelectableListRow`'s padding row is gone from the ranked duplicates list.

---

## Documentation Impact

No exported symbol changes. One changelog entry in `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Components`, split into two bullets per `## Architecture Decisions`' distinction between an invisible dedup and a visible activation:

> **`SelectableListRow` no longer duplicates its fixed padding on every instance's own CSS rule.** It now shares one CSS rule across every instance in the app. Nothing changes visually; no consumer action needed.

> **`TextField`, `TextArea`, `PasswordField`, `UsernameField`, `AbstractPickerField` (`DateField`/`TimeField`/`DateTimeField`), and `BulletedList`/`NumberedList` now render with the padding they were always configured with, but which a resolver gap silently dropped.** Text fields gain a 3px inset around their typed text on every side; the marker-list classes are unaffected in practice (their layout already accounted for the padding). If a consumer's own stylesheet compensated for the previously-missing padding, that compensation should be revisited.

---

## Potential Challenges

- **The `DateField`/`TimeField`/`DateTimeField` live check is the one genuine risk in this plan** — everything else is either a pure CSS-tier dedup with zero layout interaction (`SelectableListRow`, the four bare `TextInput` leaves) or backed by an already-shipped, already-tested invariant (`## Architecture Decisions`' `getContentInsets()` reasoning). Mitigated by making it an explicit, named step in `## Verification` rather than folding it into a generic "check the demo app" pass.
- **A future class could add a seventh `padding: new Insets(...)` registration before this plan lands**, changing step 2's grep count. Step 2 is an explicit re-check for exactly this.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | The function being widened: `resolveDeclarations` (204), `FRAMEWORK_DECLARATIONS` (107), `FRAMEWORK_DEFAULTS` (131), `StyleBag` (39) |
| `plans/implemented/class-hierarchy-cascade.md`, `plans/implemented/class-tier-default-hoists-batch.md` | The mechanism this plan closes a gap in, and the plan that first found and deferred exactly this gap (its Implementation Notes name the five `TextInput`-family classes and explain why it stopped short of this fix) |
| Commit `5d63a9bd` ("Hoist Legend's static position into its class default") | The direct precedent for widening `resolveDeclarations` for a field that previously bypassed the authored-bag path — and, per `## Architecture Decisions`, the precedent whose *shape* does not transfer verbatim, since `position` had a framework baseline and `padding` does not |
| `plans/implemented/bordered-field-content-box-layout.md` | Already fixed `AbstractPickerField.doLayout`'s child placement to use `getContentBounds()`, and its own worked table is the evidence this plan's padding activation cannot double-offset `_input`/`_button` |
| `packages/lib/src/typescript/lib/core/Component.ts` | `getContentInsets()` (2308) — the documented CSS containing-block invariant `## Architecture Decisions` relies on; `resolveStyleValue`/`styleLayers` (5119) — confirms `getPadding()` already reads the correct value today, independent of `resolveDeclarations` |
| `packages/lib/tests/component/input/TextInputClassTier.test.ts` | Proves today's gap empirically (row 1's `#id` assertion excludes `padding`); its file-banner comment explains the construction-order fragility this plan's new, separate test file avoids |
| `packages/lib/tests/component/list/SelectableListRow.classStyleDefaults.test.ts`, `packages/lib/tests/component/container/Legend.classStyleDefaults.test.ts` | Templates this plan's new test cases copy — the latter for the "positive + negative half" shape a second audit round in `class-tier-default-hoists-batch.md` found missing from the former's own precedent |

---

## Non-Goals

- **Deleting `SelectableListRow`'s imperative `setPadding()` call.** Kept, per every prior hoist in this lineage — see `## Architecture Decisions`.
- **Giving `SelectableListRow` an `ownClassStyleDefaults` field.** The flat `_defaultSelectableListRowOptions` bag is the established, precedented mechanism for this class; see `## Architecture Decisions`.
- **`MarkdownViewer`'s inner `Markdown` padding** ([`MarkdownViewer.ts:148`](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L148)) **and `MarkdownMinimap`'s `headerRow` padding** ([`MarkdownMinimap.ts:169`](packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts#L169)). Both pass `padding` through a per-instance `options` argument (not `subclassDefaults`), so they land on the instance layer via `applyOptions`'s ordinary dispatch, not the class tier — confirmed unaffected by this fix, and each is its own separate, un-hoisted Style Audit duplicate-rule finding, out of scope here.
- **The theme/rule-body `padding` string literals** in `editorTheme.ts`, `Markdown.ts`'s syntax-highlight rules, `FilterClauseBadge.ts`, `SortPriorityBadge.ts`, and `BaseTheme.ts`. These are raw CSS declarations inside hand-rolled `StyleRule`/theme objects, not `ComponentOptions.padding`/`StyleBag.padding` values — a different type (`string`, not `Insets`) and a different code path, unreached by `resolveDeclarations`.
- **A general re-audit of every `doLayout` override for the containing-block invariant.** Already done by `bordered-field-content-box-layout.md`; this plan only needed to confirm its conclusion still holds once padding becomes real CSS, not repeat the audit.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^grep-sweep]: `grep -rn "padding:\s*new Insets" packages/lib/src/typescript/lib | grep -v '\.test\.'` returns exactly six hits: `TextField.ts:26`, `UsernameField.ts:26`, `AbstractPickerField.ts:45`, `TextArea.ts:51`, `PasswordField.ts:28`, `AbstractMarkerList.ts:89`. A broader `grep -rn "padding:" ` additionally surfaces `MarkdownViewer.ts:148` and `MarkdownMinimap.ts:169` (both per-instance `options`, not class defaults — `## Non-Goals`), and a handful of string-literal CSS rule bodies in `editorTheme.ts`/`Markdown.ts`/`FilterClauseBadge.ts`/`SortPriorityBadge.ts`/`BaseTheme.ts` (a different type and code path entirely — also `## Non-Goals`). No other class registers an `Insets`-typed `padding` default anywhere in the framework today.

## Implementation Notes

**`SelectableListRow`'s own `#id` rule fully disappears once padding also dedupes — it does not carry an explicit `null` removal the way `border` alone used to.** Before this fix, `padding`'s real per-instance value was the *only* thing forcing the row's own `#id` rule to materialise at all (`flushStyleBag`'s per-key loop found no class-tier value to match `padding` against, so it queued the real string; `border`'s already-matching per-side keys rode along as explicit `null` removals in the same batch, since a batch materialises once *any* key in it is real — `StyleTarget.hasQueuedDeclarations`). Once the class tier also resolves `padding`, every key in the row's batch matches its lower tier, nothing in the batch is real, and the whole `#id` rule never materialises — `border`'s (and `cursor`'s) entries go from an explicit `null` removal to simply absent (`undefined`). The plan's own proposed test code (`## Ordered Implementation Steps`, step 4) assumed padding would resolve to an explicit `null` on `#id`, "the same shape `border` already has" — actual, verified behaviour is `undefined`, a *better* outcome (one fewer per-instance rule, not just a smaller one) but not what the plan's test snippet asserted. Updated `row 5` and the new padding test in `SelectableListRow.classStyleDefaults.test.ts` to assert `toBeUndefined()` for `cursor`/`border*`/`padding` and documented why in both tests' comments.

**Test-file ordering had to change to make the plan's proposed test cases actually observable.** `ensureClassStyleRule`'s per-constructor memoization (`_bags`/`_ruleCache`, module-level state that survives `DOM.reset()` between tests within one file — the same constraint `TextInputClassTier.test.ts`'s own file banner documents) means a class's shared `.ClassName` rule content is written to the sink only on the very first construction+render of that class anywhere in the file. The plan's proposed new tests were written to run *after* an existing test that already constructs+renders the same class, so their own capture window found the rule already-materialised and empty:
- `SelectableListRow.classStyleDefaults.test.ts`: reordered so the new padding test (which needs to observe `.SelectableListRow`'s one-time content write) runs *before* the pre-existing `row 5` test, which also constructs+renders a `List`.
- `AbstractMarkerList.classStyleDefaults.test.ts`: `.MarkerList` (construction-time write) and `.BulletedList`/`.NumberedList` (render-time write) are both triggered by the same single `new _BulletedList()` / `new _NumberedList()` + `getElement(true)` call. Since the plan's proposed padding tests and the pre-existing `listStyleType` tests both construct the same two classes, running four separate tests (two old, two new) meant whichever ran second per class found nothing. Consolidated into two tests total — one per concrete class — each asserting both `.MarkerList`'s `listStyleType` and `.BulletedList`/`.NumberedList`'s `padding` from the same construction+render window, rather than four tests with two silently-empty assertions.

Neither deviation changes what ships; both are testing-harness accommodations to the plan's own already-documented per-file construction-order constraint, verified by running the affected suites and confirming green.

**Live browser verification covered all six activated classes plus `SelectableListRow`.** `TextField`, `TextArea`, `PasswordField`, `UsernameField`, `BulletedList`/`NumberedList`, and `DateField`/`TimeField`/`DateTimeField` (the plan's own flagged "genuine risk," verified via computed styles showing uniform `3px` padding and the picker button's rectangle still flush with the input, no double-offset) were all exercised live in the demo app (`localhost:8123`, this worktree's own dev server) and the CSS confirmed via `document.styleSheets` rule inspection. An earlier draft of this note wrongly claimed `PasswordField` had no live route and skipped its manual check on that basis — false: `LayoutTestPanel` (`packages/lib/src/typescript/LayoutTestPanel.ts:47,56`) constructs two `PasswordField` instances directly in its constructor, and `LayoutTestPanel` is the base class `RowPanel`/`HBoxPanel`/`VBoxPanel`/`ColumnPanel` all extend, each wired into `main.ts`'s `addSection` calls (the "Row"/"HBox"/"VBox"/"Column" tabs). Caught by the audit loop below; verified live via `http://localhost:8123/#/row`, where `.PasswordField`'s shared class rule reads `{ cursor: text; color: var(--ts-ui-text-color, black); padding: 3px; }` and both instances' own elements carry no padding in their `style` attribute. The `#/style-audit` panel was confirmed to no longer list `SelectableListRow`'s padding row after visiting the MultiSelect tab and refreshing.

One live-verification gotcha worth recording: the first pass through `#/marker-lists` showed `padding-left: 40px` on `.BulletedList`/`.NumberedList` instead of the expected `25px` — a stale Vite dev-server/browser cache from a pre-existing page at the reused port, not a real defect (the browser's own UA-stylesheet default for `<ul>`/`<ol>` is 40px, which is what was showing through with no class-tier rule yet materialised). A hard reload (`ignoreCache: true`) resolved it and reproduced the expected `25px` with a real `.BulletedList { padding: 0px 0px 0px 25px; }` rule confirmed via `document.styleSheets`.
