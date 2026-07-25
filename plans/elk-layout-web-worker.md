# ELK Diagram Layout in a Web Worker by Default — Implementation Plan

## Overview

`DiagramView` runs ELK graph layout through [`ElkLayoutEngine`](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L345). Today layout runs on the **main thread**: `ensureElk` imports `elkjs/lib/elk.bundled.js` and calls `new ELK()` ([ElkLayoutEngine.ts:388](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L388)), which drives ELK through an in-process *fake* worker that blocks the UI — measured at ~13–15s for a ~154-node schema graph. The one off-thread option, `elkWorkerUrl` ([DiagramView.ts:76](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L76)), requires the consumer to host `elk-worker.js`, so nobody uses it.

This plan makes off-thread layout the **default**, constructed by the library with **zero consumer config**, with **automatic, transparent fallback** to main-thread layout when a worker can't be used, and one explicit override (`elkMainThread`) to force main-thread. ELK stays an **optional peer dependency**: the library ships only a *reference* to `elkjs`'s worker file — the consumer's bundler pulls ELK's code from the consumer's own `node_modules`. No ELK code is ever vendored into the library's published distribution (an EPL-2.0 licensing constraint, see below).

The work touches four source areas: the engine ([ElkLayoutEngine.ts](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts)), its type shim ([elkjs.d.ts](packages/lib/src/typescript/lib/component/diagram/elkjs.d.ts)), the view option ([DiagramView.ts](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts)), and the library build config ([vite.lib.config.ts](packages/lib/vite.lib.config.ts)) plus [tsconfig.json](packages/lib/tsconfig.json). Post-layout DOM construction stays on the main thread — only the ELK *compute* moves off-thread (see Non-Goals).

---

## Architecture Decisions

### Worker is the default; the library constructs it itself

The default engine builds a real Web Worker from `elkjs`'s shipped worker script, with no `workerUrl` from the consumer.[^default-worker] It mirrors the codebase's one existing worker client, [`StoreWorkerClient`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts) — a module that lazily constructs a single `Worker`, guards on `typeof Worker === "undefined"`, and degrades gracefully when the worker can't be built.[^precedent]

### Construction mechanism: `new Worker(new URL(..., import.meta.url))` via elkjs `workerFactory`

The worker is built by a module-level function:

```typescript
function createElkWorker(): Worker {
    return new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url), { type: "classic" });
}
```

passed to elkjs's `workerFactory` option on the thin `elkjs/lib/elk-api.js` module. This is the bundler-portable pattern both Vite and webpack 5 statically analyse.[^mechanism] The worker type is **`"classic"`, not `"module"`** — `elk-worker.min.js` is a classic browserify script that references `module.exports` at top level, and elkjs's own base constructor builds it with a plain `new Worker(url)` (classic).[^classic]

### The reference must stay external to the library bundle — licensing

`elkjs` is **EPL-2.0** (`node_modules/elkjs/LICENSE.md`, `package.json` `"license": "EPL-2.0"`). The library MUST NOT vendor, inline, bundle, or copy any ELK code — `elk-worker.min.js`, `elk.bundled.js`, or `elk-api.js` — into its own published distribution (`packages/lib` publishes `dist/lib`, see its `package.json` `files`). ELK stays an **optional peer dependency** resolved from the consumer's install, exactly as the current `import("elkjs/lib/elk.bundled.js")` is already left external by the build's `external: [/^elkjs(\/|$)/]` rule ([vite.lib.config.ts:90](packages/lib/vite.lib.config.ts#L90)). This aligns with the repo's third-party policy: the root [`NOTICE`](NOTICE) attributes only genuinely-vendored material (Font Awesome path data); ELK is never vendored, so it needs no NOTICE entry.

The obstacle: Vite's worker plugin, by default, **resolves and bundles** `new Worker(new URL("elkjs/...", import.meta.url))` at *library* build time — emitting a 2.1 MB `dist/lib/assets/elk-worker.min-*.js` and rewriting the reference to `/assets/…`.[^bundling-proof] That would embed EPL code into the published library. Marking `elkjs` `external` does **not** stop it — the worker plugin bypasses `external`.[^external-nostop] So the library build gets a small plugin that keeps the reference verbatim (see next decision), and every approach that would embed ELK worker source into the library bundle is **rejected on licensing grounds**: Blob-URL workers built from inlined worker source, `?worker` / `?worker&inline` on an `elkjs` path, copying `elk-worker` into `dist/lib`, or any `workerFactory` closing over vendored ELK code.

### Library build keeps the worker reference external via a swap-restore plugin

A small Vite plugin in [vite.lib.config.ts](packages/lib/vite.lib.config.ts) swaps the exact `new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url), { type: "classic" })` expression out of `ElkLayoutEngine` **before** Vite's worker plugin runs, then restores it byte-for-byte in the emitted chunk. The result: `dist/lib` contains the reference **verbatim** and **no ELK asset**.[^plugin-proof] The consumer's bundler (which does *not* externalize `elkjs`) then re-processes that reference and resolves the worker from the consumer's own `elkjs`, emitting the worker into the *consumer's* bundle.[^consumer-proof]

### Automatic, transparent fallback to main thread

When `typeof Worker === "undefined"` (Node/jsdom/happy-dom tests, SSR), or worker construction / the first layout throws (e.g. CSP blocks the worker), the engine builds the main-thread engine (`elkjs/lib/elk.bundled.js` + `new ELK()`) and renders normally. A worker failure never surfaces as a diagram error.[^fallback] Only a genuinely-absent `elkjs` (both module imports fail) propagates — preserving today's "ELK absent → empty view" behaviour via [`DiagramView.handleLayoutFailure`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L426).

### One explicit override: `DiagramViewOptions.elkMainThread`

A new construction-only boolean `elkMainThread` forces main-thread layout. It mirrors the existing `elkWorkerUrl` plumbing exactly (options-bag field, forwarded in `applyOptions`, read once in `createEngine`) — no setter/getter, no class default.[^option-shape] `elkWorkerUrl` keeps working unchanged. No node-count threshold gates the worker — the engine always attempts it, then falls back.[^no-threshold]

### Precedence

The engine resolves its mode in this fixed order (first match wins):

| `elkMainThread` | `elkWorkerUrl` | `typeof Worker` | Engine built | Layout thread |
|---|---|---|---|---|
| `true` | (any) | (any) | `elk.bundled.js` → `new ELK()` | main (forced) |
| unset | `"https://…/elk-worker.js"` | (any) | `elk-api.js` → `new ELK({ workerUrl })` | worker (consumer-hosted); falls back to main on failure |
| unset | unset | `"function"` | `elk-api.js` → `new ELK({ workerFactory })` | worker (self-hosted, default) |
| unset | unset | `"undefined"` | `elk.bundled.js` → `new ELK()` | main (auto-fallback) |
| unset | unset | `"function"`, worker/first-layout throws | falls back to `elk.bundled.js` → `new ELK()` | main (auto-fallback) |

`elkMainThread` is the top-level kill switch — it wins even over `elkWorkerUrl` (setting both is contradictory; "force main thread" is unconditional).

---

## Public API

### `DiagramViewOptions` (modified)

```typescript
export interface DiagramViewOptions extends PanelOptions {
    // …existing fields unchanged…
    /** URL of a consumer-hosted `elk-worker.js`. When set, ELK runs at this worker URL. */
    elkWorkerUrl?: string;
    /** Force ELK layout onto the main thread, disabling the default self-hosted worker. */
    elkMainThread?: boolean;
}
```

No setter/getter (construction-only, mirroring `elkWorkerUrl`). No `DiagramView` subclasses exist; the sole instantiation site ([DiagramPanel.ts:76](packages/lib/src/typescript/DiagramPanel.ts#L76)) passes neither option and so gets the self-hosted worker by default.

### `ElkLayoutEngine` constructor (changed signature)

```typescript
export interface ElkLayoutEngineOptions {
    /** Consumer-hosted `elk-worker.js` URL (the explicit off-thread path). */
    workerUrl?: string;
    /** Force main-thread layout, disabling the default self-hosted worker. */
    mainThread?: boolean;
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
export default class ELK {
    constructor(options?: ElkConstructorOptions);
    layout(graph: unknown): Promise<unknown>;
}
```

One shim types both `elkjs/lib/elk.bundled.js` and `elkjs/lib/elk-api.js` (identical default-export ELK constructor).

---

## Internal Structure

`ElkLayoutEngine` after the change:

```typescript
private _elk: ElkInstance | null = null;
private readonly _workerUrl?: string;
private readonly _mainThread: boolean;
/** True while `_elk` is worker-backed, so a layout failure retries on the main thread once. */
private _workerBacked = false;

constructor(options?: ElkLayoutEngineOptions) {
    this._workerUrl  = options?.workerUrl;
    this._mainThread = options?.mainThread ?? false;
}

async layout(data, sizes, defaults): Promise<DiagramLayoutResult> {
    const graph = buildElkGraph(data, sizes, defaults);
    try {
        const elk = await this.ensureElk();
        return mapElkResult(await elk.layout(graph) as ElkNode);
    } catch (error) {
        if (this._workerBacked) {
            // Worker construction (e.g. CSP) or first-layout compute failed.
            // Rebuild on the main thread and retry once so a worker failure
            // degrades to a rendered diagram, not a diagram error.
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
    if (this._mainThread) {
        return this.createMainThreadElk();                 // forced override
    }
    if (this._workerUrl) {
        const { default: ELK } = await import("elkjs/lib/elk-api.js");
        this._workerBacked = true;                         // worker-backed: falls back on failure
        return new ELK({ workerUrl: this._workerUrl });    // consumer-hosted worker
    }
    if (typeof Worker === "undefined") {
        return this.createMainThreadElk();                 // Node/jsdom/SSR fallback
    }
    const { default: ELK } = await import("elkjs/lib/elk-api.js");
    this._workerBacked = true;                             // set BEFORE construct so a
    return new ELK({ workerFactory: createElkWorker });    // sync throw triggers retry
}

private async createMainThreadElk(): Promise<ElkInstance> {
    const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
    return new ELK();
}
```

`_workerBacked` is set **before** `new ELK({ workerFactory })` so a synchronous worker-construction throw is caught by `layout`'s `catch` and retried on the main thread.

The Vite plugin (in `vite.lib.config.ts`):

```typescript
const ELK_WORKER_EXPR = 'new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url), { type: "classic" })';
const ELK_WORKER_MARK = '"__ELK_WORKER_REF__"';

function externalizeElkWorker() {
    return {
        name: "externalize-elk-worker",
        enforce: "pre" as const,
        transform(code: string, id: string) {
            if (!id.includes("ElkLayoutEngine")) return null;
            if (!code.includes(ELK_WORKER_EXPR)) {
                throw new Error("externalize-elk-worker: worker expression not found — did the source drift?");
            }
            return { code: code.split(ELK_WORKER_EXPR).join(ELK_WORKER_MARK), map: null };
        },
        generateBundle(_options: unknown, bundle: Record<string, any>) {
            let restored = false;
            for (const file of Object.values(bundle)) {
                if (file.type === "chunk" && file.code.includes(ELK_WORKER_MARK)) {
                    file.code = file.code.split(ELK_WORKER_MARK).join(ELK_WORKER_EXPR);
                    restored = true;
                }
            }
            if (!restored) {
                throw new Error("externalize-elk-worker: marker not found in output — restore failed.");
            }
        },
    };
}
```

Both hooks assert loudly, so any drift in the source expression fails the build instead of silently vendoring or breaking the worker. `ELK_WORKER_EXPR` must stay **byte-identical** to the source in `createElkWorker`.

---

## Ordered Implementation Steps

1. **`elkjs.d.ts` — add `workerFactory` typing.** In `ElkConstructorOptions` add `workerFactory?: (url?: string) => Worker;`. Update the file's top comment to say it types both `elk.bundled.js` and `elk-api.js`.
   - Check: `grep -n workerFactory packages/lib/src/typescript/lib/component/diagram/elkjs.d.ts` — one hit.

2. **`tsconfig.json` — map the `elk-api.js` specifier to the shim.** In `compilerOptions.paths`, beside the existing `"elkjs/lib/elk.bundled.js"` entry ([L36](packages/lib/tsconfig.json#L36)) add `"elkjs/lib/elk-api.js": ["./src/typescript/lib/component/diagram/elkjs.d.ts"]`.
   - Check: `npm run typecheck` resolves the new `import("elkjs/lib/elk-api.js")` without a "cannot find module" error (after step 3).

3. **`ElkLayoutEngine.ts` — new constructor, mode selection, fallback, worker factory.** Replace the `constructor(workerUrl?)`, `_workerUrl` field, and `ensureElk` with the structure in *Internal Structure*: add `ElkLayoutEngineOptions`, the `_mainThread` / `_workerBacked` fields, the options-object constructor, the `layout` retry wrapper, `createElk`, `createMainThreadElk`, and the module-level `createElkWorker`. Keep `buildElkGraph` / `mapElkResult` and all pure helpers unchanged. Update the class/`layout` JSDoc to describe worker-default + fallback. Remove the now-unused `workerUrl` JSDoc `@param` on the old constructor.
   - Check: `grep -n 'elk.bundled.js\|elk-api.js\|workerFactory\|_workerBacked' ElkLayoutEngine.ts` — bundled import in `createMainThreadElk`, api import in the two worker branches, factory in the default branch.
   - Check: `grep -n 'new URL("elkjs/lib/elk-worker.min.js", import.meta.url)' ElkLayoutEngine.ts` — exactly one hit, byte-identical to `ELK_WORKER_EXPR`.

4. **`DiagramView.ts` — add `elkMainThread`.** In `DiagramViewOptions` add `elkMainThread?: boolean;` beside `elkWorkerUrl` ([L77](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L77)). In `applyOptions` add `if (options.elkMainThread !== undefined) this._options.elkMainThread = options.elkMainThread;`. In `createEngine` return `new ElkLayoutEngine({ workerUrl: this._options.elkWorkerUrl, mainThread: this._options.elkMainThread })`.
   - Check: `grep -n elkMainThread DiagramView.ts` — three hits (interface, applyOptions, createEngine).

5. **`vite.lib.config.ts` — add the swap-restore plugin.** Add `externalizeElkWorker()` (from *Internal Structure*) and register it in `plugins: [externalizeElkWorker()]`. Leave the existing `external` regex untouched.
   - Check: `npm run build:lib` succeeds; then run the two Verification bundle assertions.

6. **New test `tests/component/diagram/ElkLayoutEngine.test.ts`.** Cover the fallback matrix with `vi.mock` on both elkjs modules and a stubbed `globalThis.Worker` (see *Expected Behaviour*).

7. **Docs — `docs/components/DiagramView.md`.** Rewrite the "Off-thread layout (opt-in)" Notes bullet ([L120](packages/lib/docs/components/DiagramView.md#L120)) to state the new worker-by-default behaviour, the auto-fallback, the `elkMainThread` override, and that `elkWorkerUrl` still forces a consumer-hosted worker. Update the "Graceful when ELK is absent" bullet if wording overlaps.

8. **Full gate.** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:lib`, `npm run docs:api` — all clean (Verification).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/elkjs.d.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` |
| Modify | `packages/lib/vite.lib.config.ts` |
| Modify | `packages/lib/tsconfig.json` |
| Modify | `packages/lib/docs/components/DiagramView.md` |
| Create | `packages/lib/tests/component/diagram/ElkLayoutEngine.test.ts` |

---

## Expected Behaviour

All cases below are **unit-testable** under the repo's Node vitest by mocking `elkjs/lib/elk-api.js` and `elkjs/lib/elk.bundled.js` (each mock's `default` is a class recording its constructor options and exposing a `layout` spy) and controlling `globalThis.Worker`. The Node test env defines no `Worker` global (`tests/setup/node-setup.ts` adds none), so case 1 needs no stubbing.

1. **No `Worker` in the runtime (Node default).** `new ElkLayoutEngine()` then `layout(...)` builds via the **bundled** mock (`new ELK()` with no options); the api mock is never constructed. Resolves with the mapped result.
2. **`mainThread: true`, `Worker` present.** With `globalThis.Worker` stubbed, `layout(...)` still builds via the **bundled** mock; the api mock is never constructed.
3. **`workerUrl: "https://x/elk-worker.js"`, `Worker` present.** Builds via the **api** mock with `{ workerUrl: "https://x/elk-worker.js" }`; the bundled mock is never constructed.
4. **Default, `Worker` present, worker healthy.** Builds via the **api** mock with a `workerFactory`; invoking that factory returns the stubbed `Worker` instance. Resolves with the mapped result; the bundled mock is never constructed.
5. **Default, `Worker` constructor throws (CSP-style sync failure).** With `globalThis.Worker` stubbed to throw, `layout(...)` catches the throw and **falls back**: builds the **bundled** mock and resolves with the mapped result.
6. **Default, worker constructs but first `layout` rejects.** The api mock's `layout` rejects once; `layout(...)` **falls back** to the bundled mock and resolves. (After fallback, `_workerBacked` is false, so a subsequent bundled failure would propagate.)
7. **`elkjs` genuinely absent.** Both mocks reject on import (or on `layout`); `layout(...)` **rejects**. In `DiagramView`, [`relayout`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L296) routes the rejection to `handleLayoutFailure`, leaving the view empty (unchanged behaviour).
8. **Precedence.** `{ elkMainThread: true, elkWorkerUrl: "x" }` builds the **bundled** (main-thread) mock — `elkMainThread` wins over `elkWorkerUrl`.

**Manual verification (browser, not unit-testable):**

- **Off-thread execution.** In sqladmin, open a large schema diagram (~150 nodes) and confirm the UI stays responsive during layout (pan/scroll/other tabs) rather than freezing for ~13–15s, and that the network panel shows the worker asset loading from `/assets/elk-worker.min-*.js`.
- **Fallback under CSP.** With a strict `worker-src 'none'` CSP, confirm the diagram still renders (on the main thread) with no diagram error surfaced.

---

## Verification

- **Typecheck:** `npm run typecheck` clean — the new `import("elkjs/lib/elk-api.js")` resolves via the tsconfig path + shim; `workerFactory` typed.
- **Lint:** `npm run lint` clean. `ElkLayoutEngine`'s `new Worker` / `Worker` usage mirrors the allowed `StoreWorkerClient` (the `local/no-raw-dom` rule targets `Element`/`Node`/`HTMLElement` and raw element access, not `Worker`).
- **Unit tests:** `npm test` — the new `ElkLayoutEngine.test.ts` cases 1–8 pass; existing `DiagramView.test.ts` (StubEngine) and `default-options-fallback.test.ts` unchanged and green.
- **Build + licensing assertions:** `npm run build:lib`, then:
  - `test -z "$(find packages/lib/dist/lib -iname '*elk-worker*' -o -iname '*elk.bundled*' -o -iname '*elk-api*')"` — **no ELK asset** in the published library.
  - `grep -rF 'new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url), { type: "classic" })' packages/lib/dist/lib/component/diagram.es.js` — the reference survived **verbatim**.
  - `grep -F 'elkjs/lib/elk-api.js' packages/lib/dist/lib/component/diagram.es.js` and `grep -F 'elkjs/lib/elk.bundled.js' …` — both bare specifiers present (externalized, not inlined).
- **Docs:** `npm run docs:api` finishes with **zero** warnings.
- **Manual smoke:** the two browser checks in *Expected Behaviour*, run in sqladmin (log in per project notes; scope DevTools to `.DiagramView`).

---

## Documentation Impact

- **Option catalog / guide:** [`docs/components/DiagramView.md`](packages/lib/docs/components/DiagramView.md) — the "Off-thread layout" Notes bullet is the only place the worker behaviour is documented. Update it to: worker by default (zero-config), automatic fallback to main-thread, `elkMainThread: true` to force main-thread, and `elkWorkerUrl` still available for a consumer-hosted worker. The Installation section's "lazily imported… kept out of the core bundle" wording stays accurate (the worker is still resolved from the consumer's `elkjs`, not bundled into the core chunk).
- **TypeDoc:** `ElkLayoutEngineOptions` is a new exported interface in the already-registered `component/diagram` entry point — it appears in the API docs automatically. Ensure its JSDoc `{@link}`s only public symbols (per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)).
- No barrel/sidebar/catalog changes: `DiagramView` and the `component/diagram` subpath already exist; this adds only a field and an interface.

---

## Potential Challenges

- **Vite worker plugin bundles the reference by default.** Without the swap-restore plugin the library ships EPL worker code. Mitigation: the plugin (Step 5) plus the two build-time assertions in Verification; both plugin hooks throw if the source expression drifts.
- **`ELK_WORKER_EXPR` must match the source byte-for-byte.** A reformat of `createElkWorker` (quotes, spaces) breaks the swap. Mitigation: the `transform` hook throws when the expression isn't found, failing the build loudly; Verification greps the source for the exact string.
- **Async worker failure that neither throws nor resolves.** A worker that constructs but then hangs (a rare CSP variant that doesn't throw synchronously) leaves elkjs's layout promise unsettled, so the `catch` fallback never fires. Mitigation: in practice Chrome rejects a CSP-blocked worker synchronously at `new Worker`, which *is* caught; a timeout-based guard is deliberately out of scope (adds a magic timeout with no clean signal). Documented as a known edge.
- **Consumer bundler that isn't Vite/webpack-5.** A bundler that can't statically resolve `new Worker(new URL(..., import.meta.url))` won't produce a worker; the first layout then throws and the engine falls back to main-thread — degraded but correct. Mitigation: the fallback covers it; no consumer breakage.
- **`/assets/` deployment path.** The consumer build rewrites the worker to an absolute `/assets/elk-worker.min-*.js` (same as the existing `StoreWorkerClient` `/assets/StoreWorker-*.js`). A consumer serving assets from a non-root base already handles this for `StoreWorker`; if not, the worker 404s and the engine falls back to main-thread. Mitigation: identical to the shipped `StoreWorker` model; fallback covers a miss.

---

## Critical Files

- [packages/lib/src/typescript/lib/data/StoreWorkerClient.ts](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts) — the mirrored precedent: lazy single-`Worker` construction, `typeof Worker === "undefined"` guard, `try/catch` graceful degradation, and unflagged `new Worker` / `Worker` usage.
- [packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts) — the engine being changed; `ensureElk` (L388) and the constructor (L355).
- [packages/lib/src/typescript/lib/component/diagram/DiagramView.ts](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) — `createEngine` (L192), `applyOptions` (L202), `relayout`/`handleLayoutFailure` (L296/L426).
- [packages/lib/vite.lib.config.ts](packages/lib/vite.lib.config.ts) — the `external` regex (L90) and where the plugin registers.
- [node_modules/elkjs/lib/elk-api.d.ts](node_modules/elkjs/lib/elk-api.d.ts) — the real `ELKConstructorArguments` (`workerUrl`, `workerFactory`) the shim reflects.
- [packages/lib/tests/component/diagram/DiagramView.test.ts](packages/lib/tests/component/diagram/DiagramView.test.ts) — the `StubEngine` / `StubDiagramView` harness the new tests sit beside.

---

## Non-Goals

- **Moving DOM work off-thread.** Building and positioning the N node elements after ELK returns stays on the main thread; only ELK compute moves off-thread. Worker DOM access isn't possible, and the framework's DOM seam is main-thread by design.
- **A node-count threshold.** The engine always attempts the worker regardless of graph size — worker overhead on small graphs is negligible and node count is a poor proxy for layout cost.[^no-threshold]
- **Terminating / pooling the worker.** One engine owns one lazily-built ELK instance for its lifetime (unchanged); no `terminateWorker` wiring is added.
- **Removing `elkWorkerUrl`.** The consumer-hosted-worker option is preserved as-is.

---

## Notes

[^default-worker]: Today `new ELK()` from `elkjs/lib/elk.bundled.js` is **not** truly main-thread-by-choice — with no `workerFactory`/`workerUrl`, `elk.bundled.js` falls back to an in-process *fake* worker (`require('./elk-worker.min.js').Worker`, [elk.bundled.js:6518-6524](node_modules/elkjs/lib/elk.bundled.js)) that runs the GWT algorithm synchronously and blocks the main thread. Switching the default to a real Web Worker moves that same compute off-thread; the DOM work that follows is unchanged.

[^precedent]: [`StoreWorkerClient`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts) establishes the repo's worker pattern: a module lazily constructs one `Worker` (`ensureWorker`, L30), guards `if (typeof Worker === "undefined") return null` (L32), wraps construction in `try/catch` (L34-L39), and callers degrade gracefully (`isAvailable()`, L77). `ElkLayoutEngine` follows the same three moves, adapted to elkjs's promise API. It diverges in one respect — it constructs the worker from an **external package** rather than a lib-internal `?worker` module — which is why the build needs the swap-restore plugin (StoreWorker's own code is fine to bundle; ELK's is not).

[^mechanism]: elkjs's real constructor arguments are `defaultLayoutOptions`, `algorithms`, `workerUrl`, and `workerFactory: (url?) => Worker` ([elk-api.d.ts:126-131](node_modules/elkjs/lib/elk-api.d.ts)). Passing `workerFactory` on the thin `elk-api.js` module (~9 KB) lets the library own worker construction while ELK's algorithm lives entirely in the worker script — nothing GWT-sized loads on the main thread. `new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url))` is the pattern Vite and webpack 5 statically detect and rewrite to a bundler-emitted worker; it requires no consumer-hosted file. A Blob-URL worker was rejected: it needs the worker *source* as a string, which means inlining ELK — a licensing violation — and trips `worker-src blob:` CSPs.

[^classic]: `elk-worker.min.js` opens with `'use strict'; var $wnd; …` and references `module.exports` at top level with no `import`/`export` and no `importScripts` — a classic browserify script. elkjs's own base constructor builds it as `new Worker(url)` with no `type` (i.e. classic, [elk-api.js:42-46](node_modules/elkjs/lib/elk-api.js)). A `{ type: "module" }` worker executes in module scope where top-level `module` is undefined, so `module.exports` would throw at load. Hence `{ type: "classic" }`. This is a deliberate correction to the initially-suggested `{ type: "module" }`, made after reading the shipped worker file.

[^bundling-proof]: Verified empirically: a minimal Vite lib build (Vite 8.1.5 / rolldown, matching the repo) with `rollupOptions.external: [/^elkjs/]` and a source `new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url), { type: "classic" })` emitted `dist/assets/elk-worker.min-*.js` (2.17 MB) and rewrote the call to `new Worker(new URL("/assets/elk-worker.min-*.js", import.meta.url), …)`. The sibling `import("elkjs/lib/elk-api.js")` survived verbatim (external governs it; the worker plugin does not).

[^external-nostop]: Also verified: adding a `resolveId` plugin returning `{ id, external: true }` for the worker specifier did **not** stop the bundling — Vite's worker plugin resolves the worker entry through its own `workerFileToUrl`/`bundleWorkerEntry` path, bypassing `external`. Only removing the recognizable pattern from the worker plugin's view (the swap-restore approach) prevents the emit.

[^plugin-proof]: Verified: with a `transform` (enforce `pre`) swapping the exact expression to a marker string and a `generateBundle` restoring it, the same lib build emitted **only** the entry chunk (no `assets/`, no ELK code) and the output contained `new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url), { type: "classic" })` **verbatim**. String-literal contents survive oxc minification, so the marker is stable; the restore runs in `generateBundle`, after minification, on the final chunk text.

[^consumer-proof]: Verified end-to-end: a downstream Vite build importing a dependency whose dist contained the verbatim reference (with `elkjs` a `node_modules` sibling and *not* externalized) resolved `elkjs/lib/elk-worker.min.js` from the consumer's own `elkjs`, emitting `dist/assets/elk-worker.min-*.js` into the **consumer's** output and pulling `elk-api.js` from the consumer's `elkjs`. This realises the intent: only a reference ships in the library; ELK's code is pulled from the consumer's install — the same deployment shape as the shipped `StoreWorker` (`/assets/…`).

[^fallback]: Both worker paths — the self-hosted `workerFactory` default and the explicit `workerUrl` — set `_workerBacked = true`, so any worker failure degrades to a main-thread render. The fallback has two tiers. Construction-time: for the default path `typeof Worker === "undefined"` is checked before the worker build (covers Node/jsdom/happy-dom/SSR), and a synchronous `new Worker` throw is caught because `_workerBacked` is set *before* `new ELK({ … })`. Layout-time: if the worker-backed engine's first `layout` rejects (worker errored at compute), `layout`'s `catch` rebuilds on the main thread and retries once. A main-thread build/compute failure is not retried — that means `elkjs` itself is absent or broken, which correctly propagates to `DiagramView.handleLayoutFailure`. Making `elkWorkerUrl` worker-backed is a small, strictly-better change to its behaviour: a broken consumer URL now renders on the main thread instead of leaving the view empty, matching the architecture's degradation principle.

[^option-shape]: `elkWorkerUrl` is stored in `_options`, forwarded in `applyOptions`, and read once in `createEngine` with no public setter/getter (it is construction-only, [DiagramView.ts:209](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L209)/[L193](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L193)). `elkMainThread` mirrors that shape exactly, so it needs no entry in `tests/component/default-options-fallback.test.ts` (that registry guards *class-defaulted* fields read at render; `elkMainThread` has no class default and is read once at engine construction).

[^no-threshold]: A node-count gate was rejected on two grounds: worker construction + message round-trip overhead is a few milliseconds — negligible even on tiny graphs — and node count does not predict layout cost (edge density, hierarchy depth, and the chosen ELK algorithm dominate). Always attempting the worker and falling back on failure is simpler and has no bad case.
