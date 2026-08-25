---
touches-shared:
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
  - packages/lib/src/typescript/lib/core/Component.ts
  - ARCHITECTURE.md
  - packages/lib/docs/reference/changelog/next.md
---

# DiagramNode `.selected` Border Colour via a `borderColor` Style-Bag Key — Implementation Plan

## Overview

Every `DiagramNode` writes the same `.selected` border colour onto its own per-instance CSS rule. The write is a single line in the constructor, [`DiagramNode.ts:111`](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts#L111): `this.selectedStyleRule.set("borderColor", "var(--ts-ui-accent-color, rgb(30, 100, 200))")`, landing on a `createStyleRule(".selected")` allocation — the raw per-instance escape hatch, not the layered style bag. The docs app's five leaf nodes therefore produce five byte-identical `#id.selected` rules, which the Style Audit overlay ranks as a duplicate-body group.

The node's own `ownStyleStates` entry already declares `.selected`, but extracts only `backgroundColor`. Its source comment ([`DiagramNode.ts:69-74`](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts#L69)) states why the border colour is left out: `borderColor` is a longhand no `StyleBag` key covers. That is accurate. [`StyleBag`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L40) carries `border`, which [`borderToStyle`](packages/lib/src/typescript/lib/primitive/Border.ts#L34) always expands to the four per-side longhands `borderTop`/`borderRight`/`borderBottom`/`borderLeft` — there is no key for the colour, width, or style sub-longhands.

This plan adds `borderColor` as a real `StyleBag` key, teaches the resting-isolation key set that the four side longhands cover it, and moves `DiagramNode`'s `.selected` border colour onto the shared class-tier rule the state mechanism already builds. The five per-instance rules become one process-wide rule.

---

## Architecture Decisions

### `borderColor` becomes a real `StyleBag` key

`StyleBag` gains `borderColor?: string | null`, with a matching `STYLE_WRITERS` entry and a line in `resolveDeclarations`. This is the same three-point addition [`plans/accordionheader-chrome-background-shorthand-dedup.md`](plans/accordionheader-chrome-background-shorthand-dedup.md) specifies for the `background` shorthand, and those three are the only places any `StyleBag` field is enumerated.[^three-points]

The state declares the colour longhand rather than a full `border` shorthand, so `.selected` recolours the resting border without restating its width or style.[^why-longhand]

`borderColor` gets no `ComponentOptions` field, no `Component` accessor, and no `applyChromeOptions` dispatch. Nothing outside a declared state needs to author it.[^no-accessor]

### `resolveDeclarations` emits `borderColor` after the `border` expansion

Within one rule body, the later declaration wins for the sub-properties two entries share. `border-top` sets a side's width, style *and* colour; `border-color` sets all four sides' colour. Emitting `borderColor` after the four side longhands is what makes the colour a refinement of the shorthand rather than something the shorthand wipes.

| `StyleBag` input | Declarations emitted, in order | Result |
|---|---|---|
| `{ border: "1px solid red" }` | `borderTop`, `borderRight`, `borderBottom`, `borderLeft` = `1px solid red` | 1px solid red |
| `{ borderColor: "blue" }` | `borderColor: blue` | colour only; width and style come from a lower tier |
| `{ border: "1px solid red", borderColor: "blue" }` | the four sides, **then** `borderColor: blue` | 1px solid blue |

### `restingIsolationKeys()` treats the four side longhands as covering `borderColor`

[`restingIsolationKeys()`](packages/lib/src/typescript/lib/core/Component.ts#L5619) adds `borderTop`, `borderRight`, `borderBottom`, and `borderLeft` to its returned set whenever that set already contains `borderColor`. Without that, an instance-level `setBorder(...)` would write the four side longhands to the bare `#id` rule, whose `(1,0,0)` specificity outranks the class-tier `.DiagramNode.selected` rule's `(0,2,0)` — and the selection colour would silently stop painting on exactly the nodes a consumer customised.[^side-longhand-isolation]

The cascade, for the three cases that exist after this change:

| Instance | Rules matching while `.selected` is on | Painted border |
|---|---|---|
| Stock `DiagramNode` | `.DiagramNode` (sides = `1px solid var(--ts-ui-border-color, …)`), `.DiagramNode.selected` (`border-color: accent`) | 1px solid accent |
| `new DiagramNode({ border: "2px dashed red" })`, selected | the two above; `#id:not(.selected)` is guarded out | 1px solid accent |
| the same node, not selected | `.DiagramNode`, `#id:not(.selected)` (sides = `2px dashed red`) | 2px dashed red |

Row two is a behaviour change: today that node paints 2px dashed *accent* while selected. The change is recorded in `## Expected Behaviour` row 10 and in the changelog.

### `Button` is not touched

`Button`'s `.pressed` extract is partial too, but for an unrelated reason: it omits `pressedBorder` and `pressedBorderRadius`, and `border` and `borderRadius` are both already `StyleBag` keys. No key is missing there, so this plan's addition does nothing for `Button`.[^button-not-affected]

---

## Internal Structure

### `core/ClassStyleRules.ts`

`StyleBag` gains `borderColor` immediately after `borderRadius` ([line 56](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L56)) and before `border`:

```typescript
    /** CSS `border-color`. A refinement of `border`, not an alternative to
     *  it: a bag may declare both, and `resolveDeclarations` emits this one
     *  after `border`'s four side longhands so the colour wins while the
     *  shorthand's width and style survive. */
    borderColor?:     string | null;
```

`STYLE_WRITERS` gains the matching entry beside `borderRadius` ([line 295](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L295)). The entry is required, not optional: the table is typed `{ [K in keyof StyleBag]-?: … }`, so a missing writer fails `npm run typecheck`.

```typescript
    borderColor:     (v) => ({ borderColor: v ?? null }),
```

`resolveDeclarations` gains one line, placed **after** the `if (border) { … }` block that ends at [line 246](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L246) and before the `const font = defaults.font;` line:

```typescript
    // After the border expansion, never before: `borderToStyle` writes each
    // side's colour as part of its shorthand, so an earlier `borderColor`
    // would be overwritten instead of refining it.
    if (defaults.borderColor) declarations.borderColor = defaults.borderColor;
```

Nothing else in this file changes. `borderColor` belongs in neither `SKIP_ON_MATCH_KEYS` ([`Component.ts:386`](packages/lib/src/typescript/lib/core/Component.ts#L386)) nor `FRAMEWORK_BASELINE_KEYS` ([`Component.ts:407`](packages/lib/src/typescript/lib/core/Component.ts#L407)): like `backgroundColor` and `shadow`, it appears in a resolved bag only when a class or a state explicitly declares one, which is the condition those two sets exclude.

### `core/Component.ts`

```typescript
    protected restingIsolationKeys(): ReadonlySet<string> {
        const keys = new Set<string>();

        for (const state of resolveStyleStates(this.constructor)) {
            for (const key of Object.keys(state.layer.resolved)) {
                keys.add(key);
            }
        }

        // Each side longhand carries that side's colour, so a bare
        // `#id { border-top: … }` would outrank a state rule declaring
        // `border-color`. Isolate all four whenever a declared state
        // touches the colour.
        if (keys.has("borderColor")) {
            keys.add("borderTop");
            keys.add("borderRight");
            keys.add("borderBottom");
            keys.add("borderLeft");
        }

        return keys;
    }
```

### `component/diagram/DiagramNode.ts`

A second module constant joins the existing one, and the existing one's doc comment loses its stale second sentence — after this change the constructor writes no style at all:

```typescript
/** `.selected`'s background-color declaration. */
const DIAGRAM_NODE_SELECTED_BACKGROUND_COLOR = "var(--ts-ui-diagram-node-selected-bg, var(--ts-ui-table-row-selected, rgba(30, 100, 200, 0.15)))";

/** `.selected`'s border-color declaration. Recolours the resting border,
 *  leaving `_defaultDiagramNodeOptions.border`'s width and style intact. */
const DIAGRAM_NODE_SELECTED_BORDER_COLOR = "var(--ts-ui-accent-color, rgb(30, 100, 200))";
```

The state declaration extracts both, and its comment is rewritten to describe what now happens:

```typescript
    // Declares `.selected` so `styleLayers()`/`restingGuardSuffix` know
    // about it — see `Button`'s `ownStyleStates` for the full mechanism.
    // Both declarations hoist onto the shared `.DiagramNode.selected` rule.
    // The state declares the `borderColor` longhand rather than the `border`
    // shorthand so it recolours the resting border without restating its
    // width or style.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".selected",
            extract:  (): StyleBag => ({
                backgroundColor: DIAGRAM_NODE_SELECTED_BACKGROUND_COLOR,
                borderColor:     DIAGRAM_NODE_SELECTED_BORDER_COLOR,
            }),
        },
    ];
```

Four things are deleted: the constructor's `this.selectedStyleRule.set(...)` line ([line 111](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts#L111)), the `_selectedStyleRule` field and its `selectedStyleRule` getter ([lines 91-96](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts#L91), comment block included), and the now-orphaned `import { StyleRule } from "~/core/StyleTarget.js";` ([line 9](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts#L9)). Nothing else in the file references any of them.

---

## Ordered Implementation Steps

1. **Write the mechanism tests first.** Create `packages/lib/tests/core/BorderColorStyleBag.test.ts` covering `## Expected Behaviour` rows 1-4. Use locally-declared, uniquely-named `Component` subclasses and copy the `installTestDOM` / `declarationsDuring` / `idSelector` helpers from `packages/lib/tests/core/RestingChromeIsolation.test.ts`.
   *Check:* `npx vitest run tests/core/BorderColorStyleBag.test.ts` from `packages/lib` — every row fails, and row 1 fails at compile time because `borderColor` is not a `StyleBag` key.

2. **`core/ClassStyleRules.ts`** — add the `StyleBag` field, the `STYLE_WRITERS` entry, and the `resolveDeclarations` line, exactly as `## Internal Structure` gives them. The `resolveDeclarations` line goes after the `if (border) { … }` block, not before it.
   *Check:* `npm run typecheck`; `npx vitest run tests/core/BorderColorStyleBag.test.ts` — rows 1 and 2 green, rows 3 and 4 still red.

3. **`core/Component.ts`** — add the `borderColor` widening branch to `restingIsolationKeys()`.
   *Check:* `npx vitest run tests/core/BorderColorStyleBag.test.ts tests/core/RestingChromeIsolation.test.ts` — all green, `RestingChromeIsolation.test.ts` unmodified.

4. **Write the component tests.** Create `packages/lib/tests/component/diagram/DiagramNode.selectedStateDedup.test.ts` covering rows 5-8, following `packages/lib/tests/component/diagram/DiagramNode.test.ts`'s existing setup block. Import `_ruleCacheHas` from `~/core/StyleTarget` for the "no per-instance rule" assertion, as `tests/core/StyleStates.test.ts` does.
   *Check:* `npx vitest run tests/component/diagram/DiagramNode.selectedStateDedup.test.ts` — row 5 fails; rows 6, 7, and 8 already pass, since today's border colour sits on `#id.selected` rather than on the bare `#id` rule.

5. **`component/diagram/DiagramNode.ts`** — add `DIAGRAM_NODE_SELECTED_BORDER_COLOR`, extend the `.selected` extract, rewrite the two comments, and delete the constructor write, the `_selectedStyleRule` field, the `selectedStyleRule` getter, and the `StyleRule` import. Per `## Internal Structure`.
   *Check:* `npm run typecheck`; `grep -n 'StyleRule\|createStyleRule' packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts` — zero matches; `npx vitest run tests/component/diagram/` — green.

6. **Full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`.

7. **`ARCHITECTURE.md`** — extend the *Component CSS tiers and state-rule dedup* section per `## Documentation Impact`.

8. **Changelog entries** in `packages/lib/docs/reference/changelog/next.md`. Per `## Documentation Impact`.
   *Check:* `npm run docs:api` — zero warnings.

9. **Verify live in a browser.** See `## Verification`. Non-negotiable: the offline harness records writes, it does not run a cascade, and rows 9-11 are cascade outcomes.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Create | `packages/lib/tests/core/BorderColorStyleBag.test.ts` |
| Create | `packages/lib/tests/component/diagram/DiagramNode.selectedStateDedup.test.ts` |

---

## Expected Behaviour

Rows 1-8 are unit-testable with the existing `installTestDOM` / `RecordingDOMSink` harness. Rows 9-11 need a browser.

| # | Case | Expected |
|---|---|---|
| 1 | A probe class whose `ownStyleStates` declares `.selected` with `extract: () => ({ borderColor: "rgb(1, 2, 3)" })`; one instance rendered | The class-tier `.ProbeName.selected` rule carries `borderColor: rgb(1, 2, 3)` |
| 2 | A probe class whose `ownClassStyleDefaults` is `{ border: "1px solid red", borderColor: "blue" }`, rendered | Its `.ProbeName` rule carries the four side longhands *and* `borderColor: blue`, with `borderColor` appearing after `borderTop` in the written declaration order |
| 3 | The row-1 probe instance calls `setBorder("2px dashed red")` after render | The four side longhands land on `#id:not(.selected)`; the bare `#id` rule gets none of them |
| 4 | A probe whose only declared state extracts `{ backgroundColor: "red" }` (no `borderColor`) calls `setBorder("2px dashed red")` after render | The four side longhands land on the bare `#id` rule — no spurious isolation widening |
| 5 | Two `DiagramNode`s rendered | `.DiagramNode.selected` carries both `backgroundColor` and `borderColor`; neither node has an `#id.selected` rule at all (`_ruleCacheHas` reports false for both) |
| 6 | A rendered `DiagramNode`'s own `#id` rule, after construction | Carries no real `borderColor` declaration |
| 7 | `node.setSelected(true)` on a rendered node | Adds the `selected` DOM class token and writes no CSS-rule declaration of its own; `isSelected()` returns `true` |
| 8 | `new DiagramNode({ label: "x" }).getBorder()` | Unchanged — `"1px solid var(--ts-ui-border-color, rgb(180, 180, 180))"` |
| 9 | Docs app **Diagram** tab: click a node, under Classic, Modern, and Dark themes | The selected node's border paints the accent colour at 1px solid, and its background paints the selected tint — pixel-identical to before |
| 10 | A node built as `new DiagramNode({ label: "x", border: "2px dashed red" })`, selected | Paints **1px solid accent** while selected and 2px dashed red when deselected. This differs from today, which paints 2px dashed accent while selected |
| 11 | Docs app **Style Audit** tab, after visiting the Diagram tab | No ranked duplicate-body row names `DiagramNode` |

Row 5's `.DiagramNode.selected` rule content, exactly:

| Declaration | Value |
|---|---|
| `background-color` | `var(--ts-ui-diagram-node-selected-bg, var(--ts-ui-table-row-selected, rgba(30, 100, 200, 0.15)))` |
| `border-color` | `var(--ts-ui-accent-color, rgb(30, 100, 200))` |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants:

- `grep -n 'StyleRule' packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts` — zero matches.
- `grep -n 'borderColor' packages/lib/src/typescript/lib/core/ClassStyleRules.ts` — four matching lines: the `StyleBag` field, the `STYLE_WRITERS` entry, the `resolveDeclarations` statement, and the comment above it.
- `grep -n 'borderColor' packages/lib/src/typescript/lib/core/Component.ts` — one match, the `restingIsolationKeys()` guard.

**Manual browser verification (rows 9-11) is required.** Start a dev server from *this worktree* on a spare port (`npm run dev`, default port 8015 — do not reuse a server the user already has running), then:

1. Open the **Diagram** tab. Click each of the five leaf nodes in turn and read the selected node's **computed** `border-top-color` and `background-color` rather than judging from a screenshot. Repeat under all three themes.
2. Open the **Style Audit** tab and confirm no duplicate-body row names `DiagramNode`.

---

## Documentation Impact

No exported symbol is added, removed, or renamed. `StyleBag` lives in `core/ClassStyleRules.ts`, which `core/index.ts` does not re-export, and `restingIsolationKeys` is `protected`. `packages/lib/docs/components/DiagramView.md` describes the `.selected` state only as "a themed `.selected` state" and needs no change.

- **`ARCHITECTURE.md`, *Component CSS tiers and state-rule dedup*** (the paragraph at line 284, which describes `restingIsolationKeys`) — add one sentence: the four `border{Top,Right,Bottom,Left}` longhands join the isolation set whenever a declared state carries `borderColor`, since each side longhand also sets that side's colour and a bare `#id` write would otherwise outrank the state's rule.
- **`next.md`, `## Changed` → `### Core`** (the block beginning at line 261) — `borderColor` is now a style-bag key, so a class's declared toggle state can recolour a border without restating its width and style. A state that declares it also isolates the four per-side border longhands from the resting tier.
- **`next.md`, `## Changed` → `### Components`** (the block beginning at line 317) — a selected `DiagramNode` built with a caller-supplied `border` now paints that border's *colour* from the selection accent and its width and style from the class default, rather than the caller's width and style with the accent colour. Only a consumer who overrides `border` on a `DiagramNode` is affected; a stock node is unchanged.
- **`next.md`, `## Fixed` → `### Components`** (the block beginning at line 183) — every `DiagramNode` now shares one CSS rule for its `.selected` border colour instead of writing an identical per-instance rule. Nothing changes visually for a stock node; no consumer action is needed.

---

## Potential Challenges

- **A pre-existing test asserts a real `borderColor` declaration on a `DiagramNode`'s own `#id.selected` rule.** Step 6's full-suite sweep catches it; the fix is to re-target the assertion at `.DiagramNode.selected`.
- **Row 2's declaration-order assertion depends on object key order surviving to the sink.** It does today — `resolveDeclarations` builds one object in statement order, `deviationsFrom` copies it key by key, and `StyleRule.flushDirty` passes the accumulated object straight to `setRuleStyles`. If a future change sorts keys anywhere on that path, row 2's *painted* outcome still needs row 9's browser check, which is where the real guarantee lives.
- **`.DiagramNode.selected` is class-tier state, so it is created once per process and survives `DOM.reset()`.** Every probe class in the new test files needs a name unique across its whole file, and the `DiagramNode` assertions must account for a rule an earlier test in the same file already warmed up — the convention `tests/core/StyleStates.test.ts` documents at its head.
- **`borderSideWidth` returns `0` for a `var(...)` value**, so a node's `getBorderSize()` estimate is `0` before render. Unchanged by this plan — the same `var()` values reach the same parser — so no assertion should be written against it.

---

## Critical Files

| File | Why |
|---|---|
| `plans/accordionheader-chrome-background-shorthand-dedup.md` | The precedent this plan mirrors: the same three-point `StyleBag` addition plus a `restingIsolationKeys()` shorthand-coverage rule |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `StyleBag` (40), `resolveDeclarations` (204), `STYLE_WRITERS` (276), `resolvePartialDeclarations` (353), `deviationsFrom` (475), `resolveClassLevel` (526), `resolveStateLevels` (696), `restingGuardSuffix` (864), `ensureClassStyleRule` (906) |
| `packages/lib/src/typescript/lib/core/Component.ts` | `SKIP_ON_MATCH_KEYS` (386), `FRAMEWORK_BASELINE_KEYS` (407), `applyChromeOptions` (843), `flushStyleBag` (5395), `restingIsolationKeys` (5619), `restingStyleRule` (5636), `writeGuardedCSSRule` (5719) — whose doc comment names the escape-hatch class this plan removes one user of |
| `packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts` | The class being changed; its lines 69-74 comment states the gap this plan closes |
| `packages/lib/src/typescript/lib/primitive/Border.ts` | `borderToStyle` (34) — the total, four-side expansion that shows `borderColor`/`borderWidth`/`borderStyle` are all absent from `StyleBag` today |
| `packages/lib/src/typescript/lib/component/button/Button.ts` | `ownStyleStates` (394) and the `pressedBorder` dispatch (1118) — why `Button` is out of scope |
| `plans/implemented/class-hierarchy-cascade.md` | The `ownClassStyleDefaults` / `ownStyleStates` mechanism `DiagramNode`'s state registers into |
| `packages/lib/tests/core/RestingChromeIsolation.test.ts` | The probe-class conventions and helpers the new mechanism test copies |
| `packages/lib/tests/core/StyleStates.test.ts` | `_ruleCacheHas` usage and the module-state caveat for class-tier rules |

---

## Non-Goals

- **Adding `borderWidth` and `borderStyle` as `StyleBag` keys.** They are missing for the same reason `borderColor` was, but no declared state authors either one, and a key with no writer of its own is speculative surface. Adding one later is the same three-point change this plan performs.
- **Fixing `Button`'s partial `.pressed` extract.** It omits `pressedBorder` / `pressedBorderRadius` because `_defaultButtonOptions` declares neither, not because a key is missing — `border` and `borderRadius` are both already `StyleBag` keys. Giving those two fields class-level defaults is a Button chrome decision with its own visual consequences, unrelated to this finding.
- **Adding `borderColor` to `resolveInstanceStyleDeclarations`** ([`Component.ts:317`](packages/lib/src/typescript/lib/core/Component.ts#L317), the `styleGroup` sharing bag). That bag is a deliberately fixed subset; widening it is a separate decision about style-group scope.
- **Adding a `borderColor` option, accessor, or `applyChromeOptions` dispatch to `Component`.** Nothing outside a declared state authors the key.
- **Any other Style Audit duplicate.** Out of scope for this round.
- **Bumping the package version.** Release-time bookkeeping.

---

## Implementation Notes

The code and tests match the plan's design exactly, with no deviation from
`## Internal Structure` or `## Architecture Decisions`.

**Manual verification (`## Verification`'s required browser check, `##
Expected Behaviour` rows 9-11) was performed** against a dev server started
from this worktree (`npx vite --port 8021` from `packages/lib`), driven live
through `chrome-devtools` MCP tools, covering the demo app's **Diagram** tab
(five leaf nodes: Start, Process, Validate, Database, Done — `Pipeline` is a
container, not a leaf) across all three shipped themes:

- **Row 9.** With "Start" selected, `getComputedStyle(...)` on its
  `.DiagramNode` element read `border-top-color: rgb(30, 100, 200)` (the
  `--ts-ui-accent-color` fallback — the token itself is unset in this dev
  harness in every theme) and `background-color: rgba(30, 100, 200, 0.15)`
  under the default (modern) and classic themes, and `rgba(30, 100, 200,
  0.25)` under dark (the theme's own `--ts-ui-table-row-selected` alpha) —
  in every theme, `border-top-style`/`-width` stayed `solid`/`1px`, matching
  `_defaultDiagramNodeOptions.border`. The four unselected leaves read
  `border-top-color: rgb(0, 0, 0)` in modern/classic and `rgb(90, 90, 90)`
  in dark (the `--ts-ui-border-color` token's per-theme resolution,
  unaffected by this plan) with no background tint. Clicking "Process"
  (still under dark) moved the accent border and selected tint onto
  "Process" and reverted "Start" to its resting values, confirming the
  shared `.DiagramNode.selected` rule tracks the live selection rather than
  being pinned to whichever node rendered first.
- **Row 10.** A node was constructed live in the page console —
  `new DiagramNode({ label: "custom", border: "2px dashed red" })` — mounted
  via `DOM.sink.appendChild(DOM.source.intern(document.body), node.getElement(true))`
  since it wasn't parented into the mounted `DiagramView` tree, and read with
  the same `readState` helper across a `setSelected(true)`/`setSelected(false)`
  cycle. Resting: `border-top-color: rgb(255, 0, 0)`, `-style: dashed`,
  `-width: 2px` — the caller's override, untouched. Selected: `border-top-color:
  rgb(30, 100, 200)`, `-style: solid`, `-width: 1px` — the class default's
  width/style with only the colour swapped to the accent, exactly the row's
  "1px solid accent" claim and the `## Architecture Decisions` cascade
  table's row two. Deselecting reverted to the caller's `2px dashed red`
  exactly. The probe node was removed from the DOM afterward; it isn't part
  of the demo app.
- **Row 11.** The Style Audit tab's ranked duplicate-rule table was scanned
  (`document.body.textContent`) for `"DiagramNode"` after visiting the
  Diagram tab and clicking "Refresh" — no match, confirming no `DiagramNode`
  duplicate-body row exists.

---

## Notes

[^three-points]: Grepping an existing `StyleBag` field (`borderRadius`) across `packages/lib/src` finds it in exactly three mechanism sites: the interface (`ClassStyleRules.ts:56`), `resolveDeclarations` (`:237`), and `STYLE_WRITERS` (`:295`). Every other hit is either a consumer-facing `ComponentOptions` field with its own accessor and `applyChromeOptions` dispatch in `Component.ts`, or a class's own defaults bag. `resolvePartialDeclarations`, `deviationsFrom`, `classDeviations`, and `resolveClassLevel` are all generic over key names and need no edit. `SKIP_ON_MATCH_KEYS` and `FRAMEWORK_BASELINE_KEYS` in `Component.ts` are hand-kept sets, but both exclude exactly the conditionally-present keys `borderColor` joins.

[^why-longhand]: The alternative is to leave `StyleBag` alone and have `.selected`'s extract return the existing `border` key — `{ border: "1px solid var(--ts-ui-accent-color, …)" }`. That needs no framework change at all, and the four side longhands it expands to would join the isolation set on their own, producing the same cascade outcome this plan's `## Architecture Decisions` table shows. It is rejected on two counts. First, it copies `1px solid` out of `_defaultDiagramNodeOptions.border` into a second constant, so a future change to the node's resting border width silently stops applying while selected. Second, it leaves the gap open: `writeGuardedCSSRule`'s own doc comment (`Component.ts:5707-5714`) already names "a shorthand no `StyleBag` key covers" as a standing escape hatch, and the next state that wants to recolour a border reproduces this same audit finding. A colour-only longhand is also the more accurate statement of the intent — `.selected` is a recolour, not a re-border.

[^no-accessor]: `StyleBag` is typed structurally and independently of `ComponentOptions` (see its own doc comment at `ClassStyleRules.ts:32-39`), so a key with no matching option is well-formed. The practical consequence is that only `ownClassStyleDefaults` and a state's `extract` can author `borderColor` — a flat class's `_defaultOptions` cannot, because no such option exists to put there. That is exactly the reach this plan needs, and it keeps the public API unchanged.

[^side-longhand-isolation]: The competing specificities are `#id` at `(1,0,0)`, `#id.selected` at `(1,1,0)`, `.DiagramNode.selected` at `(0,2,0)`, and `.DiagramNode` at `(0,1,0)`. Today's per-instance `#id.selected` rule sits above every instance write, so a caller-supplied `border` and the accent colour compose: 2px dashed accent. Moving the colour to the class tier drops it below `#id`, so one of the two must give. Without the isolation widening the accent loses outright and the node shows no selection feedback at all — the worse failure, since it is silent and defeats the feature. With it, the node's selection stays visible and only the caller's width and style are suspended while selected, which is the same trade every isolated resting-chrome property already makes (a `Button`'s `setBackgroundColor` is likewise suspended while `.pressed`). The widening fires only for a class whose declared states carry `borderColor`, which after this plan is `DiagramNode` alone, so the blast radius is that one class.

[^button-not-affected]: `ButtonOptions` declares `pressedBorder?: BorderOptions | string` and `pressedBorderRadius?: string` (`Button.ts:106-107`), and `applyChromeOptions` dispatches both caller-gated (`Button.ts:1118-1119`) with the comment "the pressed/hover border fields are not defaulted, so they stay caller-gated". `_defaultButtonOptions` sets `pressedForegroundColor`, `pressedBackgroundColor`, `pressedBackgroundImage`, and `pressedShadow` — the exact four the extract reads — and no border field. So the extract omits them because there is no class-level value to hoist, not because `StyleBag` lacks a key. `DiagramNode`'s source comment claims its own omission "mirrors `Button`'s partial `.pressed` extract"; the two omissions look alike and have different causes, which is why the comment is rewritten rather than kept.
