---
touches-shared:
  - ARCHITECTURE.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/tests/setup/node-setup.ts
  - packages/lib/src/typescript/lib/core/StyleTarget.ts
---

# No DOM Access at Import — Implementation Plan

## Overview

Importing `@jimka/typescript-ui/component/editor` where there is no DOM (Loom's Vitest `node` suite) throws `ReferenceError: document is not defined`. The cause is a *load-time stylesheet write*: code at a module's top level that writes to the shared stylesheet the moment the module is evaluated. [`component/button/Button.ts:33`](packages/lib/src/typescript/lib/component/button/Button.ts#L33) calls `registerFocusVisibleRing`, whose `new StyleRule(...)` materialises at once and reaches `ProductionDOMSink.mainSheet()` ([`core/DOM.ts:1886`](packages/lib/src/typescript/lib/core/DOM.ts#L1886)) and so `document`. The same shape occurs 23 times in the library (ten focus-ring helper calls, nine module-level rule blocks, four `@keyframes` insertions), and 14 of the 23 public entry points throw when imported without a DOM.[^defect]

This plan adds a small queue to [`core/StyleTarget.ts`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L188). A load-time write is handed to `deferStyleSheetWrite`, which holds it until the library makes its first real stylesheet write and then runs it just before that write. Every load-time write moves onto the queue: the two focus-ring helpers in [`component/input/focusRing.ts`](packages/lib/src/typescript/lib/component/input/focusRing.ts#L38) (their ten call sites stay where they are), nine module-level rule blocks, and four module-level `@keyframes` insertions. Three diagnostics modules import `Container` through the `core` barrel, which pulls in `Body`; those imports switch to the direct module. A new test, the *entry-point guard*, imports every public entry point with no DOM present and fails if any of them throws.

After the change every public entry point except `core` imports cleanly without a DOM. `core` still constructs its `Body` singleton when it loads. That is out of scope and pinned in the entry-point guard. The order of rules in the stylesheet is the same as today, so nothing renders differently, the focus ring included.

---

## Architecture Decisions

### Queue load-time writes and run them just before the first real write

`core/StyleTarget.ts` gains a module-level queue. `deferStyleSheetWrite(write)` pushes `write` onto the queue while the library has not yet written to the stylesheet, and runs `write` immediately once it has. The *first real write* is the first rule materialisation (`_ruleFor` missing its cache, [`core/StyleTarget.ts:207`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L207)) or the first `StyleRule.ensureKeyframes` call ([`core/StyleTarget.ts:423`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L423)). Either one first runs the whole queue in registration order, then performs its own write.[^trigger-point]

The queue keeps the stylesheet order identical to today. A load-time write runs either just before the first real write (if it was queued before it) or at once (if it was registered after it). In both cases it lands where an eager write during module evaluation would have put it.[^order-proof] A recorded run that imports six entry points and then builds and renders twelve controls shows this. The load-time writes come first and every later write follows, with and without the change:

| Sheet position | Write | Written by |
|---|---|---|
| 1 | `.Link` | load time, `Link.ts` |
| 5–6 | `.Button:focus-visible, …` / `…::after` | load time, focus ring |
| 34–35 | `.ComboBox:focus-visible, …` / `…::after` | load time, focus ring |
| 46 | `@keyframes ts-ui-progress-indeterminate` | load time, `ProgressBar.ts` |
| 47 | `.ts-ui-component.undisplayed` | the first real write |
| 51 | `.Button.pressed` | render time |
| 61 | `.ts-ui-component.ts-ui-trait-input-chrome` | render time |

Deferral changes only *when* positions 1–46 are written: at the moment position 47 is requested, not at import.

The queue follows the library's rule for shared stylesheet state, which is to materialise on first need and not at load: [`ensureFrameworkStyleRule`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L194) and the `ensureXClassRule()` singletons such as [`ensureSortBadgeClassRule`](packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts#L29). It differs in one way: the trigger is the first stylesheet write of any kind, not the owning class's first use.[^precedent]

### The focus ring renders exactly as before

The ring rules' selectors tie in specificity with some rules written at render time. When specificity ties, source order decides the winner. Every such rule keeps its position relative to the ring, so the winner of every tie is unchanged:

| Ring rule | Tying render-time rule | Specificity | Order today | Order after | Winner of a shared property |
|---|---|---|---|---|---|
| `.Button:focus-visible` | `.Button.pressed` | (0,2,0) each | ring first | ring first | `.Button.pressed` (unchanged) |
| `.ComboBox:focus-visible` | `.ts-ui-component.ts-ui-trait-input-chrome` | (0,2,0) each | ring first | ring first | the trait (unchanged) |
| any ring | a consumer `StyleTrait` on that instance | (0,2,0) each | ring first | ring first | the trait (unchanged) |

No ring property collides with these rules today. `.pressed` declares colour, background, background image and shadow. The input-chrome trait declares `border` and `borderRadius`. The design does not depend on that, because order is preserved whatever the properties are.[^constructor-alternative] `.Button:focus-visible::after` is (0,2,1). No other rule targets these controls' `::after` pseudo-element.

### The fix lives in the focus-ring helpers; their call sites do not move

`registerFocusVisibleRing` and `registerFocusWithinRing` queue their rules through `deferStyleSheetWrite`. Their call sites stay at module top level, because calling a helper that only queues is DOM-free. There are seven `registerFocusVisibleRing` callers: `Button`, `Checkbox`, `ComboBox`, `RadioButton`, `Toggle`, `Slider`, and `Link`. The `Link` call sits inside Link's module-level block at [`Link.ts:46`](packages/lib/src/typescript/lib/component/input/Link.ts#L46). There are three `registerFocusWithinRing` callers: `NumberSpinner`, `AbstractPickerField`, and `AutoCompleteField`.[^helper-verified]

### Scope: every load-time stylesheet write, plus the diagnostics barrel import

The survey covered every module-level statement reachable from the 23 public entry points.[^defect] Each finding is classified below:

| Site | What it does at import | Decision |
|---|---|---|
| `focusRing.ts` helpers (10 callers) | writes ring rules | **In**: helper queues |
| Module-level rule blocks: `TextInput.ts:29`, `TextArea.ts:18`, `Link.ts:37`, `PickerColumn.ts:25`, `AbstractCalendarDropdown.ts:88`, `ComboBox.ts:393`, `AutoCompleteDropdown.ts:43`, `NumberSpinner.ts:27`, `AbstractSelectableList.ts:198` | writes shared rules | **In**: block queued |
| `StyleRule.ensureKeyframes` at `ProgressSpinner.ts:18`, `ProgressBar.ts:8`, `TabButton.ts:42`, `editor/theme.ts:43` | writes `@keyframes` | **In**: call queued |
| `import { Container } from "../core"` in `DiagnosticsOverlay.ts:13`, `StyleAuditOverlay.ts:7`, `StyleAuditView.ts:13` | makes `diagnostics` evaluate `core/Body.ts` | **In**: import `~/core/Container.js`[^diagnostics-barrel] |
| `core/Body.ts:47` static `INSTANCE = new Body()` | renders `Body`, applies the default theme | **Out**, pinned in the guard[^body] |
| `Glyph.ts:121` reduced-motion `matchMedia` listener | registers a media listener through a guarded seam call | **Out**: cannot throw, writes nothing[^glyph] |
| Sentinel `new Component()` in `LayerManager.ts:146`, `FocusHistory.ts:67`, `FocusTraversal.ts:29`, `SpatialNavigation.ts:214` | JS-only construction | **Out**: no DOM access[^sentinels] |

### The node test harness marks the stylesheet as written at startup

[`tests/setup/node-setup.ts`](packages/lib/tests/setup/node-setup.ts#L35) calls `_flushDeferredStyleSheetWrites()` right after its top-level `installTestDOM`. Each node-environment test file then starts with the stylesheet already "written", so its modules' load-time writes run at import into the modelled DOM the setup installs at top level (its *baseline sink*), exactly as they do today. Every existing test keeps its current meaning. The queue itself is tested in a *fresh module graph*: `vi.resetModules()` followed by dynamic imports, so every module is evaluated anew and nothing has been written yet.[^harness]

### Regression guard: import every public entry point with no DOM

A new `packages/lib/tests/unit/import-without-dom.test.ts` runs in the default `node` environment. For each non-wildcard key of `package.json`'s `exports`, it calls `vi.resetModules()` and dynamically imports the entry's source barrel. A fresh module graph gets a fresh `core/DOM.ts` whose seams are the production `ProductionDOMSink` / `ProductionDOMSource`, not the test harness's modelled DOM, so any import-time write throws exactly as it does for Loom. The fresh-graph import follows the existing `vi.resetModules()` + dynamic import precedent ([`tests/dom/fonts-ready.test.ts:141`](packages/lib/tests/dom/fonts-ready.test.ts#L141), [`tests/unit/data/StoreWorkerClient.test.ts:14`](packages/lib/tests/unit/data/StoreWorkerClient.test.ts#L14)). `./core` sits in a known-exception set whose import must still reject. Once `Body` is fixed, that case fails and forces the entry out of the set.[^guard-design]

### No public API changes

`core/StyleTarget.ts` exports `deferStyleSheetWrite` for sibling modules and `_flushDeferredStyleSheetWrites` for the node test setup. Neither is re-exported from `core/index.ts`, the same treatment `disposeStyleRule` already gets. The focus-ring helpers keep their signatures. They are not re-exported from any entry point, so the pre-1.0 unused-public-API rule has nothing to delete or make private.[^export-policy]

---

## Internal Structure

The new state and functions go in `core/StyleTarget.ts` directly below `_ruleCache` ([line 188](packages/lib/src/typescript/lib/core/StyleTarget.ts#L188)):

```typescript
// Load-time stylesheet writes waiting for the library's first real write, in
// registration order (see deferStyleSheetWrite).
const _deferredStyleSheetWrites: Array<() => void> = [];

// Whether the library has made its first real stylesheet write in this module
// instance. Never reset — `DOM.reset()` leaves it alone, as it leaves `_ruleCache`.
let _styleSheetWritten: boolean = false;

/**
 * Queues a stylesheet write a module makes while it loads, so importing the
 * module touches no DOM. The write runs just before the library's first real
 * stylesheet write (a rule materialisation or a `@keyframes` insertion), in
 * registration order — the position an eager write at import would have had —
 * or immediately when that first write has already happened.
 *
 * @param write - Performs the write: constructs the module's shared `StyleRule`s
 *   or calls `StyleRule.ensureKeyframes`.
 */
export function deferStyleSheetWrite(write: () => void): void {
    if (_styleSheetWritten) {
        write();

        return;
    }

    _deferredStyleSheetWrites.push(write);
}

/**
 * Marks the stylesheet as written and runs every queued load-time write, in
 * registration order. Called at the start of every real write; a no-op after
 * the first call. Exported for the node test setup only.
 *
 * @internal
 */
export function _flushDeferredStyleSheetWrites(): void {
    if (_styleSheetWritten) {
        return;
    }

    // Set before running: a queued write that materialises a rule re-enters
    // `_ruleFor`, and one that queues a further write must run it in place.
    _styleSheetWritten = true;

    for (const write of _deferredStyleSheetWrites.splice(0)) {
        write();
    }
}
```

`_ruleFor` runs the queue after its cache check, then checks the cache again, because a queued write may have just materialised this same selector:

```typescript
function _ruleFor(selector: string): CSSStyleRule {
    const cached = _ruleCache.get(selector);

    if (cached) {
        return cached;
    }

    // The first real write runs every queued load-time write ahead of itself.
    _flushDeferredStyleSheetWrites();

    const flushed = _ruleCache.get(selector);

    if (flushed) {
        return flushed;
    }

    const rule = DOM.sink.ensureStyleRule(selector);
    _ruleCache.set(selector, rule);

    return rule;
}
```

`StyleRule.ensureKeyframes` calls `_flushDeferredStyleSheetWrites()` as its first statement, before `DOM.sink.ensureKeyframes(name, body)`.

Each load-time site changes shape as shown below. The body of each block moves verbatim, with no statements reordered:

```typescript
// Before                                    // After
(() => {                                     deferStyleSheetWrite(() => {
    new StyleRule({ … });                        new StyleRule({ … });
})();                                        });

StyleRule.ensureKeyframes(                   deferStyleSheetWrite(() => {
    NAME,                                        StyleRule.ensureKeyframes(
    "…"                                              NAME,
);                                                   "…"
                                                 );
                                             });
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/core/StyleTarget.ts`**
   - Add `_deferredStyleSheetWrites`, `_styleSheetWritten`, `deferStyleSheetWrite` and `_flushDeferredStyleSheetWrites` below `_ruleCache` (line 188), exactly as in *Internal Structure*.
   - Change `_ruleFor` (line 207) as shown there.
   - Make `_flushDeferredStyleSheetWrites();` the first statement of `StyleRule.ensureKeyframes` (line 423).
   - In `ensureKeyframes`'s JSDoc (lines 419–420), replace "Idempotent: safe to call from module-level initialisers across hot reloads." with "Idempotent: a repeat call for an existing name is a no-op, including across hot reloads." That JSDoc is public, so it must not `{@link}` `deferStyleSheetWrite`.
   - Do **not** add either new function to `core/index.ts`.
   - Check: `npm run typecheck` passes.

2. **`packages/lib/tests/setup/node-setup.ts`**
   - Add `import { _flushDeferredStyleSheetWrites } from '~/core/StyleTarget';`.
   - Call `_flushDeferredStyleSheetWrites();` inside the top-level `if (isNodeEnv)` block, directly after `installTestDOM(BASELINE_CONFIG);` (line 36).
   - Rewrite the comment above that block (lines 30–34). It should say that the top-level install is still needed because `core/Body.ts` renders its singleton at import. It should also say that the flush marks the stylesheet as written, so modules' load-time writes run at import into this baseline sink as they did before they were deferred, and each test's own recording sink stays free of them. Finally, it should say that the deferral itself is covered by fresh-module-graph tests.

3. **`packages/lib/tests/core/StyleTarget.test.ts`**
   - Add `describe('deferStyleSheetWrite', …)` covering E1–E7 of *Expected Behaviour*.
   - Each case starts a fresh graph through a local helper, documented with JSDoc. The helper calls `vi.resetModules()`, then `const { installTestDOM } = await import('../dom/TestDOM')`, then `const sink = installTestDOM(CONFIG)`, then `await import('~/core/StyleTarget')`. Import and install `TestDOM` before anything else from the fresh graph, so no fresh module is evaluated against the production seams.
   - Add `vi` to the vitest import. Add a `CONFIG` constant shaped like the one in `tests/component/input/focusRing.test.ts:12` (it needs `fontMetrics` from `'../dom/font-metrics.test-font.json'`).
   - Read order from `sink.writes`, filtered to `op === 'ensureStyleRule' || op === 'ensureKeyframes'`.
   - Check: `npx vitest run tests/core/StyleTarget.test.ts` passes.

4. **`packages/lib/src/typescript/lib/component/input/focusRing.ts`**
   - Change the import to `import { StyleRule, deferStyleSheetWrite } from "~/core/StyleTarget.js";`.
   - In `registerFocusWithinRing`, keep the selector computation outside and wrap the `new StyleRule({...})` (lines 44–48) in `deferStyleSheetWrite(() => { … });`.
   - In `registerFocusVisibleRing`, compute `bases`, `bareSelector` and `afterSelector` first. Then put both `new StyleRule` calls in one `deferStyleSheetWrite(() => { … });`, bare rule first and `::after` rule second, which is the current order.
   - Add one sentence to each helper's JSDoc description: the rules are queued through `deferStyleSheetWrite` and written just before the library's first stylesheet write, so calling the helper from a module's top level touches no DOM.
   - Leave all ten call sites untouched.
   - Check: `npx vitest run tests/component/input/focusRing.test.ts` still passes, because step 2 marks the sheet written.

5. **`packages/lib/tests/component/input/focusRing.test.ts`**
   - Add `describe('focus-ring deferral', …)` covering F1 and F2, using the same fresh-graph helper shape as step 3.
   - F2 imports `'~/component/button/Button'` from the fresh graph, constructs `new Button({ text: 'x' })`, calls `getElement(true)`, then `dispose()`s it.
   - Add `vi` to the vitest import.

6. **Module-level rule blocks: nine files under `packages/lib/src/typescript/lib/`.** In each, add `deferStyleSheetWrite` to the existing `import { StyleRule } from "~/core/StyleTarget.js";` line. Replace the opening `(() => {` with `deferStyleSheetWrite(() => {` and the closing `})();` with `});`. Move nothing inside the block:
   - `component/input/TextInput.ts` lines 29 / 38
   - `component/input/TextArea.ts` lines 18 / 20
   - `component/input/Link.ts` lines 37 / 47. The nested `registerFocusVisibleRing(".Link")` stays inside the block.[^nested]
   - `component/input/PickerColumn.ts` lines 25 / 68
   - `component/input/AbstractCalendarDropdown.ts` lines 88 / 142
   - `component/input/ComboBox.ts` lines 393 / 427
   - `component/input/AutoCompleteDropdown.ts` lines 43 / 51
   - `component/input/NumberSpinner.ts` lines 27 / 35
   - `component/list/AbstractSelectableList.ts` lines 198 / 309. Also change "registered once at module init" in its JSDoc (line 181) to "queued once at module init and written just before the library's first stylesheet write".

7. **Module-level keyframes: four files.** Add `deferStyleSheetWrite` to the `StyleTarget.js` import and wrap the call in the block form from *Internal Structure*:
   - `component/display/ProgressSpinner.ts` line 18
   - `component/display/ProgressBar.ts` line 8
   - `component/button/TabButton.ts` line 42
   - `component/editor/theme.ts` line 43

   Check: `grep -rnE "^(new StyleRule|StyleRule\.ensureKeyframes|\(\(\) => \{)" packages/lib/src/typescript/lib --include=*.ts` prints nothing. `grep -rn "deferStyleSheetWrite(() =>" packages/lib/src/typescript/lib --include=*.ts | wc -l` prints `15` (2 in `focusRing.ts`, 9 blocks, 4 keyframes).

8. **Diagnostics barrel imports.** Replace `import { Container } from "../core";` with `import { Container } from "~/core/Container.js";` in:
   - `diagnostics/DiagnosticsOverlay.ts` line 13
   - `diagnostics/StyleAuditOverlay.ts` line 7
   - `diagnostics/StyleAuditView.ts` line 13

   Leave `StyleAuditView.ts`'s `import { UNBOUNDED } from "../primitive";` alone. Check: `grep -rn 'from "../core"' packages/lib/src/typescript/lib` prints nothing.

9. **Create `packages/lib/tests/unit/import-without-dom.test.ts`** covering G1–G3:
   - `import packageJson from '../../package.json';`.
   - `const ENTRY_KEYS = Object.keys(packageJson.exports).filter((key) => !key.includes('*'));`
   - `KNOWN_IMPORT_TIME_DOM: ReadonlySet<string> = new Set(['./core'])`, with a comment naming `core/Body.ts`'s static `INSTANCE` and saying the entry comes out once `Body` stops rendering at import.
   - A JSDoc'd `sourceSpecifier(exportKey)` returning `'~' + exportKey.slice(1) + '/index'`: `./core` → `~/core/index`, `./component/editor` → `~/component/editor/index`, `./glyphs/solid` → `~/glyphs/solid/index`.
   - `ENTRY_IMPORT_TIMEOUT_MS = 30_000`, commented with what it is and why.[^timeout]
   - The cases: `it.each(ENTRY_KEYS)('%s', async (exportKey) => { … }, ENTRY_IMPORT_TIMEOUT_MS)`. Each one calls `vi.resetModules()`. Then `const { DOM, ProductionDOMSink } = await import('~/core/DOM')` and `expect(DOM.sink).toBeInstanceOf(ProductionDOMSink)`. Then `const load = import(/* @vite-ignore */ sourceSpecifier(exportKey))`. Then either `await expect(load).rejects.toThrow(/document is not defined/)` for a key in the exception set, or `await expect(load).resolves.toBeDefined()`.
   - Check: `npx vitest run tests/unit/import-without-dom.test.ts` reports 24 passing cases (G1 plus 23 entries).

10. **`ARCHITECTURE.md`**
    - Under *CSS writes go through `StyleRule` / `InlineStyle`* (lines 254–261), replace the "For a module-level shared class rule, the canonical pattern is:" snippet with the `deferStyleSheetWrite(() => { new StyleRule({ scope: "class", name: "Foo", styles: { … } }); });` form. Follow it with one sentence: the write is held until the library's first real stylesheet write and runs just ahead of it, so importing the module touches no DOM and the rule keeps the position an eager write would have had.
    - Under *Defer DOM work to render time* (bullets start at line 311), add a first bullet, **Module load**. It says a module's top-level code never calls `new StyleRule(...)`, `StyleRule.ensureKeyframes(...)` or a `DOM.sink` write directly, and registers such a write through `deferStyleSheetWrite(() => …)` (`core/StyleTarget.ts`). It names `tests/unit/import-without-dom.test.ts` as the guard and `core/Body.ts`'s singleton as the one recorded exception.
    - In the *Module-level shared class rules* bullet (line 313), add "called on first use from the owning class, never from the module's top level" after `ensureXClassRule()`.

11. **`packages/lib/docs/reference/changelog/next.md`**: append an entry at the end of `## Fixed` → `### Core` (just before `### Components` at line 493), in the style of its neighbours. It says:
    - Importing the library no longer touches the DOM, so every entry point except `core` loads without one (a Vitest `node` suite, a build-time script).
    - Seven controls' focus rings and a dozen modules' shared rules and `@keyframes` used to be written the moment their module was evaluated. As a result, `import { registerLanguage } from '@jimka/typescript-ui/component/editor'` threw `ReferenceError: document is not defined`.
    - Those writes now wait for the library's first stylesheet write (normally the first render) and run just ahead of it, so every rule keeps its position and nothing renders differently.
    - `core` still creates the page's `Body` when it loads.
    - No consumer action is needed.

12. **Full verification**: run everything under *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/StyleTarget.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/focusRing.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TextInput.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TextArea.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Link.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/PickerColumn.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AutoCompleteDropdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/ProgressBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/theme.ts` |
| Modify | `packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts` |
| Modify | `packages/lib/src/typescript/lib/diagnostics/StyleAuditOverlay.ts` |
| Modify | `packages/lib/src/typescript/lib/diagnostics/StyleAuditView.ts` |
| Modify | `packages/lib/tests/setup/node-setup.ts` |
| Modify | `packages/lib/tests/core/StyleTarget.test.ts` |
| Modify | `packages/lib/tests/component/input/focusRing.test.ts` |
| Create | `packages/lib/tests/unit/import-without-dom.test.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

The helpers' call sites in `Button.ts`, `Checkbox.ts`, `ComboBox.ts:35`, `RadioButton.ts`, `Toggle.ts`, `Slider.ts`, `NumberSpinner.ts:22`, `AbstractPickerField.ts` and `AutoCompleteField.ts` do not change.

---

## Expected Behaviour

**Queue (unit, `tests/core/StyleTarget.test.ts`, fresh module graph per case):**

- **E1.** Nothing is written while nothing has been written. After `deferStyleSheetWrite` queues a rule `.A` and a keyframes `k`, the sink records no `ensureStyleRule` or `ensureKeyframes`.
- **E2.** The first rule materialisation runs the queue first, in order. Queue `.A`, keyframes `k`, `.B`, then construct `new StyleRule({ scope: 'selector', name: '.Trigger', styles: { color: 'green' } })`. The recorded order is `.A`, `k`, `.B`, `.Trigger`.
- **E3.** `StyleRule.ensureKeyframes` also counts as a first write. Queue `.A`, then call `StyleRule.ensureKeyframes('k2', 'from {} to {}')`. The recorded order is `.A`, `k2`.
- **E4.** After the first write, `deferStyleSheetWrite(() => { new StyleRule({ …'.C'… }); })` records `ensureStyleRule('.C')` before it returns.
- **E5.** Each queued write runs once. A second materialisation (`.Trigger2`) records no second `ensureStyleRule('.A')`.
- **E6.** A queued write for the trigger's own selector writes its declarations first. Queue `.Same { color: 'red' }`, then construct `.Same { backgroundColor: 'blue' }`. The sink records `ensureStyleRule('.Same')` exactly once and `setRuleStyles` keys in the order `color`, then `backgroundColor`.
- **E7.** A write queued from inside a queued write runs in place. The queued write materialises `.Outer`, calls `deferStyleSheetWrite` for `.Inner`, then materialises `.Outer2`. A trigger records `.Outer`, `.Inner`, `.Outer2`, `.Trigger`.

**Focus ring (unit, `tests/component/input/focusRing.test.ts`, fresh module graph per case):**

- **F1.** `registerFocusVisibleRing('.Deferred')` and `registerFocusWithinRing('.DeferredWithin')` record no ring selector. After a trigger rule, the three ring selectors (`.Deferred:focus-visible, .Deferred[data-ts-ui-focus-visible]`, its `::after` form, and `.DeferredWithin:focus-within::after`) all appear before `.Trigger`.
- **F2.** A `Button`'s first render records both `.Button` ring selectors before each of `.Button.pressed`, `.ts-ui-component.undisplayed`, `:where(.ts-ui-component)` and `.Button`. The test asserts relative indices only.
- The existing seven focus-ring cases pass unchanged.

**Entry points (unit, `tests/unit/import-without-dom.test.ts`):**

- **G1.** `typeof document` is `'undefined'`, so the file really runs without a DOM.
- **G2.** Every non-wildcard `exports` key except `./core` imports in a fresh graph whose `DOM.sink` is a `ProductionDOMSink`. That is 22 keys, `./component/editor` among them.
- **G3.** `./core` rejects with `document is not defined`.

**Manual (not automatable):**

- **M1.** In `npm run dev` (port 8015), Tab onto a `Button`, `ComboBox`, `Checkbox`, `RadioButton`, `Toggle`, `Slider` and `Link`. Then move with `Ctrl+Alt`+arrow. The inset ring looks exactly as it does on `master`, including Button's transparent border and the Checkbox/RadioButton/Toggle separator shadow.
- **M2.** On `master` and on the branch, after the same clicks, run this in the DevTools console: `Array.from(document.getElementById('Base').sheet.cssRules, (r) => r.selectorText ?? '@keyframes ' + r.name).filter((s) => !s.startsWith('#'))`. The two lists are identical (`#id` rules carry random ids, hence the filter).
- **M3.** After merge, and after `npm run build:lib` in the main tree, run `npm test` in `/home/jika/typescript/loom`. Use it read-only. The suite passes, including `tests/languages.test.ts`.

---

## Verification

- `npm run typecheck`, `npm test` (it runs `typecheck:test` and then Vitest; the whole suite passes), `npm run lint`.
- `npm run docs:api` finishes with zero warnings (the `ensureKeyframes` JSDoc changed).
- The grep checks in steps 7 and 8, plus `grep -n "deferStyleSheetWrite\|_flushDeferred" packages/lib/src/typescript/lib/core/index.ts`, which prints nothing.
- The manual checks M1–M3.

---

## Documentation Impact

- `ARCHITECTURE.md`: the canonical module-level rule snippet and the *Defer DOM work to render time* rules (step 10). The old snippet taught the exact pattern that caused the defect.
- `packages/lib/docs/reference/changelog/next.md`: a `## Fixed` → `### Core` entry (step 11).
- `StyleRule.ensureKeyframes` public JSDoc (step 1).
- No public symbol is added, renamed or removed, so API pages, sidebar entries and `llms.txt` are unaffected.

---

## Potential Challenges

- **Reordering inside a queued block changes the cascade.** `AbstractSelectableList`'s block relies on its own statement order (its comment at line 275). Move every block body verbatim.
- **Flushing from anywhere other than `_ruleFor` / `ensureKeyframes` breaks the order guarantee.** `Component.init` writes trait rules ([`core/Component.ts:8129`](packages/lib/src/typescript/lib/core/Component.ts#L8129)) before `applyStyle` writes the framework rule ([line 8138](packages/lib/src/typescript/lib/core/Component.ts#L8138)), so hooking `ensureFrameworkStyleRule` would miss the true first write.[^trigger-point]
- **Modules reachable only through the `core` barrel are shielded from the guard** while `./core` sits in its exception set. The ARCHITECTURE.md rule covers them until `Body` is fixed.
- **A cold import of the glyph barrel is slow.** The per-case timeout covers it.[^timeout]
- **Loom reads the main tree's `packages/lib/dist`** through its `node_modules` symlink, so M3 can only run after merge and `build:lib` in the main tree.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/StyleTarget.ts`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L188): `_ruleCache`, `_ruleFor`, `ensureKeyframes`, and the `_ruleCacheHas` test-only export precedent (line 237).
- [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts:192`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L192): `ensureFrameworkStyleRule`, the materialise-on-first-need precedent.
- [`packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts:29`](packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts#L29): the `ensureXClassRule()` singleton that ARCHITECTURE.md names.
- [`packages/lib/src/typescript/lib/component/input/focusRing.ts`](packages/lib/src/typescript/lib/component/input/focusRing.ts#L38) and [`Link.ts:37`](packages/lib/src/typescript/lib/component/input/Link.ts#L37) (the nested case).
- [`packages/lib/tests/setup/node-setup.ts`](packages/lib/tests/setup/node-setup.ts#L30), and [`packages/lib/tests/dom/fonts-ready.test.ts:141`](packages/lib/tests/dom/fonts-ready.test.ts#L141) (the fresh-graph precedent).
- [`packages/lib/src/typescript/lib/core/Body.ts:47`](packages/lib/src/typescript/lib/core/Body.ts#L47): the recorded exception.
- `packages/lib/package.json` `exports`: the guard's entry list.
- `ARCHITECTURE.md`, lines 242–265 and 307–316.

---

## Non-Goals

- **Making `Body` lazy.** Its static initializer renders the page body and applies the default theme at import. Changing that is a theme and font-timing decision that needs its own plan.[^body]
- **Moving `Glyph`'s module-level `matchMedia` registration or the sentinel `Component`s.** Neither writes the stylesheet or can throw without a DOM.[^glyph][^sentinels]
- **Publishing `deferStyleSheetWrite`.**[^export-policy]
- **A lint rule against top-level stylesheet writes.** The entry-point guard catches them where consumers feel them.
- **Changing where module-level class rules sit relative to their ancestors' class-tier rules.** `.Link` currently precedes `.Text`, and `.TextArea` precedes `.TextInput`. The plan keeps today's order exactly, and none of these pairs declares a common property.
- **The `../primitive` barrel import in `StyleAuditView.ts`.** `primitive` imports cleanly.

---

## Notes

[^defect]: Measured while drafting with a probe test that ran in Vitest's `node` environment. For each public entry it called `vi.resetModules()`, dynamically imported the barrel, and first either kept the production seams or installed a proxy that recorded every seam call with its stack. With production seams, 14 of 23 entries threw `document is not defined`: `core`, `overlay`, `layout`, `diagnostics`, `component/input`, `button`, `display`, `editor`, `list`, `container`, `menubar`, `table`, `tree` and `diagram`. `primitive`, `data`, `validation`, `router`, `component/chart` and the four glyph barrels loaded. The recorded calls gave the full site list in *Scope*. A static grep for top-level `new StyleRule`, `StyleRule.ensureKeyframes`, `registerFocus*Ring`, IIFEs and `static … = new` found nothing more. With the recording proxy, third-party code (CodeMirror, Lexical) loaded cleanly under bare `node`, because it guards its own `document`/`navigator` reads. The library's own writes are the whole problem.

[^trigger-point]: `_ruleFor` is the one path every rule materialisation takes, and `ensureKeyframes` is the one path to a `@keyframes` insertion, so together they see the true first write whatever it is. That write is not always the framework rule. `Component.init` resolves class traits (`core/Component.ts:8129`), which writes the trait rule, before `applyStyle` (`:8138`) reaches `ensureFrameworkStyleRule`, and `core/Body.ts`'s import-time render writes first of all in any app that imports `core`. Other writes go elsewhere and do not count. `ThemeManager.setTheme`'s `@font-face` goes into its own `<style>` element and inline styles go onto elements, so neither touches the shared sheet.

[^order-proof]: Today a load-time write happens during module evaluation. In any one app the only stylesheet writes that can precede it are other load-time writes and `Body`'s import-time render. With the queue there are two cases. A load-time write registered before the first real write runs, in registration order, at the start of that write, which puts it before the write and after every earlier load-time write, its position today. A load-time write registered after the first real write runs at registration, which is its moment today. So the rule order is unchanged, and so is each tie decided by order. A consumer's own eager module-level `StyleRule` is also unaffected: the library's modules are evaluated before the consumer module that imports them, so their queued writes run first, which is also today's order. A throwaway prototype of exactly these steps confirmed this. A scenario that imports the `input`, `button`, `list`, `table`, `editor` and `display` entries, then renders twelve controls, recorded 105 stylesheet writes, and the list was identical with and without deferral apart from the random `#id` selectors.

[^precedent]: `ensureFrameworkStyleRule` ([`core/ClassStyleRules.ts:192–203`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L192)) materialises the framework rule behind a once-flag the first time a render needs it. The `ensureXClassRule()` singletons (`SortPriorityBadge.ts:29`, called from its constructor at `:87`; likewise `ResizeHandle`, `CollapseButton`, `AccordionIndicator`, `FilterClauseBadge`) do the same per class, and ARCHITECTURE.md's *Defer DOM work to render time* names them the correct path for shared class rules. `StyleRuleSpec.materialize: false` (`StyleTarget.ts:168–182`) is the same idea per rule: buffer until `ensure()`. The queue carries that idea up one level, from a single rule to the sheet. The one deviation is the trigger; the footnote on the rejected constructor-time alternative explains why the owner's first use cannot serve.

[^constructor-alternative]: Rejected: call an `ensureXRing()` / `ensureXClassRule()` singleton from each owning class's constructor, the pattern `SortPriorityBadge` uses. That keeps a ring ahead of its *own* class's render-time rules, but not ahead of rules other classes write earlier. In the measured scenario a `TextField` renders before the first `ComboBox` is constructed, so the input-chrome trait (position 61) would land before `.ComboBox:focus-visible`, and the ring would start winning their (0,2,0) tie. The same goes for any consumer `StyleTrait` placed on a Button. It would also move the four module-level class rules that share a selector with the class tier (`.Link`, `.ComboBox`, `.TextArea`, `.SelectableListRow`) relative to their ancestors' rules. And it would relocate ten helper calls and nine blocks into constructors. Correctness would then rest on "no property collides today", which is luck rather than construction.

[^helper-verified]: `focusRing.ts` is the only code that constructs the ring rules, and it builds them from its arguments alone, so queuing inside the helper makes every caller DOM-free with no caller edits. The prototype confirmed this: with the helper changed and the callers untouched, every entry except `core` imported cleanly. Deferring at the ten call sites instead would repeat the same wrapper ten times.

[^diagnostics-barrel]: These three files are the library's only relative imports of the `core` barrel (`"../core"`). Every other module imports `~/core/<Module>.js`. Through the barrel, `diagnostics` evaluates `core/Body.ts` and inherits its import-time render. With the direct import, the prototype's `diagnostics` entry loaded cleanly. `Container` is used as a value in all three, so the import stays a value import.

[^body]: `core/Body.ts:47` declares `private static readonly INSTANCE: Body = new Body();`, so evaluating the module constructs and renders the page body. `init()` reads `document.body`, sizes it to the viewport and adds the resize listener. The constructor then calls `ThemeManager.setTheme(ModernTheme)` (`:190`), which writes the theme's CSS variables onto `<html>`, injects the `@font-face` `<style>`, starts the font download and holds the first layout. Making the singleton lazy is a behaviour decision, not a mechanical deferral. An app that calls `ThemeManager.setTheme(DarkTheme)` before `Body.init(...)` would have its theme overwritten by a lazily constructed `Body` unless the constructor stops applying `ModernTheme` unconditionally. The font download, deliberately started as early as possible (`tests/dom/fonts-ready.test.ts`, "starts the download when the rules are installed, not at first paint"), would also start later. Nor is it on the defect's path: once the diagnostics import is fixed, only the `core` entry reaches `core/Body.ts`, and Loom's tested modules import `component/editor` and single glyph modules only.

[^glyph]: `component/display/Glyph.ts:121` registers a reduced-motion change listener through `DOM.source.matchMedia`. The production implementation (`core/DOM.ts:2580`) returns an inert result when `matchMedia` is missing, and the call writes nothing to the stylesheet. It can neither throw without a DOM nor affect stylesheet order, so moving it would change nothing a consumer can observe.

[^sentinels]: Each of these modules constructs one otherwise-unused `Component` at load, used as the owner for its viewport listeners. `Component` construction is JS-only by design. The one seam call it makes is `DOM.source.escapeSelector`, which is a pure string function in production (`core/DOM.ts:2197`). The recording probe saw nothing else from these four.

[^harness]: Without the flush, a node-environment test file's shared load-time rules would land in the recording sink of whichever test first renders, not in the baseline. The prototype showed the fallout. All seven `focusRing.test.ts` cases failed, because the helper's writes waited in the queue. `ComponentDispose.test.ts`'s leak check saw six ring selectors as "new". And `Link.test.ts`'s "dispatches a caller styleRules entry without adding an instance underline" failed when run alone (`-t`) and passed in the full file only because an earlier case happened to render first. With the flush, the prototype's full suite passed unchanged (474 files). The only thing the flush skips is the deferral itself, which E1–E7 and F1–F2 cover in fresh graphs, and suites under the `jsdom` pragma (where the setup is a no-op) run with deferral live.

[^guard-design]: `vi.resetModules()` clears the module registry for later imports, so the next `import('~/core/DOM')` evaluates a new copy whose `sink`/`source` are the production classes. The setup file's modelled DOM stays on the old copy. The prototype confirmed that `DOM.sink` was a `ProductionDOMSink` there, and that with the helper change reverted the guard failed on 11 entries, `./component/editor` among them. Deriving the list from `package.json` means a new entry point is checked automatically. The wildcard keys (`./glyphs/*`, `./glyphs/solid/*`) are covered by the three glyph barrels, which re-export every glyph module. A separate Vitest project without `setupFiles` would do the same job at the cost of a config change. Importing the built `dist` from a child `node` process would need a build inside the test run. Asserting that `./core` still rejects follows the ESLint baseline convention in ARCHITECTURE.md ("Baseline entries come out as sites are fixed and none should go in").

[^timeout]: Vitest's default per-test timeout is 5 s. A cold import of `./glyphs` transforms about 2,860 glyph modules (2,000 solid, 273 regular, 587 brands) and measured 5.8 s while drafting. Every other entry took under 0.7 s. 30 s leaves headroom on a slower CI machine. A derived value isn't possible, because transform time depends on the machine and the cache.

[^export-policy]: `registerFocusVisibleRing` and `registerFocusWithinRing` are exported from `focusRing.ts` only so their sibling modules can import them. No `index.ts` re-exports them, and neither `llms.txt` nor the docs mention them, so they are already outside the public API and their signatures do not change. `deferStyleSheetWrite` could be useful to a consumer writing its own module-level rules, but no consumer needs it, so under the pre-1.0 rule it stays out of `core/index.ts`, as `disposeStyleRule` does.

[^nested]: Link's block constructs `.Link` and then calls `registerFocusVisibleRing(".Link")`. When the queue runs, `_styleSheetWritten` is already `true`, so the helper's inner `deferStyleSheetWrite` runs in place, directly after `.Link`, which is today's order (sheet positions 1–3 in the table). E7 pins this.
