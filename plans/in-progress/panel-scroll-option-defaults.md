# Panel scroll options honour subclass defaults — Implementation Plan

## Overview

A `Panel` subclass cannot configure `autoScroll`, `scrollShadows`, or `scrollbarStyle` through the subclass-defaults bag. The default is not ignored — it is overwritten with a hardcoded literal, producing a panel that silently does not scroll, with no error or warning.

`Component`'s constructor dispatches the **raw caller options** to `applyOptions` ([packages/lib/src/typescript/lib/core/Component.ts:523](packages/lib/src/typescript/lib/core/Component.ts#L523)); class defaults live in a separate `_defaultOptions` bag ([Component.ts:483](packages/lib/src/typescript/lib/core/Component.ts#L483)) that **getters** consult as a fallback. `Panel.applyOptions` breaks that contract at three sites — [Panel.ts:289](packages/lib/src/typescript/lib/core/Panel.ts#L289), [Panel.ts:299](packages/lib/src/typescript/lib/core/Panel.ts#L299), [Panel.ts:314](packages/lib/src/typescript/lib/core/Panel.ts#L314) — by always dispatching the setter with a literal fallback (`options.autoScroll ?? "none"`) that consults neither bag. `_defaultPanelOptions` ([Panel.ts:111](packages/lib/src/typescript/lib/core/Panel.ts#L111)) seeds only `tag` and `insets`, so there is nothing for the fallback to read even if it looked.

The fix keeps the always-dispatch behaviour — it is load-bearing, see [Panel.ts:177-182](packages/lib/src/typescript/lib/core/Panel.ts#L177) — and only changes where the fallback value comes from: the three literals move into `_defaultPanelOptions`, the three getters fold `_defaultOptions`, and each dispatch reads its fallback through its own getter. Four edits in one file, plus regression rows in the existing default-resolution registry.

---

## Architecture Decisions

### Fallback chain: defaults bag → folding getter → always-dispatch

Move the three literals (`autoScroll: "none"`, `scrollShadows: true`, `scrollbarStyle: "overlay"`) into `_defaultPanelOptions`. Fold that bag into the three getters (`return this._autoScroll ?? this._defaultOptions.autoScroll!;`). Dispatch each setter unconditionally as `this.setAutoScroll(options.autoScroll ?? this.getAutoScroll())`.

This is the shape [ARCHITECTURE.md](ARCHITECTURE.md) *Class-level defaults must survive the getter* prescribes, and the shape [`ToolBar.applyOptions`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L189) already uses for five fields with the same super-cascade constraint.[^shape]

The setters still fire on every construction, so the `declare`d backing fields are still seeded through the setter and the class-field super-cascade trap is still dodged.[^cascade] The fold is what makes the fallback resolve *during* that first dispatch, when the backing field is still `undefined`.

### The three `Panel` options are the whole scope

No other class in the library has this defect. `Panel.ts:289/299/314` are the only `applyOptions` sites that always-dispatch a setter with a hardcoded literal while a `_default*Options` bag exists to shadow.[^scope]

### Regression rows go in the existing default-resolution registry

The guard is [`packages/lib/tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts) — the registry ARCHITECTURE.md names as the mechanical check for this exact rule. Add a `ScrollingPanel` helper subclass plus rows for the three fields, and explicit-value/`clearAutoScroll` cases. The whole bug is reachable offline: the current code makes `new ScrollingPanel().getAutoScroll()` return `"none"` instead of `"y"` under the headless harness.[^offline]

### Not a breaking change

Nothing can depend on the broken path, and nothing in the library seeds these three keys in a defaults bag today.[^breaking] A bare `new Panel()` keeps resolving `"none"` / `true` / `"overlay"`, because the literals move into the defaults bag rather than disappearing.

---

## Public API

No signature changes. `PanelOptions`, the three setters, and the three getters keep their current types. What changes is the value the getters resolve when neither the caller nor a setter supplied one:

```typescript
// packages/lib/src/typescript/lib/core/Panel.ts
const _defaultPanelOptions: Partial<PanelOptions> = {
    tag:            "div",
    insets:         new Insets(4, 4, 4, 4),
    autoScroll:     "none",
    scrollShadows:  true,
    scrollbarStyle: "overlay",
};

getAutoScroll():     AutoScrollMode;   // this._autoScroll     ?? this._defaultOptions.autoScroll!
getScrollShadows():  boolean;          // this._scrollShadows  ?? this._defaultOptions.scrollShadows!
getScrollbarStyle(): ScrollbarStyle;   // this._scrollbarStyle ?? this._defaultOptions.scrollbarStyle!
```

---

## Implementation

The three dispatch sites in `Panel.applyOptions`. Only the fallback expression changes — the ordering, the surrounding `declare`-field seeding, and the comments above each line stay as they are (update only the wording that names the literal):

```typescript
this.setAutoScroll(options.autoScroll ?? this.getAutoScroll());          // was: ?? "none"
this.setScrollShadows(options.scrollShadows ?? this.getScrollShadows()); // was: ?? true
this.setScrollbarStyle(options.scrollbarStyle ?? this.getScrollbarStyle()); // was: ?? "overlay"
```

`clearAutoScroll()` ([Panel.ts:426](packages/lib/src/typescript/lib/core/Panel.ts#L426)) needs no change: it calls `setAutoScroll("none")`, which writes `"none"` into the backing field, and the fold sits over that field — so a cleared panel stays `"none"` and does not re-resolve a subclass default.

---

## Ordered Implementation Steps

1. **Write the failing tests first** in [`packages/lib/tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts):
   - Near the top, beside the existing `Defaulted` helper, add a helper subclass that seeds all three fields through `subclassDefaults`:
     ```typescript
     class ScrollingPanel extends Panel {
         constructor(options?: PanelOptions) {
             super(options, {
                 layoutManager:  new Fit(),
                 autoScroll:     'y',
                 scrollShadows:  false,
                 scrollbarStyle: 'native',
             } as Partial<PanelOptions>);
         }
     }
     ```
     Import `Panel`, `PanelOptions` from `~/core/Panel` and `Fit` from `~/layout/Fit`.
   - Add seven rows to the `DEFAULT_RESOLUTION` registry: `Panel autoScroll` → `'none'`, `Panel scrollShadows` → `true`, `Panel scrollbarStyle` → `'overlay'` (all three on a bare `new Panel({})`), and `ScrollingPanel autoScroll` → `'y'`, `ScrollingPanel overflowY` → `'auto'`, `ScrollingPanel scrollShadows` → `false`, `ScrollingPanel scrollbarStyle` → `'native'`.
   - Add four cases to the existing `describe('an explicit value wins over a class default')` block: a caller value overriding each of the three subclass defaults, a runtime `setAutoScroll('auto')` after construction, `clearAutoScroll()` resolving to `'none'`, and `(new ScrollingPanel() as any)._options.autoScroll` being `undefined`. The `## Expected Behaviour` tables give the exact expectations.
   → verify: `cd packages/lib && npx vitest run tests/component/default-options-fallback.test.ts` — the four `ScrollingPanel` registry rows **fail red** (`expected 'none' to be 'y'`, and likewise for the other three fields). The three bare-`Panel` rows pass both before and after the fix; that is expected, they pin the unchanged no-subclass behaviour.
2. **Seed the defaults bag** — in [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts#L111), add `autoScroll: "none"`, `scrollShadows: true`, `scrollbarStyle: "overlay"` to `_defaultPanelOptions` and re-align the value column.
3. **Fold the three getters** — `getAutoScroll` ([Panel.ts:416](packages/lib/src/typescript/lib/core/Panel.ts#L416)), `getScrollShadows` ([Panel.ts:454](packages/lib/src/typescript/lib/core/Panel.ts#L454)), `getScrollbarStyle` ([Panel.ts:488](packages/lib/src/typescript/lib/core/Panel.ts#L488)) each return `this._<field> ?? this._defaultOptions.<field>!`.
4. **Repoint the three dispatches** — replace the literal fallbacks at [Panel.ts:289](packages/lib/src/typescript/lib/core/Panel.ts#L289), [:299](packages/lib/src/typescript/lib/core/Panel.ts#L299), [:314](packages/lib/src/typescript/lib/core/Panel.ts#L314) with the getter calls shown in `## Implementation`. Leave the dispatch order and the `declare`-field seeding lines untouched.
   → verify: `grep -n 'options.autoScroll ?? "none"\|options.scrollShadows ?? true\|options.scrollbarStyle ?? "overlay"' packages/lib/src/typescript/lib/core/Panel.ts` — expect zero matches.
5. **Update the comments and JSDoc** that name the literal: the three `applyOptions` comments (say "the class default from `_defaultPanelOptions`" instead of "the `?? \"none\"` covers the no-option default"), and the three getter `@returns` lines, which currently read `"none" if never set` / `true unless explicitly disabled` / `"overlay" unless explicitly set to "native"` — each becomes "…or the class default when never set".
   → verify: `cd packages/lib && npx vitest run tests/component/default-options-fallback.test.ts` — all green.
6. **Full suite + typecheck** — `cd packages/lib && npx vitest run` (expect 212 files / 2618 tests green) and `npx tsc --noEmit -p tsconfig.json` (expect no new `src/typescript` errors; one pre-existing `AccordionDemoPanel.ts(302,13)` error is unrelated).
7. **Follow-up on `feature/packages-docs` — do this only after that branch has merged** (see `## Potential Challenges`). In [`packages/docs/src/shell/DocsContent.ts`](packages/docs/src/shell/DocsContent.ts): change the `super(options, { layoutManager: Fit() })` call at line 36 to `super(options, { layoutManager: Fit(), autoScroll: 'y' })`, and delete the six-line workaround comment plus the `this.setAutoScroll('y')` call at lines 40-46.
   → verify: `grep -rn 'panel-scroll-option-defaults' packages/docs/src/` — expect zero matches. Then the manual browser check below.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Panel.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/docs/src/shell/DocsContent.ts` (step 7 — on `feature/packages-docs`, after it merges) |

---

## Expected Behaviour

All rows below are unit-testable offline. `overflow-y` is the observable side effect of `setAutoScroll` and is readable via `getOverflowY()`.

`ScrollingPanel` is the test helper from step 1: a `Panel` subclass whose `subclassDefaults` are `{ autoScroll: 'y', scrollShadows: false, scrollbarStyle: 'native' }`.

| Construction | `getAutoScroll()` | `getOverflowY()` | Why |
|---|---|---|---|
| `new Panel({})` | `'none'` | `'hidden'` | no caller value, no subclass default → `_defaultPanelOptions` |
| `new Panel({ autoScroll: 'y' })` | `'y'` | `'auto'` | caller value |
| `new ScrollingPanel()` | `'y'` | `'auto'` | subclass default (**fails today — returns `'none'`**) |
| `new ScrollingPanel({ autoScroll: 'none' })` | `'none'` | `'hidden'` | caller beats subclass default |
| `new ScrollingPanel()` then `.setAutoScroll('auto')` | `'auto'` | `'auto'` | runtime setter beats both |
| `new ScrollingPanel()` then `.clearAutoScroll()` | `'none'` | `'hidden'` | clearing writes `'none'`; it does **not** re-resolve the subclass default |

Same precedence for the other two fields:

| Construction | `getScrollShadows()` | `getScrollbarStyle()` |
|---|---|---|
| `new Panel({})` | `true` | `'overlay'` |
| `new ScrollingPanel()` | `false` (**fails today — returns `true`**) | `'native'` (**fails today — returns `'overlay'`**) |
| `new ScrollingPanel({ scrollShadows: true, scrollbarStyle: 'overlay' })` | `true` | `'overlay'` |

Also required, and covered by the registry's existing conventions:

- A class default is never dispatched into `_options`: `(new ScrollingPanel() as any)._options.autoScroll` is `undefined`.
- No behaviour change for any panel that passes these options in the **caller** bag — every existing `new Panel({ autoScroll: 'auto' })` call site keeps its current result.

**Manual browser verification** (not reachable offline — the overlay scrollbar widgets and the shadow overlay are created at render):

1. Run the docs app (`npm run docs:dev`, http://localhost:5173) after step 7 and navigate to a page longer than the viewport.
2. The content pane scrolls, its element has `overflow-y: auto`, it has a `PanelOverlayScroller` child, and two `Scrollbar` children.
3. Run the demo app (`npm run dev`, http://localhost:8015) and open the `MiscPanel` autoScroll section — the `autoScroll` mode buttons and the "no shadows" panel behave exactly as before the change.

---

## Verification

- `cd packages/lib && npx vitest run tests/component/default-options-fallback.test.ts` — green, including the new rows.
- `cd packages/lib && npx vitest run` — 212 files / 2618 tests green (the counts on `master` before the change).
- `cd packages/lib && npx tsc --noEmit -p tsconfig.json` — no new `src/typescript` errors.
- `grep -rn '?? "none"\|?? "overlay"' packages/lib/src/typescript/lib/core/Panel.ts` — the only surviving matches are inside `setAutoScroll`'s `switch`/guard logic, not in `applyOptions`.
- Manual browser checks as listed in `## Expected Behaviour`.

---

## Documentation Impact

No public API change — no new or renamed exports, so no barrel, catalog, sidebar, or `packages/lib/llms.txt` edits. The published changelog ([`packages/lib/docs/reference/changelog.md`](packages/lib/docs/reference/changelog.md)) is release-scoped and gets no entry for this fix.

The only doc edits are the JSDoc `@returns` lines on the three getters (step 5). `PanelOptions`' own field docs already state the correct defaults (`"none"`, `true`, `"overlay"`) and stay as they are. Run `npm run docs:build` and confirm zero warnings — it needs ~5 GB of free RAM.

---

## Potential Challenges

- **The `declare` fields must stay bare.** `_autoScroll`, `_scrollShadows`, and `_scrollbarStyle` are `declare`d with no initialiser on purpose ([Panel.ts:177-182](packages/lib/src/typescript/lib/core/Panel.ts#L177)). Giving any of them a `= "none"`-style initialiser reintroduces the super-cascade bug this plan works around — the initialiser runs after `super()` and wipes the dispatched value.
- **Dispatch order is load-bearing.** `setScrollbarStyle` must keep running after `setAutoScroll` (its install path reads `_autoScroll`), and the `declare`-field seeding lines must keep running before their respective setters. Change only the fallback expressions.
- **Step 7 depends on an unmerged branch.** A three-branch stack (`feature/markdown-tables` → `feature/hash-router` → `feature/packages-docs`) is awaiting merge, and `packages/docs/src/shell/DocsContent.ts` only exists on the last of them. None of the three touches `Panel.ts`, `Component.ts`, or the registry test, so steps 1-6 are independent and can land on `master` first; step 7 waits for `feature/packages-docs`.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts) — the defaults bag (line 111), the `declare` field block and its comments (177-230), the constructor's defaults merge (256), `applyOptions` (268-317), the three getters (416 / 454 / 488).
- [`packages/lib/src/typescript/lib/component/menubar/ToolBar.ts`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts) — the precedent: always-dispatch through folding getters at lines 189-195, fold at 252-253.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — the two-bag contract (429-483) and the raw-options dispatch (523).
- [`packages/lib/tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts) — the registry and its helper-subclass convention.
- [ARCHITECTURE.md](ARCHITECTURE.md) — *Class-level defaults must survive the getter*.
- [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) — *Fields written during the `super()` cascade must use `declare`*.

---

## Non-Goals

- **No conversion to `if (options.x !== undefined)` gating.** The unconditional dispatch is what seeds the `declare`d fields; gating it would leave them `undefined`.
- **No change to `Panel`'s `flush` / `insets` handling.** Those already resolve correctly through the constructor's merge and `Component`'s folding `getInsets`.
- **No audit or change to the `?? <literal>` reads outside `applyOptions`** (e.g. `Slider.getMin`, `Video.getVolume`, `AjaxProxy`). Those are getter-side or non-`Component` defaults with no `_default*Options` bag to shadow; they are a different shape and are working as intended.
- **No new option or setter.** The fix is a fallback-source change inside existing methods.

---

## Implementation Notes

Steps 1-6 landed in commit `69c69084` — the failing-then-passing test, the defaults-bag seed, the folded getters, and the repointed dispatches. All green: the target test file, the full `packages/lib` suite (214 files / 2742 tests — higher than the plan's recorded 212/2618 baseline because master has advanced since this plan was written), and `tsc --noEmit` (same pre-existing errors as unmodified master, none new).

Step 7 (the `DocsContent.ts` follow-up) is deliberately **not** done yet and this plan file stays in `plans/in-progress/` rather than moving to `plans/implemented/`. This is an orchestrator-level scheduling choice, not a plan defect: `DocsContent.ts` is being rewritten in this same batch by `docs-content-migration` and `docs-typedoc-reference`, and landing step 7 now would just be rebase churn against a moving target. Step 7 will land as a small follow-up commit once those two plans settle `DocsContent.ts`'s shape, at which point this plan completes and moves to `plans/implemented/`.

## Notes

[^shape]: ARCHITECTURE.md's *Class-level defaults must survive the getter* offers two remedies — "fold it in the getter" and "always-dispatch" — and `Panel` needs both at once: the fold makes the value resolvable while the backing field is still `undefined`, and the always-dispatch makes the setter's construction-time side effects (the `overflow` writes, the layout-manager overflow flags, the overlay/shadow refresh) fire for a defaulted panel too. `ToolBar.applyOptions` is that exact combination, and its comment claims to mirror `Panel.setAutoScroll` — `ToolBar` implemented the idiom correctly and `Panel`, the class it cites, did not.
    The alternative shape reads the bag directly at the dispatch site — [`Text.ts:256`](packages/lib/src/typescript/lib/component/input/Text.ts#L256), `this.setTruncate(options.truncate ?? this._defaultOptions.truncate!)`, and [`AbstractWindow.ts:378`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L378) — and leaves the getter unfolded. It fixes construction just as well, but it leaves `getAutoScroll()` returning `undefined` for any future code path that reads the getter before the first dispatch, and it is the minority form (three sites versus roughly twenty using the getter). Rejected on both counts.
    Both candidate shapes were checked against the whole suite; the chosen one was applied experimentally on top of `master` and all 2618 tests passed.

[^cascade]: A class-field initializer runs *after* `super()` returns, while `Component`'s constructor calls `applyOptions` *inside* `super()`. So `private _autoScroll = "none"` would overwrite whatever the cascade-dispatched `setAutoScroll` had already written. The codebase's rule (CODE_CONVENTIONS.md, *Fields written during the `super()` cascade must use `declare`*) is to declare such fields bare with `declare` and let a setter seed them — which is why the dispatch cannot become conditional.

[^scope]: The search was `grep -rn "(options\.[A-Za-z]* ?? " packages/lib/src/typescript/lib/` filtered to `set*`/`apply*` call sites — 39 hits across `Text`, `Link`, `ToolBar`, `AbstractMarkerList`, `Button`, `AccordionHeader`, `SplitGutter`, `Rail`, `Popover`, `AbstractWindow`, `AnimatedDropdown`, `Drawer`, and `Panel`. Every one except `Panel`'s three either reads `this._defaultOptions.X!` directly or calls a getter that folds `_defaultOptions`. The single other literal is [`AccordionHeader.ts:125-126`](packages/lib/src/typescript/lib/component/container/AccordionHeader.ts#L125) (`options?.expanded ?? false`), which is not the same defect: `AccordionHeader` has no `_default*Options` bag, its constructor takes no `subclassDefaults` parameter, and nothing in the library extends it — so there is no default channel for the literal to shadow. The `?? <literal>` reads in `data/` (`Association`, `AjaxProxy`, `Field`) are not `Component`s and have no defaults bag at all.

[^offline]: Confirmed by running a throwaway test on unmodified `master` in a scratch worktree: a `Panel` subclass with `subclassDefaults` of `{ layoutManager: new Fit(), autoScroll: 'y' }` asserted `getAutoScroll() === 'y'` and failed with `expected 'none' to be 'y'`, while the sibling `layoutManager` assertion passed — the same split the manual browser observation showed. Applying the fix from this plan turned it green, and the full `packages/lib` suite (212 files, 2618 tests) stayed green.

[^breaking]: Three groups could in principle notice. (1) Consumers passing these options in the caller bag — unaffected, the caller value has always won and still wins. (2) Consumers relying on a subclass default — impossible, it never worked. (3) Consumers relying on the *overwrite*, i.e. code that seeds `autoScroll` in a `_default*Options` bag and depends on it being ignored — a grep for `autoScroll:` / `scrollShadows:` / `scrollbarStyle:` across `packages/lib/src/typescript` finds every occurrence in a caller options bag (`new Panel({ autoScroll: 'auto' })` or `super({ autoScroll: 'auto' })` as the *first* constructor argument), none in a defaults bag. The library ships no such consumer, and an external one would have written code whose stated intent the fix now honours.
