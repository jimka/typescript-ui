# Tauri Desktop Prototype — Implementation Plan

## Overview

Wrap the existing sqladmin app in a Tauri native desktop window to obtain a **real RSS number** to compare against an Electron/Slack baseline, with the least possible work. This is an explicit **throwaway proof-of-concept**: the goal is a measurement, not a shippable product.

The change spans two sibling repos. The plan file lives in `typescript-ui` (whose conventions govern how this document is written), but **every source change lands in the sqladmin repo** at `/home/jika/typescript/sqladmin`. Nothing in the `@jimka/typescript-ui` library is modified — the leanness of that library (real DOM, one runtime dependency, no framework runtime; see [frontend/package.json](../../sqladmin/frontend/package.json)) is the entire reason a native-webview shell is worth measuring: the demo app's memory should land far below a bundled-Chromium Electron app.

Three pieces are added/touched in sqladmin:
1. A Tauri shell under `frontend/src-tauri/` (Rust core + `tauri.conf.json`) that renders the Vite app in the **OS-native webview** (WebView2 / WKWebView / WebKitGTK), *not* bundled Chromium.
2. The existing Python FastAPI backend, run as a **Tauri sidecar** — spawned from Rust `setup()` with `DATABASE_URL` and a fixed loopback port, killed on app exit.
3. A **frontend API base-URL shim** so the relative `/api/...` calls resolve to the sidecar under the `tauri://` origin (where the Vite dev proxy at [frontend/vite.config.ts:23](../../sqladmin/frontend/vite.config.ts#L23) does not exist).

This is the **shared foundation** for two follow-up plans — `tauri-desktop-hardened-python.md` and `tauri-desktop-hardened-rust.md` — which close the security and packaging gaps this prototype knowingly leaves open (see `## Non-Goals`).

---

## Architecture Decisions

### Tauri, native webview, not Electron

Tauri 2.x embeds the OS-native webview rather than shipping a Chromium runtime, which is precisely what makes the RSS comparison meaningful. The shell is a thin Rust binary; the UI is the unmodified Vite SPA. We wire it through `tauri.conf.json`'s build hooks so Tauri drives Vite for us:

- `build.beforeDevCommand` = `npm run dev`, `build.devUrl` = `http://localhost:5173` (the dev-server URL from [frontend/vite.config.ts:21](../../sqladmin/frontend/vite.config.ts#L21)).
- `build.beforeBuildCommand` = `npm run build`, `build.frontendDist` = `../dist` (the Vite output consumed for a bundled build; the frontend `build` script is `tsc --noEmit && vite build` per [frontend/package.json:8](../../sqladmin/frontend/package.json#L8)).

Placing `src-tauri/` inside `frontend/` keeps `beforeDevCommand`/`frontendDist` as trivial relative paths and keeps the shell colocated with the app it wraps.

### Backend as a sidecar, frozen the simplest way that works

The backend is a FastAPI app started today with `uvicorn app.main:app --port 8000` (see [backend/README.md](../../sqladmin/backend/README.md) and [backend/Dockerfile](../../sqladmin/backend/Dockerfile)). There is **no bundled database** — it connects to an external Postgres via `DATABASE_URL` ([backend/app/connections.py:34](../../sqladmin/backend/app/connections.py#L34)). We declare it as a Tauri external binary (`bundle.externalBin`) and spawn it from Rust `setup()`.

For a throwaway, the "freeze" is deliberately the cheapest thing that produces a runnable external binary. Two options, in increasing effort:

- **Dev-mode sidecar (fastest):** a tiny wrapper shell script / launcher that runs the existing `poetry`/`.venv` interpreter against `app.main:app`. Zero packaging work; the tradeoff is it is not self-contained (depends on the machine's Python env). Fine for a local RSS reading.
- **PyInstaller one-file (slightly more):** `pyinstaller --onefile` over a 3-line entry that calls `uvicorn.run("app.main:app", ...)`. Self-contained single binary, at the cost of a hidden-import shake-out for asyncpg/uvicorn. Note that PyInstaller's own bootstrap unpacks to a temp dir and inflates RSS — so **read the RSS of the child `python`/uvicorn process, not the PyInstaller launcher stub**, or the measurement is polluted.

Pick the dev-mode sidecar first; escalate to PyInstaller only if the un-frozen path is inconvenient. **The robust freeze is explicitly the hardened-python plan's job** — here we accept whichever gets a window on screen fastest. Either way the binary is named with the platform target triple (e.g. `sqladmin-backend-x86_64-unknown-linux-gnu`) so Tauri's `externalBin` resolver finds it.

### Sidecar lifecycle: spawn in `setup()`, kill on exit

Rust `setup()` spawns the sidecar via the shell plugin (`tauri-plugin-shell`, `app.shell().sidecar("sqladmin-backend")`), injecting env with `.env(...)`:

- `DATABASE_URL` — passed through from the launching environment (the prototype reads it from the Rust process env; the DSN-settings UI is a hardened-plan concern).
- the fixed loopback port and host so uvicorn binds `127.0.0.1:<PORT>`.

Keep the returned `CommandChild` handle in Tauri managed state and **kill it on app teardown** — handle `RunEvent::ExitRequested` / `RunEvent::Exit` in `run(...)` and call `child.kill()`. Sidecars are not guaranteed to die with the parent, so a leaked uvicorn holding the Postgres pool is the failure to prevent.

### Fixed loopback port for the prototype

The backend binds a **fixed** `127.0.0.1:<PORT>` (e.g. `127.0.0.1:8756`) rather than the current `:8000` default, so the frontend shim can hardcode the same number. A fixed port is a known prototype smell — two app instances would collide, and any local process can guess it — but it removes the port-handshake plumbing. **The random-port + bearer-token handshake is the hardened-python plan's job.**

### Frontend base-URL shim — one shared constant, all call sites

Relative `/api/...` works in a browser tab because the Vite dev proxy forwards `/api` → `http://localhost:8000` ([frontend/vite.config.ts:23-25](../../sqladmin/frontend/vite.config.ts#L23)). Inside Tauri the page is served from the `tauri://` origin with no proxy, so relative `/api` resolves against `tauri://` and 404s. Introduce a single base-URL helper and prefix every `/api` construction with it:

```ts
// "" in a browser tab (relative → Vite proxy); the sidecar origin under Tauri.
const API_BASE = "__TAURI_INTERNALS__" in window ? "http://127.0.0.1:8756" : "";
```

The API path literals are spread across three files, so the constant must be shared by all of them, not local to `api.ts`:

- [frontend/src/data/api.ts](../../sqladmin/frontend/src/data/api.ts) — 8 relative `/api/...` fetches (`getJson`/`postJson` at lines 34-57; endpoints at 61-155, including the arbitrary-SQL `POST /api/{connectionId}/query` at [line 105](../../sqladmin/frontend/src/data/api.ts#L105)) plus the `tableExportUrl` builder ([lines 119-124](../../sqladmin/frontend/src/data/api.ts#L119)).
- [frontend/src/data/stores.ts:22](../../sqladmin/frontend/src/data/stores.ts#L22) — the `AjaxStore` rows-CRUD URL.
- [frontend/src/SqlAdminController.ts:546](../../sqladmin/frontend/src/SqlAdminController.ts#L546) — consumes `tableExportUrl` and navigates an `<a>` element to it for the streaming download; since `tableExportUrl` gets the prefix, this site is covered transitively.

Because `tableExportUrl` already centralises the export URL and `api.ts`/`stores.ts` are the only other constructors, exporting `API_BASE` (or an `apiBase()` function) from one module and importing it into `stores.ts` is the whole surface. Detection via `"__TAURI_INTERNALS__" in window` needs no new dependency; `@tauri-apps/api`'s `isTauri()` is the tidier equivalent if a dep is acceptable.

### CORS: middleware exists, allowlist must gain the Tauri origin

The backend already mounts `CORSMiddleware` ([backend/app/main.py:70-75](../../sqladmin/backend/app/main.py#L70)), but its `allow_origins` is dev-only — `http://localhost:5173` and `http://localhost:8015` ([line 50](../../sqladmin/backend/app/main.py#L50)). A fetch from the Tauri webview carries an `Origin` of `tauri://localhost` (Linux/macOS) or `http://tauri.localhost` (Windows), which is **not** in that list, so the preflight/response would be rejected. The prototype must add the Tauri webview origin(s) to `_DEV_ORIGINS` (or set `allow_origins=["*"]` for the throwaway). This is a one-line honest correction to "rely on the already-configured CORS" — the middleware is there, the allowlist is not yet.

### Security posture: loopback bind is the ONLY protection — and it is weak

The sidecar binds `127.0.0.1` and **never** `0.0.0.0`. Be explicit about what this does and does not buy:

- It stops **off-machine** access.
- It does **not** stop **other local processes / other local users** on the same host from calling the port. CORS is a *browser* control enforced by the webview; it places **no** restriction on a native client hitting `127.0.0.1:8756` directly with `curl`.
- The arbitrary-SQL endpoint `POST /api/{connectionId}/query` ([backend/app/main.py:440](../../sqladmin/backend/app/main.py#L440), reached from [frontend/src/data/api.ts:105](../../sqladmin/frontend/src/data/api.ts#L105)) therefore means **any local process can run arbitrary SQL against the connected Postgres** for as long as the app is running. This is a **KNOWN, ACCEPTED gap** for a throwaway measurement prototype.
- **Forward reference:** the `tauri-desktop-hardened-python.md` plan closes this with a **random port + a per-launch bearer token** that the Rust shell generates, passes to the sidecar's env, and injects into the webview so only the app's own frontend can call the API.

### WSL2 caveat is a hard prerequisite

The user runs on WSL2. A Tauri **native window** needs a display server: **WSLg** (Windows 11, or a recent Windows 10) or a manually-run X server. Without one, `cargo tauri dev` builds but no window appears (or it fails to connect to a display). Verify `echo $DISPLAY` is non-empty and a trivial GUI (`xeyes`/`glxinfo`) renders before blaming Tauri. Fallback if WSLg is unavailable: run an X server on the Windows host (VcXsrv/X410) and export `DISPLAY`, **or** run the whole prototype on a native Linux/Windows/macOS host — the RSS number is host-dependent anyway, so measuring on the target OS you care about is preferable.

---

## Prerequisites

- **Rust toolchain** via `rustup` (stable), plus `cargo`.
- **Tauri CLI** — `cargo install tauri-cli` (or `npm i -D @tauri-apps/cli`); drives `cargo tauri dev`/`build`.
- **Linux system webview libraries** — `webkit2gtk` (4.1) and GTK dev packages (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, plus `libsoup`/`librsvg` as pulled by Tauri's Linux prerequisites).
- **A working display** on WSL2 (WSLg or X server) — see the WSL2 decision above.
- **An external Postgres** reachable via `DATABASE_URL` (unchanged from today; `docker compose up -d db` per [backend/README.md](../../sqladmin/backend/README.md)).
- **PyInstaller** (only if choosing the frozen-binary sidecar option).

---

## Ordered Implementation Steps

All paths below are in the **sqladmin** repo unless stated otherwise.

1. **Install prerequisites** (Rust, Tauri CLI, webkit2gtk/GTK dev libs) and confirm a GUI renders under WSLg/X (`echo $DISPLAY`; a trivial X client shows a window).

2. **Scaffold the Tauri shell** at `frontend/src-tauri/` — `Cargo.toml`, `src/main.rs`, `tauri.conf.json`, `build.rs`, `icons/`. Easiest via `cargo tauri init` run inside `frontend/`, then trim generated boilerplate.

3. **Wire `tauri.conf.json` build hooks:** `beforeDevCommand: "npm run dev"`, `devUrl: "http://localhost:5173"`, `beforeBuildCommand: "npm run build"`, `frontendDist: "../dist"`. Set a window title and a sane default size.

4. **Produce the backend sidecar binary.** Start with the dev-mode launcher (wrap the existing `.venv`/poetry uvicorn invocation). Place/emit it under `frontend/src-tauri/binaries/` named `sqladmin-backend-<target-triple>` (e.g. `sqladmin-backend-x86_64-unknown-linux-gnu`). Declare it in `tauri.conf.json` `bundle.externalBin: ["binaries/sqladmin-backend"]`.

5. **Spawn + supervise the sidecar in Rust `setup()`:** add `tauri-plugin-shell`; in `setup()` call `app.shell().sidecar("sqladmin-backend")`, `.env("DATABASE_URL", ...)`, `.env("PORT"/host+port args, "8756")` so uvicorn binds `127.0.0.1:8756`; spawn and stash the `CommandChild` in managed state. In `run(...)`, on `RunEvent::ExitRequested`/`Exit`, `child.kill()`.

6. **Add the frontend base-URL shim.** Define `API_BASE` once (`"__TAURI_INTERNALS__" in window ? "http://127.0.0.1:8756" : ""`), export it, and prefix every `/api` construction:
   - `frontend/src/data/api.ts` — all 8 endpoint literals plus the `tableExportUrl` return.
   - `frontend/src/data/stores.ts` — the `AjaxStore` `url`.
   - (`SqlAdminController.ts:546` is covered transitively via `tableExportUrl`.)
   - Checkpoint: `grep -rn '"/api/\|`/api/\|'"'"'/api/' frontend/src --include=*.ts | grep -v '.test.ts'` — every remaining match must be a template that starts with `${API_BASE}/api/...`.

7. **Extend backend CORS** in `backend/app/main.py` — add the Tauri webview origin(s) (`tauri://localhost`, `http://tauri.localhost`) to `_DEV_ORIGINS`, or set `allow_origins=["*"]` for the throwaway.

8. **Run and measure.** `cd frontend && cargo tauri dev`. Confirm a native window shows the sqladmin UI, the navigator lists databases (proving the sidecar + shim + CORS chain works), and a query runs. Then read RSS (below).

---

## Files to Create / Modify / Delete

All in the **sqladmin** repo.

| Action | File |
|---|---|
| Create | `frontend/src-tauri/Cargo.toml` |
| Create | `frontend/src-tauri/tauri.conf.json` |
| Create | `frontend/src-tauri/build.rs` |
| Create | `frontend/src-tauri/src/main.rs` (setup spawns sidecar, exit kills it) |
| Create | `frontend/src-tauri/binaries/sqladmin-backend-<target-triple>` (dev launcher or PyInstaller output) |
| Create | `frontend/src-tauri/icons/` (Tauri-required app icons) |
| Modify | `frontend/src/data/api.ts` (prefix `/api` literals + `tableExportUrl` with `API_BASE`) |
| Modify | `frontend/src/data/stores.ts` (prefix `AjaxStore` url with `API_BASE`) |
| Modify | `backend/app/main.py` (add Tauri origin to CORS allowlist) |

No `@jimka/typescript-ui` files change.

---

## Expected Behaviour

Manual-verify only — this is a native-window + native-process integration; the offline test harness cannot exercise a webview, a spawned sidecar, or an OS RSS reading.

- `cargo tauri dev` opens **one native OS window** (WebView2/WKWebView/WebKitGTK, not Chromium) titled for sqladmin, showing the sqladmin shell.
- The window's frontend reaches the sidecar: the navigator populates databases/schemas/objects (each an `/api` GET), a table opens and lists rows (the `AjaxStore` path), and the query panel runs `POST /api/default/query` returning a result set.
- In a **browser tab** (`npm run dev`, open `localhost:5173`), the identical build still works via the Vite proxy — `API_BASE` is `""` there, so relative `/api` is unchanged. This proves the shim is origin-conditional, not a regression.
- Closing the window terminates the sidecar: no orphaned `uvicorn`/`python` process, no lingering Postgres pool connection.
- Existing frontend unit tests still pass — the `/api/...` assertions in `frontend/src/data/api.test.ts` expect the browser-mode (empty-base) URLs, which the `""` default preserves.

---

## Verification

- **Frontend typecheck + tests:** `cd frontend && npm run typecheck && npm test` — the `api.test.ts` URL assertions confirm browser-mode URLs are unchanged.
- **API-literal grep checkpoint** (step 6): no bare `/api/...` fetch/URL construction remains outside a `${API_BASE}` prefix.
- **Native window smoke test:** `cd frontend && cargo tauri dev` → window appears, navigator loads data, a query returns rows.
- **Sidecar teardown:** after closing the window, `ps aux | grep -E 'uvicorn|sqladmin-backend'` shows nothing.
- **RSS measurement — the point of the exercise.** Record all three on the same host, same DB, same opened table:
  - **Tauri app:** sum the RSS of the Tauri parent process **and** the WebView helper process(es) it spawns (`ps -o rss,comm` / `smem -k`), and separately note the **Python sidecar** RSS (measure the actual `python`/uvicorn process, not a PyInstaller stub). Report webview-side and backend-side separately so the hardened plans can attribute changes.
  - **Browser tab baseline:** the same app at `localhost:5173` — RSS of the browser tab's renderer process (Chrome DevTools task manager, or `ps` on the renderer PID).
  - **Electron/Slack baseline:** RSS of a running Slack (or a trivial Electron shell) for the headline comparison.
  - Report the delta plainly: expected outcome is the native-webview shell's webview-side RSS landing well below the Electron/Slack figure — the claim this prototype exists to test.

---

## Potential Challenges

- **No display under WSL2** → window never appears. Verify `$DISPLAY` and a trivial X client first; fall back to an X server on Windows or measure on a native host.
- **webkit2gtk version mismatch** (4.0 vs 4.1) is the classic Linux Tauri build failure. Install the version Tauri 2.x expects (`4.1`).
- **Sidecar not found / wrong name** — `externalBin` requires the exact `<name>-<target-triple>` suffix; a plain `sqladmin-backend` will not resolve.
- **Sidecar leaks on exit** — Tauri does not guarantee child death; the explicit `child.kill()` on the exit event is mandatory, not optional.
- **CORS still blocks** — if the navigator stays empty with an `Origin`-mismatch console error, the Tauri origin wasn't added to the allowlist (step 7).
- **PyInstaller RSS pollution** — the launcher stub's memory is not the backend's; measure the real interpreter process.
- **`DATABASE_URL` unset in the Rust process env** → the sidecar raises `RuntimeError("DATABASE_URL is not set")` at startup ([connections.py:37](../../sqladmin/backend/app/connections.py#L37)); export it before `cargo tauri dev`.

---

## Critical Files

Read before implementing:

- [frontend/src/data/api.ts](../../sqladmin/frontend/src/data/api.ts) — the fetch layer; all `/api` literals + `runQuery` (arbitrary SQL, line 105) + `tableExportUrl`.
- [frontend/src/data/stores.ts](../../sqladmin/frontend/src/data/stores.ts) — the second `/api` constructor (row CRUD `AjaxStore`).
- [frontend/vite.config.ts](../../sqladmin/frontend/vite.config.ts) — the `/api` dev proxy the shim replaces under Tauri, and the `keepNames` esbuild requirement (line 17) the Tauri build must preserve.
- [frontend/package.json](../../sqladmin/frontend/package.json) — the `dev`/`build` scripts Tauri's hooks invoke.
- [frontend/index.html](../../sqladmin/frontend/index.html) — the SPA entry Tauri loads.
- [backend/app/main.py](../../sqladmin/backend/app/main.py) — FastAPI `app`, CORS middleware/allowlist, the arbitrary-SQL route.
- [backend/app/connections.py](../../sqladmin/backend/app/connections.py) — `DATABASE_URL` requirement the sidecar env must satisfy.
- [backend/README.md](../../sqladmin/backend/README.md) / [backend/Dockerfile](../../sqladmin/backend/Dockerfile) — the exact uvicorn invocation the sidecar reproduces.

---

## Non-Goals

Intentionally omitted here; each is owned by a follow-up plan.

- **Token auth / port handshake** — random port + per-launch bearer token so only the app's frontend can call the sidecar, closing the local-process arbitrary-SQL gap. → `tauri-desktop-hardened-python.md`.
- **Robust Python freeze** — a reproducible, hidden-import-clean PyInstaller (or equivalent) build, not a dev-env launcher. → `tauri-desktop-hardened-python.md`.
- **DSN / connection-settings UI** — configuring `DATABASE_URL` from within the app instead of the process env. → `tauri-desktop-hardened-python.md`.
- **Rust-native alternative** — replacing/augmenting the Python sidecar with a Rust backend (or moving SQL access into the Rust core) to shrink the backend-side RSS further. → `tauri-desktop-hardened-rust.md`.
- **Packaging & signing** — installers, code-signing, auto-update, multi-platform bundle matrix. → the hardened plans.
- **Multi-instance / dynamic port** — surviving two concurrent app launches. → `tauri-desktop-hardened-python.md`.
