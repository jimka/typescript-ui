---
depends-on: [tauri-desktop-prototype.md]
---

# Tauri Desktop — Hardened (Python Sidecar) — Implementation Plan

## Overview

Take the throwaway Tauri shell from [tauri-desktop-prototype.md](./tauri-desktop-prototype.md) and make it **shippable while keeping the Python backend**. The prototype proved the native-webview RSS win but left four holes open by design: an unfrozen dev-env sidecar, a fixed port with **no auth** (so any local process can run arbitrary SQL via [backend/app/main.py:440](../../sqladmin/backend/app/main.py#L440)), a cold-start race, and a `DATABASE_URL` sourced only from the launching process env.

This plan closes exactly those holes. It does **not** re-derive the prototype's scaffolding — the Tauri shell location (`frontend/src-tauri/`), the sidecar-as-`externalBin` model, the `beforeDevCommand`/`beforeBuildCommand` build hooks, the `CommandChild`-in-managed-state lifecycle, and the `API_BASE` frontend shim are all reused as-is. Everything below is the **delta** over the prototype.

The DELTA, in one list:
1. **PyInstaller one-file freeze** of the FastAPI app into a self-contained sidecar binary (replacing the prototype's dev-env launcher), wired into `beforeBuildCommand`.
2. **Random ephemeral port + per-launch bearer token** (the Jupyter model): Rust generates both, injects them into the sidecar env and into the webview; FastAPI rejects any request without the matching token. This is the real fix for the local-arbitrary-SQL gap.
3. **Readiness gate** on a new `/health` endpoint before the UI fires real requests.
4. **Explicit sidecar kill** on window-close, hardening the prototype's exit-only kill.
5. **`DATABASE_URL` from a local config file** read by Rust, replacing the pass-through-process-env approach.

As in the prototype, **every source change lands in the sqladmin repo** at `/home/jika/typescript/sqladmin`; no `@jimka/typescript-ui` file changes. This plan file lives in `typescript-ui` because its conventions govern how the document is written.

---

## Architecture Decisions

### Freeze with PyInstaller `--onefile`, per-platform, into `beforeBuildCommand`

The prototype accepted a dev-env launcher (a shell script running the machine's `.venv` uvicorn). The hardened build ships a **self-contained single-file binary** so the app has no Python-install prerequisite. The three backend deps ([backend/pyproject.toml:8-12](../../sqladmin/backend/pyproject.toml#L8)) — `fastapi`, `uvicorn[standard]`, `asyncpg` — freeze cleanly only if the two known PyInstaller traps are handled explicitly:

- **`uvicorn[standard]` lazy imports.** uvicorn imports uvloop, httptools, and the websockets/`wsproto` protocol impls *by string name at runtime*, so PyInstaller's static analysis misses them and the frozen binary dies with `ModuleNotFoundError` the moment uvicorn tries to select its event loop / HTTP protocol. Fix: `--collect-all uvicorn` (pulls uvicorn's whole submodule tree), plus explicit `--hidden-import` for `uvloop`, `httptools`, `websockets`, `wsproto` as belt-and-braces.
- **`asyncpg` C-extension + protocol package.** asyncpg ships compiled `.so`/`.pyd` (`asyncpg.protocol.protocol`) and a `_asyncpg` extension; `--collect-all asyncpg` bundles the binary artifacts and its `pgproto` submodule that a bare freeze drops.

Freezing is **per-platform — no cross-compilation.** PyInstaller emits a binary for the OS/arch it runs on; a shippable matrix means running the freeze on each target (Windows/macOS/Linux) or in per-OS CI runners. The frozen binary is **~35–50 MB on disk** (Python runtime + the three deps + their native libs). This is a **disk** cost inside the bundle, not a RAM cost — the running process's RSS is the interpreter's working set, unchanged from an unfrozen run, and is the number the prototype measured.

The freeze becomes part of Tauri's `build.beforeBuildCommand`: the command first runs the PyInstaller build (emitting `sqladmin-backend-<target-triple>` into `frontend/src-tauri/binaries/`), then `npm run build`. `externalBin` picks the binary up exactly as in the prototype.

### Random ephemeral port + per-launch bearer token — the Jupyter model

**This is the security core of the plan.** The prototype's fixed `127.0.0.1:8756` with loopback-bind-only protection means *any local process or local user* can `curl` the port and hit `POST /api/{connection_id}/query` — arbitrary SQL against the connected Postgres for as long as the app runs. The prototype's own [Security posture decision](./tauri-desktop-prototype.md) flags this and forwards the fix here.

**Why loopback + CORS is not enough, stated plainly:** binding `127.0.0.1` stops *off-machine* access but nothing on-machine — the port is reachable by every process on the box. CORS is a **browser-enforced** control: it governs what a *web page* may read cross-origin, and is simply not present when a native client (`curl`, a malicious helper, another user's process) calls the socket directly. So neither mechanism authenticates the caller.

**The fix — a shared secret only the two cooperating processes know:**

- At launch the Rust core generates a **cryptographically random token** (32 bytes, hex/base64 — via the `rand` crate, or reuse the `uuid` v4 already likely present) **and** picks a **free ephemeral port** by binding `TcpListener::bind("127.0.0.1:0")`, reading the assigned port, and dropping the listener (a brief TOCTOU window the sidecar re-binds immediately).
- Rust injects **both** into the sidecar env: `SQLADMIN_TOKEN=<token>` and the port (as `--port <n>` on the sidecar CLI, see the freeze entrypoint below).
- Rust injects **both** into the webview via a Tauri **initialization script** that runs before any app JS: `window.__SQLADMIN__ = { base: "http://127.0.0.1:<port>", token: "<token>" }`. This is synchronous — `api.ts` reads it at module load with no `invoke()` round-trip and no async race. (Alternative: a `#[tauri::command] get_api_config()` the frontend `invoke()`s at bootstrap; rejected because it forces the API base/token resolution to be async, complicating the existing synchronous `API_BASE` constant.)
- FastAPI adds **one** dependency/middleware that compares the request's bearer token against `SQLADMIN_TOKEN` and returns **401** on any mismatch or absence.

Why this is the real fix: the token is a per-launch secret shared **only** between the Rust parent and its own frozen child (env) and its own webview (init script). A foreign local process does not have it, so it cannot call the API. It also defeats the **malicious-website / DNS-rebinding** class: a browser page that resolves a hostname to `127.0.0.1` still cannot read the token, so its forged requests 401. This closes the arbitrary-SQL gap the prototype accepted.

**Token must reach all three request paths** (verified against the source, not assumed):
- `api.ts` `getJson`/`postJson` ([frontend/src/data/api.ts:34-57](../../sqladmin/frontend/src/data/api.ts#L34)) — add `Authorization: Bearer <token>` to the `fetch` headers.
- The row-CRUD `AjaxStore` ([frontend/src/data/stores.ts:19-32](../../sqladmin/frontend/src/data/stores.ts#L19)) — the library's `AjaxProxy` already accepts a `headers?: Record<string,string>` option ([AjaxProxy.ts:21](../../../typescript-ui/src/typescript/lib/data/proxy/AjaxProxy.ts#L21), applied to `fetch` at [AjaxProxy.ts:130](../../../typescript-ui/src/typescript/lib/data/proxy/AjaxProxy.ts#L130)); pass `headers: { Authorization: \`Bearer ${token}\` }` in the proxy options. **No library change needed.**
- The streaming **export download** ([frontend/src/data/api.ts:119-124](../../sqladmin/frontend/src/data/api.ts#L119) → navigated via `anchor.href` at [SqlAdminController.ts:546](../../sqladmin/frontend/src/SqlAdminController.ts#L546)) is a **browser navigation, not a `fetch`** — you cannot set an `Authorization` header on it. The token must ride as a **query parameter** (`&token=<token>`) instead, and the FastAPI check must accept the token from **either** the `Authorization` header **or** a `token` query param. This is the one asymmetry the header-only approach misses; call it out or the export silently 401s.

### Readiness gate: window stays hidden until `/health` returns 200

uvicorn cold-starts in ~0.5–1s (import + `lifespan` `open_pools()` opening the asyncpg pool, [connections.py:55-60](../../sqladmin/backend/app/connections.py#L55)). If the UI fires its first navigator `/api/.../databases` GET before then, the user sees a flash of failed calls. Add a **`GET /health`** endpoint (absent today — confirmed: no `health` route in [main.py](../../sqladmin/backend/app/main.py)) that returns `{"status":"ok"}` **without** acquiring a pool, so it answers as soon as the socket is up.

**The gate lives in Rust `setup()`, and the window is created hidden.** Set `"visible": false` on the window in `tauri.conf.json`; in `setup()`, after spawning the sidecar, poll `http://127.0.0.1:<port>/health` (bounded, e.g. up to ~10s with a short interval) and only then `window.show()`. This yields no failed-call flash and needs no frontend loading state — the app's own JS never runs against a not-yet-ready backend. `/health` is **exempt** from the token check so the poll is a plain GET. (Alternative: show immediately and retry from the frontend bootstrap; rejected because it requires a loading UI and lets early calls fail visibly.)

### Explicit sidecar kill on window-close, not only on app-exit

The prototype kills the `CommandChild` on `RunEvent::ExitRequested`/`Exit`. That is correct but exit-only; an orphaned uvicorn holding the Postgres pool is the classic sidecar bug, so harden it by **also** handling the window's `WindowEvent::CloseRequested` and killing there. Keep the `CommandChild` in the same managed `Mutex` state the prototype introduced; both handlers lock it and call `child.kill()` (idempotent — a second kill on an already-dead child is a no-op). This guarantees the child dies on the close path even if the app is not otherwise torn down (e.g. a lingering tray/background mode later).

### `DATABASE_URL` from a local config file, connections UI as a follow-up

A shipped desktop app can't rely on `DATABASE_URL` in the launching process env — there is no launching shell. The backend already namespaces every route `/api/{connection_id}/...` and resolves DSNs through [`connection_dsns()`](../../sqladmin/backend/app/connections.py#L22), which today seeds a single `"default"` from `DATABASE_URL`. The seam for *multiple* named connections exists; the UI for it does not.

**Decision for this plan: a local config file now, settings UI as a noted follow-up.** Rust reads a JSON config from Tauri's app-config dir (`$APPCONFIG/sqladmin/connections.json`, resolved via `app.path().app_config_dir()`), extracts the DSN, and injects it as `DATABASE_URL` into the sidecar env at spawn — so `connections.py` is **unchanged**. If the file is missing, `setup()` surfaces a clear dialog ("no database configured; edit `connections.json`") rather than letting the sidecar die on `RuntimeError("DATABASE_URL is not set")` ([connections.py:37](../../sqladmin/backend/app/connections.py#L37)). A full in-app connections manager that writes multiple DSNs and drives the `connection_id` namespacing is deferred (see `## Non-Goals`).

---

## Public API

New backend surfaces (sqladmin, not the library):

```python
# backend/sidecar.py — the frozen entrypoint next to app/main.py
def main() -> None:
    # argparse: --port (int, required); host pinned to 127.0.0.1.
    # imports `app` from app.main and calls:
    #   uvicorn.run(app, host="127.0.0.1", port=args.port)
    ...
```

```python
# backend/app/main.py — new health route (token-exempt)
@app.get("/health")
async def health() -> dict: ...   # {"status": "ok"}; no pool acquire
```

```python
# backend/app/main.py — token gate (middleware form)
# Reads expected token from os.environ["SQLADMIN_TOKEN"].
# Accepts the token from the Authorization: Bearer header OR a `token` query param.
# Exempts /health. Returns 401 JSONResponse on missing/mismatched token.
async def _require_token(request: Request, call_next): ...
app.add_middleware(BaseHTTPMiddleware, dispatch=_require_token)
```

New frontend surface (sqladmin):

```ts
// frontend/src/data/api.ts — replaces the prototype's plain API_BASE constant.
// Reads the Rust-injected global; both undefined in a browser tab.
const cfg = (window as any).__SQLADMIN__ as { base: string; token: string } | undefined;
export const API_BASE  = cfg?.base  ?? "";
export const API_TOKEN = cfg?.token ?? "";
// getJson/postJson add `Authorization: Bearer ${API_TOKEN}` when API_TOKEN is set.
// tableExportUrl appends `&token=${API_TOKEN}` when set.
```

---

## Ordered Implementation Steps

All paths are in the **sqladmin** repo unless stated. Assumes the prototype's shell, `externalBin` wiring, `API_BASE` shim, and `CommandChild` lifecycle already exist.

1. **Add the freeze entrypoint** `backend/sidecar.py` — a ~10-line `argparse` `--port` CLI that imports `app` from `app.main` and calls `uvicorn.run(app, host="127.0.0.1", port=args.port)`. Verify it runs unfrozen: `python -m backend.sidecar --port 8756` (with `DATABASE_URL`, `SQLADMIN_TOKEN` set) serves the app.

2. **Add `/health`** to `backend/app/main.py` — a token-exempt route returning `{"status":"ok"}` with no pool acquire. Place it before the CRUD routes.

3. **Add the token gate** to `backend/app/main.py` — a `BaseHTTPMiddleware` (or `Depends`) that reads `os.environ["SQLADMIN_TOKEN"]`, exempts `/health`, extracts the token from the `Authorization` header or `token` query param, and returns a 401 `{"detail": "unauthorized"}` on mismatch. Register it alongside the existing `CORSMiddleware` ([main.py:70-75](../../sqladmin/backend/app/main.py#L70)).
   - Checkpoint: `curl 127.0.0.1:<port>/api/default/databases` → 401; with `-H "Authorization: Bearer <token>"` → 200; `/health` → 200 without a token.

4. **Write the PyInstaller build.** A `backend/build-sidecar.sh` (or a documented one-liner) running:
   `pyinstaller --onefile --name sqladmin-backend-<target-triple> --collect-all uvicorn --collect-all asyncpg --hidden-import uvloop --hidden-import httptools --hidden-import websockets --hidden-import wsproto backend/sidecar.py`
   Emit into `frontend/src-tauri/binaries/`. Verify the frozen binary starts and serves `/health`.

5. **Wire the freeze into `beforeBuildCommand`** in `frontend/src-tauri/tauri.conf.json` — the command runs the PyInstaller build then `npm run build`. Confirm `externalBin` still resolves the target-triple-named binary (unchanged from prototype).

6. **Rust: generate port + token, source the DSN, inject all three.** In `src-tauri/src/main.rs` `setup()`:
   - Bind `TcpListener::bind("127.0.0.1:0")`, read the port, drop the listener.
   - Generate a 32-byte random token (`rand`/`uuid`).
   - Read `$APPCONFIG/sqladmin/connections.json` (via `app.path().app_config_dir()`); extract the DSN; on missing file show an error dialog and bail.
   - Spawn the sidecar with `.env("DATABASE_URL", dsn)`, `.env("SQLADMIN_TOKEN", token)`, and `--port <port>` arg. Stash the `CommandChild` in managed state (as prototype).

7. **Rust: inject the webview global.** Add a Tauri **initialization script** setting `window.__SQLADMIN__ = { base: "http://127.0.0.1:<port>", token: "<token>" }`. Set the main window `"visible": false` in `tauri.conf.json`.

8. **Rust: readiness gate.** In `setup()`, after spawning, poll `http://127.0.0.1:<port>/health` until 200 (bounded ~10s), then `window.show()`.

9. **Rust: kill on close.** Add a `WindowEvent::CloseRequested` handler that locks the managed `CommandChild` and `child.kill()`s, in addition to the prototype's `RunEvent::Exit` handler.

10. **Frontend: read the injected config + attach the token.** In `frontend/src/data/api.ts`, replace the prototype's `API_BASE` constant with the `window.__SQLADMIN__` read (`API_BASE` + `API_TOKEN`); add `Authorization: Bearer ${API_TOKEN}` to `getJson`/`postJson` when `API_TOKEN` is set; append `&token=${API_TOKEN}` in `tableExportUrl` when set.

11. **Frontend: token on the store path.** In `frontend/src/data/stores.ts`, pass `headers: { Authorization: \`Bearer ${API_TOKEN}\` }` to the `AjaxStore` proxy options (import `API_TOKEN` from `api.ts`). Guard on non-empty so browser-tab mode sends no header.
    - Checkpoint: `grep -rn "fetch(" frontend/src` and confirm every API request path carries the token in Tauri mode; the export is the only query-param carrier.

12. **Build + smoke test.** `cd frontend && cargo tauri build` (or `dev` with a frozen sidecar); confirm the window shows only after `/health`, the navigator loads (token accepted), a query runs, an export downloads, and a foreign `curl` without the token 401s.

---

## Files to Create / Modify / Delete

All in the **sqladmin** repo.

| Action | File |
|---|---|
| Create | `backend/sidecar.py` (frozen `--port` entrypoint calling `uvicorn.run(app, ...)`) |
| Create | `backend/build-sidecar.sh` (PyInstaller one-file invocation) |
| Modify | `backend/app/main.py` (add `/health`; add token middleware) |
| Modify | `frontend/src-tauri/tauri.conf.json` (`beforeBuildCommand` runs the freeze; window `visible: false`) |
| Modify | `frontend/src-tauri/src/main.rs` (port+token gen, DSN from config file, env injection, init script, readiness poll, close-kill) |
| Modify | `frontend/src-tauri/Cargo.toml` (add `rand` if not already present; `reqwest`/`ureq` for the health poll if no HTTP client) |
| Modify | `frontend/src/data/api.ts` (read `__SQLADMIN__`; attach bearer token; token query param on export) |
| Modify | `frontend/src/data/stores.ts` (pass `Authorization` header to the `AjaxStore` proxy) |
| Delete | the prototype's dev-env launcher script under `frontend/src-tauri/binaries/` (superseded by the frozen binary) |

No `@jimka/typescript-ui` files change — the `AjaxProxy.headers` option already exists.

---

## Expected Behaviour

Most of this is a native-window + native-process + freeze integration the offline test harness cannot exercise; those are manual-verify. The backend token logic is unit-testable.

**Unit-testable (backend, `httpx`/`pytest` per [pyproject.toml:17-23](../../sqladmin/backend/pyproject.toml#L17)):**
- `GET /health` returns 200 `{"status":"ok"}` **without** a token and **without** a live pool.
- Any `/api/...` request with **no** token → 401.
- `/api/...` with a **wrong** token (header or query) → 401.
- `/api/...` with the **correct** token in the `Authorization` header → passes to the route.
- `/api/{c}/{db}/{s}/{t}/export?token=<correct>` (query-param path) → passes; wrong query token → 401.

**Manual-verify (integration):**
- The frozen sidecar starts standalone and serves `/health` (proves the uvicorn/asyncpg hidden-import shake-out is complete — no `ModuleNotFoundError`).
- The Tauri window appears **only after** `/health` answers — no flash of failed navigator calls.
- With the injected token, the navigator loads, a `POST /api/default/query` runs, and a CSV export downloads (query-param token accepted).
- A foreign process — `curl http://127.0.0.1:<port>/api/default/query -d '{"sql":"select 1"}'` **without** the token — gets 401, demonstrating the arbitrary-SQL gap is closed.
- Closing the window leaves **no** orphaned `sqladmin-backend`/uvicorn process (`ps aux | grep sqladmin-backend`).
- **Browser-tab regression:** `npm run dev` at `localhost:5173` still works — `__SQLADMIN__` is undefined there, so `API_BASE`/`API_TOKEN` are `""`, no `Authorization` header is sent, and the Vite proxy path is unchanged. Existing `api.test.ts` URL assertions still hold.

---

## Verification

- **Backend tests:** `cd backend && poetry run pytest` — the token-gate and `/health` cases above.
- **Frontend typecheck + tests:** `cd frontend && npm run typecheck && npm test` — `api.test.ts` confirms browser-mode URLs/headers unchanged (empty token → no header).
- **Freeze smoke:** run `frontend/src-tauri/binaries/sqladmin-backend-<triple> --port 8756` with env set; `curl :8756/health` → 200. Confirms the `--collect-all`/`--hidden-import` set is complete.
- **Token-gate curl matrix** (step 3 checkpoint): 401 without token, 200 with header token, 200 for `/health`, 200 for export with `?token=`.
- **Native smoke** (`cargo tauri build` then run the bundle): hidden-until-ready window, navigator loads, query runs, export downloads, foreign curl 401s, no orphan on close.
- **Bundle contains the binary:** inspect the built `.msi`/`.dmg`/`.AppImage` payload for `sqladmin-backend-<triple>`.

---

## Packaging / Signing (notes)

Notes-level — not a full plan; the bundle mechanics are Tauri defaults.

- **Targets** are Tauri's per-OS bundlers: Windows `.msi`/`.exe` (NSIS), macOS `.dmg`/`.app`, Linux `.AppImage`/`.deb`. Select via `tauri.conf.json` `bundle.targets` (or `--bundles`).
- **The frozen Python binary ships inside the bundle** as an `externalBin` sidecar — Tauri copies it next to the app binary and resolves it at runtime; no separate install step.
- **Code-signing / notarization:** macOS needs a Developer-ID signature **and** Apple notarization or Gatekeeper blocks the app; the embedded frozen binary is covered by the app-bundle signature. Windows SmartScreen wants an Authenticode-signed installer. Linux `.AppImage`/`.deb` are conventionally unsigned. All of this is configured in Tauri's `bundle` block / CI signing env; treat as a release-engineering task, not code.
- **No cross-compile** (freeze decision above) means the bundle matrix is per-OS CI runners — each runner freezes its own sidecar then runs `tauri build`.

---

## Potential Challenges

- **uvicorn/asyncpg hidden-import misses** → frozen binary dies with `ModuleNotFoundError` at first request. Mitigation: the `--collect-all uvicorn --collect-all asyncpg` + explicit uvloop/httptools/websockets/wsproto hidden-imports set; verify the freeze serves `/health` before wiring it into Tauri.
- **Export download can't carry a header** → a header-only token breaks the CSV/JSON export. Mitigation: token as a `token` query param on the export URL, and the FastAPI check accepts header **or** query param.
- **`AjaxStore` token** — the row-CRUD path is the library's proxy, not `api.ts`'s `fetch`. Mitigation: the existing `AjaxProxy.headers` option ([AjaxProxy.ts:21](../../../typescript-ui/src/typescript/lib/data/proxy/AjaxProxy.ts#L21)) carries the bearer header; no library change.
- **Port TOCTOU** — the free port found by binding `:0` and dropping could be taken before the sidecar re-binds. Mitigation: spawn the sidecar immediately after picking the port; on bind failure the readiness poll times out and the app surfaces an error (rare, retriable).
- **Init-script timing** — if the global isn't set before app JS reads it, `API_BASE` is empty and calls hit `tauri://`. Mitigation: use Tauri's **initialization script** (guaranteed to run before page scripts), not a post-load `eval`.
- **Missing `connections.json`** → sidecar dies on `RuntimeError("DATABASE_URL is not set")`. Mitigation: Rust checks the config file and shows a dialog before spawning.
- **Per-platform freeze drift** — a hidden-import that surfaces only on one OS. Mitigation: run the freeze smoke test on each target OS in CI, not just the dev host.

---

## Critical Files

Read before implementing:

- [tauri-desktop-prototype.md](./tauri-desktop-prototype.md) — the base this builds on; reuse its shell, `externalBin`, `API_BASE` shim, and `CommandChild` lifecycle rather than restating.
- [backend/app/main.py](../../sqladmin/backend/app/main.py) — where `/health` and the token middleware attach (next to `CORSMiddleware`, [line 70](../../sqladmin/backend/app/main.py#L70)); the arbitrary-SQL route the token protects ([line 440](../../sqladmin/backend/app/main.py#L440)).
- [backend/app/connections.py](../../sqladmin/backend/app/connections.py) — `DATABASE_URL` → DSN the config file must supply ([line 34](../../sqladmin/backend/app/connections.py#L34)); the `connection_id` namespacing the future settings UI extends.
- [backend/pyproject.toml](../../sqladmin/backend/pyproject.toml) — the three deps the freeze must bundle; the pytest config for the token tests.
- [frontend/src/data/api.ts](../../sqladmin/frontend/src/data/api.ts) — `getJson`/`postJson` header injection ([lines 34-57](../../sqladmin/frontend/src/data/api.ts#L34)) and `tableExportUrl` query-param token ([lines 119-124](../../sqladmin/frontend/src/data/api.ts#L119)).
- [frontend/src/data/stores.ts](../../sqladmin/frontend/src/data/stores.ts) — the `AjaxStore` proxy that needs the `headers` option.
- [typescript-ui `AjaxProxy.ts`](../src/typescript/lib/data/proxy/AjaxProxy.ts) — confirm the `headers` option ([line 21](../src/typescript/lib/data/proxy/AjaxProxy.ts#L21)) so no library change is planned.

---

## Non-Goals

Intentionally out of scope; each has a home.

- **No-socket-at-all end state** — eliminating the loopback HTTP surface entirely by moving SQL access into the Rust core (Tauri commands / a Rust Postgres client), so there is no port for any local process to reach and the token becomes unnecessary. That is the endgame of `tauri-desktop-hardened-rust.md`; this plan deliberately keeps the Python sidecar and defends the socket with a token instead.
- **In-app connections manager** — a settings UI that writes multiple named DSNs and drives the `/api/{connection_id}` namespacing. This plan ships a single-DSN local config file; the UI is a follow-up.
- **Auto-update** — Tauri's updater and update-signing keys. Out of scope for hardening; a release-engineering task.
- **Secret-at-rest for the DSN** — `connections.json` stores the DSN in plaintext in the app-config dir. OS-keychain storage is a follow-up, not this plan.
- **RSS re-measurement** — the prototype already produced the headline number; the freeze changes disk size, not the interpreter RSS, so no re-measure is planned here.
