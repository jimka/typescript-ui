---
depends-on: [elk-layout-web-worker]
---

# ELK Worker Termination — Implementation Plan

## Overview

`ElkLayoutEngine` can now run ELK layout in a consumer-supplied Web Worker, built lazily on the first `layout()` call ([ElkLayoutEngine.ts:465](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L465)). Nothing ever shuts that worker down. Every `DiagramView` that lays out once strands a worker thread for the page's lifetime, and the main-thread fallback strands a second one each time it fires — the gap recorded in the prerequisite plan's own Implementation Notes ([elk-layout-web-worker.md](plans/implemented/elk-layout-web-worker.md)).

This plan adds the disposal path. `ElkLayoutEngine` gains a public `dispose()` that calls elkjs's `terminateWorker()` on the instance it holds, and `DiagramView` gains a `destructor()` override that reaches it. Disposal also becomes part of the existing fallback: the worker-backed instance the fallback abandons is terminated before the reference is dropped.

The change touches three source files — the engine ([ElkLayoutEngine.ts](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts)), its elkjs type shim ([elkjs.d.ts](packages/lib/src/typescript/lib/component/diagram/elkjs.d.ts)), and the view ([DiagramView.ts](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts)) — plus three test files and the diagram docs page. No new exported type, so no barrel change.

---

## Architecture Decisions

### `dispose()` on the engine, `destructor()` on the view

`ElkLayoutEngine` gets a public, idempotent `dispose()`. `DiagramView` gets a `protected destructor()` override that calls it and then `super.destructor()`.

That split is the codebase's established teardown shape, set by [component-teardown-seam.md](plans/implemented/component-teardown-seam.md): `dispose()` is the public call entry point, `destructor()` is the override hook a subclass uses to release its own resources ([Component.ts:715](packages/lib/src/typescript/lib/core/Component.ts#L715), [Component.ts:732](packages/lib/src/typescript/lib/core/Component.ts#L732)). [`Canvas.destructor`](packages/lib/src/typescript/lib/component/display/Canvas.ts#L331) and [`StatusBar.destructor`](packages/lib/src/typescript/lib/component/container/StatusBar.ts#L323) are the pattern being copied: stop the owned resource, then chain to `super`. For the engine itself — a plain class, not a `Component` — the precedent is [`StyleRule.dispose`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L305), a non-`Component` class whose teardown verb is likewise a public, idempotent, documented-as-idempotent `dispose()`.[^teardown-precedent]

Overriding `destructor()` rather than `dispose()` matters: an ancestor tearing down its subtree calls `child.destructor()` directly ([Component.ts:749](packages/lib/src/typescript/lib/core/Component.ts#L749)), never `dispose()`. A `DiagramView` nested inside a disposed container is only reached through the `destructor()` hook.

### Only a factory-built instance may be terminated

`dispose()` calls elkjs's `terminateWorker()` **only** when the engine built its ELK instance from a consumer `workerFactory`. In every other mode elkjs is driving an in-process stand-in worker that has no `terminate` method, and asking elkjs to terminate it throws a `TypeError`.[^fake-worker]

This is not the same condition as the existing `_workerBacked` flag, which means "a worker was *requested*, so one main-thread fallback is still available". The `workerUrl` mode sets `_workerBacked` but never produces a real worker. A second field, `_ownsWorker`, carries the narrower "there is a real `Worker` behind this instance" fact:

| Mode | `_workerBacked` | `_ownsWorker` | `dispose()` calls `terminateWorker()`? |
|---|---|---|---|
| neither option (main thread) | `false` | `false` | no |
| `workerFactory` | `true` | `true` | **yes** |
| `workerUrl` only | `true` | `false` | no — elkjs never built a real worker in this mode |
| after the main-thread fallback | `false` | `false` | no |

### A disposed engine never lays out again

After `dispose()`, `layout()` rejects immediately with `Error("ElkLayoutEngine has been disposed")` and constructs nothing. It does not rebuild, does not resurrect a worker, and does not resolve with an empty result.[^reject-not-empty]

### A construction still in flight when disposal lands is terminated, not adopted

`dispose()` can run while the very first `layout()` is still awaiting elkjs's dynamic import. At that moment the engine holds no instance, so `dispose()` has nothing to terminate — and moments later the import resolves and builds a worker. `ensureElk` therefore re-checks the disposed state after the build completes: if the engine was disposed in the meantime it terminates the instance it just built, throws, and never stores it.[^adopt-check]

The guarantee this yields, and the one to state to consumers: **no Web Worker outlives `dispose()`** — one built by a construction already in flight is terminated as soon as it exists.

### The fallback terminates the worker it abandons

When a worker-backed layout fails, `layout()`'s catch block replaces `_elk` with a fresh main-thread instance ([ElkLayoutEngine.ts:424-436](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L424)). The abandoned instance's worker is now terminated first, before the reference is dropped. Without this, a diagram that falls back leaks a worker even if it is later disposed correctly, because `dispose()` can only reach the instance the engine still holds.

### A layout in flight when disposal lands is dropped, not awaited

Disposal is immediate. `DiagramView.destructor()` bumps `_layoutGeneration` before disposing the engine, so a result that lands afterwards is stale and dropped by the existing guards in [`applyLayout`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L447) and [`handleLayoutFailure`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L532). Reusing the view's own generation token — rather than adding a disposed flag to the view — keeps one mechanism for "this layout result no longer matters".[^generation]

For a real worker there is usually no result at all: elkjs does not reject its pending requests on `terminateWorker()`, so a `layout()` promise outstanding at that moment never settles. That is stated as part of the contract below.

---

## Public API

### `ElkLayoutEngine` (new method)

```typescript
class ElkLayoutEngine {
    constructor(options?: ElkLayoutEngineOptions);
    layout(
        data: DiagramData,
        sizes: Map<string, { width: number; height: number }>,
        defaults?: Record<string, string>,
    ): Promise<DiagramLayoutResult>;

    /** NEW. Idempotent. Terminates the ELK Web Worker, if this engine owns one. */
    dispose(): void;
}
```

No new exported type, so [`component/diagram/index.ts`](packages/lib/src/typescript/lib/component/diagram/index.ts) is unchanged — `ElkLayoutEngine` is already re-exported there ([index.ts:11](packages/lib/src/typescript/lib/component/diagram/index.ts#L11)), and TypeDoc picks up a new public method on an already-documented class automatically.

### `DiagramView` (no new signature)

`DiagramView` gains a `protected destructor(): void` override. `dispose()` is unchanged and inherited from `Component`; `destructor()` is protected and so does not appear in the generated API docs.

### `elkjs.d.ts` shim (extended)

```typescript
export default class ELK {
    constructor(options?: ElkConstructorOptions);
    layout(graph: unknown): Promise<unknown>;
    terminateWorker(): void;   // added
}
```

The engine's internal structural type `ElkInstance` ([ElkLayoutEngine.ts:81](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L81)) gains the same `terminateWorker(): void;` member.

### Consumer contract — what the downstream app calls

Stated here so the dependent sqladmin plan can be written against it without reading library internals:

- **Call `view.dispose()` on a `DiagramView` you are permanently discarding** — closing its dock tab, removing its panel, or replacing the content of a slot it sits in. `dispose()` is public, takes no arguments, returns `void`, and is idempotent.
- **A `DiagramView` that is a registered child of a component being disposed needs no explicit call** — the base class's subtree recursion reaches its `destructor()`. An explicit `dispose()` is needed only where the view (or a panel owning it) is dropped without an ancestor being torn down.
- **Guarantee:** after `dispose()` returns, the view's ELK Web Worker has been terminated, and no worker outlives the call — including one whose construction was still in flight.
- **Guarantee:** a layout in flight at disposal never writes back into the view. With a real worker it typically never settles at all; if it does settle, the result is discarded.
- **Not guaranteed:** the view is not reusable afterwards. Calling `setData()` on a disposed view is unsupported (see `## Non-Goals`).
- **No app code touches `ElkLayoutEngine`.** The engine is created and disposed by `DiagramView`; the app's only verb is `view.dispose()`.

---

## Internal Structure

New and changed members of `ElkLayoutEngine`:

```typescript
/** Message carried by the rejection a disposed engine's `layout` produces. */
const DISPOSED_MESSAGE = "ElkLayoutEngine has been disposed";

/** True once `dispose` has run. A disposed engine never builds another ELK. */
private _disposed = false;

/**
 * True while the ELK instance this engine holds — or is in the middle of
 * building — drives a real Web Worker, which is the consumer-factory mode and
 * only that mode. Cleared when the main-thread fallback replaces the instance.
 * Deliberately NOT cleared by `dispose`: a construction still in flight sets
 * this just before it builds, and the adopt-time check needs it afterward to
 * terminate an instance `dispose` could not yet see.
 */
private _ownsWorker = false;

async layout(data, sizes, defaults): Promise<DiagramLayoutResult> {
    if (this._disposed) {
        throw new Error(DISPOSED_MESSAGE);
    }

    const graph = buildElkGraph(data, sizes, defaults);

    try {
        const elk = await this.ensureElk();

        return mapElkResult(await elk.layout(graph) as ElkNode);
    } catch (error) {
        // Disposed mid-flight: the engine is gone for good, so there is
        // nothing to fall back onto. Main-thread failure: elkjs itself is
        // absent/broken. Either way, propagate.
        if (this._disposed || !this._workerBacked) {
            throw error;
        }

        // Terminate the worker being abandoned before the reference is
        // dropped, then rebuild on the main thread and retry once.
        this.terminateOwnedWorker(this._elk);
        this._workerBacked = false;
        this._ownsWorker   = false;
        this._elk          = await this.createMainThreadElk();

        return mapElkResult(await this._elk.layout(graph) as ElkNode);
    }
}

dispose(): void {
    this._disposed = true;

    this.terminateOwnedWorker(this._elk);

    this._elk = null;
}

private async ensureElk(): Promise<ElkInstance> {
    if (this._elk) {
        return this._elk;
    }

    const elk = await this.createElk();

    if (this._disposed) {
        // `dispose` ran while ELK was still being imported and constructed,
        // so it saw no instance to terminate. Terminate this one rather than
        // adopting it, or the worker outlives the disposed engine.
        this.terminateOwnedWorker(elk);

        throw new Error(DISPOSED_MESSAGE);
    }

    this._elk = elk;

    return this._elk;
}

private terminateOwnedWorker(elk: ElkInstance | null): void {
    if (elk && this._ownsWorker) {
        elk.terminateWorker();
    }
}
```

In `createElk`, the `workerFactory` branch sets `this._ownsWorker = true;` alongside the existing `this._workerBacked = true;`, before constructing. The `workerUrl` branch and the default branch are unchanged: `_ownsWorker` starts `false`, and `createElk` runs at most once per engine.[^create-once]

`DiagramView`:

```typescript
protected destructor(): void {
    // Invalidate any layout still in flight before the engine goes away. A
    // result landing afterwards would write into a torn-down view, and a
    // failure landing afterwards would strip nodes off it; both guards
    // compare against this token and drop a stale one.
    this._layoutGeneration += 1;

    this._engine.dispose();

    super.destructor();
}
```

---

## Ordered Implementation Steps

1. **`elkjs.d.ts` — declare `terminateWorker`.** Add `terminateWorker(): void;` to the `export default class ELK` declaration ([elkjs.d.ts:20-23](packages/lib/src/typescript/lib/component/diagram/elkjs.d.ts#L20)), with a one-line JSDoc noting it is only safe on an instance built from a `workerFactory`.
   - Check: `grep -c terminateWorker packages/lib/src/typescript/lib/component/diagram/elkjs.d.ts` — 1.

2. **`ElkLayoutEngine.ts` — extend `ElkInstance`.** Add `terminateWorker(): void;` to the structural type at [L81-83](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L81).

3. **`ElkLayoutEngine.ts` — add the module constant and the two fields.** Add `DISPOSED_MESSAGE` beside the file's other module-level constants, and `_disposed` / `_ownsWorker` beside `_workerBacked` ([L387](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L387)), with the JSDoc from *Internal Structure*.

4. **`ElkLayoutEngine.ts` — add `terminateOwnedWorker`.** Private helper, placed with the other private methods. Its JSDoc carries the reason the guard exists (a non-factory instance runs on an in-process stand-in worker with no `terminate`).

5. **`ElkLayoutEngine.ts` — set `_ownsWorker` in `createElk`.** In the `workerFactory` branch ([L470-474](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L470)) add `this._ownsWorker = true;` next to the existing `this._workerBacked = true;`, before `new ELK({ ... })`.
   - Check: `grep -c '_ownsWorker = true' packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts` — 1, inside `createElk`'s `workerFactory` branch.

6. **`ElkLayoutEngine.ts` — add the adopt-time check to `ensureElk`.** Replace the body per *Internal Structure*: build into a local, check `_disposed`, terminate-and-throw or store.

7. **`ElkLayoutEngine.ts` — update `layout`.** Add the entry guard, add `this._disposed ||` to the catch's propagate condition, and add the terminate + `_ownsWorker = false` lines to the fallback, per *Internal Structure*.

8. **`ElkLayoutEngine.ts` — add `dispose()`.** Public method placed after `layout` and before the private methods. JSDoc: what it terminates, that it is idempotent, that a later `layout()` rejects, and that a request outstanding in a real worker never settles. Only `{@link}` public symbols.

9. **`ElkLayoutEngine.ts` — update the class JSDoc** ([L360-374](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L360)) to mention that the engine owns a worker until disposed, and that its owner is expected to call `dispose()`.

10. **`DiagramView.ts` — add the `destructor()` override.** Place it after `createEngine` ([L280](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L280)), body per *Internal Structure*.
    - Check: `grep -n 'destructor' packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` — two hits (the override and its `super` call).

11. **`ElkLayoutEngine.test.ts` — extend the existing harness.** Add a module-level `const terminateWorkerMock = vi.fn();`, give `MockELK` an `options` field captured in its constructor and a `terminateWorker() { terminateWorkerMock(this.options); }` method, and reset the mock in the suite's `beforeEach` ([L424-428](packages/lib/tests/component/diagram/ElkLayoutEngine.test.ts#L424)). Add cases E1–E8 from *Expected Behaviour* to the existing `'ElkLayoutEngine — worker modes and fallback'` describe (or a new sibling describe in the same file). Do **not** create a second mocking harness.

12. **`DiagramView.test.ts` — extend `StubEngine`.** Add a `disposed = 0` counter with a `dispose(): void { this.disposed += 1; }`, and a `rejectDeferred(index, error)` beside the existing `resolveDeferred` ([L47-49](packages/lib/tests/component/diagram/DiagramView.test.ts#L47)). Add cases D1–D4.
    - Check: the pre-existing tests in this file are untouched and still green.

13. **`DiagramView.createEngine.test.ts` — add the real-elkjs disposal cases R1 and R2.** This file mocks nothing, so it is the only place the real `terminateWorker()` guard is exercised.

14. **Docs — `packages/lib/docs/components/DiagramView.md`.** Add a `dispose()` row to the *Common methods* table ([L99-113](packages/lib/docs/components/DiagramView.md#L99)), a bullet to *Running ELK layout in a Web Worker* ([L137-140](packages/lib/docs/components/DiagramView.md#L137)), and update the *Off-thread layout* Notes bullet ([L146](packages/lib/docs/components/DiagramView.md#L146)) — content in *Documentation Impact*.

15. **Full gate.** `npm run typecheck`, `npm test`, `npm run build:lib`, `npm run docs:api` — see *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/elkjs.d.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` |
| Modify | `packages/lib/tests/component/diagram/ElkLayoutEngine.test.ts` |
| Modify | `packages/lib/tests/component/diagram/DiagramView.test.ts` |
| Modify | `packages/lib/tests/component/diagram/DiagramView.createEngine.test.ts` |
| Modify | `packages/lib/docs/components/DiagramView.md` |

---

## Expected Behaviour

### Unit-testable — `ElkLayoutEngine.test.ts` (elkjs mocked)

Assertions read `terminateWorkerMock`, which records the constructor options of whichever instance was terminated, so a test can tell the worker-backed instance from the main-thread one.

| # | Setup | Expected |
|---|---|---|
| E1 | `new ElkLayoutEngine({ workerFactory })`, never laid out, then `dispose()` | No ELK constructed (`lastConstructorOptions` still `undefined`); `terminateWorkerMock` not called; no throw |
| E2 | `workerFactory`, one successful `layout()`, then `dispose()` | `terminateWorkerMock` called once, with `{ workerFactory }` |
| E3 | No options, one successful `layout()`, then `dispose()` | `terminateWorkerMock` **not** called |
| E4 | `workerUrl` only, one successful `layout()`, then `dispose()` | `terminateWorkerMock` **not** called |
| E5 | `workerFactory`, one successful `layout()`, then `dispose()` twice | `terminateWorkerMock` called exactly once total; second call does not throw |
| E6 | `workerFactory`, one successful `layout()`, `dispose()`, then `layout()` again | Rejects with `"ElkLayoutEngine has been disposed"`; `layoutMock` call count unchanged |
| E7 | `workerFactory`, first `layout()` rejects once then resolves (the existing fallback case) | Layout resolves; `terminateWorkerMock` called once with `{ workerFactory }` at fallback time |
| E8 | Continuing E7: `dispose()` afterwards | `terminateWorkerMock` still at one call total — the main-thread replacement is not terminated |
| E9 | `workerFactory`; call `layout()` without awaiting, call `dispose()` synchronously, then await the layout promise | The promise rejects with `"ElkLayoutEngine has been disposed"`; the factory *was* invoked (construction completed) and `terminateWorkerMock` was called once with `{ workerFactory }` |
| E10 | No options; call `layout()` without awaiting, `dispose()` synchronously, then await | The promise rejects with `"ElkLayoutEngine has been disposed"`; `terminateWorkerMock` not called |

E9/E10 are deterministic without any timer juggling: `layout()` parks at elkjs's dynamic `import`, so a synchronous `dispose()` on the next line always lands inside the construction window.

Every pre-existing case in this file must still pass unchanged.

### Unit-testable — `DiagramView.test.ts` (`StubEngine`)

| # | Setup | Expected |
|---|---|---|
| D1 | `StubDiagramView` with data, then `view.dispose()` | `stubEngine.disposed === 1` |
| D2 | `view.dispose()` twice | No throw |
| D3 | `StubEngine` in `'defer'` mode, view constructed with data, `view.dispose()`, then `resolveDeferred(0, fixedResult())` and flush | No throw; a `"layout"` listener registered before disposal never fires |
| D4 | Same, but `rejectDeferred(0, new Error('elkjs unavailable'))` after disposal | No throw; no unhandled rejection |

### Unit-testable — `DiagramView.createEngine.test.ts` (real elkjs, nothing mocked)

| # | Setup | Expected |
|---|---|---|
| R1 | `new _DiagramView({})`, `await view._engine.layout(...)`, then `view.dispose()` | Does not throw |
| R2 | `new _DiagramView({ elkWorkerUrl: 'https://example.com/elk-worker.js' })`, `await view._engine.layout(...)`, then `view.dispose()` | Does not throw |

R1 and R2 are the load-bearing regression tests: real elkjs throws a `TypeError` if either instance is terminated, and R2 in particular fails if the guard is written against `_workerBacked` instead of `_ownsWorker`. The mocked suite cannot catch either, because `MockELK.terminateWorker` never throws.

### Manual verification (browser — not unit-testable)

- **Worker thread released on close.** In sqladmin with `elkWorkerFactory` wired up, open a schema diagram panel and confirm a worker thread appears (DevTools → Sources → Threads). Close the panel — with the dependent app-side plan applied so `dispose()` is actually called — and confirm the thread disappears.
- **No accumulation across rebuilds.** Re-run Explain on the same query tab several times and confirm the worker-thread count stays at one rather than growing per run.
- **Termination while a layout is running.** Start a layout on a large graph and close the panel before it completes. The panel closes cleanly, no console error appears, and the worker thread goes away. (The outstanding `layout()` promise never settles — this is the contract, and nothing observable depends on it.)

---

## Verification

- **Typecheck:** `npm run typecheck` clean. `ElkInstance` and the `elkjs.d.ts` `ELK` class both declare `terminateWorker(): void`, so `this._elk.terminateWorker()` resolves.
- **Unit tests:** `npm test` — E1–E10, D1–D4, R1–R2 pass; every pre-existing diagram test passes unchanged.
- **No unguarded termination:** `grep -c '\.terminateWorker(' packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts` — exactly 1, the call inside `terminateOwnedWorker`. Any second call site means the guard has been bypassed.
- **Field wiring complete:** `grep -c '_ownsWorker' packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts` — 4: the field declaration, the `createElk` assignment, the fallback clear, and the guard inside `terminateOwnedWorker`.
- **Build:** `npm run build:lib` succeeds; `grep -rn 'new Worker\|elk-worker' packages/lib/dist/lib` still returns zero hits (this plan adds no worker construction and names no worker file).
- **Docs:** `npm run docs:api` finishes with **zero** warnings.
- **Lint:** `npm run lint` — note that this command does **not** pass on this branch for a pre-existing, unrelated reason (`component/table/cell/renderer/Link.ts:57`, `local/forward-super-options`), recorded in the prerequisite plan's Implementation Notes. Confirm no *new* diagnostic appears in the files this plan touches rather than expecting a clean run.
- **Manual smoke:** the three browser checks above, run from sqladmin once the dependent app-side plan lands.

---

## Documentation Impact

- **No barrel change.** `dispose()` is a new method on `ElkLayoutEngine`, which [index.ts:11](packages/lib/src/typescript/lib/component/diagram/index.ts#L11) already re-exports, so TypeDoc documents it automatically. This plan introduces no new exported interface or type, so it does not repeat the problem the prerequisite plan hit with `ElkLayoutEngineOptions` (a new *type* referenced from a documented signature but missing from the barrel's `export type { … }` list, which produced a `docs:api` warning).
- **JSDoc link discipline.** Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), the new public JSDoc on `ElkLayoutEngine.dispose()` may only `{@link}` public symbols — `ElkLayoutEngine.layout` and `ElkLayoutEngineOptions.workerFactory` are fine; `terminateOwnedWorker`, `ensureElk`, `_ownsWorker`, and `_workerBacked` are not, and must be described in prose instead.
- **`docs/components/DiagramView.md` — *Common methods* table.** Add a row, matching the wording style already used on other pages (`CodeEditor.md:102`, `Markdown.md:80`):

  ```markdown
  | `dispose()` | Tear the view down and terminate its ELK Web Worker — call before discarding a `DiagramView` that is not a child of something else being disposed. |
  ```
- **`docs/components/DiagramView.md` — *Running ELK layout in a Web Worker* section.** Add a bullet after the fallback bullet:
  **Dispose to release the worker.** The worker lives as long as the view. Call `dispose()` when you permanently discard a `DiagramView` (closing its tab, replacing a panel) and its worker thread is terminated; a view torn down as part of a disposed parent is covered automatically. A layout still running at that moment is abandoned — it never writes back into the view.
- **`docs/components/DiagramView.md` — *Notes*.** Extend the existing *Off-thread layout (opt-in)* bullet ([L146](packages/lib/docs/components/DiagramView.md#L146)) with one sentence pointing at disposal, so a reader skimming Notes learns the worker is not free-standing.
- No sidebar, catalog, or cross-page changes: `DiagramView` and the `component/diagram` entry point already exist, and no symbol is renamed or removed.

---

## Potential Challenges

- **elkjs's `terminateWorker()` throws on a non-factory instance.** The in-process stand-in worker has no `terminate` method. Mitigated by the `_ownsWorker` guard and pinned by R1/R2 against real elkjs — the mocked suite cannot see it.
- **`_workerBacked` looks like the right guard and is not.** The `workerUrl` mode sets it without ever producing a worker. Mitigated by the separate `_ownsWorker` field, the precedence table in *Architecture Decisions*, and R2.
- **`StubEngine` has no `dispose()` today**, so `DiagramView.destructor()` would throw in the existing suite. Mitigated by step 12, which adds one before any test disposes a view.
- **A layout outstanding in a real worker never settles after termination.** elkjs does not reject pending requests on terminate. Harmless because the continuation becomes unreachable once the engine drops the instance, and because the view's generation guard would discard a late result anyway. Stated in the contract rather than worked around with a timeout.
- **`dispose()` leaves `_workerBacked` set.** Intentional and unobservable: the only reader is `layout()`'s catch block, which a disposed engine can never reach past its entry guard.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts) — the class being changed: `ElkInstance` (L81), `_workerBacked` and its JSDoc (L380-387), `layout` (L413), `ensureElk` (L446), `createElk` (L465), `createMainThreadElk` (L491).
- [packages/lib/src/typescript/lib/component/diagram/DiagramView.ts](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) — `_engine` (L162), `_layoutGeneration` (L177), `createEngine` (L280), `relayout` (L392), the `applyLayout` generation guard (L447), the `handleLayoutFailure` generation guard (L532).
- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) — `dispose()` (L715) and `destructor()` (L732), including the JSDoc stating that `destructor()` is the override hook, that an override must end with `super.destructor()`, and that both are idempotent. The child recursion at L748-750 is why the override must be on `destructor()`.
- [packages/lib/src/typescript/lib/component/display/Canvas.ts:331](packages/lib/src/typescript/lib/component/display/Canvas.ts#L331) and [packages/lib/src/typescript/lib/component/container/StatusBar.ts:323](packages/lib/src/typescript/lib/component/container/StatusBar.ts#L323) — **the precedent for the view side**: release the owned resource, then `super.destructor()`.
- [packages/lib/src/typescript/lib/core/StyleTarget.ts:305](packages/lib/src/typescript/lib/core/StyleTarget.ts#L305) — **the precedent for the engine side**: a non-`Component` class whose teardown verb is a public, idempotent `dispose()` that resets to the unbuilt state.
- [plans/implemented/component-teardown-seam.md](plans/implemented/component-teardown-seam.md) — establishes `dispose()` as the public teardown verb and `destructor()` as the override hook across the library.
- [plans/implemented/elk-layout-web-worker.md](plans/implemented/elk-layout-web-worker.md) — the prerequisite; its *Implementation Notes* record both the untermined-worker gap and the finding that `elkWorkerUrl` never produces a real worker with `elk.bundled.js`.
- [packages/lib/tests/component/diagram/ElkLayoutEngine.test.ts](packages/lib/tests/component/diagram/ElkLayoutEngine.test.ts) — the `MockELK` / `layoutMock` harness to extend (L9-26) and the worker-mode suite to add to (L420).
- [packages/lib/tests/component/diagram/DiagramView.test.ts](packages/lib/tests/component/diagram/DiagramView.test.ts) — `StubEngine` (L27-50) and the `StubDiagramView` `createEngine` override (L56-60); the seam that must keep working.
- [node_modules/elkjs/lib/elk-api.js](node_modules/elkjs/lib/elk-api.js) — `ELK.terminateWorker` (L111-113) and `PromisedWorker.terminate` (L169-173), the two lines the guard exists for.

---

## Non-Goals

- **Wiring disposal into sqladmin.** The five diagram dock panels have no disposer, and `QueryPanel`'s `diagramSlot` disposer is a deliberate no-op. Fixing that is the dependent, app-side plan; this one only provides the API and its guarantees.
- **Guarding `setData()` (or any other method) after disposal.** A disposed `DiagramView` is not reusable, and calling into it is already unsupported today. This plan does not add disposed checks across the view's public surface.
- **Sharing or pooling a worker across `DiagramView` instances.** Each view keeps its own engine and its own worker; ownership stays one-to-one, which is what makes disposal unambiguous.
- **Recovering worker mode after the main-thread fallback.** The fallback stays permanent for the engine's lifetime, exactly as the prerequisite plan established.
- **Making `elkWorkerUrl` deliver off-thread layout.** It still cannot with `elk.bundled.js`; this plan only makes sure disposal does not throw in that mode.
- **A release-and-rebuild path for the engine** (the `Component.release()` shape sketched in [plans/component-element-release.md](plans/component-element-release.md)). Disposal here is terminal.
- **Terminating the worker when a view is merely hidden or off-screen.** Disposal is the only trigger.

---

## Notes

[^teardown-precedent]: Two precedents are being followed, one per side of the change. For the `Component` side, [`Canvas.destructor`](packages/lib/src/typescript/lib/component/display/Canvas.ts#L331) and [`StatusBar.destructor`](packages/lib/src/typescript/lib/component/container/StatusBar.ts#L323) are the canonical "release my own resource, then `super.destructor()`" overrides, and [component-teardown-seam.md](plans/implemented/component-teardown-seam.md) is the plan that made `dispose()` → `destructor()` the library-wide contract. For the plain-class side, [`StyleRule.dispose`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L305) is the only other non-`Component` class in the library with an explicit teardown method, and it is a public, idempotent `dispose()` that resets the object to its unmaterialised state — precisely the shape adopted here, down to the "no-op if never built" behaviour. No new pattern is introduced. `StoreWorkerClient` was checked as the library's other worker client and does **not** apply: it is a module-level singleton, deliberately shared by every store for the page's lifetime, with no per-owner teardown to mirror.

[^fake-worker]: Verified by reading elkjs 0.10.2's sources. `ELK.terminateWorker()` is `if (this.worker) this.worker.terminate();` ([elk-api.js:111-113](node_modules/elkjs/lib/elk-api.js)), where `this.worker` is a `PromisedWorker` whose own `terminate()` is `if (this.worker) { this.worker.terminate(); }` ([elk-api.js:169-173](node_modules/elkjs/lib/elk-api.js)). The engine imports `elk.bundled.js`, whose `ELKNode` constructor installs an in-process stand-in worker whenever no `workerFactory` was supplied — including in the `workerUrl` mode, where its `require.resolve('web-worker')` probe can never succeed inside the browserify bundle ([elk.bundled.js:6495-6529](node_modules/elkjs/lib/elk.bundled.js)). That stand-in is the constructor `j` exported by `elk-worker.min.js`, which defines only `dispatcher` and `postMessage` and no `terminate` at all ([elk-worker.min.js:6185-6186](node_modules/elkjs/lib/elk-worker.min.js)). So `terminateWorker()` on any non-factory instance evaluates `undefined()` and throws a `TypeError`. This is the single fact the `_ownsWorker` guard exists for, and R1/R2 are the tests that would catch its removal.

[^reject-not-empty]: Three options were weighed for a post-dispose `layout()`. Rejecting was chosen because rejection is already this method's failure channel — `DiagramView.relayout` routes it to `handleLayoutFailure`, whose generation guard drops it after disposal — and because it is the loudest signal for a consumer holding an engine directly. Resolving with an empty result was rejected: it fabricates a successful layout, and `DiagramView` would apply it, clearing a graph that a caller may still be looking at. Silently rebuilding was rejected outright, since it resurrects exactly the worker `dispose()` just terminated.

[^adopt-check]: The window is real, not theoretical: the first `layout()` call parks on `await import("elkjs/lib/elk.bundled.js")`, which takes long enough for a user to close a panel that was just opened. Without the check, the sequence is: `layout()` parks → `dispose()` runs and finds `_elk === null`, so terminates nothing → the import resolves → `new ELK({ workerFactory })` spawns a worker → it is stored on a disposed engine and never terminated. The check is placed in `ensureElk` because that is where a *first* construction is adopted. (Implementation found a second adoption point the plan missed — the fallback's main-thread rebuild in `layout` — which needed its own check; see `## Implementation Notes`.) It reads `this._ownsWorker`, which `createElk` set immediately before constructing; `dispose()` deliberately does not clear that field, precisely so this check can still see it. An interleaving where `dispose()` lands after `createElk` returns but before the check is covered by the same reasoning.

[^generation]: `_layoutGeneration` already exists for exactly this job — `relayout` bumps it per layout, and both `applyLayout` and `handleLayoutFailure` return early when the token they were handed no longer matches ([DiagramView.ts:447](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L447), [DiagramView.ts:532](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L532)). Bumping it in `destructor()` makes teardown look like "a newer layout superseded you", which is behaviour both guards already implement and both existing tests already cover. Adding a separate `_disposed` flag to the view and checking it in two more places was rejected as a second mechanism for one idea.

[^create-once]: `createElk` runs at most once per engine, so `_ownsWorker` never needs resetting in its non-factory branches. `ensureElk` calls it only when `_elk` is `null`; `_elk` becomes `null` again only in `dispose()`; and after `dispose()` the entry guard in `layout()` makes `ensureElk` unreachable. The fallback path does not go through `createElk` at all — it uses `createMainThreadElk` and clears `_ownsWorker` itself.

---

## Implementation Notes

- **Two of the plan's own grep checks come out one off, both from column alignment rather than a missing change.** Step 5's check `grep -c '_ownsWorker = true'` expects 1 and returns 0: the assignment is written `this._ownsWorker   = true;`, column-aligned with the neighbouring `this._workerBacked = true;` to match the file's style (and matching the plan's own *Internal Structure* snippet, which aligns the same pair). The Verification section's `grep -c '_ownsWorker'` → 4 does pass, and those four occurrences are exactly the declaration, the `createElk` assignment, the fallback clear, and the guard. Step 10's check `grep -n 'destructor'` on `DiagramView.ts` expects two hits and returns three: the override and its `super` call, plus one prose mention in the override's own JSDoc ("before the inherited destructor detaches the element"), which is the wording both cited precedents use ([Canvas.destructor](packages/lib/src/typescript/lib/component/display/Canvas.ts#L331), [StatusBar.destructor](packages/lib/src/typescript/lib/component/container/StatusBar.ts#L323)). No code differs from the plan; only the greps need reading with that in mind.
- **R1/R2 were written after the implementation, so their red state was established by mutation instead of by ordering.** Every other case in this plan was written test-first against an absent API — E1–E10 and D1–D4 all failed before the code existed (E1–E10 on `Property 'dispose' does not exist`, D1/D3 on assertions). R1 and R2 are regression tests for a guard that the same change introduces, so they passed the moment they were written. To confirm they are load-bearing rather than vacuous, the guard was temporarily reverted to `if (elk && this._workerBacked)` — the exact mistake the plan warns about — and R2 failed with `TypeError: this.worker.terminate is not a function`, the predicted real-elkjs error. The guard was then restored and R2 re-passed. Recorded because "written after, proven by mutation" is a weaker discipline than "written before", and the difference should not be silent.
- **No demo change (the `implement` skill's step 8) — not applicable here.** The library's showcase panel constructs `new DiagramView({ data: SAMPLE })` with no `elkWorkerFactory` ([DiagramPanel.ts:76](packages/lib/src/typescript/DiagramPanel.ts#L76)), main-thread by the prerequisite plan's deliberate design, so it owns no worker to terminate. It is also a long-lived tab that never discards its view, so calling `dispose()` there would tear down a live panel to demonstrate nothing. The behaviour is exercised by R1/R2 against real elkjs instead.
- **`ensureElk` memoises the construction promise; the plan's *Internal Structure* showed a plain `await this.createElk()`.** Audit found that shape leaks: two `layout` calls that both start before either stores an instance each see `_elk === null` and each build their own ELK, so each builds its own Worker — and `dispose` can only terminate the instance the engine ends up keeping. The other worker outlives the engine, which falsifies the *Consumer contract*'s "no worker outlives `dispose()`" through a plainly reachable sequence (`setData` twice in one tick). Reproduced at the engine level as 2 constructions against 1 termination. The fix keeps the plan's adopt-or-terminate logic and its comment verbatim, but relocates it into a memoised `_building` promise so it runs exactly once however many callers are waiting; a failed construction clears `_building` so a later `layout` still retries the import, preserving today's behaviour. New field `_building` and new cases E11 ("every worker built is a worker terminated") and E12 ("a failed construction is retried by the next layout, not replayed") were added beyond the plan's Files-table rows for those files, which were already being modified. E12 came from a second audit round: the `.catch` that clears `_building` on a failed build is load-bearing — without it a single failed import is replayed forever instead of retried, a regression against the base branch — but deleting it left the whole suite green, so the branch was pinning the memoisation's success path and not its failure path. E12 is now the only test that fails when that clear is removed.
- **Two disposal windows and two vacuous tests, found after the plan's own audit had passed.** A follow-up review of this branch turned up four things worth recording:
  - **`dispose()` did not clear the memoised construction**, so a disposed engine kept the terminated ELK — and its `Worker` object — reachable for its own lifetime. `dispose` now clears `_building` alongside `_elk`. Unobservable through the public API by construction (after disposal the entry guard in `layout` makes `ensureElk` unreachable), so E14 pins it against internal state and says so; that is the first private-state assertion in `ElkLayoutEngine.test.ts`, justified by there being no public surface that can see the difference, and matching the `as any` internal access `DiagramView.test.ts` already uses throughout.
  - **The fallback's main-thread rebuild was a second adoption point with no disposal check** — a behavioural gap beyond the plan. `dispose()` landing while `await this.createMainThreadElk()` was in flight left a disposed engine holding a live ELK and completing a layout through it, contradicting *A disposed engine never lays out again*. `layout` now re-checks `_disposed` after that rebuild and throws. It deliberately does **not** terminate what it drops, unlike `ensureElk`'s equivalent check: the rebuild is main-thread, and terminating a non-factory instance throws a `TypeError` — the hazard R1/R2 exist for. This is what makes the plan's `[^adopt-check]` footnote's "single point where a built instance is adopted" wrong; that footnote now points here. The fallback also clears `_building`, which otherwise kept resolving to the worker-backed instance it had just abandoned.
  - **D4 could not fail.** It asserted `await expect(flush()).resolves.toBeUndefined()`, which is true of any implementation — and `relayout` always attaches a `.catch`, so the unhandled rejection it claimed to guard against was unreachable. Rewritten to assert the view's nodes survive a post-disposal rejection. That matters: removing `handleLayoutFailure`'s generation guard broke **no test at all** beforehand, and rewritten-D4 is now the only thing covering it.
  - **E13 passed for the wrong reason** on first writing: one `await Promise.resolve()` never reaches the fallback-rebuild window, so it exercised `ensureElk`'s construction check (already covered by E9) rather than the new one, and passed with the new guard removed. It now interleaves disposal through an `onConstruct` hook in the elkjs mock, which fires inside the constructor — after the instance exists, before the `await` that produced it resumes — and fails without the guard.
