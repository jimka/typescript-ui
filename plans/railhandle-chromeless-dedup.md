---
depends-on: [button-variant-chrome-dedup, button-chromeless-followup-dedup]
---

# RailHandle Chromeless Dedup — Implementation Plan

## Overview

[`plans/implemented/button-variant-chrome-dedup.md`](implemented/button-variant-chrome-dedup.md) and [`plans/implemented/button-chromeless-followup-dedup.md`](implemented/button-chromeless-followup-dedup.md) replaced `chromeless: true` with real, declared chrome (`ownClassStyleDefaults` + `ownStyleStates`) for window-control buttons, `TabCloseButton`, `PickerButton`, and `AccordionHeader`'s title button. Both plans named [`RailHandle`](packages/lib/src/typescript/lib/overlay/RailHandle.ts) in their Non-Goals as a `chromeless: true` call site they deliberately left unaudited. It is still chromeless today ([RailHandle.ts:72](packages/lib/src/typescript/lib/overlay/RailHandle.ts#L72)), and every handle still writes three rules of its own: a bare `#id` resting rule, an `#id.pressed` rule, and an `#id:hover:not(.selected)` rule.[^probe-evidence]

This plan applies the same fix to `RailHandle`, with one difference from `PickerButton`: `RailHandle` has real hover and selected looks, so two of its three state extracts carry real values instead of pinning back to the resting chrome. It also fixes a live rendering bug the same change uncovers — `RailHandle`'s selected wash never reaches the screen today, because the per-instance `#id` resting write `chromeless` produces outranks the `.RailHandle.selected…` class rule that carries it.

---

## Architecture Decisions

### `RailHandle` drops `chromeless: true` and declares real resting chrome

`RailHandle` gains its own `ownClassStyleDefaults` — transparent background, no border, no shadow, `borderRadius: undefined` — and drops `chromeless: true` from its `super()` call. The bag mirrors [`PickerButton`](packages/lib/src/typescript/lib/component/input/PickerButton.ts#L22)'s `_defaultPickerButtonOptions` exactly, which is the closest precedent: a chromeless-by-default `Button` subclass whose resting chrome never varies per instance.[^picker-is-the-precedent]

Dropping `chromeless` is what makes the dedup possible at all, for the two reasons `button-variant-chrome-dedup.md` established: `chromeless` calls `suppressIsolation(true)` ([Button.ts:1035](packages/lib/src/typescript/lib/component/button/Button.ts#L1035)), routing the resting write to the bare `#id` rule that no class rule can outrank, and it calls `pinPressedToResting()` ([Button.ts:1092](packages/lib/src/typescript/lib/component/button/Button.ts#L1092)), which writes `.pressed` per instance without comparing against anything.

### `RailHandle`'s states are real, so its extracts carry real values

Unlike `PickerButton` and `AccordionHeader`'s title button — which have no visual press or hover distinction, and whose `ownStyleStates` entries therefore pin every key back to the resting chrome — `RailHandle` has two genuine visual states:

- **`:hover`** — a wash from `--ts-ui-rail-handle-hover-bg` (`rgba(30, 100, 200, 0.08)` in the modern and classic themes, `rgba(120, 170, 240, 0.12)` in dark).
- **`.selected`** — a stronger wash from `--ts-ui-rail-handle-selected-bg`, driven by the rail to mirror whether the handle's drawer is open or its window is restored.

Its `:hover` and `.selected` extracts therefore carry those washes, not `"transparent"`. Only `.pressed` is pinned to the resting chrome, reproducing exactly what `pinPressedToResting()` writes today.

Each extract must supply `backgroundColor`, `backgroundImage`, **and** `shadow` — not `backgroundColor` alone. State content is a merge over the parent level ([ClassStyleRules.ts:746](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L746)), so a `:hover` extract naming only `backgroundColor` would inherit `Button`'s raised hover gradient and drop shadow for the other two keys. `.selected` has no parent entry to inherit from, but still needs all three so its rule outranks `.Button:hover:not(.pressed)` on a handle that is selected *and* hovered.[^selected-needs-three-keys]

### `.selected` is declared ahead of `:hover`, not appended after it

`RailHandle`'s declared order becomes `[".pressed", ".selected", ":hover"]`. Array order is priority, and `guardedSuffixFor` guards each entry against every entry *before* it ([ClassStyleRules.ts:629](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L629)) — so putting `.selected` second gives `:hover` the generated guard `:hover:not(.pressed):not(.selected)`, which is precisely the hand-written `:hover:not(.selected)` semantics `RailHandle` has today: the selected wash keeps winning while the pointer is over an already-open handle.

This diverges from `ToggleButton`, which appends `.selected` last ([ToggleButton.ts:63](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L63)) so hover beats selected. The divergence is deliberate: `RailHandle` wants the opposite precedence, and the declared list is still declared in one place, which is what `ARCHITECTURE.md`'s *The class tier is hierarchy-aware* rule about whole-list order actually protects. Because `RailHandle` overrides the *content* of `.pressed` and `:hover` as well, it declares all three entries explicitly instead of spreading `...Button.ownStyleStates`.

Resulting rules and the state each one wins in:

| Handle state | Rule that decides `background-color` | Specificity | Value |
|---|---|---|---|
| rest | `.RailHandle` | (0,1,0), after `.Button` | `transparent` |
| hover | `.RailHandle:hover:not(.pressed):not(.selected)` | (0,4,0) | hover wash |
| selected | `.RailHandle.selected:not(.pressed)` | (0,3,0) | selected wash |
| selected + hover | `.RailHandle.selected:not(.pressed)` | (0,3,0) | selected wash |
| pressed | `.RailHandle.pressed` | (0,2,0), after `.Button.pressed` | `transparent` |

### The hand-rolled `railHoverRule` is deleted

`RailHandle` builds its hover wash through a private lazy `createStyleRule(":hover:not(.selected)")` ([RailHandle.ts:60-63](packages/lib/src/typescript/lib/overlay/RailHandle.ts#L60)) written from the constructor. `createStyleRule` allocates a per-instance `#id<suffix>` rule with no class-tier comparison, so every handle repeats the same declaration — the same bypass shape `MenuBarButton`'s `styleRules` `:hover` entry had before `button-variant-chrome-dedup.md` moved it into `ownStyleStates`. The field, its getter, the constructor's write, and the now-unused `StyleRule` import all go.

### The selected wash renders for the first time

Today `chromeless`'s resting write puts `background-color: transparent` on `RailHandle`'s bare `#id` rule at specificity (1,0,0). The `.selected` wash lives on `.RailHandle.selected:not(.pressed):not(:hover)` at (0,4,0). An id selector always wins, so the wash is masked and a selected handle looks identical to an unselected one.[^selected-wash-masked]

Moving the resting write onto the `.RailHandle` class rule (and onto the guarded `#id:not(.pressed):not(.selected):not(:hover)` rule for the four isolation keys, where it dedupes to nothing) removes the mask. Selecting a handle becomes visible. This is a rendering change, not a silent internal one, and `## Expected Behaviour` treats it as the plan's headline manual check.

---

## Public API

`RailHandle` is exported from [`overlay/index.ts:26`](packages/lib/src/typescript/lib/overlay/index.ts#L26). Its constructor gains an additive, optional second parameter, per `ARCHITECTURE.md`'s *Constructors forward `subclassDefaults`* — required because the `local/require-subclass-defaults` ESLint rule (`error`, [packages/lib/eslint.config.js:32](packages/lib/eslint.config.js#L32)) fires for any class declaring `ownClassStyleDefaults` whose constructor hands its own defaults constant straight to `super()`:

```typescript
class RailHandle extends Button<RailHandleOptions> {
    constructor(options?: RailHandleOptions, subclassDefaults?: Partial<ButtonOptions>);
}
```

`RailHandleOptions` is unchanged. No other exported signature changes.

---

## Internal Structure

### `overlay/RailHandle.ts`

Replace the module constant at [RailHandle.ts:9-10](packages/lib/src/typescript/lib/overlay/RailHandle.ts#L9) with two constants. The existing comment on `RAIL_HANDLE_SELECTED_BACKGROUND_COLOR` ("One source of truth for both `ownStyleStates`' extract and the constructor's write") is stale — the constructor writes the *hover* value, not this one — and the constructor write it refers to is deleted by this plan, so the comment is rewritten:

```typescript
/**
 * `.selected`'s wash. `backgroundImage` / `shadow` are neutralised alongside
 * it in the extract below so the selected rule also outranks
 * `.Button:hover:not(.pressed)` on a handle that is selected *and* hovered —
 * see plans/implemented/railhandle-chromeless-dedup.md's Architecture
 * Decisions.
 */
const RAIL_HANDLE_SELECTED_BACKGROUND_COLOR = "var(--ts-ui-rail-handle-selected-bg)";

/**
 * Resting + pressed + hover defaults for {@link RailHandle}. The resting bag
 * (transparent background, no border, no shadow) restates what
 * `chromeless: true` used to compute imperatively in
 * `Button.applyChromeOptions`'s chromeless branch; the `pressedX` fields
 * restate what `pinPressedToResting` used to pin per instance, so a press
 * still shows no visual change. `pressedForegroundColor` restates the same
 * literal token `Button`'s own resting default uses
 * (`_defaultButtonOptions.foregroundColor` in Button.ts — module-private, so
 * not importable). Unlike `PickerButton`, the `hoverX` fields are a *real*
 * wash, not a pin to the resting values: a rail handle does highlight on
 * hover. `borderRadius: undefined` is an explicit key, not an omission, so it
 * wins over Button's own non-empty default in the `subclassDefaults` spread
 * merge below.
 */
const _defaultRailHandleOptions: Partial<ButtonOptions> = {
    backgroundColor:        "transparent",
    backgroundImage:        "none",
    border:                 "none",
    borderRadius:           undefined,
    shadow:                 "none",
    pressedForegroundColor: "var(--ts-ui-text-color, black)",
    pressedBackgroundColor: "transparent",
    pressedBackgroundImage: "none",
    pressedShadow:          "none",
    hoverBackgroundColor:   "var(--ts-ui-rail-handle-hover-bg)",
    hoverBackgroundImage:   "none",
    hoverShadow:            "none",
};
```

Replace the `ownStyleStates` field at [RailHandle.ts:42-56](packages/lib/src/typescript/lib/overlay/RailHandle.ts#L42) (the comment block above it included) and add `ownClassStyleDefaults`:

```typescript
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultRailHandleOptions;

    // Declares Button's two states with RailHandle's own content, plus
    // `.selected`, ordered `[.pressed, .selected, :hover]`. Array order is
    // priority: putting `.selected` ahead of `:hover` generates the guard
    // `:hover:not(.pressed):not(.selected)`, reproducing the hand-written
    // `:hover:not(.selected)` rule this class used before — the selected
    // wash keeps winning while the pointer is over an already-open handle.
    // That is the reverse of `ToggleButton`'s order, deliberately; see
    // plans/implemented/railhandle-chromeless-dedup.md's Architecture
    // Decisions. Each extract names every key its Button-level counterpart
    // carries — four for `.pressed`, three for `:hover` — because state
    // content merges over the parent level, so an unnamed key would inherit
    // Button's raised gradient or drop shadow. `.selected` has no parent
    // entry, but names the same three so its rule also outranks
    // `.Button:hover:not(.pressed)` on a selected *and* hovered handle.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".pressed",
            extract: (): StyleBag => ({
                foregroundColor: _defaultRailHandleOptions.pressedForegroundColor,
                backgroundColor: _defaultRailHandleOptions.pressedBackgroundColor,
                backgroundImage: _defaultRailHandleOptions.pressedBackgroundImage,
                shadow:          _defaultRailHandleOptions.pressedShadow,
            }),
        },
        {
            selector: ".selected",
            extract: (): StyleBag => ({
                backgroundColor: RAIL_HANDLE_SELECTED_BACKGROUND_COLOR,
                backgroundImage: "none",
                shadow:          "none",
            }),
        },
        {
            selector: ":hover",
            extract: (): StyleBag => ({
                backgroundColor: _defaultRailHandleOptions.hoverBackgroundColor,
                backgroundImage: _defaultRailHandleOptions.hoverBackgroundImage,
                shadow:          _defaultRailHandleOptions.hoverShadow,
            }),
        },
    ];
```

Delete the `_railHoverRule` field and its `railHoverRule` getter ([RailHandle.ts:58-63](packages/lib/src/typescript/lib/overlay/RailHandle.ts#L58)), and replace the constructor ([RailHandle.ts:65-75](packages/lib/src/typescript/lib/overlay/RailHandle.ts#L65)):

```typescript
    /**
     * Builds a launcher handle.
     *
     * @param options - Construction-time options (label `text`, leading `glyph`,
     *   initial `selected` state).
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; forwarded so a subclass can seed a default without
     *   editing this class's own constant.
     */
    constructor(options: RailHandleOptions = {}, subclassDefaults?: Partial<ButtonOptions>) {
        super(options.text, options, { ..._defaultRailHandleOptions, ...(subclassDefaults ?? {}) });
    }
```

Import changes: drop `import { StyleRule } from "~/core/StyleTarget.js";` (nothing else in the file uses it). `Button`, `ButtonOptions`, `StyleBag`, `StyleStateSpec`, `DOM`, `callable` imports are all already present and all still used.

Class doc comment ([RailHandle.ts:26-39](packages/lib/src/typescript/lib/overlay/RailHandle.ts#L26)): the opening reads "A chromeless [`Button`](/api/component/button/classes/Button) subclass that carries a `selected` state…". Replace "A chromeless" with "A flat-chromed" and add one sentence after the first paragraph:

> Declares its own resting chrome (transparent, no border/shadow) instead of `chromeless: true`, and its `.pressed` / `.selected` / `:hover` looks as declared style states — see plans/implemented/railhandle-chromeless-dedup.md.

Keep the rest of the comment — the two washes, and the "internal to the rail subsystem" paragraph — unchanged.

---

## Ordered Implementation Steps

1. **`overlay/RailHandle.ts`** — apply every edit in `## Internal Structure`: the two module constants, `ownClassStyleDefaults`, the rewritten `ownStyleStates`, the deleted `_railHoverRule`/`railHoverRule`, the rewritten constructor, the dropped `StyleRule` import, and the class doc comment.
   *Check:* `npm run typecheck`. `grep -n 'chromeless: true\|railHoverRule\|StyleTarget' packages/lib/src/typescript/lib/overlay/RailHandle.ts` — zero matches (the word `chromeless` survives only inside the new doc comments, which is why the pattern pins the option literal).
2. **New test file `packages/lib/tests/overlay/RailHandle.classStyleHoisting.test.ts`.** Cover `## Expected Behaviour` rows 1-6, using the `declarationsDuring`/`idSelector` helpers from [`tests/core/ClassHierarchyCascade.test.ts`](packages/lib/tests/core/ClassHierarchyCascade.test.ts) (recreate them locally — they are module-private there). Prime the `.Button` class rules with one chromeful `new Button("x")` first, then construct and render two `RailHandle`s; assert against the *second* one's `#id` rules and against the class rules materialised during the first.
   *Check:* `npx vitest run tests/overlay/RailHandle.classStyleHoisting.test.ts` from `packages/lib`.
3. **Add two rows to the default-resolution registry** in [`tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts), per `ARCHITECTURE.md`'s *Class-level defaults must survive the getter* — mirror the existing `PickerButton` rows' shape ([lines 318-319](packages/lib/tests/component/default-options-fallback.test.ts#L318)): `RailHandle getBackgroundColor()` → `'transparent'`, `RailHandle getShadow()` → `'none'`. Import `RailHandle` from `~/overlay/RailHandle`.
   *Check:* `npx vitest run tests/component/default-options-fallback.test.ts` — green.
4. **Full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`. `npm run lint` and `npm -w packages/lib run test:lint` — the `local/no-raw-dom` baseline stays empty and `local/require-subclass-defaults` reports nothing for `RailHandle`.
5. **Add the changelog entry.** See `## Documentation Impact`.
6. **Manual verification.** See `## Verification` — non-negotiable: rows 7-10 include a rendering change (the selected wash) that no offline test can confirm.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/RailHandle.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Create | `packages/lib/tests/overlay/RailHandle.classStyleHoisting.test.ts` |

---

## Expected Behaviour

Rows 1-6 are unit-testable offline (recording DOM sink, no real cascade). Rows 7-10 need a live browser.

**Per-instance rules stop repeating**

1. A second `new RailHandle({ text: "B" })`, rendered after a first has primed the shared rules, writes no `backgroundColor` / `backgroundImage` / `boxShadow` / `borderTop` / `borderRight` / `borderBottom` / `borderLeft` with a non-`null` value to its own `#id` rule, nor to `#id:not(.pressed):not(.selected):not(:hover)`.
2. The second instance writes no real declaration to `#id.pressed`.
3. No `#id:hover:not(.selected)` rule is created for either instance — that selector disappears from the stylesheet entirely.

**Class rules carry the content instead**

4. `.RailHandle` exists carrying `background-color: transparent`, `background-image: none`, `box-shadow: none`, and `border-top` / `border-right` / `border-bottom` / `border-left: none`.
5. `.RailHandle.pressed` carries `color: var(--ts-ui-text-color, black)`, `background-color: transparent`, `background-image: none`, `box-shadow: none` — the same four declarations `pinPressedToResting` used to write per instance.
6. `.RailHandle.selected:not(.pressed)` carries `background-color: var(--ts-ui-rail-handle-selected-bg)`, `background-image: none`, `box-shadow: none`; `.RailHandle:hover:not(.pressed):not(.selected)` carries `background-color: var(--ts-ui-rail-handle-hover-bg)`, `background-image: none`, `box-shadow: none`.

**Manual verification** (`npm run dev`, Misc panel → "Toggle launcher rail (Rail)"; switch themes via the theme picker)

7. **New behaviour:** opening a rail drawer (click the "Filters" or "Info" handle) now tints that handle with the selected wash, and closing it clears the tint. Before this plan the handle looked identical open or closed. Confirm in all three themes.
8. A rail handle still shows the lighter hover wash on pointer-over, and a handle that is already selected keeps its stronger selected wash while hovered — it does not flip to the hover wash.
9. A rail handle still shows no border and no drop shadow, keeps the same corner rounding it had before this plan, and still shows no visual change while held down — in all three themes.
10. Open the Style Audit panel after exercising the rail, and confirm no `RailHandle` duplicate-rule rows appear.

---

## Verification

Run from the repo root unless noted.

- `npm run typecheck` — after every step.
- `npm test` from `packages/lib` (`typecheck:test` + `vitest run`) — full suite green.
- `npm run lint` and `npm -w packages/lib run test:lint`.
- `npm run docs:api` — zero warnings (the only exported-signature change is `RailHandle`'s additive optional constructor parameter).
- Grep invariant: `grep -n 'chromeless: true\|railHoverRule\|StyleTarget' packages/lib/src/typescript/lib/overlay/RailHandle.ts` — zero matches (the word `chromeless` survives only inside the new doc comments, which is why the pattern pins the option literal).
- **Manual browser verification is required, in all three themes** (`## Expected Behaviour` rows 7-10). Start a dev server on a spare port from *this worktree*, confirming with `readlink /proc/<pid>/cwd` that it resolves there.

---

## Documentation Impact

`RailHandle`'s constructor gains an additive, optional second parameter; its typedoc API page (`/api/overlay/classes/RailHandle`) regenerates from the updated JSDoc via `npm run docs:api`, with no manual page edit. [`packages/lib/docs/components/Rail.md`](packages/lib/docs/components/Rail.md) describes the rail's behaviour and never calls `RailHandle` chromeless, so it needs no change.

- `packages/lib/docs/reference/changelog/next.md`, `## Fixed` → `### Components` (append after the existing `PickerButton`/`AccordionHeader` entry, [next.md:155-158](packages/lib/docs/reference/changelog/next.md#L155)): **A `Rail`'s handles now show their selected tint when the handle's drawer is open or its window is restored — previously the tint was masked by the handle's own resting rule and never rendered. The handles also dedupe their resting, pressed, hover, and selected chrome onto shared class rules instead of repeating on every instance.** No consumer action is needed.

---

## Potential Challenges

- **Row 7 is a visible change to shipped behaviour, not a no-op dedup.** Both precedent plans' changelog entries said "nothing renders differently"; this one's cannot. If the newly-visible wash turns out to be unwanted, the fix is to change the token, not to restore the mask — say so rather than reverting the resting-tier move.
- **The `.selected` extract must carry three keys, not one.** With only `backgroundColor`, a selected *and* hovered handle picks up `Button`'s raised hover gradient and shadow from `.Button:hover:not(.pressed)`. Row 6 pins the full three-key content so a mistake fails a test instead of surfacing only as a live glitch on one hard-to-reach state combination.
- **The declared-order change is easy to undo by reflex.** `[".pressed", ".selected", ":hover"]` looks wrong next to `ToggleButton`'s `[...Button.ownStyleStates, ".selected"]`. Reordering to match `ToggleButton` silently inverts hover-vs-selected precedence, which row 8 is the check for.
- **`borderRadius: undefined` must be an explicit key**, not an omission — omitting it lets `Button`'s own non-empty default win the `subclassDefaults` spread merge. Handles keep `.Button`'s border radius either way (`.RailHandle` declares none, so the cascade falls through to `.Button`, exactly as the current `#id` removal does), so this is about the getter reporting `null`, not about a visible corner change.

---

## Critical Files

| File | Why |
|---|---|
| [overlay/RailHandle.ts](packages/lib/src/typescript/lib/overlay/RailHandle.ts) | The whole change lands here |
| [component/input/PickerButton.ts](packages/lib/src/typescript/lib/component/input/PickerButton.ts) | The direct precedent this plan's `ownClassStyleDefaults` + `.pressed`/`:hover` shape copies — read first |
| [component/button/ToggleButton.ts](packages/lib/src/typescript/lib/component/button/ToggleButton.ts) | `ownStyleStates` (55-73) — the `.selected` precedent, including its three-key extract; also the order this plan deliberately inverts |
| [component/button/Button.ts](packages/lib/src/typescript/lib/component/button/Button.ts) | `_defaultButtonOptions` (222-241, the values `.pressed`/`:hover` would otherwise inherit), `ownStyleStates` (394-429), `applyChromeOptions`'s chromeless branch (1023-1096), `pinPressedToResting` (2081-2096) |
| [core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) | `guardedSuffixFor` (629-637, why order is precedence), `resolveStateLevels` (696-761, the per-level merge that makes a partial extract inherit `Button`'s chrome), `restingGuardSuffix` (864-866) |
| [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) | `createStyleRule` (1163, the un-compared per-instance write the deleted `railHoverRule` used), `flushStyleBag` (5348-5450) and `restingIsolationKeys` (5572-5582) — how the resting write is routed and deduped once isolation is no longer suppressed |
| [overlay/Rail.ts](packages/lib/src/typescript/lib/overlay/Rail.ts) | `registerDrawer` (913) and `showWindowHandle` (1043) — confirm no caller customises a handle's chrome per instance |
| [plans/implemented/button-chromeless-followup-dedup.md](implemented/button-chromeless-followup-dedup.md) | The precedent plan, including its Implementation Notes on why `:hover` must be declared explicitly once the resting write leaves the bare `#id` rule |
| [ARCHITECTURE.md](ARCHITECTURE.md) | *Component CSS tiers and state-rule dedup*, *The class tier is hierarchy-aware*, *Constructors forward `subclassDefaults`*, *Class-level defaults must survive the getter* |

---

## Non-Goals

- **`MenuBarButton`'s `.pressed` pin.** Still chromeless, still pinned per instance; `button-chromeless-followup-dedup.md` confirmed and deferred it because fixing it means adding `border`/`borderRadius`/`shadow`/`backgroundImage` resting overrides it does not have today. Unchanged by this plan.
- **Changing `pinPressedToResting` or `pinStateStyle`.** This plan stops one more call site reaching the chromeless branch; it does not touch either method.
- **Retuning the rail's hover or selected token values.** The wash becoming visible (`## Expected Behaviour` row 7) may make the shipped `--ts-ui-rail-handle-selected-bg` values look worth adjusting. That is a theme decision for a separate change.
- **`Rail`'s own chrome, and the `.collapsed` handle-hiding path.** Untouched.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^probe-evidence]: The three per-instance rules were captured directly, not inferred: a throwaway Vitest probe in `packages/lib/tests/overlay/` primed the `.Button` class rules with one chromeful `Button`, then constructed and rendered two `RailHandle`s against `RecordingDOMSink`, dumping every `setRuleStyles` write. Each handle produced its own `#id.pressed` (`color`/`backgroundColor`/`backgroundImage`/`boxShadow`), its own bare `#id` (four border longhands, `boxShadow: none`, `backgroundImage: none`, `backgroundColor: transparent`, `borderRadius: null`), and its own `#id:hover:not(.selected)` (`backgroundColor: var(--ts-ui-rail-handle-hover-bg)`). Only `.RailHandle.selected:not(.pressed):not(:hover)` was shared. The probe file was deleted after the capture; it is not part of this plan's changes.

[^picker-is-the-precedent]: `PickerButton` is a closer match than `MenuBarButton` on every axis that matters: it is a `Button` subclass (not a factory function), it was chromeless by default rather than per call site, it has no per-instance chrome customisation from its owner, and it was fixed by the immediately preceding plan in this series rather than left deferred. `MenuBarButton` is still chromeless and still carries the `.pressed` duplicate — following it would mean copying an acknowledged unfixed shape. `WindowControlButton` is the right shape too but its values are themed fills rather than "no chrome", so `PickerButton`'s constant is the one that transfers literally.

[^selected-needs-three-keys]: `.Button:hover:not(.pressed)` is (0,2,0) and carries `background-color`, `background-image`, and `box-shadow`. On a handle that is both selected and hovered, `.RailHandle:hover:not(.pressed):not(.selected)` is guarded out, and `.RailHandle` (0,1,0) loses to it — so any key `.selected` does not declare falls to `Button`'s raised hover chrome. `.RailHandle.selected:not(.pressed)` at (0,3,0) covers all three only if the extract names all three. `ToggleButton`'s own `.selected` extract already names exactly these three keys for the same reason.

[^selected-wash-masked]: Confirmed from the probe in `[^probe-evidence]` plus a specificity read, not assumed. Every rendered handle carries `background-color: transparent` on its bare `#id` rule — written because `chromeless` calls `cacheStyleValue("backgroundColor", "transparent")` ([Button.ts:1075](packages/lib/src/typescript/lib/component/button/Button.ts#L1075)), and `flushStyleBag` then finds that instance value differs from `.Button`'s `var(--ts-ui-button-bg, transparent)` class-tier value and writes it for real, unrouted, because `isRestingChromeIsolated()` is false while isolation is suppressed. `setStyleState(".selected", …)` writes no CSS of its own ([Component.ts:5628](packages/lib/src/typescript/lib/core/Component.ts#L5628)) — it relies entirely on the class rule, whose (0,4,0) can never beat (1,0,0). The hover wash is unaffected today because it rides its own `#id:hover:not(.selected)` rule at (1,2,0), which does outrank the bare `#id`. The existing comment above `RailHandle.ownStyleStates` calls the guard ordering "moot for isolation purposes… but it lets `getBackgroundColor()` resolve `.selected`'s wash" — accurate about the JS-side getter, and consistent with the CSS side never having worked.
