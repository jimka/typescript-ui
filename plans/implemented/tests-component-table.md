# Table Component Test Coverage — Implementation Plan

## Overview

This plan adds Vitest coverage for the table component subsystem under
[`src/typescript/lib/component/table/`](../src/typescript/lib/component/table)
(~43 files: `Table`, `TablePanel`, `Body`, `Row`, `Column`, `ColumnConfig`,
`Header`, `Footer`, `TableExporter`, `TreeBody`, `TreeTable`, `TreeTablePanel`,
`TreeTableSpec`, plus `cell/` renderers and editors). Unlike the pure-logic
data-layer tests already shipped, these are DOM-heavy stateful components: their
constructors create real child components (`Text`, `TextField`, `Checkbox`,
`Glyph`) whose elements are minted through `DOM.sink`, so every test file must
run under the offline DOM harness ([`tests/dom/TestDOM.ts`](../tests/dom/TestDOM.ts)
via `installTestDOM(...)`) with the `// @vitest-environment jsdom` pragma.

The subsystem splits cleanly into a **cheap, near-pure nucleus** — value
formatting, parse/commit round-trips, spec resolution, relational tree
flattening, sort-badge visibility, CSV/JSON export string production — and an
**expensive full-render tier** (virtual scrolling, row pooling, resize/drag,
editor-pool DOM lifecycle). This plan front-loads the nucleus, where one test
buys a real invariant, and scopes the expensive tier honestly: structural and
relational assertions only, never golden DOM geometry.

All new files live under `tests/component/table/`. No source code changes — this
is a test-authoring plan. Where a test's contract-derived expectation diverges
from what the code emits, the implementer **stops and surfaces it** (see
[Methodology](#methodology--assert-the-contract-not-the-current-output)), never
silently conforms the assertion to current output.

---

## Methodology — assert the contract, not the current output

This is the governing rule for every target below and is non-negotiable.

1. **Derive each expectation from the contract**, not from running the code and
   copying its output. The contract is: the JSDoc on the method/class, the
   TypeScript signature, and how real callers use it (`Table`, `Body`,
   `CellEditorPool`, the cell subclasses). Write the `expect(...)` value the
   docstring *promises* before you ever run the test.

2. **When observed behaviour diverges from the derived expectation, STOP.** Do
   not edit the assertion to match the emitted value. Investigate whether the
   bug is in the expectation (you misread the contract) or in the code (the
   contract is right, the implementation is wrong). Resolve the expectation
   side; for the code side, **leave the test as written and mark it
   `it.fails(...)`** with a comment that (a) quotes the contract clause, (b)
   states the observed value, (c) names the suspected root cause. This surfaces
   the divergence to the reviewer instead of burying it under a green check.

   ```ts
   // CONTRACT (NumberRenderer JSDoc): "every other value (including `0`, `-1`,
   // `NaN`, `Infinity`) goes through String(value)". OBSERVED: <fill in>.
   // If these disagree, the code or the doc is wrong — do NOT relax this to the
   // emitted string.
   it.fails('renders NaN as the literal "NaN", never "" or "null"', () => { ... });
   ```

3. **Never golden-snapshot DOM pixel geometry.** No `toMatchSnapshot` on element
   trees, no asserting exact `getWidth()`/`getX()` pixel values that depend on
   layout math. Assert **structural and relational invariants**: ordering,
   which column carries which class/colour, export row/column *counts* and field
   *order*, parse round-trips (`setValue(x); expect(getValue()).toBe(x)`),
   null-vs-zero distinctions, visibility booleans, depth/expansion relations.

4. **Locale-dependent formatters** (`toLocaleDateString`, `toLocaleString`,
   `toLocaleTimeString`) MUST NOT be asserted against a hard-coded locale string
   — that is environment-dependent and brittle. Assert the **relational
   contract** instead: that the renderer/exporter output **equals what the same
   `Date` produces via the same `toLocale*` call with the same options**, and
   that `showSeconds: true` yields a *longer/different* string than
   `showSeconds: false`. This pins the behaviour ("formats with these exact
   options") without pinning the machine's locale.

---

## Architecture Decisions

### Harness: `installTestDOM` + jsdom for every table test file

Cell renderers and editors build real child components in their constructors
(`new Text()`, `new TextField()`, `new Checkbox()`, `new Glyph()`), each of
which mints an element through `DOM.sink`. Constructing any of them without an
installed sink throws. Therefore every file uses the established pattern from
[`tests/component/layout/Grid.test.ts`](../tests/component/layout/Grid.test.ts):

```ts
// @vitest-environment jsdom
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = { rootMountOffset: { x: 0, y: 0 }, viewport: { width: 1280, height: 800 },
                 scrollBarWidth: 15, fontMetrics, themeVars: {} };

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());
```

`ThemeManager.getTheme()` returns the static `ModernTheme` default with no
install needed, so `CellRenderer`/`CellEditor` padding setup works offline.

### `TableExporter` is tested via the recording sink, not a real download

`TableExporter.download` calls `DOM.sink.createElement('a')`,
`setAttr`, `appendChild`, `click`, `removeChild`, `release` plus
`URL.createObjectURL`. Under jsdom + the recording sink the DOM ops are captured
and `URL.createObjectURL`/`revokeObjectURL` exist. We cannot read the Blob
content back through the sink, so we **do not** assert the downloaded string by
intercepting the Blob. Instead we test the **pure string-production seam**:
`TableExporter.formatValue` and `TableExporter.escapeCSVField` are `private
static`, so we reach them via `as any` on the class (an established test idiom
for private statics) and assert RFC-4180 escaping and per-type date formatting
directly. The full `exportCSV`/`exportJSON` paths get a **smoke test only** (no
throw; the recording sink shows one `createElement('a')` + one `click`),
because their string content is not observable through the seam.

### `callable`-wrapped classes instantiate with `new`

Every cell/renderer/editor is exported as a `callable(...)` proxy
([`src/typescript/lib/core/Callable.ts`](../src/typescript/lib/core/Callable.ts)).
`new NumberRenderer()` and `instanceof NumberRenderer` both work through the
proxy, so tests import the public (callable) name and use `new` as normal.

### `TreeBody` relational tests drive the public API over a real store

`flatten()` / `rebuildIndex()` are private; the relational contract is exposed
through `getFlatRecords()`, `setExpanded`, `expandToDepth`, `collapseAll`,
`isExpanded`. We construct a `TreeBody` over a small `MemoryStore` (the
`Model`/`MemoryStore` construction idiom is already established in
[`tests/unit/data/MemoryStore.test.ts`](../tests/unit/data/MemoryStore.test.ts))
and assert the flat-record relation (order, depth, `hasChildren`, `expanded`,
`siblingCount`, `posInSet`, orphan-as-root) — not pixels. If `TreeBody`'s
constructor needs more wiring than a store + spec (it subclasses the heavy
`Body`), the implementer scopes this target to whatever the public constructor
accepts and **defers the rest to a Non-Goal rather than reaching into privates**.

### No tests for the heavy render/interaction tier beyond structural smoke

`Table` (801 LOC), `Body` (1437 LOC), `Header` (657 LOC), `Row`, drag/resize,
and `CellEditorPool`'s DOM focus lifecycle are virtual-scroll / pointer-driven
machinery whose behaviour is geometric and event-timing dependent. The offline
`ModelledDOMSource` reports zeroed scroll metrics and no DOM tree
(`querySelector` → null, `isConnected` → false), so these paths cannot be
meaningfully exercised offline. They are **Non-Goals**; only the relational
slices that *don't* need live geometry are in scope (e.g. `Column.resolve`
ordering, `CellEditorPool` factory-key mapping, `SortPriorityBadge` visibility).

---

## Target Triage

Ordered by value-per-test. Tiers 1–2 are the cheap nucleus (do first); tier 3 is
the honest structural slice of the expensive area; the rest are Non-Goals.

| Tier | Target | Why cheap | Risk if skipped |
|---|---|---|---|
| 1 | `TableExporter` escape + formatValue | Pure static fns, no DOM | CSV corruption, wrong date export |
| 1 | `Column.resolve` | Pure, store-free (needs `Field[]`) | Wrong column order / spec filtering |
| 1 | `SortPriorityBadge` visibility | Single component, pure predicate | Badge shows/hides wrongly |
| 1 | `ColumnConfig` / `Column` getters | Pure constructor round-trip | Spec fields silently dropped |
| 2 | Cell renderers (String/Number/Date/Time/DateTime/Glyph) | value round-trip, no geometry | null↔0 confusion, format drift |
| 2 | Cell editors (String/Number) parse/commit | `onInput` parse logic | empty→0, unparseable→NaN bugs |
| 2 | `BooleanEditor` tri-state + suppress-commit | event-driven but local | spurious commits on scroll |
| 2 | `CellEditorPool` factory-key mapping | Map lookup, register/override | wrong editor variant per cell |
| 2 | `TreeCellRenderer` getContentX / delegate | pure arithmetic + delegation | indent math, value passthrough |
| 3 | `TreeBody` flatten relation (public API) | relational over small store | tree order/depth/orphan bugs |
| 3 | `TableExporter.exportCSV/JSON` | smoke only (no-throw + sink ops) | crash on export |
| — | `Table` / `Body` / `Header` / `Row` / drag / resize / scroll | needs live geometry/events | (Non-Goal) |

---

## Per-Target Behaviour & Edge-Case Lists

Each list is derived from the cited source/JSDoc. Implementer: assert the
*contract* value, mark `it.fails` on any divergence per the Methodology.

### `TableExporter` — [TableExporter.ts](../src/typescript/lib/component/table/TableExporter.ts)

`escapeCSVField(value)` (private static, reach via `as any`):
- `null` and `undefined` → `""` (empty string), NOT the words "null"/"undefined".
- Plain value with no `,` `"` `\n` → returned unquoted, unchanged.
- Value containing `,` → wrapped in double quotes.
- Value containing `"` → wrapped AND every `"` doubled (`a"b` → `"a""b"`).
- Value containing `\n` → wrapped in quotes.
- Edge: a value containing `\r` only (not `\n`) is **not** quoted — derive this
  from the literal `str.includes('\n')` check; assert it, and if it looks like a
  spec bug (RFC 4180 treats bare CR as a delimiter too) mark `it.fails` with a
  note rather than asserting the buggy current behaviour as correct.

`formatValue(column, value, columnConfigs)` (private static):
- `value == null` → returns value unchanged (null/undefined pass through).
- Non-`Date` value → returned unchanged regardless of column type.
- `Date` + field type `'date'` → equals `value.toLocaleDateString()` (relational
  assert against the same call; do not hard-code a locale string).
- `Date` + `'time'`, `showSeconds` absent/false → equals
  `value.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' })`.
- `Date` + `'time'`, `showSeconds: true` (via the `columnConfigs` map keyed by
  field name) → includes the second component (longer/different from the
  no-seconds form).
- `Date` + `'datetime'` mirrors time with the year/month/day options; seconds
  toggle drives the longer form.
- `Date` + any other field type (e.g. `'string'`, `'number'`) → returned
  unchanged (the `default` branch).
- `showSeconds` lookup: a config present for a *different* field name does not
  affect this column (map miss → `?? false`).

`exportCSV` / `exportJSON` (public static) — smoke only:
- Constructing `Column[]` + `ModelRecord[]` + an empty `Map` and calling each
  must not throw under the harness.
- The recording sink records exactly one `createElement('a')` and one `click`
  per call (assert via `sink.writes.filter(w => w.op === 'click').length`).
- Header row field count = column count; do **not** assert the CSV string body
  (not observable through the seam — see Architecture Decision).

### `Column` — [Column.ts](../src/typescript/lib/component/table/Column.ts)

Constructor round-trip (build `Field` via `new Field({ name, type, order })`;
confirm the `Field` constructor signature first):
- All config fields default correctly when omitted: `minWidth`/`maxWidth` →
  `undefined`; `hidden`/`unhideable`/`readOnly` → `false`; `headerGlyph`/`group`/
  `groupColor` → `null`.
- Each provided config field round-trips through the matching getter.
- `setHeaderGlyph(null)` / `clearHeaderGlyph()` clears the glyph.

`Column.resolve(fields, spec)` (static, pure):
- No spec → one `Column` per field, sorted by `Field.getOrder()` ascending.
- With spec, `appendUnlisted` default (true) → all fields in `getOrder()` order;
  listed fields carry their config, unlisted fields get a bare `Column`.
- `appendUnlisted: false` → only fields whose name is in `spec.columns` survive,
  still in `getOrder()` order.
- Order invariant: output order tracks `getOrder()`, NOT the order fields appear
  in the input array nor the order in `spec.columns` (resolve sorts a slice).
- A `spec.columns` entry naming a field absent from `fields` contributes no
  column (the map is consulted by field, not iterated).
- Edge: duplicate field names in `spec.columns` — last write wins in the
  `configMap`; assert the surviving config, mark `it.fails` if it looks
  unintended.

### `SortPriorityBadge` — [cell/SortPriorityBadge.ts](../src/typescript/lib/component/table/cell/SortPriorityBadge.ts)

Visibility predicate `_shouldShow` is the contract (`value != null && value >= 2`):
- New badge with no priority → `getPriority()` is `null`, `isVisible()` false.
- `setPriority(null)` / `0` / `1` → hidden, and `_priorityText()` is `""` (assert
  via the rendered behaviour: badge not visible). The JSDoc explicitly says the
  leading sort needs no number.
- `setPriority(2)` and above → visible; `getPriority()` returns the value.
- `clearPriority()` ≡ `setPriority(null)` → hidden.
- Constructor option `{ priority: 3 }` → visible immediately; `{ priority: 1 }`
  → hidden. (Round-trips through `applyOptions`.)
- Round-trip: `setPriority(5); expect(getPriority()).toBe(5)`.

### Cell renderers — [cell/renderer/](../src/typescript/lib/component/table/cell/renderer)

Common contract for `String`/`Number`/`Date`/`Time`/`DateTime`/`Glyph`
renderers — the cached-value seam:
- Fresh renderer → `getValue()` is `null`.
- `setValue(null)` and `setValue(undefined)` both normalise to `null`
  (`getValue()` returns `null`), rendering the empty string.
- `setValue(x); getValue()` returns the exact `x` (no DOM re-parse).

`NumberRenderer` specifics (JSDoc is explicit — strong `it.fails` candidates):
- `setValue(0)` → `getValue()` is `0`, NOT `null` (the null-vs-zero contract;
  the cache must distinguish empty from zero).
- `0`, `-1`, `NaN`, `Infinity` all render via `String(value)` — the literal
  text, never `"undefined"`/`"null"`. Assert `getValue()` identity for each;
  for `NaN` assert `Object.is(getValue(), NaN)`.

`StringRenderer`:
- `getText()` returns the underlying `Text`.
- Empty cell distinguished from rendered `""` (cache is `null`, display is `""`).

`DateRenderer` / `TimeRenderer` / `DateTimeRenderer`:
- `getValue()` returns the exact `Date` instance set (reference identity).
- Display equals the corresponding `toLocale*` call with the renderer's options
  (relational assert, not hard-coded locale). `Time`/`DateTime` honour the
  `showSeconds` constructor flag: `new TimeRenderer(true)` produces a
  longer/different display than `new TimeRenderer(false)` for the same `Date`.

`GlyphRenderer` (has real branching — [Glyph.ts](../src/typescript/lib/component/table/cell/renderer/Glyph.ts)):
- Falsy/`null`/`undefined`/`""` → no glyph child, `getValue()` is `null`.
- A registry name → `getValue()` returns that name; a child `Glyph` exists.
- Idempotent set: `setValue(x)` twice with the same `x` does not rebuild the
  glyph (the `next === this._value && (...)` early return). Assert the child
  count stays stable / the same `Glyph` instance survives.
- Switching name → old glyph removed, new glyph added.
- Use a registered glyph name to avoid `Glyph` construction throwing; confirm
  which names `Glyph.register` has seeded, or register one in the test.

### Cell editors — [cell/editor/](../src/typescript/lib/component/table/cell/editor)

`StringEditor` (`onInput` is private; drive it through the wrapped `TextField`
or call the public surface — confirm the cleanest seam, prefer setting the
`TextField` text then invoking the input path it listens on):
- Fresh → `getValue()` is `null`.
- `setValue(null)`/`undefined` → `null`, field empty.
- After typing non-empty text → cached value equals the text.
- After clearing to `""` → cached value is `null` (empty input is `null`, not
  `""` — the cell-stack "no value is null" convention from the JSDoc).
- `setValue(x); getValue()` round-trips.

`NumberEditor` (strong contract, `it.fails` candidates):
- Empty field → `getValue()` is `null`, NOT `0`.
- Unparseable text (e.g. `"abc"`) → `getValue()` is `null`, NOT `NaN`.
- `"0"` → `0` (distinct from empty `null`).
- `"-3.5"` → `-3.5`.
- `setValue(null)` leaves an empty field (no `"null"` text).
- `setValue(7); getValue()` round-trips to `7`.

`BooleanEditor` tri-state + suppress-commit
([editor/Boolean.ts](../src/typescript/lib/component/table/cell/editor/Boolean.ts)):
- Fresh → `getValue()` is `null` (indeterminate).
- `setValue(null)` → indeterminate, `getValue()` null, and **fires no `"change"`
  event** (the `_suppressCommit` guard — register a spy listener and assert zero
  calls). This is the core bug-class the guard exists for; assert it explicitly.
- `setValue(true)` / `setValue(false)` → concrete value, also no `"change"`.
- `toggle()` → flips from current, clears indeterminate, **DOES** fire `"change"`
  with the concrete boolean. From the initial indeterminate state, `toggle()`
  lands on `true` (derive from `!isSelected()` where unselected ⇒ next true).
- `on`/`off` register/remove by exact reference (mirror the `ListenerBag` tests).

`CellEditorPool` factory-key mapping
([editor/CellEditorPool.ts](../src/typescript/lib/component/table/cell/editor/CellEditorPool.ts)):
- Built-in keys seeded by the constructor each produce the right editor class on
  `acquire(key, cell)`: `"string"`→`StringEditor`, `"number"`→`NumberEditor`,
  `"date"`→`DateEditor`, `"time"`/`"time:seconds"`→`TimeEditor`,
  `"datetime"`/`"datetime:seconds"`→`DateTimeEditor`. Assert via `instanceof`.
- Unknown key → `acquire` returns `null`.
- Same key acquired twice → the **same instance** (the pool collapses N editors
  to one per key).
- `register(key, factory)` overrides and drops any cached editor, so the next
  `acquire` runs the new factory (assert a custom marker class comes back).
- `acquire(key, cell)` sets `cell` as the active edit target (assert via
  whatever the pool exposes — confirm the getter; if active-cell state is
  private with no observer, scope this bullet out rather than reaching in).
- NOTE: `acquire` may wire blur/keydown listeners and touch focus; confirm it
  does not require a connected element under the harness. If it does, restrict
  to the construction-mapping assertions and defer the lifecycle bullet.

`TreeCellRenderer` — [renderer/TreeCell.ts](../src/typescript/lib/component/table/cell/renderer/TreeCell.ts)
(pass a real delegate, e.g. `new StringRenderer()`):
- `getContentX()` = `depth * indentPx + TOGGLE_WIDTH`. Default `indentPx` is
  `DEFAULT_INDENT_PX` (16) and `TOGGLE_WIDTH` is 20: depth 0 → 20, depth 2 →
  `2*16+20 = 52`. Custom `indentPx` flows through.
- `getValue`/`setValue` delegate to the wrapped renderer (set on the tree cell,
  read back on the delegate, and vice versa).
- `setTreeState(d, has, exp)` is idempotent: a repeat call with the same triple
  is a no-op (assert the toggle instance is unchanged).
- Leaf (`hasChildren: false`) → `getToggle()` is `null`; branch → non-null.
- `getDepth()` round-trips the depth from `setTreeState`.
- `setInsets` forwards to the delegate and leaves the wrapper at zero insets.

### `TreeBody` flatten relation — [TreeBody.ts](../src/typescript/lib/component/table/TreeBody.ts)

Construct over a `MemoryStore` with id/parent fields (confirm the `TreeBody`
public constructor signature first — it takes a store + a `TreeBodySpec`-shaped
config; if it demands more `Body` wiring than is harness-feasible, scope down
and record the limit as a Non-Goal). Assert via `getFlatRecords()`:
- All-roots store (every `parentField` null) → flat list = the store records, all
  `depth: 0`, `hasChildren: false`, `expanded: false`, `siblingCount` = root
  count, `posInSet` = 1-based index.
- A parent with children, collapsed (default) → only the parent appears;
  `hasChildren: true`, `expanded: false`; children absent from the flat list.
- After `setExpanded(parent, true)` → children appear immediately under the
  parent at `depth: 1`, in store order, with their own `siblingCount`/`posInSet`.
- `isExpanded(leaf)` is always `false`; `setExpanded(leaf, true)` is a no-op
  (returns `this`, flat list unchanged).
- `expandToDepth(0)` expands only roots; `expandToDepth(1)` expands roots and
  their children; deeper levels stay collapsed.
- `collapseAll()` empties the expansion set; re-flatten shows roots only.
- Orphan contract: a record whose `parentField` points at an id absent from the
  store renders as a **root** (depth 0), not dropped (the `rebuildIndex`
  `null`-key fallback).
- Expansion is keyed by id, not `ModelRecord` reference: if feasible, replace a
  record with a fresh instance carrying the same id and assert expansion
  survives; if a store-sync seam isn't reachable offline, defer to a Non-Goal.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `tests/component/table/TableExporter.test.ts` |
| Create | `tests/component/table/Column.test.ts` |
| Create | `tests/component/table/SortPriorityBadge.test.ts` |
| Create | `tests/component/table/cell/renderer.test.ts` |
| Create | `tests/component/table/cell/editor.test.ts` |
| Create | `tests/component/table/cell/CellEditorPool.test.ts` |
| Create | `tests/component/table/cell/TreeCellRenderer.test.ts` |
| Create | `tests/component/table/TreeBody.test.ts` (tier 3; may be scoped down per constructor feasibility) |

Grouping renderers and editors one-file-each keeps each suite focused while
matching the existing per-area layout under `tests/component/`. The implementer
may merge or split files if a target proves smaller/larger than estimated.

---

## Ordered Implementation Steps

1. **Confirm the `Field` constructor + `MemoryStore`/`Model` idiom.** Read
   [`Field.ts`](../src/typescript/lib/data/Field.ts) `FieldOptions` (name, type,
   order, description) and reuse the `new Model([...], idField)` pattern from
   [`tests/unit/data/MemoryStore.test.ts`](../tests/unit/data/MemoryStore.test.ts).
   Verify a bare `Field`/`Column` builds with no DOM. → verify: a throwaway
   `new Column(new Field({ name: 'x' }))` constructs.

2. **`TableExporter.test.ts`** (tier 1, no jsdom needed for the private statics;
   but the smoke test of `exportCSV`/`exportJSON` DOES need `installTestDOM` +
   jsdom for `createElement('a')`). Cover `escapeCSVField`, `formatValue` (all
   field types + `showSeconds`), and the two-write smoke. → verify: `npm test`.

3. **`Column.test.ts`** (tier 1). Constructor defaults/round-trip + `resolve`
   ordering and `appendUnlisted` filtering. → verify: ordering tracks
   `getOrder()`, not input order.

4. **`SortPriorityBadge.test.ts`** (tier 1, jsdom). Visibility predicate across
   `null`/`0`/`1`/`2`/`5`, constructor option, `clearPriority`. → verify: badge
   hidden for `<2`.

5. **`cell/renderer.test.ts`** (tier 2, jsdom). The cached-value seam for all six
   renderers; `NumberRenderer` null-vs-zero + `NaN`/`Infinity`;
   `Date`/`Time`/`DateTime` relational format + `showSeconds`; `GlyphRenderer`
   add/remove/idempotent. → verify: `getValue()` round-trips; mark `it.fails` on
   any null↔0 or format divergence.

6. **`cell/editor.test.ts`** (tier 2, jsdom). `StringEditor` empty→null;
   `NumberEditor` empty→null, unparseable→null, `"0"`→0; `BooleanEditor`
   tri-state + suppress-commit (spy asserts zero `"change"` on `setValue`, one on
   `toggle`). → verify: no spurious commits.

7. **`cell/CellEditorPool.test.ts`** (tier 2, jsdom). Built-in key→class map via
   `instanceof`, unknown→null, same-instance reuse, `register` override. →
   verify: each key yields its editor class.

8. **`cell/TreeCellRenderer.test.ts`** (tier 2, jsdom). `getContentX` arithmetic,
   delegate passthrough, `setTreeState` idempotence, leaf/branch toggle,
   `setInsets` forwarding. → verify: `getContentX` matches `depth*indentPx+20`.

9. **`TreeBody.test.ts`** (tier 3, jsdom). FIRST confirm the public constructor is
   harness-constructible. If yes: flatten relation, expand/collapse,
   `expandToDepth`, orphan-as-root. If the constructor needs un-mockable live
   wiring, reduce to whatever public surface IS reachable and record the rest as
   a Non-Goal in this file's header comment. → verify: flat-record depth/order
   relations hold.

10. **Full run + checkpoint.** `npm test` green (aside from intentional
    `it.fails` markers, which Vitest reports as passing-because-expected-to-fail).
    Each `it.fails` carries a comment per the Methodology naming the contract,
    the observed value, and the suspected root cause. → verify: zero unexpected
    failures; every `it.fails` is annotated.

---

## Verification

- `npm test` — all new suites pass; any `it.fails` is an intentional,
  commented contract-divergence marker (Vitest treats an `it.fails` whose body
  throws as a pass), NOT a silenced bug.
- `npx tsc --noEmit` (or the project's typecheck script) — test files type-check
  under the `~/...` alias.
- Grep checkpoint: `grep -rn "it.fails" tests/component/table/` — every hit has
  an adjacent comment quoting the contract clause and the observed value.
- Grep checkpoint: `grep -rn "toMatchSnapshot\|toLocaleDateString()" tests/component/table/`
  — zero geometry snapshots; any `toLocale*` literal appears only inside a
  relational assertion (compared against the same call), never as a hard-coded
  expected string.
- No source files under `src/typescript/lib/component/table/` are modified.

---

## Potential Challenges

- **Reaching private statics on `TableExporter`** — use `(TableExporter as any)
  .escapeCSVField(...)`; acceptable for a same-package white-box test, but note
  it in a comment so a future refactor that renames the private knows a test
  depends on it.
- **`Glyph` construction requires a registered name** — `TreeCell.ts` registers
  `caret_down`/`caret_right` at import time; for `GlyphRenderer` tests register a
  known glyph or reuse one already seeded, else `new Glyph(name)` may throw.
- **`BooleanEditor` change-event plumbing** — `setValue` drives `Checkbox`
  setters that dispatch synthetic `"click"`; the `_suppressCommit` guard should
  swallow them. If the spy still fires, that IS the bug class the guard targets —
  mark `it.fails`, do not relax the assertion.
- **`TreeBody` constructor heaviness** — it subclasses the 1437-LOC `Body`; the
  offline source returns no DOM tree, so any constructor path that queries the
  live DOM will fail. Probe constructibility in step 1 of that file before
  writing the relational suite; scope down if needed.
- **`CellEditorPool.acquire` side effects** — it may wire listeners/focus on the
  acquired editor; confirm it tolerates an unconnected element offline before
  asserting active-cell state.
- **Locale drift in CI** — never assert a literal date string; always compare
  against the same `toLocale*` call so the test is locale-agnostic.

---

## Critical Files

Read before writing the suites:

- [`tests/dom/TestDOM.ts`](../tests/dom/TestDOM.ts) — `installTestDOM`,
  `RecordingDOMSink.writes`, `ModelledDOMSource` limits (no DOM tree, zeroed
  scroll/offset, `isConnected` false).
- [`tests/component/layout/Grid.test.ts`](../tests/component/layout/Grid.test.ts) —
  the canonical `installTestDOM` + `CONFIG` + `afterEach(DOM.reset)` pattern.
- [`tests/unit/data/MemoryStore.test.ts`](../tests/unit/data/MemoryStore.test.ts),
  [`tests/unit/data/ModelRecord.test.ts`](../tests/unit/data/ModelRecord.test.ts) —
  `new Model([...], idField)` + `new MemoryStore(model, data)` idiom.
- [`tests/unit/core/ListenerBag.test.ts`](../tests/unit/core/ListenerBag.test.ts) —
  spy/listener register-remove pattern for the `BooleanEditor` change tests.
- Source under test: `TableExporter.ts`, `Column.ts`, `ColumnConfig.ts`,
  `cell/SortPriorityBadge.ts`, every `cell/renderer/*.ts`, every
  `cell/editor/*.ts` (esp. `Boolean.ts`, `Number.ts`, `CellEditorPool.ts`),
  `cell/renderer/TreeCell.ts`, `TreeBody.ts`.
- [`src/typescript/lib/core/Callable.ts`](../src/typescript/lib/core/Callable.ts) —
  why `new XRenderer()` and `instanceof` work through the proxy.

---

## Non-Goals

- **`Table`, `Body`, `Header`, `Row`, `Footer`, `TablePanel`, `TreeTable`,
  `TreeTablePanel` full behaviour** — virtual scrolling, row pooling, header
  resize/drag, context menus, selection/focus/keyboard nav, and the edit
  lifecycle are geometry- and event-timing-driven. The offline source reports no
  DOM tree and zeroed scroll metrics, so these cannot be exercised meaningfully;
  only their pure relational slices (`Column.resolve`, factory mapping, badge
  visibility, flatten relation) are in scope.
- **Golden DOM / pixel geometry** — no element-tree snapshots, no asserting
  computed widths/positions that depend on layout math.
- **`CellEditorPool` focus/blur DOM lifecycle** — the commit-on-blur and
  pointer-capture flow needs a live, connected, focusable element the offline
  harness does not provide. Only construction-and-mapping is covered.
- **`TableExporter` downloaded-string content** — the Blob body is not readable
  through the recording sink; only the pure formatting functions and a two-write
  smoke test are covered.
- **`DateEditor`/`TimeEditor`/`DateTimeEditor` dropdown interaction** — picker
  popups, `showAt`, focus retention across layers depend on `LayerManager` and
  live focus; out of scope. Their pure `setValue`/`getValue`/`toInputString`
  round-trips MAY be covered opportunistically if harness-feasible, but the
  dropdown lifecycle is not.
- **Locale-specific formatter output** — asserted relationally, never pinned to a
  specific locale's literal string.
