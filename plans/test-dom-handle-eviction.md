---
touches-shared:
  - packages/lib/tests/dom/TestDOM.ts
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Modelled-DOM handle eviction — Implementation Plan

## Overview

The offline test suite's modelled DOM records teardown but never acts on it. `TestHandleTable`'s `_stubs` and `_byId` maps ([`packages/lib/tests/dom/TestDOM.ts:141-143`](packages/lib/tests/dom/TestDOM.ts#L141)) carry no `delete` and no `clear` anywhere in the file: `release` ([`TestDOM.ts:564`](packages/lib/tests/dom/TestDOM.ts#L564)) only appends to the write log, and `removeElement` ([`TestDOM.ts:608`](packages/lib/tests/dom/TestDOM.ts#L608)) clears the parent pointer and leaves the id index alone. So offline, a released handle still resolves and a detached element is still found by `getElementById`.

Production does the opposite, on purpose. `HandleRegistry.resolve` ([`packages/lib/src/typescript/lib/core/DOM.ts:451-471`](packages/lib/src/typescript/lib/core/DOM.ts#L451)) throws on a released or collected handle so that a use-after-free is a loud failure rather than a silent no-op, and `isRegistered` ([`DOM.ts:486`](packages/lib/src/typescript/lib/core/DOM.ts#L486)) is the single read that reports a dead handle instead of throwing. This plan makes the modelled pair honour that same contract: `release` evicts the handle's records, and detaching an element from the modelled tree un-indexes its id.

Two library defects and one modelled-DOM fidelity gap are hidden behind the current behaviour and surface the moment eviction lands, so they ship with it: `Dialog.hide` animates a backdrop its own completion callback destroyed, `Component.release()` leaves both element buffers bound to the handle it just released, and the modelled `appendChild` records a document fragment as a tree node instead of moving its children. The change touches the harness file, four library files, twelve test files (one of them new), one doc page, the changelog, and the campaign agenda that recorded the defect.

---

## Architecture Decisions

### Eviction ships in one step, not behind a staged opt-in

Both halves — stub eviction on `release`, id eviction on detach — land together and unconditionally. No per-file opt-in, and no flag controls whether eviction happens; the one environment variable this plan adds controls diagnostics only.[^one-step]

### The modelled table evicts what production's registry eviction makes unanswerable

`TestHandleTable.release(handle)` drops four records: the handle's stub, its id-index entry, its parent pointer, and the focus pointer when that pointer names the handle. The explicitly injected test inputs — `_connected` (seeded by `setConnected`), `_bySelector` and `_byRootSelector` (seeded by `setQuerySelectorResult` / `setQuerySelectorAllResult`) — are left alone.[^evict-what]

This mirrors `HandleRegistry.release` ([`DOM.ts:504`](packages/lib/src/typescript/lib/core/DOM.ts#L504)), which drops the forward-map entry `resolve` would have found and the reverse-map entry that gave the node its canonical handle. The modelled twin of "the entry `resolve` would have found" is the stub that `TestHandleTable.stub` ([`TestDOM.ts:207`](packages/lib/tests/dom/TestDOM.ts#L207)) looks up, which already throws when it misses.

### Detaching from the modelled tree un-indexes the id; re-attaching re-indexes it

Both un-indexing and re-indexing happen inside `setParent` ([`TestDOM.ts:233`](packages/lib/tests/dom/TestDOM.ts#L233)), the one method every attach and detach funnels through — `appendChild`, `insertBefore`, `removeChild` and `removeElement` all call it. A handle that never had a parent keeps today's behaviour: its id stays findable from the moment `setId` indexes it.[^id-symmetry]

| Element's history | `getElementById` finds it? | Why |
|---|---|---|
| Created, `setId`, never appended | yes | never detached; unchanged from today |
| Appended to a parent | yes | `setParent` re-indexes on attach |
| `removeElement` / `removeChild` | no | `setParent(child, null)` un-indexes |
| Detached, then appended again | yes | the second attach re-indexes |
| `DOM.sink.release(handle)` | no | `release` un-indexes before dropping the stub |

### Appending a fragment moves its children, as the browser does

`RecordingDOMSink.appendChild` and `insertBefore` check whether the inserted handle is a modelled document fragment. When it is, the fragment's recorded children move onto the new parent and the fragment itself gets no parent pointer — matching what the browser does with a `DocumentFragment`. Today both record the fragment as a child and leave every row pointing at it.[^fragment]

### The release site is recorded only when the run asks for it

`TestHandleTable.stub`'s "handle N is not registered" error appends the stack that released the handle, but only when the run sets `TESTDOM_TRACE_RELEASES=1`. Capturing a stack on every release costs roughly 40% of the suite's runtime, so it is off by default.[^trace-cost]

### `Component.release()` detaches its two element buffers rather than replacing them

`Component.release()` ([`Component.ts:1525`](packages/lib/src/typescript/lib/core/Component.ts#L1525)) — the dematerialize path that keeps the component alive and reusable — calls `this._inlineStyle.detach()` and `this._elementAttributes.detach()` after releasing the element handle. `InlineStyle` and `ElementAttributes` each gain a `detach()` that unbinds the buffer and keeps whatever state it holds, so a later commit queues instead of writing through a dead handle and rematerialize replays everything.[^detach-not-replace]

`destructor()` ([`Component.ts:1160`](packages/lib/src/typescript/lib/core/Component.ts#L1160)) is not given the same treatment. A write to a destroyed component stays loud.[^destructor-stays-loud]

### `Dialog.hide` reads the backdrop element after the panel animation

`Dialog.hide` ([`Dialog.ts:1271`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1271)) currently reads `el` and `bdEl` together at [`Dialog.ts:1295-1296`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1295), before the panel animation. The `bdEl` read moves to after `Animation.play(el, …)` returns, so a completion that already destroyed the backdrop leaves `bdEl` undefined and the `if (bdEl)` guard skips the second animation.[^dialog-order]

### The two `isRegistered` seam spies stay

`FieldDecorator.pointerTooltip` case 28 ([`tests/unit/validation/FieldDecorator.pointerTooltip.test.ts:1006`](packages/lib/tests/unit/validation/FieldDecorator.pointerTooltip.test.ts#L1006)) and `Tooltip.pointer` case 8 ([`tests/overlay/Tooltip.pointer.test.ts:350`](packages/lib/tests/overlay/Tooltip.pointer.test.ts#L350)) keep spying `DOM.source.isRegistered`. Only the comment above each spy changes, because the reason it is there changes.[^spies-stay]

---

## Public API

Two new public methods, both on classes already exported from `~/core/index.ts` ([lines 59 and 61](packages/lib/src/typescript/lib/core/index.ts#L59)):

```typescript
abstract class StyleTarget<T> {
    /** Unbinds the buffer; later writes accumulate in the dirty bag again. */
    protected dematerialize(): void;
}

class InlineStyle extends StyleTarget<Handle> {
    /** Unbinds this buffer from a released element handle. */
    detach(): void;
}

class ElementAttributes {
    /** Unbinds this buffer from a released element handle; retained state survives. */
    detach(): void;
}
```

`StyleTarget.dematerialize` is `protected`, so it does not appear in the generated docs and must not be named from public TSDoc.

---

## Internal Structure

The four new `TestHandleTable` methods, in full. `unindexId` reads the stub, so `release` calls it before deleting the stub.

```typescript
    release(handle: Handle): void {
        if (TRACE_RELEASES) {
            this._releaseSites.set(handle, (new Error().stack ?? '').split('\n').slice(2, 12).join('\n'));
        }

        this.unindexId(handle);
        this._stubs.delete(handle);
        this._parents.delete(handle);

        if (this._focus === handle) {
            this._focus = null;
        }
    }

    unindexId(handle: Handle): void {
        const stub = this._stubs.get(handle);

        if (stub && this._byId.get(stub.id) === handle) {
            this._byId.delete(stub.id);
        }
    }

    isFragment(handle: Handle): boolean {
        return this._stubs.get(handle)?.tagName === 'FRAGMENT';
    }

    reparentChildren(from: Handle, to: Handle): void {
        for (const [child, parent] of this._parents) {
            if (parent === from) {
                this.setParent(child, to);
            }
        }
    }
```

`unindexId`'s `=== handle` test matters: two handles can carry the same id over a component's release-and-rebuild cycle, and only the handle the index currently names may clear it.

`setParent` gains one line on each branch:

```typescript
    setParent(child: Handle, parent: Handle | null): void {
        if (parent === null) {
            this._parents.delete(child);
            this.unindexId(child);

            return;
        }

        this._parents.set(child, parent);
        this.indexId(child, this._stubs.get(child)?.id ?? '');
    }
```

`indexId` ([`TestDOM.ts:259`](packages/lib/tests/dom/TestDOM.ts#L259)) already ignores an empty id, so an attach of an element that has no id writes nothing.

---

## Ordered Implementation Steps

Steps 1–6 are the harness change, 7–9 the new tests, 10–12 the library fixes, 13 the two test migrations, 15–16 the comment and documentation debt. The tests come before the fixes: each fix has a case that must be red first.

1. **Add the trace flag to [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts).** Insert, immediately *before* `TestHandleTable`'s own JSDoc block (which currently ends at line 139) so that doc comment stays attached to the class:

   ```typescript
   /**
    * Opt-in release-site capture. Recording a stack per release costs roughly
    * 40% of the offline suite's runtime, so it stays off unless
    * `TESTDOM_TRACE_RELEASES=1` is set for the run that needs it.
    */
   const TRACE_RELEASES = (globalThis as { process?: { env?: Record<string, string | undefined> } })
       .process?.env?.TESTDOM_TRACE_RELEASES === '1';
   ```

   The `globalThis` cast is required: `tsconfig.test.json` does not include Node's type definitions, so a bare `process.env` is a `TS2591` error.

2. **Add the `_releaseSites` field** beside `_connected` ([`TestDOM.ts:148`](packages/lib/tests/dom/TestDOM.ts#L148)): `private readonly _releaseSites = new Map<Handle, string>();`.

3. **Make `TestHandleTable.stub` name the release site.** In [`TestDOM.ts:207-215`](packages/lib/tests/dom/TestDOM.ts#L207), replace the bare `throw` with:

   ```typescript
           if (!stub) {
               const releasedAt = this._releaseSites.get(handle);

               throw new Error(`TestHandleTable: handle ${handle} is not registered`
                   + (releasedAt ? `\n--- released at ---\n${releasedAt}` : ''));
           }
   ```

   Keep the existing message prefix unchanged — other files' assertions match on `not registered`.

4. **Add `release`, `unindexId`, `isFragment` and `reparentChildren` to `TestHandleTable`,** and the two new lines in `setParent`, exactly as `## Internal Structure` gives them. Give each method a JSDoc comment in the file's existing voice; `release`'s should say that it is the modelled twin of `HandleRegistry.release` dropping the entry `resolve` would have found.

5. **Make `RecordingDOMSink.release` evict.** At [`TestDOM.ts:564-566`](packages/lib/tests/dom/TestDOM.ts#L564), add `_table.release(handle);` after the `this.record('release', handle);` line.

6. **Give `appendChild` and `insertBefore` fragment semantics.** In `appendChild` ([`TestDOM.ts:598`](packages/lib/tests/dom/TestDOM.ts#L598)) and `insertBefore` ([`TestDOM.ts:810`](packages/lib/tests/dom/TestDOM.ts#L810)), after the `record` call and before the `setParent` call, insert:

   ```typescript
           if (_table.isFragment(child)) {
               _table.reparentChildren(child, parent);

               return;
           }
   ```

   In `insertBefore` the inserted handle is named `node`, not `child`. Add a comment on the `appendChild` branch stating that the browser moves a `DocumentFragment`'s children into the parent and leaves the fragment empty, so releasing the fragment afterwards (as [`VirtualRowView.ts:281`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L281) does) leaves no row pointing at a dead handle.

7. **Checkpoint — run the offline suite.** From `packages/lib`: `npx vitest run`. Expect exactly four failures in three files: `tests/core/UnchangedCommitSkip.test.ts` (1), `tests/component/display/Markdown.test.ts` (1) and `tests/component/table/ColumnVisibilityMenu.test.ts` (2). A different count means a step above is wrong — stop and re-read it rather than continuing.[^checkpoint-count] Re-run any one of them with `TESTDOM_TRACE_RELEASES=1` to see the release site in the error.

8. **Create [`packages/lib/tests/dom/handle-eviction.test.ts`](packages/lib/tests/dom/handle-eviction.test.ts)** with cases E1–E4 from `## Expected Behaviour`. Model the file header on [`tests/dom/handle-registry.test.ts:1-7`](packages/lib/tests/dom/handle-registry.test.ts#L1) and say plainly that this file is that one's modelled-DOM twin: `handle-registry.test.ts` pins the production registry's eviction under jsdom, this one pins the modelled table's under node. No `@vitest-environment` pragma — this file runs on the node default. E1, E2 and E3 pass now; **E4 must fail** with `handle N is not registered`, because it pins the defect step 11 fixes.

9. **Add case D1 to [`packages/lib/tests/core/DisposedPendingLayout.test.ts`](packages/lib/tests/core/DisposedPendingLayout.test.ts)** and case G1 to [`packages/lib/tests/overlay/Dialog.test.ts`](packages/lib/tests/overlay/Dialog.test.ts), both from `## Expected Behaviour`. D1 passes now — steps 1–6 are what make it possible. **G1 must fail** with `handle N is not registered`, because it pins the defect step 12 fixes.

10. **Add the two buffer-unbind methods.** In [`packages/lib/src/typescript/lib/core/StyleTarget.ts`](packages/lib/src/typescript/lib/core/StyleTarget.ts), add `protected dematerialize(): void { this._target = null; }` directly after `materialize` ([`StyleTarget.ts:118-122`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L118)), and `detach(): void { this.dematerialize(); }` on `InlineStyle` directly after its `attach` ([`StyleTarget.ts:511-513`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L511)). In [`packages/lib/src/typescript/lib/core/ElementAttributes.ts`](packages/lib/src/typescript/lib/core/ElementAttributes.ts), add `detach(): void { this._handle = null; }` directly after its `attach` ([`ElementAttributes.ts:122-134`](packages/lib/src/typescript/lib/core/ElementAttributes.ts#L122)). Both `detach` methods are public, so both need full TSDoc; neither may `{@link}` `StyleTarget.dematerialize`, which is protected and excluded from the docs build.

11. **Detach both buffers in `Component.release()`.** In [`Component.ts:1557-1561`](packages/lib/src/typescript/lib/core/Component.ts#L1557), between `this.untrackHandle(element);` and `this._element = undefined;`, insert:

    ```typescript
            // Both buffers are still bound to the handle released above, so the
            // next commit would write through it. Detaching keeps their retained
            // state, which `init()`'s `attach` replays onto the fresh element.
            this._inlineStyle.detach();
            this._elementAttributes.detach();
    ```

    E4 and `UnchangedCommitSkip` case 6b both go green here.

12. **Move `Dialog.hide`'s backdrop read.** In [`Dialog.ts:1295-1296`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1295), delete the `const bdEl = this._backdrop.getElement();` line and change the line above it to `const el = this.getElement();`. Re-declare `bdEl` after the `Animation.play(el, { … onComplete: finalize })` call that ends at [`Dialog.ts:1309`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1309), with a comment explaining that under `prefers-reduced-motion: reduce` that call has already run `finalize`, which destroyed the backdrop. Leave `animateIn` ([`Dialog.ts:982-983`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L982)) untouched — it passes no `onComplete`, so nothing runs between its two reads. G1 and both `ColumnVisibilityMenu` cases go green here.

13. **Migrate the two broken tests.**
    - [`tests/core/UnchangedCommitSkip.test.ts:773-779`](packages/lib/tests/core/UnchangedCommitSkip.test.ts#L773): delete the three-line comment, the `const lookup = …` line and the `vi.spyOn(DOM.source, 'getElementById')` line. Replace with one comment: `// release() un-indexes the id, so the lookup misses for real.` The `expect(child.getElement()).toBeFalsy();` line below stays. `vi` and `DOM` both have other uses in the file, so no import changes.
    - [`tests/component/display/Markdown.test.ts:1484-1504`](packages/lib/tests/component/display/Markdown.test.ts#L1484): the case must stop reading the disposed `md`. Replace its body with case M1 from `## Expected Behaviour`. `DarkTheme` and `ModernTheme` are still used by three other cases in the file, so the import stays.

14. **Checkpoint — the suite is green again.** `npm -w packages/lib run test` (typecheck plus `vitest run`): expect 0 failed across 512 existing files plus the one new file, with the 8570 previously-passing cases intact and six new ones (E1–E4, D1, G1).

15. **Correct every comment that states the old behaviour as fact.** Nine files carry one — a tenth, `UnchangedCommitSkip`, lost its own in step 13 — and each must now state what is true. Where the claim was a *reason* for a technique, remove the reason and keep the technique: none of these tests changes. Eight bullets for nine files; the last covers two.
    - [`src/typescript/lib/core/Component.ts:1249-1253`](packages/lib/src/typescript/lib/core/Component.ts#L1249) — the detach-ordering discussion says "The offline test harness cannot settle the question either way: its modelled `getElementById` (`TestHandleTable._byId`) is never evicted on `removeElement`, so a stale id keeps resolving regardless of ordering." Replace with a note that the harness now evicts on detach, so the ordering question is answerable offline, and that the suite is green with detach running after removal.
    - [`tests/dom/event-subtree-reentrant-dispose.test.ts:5-10`](packages/lib/tests/dom/event-subtree-reentrant-dispose.test.ts#L5) — the header's reason for the jsdom pragma is gone. Replace it with the standing reason: this file exercises `ProductionDOMSink` / `ProductionDOMSource` specifically, mirroring `handle-registry.test.ts`.
    - [`tests/core/DisposedPendingLayout.test.ts:13-17`](packages/lib/tests/core/DisposedPendingLayout.test.ts#L13) and [`:87-94`](packages/lib/tests/core/DisposedPendingLayout.test.ts#L87) — the header's "the recording sink keeps serving released handles" clause and the whole "cannot be pinned here" paragraph. The paragraph is replaced by case D1 from step 13; delete it.
    - [`tests/component/element-release.test.ts:9-12`](packages/lib/tests/component/element-release.test.ts#L9) — drop the "because the offline `getElementById` model does not evict a released id" clause; keep the sentence describing the two-half technique.
    - [`tests/component/destructor-subtree-detach-skip.test.ts:100-106`](packages/lib/tests/component/destructor-subtree-detach-skip.test.ts#L100) — drop the clause giving the stale index as the reason for calling `child.dispose()` directly.
    - [`tests/component/display/Image.test.ts:734-751`](packages/lib/tests/component/display/Image.test.ts#L734) — the paragraph says the `getElement()` branch of `triggerDecode`'s recheck cannot be exercised offline and is verified by inspection. That is no longer true; shorten it to state what the two cases assert, and drop the inspection-only caveat and the `TextInput.test.ts` cross-reference.
    - [`tests/component/layout/ManagerChrome.styleRuleDisposal.test.ts:166-169`](packages/lib/tests/component/layout/ManagerChrome.styleRuleDisposal.test.ts#L166) — drop "the offline harness never evicts the id, so it resolves even for a fully disposed component"; keep the statement that the rule keys are the assertion.
    - [`tests/overlay/Tooltip.pointer.test.ts:349-351`](packages/lib/tests/overlay/Tooltip.pointer.test.ts#L349) and [`tests/unit/validation/FieldDecorator.pointerTooltip.test.ts:1005-1007`](packages/lib/tests/unit/validation/FieldDecorator.pointerTooltip.test.ts#L1005) — the spies stay; the reason changes. Say that releasing the handle for real offline also makes the anchor fail the modelled hit test, so the outcome is reached by a second route and the spy is what isolates the liveness guard.

16. **Update the documentation.** Per `## Documentation Impact`: one paragraph in [`packages/lib/docs/concepts/dom-seams.md`](packages/lib/docs/concepts/dom-seams.md), and four entries in [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md). Mark the second bullet of `## Found while implementing the ten-plan batch (2026-09-25)` in [`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md:439`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L439) as resolved by this plan, and record two corrections to what it says: the workaround inventory was nine files, not two, and two behaviours had no offline coverage at all (`Component.ts:305`'s same-flush disposal guard and `Image`'s decode-settlement recheck) rather than merely a workaround.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Create | `packages/lib/tests/dom/handle-eviction.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/StyleTarget.ts` |
| Modify | `packages/lib/src/typescript/lib/core/ElementAttributes.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/tests/core/UnchangedCommitSkip.test.ts` |
| Modify | `packages/lib/tests/core/DisposedPendingLayout.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/overlay/Dialog.test.ts` |
| Modify | `packages/lib/tests/component/element-release.test.ts` |
| Modify | `packages/lib/tests/component/destructor-subtree-detach-skip.test.ts` |
| Modify | `packages/lib/tests/component/display/Image.test.ts` |
| Modify | `packages/lib/tests/component/layout/ManagerChrome.styleRuleDisposal.test.ts` |
| Modify | `packages/lib/tests/dom/event-subtree-reentrant-dispose.test.ts` |
| Modify | `packages/lib/tests/overlay/Tooltip.pointer.test.ts` |
| Modify | `packages/lib/tests/unit/validation/FieldDecorator.pointerTooltip.test.ts` |
| Modify | `packages/lib/docs/concepts/dom-seams.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md` |

---

## Expected Behaviour

Every case below is unit-testable offline. Nothing in this plan needs manual verification: the whole change is about what the offline harness can observe, and the two library fixes are both reachable from a node test — `Dialog.hide`'s reduced-motion path through a `DOM.source.matchMedia` spy, and `Component.release()` through a `canRelease()` override.

### `tests/dom/handle-eviction.test.ts` — the eviction contract

**E1. A released handle stops resolving and stops being findable.** Create an element, `setId(h, 'probe-id')`, then:

| After | `isRegistered(h)` | `getElementById('probe-id')` | `getTagName(h)` |
|---|---|---|---|
| `setId` | `true` | `h` | `'DIV'` |
| `DOM.sink.release(h)` | `false` | `null` | throws `/not registered/` |

**E2. Detaching un-indexes the id; re-attaching re-indexes it.** With `child` carrying id `'kid'` and appended to `parent`: `getElementById('kid')` is `child`; after `removeElement(child)` it is `null`; after `appendChild(parent, child)` it is `child` again.

**E3. Appending a fragment moves its children, so releasing the fragment orphans nothing.** Create `host`, a fragment, and a `row`; `appendChild(fragment, row)`; `appendChild(host, fragment)`. Then `getParentNode(row)` is `host` (not the fragment). After `release(fragment)`, writing `{ left: '5px', top: '7px', width: '10px', height: '10px' }` to `row` and reading `getElementRect(row)` does not throw and reports `x === 5`.

**E4. A commit after `Component.release()` writes nothing through the released handle.** Use a file-local `Component` subclass that overrides `canRelease()` to return `true` and widens the protected `release()` and `render()` — the same shape as `ReleasableProbe` in [`tests/component/element-release.test.ts`](packages/lib/tests/component/element-release.test.ts). Render it, note the element handle, `release()`, then `setWidth(321)` and `setAutoCommitStyle(true)`. Neither throws, and no `apply` write is recorded against the released handle. Calling `render()` afterwards produces a fresh handle that does receive `apply` writes.

### `tests/core/DisposedPendingLayout.test.ts`

**D1. The flush skips a component an earlier entry in the same flush disposed.** Render two components, `scheduleLayout()` on both, make the first one's `doLayout` dispose the second, then drain the frame. The second's `doLayout` is never called. This is the guard at [`Component.ts:305`](packages/lib/src/typescript/lib/core/Component.ts#L305) (`if (!hasDirtyAncestor && c.getElement())`), which had no offline coverage at all.

### `tests/overlay/Dialog.test.ts`

**G1. Hiding under reduced motion does not write through the backdrop handle its own completion released.** Spy `DOM.source.matchMedia` to return `{ matches: true }`, `show()` a `Dialog`, note the backdrop's element handle, then `hide('confirm')`. It does not throw; the recorded write log contains a `release` of that handle; and no `apply` write against that handle appears at or after that release.

### `tests/component/display/Markdown.test.ts`

**M1. `dispose()` detaches the theme listener.** Render a `Markdown`, assert its measured height as the case does today, read `ThemeManager._themeListenerCount()` ([`Theme.ts:1389`](packages/lib/src/typescript/lib/core/Theme.ts#L1389)), `dispose()`, and assert the count dropped by exactly one. The case must not call `ThemeManager.setTheme` and must not read `md` after `dispose()` — both reach a released handle.[^markdown-migration]

### `tests/core/UnchangedCommitSkip.test.ts`

**U1. Case 6b is unchanged in what it asserts.** After `child.release()`, `child.getElement()` is falsy and the next `root.doLayout()` still lays the child out exactly once. The only difference is that the miss is now real rather than staged by a spy.

---

## Verification

Run from the repository root unless stated otherwise. None of these opens a window: `packages/qa/runqa.sh`, MiniBrowser and the Tauri qa-host are not part of this plan's verification and must not be run.

1. `npm run typecheck` and `npm -w packages/lib run typecheck:test` — both clean.
2. `npm -w packages/lib run lint` — clean.
3. `npm -w packages/lib run test` — 0 failed: the 8570 previously-passing cases across 512 files, plus the six new ones (E1–E4 in `tests/dom/handle-eviction.test.ts`, D1, G1).
4. **Mutation confirmations.** Each is a one-line revert, a single-file test run, and a restore. Every one must fail the named case:
   - Remove `this._inlineStyle.detach();` / `this._elementAttributes.detach();` from `Component.release()` → E4 fails with `handle N is not registered`, and `tests/core/UnchangedCommitSkip.test.ts` case 6b fails.
   - Restore `Dialog.hide`'s early `bdEl` read → G1 fails with `handle N is not registered`.
   - Remove `&& c.getElement()` from [`Component.ts:305`](packages/lib/src/typescript/lib/core/Component.ts#L305) → D1 fails.
   - Remove `_table.release(handle);` from `RecordingDOMSink.release` → E1 and E4 fail.
   - Remove `this.unindexId(child);` from `setParent`'s null branch → E2 fails.
   - Remove the fragment branch from `appendChild` → E3 fails.
5. **Grep invariants.** `grep -rn "never evicts\|does not evict\|doesn't evict\|cannot reproduce that state\|cannot reach that state" packages/lib/tests packages/lib/src` — every surviving hit must be one of the two corrected spy comments from step 15, and no hit may assert that the harness cannot evict.
6. `grep -rn "getElementById" packages/lib/tests | grep spyOn` — expect zero matches (step 13 removed the only one).
7. `TESTDOM_TRACE_RELEASES=1 npx vitest run tests/dom/handle-eviction.test.ts` from `packages/lib` — still green, and the flag changes nothing about the outcome.
8. `npm run docs:api` — must finish with zero warnings (the two new public `detach` methods carry TSDoc).
9. `npm run docs:llms:check` — clean. No manifest change is needed: the coverage guard walks concrete classes, and this plan adds none.
10. **Suite runtime.** `vitest run` on `tests/component/table` — the fragment-heaviest directory — must stay within its own run-to-run spread. Measured while drafting: 19.6 s and 20.8 s before, 20.5 s and 20.1 s after.

---

## Documentation Impact

**[`packages/lib/docs/concepts/dom-seams.md`](packages/lib/docs/concepts/dom-seams.md)** — the paragraph beginning "Resolving a released or collected handle **throws**" describes the production contract. Add two sentences to its end: the modelled test pair honours the same contract, so a released handle stops resolving offline and a detached element stops being found by `getElementById`; `isRegistered` stays the one read that reports a dead handle instead of throwing.

**[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — four entries, in the file's existing voice:

- `## Added` → `### Core`: `InlineStyle.detach()` and `ElementAttributes.detach()`, the unbind twins of `attach()`, for an owner whose element handle has been released.
- `## Fixed` → `### Overlay`: `Dialog.hide` no longer animates the backdrop it has already destroyed. Under `prefers-reduced-motion: reduce` the panel animation completes synchronously, which runs `hide`'s own `finalize` and destroys the backdrop, and the backdrop animation then ran against a released handle.
- `## Fixed` → `### Core`: `Component.release()` now detaches its inline-style and attribute buffers. A layout commit after a dematerialize wrote through the released handle.
- `## Fixed` → `### Core`: the offline test harness's modelled DOM now evicts a released handle and un-indexes a detached element's id, matching the production seam. Name it as a test-infrastructure fix so a reader can tell it changes no shipped behaviour.

No `llms.txt` entry: the manifest catalogues classes, and this plan adds none.

---

## Potential Challenges

- **A failure whose stack ends inside `TestHandleTable.stub` says nothing about the cause.** Re-run that one file with `TESTDOM_TRACE_RELEASES=1`; the error then carries the ten frames that released the handle, which is how all five of the failures the eviction surfaced were diagnosed.
- **`unindexId` must run before the stub is deleted.** It reads `stub.id` to find the index entry. Reversing the two lines in `release` silently leaves the id findable and makes E1's third column pass for the wrong reason.
- **`insertBefore`'s parameter is `node`, not `child`.** Copying `appendChild`'s fragment branch verbatim into it will not compile; the reference parameter stays unused.
- **`reparentChildren` mutates `_parents` while iterating it.** It only overwrites existing keys, which is well-defined for a `Map`, and `setParent` adds no key that was not already there. Do not change it into something that inserts during the walk.
- **A test that reads a component after `dispose()` now throws.** That is the point, but it makes the failure look like a harness bug. `tests/component/display/Markdown.test.ts` was the only such case in the suite; the shape to look for is a read of a disposed component outside an `expect(...).toThrow()`.

---

## Critical Files

| File | Why |
|---|---|
| [`src/typescript/lib/core/DOM.ts:451-520`](packages/lib/src/typescript/lib/core/DOM.ts#L451) | `resolve`, `isRegistered` and `release` — the production contract this plan mirrors, and the precedent named in `## Architecture Decisions` |
| [`src/typescript/lib/core/DOM.ts:3327`](packages/lib/src/typescript/lib/core/DOM.ts#L3327) | `DOM.reset` — rebuilds the whole registry between tests, the coarse eviction that already exists |
| [`tests/dom/TestDOM.ts:141-280`](packages/lib/tests/dom/TestDOM.ts#L141) | `TestHandleTable` — every map this plan touches, and `indexId` / `byId` / `has` |
| [`tests/dom/TestDOM.ts:1137-1160`](packages/lib/tests/dom/TestDOM.ts#L1137) | `getElementRect` — climbs `_table.parent` and resolves each ancestor's stub, which is what the fragment fix protects |
| [`tests/dom/TestDOM.ts:1754`](packages/lib/tests/dom/TestDOM.ts#L1754) | `installTestDOM` — rebuilds the table per test and clears three other kinds of cross-test state; the pattern per-handle eviction joins |
| [`tests/setup/node-setup.ts`](packages/lib/tests/setup/node-setup.ts) | the global `beforeEach(installTestDOM)` / `afterEach(DOM.reset)` pair, and why the two jsdom suites self-guard out of it |
| [`tests/dom/handle-registry.test.ts:1-110`](packages/lib/tests/dom/handle-registry.test.ts#L1) | the production twin of the new test file — copy its header voice and its case shapes |
| [`src/typescript/lib/core/Component.ts:1525-1565`](packages/lib/src/typescript/lib/core/Component.ts#L1525) | `Component.release()` — the dematerialize path being fixed |
| [`src/typescript/lib/core/Component.ts:1694-1700`](packages/lib/src/typescript/lib/core/Component.ts#L1694) | `disposeFrame` — the existing precedent that a released handle's style buffer must not be reused |
| [`src/typescript/lib/core/Component.ts:8424-8432`](packages/lib/src/typescript/lib/core/Component.ts#L8424) | `reattachElementBuffers` — the framework already models rebinding both buffers to a new element |
| [`src/typescript/lib/core/ElementAttributes.ts:1-140`](packages/lib/src/typescript/lib/core/ElementAttributes.ts#L1) | its class doc states the retain-and-replay contract that rules out replacing the buffer |
| [`src/typescript/lib/core/Animation.ts:109-125`](packages/lib/src/typescript/lib/core/Animation.ts#L109) | `play` — the reduced-motion branch that calls `onComplete` synchronously |
| [`src/typescript/lib/overlay/Dialog.ts:1271-1320`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1271) | `hide` — `finalize`, the two `Animation.play` calls, and the read being moved |
| [`src/typescript/lib/component/shared/VirtualRowView.ts:255-282`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L255) | `growRowPool` — the one fragment-then-release site in the library |
| [`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md:439`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L439) | the agenda entry this plan closes |

---

## Non-Goals

- **Handle numbers are not made monotonic across `installTestDOM` calls.** `_next` keeps restarting at 1 per table.[^no-monotonic]
- **The modelled reads that answer without resolving a stub are not tightened.** `isConnected`, `contains`, `getParentNode`, `getParentElement`, `getFirstChild`, `matches`, `getInlineStyle`, `getDataset`, `getBorderWidths`, `getComputedOverflow` and `querySelectorAll` keep answering for a released handle instead of throwing the way production would.[^no-strict-reads]
- **`tests/component/activation-after-dispose.test.ts` is not ported to the modelled DOM.** Its premise is now reproducible offline, but porting it is a rewrite of eight working cases, each needing its own mutation confirmation, and its `jsdom` pragma also carries the unrelated `Glyphs` sprite-reset workaround that a separate branch is fixing.[^no-port]
- **`tests/dom/event-subtree-reentrant-dispose.test.ts` stays under jsdom.** It exercises `ProductionDOMSink` / `ProductionDOMSource` against a real document, which is a standing reason independent of this defect; only its header's stated reason changes.
- **Four tests keep techniques they no longer need.** `element-release.test.ts` keeps calling the protected `render()` directly, `destructor-subtree-detach-skip.test.ts` keeps calling `child.dispose()` rather than `disposeAllComponents()`, `ManagerChrome.styleRuleDisposal.test.ts` keeps asserting on rule keys, and `Image.test.ts`'s two decode cases keep their current assertions. Each is green and asserting the right thing; simplifying a passing test risks making it vacuous, and each simplification needs its own mutation check. Only their comments change.
- **The `Markdown.test.ts` theme-listener leak is not fixed.** Every case in that file constructs a `Markdown` and never disposes it, so each leaves a live `ThemeManager` listener behind. Case M1 avoids the leak by not dispatching a theme change; cleaning up the file's ~30 undisposed instances is a separate tidy-up.[^markdown-leak]
- **`Component.destructor()`'s behaviour is not changed.** It keeps leaving its buffers bound, so a write to a destroyed component keeps throwing; only its comment at [`Component.ts:1249-1253`](packages/lib/src/typescript/lib/core/Component.ts#L1249) changes. See `## Architecture Decisions`.
- **`Row.doLayout`'s missing `super` call** — the third defect in the same agenda entry — is untouched.

---

## Addendum: Blast-radius measurement

Every row is a full `vitest run` of the offline suite in a worktree off `master` at `6db01b15`, 512 files and 8572 cases. The baseline is green.

| Variant | Failed | Files | Note |
|---|---|---|---|
| Baseline (`master`) | 0 | — | 8570 passed, 2 skipped |
| Stub eviction on `release` only | 9 | 6 | `getElementById` still hands back dead handles |
| Id eviction on detach only | 0 | 0 | the single failure seen was a 30 s cold-import timeout in `tests/unit/import-without-dom.test.ts`, reproduced green in isolation |
| Both halves of the eviction | 5 | 4 | the eviction's own blast radius |
| **All of steps 1–6 (eviction plus fragment semantics)** | **4** | **3** | the checkpoint the implementer sees |
| Both + monotonic handle numbers | 14 | 9 | cross-test `ThemeManager` listener leaks |
| Both + every modelled read asserts liveness | 46 | 9 | mostly reads of a disposed component's parent |

The two halves are complementary, not additive: stub eviction alone is *worse* than both together, because without id eviction `Component.getElement()` still resurrects a disposed component by its stale id and hands back a handle whose stub is gone. Two of the nine — `tests/overlay/Dock.lifecycle.test.ts` and `tests/component/input/TextInput.test.ts`'s `paste()` disposal guard — pass under both halves precisely because `getElement()` now returns `undefined` and the library's own guards fire.

The five failures the eviction alone produces, with the cause each was hiding. The fragment fix in step 6 retires the `CellEditorPool` one before the implementer's checkpoint, which is why that checkpoint reads four in three:

| Failing case | Cause | Fixed by |
|---|---|---|
| `ColumnVisibilityMenu` 17 and 18-19 | `Dialog.hide` animates a backdrop its own `finalize` destroyed, under reduced motion | step 12 |
| `CellEditorPool.styleRuleDisposal` | modelled `appendChild` leaves pooled rows parented to a released fragment | step 6 |
| `UnchangedCommitSkip` 6b | `Component.release()` leaves both element buffers bound to the released handle | step 11 |
| `Markdown` theme-listener case | the case reads the disposed component through `getMinSize()` | step 13 |

---

## Notes

[^one-step]: The count is five failing cases in four files out of 8572 cases in 512 files — 0.06% — and every one traces to a specific defect with a specific fix, not to a technique the suite relies on broadly. A staged opt-in would cost more than it saves: it needs a flag on `installTestDOM` or per-file, a migration list, a second pass to flip the default, and — for as long as it exists — two modelled DOMs with different contracts, which is the ambiguity this plan exists to remove. The measurement, including the variants that were rejected, is in `## Addendum: Blast-radius measurement`.

[^checkpoint-count]: Measured on a worktree off `master` at `6db01b15`: with all six harness steps in place and no library fix yet, the offline suite fails four cases in three files. The eviction alone — steps 1–5, without step 6's fragment semantics — fails five in four, the extra one being `tests/component/table/CellEditorPool.styleRuleDisposal.test.ts`. `## Addendum: Blast-radius measurement` has the full variant table.

[^evict-what]: The rule is "evict what production's registry eviction makes unanswerable". The stub is the modelled element, so it goes; the id index answers `getElementById`, which in a real document cannot find a node that is not in it; the parent pointer is what `getElementRect` climbs, and a walk into a dead ancestor is the fragment failure in the addendum; the focus pointer is the modelled `document.activeElement`, which a released element cannot be. `_connected`, `_bySelector` and `_byRootSelector` are different in kind: each is an explicitly injected input with no modelled derivation, set by a test that knows what it wants the read to answer. Evicting them was measured green too, but it is not this change's business — a read that consults them without resolving the stub is the separate gap the strict-read follow-up covers, and clearing them would also make two mutation checks pass for the wrong reason (see `[^spies-stay]`).

[^id-symmetry]: Routing both directions through `setParent` keeps one rule in one place, so `removeChild` and `removeElement` cannot disagree — today only `removeElement` is named in the defect report, but both call `setParent(child, null)` and both detach in production. Re-indexing on attach is what keeps a detach-then-reattach cycle working: `Menu.showAnchored` caches a detached container and shows it again, and `Component`'s rematerialize path re-renders through `render()`. Two stricter rules were rejected. "Findable only while connected to a root" is closer to `document.getElementById` but changes behaviour for every element that is created, given an id, and never appended — which offline is most of them. "Un-index on detach, never re-index" is asymmetric and leaves a re-shown cached container unfindable.

[^fragment]: `document.createDocumentFragment()` produces a node that is never itself inserted: `parent.appendChild(fragment)` moves the fragment's children into `parent` and leaves the fragment empty. The modelled sink instead recorded `_parents[fragment] = parent` and left every row's parent pointing at the fragment. That was invisible while nothing was evicted; once `release` evicts, [`VirtualRowView.ts:280-281`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L280) — which appends the grow fragment and then releases it — leaves every pooled row parented to a dead handle, and the next `getElementRect` on a row throws while climbing. That is the whole of the `CellEditorPool.styleRuleDisposal` failure.

[^trace-cost]: Measured as the sum of per-file durations over a full `vitest run`: 118.8 s with the capture unconditional against 85.9 s and 86.2 s with it off, and 73.3 s and 86.1 s for two baseline runs. So the eviction itself is inside the baseline's own spread while the unconditional capture adds roughly 40%. The `tests/component/table` directory — the fragment-heaviest area, where `reparentChildren`'s scan of `_parents` would show up — measured 20.5 s and 20.1 s against 19.6 s and 20.8 s at baseline, so the scan costs nothing measurable.

[^detach-not-replace]: Replacing the buffers with fresh instances was tried first and broke [`tests/component/element-release.test.ts:163`](packages/lib/tests/component/element-release.test.ts#L163), which asserts that a raw attribute written before `release()` is replayed onto the rebuilt element. `ElementAttributes`' own class doc is explicit about why: unlike `InlineStyle` it "retains its full state rather than emptying it at materialisation … so a component that releases its element and renders a new one gets every attribute back from a single `attach` call". Discarding the buffer discards that state. Detaching keeps it and sends later writes back to the pending set, which the next `attach` drains. `InlineStyle` gets the same treatment for symmetry and because its dirty bag can hold writes queued between the release and the rebuild.

[^destructor-stays-loud]: A dematerialized component is explicitly still alive and reusable, so a write through it must land somewhere — that is a framework contract, and leaving the buffers bound to a dead handle breaks it. A destroyed component is different: reading or writing it is a use-after-free, and `core/DOM.ts`'s whole design decision is that such a use is a loud failure. Detaching `destructor()`'s buffers would convert those throws back into silent no-ops, which is the defect this plan removes. `tests/component/display/Markdown.test.ts`'s case is exactly one of those uses, and it is migrated rather than accommodated.

[^dialog-order]: `Animation.play` calls `config.onComplete?.()` synchronously when `isReducedMotion()` is true ([`Animation.ts:121-124`](packages/lib/src/typescript/lib/core/Animation.ts#L121)). `hide`'s `onComplete` is `finalize`, which calls `this._backdrop.destroy()` and so releases the backdrop's element handle. With `bdEl` read before that call, `hide` then hands the released handle to a second `Animation.play`, whose first act is `buf.attach(el)` — a write through a dead handle. Against `ProductionDOMSink` that throws; offline it silently wrote to the evicted stub's slot, which is why `ColumnVisibilityMenu` cases 17 and 18-19 passed. Both spy `matchMedia` to `{ matches: true }`, which is what puts them on the reduced-motion path. `animateIn` ([`Dialog.ts:981-1005`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L981)) reads the same pair the same way and is safe, because neither of its `play` calls passes an `onComplete`, so nothing runs between the two reads. Playing the backdrop animation before the panel's was rejected: it reorders two visible animations to fix a lifetime bug, and moving one read fixes it without touching what the user sees.

[^spies-stay]: Retiring them was tried and measured. Replacing each spy with a real release — `outer.dispose()` for `Tooltip.pointer` 8, `field.dispose()` for `FieldDecorator.pointerTooltip` 28 — leaves both cases green, but both then survive the mutation that deletes the guard they exist to pin (removing the `isRegistered` half of [`Tooltip.ts:132`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L132) and the whole test at [`Tooltip.ts:896`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L896)). The reason is that a disposed anchor also stops being a hit-test result, so the tooltip reaches the same dismissal through the pointer-moved-off path and the assertion cannot tell the two routes apart. Leaving `_connected` seeded does not help: the surviving `isConnected` half of the `||` then answers from the stale seed and the outcome is still reached. So the spy is what isolates the liveness guard, and it stays. This also settles the follow-up [`plans/implemented/validation-error-arming.md:567-570`](plans/implemented/validation-error-arming.md#L567) left open, with the opposite answer to the one it expected.

[^markdown-migration]: The case cannot keep its current shape. It disposes `md` and then reads `md.getMinSize()`, which reaches `getLayoutManager()` → `setDataAttribute` → a write through the released handle. Its `ThemeManager.setTheme(DarkTheme)` call is separately unsafe in the whole-file run, because earlier cases in the same file leave undisposed `Markdown` instances whose theme listeners fire and write through handles that alias the disposed one. `ThemeManager._themeListenerCount()` is documented "for tests only" and asserts the case's own title directly, so the migrated case is both safe and a tighter statement of the claim than the height comparison it replaces — which passed today because the measurement was cached, not because the listener had detached.

[^markdown-leak]: The leak is real but orthogonal. Handle numbers restart at 1 per `installTestDOM`, so a leaked listener from an earlier case writes through a handle number the current table has re-minted for something else — a silent write to the wrong element, which is only observable when that number happens to name a handle the current case released. Fixing it properly means either disposing every instance the file creates or resetting `ThemeManager`'s listeners in `installTestDOM`, and the latter cannot be a blunt clear: `clearBorderWidths` is itself registered as a theme listener at module load and other cases depend on it firing.

[^no-monotonic]: Measured: 14 failures in 9 files, against 5 in 4 with table-local numbering. Every extra failure is a theme-reflow case — `tests/overlay/Notification.test.ts`, `tests/component/tree/TreeFontReflow.test.ts`, `tests/component/table/HeaderThemeReflow.test.ts` and three more in `tests/component/display/Markdown.test.ts` — where an undisposed component from an earlier case in the same file still holds a `ThemeManager` listener. Monotonic numbering is the better design, because it turns a silent write to an aliased handle into a loud one, but what it exposes is a cross-test listener-leak cleanup, not this defect. See `[^markdown-leak]`.

[^no-strict-reads]: Measured: 46 failures in 9 files, against 5 in 4. The tightening is the right eventual shape — production throws on every read of a released handle except `isRegistered`, and the modelled source should too — but at nine times the migration cost it is its own piece of work, and most of those failures are tests reading a disposed component's parent rather than defects in the library. It is also what would let `[^spies-stay]`'s two cases be retired, since `isConnected` would then stop answering for a dead handle.

[^no-port]: The premise is confirmed: with this plan's harness change, `Component.getElement()` returns `undefined` after `dispose()` offline, for both a plain `Container` and a `Checkbox` — the exact state [`plans/implemented/activation-after-dispose.md:356`](plans/implemented/activation-after-dispose.md#L356) records as unreachable. Porting the suite nonetheless means dropping its `jsdom` pragma, its `beforeAll` `Glyphs` priming, and its `dispatchAndCatch` helper (which exists only because jsdom reports a listener's exception as a `window` `error` event rather than propagating it), then re-confirming all eight cases against their guards. That is a separate plan, and the `Glyphs` sprite-reset defect from the same agenda entry is already on its own branch.
