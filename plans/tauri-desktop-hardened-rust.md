---
depends-on: [tauri-desktop-hardened-python.md]
---

# Tauri Desktop — Hardened (Rust Core, No Socket) — Implementation Plan

## Overview

Replace the Python FastAPI backend **entirely** with a Rust data core living inside the Tauri process, and expose it to the webview through an **in-process custom URI-scheme handler** — so there is **no listening TCP socket anywhere**. This is the security end-state forwarded from both prior plans ([tauri-desktop-prototype.md](./tauri-desktop-prototype.md) `## Non-Goals`, [tauri-desktop-hardened-python.md](./tauri-desktop-hardened-python.md) `## Non-Goals`): the hardened-python plan defended a loopback socket with a per-launch bearer token; this plan deletes the socket, so the token is unnecessary and no local process (or local user) can reach the API at all.

This **supersedes the Python sidecar** from those plans: **no PyInstaller, no uvicorn, no bundled Python interpreter, no `externalBin`, no `SQLADMIN_TOKEN`, no random-port handshake, no `/health` readiness poll** (there is no cold-starting child process to wait on). What is **reused unchanged** from the earlier plans: the Tauri shell location `frontend/src-tauri/`, the native-webview decision, the `beforeDevCommand`/`beforeBuildCommand`/`frontendDist` build hooks against the Vite SPA, the `window.__SQLADMIN__` **init-script injection mechanism** ([hardened-python step 7](./tauri-desktop-hardened-python.md)) — kept but reduced to just `{ base }` with no token — and the `DATABASE_URL`-from-`connections.json` config sourcing ([hardened-python decision](./tauri-desktop-hardened-python.md)), now read by Rust to build its own pool rather than injected into a child's env.

The **delta over hardened-python** is exactly: *replace the sidecar transport + backend language.* The entire `backend/` Python tree ([backend/app/main.py](../../sqladmin/backend/app/main.py) and [backend/app/operations/](../../sqladmin/backend/app/operations/)) is ported operation-for-operation into Rust modules under `frontend/src-tauri/src/`. The frontend keeps calling `fetch('/api/...')` and the library's `AjaxProxy` keeps issuing real `fetch()` — both are intercepted by the custom scheme and served by Rust with the identical HTTP shape (method, path, query, JSON body, status codes, `{detail}` errors, streamed export). So `frontend/src/data/api.ts`, `frontend/src/data/stores.ts`, and the `@jimka/typescript-ui` library need **no transport rewrite** — only the `API_BASE` constant changes to point at the custom-scheme origin.

Two sibling repos: this plan file lives in **typescript-ui** (whose conventions govern the document); **every source change lands in sqladmin** at `/home/jika/typescript/sqladmin`, plus the deletion of the `backend/` Python tree. No `@jimka/typescript-ui` library file changes.

---

## Architecture Decisions

### Transport — custom URI-scheme handler, not raw `invoke()`, and no socket at all

**The design choice, stated explicitly.** The "no socket" model has two possible in-process transports, and there is a third socketed alternative worth weighing:

- **(A) `#[tauri::command]` + `invoke()` shim.** Each operation becomes a Rust command; the frontend calls `invoke("run_query", {...})`. **Rejected as the transport**, because the frontend does **not** issue its API calls from one place: the introspection path is `fetch()` in [api.ts](../../sqladmin/frontend/src/data/api.ts), but the **row-CRUD path runs inside the library's `AjaxProxy`, which calls `fetch()` itself** ([AjaxProxy.read/create/update/destroy](../src/typescript/lib/data/proxy/AjaxProxy.ts#L123)), and the **export is a browser navigation** on an `<a>` element ([SqlAdminController.exportTable](../../sqladmin/frontend/src/SqlAdminController.ts#L546)). Routing everything through `invoke()` therefore means either forking `@jimka/typescript-ui` to swap its `fetch` for `invoke` (a library rewrite this plan explicitly avoids) or monkey-patching `window.fetch`. It also discards HTTP status codes — `invoke` returns `Result<T, E>`, so the `{detail}`+status contract [api.ts:readDetail](../../sqladmin/frontend/src/data/api.ts#L19) and [AjaxError](../src/typescript/lib/data/proxy/AjaxError.ts) depend on would have to be re-encoded by hand.

- **(B) Custom URI-scheme protocol handler — RECOMMENDED.** Register an app-wide scheme (`sqladmin`) via Tauri's `register_asynchronous_uri_scheme_protocol("sqladmin", …)`. The webview's own `fetch("sqladmin://localhost/api/…")` (and the export anchor's navigation to the same origin) are routed **in-process** to the Rust handler — **no port, no socket, no network stack**. The handler receives a real `http::Request` (method, URI, headers, body) and returns a real `http::Response` (status + body), so the **entire HTTP shape the frontend and library already speak is preserved**: `fetch` still works, `AjaxProxy` still works unchanged, `{detail}`+status errors round-trip, and the export navigation streams an `attachment` response. The frontend delta collapses to the same `API_BASE` shim the prototype introduced, now pointing at the custom-scheme origin. This is **strictly more secure than hardened-python's token-on-loopback**: there is no socket to probe, no token to leak or mishandle, and the DNS-rebinding / foreign-local-process attack surface the token existed to close is simply absent.

- **(C) Unix domain socket / Windows named pipe (0600), serving the same HTTP shape.** A real HTTP server bound to a filesystem-namespace socket with owner-only permissions, replacing the loopback TCP socket. **Rejected**: it reintroduces a server, an addressing/handshake step, and a `fetch`-to-custom-transport problem (browsers can't `fetch()` a UDS), so it needs the same interception plumbing as (B) *plus* a socket to secure and clean up. (B) achieves the same "only this app can call it" property with **less** machinery and no filesystem artifact.

**Decision: (B), the custom URI-scheme handler.** The Rust operation functions it dispatches to are the same functions a pure-`invoke()` design would expose — the difference is only how the request reaches them. Under the hood this **is** IPC command dispatch; the custom scheme is the adapter that lets the unmodified `fetch`/`AjaxProxy`/anchor call sites drive it. All request-routing (the `main.py` route table) moves into a single Rust `dispatch(request) -> Response` in `src/api.rs`.

### Export download without HTTP — the same custom-scheme handler streams the attachment

The streaming full-table export ([export_rows.py](../../sqladmin/backend/app/operations/export_rows.py)) is a **browser navigation**, not a `fetch` — [SqlAdminController.exportTable](../../sqladmin/frontend/src/SqlAdminController.ts#L546) sets `anchor.href = tableExportUrl(...)` with a `download` attribute and clicks it. Under the custom scheme, `anchor.href = "sqladmin://localhost/api/…/export?format=csv"` is intercepted by the **same** handler, which returns a `Response` carrying `Content-Type: text/csv` and `Content-Disposition: attachment; filename="…"` — the webview honors the `download` attribute and saves the file, exactly as it did against the Python `StreamingResponse`. **No socket, no token query-param** (hardened-python needed `&token=` on the export precisely because a navigation can't set an `Authorization` header — that whole asymmetry disappears with no token). The one caveat is chunked *streaming*: Tauri's custom-protocol `Response` favors a complete body, so a multi-GB export would buffer. Mitigation and the save-file-command fallback are in `## Potential Challenges`.

### Rust DB layer — `tokio-postgres` + `deadpool-postgres`, not `sqlx`

**`tokio-postgres`, not `sqlx`.** sqlx's headline feature is the compile-time-checked `query!` macro, which requires the query text **and a reachable database schema at compile time**. This tool is **schema-agnostic and runs arbitrary user SQL** ([run_query.py](../../sqladmin/backend/app/operations/run_query.py)) against whatever database the user configures at runtime — there is no compile-time schema, so `query!` is unusable and sqlx would fall back to its untyped `query()` API anyway. `tokio-postgres` gives **direct access to each result column's runtime `Type` (OID)** via `Row::columns()` and per-index typed extraction, which is exactly what the dynamic-row-shape decoding (below) and the `pg_type_to_wire` port need; `Client::prepare` exposes `Statement::columns()` for the rows-vs-status classification `RunQueryCommand` performs. Pooling comes from **`deadpool-postgres`** (an async pool over `tokio-postgres`), the direct analogue of the asyncpg pool in [connections.py](../../sqladmin/backend/app/connections.py). The Tauri process already runs a Tokio runtime, so `tokio-postgres` shares it with no extra thread pool.

**Connection-pool registry keyed by `connectionId`, mirroring `connections.py`.** A `Pools(HashMap<String, deadpool_postgres::Pool>)` in Tauri managed state, seeded with a single `"default"` from the `connections.json` DSN — the same one-entry-now, multi-DB-seam-later shape as [`connection_dsns()`](../../sqladmin/backend/app/connections.py#L22). `get_pool(id)` returns the pool or a `NotFound` (mirroring [connections.py:83](../../sqladmin/backend/app/connections.py#L83)). Pools open at `setup()` and are dropped on exit — no lifespan/`open_pools`/`close_pools` dance, and no `child.kill()` (there is no child).

**json/jsonb.** asyncpg needed an explicit per-connection codec ([connections.py:_init_connection](../../sqladmin/backend/app/connections.py#L42)) to decode json/jsonb to Python objects. `tokio-postgres` with the **`with-serde_json-1`** feature decodes `json`/`jsonb` to `serde_json::Value` natively via `FromSql`, so the codec-registration step **disappears** — one fewer moving part.

### Dynamic-row-shape decoding — a runtime `Type` → wire-scalar mapper (the port of `wire.py`)

This is the crux of the rewrite and the port of [wire.py](../../sqladmin/backend/app/wire.py). Python's asyncpg hands back already-native values and `to_wire_value` maps them by the column's `WireType`. In Rust, `tokio-postgres` decodes a column **only when you name a target Rust type** at extraction, so the core is a function `value_to_wire(row: &Row, i: usize) -> serde_json::Value` that **matches on `row.columns()[i].type()`** and extracts the right Rust type, then serializes to the wire JSON scalar:

- `INT2/INT4/INT8/FLOAT4/FLOAT8` → number (`WireType.NUMBER`).
- `NUMERIC/MONEY` → **precision-preserving string** (`rust_decimal::Decimal` via the `with-rust_decimal` feature, then `.to_string()`) — matching `_NUMERIC_AS_STRING` ([wire.py:28](../../sqladmin/backend/app/wire.py#L28)).
- `BOOL` → boolean.
- `TIMESTAMP/TIMESTAMPTZ/DATE/TIME/TIMETZ` → ISO-8601 string (`chrono` types via `with-chrono-0.4`, `.to_rfc3339()`/`.to_string()`) — matching `_DATETIME_TYPES`.
- `TEXT/VARCHAR/BPCHAR/NAME/UUID/CITEXT` → string (`uuid::Uuid` → hyphenated string).
- `JSON/JSONB` → passthrough `serde_json::Value`.
- `BYTEA` → base64 string (`base64` crate).
- **array types** (`col.type().kind() == Kind::Array`) → JSON array, recursing element-by-element (the `_jsonable` port).
- unknown OID → fall back to `TEXT`/string (matching `pg_type_to_wire`'s final `return WireType.STRING`).

`pg_type_to_wire(data_type: &str)` is still ported **separately** for the introspection path (`ListColumnsQuery` records a `wire_type` per column from `information_schema` **type-name strings**, not OIDs) and for `RunQueryCommand`'s column descriptor (which maps `attr.type.name`). Keep both: a **name→WireType** map for introspection metadata, and an **OID→extraction** match for actual value decoding. The write-path inverse `from_wire_value` ([wire.py:159](../../sqladmin/backend/app/wire.py#L159)) is ported as `wire_to_sql(value, &ColumnMeta) -> Box<dyn ToSql>` so insert/update bind the native type (ISO string → `chrono`, numeric string → `Decimal`, base64 → `Vec<u8>`, uuid string → `Uuid`).

### Error taxonomy — a Rust `DomainError` enum mapped to `(status, {detail})`, unchanged frontend contract

Port [errors.py](../../sqladmin/backend/app/errors.py) to a `DomainError` enum whose variants carry the status the FastAPI exception handler assigned:

```rust
enum DomainError { Validation(String), NotFound(String), Conflict(String), BadRequest(String) }
```

with `status_code()` → `422 / 404 / 409 / 400` (matching `ValidationError`/`NotFound`/`ConflictError`/`DomainError.status_code`). Every operation returns `Result<T, DomainError>`. The **Postgres-error handler** ([main.py:_pg_error_handler](../../sqladmin/backend/app/main.py#L86)) ports to a `From<tokio_postgres::Error>`: inspect `err.as_db_error().map(DbError::code)` — a `SqlState` whose 2-char class `"23"` (integrity-constraint-violation) → **409**, else → **400**. `dispatch()` catches the `Err`, builds a `Response` with `error.status_code()` and body `{"detail": error.message()}` — **byte-identical** to [main.py:_domain_error_handler](../../sqladmin/backend/app/main.py#L78). So [api.ts:readDetail](../../sqladmin/frontend/src/data/api.ts#L19) and [AjaxError](../src/typescript/lib/data/proxy/AjaxError.ts) see the same `{detail}` + status they see today, and **no frontend error handling changes**.

### SQL compilation and identifier safety carry over verbatim

The sort/filter compiler ([sql/compiler.py](../../sqladmin/backend/app/sql/compiler.py)) is a pure function of `(descriptor, columns)` — port it directly: `quote_ident`, the `_COMPARATORS` map, `_escape_like`, `OrderCompiler`, and `FilterCompiler` producing `(where_clause, params)` with values bound as `$n` positional params and identifiers validated against the introspected column set. `common.py`'s `qualified()` (schema-qualified quoted name) and `single_pk()` (the "exactly one PK" gate raising `ValidationError`) port unchanged. **The arbitrary-SQL statement in `RunQueryCommand` stays deliberately un-parameterized and un-validated** — arbitrary SQL on the trusted default connection is the feature ([run_query.py docstring](../../sqladmin/backend/app/operations/run_query.py#L6)); `tokio-postgres`'s extended-query `prepare` rejects a `;`-separated multi-statement script the same way asyncpg does, so the single-statement rule still needs no explicit check.

### Config sourcing carries over from hardened-python; connections UI stays deferred

`DATABASE_URL` still comes from `$APPCONFIG/sqladmin/connections.json` read by Rust ([hardened-python decision](./tauri-desktop-hardened-python.md)) — but now Rust uses the DSN to build **its own** `deadpool` pool at `setup()`, instead of injecting it into a sidecar's env. Missing/unreadable file → a clear error dialog before the window shows (mirroring hardened-python), not a `RuntimeError`. The multi-DSN in-app connections manager remains deferred (`## Non-Goals`).

---

## Operation-by-operation port table

Each row is portable and check-off-able independently. **Rust module** paths are under `frontend/src-tauri/src/`. Every op is a function `fn(client: &Client, …args) -> Result<serde_json::Value, DomainError>` unless noted; the async I/O uses `client.query`/`query_opt`/`query_raw`/`execute`.

| Python route (main.py) | Python op file | SQL / asyncpg work | Rust module → fn |
|---|---|---|---|
| `GET /{c}/databases` | [list_databases.py](../../sqladmin/backend/app/operations/list_databases.py) | `SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY datname`; map to `[{name}]` | `ops/list_databases.rs` |
| `GET /{c}/{db}/schemas` | [list_schemas.py](../../sqladmin/backend/app/operations/list_schemas.py) | `information_schema.schemata` minus `pg_catalog`/`information_schema`/`pg_temp%`/`pg_toast%` (`$1::text[]` bind) → `[{name}]` | `ops/list_schemas.rs` |
| `GET /{c}/{db}/{s}/objects` | [list_objects.py](../../sqladmin/backend/app/operations/list_objects.py) | `information_schema.tables` UNION ALL matviews from `pg_class relkind='m'`; `CASE` table_type → kind; `$1` schema → `[{name,kind}]` | `ops/list_objects.rs` |
| `GET /{c}/{db}/{s}/{t}/columns` | [list_columns.py](../../sqladmin/backend/app/operations/list_columns.py) | `information_schema.columns` LEFT JOIN PK usage + generated/default flags (`$1,$2`); matview fallback via `pg_attribute`/`format_type`; empty ⇒ 404 gate. Produces typed `ColumnMeta` (with `pg_type_to_wire`) **and** contract JSON | `ops/list_columns.rs` → `list_columns` (JSON) + `columns_meta` (typed, reused by row ops) |
| `GET /{c}/{db}/{s}/{t}/definition` | [view_definition.py](../../sqladmin/backend/app/operations/view_definition.py) | `pg_get_viewdef(oid,true)` gated to `relkind IN ('v','m')` (`$1,$2`); zero rows ⇒ 404 → `{definition}` | `ops/view_definition.rs` |
| `GET /{c}/{db}/{s}/{t}/structure` | [table_structure.py](../../sqladmin/backend/app/operations/table_structure.py) (3 queries) | `ListIndexesQuery` (`pg_indexes`+`pg_index`), `ListConstraintsQuery` (`pg_constraint contype IN p,u,c` + `pg_get_constraintdef` + `conkey`→cols array, `_CONSTRAINT_TYPES` map), `ListForeignKeysQuery` (`contype='f'` + ref schema/table + `conkey`/`confkey` arrays + `_FK_ACTIONS` map) → `{indexes,constraints,foreignKeys}` | `ops/table_structure.rs` → `list_indexes` + `list_constraints` + `list_foreign_keys` + `structure` aggregator |
| `GET /{c}/roles` | [roles.py](../../sqladmin/backend/app/operations/roles.py) | `pg_catalog.pg_roles` (`_ROLE_COLUMNS`) ORDER BY rolname; `summary_from_row` → `RoleSummary.to_contract` | `ops/roles.rs` → `list_roles` + shared `role_summary(row)` |
| `GET /{c}/roles/{role}` | [role_detail.py](../../sqladmin/backend/app/operations/role_detail.py) (3 queries) | `RoleAttributesQuery` (`WHERE rolname=$1`, None ⇒ 404), `RoleMembershipsQuery` (`pg_auth_members` join), `RolePrivilegesQuery` (`information_schema.role_table_grants`) → `{role,memberOf,privileges}` | `ops/role_detail.rs` → `role_attributes` + `role_memberships` + `role_privileges` + `role_detail` aggregator |
| `GET /{c}/{db}/{s}/{t}/rows` | [list_rows.py](../../sqladmin/backend/app/operations/list_rows.py) | `_columns_for` gate; `FilterCompiler`+`OrderCompiler`; `SELECT *, count(*) OVER() AS __total … LIMIT $n+1 OFFSET $n+2` (page cap 1000); lift `__total`, `rows_to_wire` → `{rows,totalCount}` | `ops/list_rows.rs` |
| `POST /{c}/{db}/{s}/{t}/rows` | [insert_row.py](../../sqladmin/backend/app/operations/insert_row.py) | validate keys ∈ columns; `from_wire_value` binds; `INSERT … RETURNING *` (or `DEFAULT VALUES`) in a txn; `rows_to_wire` first row | `ops/insert_row.rs` |
| `PUT /{c}/{db}/{s}/{t}/rows/{id}` | [update_row.py](../../sqladmin/backend/app/operations/update_row.py) | `single_pk`; skip PK in SET; `UPDATE … SET … WHERE pk::text=$idx RETURNING *`; None ⇒ 404 | `ops/update_row.rs` |
| `DELETE /{c}/{db}/{s}/{t}/rows/{id}` | [delete_row.py](../../sqladmin/backend/app/operations/delete_row.py) | `single_pk`; `DELETE … WHERE pk::text=$1`; affected `0` ⇒ 404; 204 no body | `ops/delete_row.rs` |
| `POST /{c}/query` | [run_query.py](../../sqladmin/backend/app/operations/run_query.py) | reject empty; `prepare` → `Statement::columns()`; if columns: `_query_columns` (dedupe `?column?`/collisions, `pg_type_to_wire(attr.type.name)`), positional row build, `rows_to_wire` → `{kind:"rows",columns,rows,rowCount}`; else `{kind:"status",command,rowCount}` from the command tag | `ops/run_query.rs` |
| `POST /{c}/explain` | [explain_query.py](../../sqladmin/backend/app/operations/explain_query.py) | validate format ∈ {text,json}; `EXPLAIN (…FORMAT …) <sql>`; ANALYZE runs in a **rolled-back txn**; FORMAT JSON parses the single cell → `planJson`; TEXT joins rows → `plan` | `ops/explain_query.rs` |
| `GET /{c}/{db}/{s}/{t}/export` | [export_rows.py](../../sqladmin/backend/app/operations/export_rows.py) | validate format; `_columns_for` gate; server-side stream (`query_raw`) of `SELECT * FROM <qualified>`; `csv_header`/`csv_row` or `json_open`/`json_row`/`json_close`, each row `rows_to_wire` | `ops/export_rows.rs` → returns a body stream the scheme handler wraps as an `attachment` |

**Supporting-module ports** (not routes):

| Python module | Rust module | Notes |
|---|---|---|
| [connections.py](../../sqladmin/backend/app/connections.py) | `db/pool.rs` | `Pools` registry, `get_pool`, `open_pools` at `setup()`; json/jsonb codec **dropped** (native `serde_json`) |
| [wire.py](../../sqladmin/backend/app/wire.py) | `db/wire.rs` | `pg_type_to_wire` (name→WireType) + `value_to_wire` (OID→JSON) + `wire_to_sql` (inverse) + `rows_to_wire` |
| [sql/compiler.py](../../sqladmin/backend/app/sql/compiler.py) | `db/compiler.rs` | `quote_ident`, `OrderCompiler`, `FilterCompiler`, `_escape_like`, `_COMPARATORS` — pure |
| [export_format.py](../../sqladmin/backend/app/export_format.py) | `db/export_format.rs` | `csv_field`/`csv_header`/`csv_row`/`json_open`/`json_row`/`json_close` — pure; RFC-4180 CRLF, `ensure_ascii=False` ⇒ raw UTF-8 |
| [contract.py](../../sqladmin/backend/app/contract.py) | `db/contract.rs` | `WireType` enum, `TableRef`, `ColumnMeta`, `RoleSummary`/`RoleMembership`/`RolePrivilege` structs with `to_contract` (serde) |
| [errors.py](../../sqladmin/backend/app/errors.py) | `db/errors.rs` | `DomainError` enum + `status_code()` + `From<tokio_postgres::Error>` |
| [operations/common.py](../../sqladmin/backend/app/operations/common.py) | `ops/common.rs` | `qualified`, `single_pk` |
| [main.py](../../sqladmin/backend/app/main.py) route table | `api.rs` `dispatch()` | path/method → op; `_parse_json_array` for `sort`/`filter`; `_columns_for` gate; error → `(status,{detail})` |

---

## Public API

New Rust surfaces (sqladmin `frontend/src-tauri/src/`):

```rust
// api.rs — the port of the main.py route table. One entry point the custom-scheme
// handler calls; matches method + path segments to an op, returns an HTTP response.
async fn dispatch(pools: &Pools, req: http::Request<Vec<u8>>) -> http::Response<Vec<u8>>;

// db/errors.rs
enum DomainError { Validation(String), NotFound(String), Conflict(String), BadRequest(String) }
impl DomainError { fn status_code(&self) -> u16; fn detail(&self) -> &str; }
impl From<tokio_postgres::Error> for DomainError;   // SQLSTATE class 23 -> Conflict(409), else BadRequest(400)

// db/wire.rs
fn pg_type_to_wire(data_type: &str) -> WireType;              // introspection name -> scalar
fn value_to_wire(row: &tokio_postgres::Row, i: usize) -> serde_json::Value;  // OID-driven decode
fn wire_to_sql(v: &serde_json::Value, col: &ColumnMeta) -> Box<dyn tokio_postgres::types::ToSql + Sync>;
fn rows_to_wire(rows: &[tokio_postgres::Row], cols: &[ColumnMeta]) -> Vec<serde_json::Map<String, serde_json::Value>>;

// db/pool.rs — the connections.py registry port
struct Pools(HashMap<String, deadpool_postgres::Pool>);
impl Pools { fn get(&self, id: &str) -> Result<&deadpool_postgres::Pool, DomainError>; }  // NotFound on miss
```

Frontend surface (sqladmin) — **the only frontend change**, a one-line narrowing of the hardened-python shim (token dropped):

```ts
// frontend/src/data/api.ts — replaces the token-bearing __SQLADMIN__ read.
// Rust injects { base: "sqladmin://localhost" } (platform-correct) via an init script;
// undefined in a browser tab, so API_BASE stays "" and the Vite proxy path is unchanged.
const cfg = (window as any).__SQLADMIN__ as { base: string } | undefined;
export const API_BASE = cfg?.base ?? "";
// getJson/postJson: NO Authorization header (no token). tableExportUrl: NO &token param.
```

---

## Ordered Implementation Steps

All paths are in the **sqladmin** repo unless stated. Assumes the prototype's Tauri shell, build hooks, `API_BASE` shim, and the hardened-python `connections.json` reader + `__SQLADMIN__` init-script mechanism exist; this plan removes the sidecar/token pieces of hardened-python.

1. **Add Rust deps** to `frontend/src-tauri/Cargo.toml`: `tokio-postgres` (features `with-serde_json-1`, `with-chrono-0.4`, `with-uuid-1`), `deadpool-postgres`, `rust_decimal` (feature `db-postgres`), `chrono`, `uuid`, `base64`, `serde_json`, `futures-util` (for `query_raw` streams). Drop any `rand`/`reqwest`/`tauri-plugin-shell` deps the hardened-python plan added for the token/health-poll/sidecar (no longer needed).

2. **Port the pure modules first** (no DB, unit-testable in isolation): `db/contract.rs`, `db/errors.rs`, `db/compiler.rs`, `db/export_format.rs`, `ops/common.rs`. Port the wire **name→WireType** map (`pg_type_to_wire`) here too. Add `#[cfg(test)]` tests mirroring the backend's pure-function tests (compiler clauses, CSV/JSON escaping, PK gate).

3. **Port `db/wire.rs` value decoding**: `value_to_wire` (OID match), `wire_to_sql` (inverse), `rows_to_wire`. This is the highest-risk module — write it against a live throwaway table covering every wire type (int, numeric, bool, timestamptz, uuid, json, bytea, array) before wiring any route.

4. **Port `db/pool.rs`**: `Pools` registry + `get`. Open the `"default"` pool at `setup()` from the `connections.json` DSN (reuse hardened-python's reader); drop `open_pools`/`close_pools`/`lifespan` and the json/jsonb codec.

5. **Port the read ops** into `ops/`: `list_databases`, `list_schemas`, `list_objects`, `list_columns` (+ the typed `columns_meta` the row ops reuse), `view_definition`, `table_structure` (3 queries + aggregator), `roles`, `role_detail` (3 queries + aggregator). Each returns `Result<serde_json::Value, DomainError>`.

6. **Port the row CRUD + query ops**: `list_rows` (compiler + `_columns_for` gate + windowed count), `insert_row`, `update_row`, `delete_row`, `run_query` (prepare → classify rows/status → dedupe columns), `explain_query` (rolled-back ANALYZE txn), `export_rows` (`query_raw` stream + formatters).

7. **Write `api.rs` `dispatch()`** — the `main.py` route table: split the path, match method + segments to an op, parse `page`/`pageSize`/`sort`/`filter` query params (`_parse_json_array`), thread the `_columns_for` gate, and map `Result` → HTTP response (success JSON, or `error.status_code()` + `{"detail":…}`). Export returns the streamed attachment body + `Content-Disposition`.

8. **Register the custom scheme** in `src/main.rs`: `tauri::Builder::…register_asynchronous_uri_scheme_protocol("sqladmin", move |ctx, req, responder| { … dispatch(pools, req) … })`. Inject `window.__SQLADMIN__ = { base: <platform-correct sqladmin origin> }` via the init script (reuse hardened-python's mechanism, token removed). Confirm the scheme origin string per platform (`sqladmin://localhost` vs `http://sqladmin.localhost`).

9. **Narrow the frontend shim** in `frontend/src/data/api.ts`: read `{ base }` from `__SQLADMIN__`, drop the `Authorization` header from `getJson`/`postJson`, drop `&token=` from `tableExportUrl`. Remove the token header from `frontend/src/data/stores.ts` if hardened-python added it. `stores.ts` `AjaxStore` url still just gets the `API_BASE` prefix.
   - Checkpoint: `grep -rn "Authorization\|token" frontend/src/data` — no token plumbing remains.

10. **Delete the Python backend and sidecar wiring**: remove the `backend/` tree, the `beforeBuildCommand` PyInstaller step, `externalBin`, and the `binaries/` sidecar from `tauri.conf.json`. `beforeBuildCommand` reverts to just `npm run build`.
    - Checkpoint: `grep -rn "externalBin\|sidecar\|SQLADMIN_TOKEN\|pyinstaller\|uvicorn" frontend/src-tauri` — zero matches.

11. **Parity + smoke test**: `cd frontend && cargo tauri dev`. Navigator loads databases/schemas/objects/columns; a table opens (rows + sort + filter + paging via `AjaxProxy`); insert/update/delete round-trip; a query runs; EXPLAIN renders; a CSV and a JSON export download. Run the golden-output parity harness (`## Verification`) against a still-running Python backend to confirm byte-identical responses. Confirm **no listening socket**: `ss -tlnp | grep <app-pid>` shows nothing.

---

## Files to Create / Modify / Delete

All in the **sqladmin** repo.

| Action | File |
|---|---|
| Create | `frontend/src-tauri/src/db/contract.rs` (WireType, TableRef, ColumnMeta, Role* structs) |
| Create | `frontend/src-tauri/src/db/errors.rs` (DomainError enum + pg-error conversion) |
| Create | `frontend/src-tauri/src/db/wire.rs` (type mapping + value decode/encode) |
| Create | `frontend/src-tauri/src/db/compiler.rs` (sort/filter → SQL) |
| Create | `frontend/src-tauri/src/db/export_format.rs` (CSV/JSON dialect) |
| Create | `frontend/src-tauri/src/db/pool.rs` (connectionId → deadpool registry) |
| Create | `frontend/src-tauri/src/ops/common.rs` (qualified, single_pk) |
| Create | `frontend/src-tauri/src/ops/{list_databases,list_schemas,list_objects,list_columns,view_definition,table_structure,roles,role_detail,list_rows,insert_row,update_row,delete_row,run_query,explain_query,export_rows}.rs` |
| Create | `frontend/src-tauri/src/api.rs` (dispatch — the main.py route table) |
| Modify | `frontend/src-tauri/src/main.rs` (register custom scheme, open pool at setup, inject `__SQLADMIN__` base) |
| Modify | `frontend/src-tauri/Cargo.toml` (add tokio-postgres/deadpool/decimal/chrono/uuid/base64; drop token/sidecar deps) |
| Modify | `frontend/src-tauri/tauri.conf.json` (drop `externalBin`/sidecar/PyInstaller `beforeBuildCommand`; custom-scheme CSP allowance) |
| Modify | `frontend/src/data/api.ts` (base from `__SQLADMIN__`; drop token header + export token param) |
| Modify | `frontend/src/data/stores.ts` (drop token header if hardened-python added it) |
| Delete | `backend/` (the entire Python tree — `app/`, `sidecar.py`, `build-sidecar.sh`, `pyproject.toml`) |
| Delete | `frontend/src-tauri/binaries/` (the frozen sidecar) |

No `@jimka/typescript-ui` library file changes — the HTTP shape is preserved, so `AjaxProxy`/`AjaxError`/`JsonReader` are untouched.

---

## Expected Behaviour

The Rust pure modules are unit-testable in-crate; the DB ops and the full app are integration/manual. Derive every case from the **existing Python contract**, not from re-observing output.

**Unit-testable (Rust `#[cfg(test)]`, no DB):**
- `compiler`: `OrderCompiler` on a known/unknown column (→ `ValidationError`); each `FilterCompiler` comparator/`contains`/`startsWith`/`in`/`and`/`or`/`not`; `_escape_like` on `%`/`_`/`\`; `$n` param numbering.
- `export_format`: `csv_field` NULL (bare empty) vs empty-string (`""` quoted); delimiter/quote/CR/LF quoting; boolean `true`/`false`; JSON compact with raw UTF-8; `json_row` first-vs-subsequent separator.
- `wire::pg_type_to_wire`: every branch (number/numeric-as-string/bool/datetime/json/bytea/array/string/unknown-fallback).
- `errors`: each variant's `status_code()`; SQLSTATE `23505` → 409, `42P01` → 400.
- `ops::common::single_pk`: zero/one/many PKs.

**Manual / integration-verify (needs a live Postgres + the webview):**
- `value_to_wire` decodes every wire type correctly (int, numeric→precision string, bool, timestamptz→ISO, uuid→string, json passthrough, bytea→base64, array→JSON array) — verified against the Python backend's output for the same rows.
- Every route returns **byte-identical** JSON to the Python backend for a shared fixture DB (the parity harness).
- `run_query` classifies a SELECT as `{kind:"rows"}` and an INSERT/DDL as `{kind:"status"}`; a `;`-separated script → 400; unnamed/duplicate columns disambiguate to `column`/`column_2`.
- `EXPLAIN ANALYZE UPDATE …` returns a plan **and leaves no row changed** (rollback).
- Insert/update/delete round-trip through `AjaxProxy`; a unique-violation insert → 409 with the driver message as `{detail}`; a PK-miss update/delete → 404.
- CSV and JSON export download as attachments with the `<schema>.<table>.<ext>` filename.
- **No socket**: `ss -tlnp` / `lsof -p <pid>` shows the app listening on **no** TCP port; a foreign `curl` has nothing to connect to.
- **Browser-tab regression**: `npm run dev` at `localhost:5173` still works — `__SQLADMIN__` undefined ⇒ `API_BASE` `""` ⇒ relative `/api` via the Vite proxy (which must still forward to *a* backend during dev; see Non-Goals on the dev proxy). Existing `api.test.ts` URL assertions unchanged.

---

## Verification

- **Rust unit tests:** `cd frontend/src-tauri && cargo test` — the pure-module cases above.
- **Golden-output parity harness:** run the **Python backend** and the **Rust core** against the **same fixture DB**; for every route + a matrix of tables (types, matview, view, multi-PK, empty), diff the JSON bodies. This is the primary correctness gate for the port — a difference is a port bug. Keep the fixture DB and the request list in a script so the port can be checked off route-by-route.
- **Frontend typecheck + tests:** `cd frontend && npm run typecheck && npm test` — `api.test.ts` confirms browser-mode URLs/headers are unchanged (empty base, no token header).
- **No-socket assertion:** with the app running, `ss -tlnp | grep <pid>` (Linux) / `lsof -nP -p <pid> | grep LISTEN` returns nothing.
- **Native smoke** (`cargo tauri dev` then a `cargo tauri build` bundle): navigator loads, CRUD + query + EXPLAIN + both exports work, no orphan process on close (there is no child), no listening port.
- **Grep checkpoints:** step 9 (`Authorization`/`token`), step 10 (`externalBin`/`sidecar`/`uvicorn`).

---

## Documentation Impact

- `backend/README.md` and `backend/Dockerfile` describe the FastAPI/uvicorn deployment; both are removed with the `backend/` tree. Note in the sqladmin top-level README that the desktop build has no separate backend service.
- No `@jimka/typescript-ui` public-API/doc surface changes — the library transport contract (`AjaxProxy`/`AjaxError`/`JsonReader`) is unchanged, so no TypeDoc/catalog edits.

---

## Potential Challenges

- **Dynamic-row-shape decoding is the hardest part.** `tokio-postgres` decodes a value only against a named Rust type, so `value_to_wire` must exhaustively match column OIDs (`row.columns()[i].type()`) — a large but bounded map ported from `wire.py`. Mitigation: build and test `db/wire.rs` against a table covering every type **before** any route; the parity harness catches any missed OID (it surfaces as a decode error or a differing JSON body). An unhandled OID must fall back to text like `pg_type_to_wire` does, never panic.
- **`NUMERIC` precision.** `rust_decimal::Decimal` has a 28–29-significant-digit limit; Postgres `numeric` is effectively unbounded. A value exceeding `Decimal`'s range fails to decode. Mitigation: for `NUMERIC`/`MONEY`, decode via a text-returning path (bind the column through `::text` in introspected reads, or use a `FromSql` that captures the raw string) so the precision-preserving-string contract holds for any magnitude, matching `_NUMERIC_AS_STRING`.
- **`run_query` command tag.** The Python `{kind:"status"}` envelope carries `command` (e.g. `"CREATE TABLE"`) from asyncpg's status message; `tokio-postgres`'s `execute` returns only the affected-row **count**, not the tag string. Mitigation: derive `command` from the leading SQL keyword(s), or accept a documented minor divergence in that one field — flag it in the parity harness as a known non-diff.
- **Export streaming.** Tauri's custom-protocol `Response` prefers a complete body, so a very large export could buffer in memory rather than stream like the Python `StreamingResponse`. Mitigation: use the **asynchronous** scheme handler feeding a channel/`Body` incrementally where supported; if that proves lossy, fall back to a **save-file command** — a Tauri command that opens a native save dialog and writes the `query_raw` stream straight to the chosen path, bypassing the download entirely (a small `SqlAdminController.exportTable` change, isolated behind the same method).
- **Float rendering divergence.** `export_format.py` documents that full-table CSV floats use Python `repr` (`str(1.0)=="1.0"`) which the *query* path (post-JSON) renders differently. The Rust CSV path uses Rust float formatting; ensure it matches the frontend `serialize.ts` dialect the export claims byte-identity with (the string-typed columns are the strict contract; floats are already acknowledged as path-dependent). Verify against `serialize.ts`, not against the Python export.
- **Custom-scheme origin + CSP.** The scheme origin differs by platform (`sqladmin://localhost` vs `http://sqladmin.localhost`) and must be allowed by the Tauri CSP / `fetch` allowlist, or `fetch`/navigation is blocked. Mitigation: inject the platform-correct base from Rust (which knows the target) and add the scheme to the CSP `connect-src`.
- **Async lifetime of a pooled client across a streamed response.** The export holds a `deadpool` client for the stream's lifetime (the asyncpg `finally`-release analogue). Mitigation: move the client into the stream/response body so it drops (returns to the pool) when the body is exhausted or the download is aborted.
- **Scope + uncertainty.** This is a full backend rewrite in a second language; the parity harness is the safety net that lets it land incrementally (one route green at a time) rather than as a big-bang cutover.

---

## Critical Files

Read before implementing:

- [tauri-desktop-hardened-python.md](./tauri-desktop-hardened-python.md) — the state this evolves from; reuse its `connections.json` reader and `__SQLADMIN__` init-script injection, and **remove** its token/port/health/sidecar machinery.
- [tauri-desktop-prototype.md](./tauri-desktop-prototype.md) — the shell/webview/build-hook/`API_BASE`-shim foundation both hardened plans share.
- [backend/app/main.py](../../sqladmin/backend/app/main.py) — the route table `dispatch()` ports; the two exception handlers the error taxonomy ports; the `_columns_for` gate and `_parse_json_array`.
- [backend/app/operations/](../../sqladmin/backend/app/operations/) — every op file in the port table; each is a `__init__`(validate)/`apply`(I/O)/`get_result`(pure) triple the Rust fn collapses into one `Result`.
- [backend/app/wire.py](../../sqladmin/backend/app/wire.py) — the type-mapping the dynamic decoder ports (the highest-risk module).
- [backend/app/sql/compiler.py](../../sqladmin/backend/app/sql/compiler.py) + [operations/common.py](../../sqladmin/backend/app/operations/common.py) — pure SQL-building ports.
- [backend/app/export_format.py](../../sqladmin/backend/app/export_format.py) + [contract.py](../../sqladmin/backend/app/contract.py) + [errors.py](../../sqladmin/backend/app/errors.py) — pure formatter, wire structs, and taxonomy.
- [frontend/src/data/api.ts](../../sqladmin/frontend/src/data/api.ts) + [stores.ts](../../sqladmin/frontend/src/data/stores.ts) — the call sites the custom scheme must satisfy; the only frontend edit (drop the token, keep the base).
- [typescript-ui `AjaxProxy.ts`](../src/typescript/lib/data/proxy/AjaxProxy.ts) — confirms the library issues real `fetch()` with `{url}/{id}` PUT/DELETE, page/sort/filter query params, and `{detail}`-carrying `AjaxError` — the exact HTTP shape the scheme handler must honor so no library change is needed.

---

## Non-Goals

Intentionally out of scope; each with a reason.

- **In-app connections manager** — multi-DSN settings UI driving the `/api/{connection_id}` namespacing. Carried over as deferred from hardened-python; this plan keeps the single-`"default"` `connections.json` DSN.
- **Dev-mode backend** — with the backend gone, `npm run dev` in a plain browser tab has no `/api` server behind the Vite proxy. Keeping a browser-tab dev workflow (a `cargo`-run HTTP shim, or retaining the Python backend for dev only) is out of scope; desktop `cargo tauri dev` is the supported dev loop. Flagged so the browser-tab regression check is understood as Tauri-mode-only.
- **RSS re-measurement** — the prototype produced the headline webview number; removing the Python interpreter only *shrinks* backend-side RSS/disk (no interpreter process, no ~35–50 MB frozen binary), so a formal re-measure is optional, not required.
- **Packaging / signing / auto-update** — release-engineering, unchanged from the hardened-python notes; the bundle is now simpler (no `externalBin`).
- **Secret-at-rest for the DSN** — `connections.json` stays plaintext; OS-keychain storage remains a follow-up.
- **Reintroducing a socket for remote/multi-client access** — the no-socket model is the point; any future remote-access mode is a separate design, not this plan.
```

## Outcome (contrast with both earlier plans)

**Security posture.** Prototype: a fixed loopback port, so any local process could run arbitrary SQL — a known, accepted gap. Hardened-python: a random loopback port defended by a per-launch bearer token — closes the gap but still exposes a socket (probeable, token-handling attack surface, DNS-rebinding to defend). **This plan: no socket at all** — the API is reachable only through the in-process custom scheme the webview owns, so there is nothing for a foreign process to connect to and no token to leak. Strictly the most secure of the three.

**Disk footprint.** Prototype: dev-env Python (not self-contained). Hardened-python: a ~35–50 MB frozen Python binary inside the bundle. **This plan: no Python, no interpreter, no frozen binary** — just the Rust core compiled into the Tauri app binary (a few MB), plus the OS-provided webview. Smallest bundle of the three.

**RAM footprint.** Hardened-python ran a **separate Python process** (uvicorn + asyncpg working set, tens of MB) alongside the Tauri process. **This plan folds the data layer into the single Tauri process** — no second interpreter process, the DB work runs on the Tokio runtime the app already has. One native process, no Python RSS.
