# ELK Diagram Layout in a Web Worker — Implementation Plan

## Overview

`DiagramView` runs ELK graph layout through [`ElkLayoutEngine`](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L345). Today layout runs on the **main thread**: `ensureElk` imports `elkjs/lib/elk.bundled.js` and calls `new ELK()` ([ElkLayoutEngine.ts:388](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L388)), which drives ELK through an in-process *fake* worker that blocks the UI — measured at ~13–15s for a ~154-node schema graph.

This plan lets a consumer move ELK's compute off the main thread by passing a **worker factory** they own: a new option `DiagramViewOptions.elkWorkerFactory?: () => Worker`. When set, the library hands it to elkjs's `workerFactory`, so ELK's layout runs in that worker. The one `new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url), { type: "classic" })` line lives in the **consumer's** code — the consumer's own bundler resolves and emits the worker from the consumer's `node_modules`. No ELK worker code ever enters the library's published bundle; that is the whole licensing argument.[^licensing] The existing `elkWorkerUrl` option is kept for consumers who prefer to host `elk-worker.js` themselves without a bundler idiom. With neither option, layout runs on the main thread exactly as today.

Any worker failure (construction throws, first layout rejects, `Worker` undefined) falls back transparently to main-thread layout — a worker problem never surfaces as a diagram error. Only a genuinely-absent `elkjs` reaches the existing empty-view path.

The change touches three source files: the engine ([ElkLayoutEngine.ts](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts)), its type shim ([elkjs.d.ts](packages/lib/src/typescript/lib/component/diagram/elkjs.d.ts)), and the view option ([DiagramView.ts](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts)) — plus a test and the diagram docs page. **No library-build changes** (`vite.lib.config.ts`, `tsconfig.json`) are needed, because the library constructs no worker and imports no new specifier.

---

## Architecture Decisions

### Consumer-provided worker factory

The worker is built by consumer code, passed in as `elkWorkerFactory: () => Worker` and forwarded to elkjs's `workerFactory` constructor option.[^factory-api] The library never writes `new Worker(...)` and never references the ELK worker file, so it cannot bundle ELK's EPL-2.0 code — the licensing risk is removed *by construction*, with no build-time workarounds.[^licensing] This mirrors the codebase's existing "consumer owns the seam" shape: the current `elkWorkerUrl` already threads a consumer-supplied worker reference straight into `new ELK({ workerUrl })` ([ElkLayoutEngine.ts:397](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L397)); `elkWorkerFactory` is the same seam with a factory instead of a URL.

### Main-thread is the default

With no factory and no URL, the engine imports `elkjs/lib/elk.bundled.js` and calls `new ELK()` — unchanged from today. There is no separate "force main thread" option: omitting the factory *is* the main-thread request.[^no-override]

### Precedence — first match wins

The engine resolves its mode in this fixed order:

| `elkWorkerFactory` | `elkWorkerUrl` | Engine built | Layout thread |
|---|---|---|---|
| provided | (any) | `new ELK({ workerFactory })` | consumer's worker; falls back to main on failure |
| unset | `"https://…/elk-worker.js"` | `new ELK({ workerUrl })` | consumer-hosted worker; falls back to main on failure |
| unset | unset | `new ELK()` | main (default) |

`elkWorkerFactory` wins over `elkWorkerUrl` when both are set (a factory is the more explicit, bundler-native path). All three modes import the same already-external `elkjs/lib/elk.bundled.js`; the constructor argument selects the behaviour.[^one-module]

### Transparent fallback to main thread

Any worker path sets an internal `_workerBacked` flag. If `new ELK({ workerFactory | workerUrl })` throws (e.g. the factory calls `new Worker` where `Worker` is undefined in Node/jsdom, or a CSP blocks it) or the first `layout` rejects (the worker errored at compute, or the consumer's bundler never emitted the worker so it 404s), the engine rebuilds with main-thread `new ELK()` and retries once, rendering normally.[^fallback] A main-thread failure is not retried — that means `elkjs` itself is absent, which propagates to [`DiagramView.handleLayoutFailure`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L426) and leaves the view empty, exactly as today.

### Worker type is `classic` (documented for the consumer)

The consumer's factory must construct the worker as `{ type: "classic" }`. `elk-worker.min.js` is a classic browserify script that references `module.exports` at top level; a module worker would fail to load.[^classic] The library does not enforce this — the factory is opaque to it — but the docs recipe specifies it.

---

## Public API

### `DiagramViewOptions` (modified)

```typescript
export interface DiagramViewOptions extends PanelOptions {
    // …existing fields unchanged…
    /** URL of a consumer-hosted `elk-worker.js`. When set, ELK runs at this worker URL. */
    elkWorkerUrl?: string;
    /**
     * Factory returning a Web Worker for off-thread ELK layout. When set, ELK's
     * compute runs in the returned worker. Construct it in your app so your
     * bundler emits the worker, e.g.
     * `() => new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url), { type: "classic" })`.
     */
    elkWorkerFactory?: () => Worker;
}
```

Both are construction-only (no setter/getter), read once by `createEngine` — mirroring the existing `elkWorkerUrl` plumbing. No `DiagramView` subclasses exist; the sole instantiation site ([DiagramPanel.ts:76](packages/lib/src/typescript/DiagramPanel.ts#L76)) passes neither and stays on the main thread.

### `ElkLayoutEngine` constructor (changed signature)

```typescript
export interface ElkLayoutEngineOptions {
    /** Consumer-provided worker factory; when set, ELK layout runs in that worker. */
    workerFactory?: () => Worker;
    /** Consumer-hosted `elk-worker.js` URL; when set, ELK runs at this worker URL. */
    workerUrl?: string;
}

class ElkLayoutEngine {
    constructor(options?: ElkLayoutEngineOptions);
    async layout(
        data: DiagramData,
        sizes: Map<string, { width: number; height: number }>,
        defaults?: Record<string, string>,
    ): Promise<DiagramLayoutResult>;
}
```

The old positional `constructor(workerUrl?: string)` becomes an options object. The only caller is [`DiagramView.createEngine`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L192); tests use a `StubEngine` and never call the real constructor.

### `elkjs.d.ts` shim (extended)

```typescript
export interface ElkConstructorOptions {
    workerUrl?: string;
    workerFactory?: (url?: string) => Worker;   // added
}
```

`ElkLayoutEngineOptions.workerFactory` is `() => Worker`; elkjs's `workerFactory` is `(url?: string) => Worker`. A zero-arg function is assignable to a one-optional-arg parameter type, so the pass-through typechecks without a cast.

---

## Internal Structure

`ElkLayoutEngine` after the change:

```typescript
private _elk: ElkInstance | null = null;
private readonly _workerFactory?: () => Worker;
private readonly _workerUrl?: string;
/** True while `_elk` is worker-backed, so a layout failure retries on the main thread once. */
private _workerBacked = false;

constructor(options?: ElkLayoutEngineOptions) {
    this._workerFactory = options?.workerFactory;
    this._workerUrl     = options?.workerUrl;
}

async layout(data, sizes, defaults): Promise<DiagramLayoutResult> {
    const graph = buildElkGraph(data, sizes, defaults);
    try {
        const elk = await this.ensureElk();
        return mapElkResult(await elk.layout(graph) as ElkNode);
    } catch (error) {
        if (this._workerBacked) {
            // Worker construction (factory threw, Worker undefined, CSP) or the
            // first compute failed. Rebuild on the main thread and retry once so
            // a worker failure degrades to a rendered diagram, not an error.
            this._workerBacked = false;
            this._elk = await this.createMainThreadElk();
            return mapElkResult(await this._elk.layout(graph) as ElkNode);
        }
        throw error;   // main-thread failure = elkjs genuinely absent; propagate
    }
}

private async ensureElk(): Promise<ElkInstance> {
    if (this._elk) return this._elk;
    this._elk = await this.createElk();
    return this._elk;
}

private async createElk(): Promise<ElkInstance> {
    const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
    if (this._workerFactory) {
        this._workerBacked = true;                              // set BEFORE construct so a
        return new ELK({ workerFactory: this._workerFactory }); // sync throw triggers retry
    }
    if (this._workerUrl) {
        this._workerBacked = true;
        return new ELK({ workerUrl: this._workerUrl });
    }
    return new ELK();
}

private async createMainThreadElk(): Promise<ElkInstance> {
    const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
    return new ELK();
}
```

`_workerBacked` is set **before** `new ELK({ … })` so a synchronous worker-construction throw is caught by `layout`'s `catch` and retried on the main thread. `buildElkGraph` / `mapElkResult` and all pure helpers are unchanged. The engine writes no `new Worker` and names no worker file.

---

## Ordered Implementation Steps

1. **`elkjs.d.ts` — add `workerFactory` typing.** In `ElkConstructorOptions` add `workerFactory?: (url?: string) => Worker;`.
   - Check: `grep -n workerFactory packages/lib/src/typescript/lib/component/diagram/elkjs.d.ts` — one hit.

2. **`ElkLayoutEngine.ts` — options-object constructor, mode selection, fallback.** Replace the `constructor(workerUrl?)`, the `_workerUrl` field, and `ensureElk` with the *Internal Structure*: add `ElkLayoutEngineOptions`, the `_workerFactory` / `_workerUrl` / `_workerBacked` fields, the options-object constructor, the `layout` retry wrapper, `createElk`, and `createMainThreadElk`. Update the class/`layout`/constructor JSDoc to describe the factory, the URL, the default, and the fallback. Do **not** add any `new Worker` or worker-file reference.
   - Check: `grep -n 'new Worker\|elk-worker' packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts` — **zero** hits.
   - Check: `grep -n 'workerFactory\|workerUrl\|_workerBacked' ElkLayoutEngine.ts` — factory + url branches in `createElk`, retry flag in `layout`.

3. **`DiagramView.ts` — add `elkWorkerFactory`.** In `DiagramViewOptions` add `elkWorkerFactory?: () => Worker;` beside `elkWorkerUrl` ([L77](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L77)). In `applyOptions` add `if (options.elkWorkerFactory !== undefined) this._options.elkWorkerFactory = options.elkWorkerFactory;`. In `createEngine` return `new ElkLayoutEngine({ workerFactory: this._options.elkWorkerFactory, workerUrl: this._options.elkWorkerUrl })`.
   - Check: `grep -n elkWorkerFactory DiagramView.ts` — three hits (interface, applyOptions, createEngine).

4. **New test `tests/component/diagram/ElkLayoutEngine.test.ts`.** Cover the modes + fallback with `vi.mock('elkjs/lib/elk.bundled.js', …)` and a stub factory (see *Expected Behaviour*).

5. **Docs — `docs/components/DiagramView.md`.** Add a "Running ELK layout in a Web Worker" section (the recipe below) and update the "Off-thread layout" Notes bullet to reflect factory + URL + default + fallback.

6. **Full gate.** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:lib`, `npm run docs:api` — all clean (Verification).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/elkjs.d.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` |
| Modify | `packages/lib/docs/components/DiagramView.md` |
| Create | `packages/lib/tests/component/diagram/ElkLayoutEngine.test.ts` |

No changes to `vite.lib.config.ts` or `tsconfig.json`: the library constructs no worker and imports no new specifier, so nothing new needs externalizing or path-mapping. `elkjs/lib/elk.bundled.js` is already external ([vite.lib.config.ts:90](packages/lib/vite.lib.config.ts#L90)) and already tsconfig-mapped ([tsconfig.json:36](packages/lib/tsconfig.json#L36)).

---

## Expected Behaviour

All cases below are **unit-testable** under the repo's Node vitest by mocking `elkjs/lib/elk.bundled.js` (its `default` is a class recording the constructor options and exposing a `layout` spy; its constructor invokes `options.workerFactory?.()` to mirror how real elkjs calls the factory, so a throwing factory propagates) and passing a stub factory.

1. **No factory, no url.** `new ElkLayoutEngine()` then `layout(...)` builds `new ELK()` (no options) and resolves with the mapped result — unchanged from today.
2. **`workerFactory` provided, worker healthy.** Builds `new ELK({ workerFactory })`; the mock invokes the factory, which returns the stub `Worker`. Resolves with the mapped result.
3. **`workerUrl` provided.** Builds `new ELK({ workerUrl: "…" })`; resolves.
4. **`workerFactory` provided, factory throws (e.g. `Worker` undefined / CSP).** The stub factory throws; `layout(...)` catches it and **falls back**, building `new ELK()` and resolving with the mapped result.
5. **`workerFactory` provided, constructs but first `layout` rejects.** The mock's `layout` rejects once; `layout(...)` **falls back** to `new ELK()` and resolves. (After fallback `_workerBacked` is false, so a subsequent main-thread failure would propagate.)
6. **`workerUrl` provided, worker fails.** Same fallback to main thread as case 4/5.
7. **Precedence.** `new ElkLayoutEngine({ workerFactory, workerUrl: "x" })` builds `new ELK({ workerFactory })` — the factory wins; `workerUrl` is not passed.
8. **`elkjs` genuinely absent.** The mock rejects on import (or `layout`) with no factory/url; `layout(...)` **rejects**. In `DiagramView`, [`relayout`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L296) routes the rejection to `handleLayoutFailure`, leaving the view empty (unchanged).

**Manual verification (browser, not unit-testable):**

- **Off-thread execution.** In sqladmin, pass `elkWorkerFactory: () => new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url), { type: "classic" })` and open a large schema diagram (~150 nodes). Confirm the UI stays responsive during layout rather than freezing for ~13–15s, and the network panel shows the worker asset loading (Vite emits it from the app's own `elkjs`).
- **Fallback under CSP.** With a strict `worker-src 'none'` CSP and the factory set, confirm the diagram still renders (main thread) with no diagram error surfaced.

---

## Verification

- **Typecheck:** `npm run typecheck` clean — `workerFactory` typed on the shim; `() => Worker` passes through to `(url?: string) => Worker`.
- **Lint:** `npm run lint` clean. `Worker` / `() => Worker` type usage mirrors the already-allowed [`StoreWorkerClient`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts) (the `local/no-raw-dom` rule targets `Element`/`Node`/`HTMLElement` and raw element access, not `Worker`).
- **Unit tests:** `npm test` — the new `ElkLayoutEngine.test.ts` cases 1–8 pass; existing `DiagramView.test.ts` (StubEngine) and `default-options-fallback.test.ts` unchanged and green.
- **Library carries no worker construction:** `npm run build:lib`, then `grep -rn 'new Worker\|elk-worker' packages/lib/dist/lib` — **zero** hits. `grep -F 'elkjs/lib/elk.bundled.js' packages/lib/dist/lib/component/diagram.es.js` — the bare specifier is present (externalized, not inlined).
- **Docs:** `npm run docs:api` finishes with **zero** warnings.
- **Manual smoke:** the two browser checks in *Expected Behaviour*, run in sqladmin (log in per project notes; scope DevTools to `.DiagramView`).

---

## Documentation Impact

- **New guide section — "Running ELK layout in a Web Worker"** in [`docs/components/DiagramView.md`](packages/lib/docs/components/DiagramView.md). Content:
  1. Install `elkjs` (already the optional-peer-dep step).
  2. Pass the factory:
     ```typescript
     const view = DiagramView({
         data,
         elkWorkerFactory: () =>
             new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url), { type: "classic" }),
     });
     ```
  3. **Why `type: "classic"`** — `elk-worker.min.js` is a classic browserify script that references `module.exports` at top level; a `{ type: "module" }` worker would fail to load.
  4. **Bundler requirement** — the factory lives in your app, so *your* bundler must understand `new Worker(new URL(..., import.meta.url))`. Vite and webpack 5 do; they emit the worker from your `node_modules/elkjs`. Nothing is hosted by hand.
  5. **Without a factory**, layout runs on the main thread; if a worker fails to construct or errors, the view transparently falls back to main-thread layout — a worker problem never breaks the diagram.
  6. Note `elkWorkerUrl` as the alternative for consumers who host `elk-worker.js` themselves (no bundler idiom); mention the factory takes precedence when both are set.
- **Option catalog:** add `elkWorkerFactory` (and confirm `elkWorkerUrl`) to the options prose/table so both worker options are discoverable.
- **TypeDoc:** `ElkLayoutEngineOptions` is a new exported interface in the already-registered `component/diagram` entry point — it appears in the API docs automatically. Ensure its JSDoc `{@link}`s only public symbols (per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)).
- No barrel/sidebar/catalog structural changes: `DiagramView` and the `component/diagram` subpath already exist; this adds a field and an interface.

---

## Potential Challenges

- **Consumer bundler must support the worker idiom.** A bundler that can't resolve `new Worker(new URL(..., import.meta.url))` won't emit the worker; the first layout then throws and the engine falls back to main-thread — degraded but correct. Mitigation: the fallback covers it; the docs state the requirement.
- **Async worker failure that neither throws nor resolves.** A worker that constructs but then hangs (a rare CSP variant that doesn't throw synchronously) leaves elkjs's layout promise unsettled, so the `catch` fallback never fires. Mitigation: in practice Chrome rejects a CSP-blocked worker synchronously at `new Worker`, which *is* caught; a timeout guard is out of scope (adds a magic timeout with no clean signal). Documented as a known edge.
- **Wrong worker type in consumer code.** A consumer using `{ type: "module" }` gets a worker that fails to load, which falls back to main-thread (no error, but no off-thread benefit). Mitigation: the docs recipe specifies `classic` and explains why.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts) — the engine being changed; `ensureElk` (L388) and the constructor (L355).
- [packages/lib/src/typescript/lib/component/diagram/DiagramView.ts](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) — `createEngine` (L192), `applyOptions` (L202), `relayout`/`handleLayoutFailure` (L296/L426), the existing `elkWorkerUrl` plumbing (L76/L193/L209).
- [packages/lib/src/typescript/lib/component/diagram/elkjs.d.ts](packages/lib/src/typescript/lib/component/diagram/elkjs.d.ts) — the shim gaining `workerFactory`.
- [packages/lib/src/typescript/lib/data/StoreWorkerClient.ts](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts) — the codebase's other worker client; shows `Worker` typing is lint-clean and the graceful-degradation shape.
- [node_modules/elkjs/lib/elk-api.d.ts](node_modules/elkjs/lib/elk-api.d.ts) — the real `ELKConstructorArguments` (`workerUrl`, `workerFactory`) the shim reflects.
- [packages/lib/tests/component/diagram/DiagramView.test.ts](packages/lib/tests/component/diagram/DiagramView.test.ts) — the `StubEngine` / `StubDiagramView` harness the new tests sit beside.

---

## Non-Goals

- **Moving DOM work off-thread.** Building and positioning the N node elements after ELK returns stays on the main thread; only ELK compute moves off-thread. Worker DOM access isn't possible, and the framework's DOM seam is main-thread by design.
- **Library-constructed / zero-config worker.** The library does not build a worker itself; the consumer supplies the factory. This is the deliberate licensing choice (no ELK code in the library bundle) and it removes any library-build workaround.
- **A node-count threshold.** When a factory is set the engine always attempts the worker, then falls back — worker overhead on small graphs is negligible and node count is a poor proxy for layout cost.
- **Removing or changing `elkWorkerUrl`.** It is preserved as the host-it-yourself alternative.
- **Terminating / pooling the worker.** One engine owns one lazily-built ELK instance for its lifetime (unchanged).

---

## Notes

[^licensing]: `elkjs` is **EPL-2.0** (`node_modules/elkjs/package.json` `"license": "EPL-2.0"`). The library publishes `dist/lib` (its `package.json` `files`), and the repo's third-party policy (root [`NOTICE`](NOTICE)) attributes only genuinely-vendored material (Font Awesome path data). Because the `new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url))` expression lives in *consumer* code, only the consumer's bundler ever resolves and emits ELK's worker — from the consumer's own `node_modules`. The library bundle contains no ELK worker source, so no NOTICE entry and no library-build workaround are needed. Verified: a downstream Vite build importing a dependency whose code held that expression resolved `elk-worker.min.js` from the *consumer's* `elkjs` and emitted it into the *consumer's* output.

[^factory-api]: elkjs's real constructor arguments are `defaultLayoutOptions`, `algorithms`, `workerUrl`, and `workerFactory: (url?) => Worker` ([elk-api.d.ts:126-131](node_modules/elkjs/lib/elk-api.d.ts)). When a `workerFactory` is supplied, `elk.bundled.js` skips its in-process fake worker and drives layout through the factory's worker ([elk.bundled.js:6518-6524](node_modules/elkjs/lib/elk.bundled.js)); when only `workerUrl` is supplied it constructs `new Worker(url)` internally. So all three modes can use the single already-external `elk.bundled.js` module — the constructor argument selects the behaviour.

[^no-override]: The earlier design carried an explicit `elkMainThread` override; it is dropped as redundant. Main-thread is now the default reached by omitting both worker options, so a separate "force main thread" flag would only restate the default.

[^one-module]: Using `elk.bundled.js` for the worker paths means its ~1.5 MB module still loads (lazily, from the consumer's install) on the main thread even when a worker is used — but the layout *compute*, the ~13–15s cost, runs in the worker. This matches today's main-thread import cost and needs no new specifier, so no `tsconfig.json` path mapping is added. A thinner `elkjs/lib/elk-api.js` import was considered and rejected: it would require a new tsconfig path and shim entry for a modest main-thread parse saving, reintroducing the library-build coupling this design exists to avoid.

[^fallback]: Both worker paths set `_workerBacked = true` *before* constructing `new ELK({ … })`, so a synchronous worker-construction throw is caught by `layout`'s `catch`. The `catch` rebuilds with main-thread `new ELK()` and retries the layout once. This covers: the factory calling `new Worker` where `Worker` is undefined (Node/jsdom/SSR), a CSP blocking the worker synchronously, the consumer's bundler never emitting the worker (the URL 404s and the first layout rejects), and the worker erroring at compute. A main-thread build/compute failure is not retried — that means `elkjs` is absent or broken, which correctly propagates to `DiagramView.handleLayoutFailure`.

[^classic]: `elk-worker.min.js` opens with `'use strict'; var $wnd; …`, references `module.exports` at top level, and has no `import`/`export` and no `importScripts` — a classic browserify script. elkjs's own base constructor builds its worker as `new Worker(url)` with no `type` (classic, [elk-api.js:42-46](node_modules/elkjs/lib/elk-api.js)). A `{ type: "module" }` worker runs in module scope where top-level `module` is undefined, so `module.exports` throws at load. Hence the consumer recipe specifies `{ type: "classic" }`.

---

## Implementation Notes

- **The `component/diagram` barrel needed a new type export the plan didn't list.** The plan's Documentation Impact section claimed `ElkLayoutEngineOptions` "is a new exported interface in the already-registered `component/diagram` entry point — it appears in the API docs automatically," and its Files table lists no change to `packages/lib/src/typescript/lib/component/diagram/index.ts`. In practice `npm run docs:api` emitted a TypeDoc warning — `ElkLayoutEngineOptions … is referenced by component/diagram.ElkLayoutEngine.constructor.options but not included in the documentation` — because TypeDoc only documents symbols reachable from a package's re-exports, and `index.ts` re-exports named types individually (`DiagramLayoutResult`, `ElkEdgeSection`, `ElkPoint`, …) rather than a wildcard. `ElkLayoutEngineOptions` was added to that same `export type { … }` line, matching the existing pattern for the file's other `ElkLayoutEngine`-adjacent types. `npm run docs:api` is clean (0 warnings) with this addition.
- **`npm run lint` does not pass, despite the plan's Verification section claiming it does.** The failure — `packages/lib/src/typescript/lib/component/table/cell/renderer/Link.ts:57`, `local/forward-super-options` — is pre-existing on `master` (the file is untouched by this branch: `git diff master...feature/elk-layout-web-worker -- packages/lib/src/typescript/lib/component/table/cell/renderer/Link.ts` is empty) and unrelated to ELK/worker layout. It is out of scope for this plan to fix; recorded here so the plan's "lint clean" claim isn't taken at face value.
- **A fallback-abandoned worker is never terminated, and the plan's own Non-Goals bullet describing this is imprecise.** On a worker-backed layout failure, `ElkLayoutEngine.layout` drops the old (worker-backed) `_elk` and replaces it with a freshly built main-thread `_elk` — implemented exactly per the plan's own `## Internal Structure` pseudocode. The `## Non-Goals` bullet "Terminating / pooling the worker. One engine owns one lazily-built ELK instance for its lifetime (unchanged)" reads as though one engine never rebuilds its ELK instance, which the fallback path contradicts (an instance can be replaced once, after which "for its lifetime" holds again). Calling elkjs's `terminateWorker()` on the abandoned instance was not added: it is a new capability the shim's `ElkConstructorOptions` doesn't declare, no code in this codebase calls it today, and the same Non-Goals bullet explicitly places "terminating … the worker" out of this plan's scope — adding it would be scope creep past what was authorised, not a bug fix. Left as a known trade-off (the abandoned worker's thread stays alive for the page's lifetime) for a future plan to pick up if it matters in practice.
- **`packages/lib/tests/component/diagram/DiagramView.createEngine.test.ts` was added; the plan's Files table lists only `ElkLayoutEngine.test.ts`.** The plan's own Non-Goals and Expected Behaviour sections never claimed `DiagramView.createEngine` needed no test — that omission surfaced during audit, since every existing `DiagramView.test.ts` case overrides `createEngine` with a stub and so never exercises the real one. The new file constructs a real `_DiagramView` with no `data` (so `relayout`/elkjs never runs during construction), reads the real `ElkLayoutEngine` `createEngine()` actually built via this suite's existing `as any` private-field access pattern (`DiagramView.test.ts`'s own casts), and drives `.layout(...)` on it directly, observing real elkjs's own `workerFactory`-invocation and `workerUrl`-unavailable-`console.warn` side effects — no test double for `ElkLayoutEngine` or elkjs.
- **`elkWorkerUrl` never achieves off-thread layout with the `elk.bundled.js` module this plan wires up — the plan's own precedence table (row 2) and footnote `[^factory-api]` ("when only `workerUrl` is supplied it constructs `new Worker(url)` internally") are wrong for this code path.** That footnote describes elkjs's un-bundled `elk-api.js`, which has real Node `require`. `ElkLayoutEngine` only ever imports `elkjs/lib/elk.bundled.js` (per the plan's own Architecture Decisions), whose `ELKNode` wrapper checks `require.resolve('web-worker')` before honouring `workerUrl` — and in that browserify bundle, `require` is a local module-loader closure with no `.resolve` at all, so the check always throws, is always caught, and `workerUrl` always falls through to elkjs's own in-process fallback worker on the main thread (with a `console.warn` from elkjs itself). This is unconditional — not a per-environment "runtime feature-detection" as earlier revisions of this file's JSDoc and the component docs described it — confirmed by reading `elk.bundled.js`'s bundler-generated module loader directly and by `DiagramView.createEngine.test.ts`'s `elkWorkerUrl` case, which asserts the warning fires. `ElkLayoutEngine.ts`'s and `docs/components/DiagramView.md`'s prose now say this plainly; `elkWorkerUrl` is kept only for API parity with elkjs (and because removing it isn't this plan's job — see Non-Goals), not because it delivers off-thread layout here.
- **The plan's manual browser verification (off-thread execution with no UI freeze; CSP fallback) was not performed as part of this implementation.** Both checks require a consumer app wired up with `elkWorkerFactory` in a real browser — this plan only changes the library, and its own demo instantiation (`DiagramPanel.ts:76`) deliberately stays on the main thread (see Public API). The natural place to run them is sqladmin's `elk-worker-adoption` plan, which depends on this one, actually threads `elkWorkerFactory` into a live app, and lists the same checks in its own Verification section (opening its 154-table hub schema diagram via the `verify` skill). Recorded here rather than silently skipped; deferred to that plan's implementation, not abandoned.
- **The audit/fix loop hit its 5-iteration cap with one BLOCKING finding still open, per the `audit` skill's exit condition.** The finding — `DiagramView.ts`'s `elkWorkerUrl` option JSDoc still made the same off-thread overclaim already corrected on `ElkLayoutEngineOptions.workerUrl` and in the component docs (see the note above) — was a one-line mirror of three already-verified fixes, so it was applied directly rather than left open, but **without a further fresh-context re-audit**, since the loop had already reached its cap. Recorded here per the skill's instruction to surface a cap-exit plainly rather than silently presenting the branch as fully audit-clean.
