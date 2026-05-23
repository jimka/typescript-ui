# StyleRule Constructor Redesign — Implementation Plan

## Overview

Today every shared / component / selector-scoped `StyleRule` is constructed through the same five-line factory dance:

```typescript
const rule = new StyleRule(() =>
    (CSS.getClassRule(name) ?? CSS.createClassRule(name)) as CSSStyleRule);
```

The `CSS` namespace at [core/CSS.ts](../src/typescript/lib/core/CSS.ts) holds Community 54 in the knowledge graph (9 nodes: `createClassRule`, `createComponentRule`, `createRule`, `ensureKeyframes`, `getClassRule`, `getComponentRule`, `getMainStyle`, `getRule`, `setRootVariables` — `graphify-out/GRAPH_REPORT.md:320`). The factory-pair shape (`getX ?? createX`) is repeated verbatim at 19 module-level sites today; the cast to `CSSStyleRule` and the parenthesised `??` are pure boilerplate. The previous plan [`plans/implemented/migrate-rule-style-to-stylerule.md`](implemented/migrate-rule-style-to-stylerule.md) introduced the pattern; this is its follow-up, collapsing the call sites onto a scoped constructor.

This plan redesigns [`StyleRule`](../src/typescript/lib/core/StyleTarget.ts#L128) so callers write `new StyleRule({ scope: "class", name: "Foo" })` and the class itself owns the get-or-create handshake. The `CSS` utility namespace is then deleted. `ensureKeyframes` moves to `StyleRule.ensureKeyframes` as a static method (it inserts an `@keyframes` at-rule into the framework's shared `<style id="Base">` stylesheet — naturally clusters with `StyleRule`). `setRootVariables` does not migrate as a static: the existing [`InlineStyle`](../src/typescript/lib/core/StyleTarget.ts#L155) class already covers it — `document.documentElement` is an `HTMLElement`, and `InlineStyle extends StyleTarget<HTMLElement>` is exactly the shape needed. Its lone caller, [Theme.ts:1034](../src/typescript/lib/core/Theme.ts#L1034), is rewritten to use `InlineStyle` directly. Generated CSS is byte-identical, caching semantics are preserved (the existing `ruleCache` `Map` migrates into the `StyleRule` module), and keyframe handling stays idempotent.

Three raw `.style.setProperty(...)` writes still sit at [AutoCompleteItem.ts:49](../src/typescript/lib/component/input/AutoCompleteItem.ts#L49), [MenuBarButton.ts:84](../src/typescript/lib/component/menubar/MenuBarButton.ts#L84), and [Header.ts:117](../src/typescript/lib/component/table/cell/Header.ts#L117) — leftovers from the prior migration. They use `CSS.createComponentRule(this.getId() + suffix)` and then write `.style.setProperty(...)` directly. The new constructor would funnel them through the same `setMany` / `set` path, eliminating those three sites in lockstep with the rename.

---

## Architecture Decisions

### Constructor takes a discriminated config, not a factory

The constructor signature becomes:

```typescript
type StyleRuleScope =
    | { scope: "class";     name: string }   // ".Name"
    | { scope: "component"; name: string }   // "#name"
    | { scope: "selector";  name: string };  // verbatim — "#id:hover", ".Foo:active", ".X::-webkit-scrollbar", ".A.B"

new StyleRule(spec: StyleRuleScope);
```

`scope: "class"` covers every `CSS.createClassRule(...)` site (18 call sites including `SortPriorityBadge`, `ResizeHandle`, `AccordionIndicator`, the 8 `DateTimePickerDropdown` rules, the 8 `TimePickerDropdown` rules, the 5 `DatePickerDropdown` rules, 3 `PickerButton` IIFEs, `Glyph` ×3, `Header` `HeaderCellGlyph`, `ComboBox` ×4).

`scope: "component"` covers every `CSS.createComponentRule(...)` site — Component's own `_styleRule`, `createStyleRule` (`#id + suffix`), `AutoCompleteItem`'s `:hover`, `MenuBarButton`'s `:hover`, `Header`'s `:active`.

`scope: "selector"` covers the verbatim selector cases: `.DateTimePickerDay:hover`, `.ComboBoxRow:hover`, `.DatePickerDay:hover`, `.TimePickerCell:hover`, `.TimePickerCellList::-webkit-scrollbar`, and AccordionHeader's `.ts-accordion-indicator.expanded` (if/when that selector exists post the prior plan — currently it lives under `AccordionIndicator` via `createStyleRule(".expanded")` which is `component` scope with the `.expanded` suffix).

Three scopes is the actual set the codebase needs — no `tag` scope (no `CSS.createRule("button")` calls exist), no `id` scope distinct from `component` (the `#` prefix is the marker), no `pseudo` scope distinct from `selector`. The three-arm union is the minimum needed; a single `selector: string` arm would force every site to spell the leading `.` / `#` itself, defeating the point of the redesign.

### Get-or-create is the constructor's job

Today's factory pattern is `getX ?? createX` because:
- For `class` / `selector` scopes: the same rule name may be registered by multiple modules (hot reload, multiple `PickerButton` IIFEs, ResizeHandle imported into two cells), so the call site must tolerate "already created."
- For `component` scope: ids are unique per `Component` instance, so `createX` always succeeds and `getX` is unused.

The constructor folds both shapes:

```typescript
constructor(spec: StyleRuleScope) {
    super();
    const selector = StyleRule.selectorOf(spec);
    this._factory = () =>
        StyleRule.getCSSRule(selector) ?? StyleRule.createCSSRule(selector);
}
```

For `component` scope this means `getRule("#myid")` runs once and returns `null`, then `createRule("#myid")` succeeds — one extra cache-miss `Map.get` on first render. Cost is negligible and the uniform shape makes the constructor smaller.

### Cache & DOM helpers move into the `StyleRule` module as private statics

The `ruleCache: Map<string, CSSStyleRule>` and the `getMainStyle()` / `getRule()` / `createRule()` logic move to `core/StyleTarget.ts` as **private** module-level helpers — they are implementation detail of the `StyleRule` factory and have no other consumer once the `CSS` namespace is dismantled. The single `<style id="Base">` insertion remains identical (same stylesheet, same `insertRule(..., cssRules.length)` position).

`StyleRule.getCSSRule(selector)` and `StyleRule.createCSSRule(selector)` are **private static** methods. The two operate over the same module-level `ruleCache`. No callers outside this module ever need them — the constructor is the only seam.

### `ensureKeyframes` becomes a `StyleRule` static; `setRootVariables` is replaced by `InlineStyle` at the Theme call site

The two `CSS` free functions are unrelated to selector-keyed rules — and unrelated to each other. They split cleanly:

- `ensureKeyframes` writes an `@keyframes` at-rule into the framework's shared `<style id="Base">` stylesheet. It needs the same `_getMainSheet()` private helper the redesigned `StyleRule` constructor uses. Promote it to `StyleRule.ensureKeyframes(name: string, body: string): void` — logic moves verbatim.

- `setRootVariables` writes CSS custom properties onto `document.documentElement.style`. That is exactly what [`InlineStyle`](../src/typescript/lib/core/StyleTarget.ts#L155) already does for any `HTMLElement` — and `document.documentElement` is an `HTMLElement`. **No new static is needed.** The lone caller in [Theme.ts:1034](../src/typescript/lib/core/Theme.ts#L1034) is rewritten as three lines against the existing `InlineStyle` API:

  ```typescript
  // Before:
  CSS.setRootVariables(themeToVars(theme));

  // After:
  const rootStyle = new InlineStyle();
  rootStyle.setMany(themeToVars(theme));
  rootStyle.attach(document.documentElement);
  ```

  This drops the special-case static from the public surface entirely, gains the full `StyleTarget` vocabulary at the call site (`setMany`, `queue`, `flush`, individual `setBackgroundColor`-style setters if ever needed), and removes one piece of infrastructure that was only there because the old `CSS.setRootVariables` predated `InlineStyle` having a clean enough API to use directly. Theme is the only caller today; spelling the three lines is honest about what's happening.

Co-locating `ensureKeyframes` with `StyleRule` and rewriting Theme on top of `InlineStyle` together remove the `CSS` module entirely. Callers (`Glyph`, `ProgressBar`, `ProgressSpinner`) import `StyleRule` for `ensureKeyframes`; `Theme` imports `InlineStyle`.

**Rejected alternatives:**
- *Keep a slim `CSS` namespace with only `ensureKeyframes` and `setRootVariables`.* The user's brief asked to "eliminate or shrink" — eliminating is cleaner.
- *Introduce a `RootStyle` singleton with a `.get()` accessor.* Earns its keep only if multiple modules write root variables independently or a singleton needs to accumulate state across writes. Today there is one caller (Theme) which overwrites the full var map every theme switch; the singleton wouldn't be doing any work the local `new InlineStyle()` doesn't already do.
- *Promote `setRootVariables` to a `StyleRule` static anyway.* Means a `StyleRule` static that doesn't operate on a `StyleRule` — same misalignment that motivated the redesign in the first place.

### No backwards-compat shim

The brief is explicit: rewrite call sites in lockstep, delete the helpers. `createClassRule`, `createComponentRule`, `createRule`, `getClassRule`, `getComponentRule`, `getRule`, `getMainStyle` all vanish. Each call site converts mechanically; the final state has zero `CSS.` references.

### Pre-existing `.style.setProperty` writes get migrated too

Three sites — [AutoCompleteItem.ts:48-52](../src/typescript/lib/component/input/AutoCompleteItem.ts#L48-L52), [MenuBarButton.ts:83-87](../src/typescript/lib/component/menubar/MenuBarButton.ts#L83-L87), [Header.ts:114-118](../src/typescript/lib/component/table/cell/Header.ts#L114-L118) — call `CSS.createComponentRule(...)` and then write `.style.setProperty(...)` directly. The prior plan missed these because it grepped `rule\.style\.` and they use other local names (`_hoverCSSRule`, `_hoverRule`, `activeRule`). With `CSS.createComponentRule` going away, these three sites must convert to `new StyleRule({ scope: "component", name: this.getId() + ":hover" })` + `setMany({ backgroundColor: "..." })`. This brings the codebase to **zero direct `CSSStyleRule.style.*` writes** — a strict superset of what the prior plan achieved.

### Component's two internal callers route through the new constructor

[Component.ts:205](../src/typescript/lib/core/Component.ts#L205) (the per-component `_styleRule`) and [Component.ts:424](../src/typescript/lib/core/Component.ts#L424) (`createStyleRule` builder) both use `CSS.createComponentRule(...)` inside a factory closure. Both convert mechanically:

```typescript
// Before:
private _styleRule: StyleRule = new StyleRule(() =>
    CSS.createComponentRule(this.getId()) as CSSStyleRule);

// After:
private _styleRule: StyleRule = new StyleRule({ scope: "component", name: this.getId() });
```

The lazy-capture of `this.getId()` matters: today it's wrapped in a closure that defers until `ensure()`. The new `name: this.getId()` is evaluated **at constructor time**, which is fine because `getId()` is a stable identity assigned in `Component`'s constructor before any field initialiser runs. Verify by reading `Component` constructor wiring before the change.

For `createStyleRule(selectorSuffix)` ([Component.ts:421-429](../src/typescript/lib/core/Component.ts#L421-L429)):

```typescript
// Before:
rule = new StyleRule(() =>
    CSS.createComponentRule(this.getId() + selectorSuffix) as CSSStyleRule);

// After:
rule = new StyleRule({ scope: "component", name: this.getId() + selectorSuffix });
```

Note `selectorSuffix` is "free-form" (`.expanded`, `:hover`, `:active`), so the resulting `#id.expanded` / `#id:hover` selectors fall under the `component` scope rule that prefixes a single `#`. The trailing suffix is just appended.

---

## Public API (TypeScript Signatures)

### `StyleRule` — new constructor + statics

```typescript
// src/typescript/lib/core/StyleTarget.ts

/**
 * Scope discriminator for the `StyleRule` constructor. `class` and `component`
 * are conveniences for the leading `.` / `#` prefixes; `selector` is the
 * escape hatch for everything else (pseudo-classes, compound selectors,
 * webkit-pseudo-elements).
 */
export type StyleRuleScope =
    | { scope: "class";     name: string }
    | { scope: "component"; name: string }
    | { scope: "selector";  name: string };

class StyleRule extends StyleTarget<CSSStyleRule> {
    constructor(spec: StyleRuleScope);

    /** Materialises the underlying `CSSStyleRule` on first access. */
    ensure(): CSSStyleRule;

    /** Idempotent @keyframes insertion into the shared Base stylesheet. */
    static ensureKeyframes(name: string, body: string): void;
}
```

Internal (private to the module, not exported):

```typescript
const _ruleCache: Map<string, CSSStyleRule> = new Map();

function _getMainSheet(): CSSStyleSheet;
function _selectorOf(spec: StyleRuleScope): string;
function _getCSSRule(selector: string): CSSStyleRule | null;
function _createCSSRule(selector: string): CSSStyleRule;
```

`_createCSSRule` returns the freshly-inserted rule (never `null`) — the old `CSS.createRule` returned `null` when the cache already held the name, but the new constructor calls `_getCSSRule` first and only falls through to `_createCSSRule` on cache miss. Two paths collapse into one.

### `CSS` namespace — deleted

```typescript
// src/typescript/lib/core/CSS.ts — DELETED entirely
```

All nine exports vanish. The 18 importing modules (count from `grep -rn "from \"~/core/CSS" src/typescript | wc -l`) lose their `CSS` import; most gain an `import { StyleRule } from "~/core/StyleTarget.js"` (most already have it, since they were using `new StyleRule(...)` alongside `CSS.createClassRule(...)`).

---

## Internal Structure

### Canonical migration of a `class`-scope rule

```typescript
// Before (SortPriorityBadge.ts:33-35):
const rule = new StyleRule(() =>
    (CSS.getClassRule("SortPriorityBadge")
        ?? CSS.createClassRule("SortPriorityBadge")) as CSSStyleRule);

// After:
const rule = new StyleRule({ scope: "class", name: "SortPriorityBadge" });
```

The `setMany({...})` + `ensure()` calls below remain identical.

### Canonical migration of a `component`-scope rule

```typescript
// Before (AutoCompleteItem.ts:48-52):
this._hoverCSSRule = CSS.createComponentRule(this.getId() + ":hover") as CSSStyleRule;
this._hoverCSSRule.style.setProperty(
    "background-color",
    "var(--ts-ui-autocomplete-item-hover-bg, rgba(30, 100, 200, 0.08))"
);

// After:
this._hoverCSSRule = new StyleRule({ scope: "component", name: this.getId() + ":hover" });
this._hoverCSSRule.set("backgroundColor",
    "var(--ts-ui-autocomplete-item-hover-bg, rgba(30, 100, 200, 0.08))");
this._hoverCSSRule.ensure();
```

The field type changes from `CSSStyleRule` to `StyleRule` (or `StyleRule | null` if currently nullable — verify in each file). Same for `MenuBarButton._hoverRule` and the local `activeRule` const in `Header.ts:114`.

### Canonical migration of a `selector`-scope rule

```typescript
// Before (ComboBox.ts:236-241):
const rowHover = new StyleRule(() =>
    (CSS.getRule(".ComboBoxRow:hover")
        ?? CSS.createRule(".ComboBoxRow:hover")) as CSSStyleRule);
rowHover.set("backgroundColor", "var(...)");
rowHover.ensure();

// After:
const rowHover = new StyleRule({ scope: "selector", name: ".ComboBoxRow:hover" });
rowHover.set("backgroundColor", "var(...)");
rowHover.ensure();
```

### Internal `_selectorOf` logic

```typescript
function _selectorOf(spec: StyleRuleScope): string {
    switch (spec.scope) {
        case "class":     return "." + spec.name;
        case "component": return "#" + spec.name;
        case "selector":  return spec.name;
    }
}
```

Three-arm match, exhaustive on the discriminant union — TypeScript flags any missed arm at compile time.

### Internal `_createCSSRule` returns non-null

```typescript
function _createCSSRule(selector: string): CSSStyleRule {
    const sheet = _getMainSheet();
    const idx = sheet.insertRule(selector + "{}", sheet.cssRules.length);
    const rule = sheet.cssRules[idx] as CSSStyleRule;
    _ruleCache.set(selector, rule);
    return rule;
}
```

The old `CSS.createRule`'s `null` return path is unreachable from the new constructor (`_getCSSRule` is checked first), so `_createCSSRule` can return non-null. The `ruleCache.has(name)` guard is dropped.

---

## Ordered Implementation Steps

Each step ends with a verification gate.

1. **Edit `core/StyleTarget.ts`** — add the `StyleRuleScope` type, replace the `StyleRule` constructor signature, add the private module-level `_ruleCache` / `_getMainSheet` / `_selectorOf` / `_getCSSRule` / `_createCSSRule` helpers, and add the public `ensureKeyframes` static. The existing factory-taking constructor is **removed entirely** — no overload. **Verify:** `npx tsc --noEmit` fails with errors at every existing `new StyleRule(() => ...)` call site (expected — those are the next steps).

2. **Edit `core/Component.ts`** — convert the two `new StyleRule(() => CSS.createComponentRule(...))` sites at lines 205 and 424 to the new `{ scope: "component", name: ... }` shape. **Verify:** lines 205 + 424 typecheck; `grep -n 'CSS\.' src/typescript/lib/core/Component.ts` → 0 matches.

3. **Edit each `class`-scope module-level rule registration** in lockstep:
   - `src/typescript/lib/component/table/cell/SortPriorityBadge.ts` (line ~33)
   - `src/typescript/lib/component/table/cell/ResizeHandle.ts` (line ~35)
   - `src/typescript/lib/component/table/cell/Header.ts` (line ~50 — `HeaderCellGlyph`)
   - `src/typescript/lib/component/container/AccordionIndicator.ts` (line ~32)
   - `src/typescript/lib/component/display/Glyph.ts` (lines ~75, ~82, ~89)
   - `src/typescript/lib/component/input/TimeField.ts` (line ~64)
   - `src/typescript/lib/component/input/DateField.ts` (line ~53)
   - `src/typescript/lib/component/input/DateTimeField.ts` (line ~64)
   - `src/typescript/lib/component/input/ComboBox.ts` (lines ~200, ~214, ~224, ~230)
   - `src/typescript/lib/component/input/DateTimePickerDropdown.ts` (lines ~25, ~35, ~44, ~55, ~65, ~83, ~93)

   Convert each `new StyleRule(() => (CSS.getClassRule(N) ?? CSS.createClassRule(N)) as CSSStyleRule)` to `new StyleRule({ scope: "class", name: N })`. Drop the now-unused `CSS` import from each file (TypeScript will surface unused imports — clean them as you go).

   **Verify per file:** `grep -n 'CSS\.' <file>` → 0 matches (or only lines that are unrelated comments).

4. **Edit each `selector`-scope rule registration** in lockstep:
   - `src/typescript/lib/component/input/ComboBox.ts` (line ~236 — `.ComboBoxRow:hover`)
   - `src/typescript/lib/component/input/DateTimePickerDropdown.ts` (line ~76 — `.DateTimePickerDay:hover`)

   Convert to `new StyleRule({ scope: "selector", name: ".X:hover" })`. **Verify per file:** the file's `grep -n 'CSS\.'` count is 0 after step 3 + step 4.

5. **Edit the IIFE-pattern files that still use the older `if (rule) { ... }` shape**:
   - `src/typescript/lib/component/input/DatePickerDropdown.ts` (lines 19-59 — 5 rules including a `.DatePickerDay:hover` selector rule)
   - `src/typescript/lib/component/input/TimePickerDropdown.ts` (lines 25-86 — 8 rules including `.TimePickerCellList::-webkit-scrollbar` and `.TimePickerCell:hover`)

   These files currently use the old `CSS.createClassRule(name); if (rule) { rule.style.setProperty(...) }` pattern (the prior plan listed them as future work). Each block becomes:

   ```typescript
   const grid = new StyleRule({ scope: "class", name: "DatePickerGrid" });
   grid.setMany({
       display:             "grid",
       gridTemplateColumns: "repeat(7, 1fr)",
       gap:                 "2px",
       width:               "100%",
   });
   grid.ensure();
   ```

   CamelCase the kebab-case property keys (`grid-template-columns` → `gridTemplateColumns`, `background-color` → `backgroundColor`, etc.) as the prior plan did.

   **Verify per file:** `grep -nE 'CSS\.|\.style\.setProperty' <file>` → 0 matches.

6. **Migrate the three leftover `.style.setProperty` sites that use `CSS.createComponentRule`**:
   - `src/typescript/lib/component/input/AutoCompleteItem.ts` lines 48-52: replace `this._hoverCSSRule = CSS.createComponentRule(this.getId() + ":hover") as CSSStyleRule; this._hoverCSSRule.style.setProperty("background-color", ...)` with `this._hoverCSSRule = new StyleRule({ scope: "component", name: this.getId() + ":hover" }); this._hoverCSSRule.set("backgroundColor", ...); this._hoverCSSRule.ensure();`. Change the field type from `CSSStyleRule` to `StyleRule` (find the field declaration; update its type annotation).
   - `src/typescript/lib/component/menubar/MenuBarButton.ts` lines 83-87: same shape; update `_hoverRule` field type.
   - `src/typescript/lib/component/table/cell/Header.ts` lines 114-118: the local `const activeRule = CSS.createComponentRule(this.getId() + ':active')` and its `if (activeRule)` guard collapse to `const activeRule = new StyleRule({ scope: "component", name: this.getId() + ":active" }); activeRule.set("boxShadow", "var(...)"); activeRule.ensure();` — no guard needed (the new constructor never returns null-equivalent).

   **Verify each file:** `grep -nE 'CSS\.|\.style\.setProperty' <file>` → 0 matches.

7. **Migrate `Glyph.ts` keyframes**: replace `CSS.ensureKeyframes(name, body)` with `StyleRule.ensureKeyframes(name, body)` (three call sites at [Glyph.ts:59,62,72](../src/typescript/lib/component/display/Glyph.ts#L59)). Drop the `CSS` import. **Verify:** `grep -n 'CSS\.' src/typescript/lib/component/display/Glyph.ts` → 0 matches.

8. **Migrate `ProgressBar.ts` / `ProgressSpinner.ts` keyframes**: replace `CSS.ensureKeyframes(...)` with `StyleRule.ensureKeyframes(...)` (one call site each). Drop the `CSS` import; add `StyleRule` import if missing. **Verify per file:** `grep -n 'CSS\.' <file>` → 0 matches.

9. **Migrate `Theme.ts` to use `InlineStyle` directly**: at [Theme.ts:1034](../src/typescript/lib/core/Theme.ts#L1034), replace `CSS.setRootVariables(themeToVars(theme))` with:
   ```typescript
   const rootStyle = new InlineStyle();
   rootStyle.setMany(themeToVars(theme));
   rootStyle.attach(document.documentElement);
   ```
   Update imports — drop the `CSS` import, add `InlineStyle` from `~/core/StyleTarget.js` if not already present. **Verify:** `grep -n 'CSS\.' src/typescript/lib/core/Theme.ts` → 0 matches; theme toggle still updates every CSS custom property in DevTools.

10. **Delete `src/typescript/lib/core/CSS.ts`**. **Verify:** `npx tsc --noEmit` → 0 errors; `grep -rn 'from "~/core/CSS"\|from '\''~/core/CSS'\''' src/typescript` → 0 matches; `grep -rn 'CSS\.' src/typescript` → 0 matches.

11. **Typecheck the full tree**: `npx tsc --noEmit` → 0 errors.

12. **Smoke verification** at `http://localhost:8015`:
    - `MiscPanel` slow table — header glyph alignment (HeaderCellGlyph), resize handles (ResizeHandle), sort badges (SortPriorityBadge), header `:active` pressed state.
    - Toolbar `TimeField` / `DateField` / `DateTimeField` — PickerButton centred glyph, opening each picker (DatePickerDropdown, TimePickerDropdown, DateTimePickerDropdown grids all render correctly with hover highlighting on day/time cells).
    - `AccordionIndicator` chevron expand/collapse animation.
    - `ComboBox` row hover highlighting, label/caret layout.
    - `AutoCompleteItem` hover highlight.
    - `MenuBarButton` hover highlight.
    - `Glyph` spin / pulse / beat animations.
    - `ProgressBar` indeterminate animation.
    - `ProgressSpinner` rotation.
    - Theme toggle to dark mode — every CSS custom property still updates.

13. **`npm run docs:build`** → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).

---

## Files to Create / Modify / Delete

| Action | File |
|--------|------|
| Modify | `src/typescript/lib/core/StyleTarget.ts` — new `StyleRuleScope` type, redesigned constructor, private module-level cache + helpers, public `ensureKeyframes` static |
| Modify | `src/typescript/lib/core/Component.ts` — 2 sites (lines 205, 424) |
| Modify | `src/typescript/lib/core/Theme.ts` — `CSS.setRootVariables(...)` → `new InlineStyle()` + `setMany` + `attach(document.documentElement)` |
| Modify | `src/typescript/lib/component/table/cell/SortPriorityBadge.ts` |
| Modify | `src/typescript/lib/component/table/cell/ResizeHandle.ts` |
| Modify | `src/typescript/lib/component/table/cell/Header.ts` — HeaderCellGlyph class rule + the `:active` component rule |
| Modify | `src/typescript/lib/component/container/AccordionIndicator.ts` |
| Modify | `src/typescript/lib/component/display/Glyph.ts` — 3 class rules + 3 `ensureKeyframes` |
| Modify | `src/typescript/lib/component/display/ProgressBar.ts` — `ensureKeyframes` |
| Modify | `src/typescript/lib/component/display/ProgressSpinner.ts` — `ensureKeyframes` |
| Modify | `src/typescript/lib/component/input/TimeField.ts` — PickerButton |
| Modify | `src/typescript/lib/component/input/DateField.ts` — PickerButton |
| Modify | `src/typescript/lib/component/input/DateTimeField.ts` — PickerButton |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` — 4 class rules + 1 selector rule |
| Modify | `src/typescript/lib/component/input/DateTimePickerDropdown.ts` — 7 class rules + 1 selector rule |
| Modify | `src/typescript/lib/component/input/DatePickerDropdown.ts` — 4 class rules + 1 selector rule (also drops `.style.setProperty` shape) |
| Modify | `src/typescript/lib/component/input/TimePickerDropdown.ts` — 6 class rules + 2 selector rules (also drops `.style.setProperty` shape) |
| Modify | `src/typescript/lib/component/input/AutoCompleteItem.ts` — `_hoverCSSRule` field becomes `StyleRule` |
| Modify | `src/typescript/lib/component/menubar/MenuBarButton.ts` — `_hoverRule` field becomes `StyleRule` |
| Delete | `src/typescript/lib/core/CSS.ts` |

19 modifies, 1 delete, 0 creates.

---

## Verification

- `npx tsc --noEmit` → **0 errors**.
- `grep -rn 'CSS\.' src/typescript` → **0 matches**.
- `grep -rn 'from "~/core/CSS"\|from '\''~/core/CSS'\''' src/typescript` → **0 matches**.
- `grep -rn '\.style\.setProperty\|\.style\.cssText\|\.style\.removeProperty' src/typescript` → **0 matches** (a strict superset of the prior plan's gate; the three leftover sites from `AutoCompleteItem` / `MenuBarButton` / `Header` are eliminated in step 6).
- `ls src/typescript/lib/core/CSS.ts` → **No such file**.
- `npm run docs:build` → 0 errors, 0 link warnings.
- Manual smoke per step 12 in light and dark themes.

---

## Documentation Impact

The `CSS` namespace is currently exported via `core` (verify with `grep -n 'CSS' src/typescript/lib/core/index.ts`). Removing it is a breaking API change for any external consumer that imported `CSS` from `~/core/CSS.js`.

- Remove the `CSS` re-export from `src/typescript/lib/core/index.ts` (if present).
- Search for cross-bucket JSDoc references: `grep -rln '\bCSS\.\(createClassRule\|createComponentRule\|createRule\|ensureKeyframes\|getClassRule\|getComponentRule\|getRule\|getMainStyle\|setRootVariables\)\b' docs/` — expect 0 hits after the implementation lands (typedoc regenerates from source).
- Skim the regenerated `docs/api/core/` index after `docs:build` — the `CSS` namespace page should disappear.
- `StyleRule.ensureKeyframes` becomes a new public static. Typedoc picks it up automatically; the curated `docs/core/StyleRule.md` page (if one exists — verify) should mention it. If a curated page does not exist, no action is required (Core has automatic API generation).
- No new public surface on `InlineStyle` — Theme uses its existing API. The curated `docs/core/InlineStyle.md` page (if one exists) gains a usage example showing the root-element pattern; otherwise no doc change.
- The new `StyleRuleScope` type is a new public export. Re-export from `src/typescript/lib/core/index.ts`.

---

## Potential Challenges

- **`this.getId()` timing in `Component`'s `_styleRule` field initialiser.** The old factory captured `this` lazily — the call happened on `ensure()`, after the constructor body had assigned the id. The new shape calls `this.getId()` *at field initialiser time*. Need to verify `_id` is assigned before the `_styleRule` field initialiser fires. In TypeScript, field initialisers run in declaration order during `super()` and again after `super()` for the subclass's own fields. `Component` assigns `_id` in the constructor body, not via a field initialiser, so a field initialiser referencing `this.getId()` would see the pre-construction default. **Mitigation:** check `Component`'s constructor; if `_id` is set in the constructor body, move `_styleRule`'s initialisation into the constructor body too (`this._styleRule = new StyleRule({ scope: "component", name: this.getId() });`), keeping the `declare` field declaration. The prior plan's parallel concern was `_deferredStyleRules!: Map<...>` for the same reason ([Component.ts:214](../src/typescript/lib/core/Component.ts#L214)).
- **`createStyleRule(suffix)` allocation timing.** The builder at line 421 captures `this.getId()` inside its closure today. The new `name: this.getId() + selectorSuffix` evaluates at call time, which is correct — `createStyleRule` is invoked from a constructor body (post-super), so `getId()` is stable.
- **`_ruleCache` shared across `StyleRule` instances.** The cache currently keyed by selector string in `CSS.ts:9` becomes a module-level `Map` in `StyleTarget.ts`. Two `StyleRule` instances with the same selector spec share the underlying `CSSStyleRule` — same as today. Document this in the constructor JSDoc (`@remarks Two StyleRules constructed with the same scope+name share the underlying CSSStyleRule, which is also shared with any prior cached rule of the same selector.`).
- **`CSS` import in `Component.ts`'s top-of-file barrel.** `Component.ts` currently imports `CSS` for the two factory closures. After step 2, drop the `import { CSS } ...` line. `tsc` flags unused imports — surface them as you go.
- **Verifying every `CSS.` call site moved.** After the migration, `grep -rn 'CSS\.' src/typescript` must return zero. If a `CSS.` reference slipped through, the build will still pass (the deleted file would surface as a type error) but the verification step catches it directly.
- **`@keyframes` insertion order.** Today `CSS.ensureKeyframes` inserts at `cssRules.length` (append). The new `StyleRule.ensureKeyframes` must preserve that — keyframe declarations need to land before any rule that references them. Move the helper verbatim; don't change the insertion index.
- **`ruleCache` survives module reload but `_ruleCache` is per-module.** The original `ruleCache` was scoped to the `CSS` namespace, which is also a single module. Moving the cache into `StyleTarget.ts` preserves the same single-instance semantics. Hot-reload behaviour unchanged.

---

## Critical Files

- [src/typescript/lib/core/StyleTarget.ts](../src/typescript/lib/core/StyleTarget.ts) — destination of every change; new constructor + statics live here.
- [src/typescript/lib/core/CSS.ts](../src/typescript/lib/core/CSS.ts) — entire file is the source material being absorbed and then deleted.
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — two factory call sites (lines 205, 424). Read the constructor body to confirm `_id` assignment order before moving the `_styleRule` initialiser.
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — `setRootVariables` call at line 1034; migrates to a local `InlineStyle` against `document.documentElement`.
- [src/typescript/lib/component/table/cell/SortPriorityBadge.ts](../src/typescript/lib/component/table/cell/SortPriorityBadge.ts) and [ResizeHandle.ts](../src/typescript/lib/component/table/cell/ResizeHandle.ts) — the canonical class-rule patterns, already in tree.
- [src/typescript/lib/component/container/AccordionIndicator.ts](../src/typescript/lib/component/container/AccordionIndicator.ts) — second canonical class-rule pattern.
- [plans/implemented/migrate-rule-style-to-stylerule.md](implemented/migrate-rule-style-to-stylerule.md) — the prior plan; this is the follow-up that finishes the constructor-redesign half it deliberately deferred.
- [ARCHITECTURE.md](../ARCHITECTURE.md), section "CSS writes go through `StyleRule` / `InlineStyle`" — the binding rule this plan finishes implementing.

---

## Non-Goals

- **Touching `setElementStyle` / `InlineStyle`.** The `InlineStyle` class is unchanged. Only `StyleRule`'s public API changes.
- **Adding more scope arms (`tag`, `id`, `pseudo`, `keyframes`).** The codebase has none of those shapes today. `selector` is the escape hatch if one ever appears. Adding speculative arms violates the simplicity-first guideline.
- **Deduplicating the three `PickerButton` IIFEs.** The prior plan flagged this as out of scope; same here. They are identical class-rule registrations in `TimeField`, `DateField`, `DateTimeField`; deduplication is a separate refactor.
- **Promoting `ensureKeyframes` (or the new root-`InlineStyle` pattern) to typed setters on `Component`.** They are framework-level operations; component-level wrappers would obscure that.
- **Changing `StyleRule`'s `set` / `setMany` / `ensure` / `queue` / `flush` API.** Those are stable. Only the constructor changes.
- **Touching the previously-implemented sites of [SortPriorityBadge.ts](../src/typescript/lib/component/table/cell/SortPriorityBadge.ts), [ResizeHandle.ts](../src/typescript/lib/component/table/cell/ResizeHandle.ts), [Header.ts](../src/typescript/lib/component/table/cell/Header.ts) `HeaderCellGlyph` rule, [AccordionIndicator.ts](../src/typescript/lib/component/container/AccordionIndicator.ts), or the three `PickerButton` IIFEs beyond the constructor swap.** Their `setMany` / `ensure` bodies are untouched.
- **Renaming the `StyleRule` class.** Keep the name; only the constructor signature changes.
