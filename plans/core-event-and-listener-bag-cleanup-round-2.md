---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/Event.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Core Event and Listener-Bag Cleanup, Round 2 — Implementation Plan

## Overview

The component-lifecycle campaign that ran from 2026-07-05 to 2026-08-29 left four gaps in the core seams it was built on. This plan closes them. It touches nine library files, two test files, and two doc pages; no exported symbol is added, removed, or renamed.

1. [`Component.setId`](packages/lib/src/typescript/lib/core/Component.ts#L1868) swaps in a fresh `StyleRule` for the new `#<id>` selector but never disposes the one it replaces, so a `setId` call after first render leaves a dead rule on the shared stylesheet for the life of the page.
2. [`Event`'s `registerEntry`](packages/lib/src/typescript/lib/core/Event.ts#L437) dedupes a re-registration by listener reference and then *drops* it — keeping the first call's `button` / `stop` / `prevent` options. [`Event.addViewportListener`](packages/lib/src/typescript/lib/core/Event.ts#L762) has no dedup at all. Both matter to [`Component.release()`](packages/lib/src/typescript/lib/core/Component.ts#L1286), which detaches a live component's element and lets the next `getElement(true)` rebuild it: that rebuild re-runs `render()` and `init()` on the same instance, so the mechanism is only safe while re-registration is idempotent.
3. [`AbstractStore`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L185) and [`Router`](packages/lib/src/typescript/lib/router/Router.ts#L81) each hold a private `ListenerBag` with no teardown hook. Investigation says neither needs one; the plan records why in each class's JSDoc so the finding is not re-filed.
4. Three files under `packages/lib/src/typescript/lib/diagnostics/` write `protected override destructor()` where the other 53 overrides in the library write `protected destructor()`, as does `Component`'s own base method.

---

## Architecture Decisions

### `setId` retires the rule it replaces; `destructor` frees the whole tracked selector set

`setId` disposes the outgoing `StyleRule` and drops its selector from `_ownedSelectors`, using a new private `untrackSelector` that mirrors the existing [`untrackHandle`](packages/lib/src/typescript/lib/core/Component.ts#L1134). `destructor` additionally sweeps `_ownedSelectors` and clears it, so the eager teardown path frees the same set as the module's garbage-collection finalizer — the `FinalizationRegistry` at [`Component.ts:334`](packages/lib/src/typescript/lib/core/Component.ts#L334), which deletes a discarded component's tracked selectors when the instance is collected.[^selector-symmetry]

The bookkeeping, case by case:

| Call | `_ownedSelectors` before | after | Shared stylesheet |
|---|---|---|---|
| `new Component({ id: "a" })` — `setId` runs from `applyOptions`, before render | `["#<uuid>"]` | `["#a"]` | nothing materialised either way |
| `c.setId("b")` after first render | `["#a"]` | `["#b"]` | `#a` deleted; `#b` re-materialised by the `applyStyle` at the end of `setId` |
| `c.setId("b")` again, same id | `["#b"]` | `["#b"]` | unchanged — no dispose, no second tracking entry |

### A re-registration re-configures the listener instead of being dropped

`registerEntry` keeps its match-by-reference test, but on a match it now overwrites the stored `options` and returns, rather than discarding the call.[^options-refresh] `addViewportListener` gains the same match-by-reference guard the other two surfaces already have.[^viewport-dedup]

What each surface does with a second registration:

| Second call, after the first | Before | After |
|---|---|---|
| `addListener(c, "mousedown", f)` — same `f` | one entry, primary-only | one entry, primary-only |
| `addListener(c, "mousedown", { button: "any", handler: f })` — same `f` | one entry, **still primary-only** | one entry, `button: "any"` |
| `addListener(c, "mousedown", () => g())` — a fresh closure each time | two entries, `g` runs twice | two entries, `g` runs twice (unchanged) |
| `addViewportListener(c, "resize", f)` — same `f` | **two entries, `f` runs twice** | one entry, `f` runs once |

The third row is the case the framework cannot fix: an anonymous closure has no identity to match on. The contract is therefore that **a registration site which can run more than once must pass a stable reference** — a method on the component, or a `readonly` arrow field. That rule already exists in prose in [ARCHITECTURE.md](ARCHITECTURE.md) (*Listeners must reference a named function*); this plan states it in `Event`'s own JSDoc and in [`docs/concepts/events.md`](packages/lib/docs/concepts/events.md), and removes the two library sites that break it.

### The two re-entrant closure sites become stable references

A rematerialize after `release()` replays exactly two methods on the same live instance — `render()` and `init()`. Exactly two of the library's `Event` registrations inside those methods pass an inline closure: [`HeaderCell.init`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L246) and [`WebGLCanvas.render`](packages/lib/src/typescript/lib/component/display/WebGLCanvas.ts#L451).[^closure-enumeration] Each becomes a stable reference, matching a sibling registration two lines away in its own file. After that, every `init()`/`render()`-time registration in the library dedupes, so a class can be opted into `canRelease()` without stacking listeners.

Every other inline closure in the library stays as it is. The large majority sit in constructors, and a constructor does not re-run on a rematerialize; the rest sit in one-shot installers or in per-target wiring that runs once per target. None of them can stack.

### `AbstractStore` and `Router` get documentation, not a `dispose()`

Neither class gets a teardown method. Their `ListenerBag`s are plain fields that are collected with the instance, and nothing in the framework holds either kind of instance past its owner's lifetime.[^no-store-dispose] `Router` already ships the one teardown call it genuinely needs — [`stop()`](packages/lib/src/typescript/lib/router/Router.ts#L160), which removes the window-level `hashchange` / `popstate` listener that is the only thing pinning a router.[^router-pin] Each class gets a JSDoc remark recording the conclusion.

This deliberately diverges from the [`ButtonGroup` / `Binding` precedent](plans/implemented/buttongroup-binding-dispose-lifecycle.md), which added a `dispose()` to two non-`Component` bag owners. `Binding` needed one for a reason that does not apply here; `ButtonGroup`'s is bag-clearing only.[^diverge-from-buttongroup]

### The three diagnostics overrides drop `override`

`noImplicitOverride` is not set in any `tsconfig.json` in the repo, so `override` is optional everywhere and removing it changes nothing the compiler checks. The library's convention for `destructor()` is unambiguous — `grep -rnE "^\s*protected destructor\(" packages/lib/src/typescript` returns 54 declarations without the keyword against 3 with it — so the three diagnostics files are normalised to match. The `override` keyword on other members in those files (and elsewhere) is left alone.

---

## Internal Structure

### `Component.setId` — the replacement block

Replaces lines 1884-1885 of [`Component.ts`](packages/lib/src/typescript/lib/core/Component.ts#L1884). The existing comment above the block stays as-is.

```typescript
const previousRule     = this._styleRule;
const previousSelector = previousRule.getSelector();

this._styleRule = new StyleRule({ scope: "component", name: id, materialize: false });

const selector = this._styleRule.getSelector();

if (selector !== previousSelector) {
    // The outgoing `#<oldId>` rule can never match this element again, and no
    // other wrapper holds it. `destructor` only ever disposes the CURRENT
    // `_styleRule`, so a rule replaced here and left behind would sit on the
    // shared stylesheet permanently.
    previousRule.dispose();
    this.untrackSelector(previousSelector);
    this.trackSelector(selector);
}
```

### `Component.untrackSelector`

Placed immediately after [`trackSelector`](packages/lib/src/typescript/lib/core/Component.ts#L1123), mirroring `untrackHandle`'s shape.

```typescript
/**
 * Stops tracking a component-scope selector whose rule has already been
 * disposed through an explicit path (an id change retiring the previous
 * `#<id>` rule), so the tracked set does not accumulate dead entries.
 *
 * @param selector - The selector to drop from the tracked set.
 */
private untrackSelector(selector: string): void {
    const idx = this._ownedSelectors.indexOf(selector);

    if (idx !== -1) {
        this._ownedSelectors.splice(idx, 1);
    }
}
```

### `Component.destructor` — the selector sweep

Inserted after the `_deferredStyleRules` disposal loop that ends at line 1079, before the `_componentFinalizer.unregister(this)` block.

```typescript
// Free every selector still tracked, then clear the record: the GC
// finalizer's held value IS `_ownedSelectors`, so the eager path has to
// free the same set or the two teardown routes disagree about what a
// component owns. `disposeStyleRule` is a no-op for a selector whose rule
// the two loops above already deleted, so this only ever catches a rule no
// live wrapper still points at.
for (const selector of this._ownedSelectors) {
    disposeStyleRule(selector);
}

this._ownedSelectors.length = 0;
```

### `Event.registerEntry` — the tail of the function

Replaces the `if (!compFunc.listeners.some(...))` guard at [`Event.ts:464-466`](packages/lib/src/typescript/lib/core/Event.ts#L464).

```typescript
const existing = compFunc.listeners.find((entry) => entry.listener === listener);

if (existing) {
    // A second registration of the same reference is not a second listener —
    // it re-configures the one already registered. Overwriting `options`
    // (rather than dropping the call, as this did before) is what lets a
    // rebuilt element's `init()` re-run land its CURRENT options instead of
    // silently inheriting whatever the first registration passed.
    existing.options = options;

    return;
}

compFunc.listeners.push({ listener, options });
```

### `Event.addViewportListener` — the tail of the function

Replaces the unconditional push at [`Event.ts:786`](packages/lib/src/typescript/lib/core/Event.ts#L786).

```typescript
if (compFunc.listeners.some((entry) => entry.listener === listener)) {
    return;
}

compFunc.listeners.push({ listener });
```

---

## Ordered Implementation Steps

Work test-first where a step names a test: write the test, watch it fail, then make the source change.

1. **Tests for `setId` rule retirement** — append a new `describe('Component — setId retires the previous style rule', …)` block to the end of [`tests/component/Component.test.ts`](packages/lib/tests/component/Component.test.ts), with its own `beforeEach(() => installTestDOM(DOM_CONFIG))` / `afterEach(() => DOM.reset())` hooks, copying the shape of the `Component — destructor disposes style rules` block at line 443. Cover *Expected Behaviour* cases 1-4. Use `new Component({ backgroundColor: '#fff' })` so the component actually materialises a per-instance rule, as that block already explains. Read `_ownedSelectors` through a cast, following the `sizeHooks` helper at the top of the file.

   Verify: the new cases fail.

2. **`Component.untrackSelector`** — in [`core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts), add the private method from *Internal Structure* immediately after `trackSelector` (ends line 1125).

3. **`Component.setId`** — replace lines 1884-1885 with the block from *Internal Structure*. Leave the explanatory comment above it and the `getElement()` / `DOM.sink.setId` / `applyStyle` tail below it untouched.

   Verify: step 1's cases pass.

4. **`Component.destructor` selector sweep** — insert the loop from *Internal Structure* after the `_deferredStyleRules` disposal loop (ends line 1079). `disposeStyleRule` is already imported at line 19. This step pins no new behaviour on its own — step 3 already frees the orphan at `setId` time. It exists so the eager path and the finalizer path free the same collection by construction, rather than by the two happening to agree.

   Verify: `npm test` — the whole suite stays green, including `tests/component/dispose-full-teardown.test.ts`'s rule-cache registry.

5. **Tests for `Event` re-registration** — in [`tests/dom/events.test.ts`](packages/lib/tests/dom/events.test.ts), add *Expected Behaviour* cases 5-7 to the `button` filter describe block that starts around line 268, following its `installTestDOM(CONFIG)` / `makeEvent` / `DOM.sink.dispatchEvent` shape. Case 5 needs a real press-initiating type — use the literal `'mousedown'`, not `uniqueType()`, for the same reason the existing default-filter case at line 277 uses `'pointerdown'`. Add case 8 near the viewport-dispatch cases around line 194.

   Verify: cases 5 and 8 fail; cases 6 and 7 pass.

6. **`Event.registerEntry`** — apply the *Internal Structure* replacement in [`core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts). Update `registerEntry`'s own doc comment (lines 431-436): it currently says "appends … unless that exact `listener` reference is already registered there", which the change makes wrong.

7. **`Event.addViewportListener`** — apply the *Internal Structure* replacement.

   Verify: cases 5 and 8 now pass; `npm test` stays green.

8. **`Event` public JSDoc** — state the contract on all three registration entry points:
   - `addListener`'s two-argument overload (line 521) and registration overload (line 538);
   - `addSubtreeListener`'s overloads (lines 596 and 606);
   - `addViewportListener` (line 762).

   One `@remarks` sentence each, to this effect: *re-registering the same function reference does not add a second listener — it replaces that registration's options (`addListener` / `addSubtreeListener`) or is ignored (`addViewportListener`); a fresh inline closure has no identity to match, so a site that can run more than once must pass a stable reference.*

9. **`HeaderCell` stable click handler** — in [`component/table/cell/Header.ts`](packages/lib/src/typescript/lib/component/table/cell/Header.ts), add a private method beside the existing `onSortClick` (line 602):

   ```typescript
   /**
    * Subtree `click` handler. A named method rather than an inline closure so
    * a re-registration — this cell's `init()` running again against a rebuilt
    * element — dedupes against the entry already registered instead of
    * stacking a second one.
    *
    * @param e - The click event; its shift state selects additive sorting.
    */
   private onSortHeaderClick(e: MouseEvent): void {
       this.onSortClick(e.shiftKey);
   }
   ```

   Then change line 246 to `Event.addSubtreeListener(this, 'click', this.onSortHeaderClick);`. The dispatcher invokes every listener as `entry.listener.apply(compFunc.component, [evnt])` ([`Event.ts:328`](packages/lib/src/typescript/lib/core/Event.ts#L328)), so a plain prototype method receives the right `this` — the same way the `this.onContextMenu` registration on the next line already does.

10. **`WebGLCanvas` stable context-restore handler** — in [`component/display/WebGLCanvas.ts`](packages/lib/src/typescript/lib/component/display/WebGLCanvas.ts), add a field directly after `_onContextLost` (ends line 149):

    ```typescript
    // Stable reference, not an inline closure, so re-registering on a rebuilt
    // element dedupes against the existing entry. Mirrors `_onContextLost`.
    private readonly _onContextRestored: () => void = () => {
        this._contextLost        = false;
        this._contextInitialised = false;
        this.syncBackingStore();
    };
    ```

    Then collapse lines 451-455 to `Event.addListener(this, "webglcontextrestored", this._onContextRestored);`. The body moves verbatim; nothing else changes. The field is framework-internal bookkeeping, so per ARCHITECTURE.md's third DOM-write rule it gets no `WebGLCanvasOptions` entry and no setter.

    Verify: `grep -rnE "Event\.add(Subtree|Viewport)?Listener\(.*(=>|function\b)" packages/lib/src/typescript/lib/component/table/cell/Header.ts packages/lib/src/typescript/lib/component/display/WebGLCanvas.ts` — expect zero matches.

11. **`AbstractStore` JSDoc remark** — in [`data/AbstractStore.ts`](packages/lib/src/typescript/lib/data/AbstractStore.ts), extend the class JSDoc's existing `@remarks` (the block ending at line 162) with a paragraph to this effect: *the store's listener bag needs no teardown hook. Nothing in the framework holds a store instance — there is no module-level store registry, and the shared sort/filter worker keys its snapshots by a plain string id with no back-reference — so a discarded store's bag is collected with it. The retention that does matter runs the other way: a long-lived store holding a subscription a destroyed component never removed. That is released by each component's own `destructor()` calling `store.off(…)`, not by anything the store could do.*

12. **`Router` JSDoc remark** — in [`router/Router.ts`](packages/lib/src/typescript/lib/router/Router.ts), extend `stop()`'s doc comment (lines 154-159) with a sentence to this effect: *`stop()` is the router's whole teardown surface. The window-level listener it removes is the only thing that holds a router once the app drops it; the private listener bag is a plain field collected with the instance, so there is nothing further to release.*

13. **Diagnostics `override` normalisation** — delete the `override` keyword from the `destructor()` signature in each of [`DiagnosticsOverlay.ts:205`](packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts#L205), [`StyleAuditOverlay.ts:132`](packages/lib/src/typescript/lib/diagnostics/StyleAuditOverlay.ts#L132), and [`StyleAuditView.ts:96`](packages/lib/src/typescript/lib/diagnostics/StyleAuditView.ts#L96) — each becomes `protected destructor(): void {`. Do not touch the `override onExitAction()` members in the first two files.

    Verify: `grep -rn "override destructor" packages/lib/src/typescript` — expect zero matches.

14. **Changelog** — add a `## Fixed` → `### Core` section to [`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) (currently header-only) with the three consumer-visible entries listed under *Documentation Impact*.

15. **Events concept doc** — add the re-registration subsection described under *Documentation Impact* to [`docs/concepts/events.md`](packages/lib/docs/concepts/events.md).

16. **Verify** — run the full sequence in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Event.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/WebGLCanvas.ts` |
| Modify | `packages/lib/src/typescript/lib/data/AbstractStore.ts` |
| Modify | `packages/lib/src/typescript/lib/router/Router.ts` |
| Modify | `packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts` |
| Modify | `packages/lib/src/typescript/lib/diagnostics/StyleAuditOverlay.ts` |
| Modify | `packages/lib/src/typescript/lib/diagnostics/StyleAuditView.ts` |
| Modify | `packages/lib/tests/component/Component.test.ts` |
| Modify | `packages/lib/tests/dom/events.test.ts` |
| Modify | `packages/lib/docs/concepts/events.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every case is unit-testable offline against the modelled DOM harness. Nothing here needs a browser.

**`setId` and style-rule ownership** — `tests/component/Component.test.ts`:

1. **A post-render `setId` deletes the old rule.** Build `new Component({ backgroundColor: '#fff' })`, render it, capture `id = c.getId()`, then `c.setId('renamed')`. Afterwards `_ruleCacheHas('#' + id)` is `false`, `_ruleCacheHas('#renamed')` is `true`, and the recording sink has a `{ op: 'deleteStyleRule', args: ['#' + id] }` write. (The new rule materialises because `setId` ends with an `applyStyle` call, which replays the instance's cached style onto the fresh `StyleRule` — see the `_instanceStyle` field comment at `Component.ts:554-558`.)
2. **A construction-time id leaves no orphan tracked.** `new Component({ id: 'fixed-id', backgroundColor: '#fff' })` ends with `_ownedSelectors` equal to `['#fixed-id']` — one entry, not two. (The auto-uuid rule is never materialised at this point, so nothing is deleted from the stylesheet; the assertion is purely about the tracked set.)
3. **Re-setting the same id changes nothing.** After `c.setId(c.getId())` on a rendered component, `_ownedSelectors` still holds exactly one entry and `_ruleCacheHas('#' + id)` is still `true` — no dispose, no duplicate tracking entry.
4. **Teardown after a rename leaves no rule behind.** Render, `setId('renamed')`, then `destructor()`. `_ruleCacheKeys()` contains no key starting `'#' + oldId` and none starting `'#renamed'`.

**`Event` re-registration** — `tests/dom/events.test.ts`:

5. **A re-registration re-configures the listener's options.** On a fresh `Component`, register a stable function `f` bare for `'mousedown'` (the unset filter resolves to primary-only), then register the *same* `f` again as `{ button: 'any', handler: f }`. Dispatching `mousedown` with `{ button: 2 }` fires `f` exactly once. (Before the change it fires zero times.)
6. **A re-registration does not add a second listener.** Register the same stable `f` twice for a `uniqueType()`; one dispatch runs `f` once.
7. **Distinct references still both register.** Register two different functions for the same `(component, type)`; one dispatch runs both.
8. **A repeated viewport registration is ignored.** Register the same stable `f` twice through `addViewportListener` for a `uniqueType()`; one dispatch runs `f` once. (Before the change it runs twice.)

**Unchanged by construction** — no new test:

9. `HeaderCell`'s sort click and `WebGLCanvas`'s context-restore behave exactly as before; only the identity of the registered function changes. The existing `HeaderCell` and canvas suites are the regression guard.
10. `AbstractStore` and `Router` gain no runtime change at all — documentation only.
11. The three diagnostics `destructor()` bodies are untouched; only the modifier list changes.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — full suite green. Pay particular attention to `tests/component/dom-state-replay-probe.test.ts`'s *registers an init()-installed listener once across a rebuild* case (line 210) and `tests/component/element-release.test.ts`, which both exercise the `Event` dedup path this plan changes.
- `npm run lint` — no new findings.
- `npm run docs:api` — must finish with **zero** warnings (public JSDoc changed; see CODE_CONVENTIONS.md).
- `grep -rn "override destructor" packages/lib/src/typescript` — zero matches.
- `grep -rnE "Event\.add(Subtree|Viewport)?Listener\(.*(=>|function\b)" packages/lib/src/typescript/lib/component/table/cell/Header.ts packages/lib/src/typescript/lib/component/display/WebGLCanvas.ts` — zero matches.
- `grep -n "listeners.push" packages/lib/src/typescript/lib/core/Event.ts` — two matches (in `registerEntry` and `addViewportListener`), each preceded by an early-return dedup guard. **This replaces the older invariant** recorded in [`plans/implemented/component-element-release.md`](plans/implemented/component-element-release.md), which asserted that every push sits *inside* an `includes` guard; the guards become early returns here.
- Manual smoke (optional, and the only part not covered above): open the demo app (`npm run dev`, http://localhost:8015), sort a table column by clicking its header and shift-clicking a second one — `HeaderCell`'s converted handler is on that path.

---

## Documentation Impact

No exported symbol is added, removed, or renamed, so no catalog, sidebar, or `llms.txt` entry changes. Two docs surfaces do change:

- **[`docs/concepts/events.md`](packages/lib/docs/concepts/events.md)** — add a short subsection, *Re-registering a listener*, directly after the existing *DOM event removal* section (which ends around line 200 with the "Disposing a component drops every registration…" paragraph). It states the contract and shows the three cases from the *Architecture Decisions* table: same reference with the same options is a no-op; same reference with new options re-configures the existing registration; a fresh inline closure adds a second listener that fires twice and can never be removed, which is why a site that can run more than once must pass a stable reference. This sits naturally beside the existing "Anonymous arrow functions cannot be removed" note.
- **[`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — a `## Fixed` → `### Core` section with three bullets, matching the voice of `0.8.0.md`'s `## Fixed` → `### Core` section (bold lead sentence, then the explanation, then whether consumer action is needed):
  1. `setId` on an already-rendered component now deletes the `#<old-id>` rule it replaces instead of leaving it on the shared stylesheet.
  2. Re-registering an already-registered listener reference through `Event.addListener` / `addSubtreeListener` now applies the new call's `button` / `stop` / `prevent` options instead of silently keeping the first registration's.
  3. `Event.addViewportListener` now ignores a repeat registration of the same function reference instead of registering it a second time and firing it twice.

`routing.md` and the data-store docs need no edit — steps 11 and 12 add source JSDoc only, and neither changes a documented behaviour.

---

## Potential Challenges

- **The `Event` dedup is a shared path.** Every DOM-routed registration in the library flows through `registerEntry`. *Mitigation:* the change is confined to the already-matching branch (previously a silent drop), so only a call site that re-registers the same reference with *different* options can observe it — and that site was getting the wrong options before. The full suite is the guard.
- **Viewport dedup changes behaviour for every `addViewportListener` call site.** *Mitigation:* they all pass a stable `_bound*` field, a prototype method, or a module-level function, and `removeViewportListener` only ever splices one entry — so a duplicate registration today already leaves an unremovable entry behind. Deduping is strictly the safer side. (The two exceptions, `SpinButton.ts:152-153`, pass inline closures; they are unremovable either way and the change does not affect them.)
- **`_ownedSelectors` is read by the GC finalizer.** [`trackHandle`](packages/lib/src/typescript/lib/core/Component.ts#L1112) registers the *live array* as the finalizer's held value. *Mitigation:* `untrackSelector` and the destructor sweep both mutate that array in place rather than replacing it, so the finalizer keeps seeing the current set; and `destructor` unregisters the finalizer a few lines later anyway.
- **Two tests share the literal event type `'mousedown'` / `'pointerdown'`.** `Event`'s module-level maps have no reset hook. *Mitigation:* buckets are keyed by component id and every test builds a fresh `Component`, so two tests using the same literal type never collide — the existing case at `events.test.ts:277` already relies on this.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `_ownedSelectors` (431), `trackHandle` (1112), `trackSelector` (1123), `untrackHandle` (1134, the precedent `untrackSelector` mirrors), `destructor` (956), `createStyleRule` (1209), `release` (1286), `canRelease` (3878), `setId` (1868).
- [`packages/lib/src/typescript/lib/core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts) — `ListenerEntry` (15), `ListenerOptions` (36), the dispatcher's `listener.apply(compFunc.component, …)` (285, 328), `registerEntry` (437), `addViewportListener` (762).
- [`packages/lib/src/typescript/lib/core/StyleTarget.ts`](packages/lib/src/typescript/lib/core/StyleTarget.ts) — `disposeStyleRule` (229) and `StyleRule.dispose` (392); read to confirm disposal is idempotent and no-ops for a never-materialised selector.
- [`plans/implemented/component-element-release.md`](plans/implemented/component-element-release.md) — introduced the reference dedup this plan extends, and named the inline-closure gap as a deferred follow-up. Read its *The listener double-register fix is idempotent registration in `Event`* decision before touching `registerEntry`.
- [`plans/implemented/buttongroup-binding-dispose-lifecycle.md`](plans/implemented/buttongroup-binding-dispose-lifecycle.md) — the `dispose()`-on-a-plain-class precedent this plan deliberately does not follow for `AbstractStore` / `Router`.
- [`packages/lib/tests/component/dom-state-replay-probe.test.ts`](packages/lib/tests/component/dom-state-replay-probe.test.ts) — `ListenerOnInitComponent` (93) and the rebuild-idempotency case (210); the existing regression guard for the path step 6 changes.
- [`packages/lib/tests/component/Component.test.ts`](packages/lib/tests/component/Component.test.ts) — the *destructor disposes style rules* block (443) is the template for step 1.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Event handling*, and its *Listeners must reference a named function* rule.

---

## Non-Goals

- **No `dispose()` on `AbstractStore` or `Router`.** Investigation found nothing that holds either past its owner, and `Router.stop()` already releases the one real pin. Adding an unused teardown method would also be a footgun on a store shared by several views, where clearing the bag would drop other views' subscriptions.
- **No sweep of the constructor-level inline-closure registrations.** A constructor does not re-run on a rematerialize, so none of them can stack. ARCHITECTURE.md wants them named for other reasons (removability, stack traces, greppability); that is a separate cleanup.
- **No new ESLint rule for inline listeners.** Considered and rejected.[^no-lint-rule]
- **`setId` does not re-point the deferred state rules.** `createStyleRule` builds `#<id><suffix>` selectors from the id current at allocation time, so a post-render `setId` leaves a component's `:hover` / `.pressed` rules matching the old id. Stale state rules are a styling bug, not a leak — `destructor` still disposes those wrappers — and no library call site triggers the situation, because `applyOptions` dispatches `setId` first, before any setter can allocate a state rule. A fix means re-pointing every deferred rule and replaying its cached declarations, which is its own change.
- **No eviction of the sort/filter worker's per-store snapshot.** [`StoreWorker.ts:50`](packages/lib/src/typescript/lib/data/StoreWorker.ts#L50) keeps `snapshots.set(storeId, records)` forever, so a discarded store leaks its record copy in the worker. That leak is real, but it is a cross-thread data leak needing a new worker message type, not a listener-bag concern.
- **No `override` changes outside `destructor()`.** The other 17 uses of the keyword under `packages/lib/src/typescript` are not a 54-vs-3 minority against an established local convention; `TreeStore`, for one, uses it consistently across its own file.
- **The component-level leaks tracked by the `component-lifecycle-leak-fixes-round-2` plan** (`TreeRow`, `SelectableListRow`, `FieldSet`, `ComboBoxLabel`, and the campaign's stale regression-guard tests) are out of scope. That plan and this one both touch `core/Component.ts` and `changelog/next.md`; land them one at a time.

---

## Notes

[^selector-symmetry]: `_ownedSelectors` is the only one of `Component`'s four teardown-tracking collections that `destructor` neither drains nor clears — `_ownedHandles` (426), `_themeCleanups` (437), and `_destroyCleanups` (445) are all iterated and then reset. That asymmetry is what let the `setId` orphan survive: `destructor` disposes the *current* `_styleRule` and the `_deferredStyleRules` values, which is normally the same set `_ownedSelectors` holds, and then unregisters the finalizer that would otherwise have swept the array. The moment `setId` puts a selector in the array with no wrapper pointing at it, the two teardown paths disagree about what the component owns, and the eager path — the only one that actually runs, since `unregister` disarms the other — frees less. Fixing `setId` alone would close today's gap; sweeping the array in `destructor` as well makes the two paths free the same set by construction, which is the property that was supposed to hold.

[^options-refresh]: Three shapes were considered for a same-reference re-registration. (a) Keep dropping it — the status quo; rejected, because a rebuilt element's `init()` re-run then silently keeps whatever the first registration passed, and there is no way to tell from the call site that the new options were ignored. (b) Throw when the options differ — rejected: it adds an error path for something that is not an error (a component legitimately re-registering the same handler with a different `button` filter at runtime), and CLAUDE.md's *Simplicity First* argues against error handling for scenarios that are merely surprising. (c) Overwrite the options — chosen. It is the natural reading of "register this listener with these options", it makes an identical re-registration a true no-op, and it is one line. Note `passive` is unaffected either way: it is validated per *type* by `installBaseListener`, which runs before the dedup and throws on conflict.

[^viewport-dedup]: `addViewportListener` never got the guard that [`plans/implemented/component-element-release.md`](plans/implemented/component-element-release.md) added to `addListener` and `addSubtreeListener` — that plan's *third failure shape* enumerated only the two id-routed maps. `Body.init` registers `Event.addViewportListener(this, "resize", this._onViewportResize)` ([`core/Body.ts:213`](packages/lib/src/typescript/lib/core/Body.ts#L213)), so the viewport surface is reachable from an `init()` re-run today. The drag-start sites are the other exposure: `AbstractWindow`, `Scrollbar`, `SplitGutter`, and `WindowBorder` all register viewport `mousemove`/`mouseup` handlers on gesture start and remove them on gesture end, and `removeViewportListener` splices exactly one entry — so a second gesture start without an intervening end leaves an entry that nothing will ever remove.

[^closure-enumeration]: Derived by walking every `Event.add(Subtree|Viewport)?Listener` call under `packages/lib/src/typescript` (254 at the time of writing) and attributing each to its enclosing method — roughly 116 in constructors, 25 in `init()`, 2 in `render()`, the rest in one-shot installers or per-target wiring, plus two matches inside JSDoc examples (`Menu.ts`, `Popover.ts`) that are not call sites at all. Re-derive the counts rather than trusting these; what matters is the classification, not the totals. Of the sites whose listener argument is an inline function, only two sit in a method a rematerialize replays: `HeaderCell.init` (Header.ts:246) and `WebGLCanvas.render` (WebGLCanvas.ts:451). Every other `init()`/`render()`-time registration already passes a bound field or a prototype method — `Tree`, `DiagramView`, `TabBar`, table `Body`, `ResizeHandle`, `ParentHeader`, `core/Body`. The remaining re-entrant-*looking* sites are guarded or per-target and were each checked: `Cell.setActiveRenderer` registers only when its `isNewChild` argument is true, `CellEditorPool.wireListeners` runs once per pooled editor at that editor's construction, and `Slider.installInteraction` / `VirtualScroller.attachTouchHandlers` are each called from exactly one place — their own constructor.

[^no-store-dispose]: Checked three ways. (1) No module-level registry holds a store or a router: the only module-level collections under `lib/data/` are `StoreWorkerClient`'s `pending` request map and the worker's own `snapshots` map, and the latter holds plain record data keyed by a string id with no reference back to the store. (2) No cross-store subscription exists — nothing under `lib/data/` calls `.on(…)` on another store, so `AbstractStore._listeners` only ever holds consumer/component listeners. (3) The bag is a plain instance field on both classes, so a discarded store or router takes its bag with it. A `dispose()` that only cleared the bag would therefore free nothing. This is what makes these two different from a `Component`, whose bags the `registerListenerBag` retrofit had to clear precisely because a destroyed component is routinely still reachable — from a row pool, a parent's stale array, or a module-level map — and its bag would otherwise keep everything its listeners captured alive.

[^router-pin]: `Router.start()` installs a window-level `hashchange` (hash mode) or `popstate` (History mode) native listener via `DOM.sink.addListener` ([`Router.ts:145-148`](packages/lib/src/typescript/lib/router/Router.ts#L145)), holding `_onHashChange` / `_onPopState`, which hold the router, which holds the route table and the listener bag. That is a genuine pin, and it is exactly what `stop()` removes. [`docs/concepts/routing.md`](packages/lib/docs/concepts/routing.md) already documents `stop()` in those terms — "call it when the router itself is being torn down; an installed listener that is never removed leaks the router and everything its handlers close over". A `dispose()` would be an alias for `stop()` plus a bag clear that frees nothing.

[^diverge-from-buttongroup]: `Binding.dispose()` earned its place: `Binding.bind()` registers closures into *other* objects' listener bags, and nothing else would ever deactivate them — a real "listen to something I don't own" case. `ButtonGroup.dispose()` is bag-clearing only, and its own plan justified it on the grounds that the group's other registrations self-release, not on the grounds that the bag pins anything. Following it here would mean adding two methods that free nothing, against CLAUDE.md's *Simplicity First*. The divergence is deliberate and is stated here rather than left for a reader to notice.

[^no-lint-rule]: A `local/stable-event-listener` rule reporting an inline function argument to `Event.add*Listener`, with a generated baseline, would follow the `no-raw-dom` / `require-content-bounds` precedent and would mechanically enforce ARCHITECTURE.md's existing named-reference rule. Rejected on signal-to-noise: it would report 74 sites, of which 72 are in constructors or one-shot installers where re-registration cannot happen, so the baseline would carry essentially the whole finding and the rule would guard almost nothing this plan has not already fixed. The named-reference rule is worth enforcing for its *other* reasons — removability, stack traces, greppability — and that is a cleanup pass that should convert the sites rather than baseline them.
