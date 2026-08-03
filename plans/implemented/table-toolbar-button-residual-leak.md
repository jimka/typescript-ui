# Tab Close-Button Residual Stylesheet-Rule Leak — Implementation Plan

## Overview

`plans/implemented/table-tab-close-residual-leak.md` cut SQLAdmin's measured per-cycle leak on a closed 20-column table tab from 78 rules to ~72–73, and named `Button`'s own hover-tooltip attachment and a leftover app-side `PanelDisposers` registry as the two standing, unverified hypotheses for the rest. This plan tests both directly against the library's own offline harness and refutes both:

- **`Button`'s `Tooltip.attach` call does not leak a stylesheet rule**, hovered or not. A `Button` nested three levels deep (`Dock` → tab content `Container` → `ToolBar` → `Button`), including one that had `Tooltip.show()` invoked against it before teardown, disposes with zero residual rules when the tab closes exactly once.[^repro-a]
- **SQLAdmin's `PanelDisposers` registry never touches the table tab's panel at all.** `SqlAdminController.openTable` calls `openAsyncPanel` without `disposeOnClose: true`, so the built `TableWorkPanel` is never registered with `_panelDisposers` — `settle` only registers when its `token` is non-null, and `openTable`'s call passes none. There is no second owner to race with the library's own tab-close teardown for this panel.[^paneldisposers-check]

The real defect is neither: **closing a `Dock` tab strands its own tab-strip button's overlaid close (✕) affordance.** [`TabButton`](packages/lib/src/typescript/lib/component/button/TabButton.ts) builds a [`TabCloseButton`](packages/lib/src/typescript/lib/component/button/TabCloseButton.ts) in its constructor and raw-appends it onto its own element (`packages/lib/src/typescript/lib/component/button/TabButton.ts:189`) rather than registering it via `addComponent` — the standard overlay pattern the file's own doc comment names.[^raw-append-doc] `TabButton` declares no `destructor()` override, so `Component.destructor()`'s child recursion, which only walks `_components`, never reaches `_closeButton`. Every `Dock` tab is closeable by default (`packages/lib/src/typescript/lib/overlay/Dock.ts:648-649`), so this fires on essentially every real tab close. A minimal, standalone reproduction — `new TabButton('A', { closeable: true })`, render, `destructor()` — confirms it directly: the close button's own rule (base + `:hover` + `:active`) and its own `Glyph` child's rule both survive.[^direct-repro]

This is the exact defect class `plans/implemented/table-tab-close-residual-leak.md` fixed for `Menu`: a raw-appended, never-registered child that its owner must dispose explicitly in its own `destructor()`. The fix here follows the same established pattern, this time inside `TabButton`.

---

## Architecture Decisions

### `TabButton` disposes its overlaid close button explicitly in its own `destructor()`

`_closeButton` is raw-appended (`DOM.sink.appendChild`), never a registered child, so it can never be reached by `super.destructor()`'s recursion. `TabButton` gets its first `destructor()` override, disposing `_closeButton` before deferring to the base class — the same one-line, null-guarded shape `SplitGutter._collapseButton` and `MenuButton._menu` already use.[^splitgutter-precedent]

---

## Internal Structure

```typescript
// packages/lib/src/typescript/lib/component/button/TabButton.ts — new override,
// placed after the constructor (ends line 101) and before applyTabStyling (line 110)

/**
 * Disposes the overlaid close button, then runs the inherited teardown.
 * `_closeButton` is raw-appended onto this button's own element rather than
 * registered via `addComponent` (see `buildCloseButton`'s doc comment), so
 * `super.destructor()`'s child recursion cannot reach it.
 */
protected destructor(): void {
    this._closeButton?.dispose();

    super.destructor();
}
```

---

## Ordered Implementation Steps

**Baseline first.** In `packages/lib`, run `npm run test` and confirm it is green (268 test files / 3744 tests at the time this plan was written) — this is the pre-existing suite left by `table-scroll-recycling-cost`, and it must stay green throughout.

1. `packages/lib/src/typescript/lib/component/button/TabButton.ts` — add the `destructor()` override from `## Internal Structure`, placed between the constructor (line 101) and `applyTabStyling` (line 110).

2. `packages/lib/tests/component/button/TabButton.styleRuleDisposal.test.ts` (new) — mirror `tests/overlay/Menu.styleRuleDisposal.test.ts`'s shape (header comment naming the defect and this plan, `installTestDOM`/`DOM.reset()` harness, a warm-up pass, then a before/after `_ruleCacheKeys()` diff):
   - Warm-up: build a closeable `TabButton`, render it (`getElement(true)`), `dispose()` it — keeps any process-global rule (e.g. the shared `.ts-ui-component` rule) out of the diff.
   - Snapshot `before = new Set(_ruleCacheKeys())`.
   - Build a second closeable `TabButton`, render it, read `getCloseButton()!.getId()`, and assert that id already appears in `_ruleCacheKeys()` — the sanity check that the close button really materialised a rule, mirroring the Menu test's submenu sanity check.
   - Call the button's `destructor()` directly (via `as unknown as { destructor(): void }`, matching `Dock.styleRuleDisposal.test.ts`'s `destroy()` helper), then assert `_ruleCacheKeys().filter(key => !before.has(key))` is `[]`.

3. `packages/lib/tests/component/dispose-full-teardown.test.ts` — add one new registry row, placed after the `Link` row (line 223) and before the `TabBar` row (line 224):
   ```typescript
   {
       name: 'TabButton',
       make: () => {
           const button = new TabButton('Home', { closeable: true });

           button.getElement(true);

           return button;
       },
   },
   ```
   No `ownIds` override is needed — the row's default full-diff check is sufficient, matching the `MenuButton` / `SplitButton` rows. Add the import: `import { TabButton } from '~/component/button/TabButton';`.

4. Same file — extend the existing `TabBar` row (lines 224-255) to exercise a closeable entry, so the realistic `Dock`-facing path (`TabBar.createBarEntry` → `removeBarEntry` → `entry.button.dispose()`) is also guarded, not just the standalone `TabButton` case:
   - Change `bar.createBarEntry('a', 'Alpha')` to `bar.createBarEntry('a', 'Alpha', { closeable: true })`.
   - Extend `ownIds` to also collect the entry's close button as an extra subtree: read `entry.button.getCloseButton()` (cast `_entries` to `Array<{ button: { getCloseButton(): Component | null } }>`, matching the file's existing loose-cast idiom) and append it, filtered non-null, to the `extraSubtrees` array passed to `collectIds`.

5. Regression checkpoint: `grep -n 'protected destructor' packages/lib/src/typescript/lib/component/button/TabButton.ts` — one hit. `grep -rn '^\s*protected destructor(' packages/lib/src/typescript/lib | wc -l` — 36 (was 35 before this plan).

6. `packages/lib/docs/reference/changelog/0.4.1.md` — add a bullet under `## Fixed` → `### Layout`, immediately after the existing "A closed tab no longer strands its content's — or its own strip button's — stylesheet rules on the shared sheet" bullet:
   > **A closed tab's own ✕ close affordance still stranded its stylesheet rules even after the fix above.** The strip button itself was disposed correctly, but its overlaid close button — never a registered child — was not. `TabButton` now disposes it explicitly on teardown. No consumer action is needed.

7. Run the full `## Verification` list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Create | `packages/lib/tests/component/button/TabButton.styleRuleDisposal.test.ts` |
| Modify | `packages/lib/tests/component/dispose-full-teardown.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/0.4.1.md` |

---

## Expected Behaviour

All cases are unit-testable under the offline harness (`installTestDOM` + the modelled DOM; no real geometry, hover, or focus needed — Button eagerly allocates its `:hover` / `:active` state rules at render time, confirmed directly: a freshly-rendered, never-interacted `TabCloseButton` already has all three rules in `_ruleCacheKeys()`).

- **A closeable `TabButton`, rendered and then disposed directly, leaves no trace of its close button or the close button's own children.** No id belonging to the `TabCloseButton` (or its own `Glyph` icon) remains in `_ruleCacheKeys()`.
- **A non-closeable `TabButton` (`closeable` omitted or `false`) disposes exactly as before.** `_closeButton` is `null`, so the new `?.dispose()` call is a no-op — no regression for the common case.
- **A `TabBar` entry created with `{ closeable: true }`, then disposed via the bar's own `dispose()` (not `removeBarEntry`), leaves nothing behind either.** Covers the base-class recursion path (`TabBar.destructor()` → `_tabClip`'s registered child → `TabButton.destructor()` → the new override) as well as the direct `entry.button.dispose()` path `removeBarEntry` already used.
- **Every other `TabButton` teardown behaviour is unchanged.** The existing `tests/component/button/TabButton.test.ts` suite (selection state, close-affordance presence) passes unmodified.

No case here needs manual/browser verification — the defect and the fix are both fully expressible through `getElement(true)` + `destructor()`/`dispose()` + `_ruleCacheKeys()`, exactly like the rest of the `*.styleRuleDisposal.test.ts` family.

---

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run test` — full suite green, including the new `TabButton.styleRuleDisposal.test.ts`, the extended `dispose-full-teardown.test.ts` registry, and every pre-existing suite this branch carries (`Menu.styleRuleDisposal.test.ts`, `dispose-full-teardown.test.ts`'s existing rows, `Component.test.ts`, `Cell.test.ts`, `Dock.closeDisposal.test.ts`, `Tab.closeDisposal.test.ts`) — this plan must not regress any of them.
- The step 5 grep checkpoints.
- `npm run docs:api` — zero warnings (the new `destructor()` override is `protected`, so TypeDoc excludes it from the public surface; confirm the run stays clean regardless).
- `npm run build:lib` — succeeds.
- **Manual, in the library's own demo app**, repeating the SQLAdmin measurement methodology so the fix is checkable the same way the defect was found — this is a sanity check on this branch; the authoritative re-measurement against SQLAdmin happens later, outside this plan:
  1. Open `MiscPanel`'s "Dockable layout (Dock)" demo (`packages/lib/src/typescript/MiscPanel.ts:1018`) — its tabs are closeable by default, so no demo change is needed.
  2. Open the browser console, record `[...document.styleSheets].reduce((n, s) => n + s.cssRules.length, 0)`.
  3. Open a tab, then close it via its ✕. Record the rule count again.
  4. Repeat open/close four times. Before this plan's fix, the count grows every cycle by the close button's own rule set (base + hover + active) plus its glyph's rule; after the fix, closing a tab that was never opened-and-closed before returns the count to its pre-open baseline each cycle.
  5. Optionally repeat the `insertRule`/`deleteRule` survivor-instrumentation technique from the field evidence (instrument `CSSStyleSheet.prototype.insertRule`/`deleteRule`, diff survivors against a `MutationObserver` creation log) across one open/close cycle and confirm no `TabCloseButton`-classed survivor remains.

---

## Potential Challenges

- **The fix alone will not zero out SQLAdmin's measured ~73/cycle.** The confirmed defect here accounts for a `TabCloseButton` instance and its own descendants — a handful of rule-keys per cycle — which is a genuine, directly-reproduced subset of the field-measured total, not the whole of it. The bulk of the survivor counts measured in the field (`Text: 38`, `Panel: 20`) most likely comes from `Table`'s own per-cell rendering at SQLAdmin's realistic scale (20 columns × 42 rows) — untested here, since this plan's reproduction used a minimal one-column stub table specifically to isolate the tab-chrome defect from table-content noise. Mitigation: none needed for this plan's own scope: cross-referencing every surviving rule's id against a fresh `MutationObserver` creation log, the same way the `Menu` investigation did, is the next step and belongs to its own follow-up investigation, matching how each entry in `LIBRARY_NOTES.md`'s leak investigation has scoped down and handed off the remainder.
- **`entry.button.getCloseButton()` in the extended `TabBar` row's `ownIds` needs a type-safe-enough cast to satisfy `npm run typecheck`.** Mitigation: match the file's existing loose `as unknown as { … }` idiom used throughout the registry (e.g. the `TabBar` row's own `openTabMenu` cast) rather than importing `TabButton`'s concrete type into the registry file.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/container/SplitGutter.ts:485-495`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L485) — the precedent this plan's fix mirrors: dispose a raw-appended, non-registered child explicitly in `destructor()`.
- [`packages/lib/src/typescript/lib/component/button/MenuButton.ts:105-109`](packages/lib/src/typescript/lib/component/button/MenuButton.ts#L105) — the closest sibling: another `Button` subclass gaining its first `destructor()` override for exactly this reason, in the plan this one continues.
- [`packages/lib/src/typescript/lib/component/button/TabButton.ts`](packages/lib/src/typescript/lib/component/button/TabButton.ts) — `_closeButton` field (51), constructor (61-101), `buildCloseButton` and its raw-append doc comment (145-192), `getCloseButton` (194-203).
- [`packages/lib/src/typescript/lib/component/container/TabBar.ts:1488-1600`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1488) — `createBarEntry` (builds the `TabButton`) and `removeBarEntry` (calls `entry.button.dispose()`); read this to confirm the fix is reached on every real tab close, not just the standalone case.
- [`packages/lib/tests/overlay/Menu.styleRuleDisposal.test.ts`](packages/lib/tests/overlay/Menu.styleRuleDisposal.test.ts) — the direct template for the new `TabButton.styleRuleDisposal.test.ts`.
- [`packages/lib/tests/component/dispose-full-teardown.test.ts`](packages/lib/tests/component/dispose-full-teardown.test.ts) — the registry this plan extends; read its header comment (the re-derived `protected destructor(` count) before adding rows, and update that count.
- [`plans/implemented/table-tab-close-residual-leak.md`](plans/implemented/table-tab-close-residual-leak.md) — the direct precedent for both the investigation method (instrument, don't guess; verify "registration gap vs. something else" from source before proposing a fix) and the fix pattern this plan reuses.

---

## Non-Goals

- **Closing the gap to SQLAdmin's full measured ~73 rules/cycle.** This plan fixes one confirmed, reproduced defect. Whatever remains — most plausibly in `Table`'s own cell/row rendering at realistic column/row counts — needs its own investigation, the same way this plan's predecessor scoped `Menu` out for a follow-up that became this plan.
- **The `Tooltip.attachments` map memory retention.** Already correctly scoped out as a separate, non-stylesheet defect by `plans/implemented/table-tab-close-residual-leak.md`; this plan's own direct reproduction re-confirms the stylesheet side is clean and adds nothing new to that map's own open question.
- **Deleting or shrinking SQLAdmin's `PanelDisposers` registry.** Confirmed uninvolved for the table tab specifically (`openTable` never registers with it), but it is still live for the nine `disposeOnClose: true` diagram sites; removing it is `adopt-dock-owned-teardown`'s job, not this plan's.
- **The SQLAdmin-side re-measurement.** The manual verification step in this plan checks the fix in the library's own demo app. Re-running the original 2288-rule methodology against SQLAdmin with a rebuilt local `dist/lib` happens later, outside this plan.
- **No `package.json` version bump**, in any package. This targets `0.4.1`, already in progress; the version bump is a separate, manual release step per the project's release process.

---

## Notes

[^repro-a]: Verified with a throwaway offline reproduction before drafting this plan (not part of this plan's deliverable): a `Dock` hosting one tab whose content was a `Container(BorderLayout)` with a `ToolBar` of five titled `Button`s in `NORTH` and a `Table` in `CENTER` — the same nesting `TableWorkPanel` uses. Closing the tab via `dock.removePanel` left zero residual rule-cache keys. Repeating the same structure across four open/close cycles of the *same* panel id, with every button hovered once via a direct `Tooltip.show()`/`Tooltip.hide()` call before each close, produced the identical per-cycle leak as a control run with **no** hovering at all — proving the growth was unrelated to `Tooltip`. Isolating further (same-id reuse with only a bare `Component` as tab content, no `ToolBar`, no `Table`) reproduced the same six-rule-per-cycle pattern, which a create/destroy trace on `Component`'s constructor/`destructor()` identified by class name as `TabCloseButton`, `Text`, `Glyph`, and a base `Component` — never `Button` — pointing at tab-strip chrome, not tab content, as the real source.

[^paneldisposers-check]: Read directly from `SqlAdminController.ts` (`.worktrees/typescript-ui-0-4-0-upgrade` checkout of the sqladmin repo): `openTable` (line 425) calls `this.openAsyncPanel({ id, title, glyph, tooltip, ref }, async () => { … })` with no `disposeOnClose` key in the spec object. `openAsyncPanel` (line 2958) only calls `this._panelDisposers.beginLoad(spec.id)` — minting the token `settle` later checks — `if (spec.disposeOnClose)`; with no such key, `token` is `null`, and the `content` factory's own `if (token) { this._panelDisposers.settle(...); }` (line 2978) never runs. The built `TableWorkPanel` is therefore never added to `_panelDisposers`'s `_panels` map, so `PanelDisposers.close(id)` (fired from `dock.on("close", …)` at line 336) finds nothing (`panel?.dispose()` on `undefined`) and does nothing. There is no second disposal path for this panel to race against the library's own tab-close teardown.

[^raw-append-doc]: `TabButton.buildCloseButton`'s own doc comment (`TabButton.ts:145-151`): "The ✕ is overlaid (raw-appended) rather than enrolled in a layout so it floats at the corner of the tab; TabBar pins its precise position each layout." The field's own comment (`TabButton.ts:47-50`) says the same: "Built in the constructor and raw-appended onto this button's own element (the standard overlay pattern)."

[^direct-repro]: Verified directly, isolated from `Dock`/`TabBar`/`ToolBar`/`Table` entirely: `const btn = new TabButton('A', { closeable: true }); btn.getElement(true);` — `btn.getCloseButton()!.getId()` already appears in `_ruleCacheKeys()` at this point (Button eagerly allocates its `:hover`/`:active` state rules at render time, with no interaction needed). Calling `btn`'s `destructor()` directly left six new rule-cache keys behind: the close button's own base rule plus its `:active` and `:hover:not(:active)` state rules, plus three more single-rule ids belonging to the close button's own descendants (its `Glyph` icon and `Button`'s internal content-row components). This exact six-rule shape matches every reproduction in [^repro-a] precisely, confirming this one defect is the whole of what those reproductions measured.

[^splitgutter-precedent]: `SplitGutter.destructor()`'s doc comment states the rule directly: "the button is raw-appended to this gutter's element rather than registered as a child, so `super.destructor()`'s child recursion cannot reach it." `TabButton._closeButton` is in the identical position — the difference is only that the ✕ overlays this button's own element rather than a container's, which does not change the consequence for the base class's `_components` recursion: never registered, never reached.
