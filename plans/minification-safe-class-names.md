# Minification-Safe Class Names — Implementation Plan

## Overview

Every framework component derives its runtime string identity from `this.constructor.name`. Under a production name-mangling minifier that token collapses (empirically to `"Zt"`), so every component gets one wrong CSS class (breaking all theme scoping) and serialized layouts carry garbage keys. The library and every consumer currently dodge this with `keepNames` (the app's [vite.config.ts:45](vite.config.ts#L45), the lib's [vite.lib.config.ts:53](vite.lib.config.ts#L53); sqladmin just had to add `esbuild.keepNames`).

The fix: give each component class an explicit, stable, minification-proof string name so `getClassName()` returns the correct leaf name even when `constructor.name` is mangled. The single chokepoint is [`BaseObject.getClassName()`](src/typescript/lib/core/BaseObject.ts#L44), which every identity site funnels through (directly or via the one raw `this.constructor.name` at [Component.ts:4690](src/typescript/lib/core/Component.ts#L4690)). We route `getClassName()` through an **own-property** static field (`static readonly className`) declared on each class, falling back to `constructor.name` only when a class omits it — and we add a registry-style enforcement test that fails loudly when a class (especially a subclass — the static-inheritance trap) forgets its own name.

The produced strings must be **byte-for-byte identical to today's** because theme CSS `StyleRule` selectors target the exact leaf names (`.List`, `.MultiSelectList`, `.CustomListRow`, …) and previously-saved layouts persist Split/Tab discrimination keyed on `getClassName() === "Split"`/`"Tab"`. Today those strings are the class **declaration** identifiers (`class HBox …` → `"HBox"`), never the underscored export alias — verified below — so the underscore-strip in the identity sites is a defensive no-op we preserve unchanged.

---

## Architecture Decisions

### Route `getClassName()` through an own-property `static className`

`BaseObject.getClassName()` becomes:

```typescript
getClassName(): string {
    const ctor = this.constructor as { className?: string };

    return Object.prototype.hasOwnProperty.call(ctor, "className")
        ? ctor.className!
        : this.constructor.name;
}
```

Each component class declares `static readonly className = "Button"`. The **own-property check is the crux**: a naive `static className` is *inherited*, so `class ToggleButton extends Button` that forgot its own field would report `"Button"` — a silent regression. `hasOwnProperty` reads only the leaf class's **own** static slot; a subclass that omits `className` falls through to `constructor.name` (correct when unminified, mangled when minified — which the enforcement test catches). This reproduces `constructor.name`'s leaf-name semantics exactly while making the value minification-proof.

Rejected — **`@named("Button")` decorator / registration call**: sets an own field and is enforceable, but adds a runtime construct and import to all 137 classes, runs at class-eval time, and buys nothing the `static readonly` + own-property + enforcement-test combination doesn't already give. The static field is the lowest-ceremony option that a senior engineer would reach for, matches the codebase's existing `static readonly` idiom ([MenuItem.ts:101](src/typescript/lib/component/container/MenuItem.ts#L101), [TabBar.ts:318](src/typescript/lib/component/container/TabBar.ts#L318)), and the own-property fallback removes the "silent mis-name" risk that would otherwise make it "rely on discipline."

Rejected — **build-time injection** of `className` (a Babel/SWC/Vite AST transform that adds `static className` from each declaration name, à la `babel-plugin-styled-components`; or a codegen script). This removes the 139-class edit and the per-class obligation, so it is tempting — but it was rejected for a **decisive** reason beyond tooling cost: it only fixes *this library's* classes. A consumer who writes their **own** `Component` subclass gets no injected `className` unless they also adopt the transform in their build, so the minification hazard silently returns for downstream component authors — exactly the cross-project build contract this change exists to eliminate. An explicit `static readonly className` is instead a self-contained, build-tool-free convention any consumer replicates in one line for their own components (and can enforce with the same registry test). Secondary strikes against the transform: it moves identity out of the source (a static member that doesn't appear in the file), it must run in the build *and* the vitest pipeline to stay offline-testable, and a codegen-writes-files variant adds a reviewable diff and a source-of-truth split. The manual field is a one-time, test-guarded edit that keeps identity explicit and portable.

### Keep the underscore-strip sites unchanged; the explicit name carries no underscore

Investigation confirms **no class is declared with a leading underscore** — the `_HBox` form is only the *export alias* (`HBox as _HBox`), while the declaration is `class HBox`. So `constructor.name` already yields `"HBox"` today, and `getClassName().replace(/^_/, "")` at [Component.ts:4469](src/typescript/lib/core/Component.ts#L4469)/[:4495](src/typescript/lib/core/Component.ts#L4495), [LayoutSerialization.ts:163](src/typescript/lib/layout/LayoutSerialization.ts#L163), and [Dock.ts:1125](src/typescript/lib/overlay/Dock.ts#L1125) is a defensive no-op for the real class objects. The explicit `className` literals likewise carry **no** underscore (`static readonly className = "HBox"`), so `replace(/^_/, "")` stays a no-op and every strip site keeps working untouched — no edits there.

### Remove `keepNames` from both vite configs once names are explicit

The whole point is to end the `keepNames` dependency for the library and its consumers. Once every identity-bearing class carries an explicit `className`, `keepNames` is dead weight; keeping it "belt-and-suspenders" would mask a missing `className` (a mangled `constructor.name` fallback would still read correctly under `keepNames`), defeating the enforcement test's whole purpose in the real build. **Remove** `compress.keepNames`/`mangle.keepNames` from [vite.config.ts](vite.config.ts#L45) and [vite.lib.config.ts](vite.lib.config.ts#L53), and update the explanatory comment at [vite.lib.config.ts:50-52](vite.lib.config.ts#L50) that tells consumers to preserve identifiers. There is no `LIBRARY_NOTES` file; the guidance lives only in that comment.

### Honest tradeoff: `keepNames` is the "standard" fix; this refactor is deliberate

A senior engineer could reasonably call `keepNames` the standard, one-line solution and a 137-class edit over-engineering: `keepNames` is a well-supported minifier feature, and the refactor touches every component file and imposes a permanent per-class obligation (every new component must add `className`, guarded by a test). The counter-argument the user has accepted: `keepNames` is a **cross-project contract** — it silently breaks any consumer who forgets it (sqladmin just hit this), it is invisible until a mangled bundle ships, and it couples the library's correctness to a build flag it doesn't control. Making identity explicit in the source makes the library correct under *any* minifier with no consumer obligation. The cost is a bounded, mechanical, test-guarded edit; the benefit is removing a fragile external contract. This section records the tradeoff so the decision is legible, not hidden.

### The persisted layout `kind` keys are already stable literals — only the manager discrimination is at risk

The serialized `LayoutNode.kind` values (`"split"`, `"tab"`, `"panel"`, `"window"`) are **hardcoded lowercase literals** in [LayoutSerialization.ts](src/typescript/lib/layout/LayoutSerialization.ts#L55), not derived from any class name — so persisted files are unaffected regardless. What the mangler breaks is the *classification* step: `managerKind()` ([LayoutSerialization.ts:160](src/typescript/lib/layout/LayoutSerialization.ts#L160)) and `regionKind()` ([Dock.ts:1122](src/typescript/lib/overlay/Dock.ts#L1122)) compare `getClassName() === "Split"`/`"Tab"`; under mangling those comparisons fail and Splits/Tabs get mis-recorded as opaque panels. Fixing `getClassName()` at the source repairs both without touching the comparison strings.

---

## Public API

No consumer-facing API changes. `getClassName()` keeps its signature and return contract (leaf class name). `static readonly className` is a framework-internal convention, not part of the documented options/setter surface, so it does not touch any `XOptions` bag (per the typed-setter rules — it is intrinsic framework identity, not consumer-configurable state).

```typescript
// BaseObject
getClassName(): string;   // now own-property-aware; same return contract
```

---

## Internal Structure

Every class in the identity scope declares, as its first static member:

```typescript
class Button<TOptions extends ButtonOptions = ButtonOptions> extends Component<TOptions> {
    static readonly className = "Button";
    // …
}
```

The literal **must equal the declaration identifier** (`class Button` → `"Button"`). For a generic class the literal is the base name without type params (`"Button"`, not `"Button<TOptions>"`), matching `constructor.name` today.

**Scope (verified):** 137 classes are wrapped in `callable()` (`grep = callable(` → 137 distinct identities) — the full set of instantiable Components + LayoutManagers whose leaf name can surface. This is materially larger than the "~75" estimate in the brief; the plan is scoped to all 137. Abstract, never-instantiated bases (`AbstractCustomList`, `LayoutManager`, `BoxLayout`, `FlowLayout`, `AbstractModel`, `AbstractStore`, `CellRenderer`, `TreeNodeRenderer`, `AbstractPickerField`, `AbstractCalendarDropdown`, `Association`) do **not** need a `className` — their leaf name never reaches `getClassName()` at runtime — but declaring one on them is harmless and the enforcement test decides which are required (see below).

---

## Ordered Implementation Steps

1. **`BaseObject.getClassName()`** ([BaseObject.ts:44](src/typescript/lib/core/BaseObject.ts#L44)) — replace the body with the own-property-aware form above. Add a JSDoc `@remarks` line noting the leaf-own `className` static overrides `constructor.name` so identity survives minification. → verify: existing `tests/unit/core/BaseObject.test.ts` still passes (the direct-instance and subclass cases now exercise the fallback path, since neither `BaseObject` nor the test's `Widget` declares `className`).

2. **Write the enforcement test first** (`tests/unit/core/class-name.test.ts`) — modelled on the manually-maintained registry in [tests/component/default-options-fallback.test.ts](tests/component/default-options-fallback.test.ts). Import every callable-wrapped class (use its unwrapped `_X` alias so the raw constructor is in hand), assert for each: (a) it has an **own** `className` (`Object.prototype.hasOwnProperty.call(Cls, "className")`), and (b) `Cls.className === Cls.name` (equals the unminified `constructor.name`, i.e. byte-for-byte backward compatibility) — this second assertion is what proves "zero change to produced strings." A subclass that omits its own field fails (a) even though it inherits the parent's. This test is the leaf-correctness guarantee and the regression net; it is fully offline. → verify: it **fails red** for every class before step 3, then goes green as classes get their field.

3. **Add `static readonly className = "<DeclName>"`** to each of the 137 callable-wrapped classes, the literal equal to the class declaration identifier. Work barrel-by-barrel (`core`, `layout`, `overlay`, `primitive`, `data`, `validation`, each `component/*`). → verify after each barrel: `tests/unit/core/class-name.test.ts` green for that barrel's classes; `grep -c` the barrel's class count against declared `className`s.

4. **Confirm the underscore-strip and comparison sites are untouched** — no edits at [Component.ts:4469/4495](src/typescript/lib/core/Component.ts#L4469), [LayoutSerialization.ts:163](src/typescript/lib/layout/LayoutSerialization.ts#L163), [Dock.ts:1125](src/typescript/lib/overlay/Dock.ts#L1125), [Table.ts:68](src/typescript/lib/layout/Table.ts#L68), [Component.ts:4690](src/typescript/lib/core/Component.ts#L4690). They already read the right string through the fixed `getClassName()` / `constructor.name`. → verify: `grep -rn 'getClassName()\|constructor.name' src/typescript/lib` shows the same sites, unchanged in behaviour.

5. **Remove `keepNames`** from [vite.config.ts](vite.config.ts#L45) and [vite.lib.config.ts](vite.lib.config.ts#L53), and rewrite the [vite.lib.config.ts:50-52](vite.lib.config.ts#L50) comment to state that class identity is now explicit (`static className`) so consumers need no `keepNames`. → verify: `npm run build` (app) and the lib build (`vite build --config vite.lib.config.ts`) complete; the produced bundle contains the literal strings (see Verification).

6. **Grep for any missed identity consumer** — `grep -rn 'constructor\.name' src/typescript/lib` should show only [Component.ts:4690](src/typescript/lib/core/Component.ts#L4690) (which reads the fixed-name-adjacent path) and the [DOM.ts:305](src/typescript/lib/core/DOM.ts#L305) empty-token guard comment; `grep -rn 'getClassName' src/typescript/lib` should show only the enumerated sites. → verify: zero unexpected matches.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/BaseObject.ts` — own-property-aware `getClassName()` |
| Modify | 137 files: each callable-wrapped class gains `static readonly className = "<Name>"` (across `core/`, `layout/`, `overlay/`, `primitive/`, `data/`, `validation/`, `component/**`) |
| Modify | `vite.config.ts` — remove `keepNames` |
| Modify | `vite.lib.config.ts` — remove `keepNames`, update the consumer-guidance comment |
| Create | `tests/unit/core/class-name.test.ts` — registry enforcement + byte-for-byte-equal-to-`constructor.name` test |

---

## Expected Behaviour

Unit-testable offline (Vitest, unminified):

- `getClassName()` returns the leaf declaration name for a class that declares `className` (`new Button().getClassName() === "Button"`).
- `getClassName()` returns `constructor.name` for a class that declares no `className` (fallback path — the `BaseObject`/`Widget` cases in the existing test).
- **Leaf correctness under inheritance:** `new ToggleButton().getClassName() === "ToggleButton"` even though `ToggleButton extends Button` — the own-property check does not read `Button`'s inherited `className`. (Add this as an explicit case using `ToggleButton` and `TreeTable extends Table`.)
- **Byte-for-byte back-compat:** for every registered class `Cls.className === Cls.name` (proves no produced string changed vs. today).
- **Enforcement:** every callable-wrapped class has an *own* `className`; a class omitting it fails the registry test (simulate with a throwaway `class Missing extends Component {}` and assert the own-property check is `false` for it — documents the guard's behaviour).
- **Class-on-element:** with the `RecordingDOMSink` ([tests/dom/TestDOM.ts:244](tests/dom/TestDOM.ts#L244)), rendering a component records an `apply` patch whose `addClass` contains the leaf name (`["Button"]`), driven through the fixed `getClassName()`-adjacent path.
- **Serialization round-trip:** `serializeLayout` of a `Split`/`Tab` host still emits `kind: "split"`/`"tab"` (via `managerKind` → fixed `getClassName()`), and `restoreLayout` reproduces the same keys — the existing [tests/component/layout/LayoutSerialization.test.ts](tests/component/layout/LayoutSerialization.test.ts) suite still passes unchanged.
- **Table guard:** `Table.attach()` still accepts a `Table`/`TreeTable` container and rejects others via `getClassName()` ([Table.ts:68](src/typescript/lib/layout/Table.ts#L68)).

Needs the real minified-browser check (not exercisable by the offline harness, which runs unminified — so the fallback path masks a missing name in Vitest):

- The **built, minified** bundle still yields correct CSS classes and layout keys. Because names are now explicit **string literals**, this reduces to a static assertion: after `npm run build`, `grep` the minified output for a sample of the literals (`"Button"`, `"HBox"`, `"Split"`, `"MultiSelectList"`) — their presence proves the mangler could not have collapsed the identity. This is the one manual/scripted verify step; note it and script it as a build smoke check.

---

## Verification

- **Typecheck:** `npm run type-check` (or the project's tsc pass) clean.
- **Unit tests:** `npx vitest run tests/unit/core/class-name.test.ts tests/unit/core/BaseObject.test.ts tests/component/layout/LayoutSerialization.test.ts` all green.
- **Grep invariants:**
  - `grep -rn 'constructor\.name' src/typescript/lib` → only [Component.ts:4690](src/typescript/lib/core/Component.ts#L4690) + the [DOM.ts](src/typescript/lib/core/DOM.ts#L305) comment.
  - `grep -rc 'static readonly className' <each barrel>` matches that barrel's callable-wrapped class count.
  - `grep -rn 'keepNames' vite.config.ts vite.lib.config.ts` → zero.
- **Build smoke (minified-identity check):** `npm run build`, then grep the emitted bundle for a handful of the `className` literals — non-empty confirms identity survives mangling with `keepNames` gone.
- **Manual smoke:** run the app; open DevTools; confirm a `Button` element carries `class="Button"`, a `Dock` still shows `data-layout="Split"`/`"Tab"`, and a save→reload layout round-trips (the MiscPanel / Dock demo screen).

---

## Documentation Impact

No public API symbol is added or renamed, so no `docs/` page changes. `static readonly className` is `@internal` framework identity — not documented, not `{@link}`-able from public JSDoc. The only consumer-facing note is the **removal** of the "you must set `keepNames`" guidance embedded in [vite.lib.config.ts:50-52](vite.lib.config.ts#L50); update that comment. If the docs site anywhere documents a consumer build requirement to preserve class names, `grep -rln 'keepNames' docs/` and update — investigation found none, but re-check at implement time.

---

## Potential Challenges

- **Missing a class among 137** — the enforcement test (step 2) fails red for any un-annotated callable-wrapped class, so an omission cannot ship silently. Write the test first.
- **Wrong literal (typo / stale name)** — the `Cls.className === Cls.name` assertion catches any literal that doesn't match the current declaration identifier, so a typo fails offline.
- **Generic class names** — the literal is the bare name (`"Button"`), matching `constructor.name`, which drops type parameters; the equality assertion enforces this.
- **A future subclass forgets its field** — the own-property check + enforcement test catch it; the fallback keeps it *correct when unminified* so tests still see the right name, but the test still fails on the missing own field, forcing the fix.
- **`keepNames` removal exposing a latent miss** — the offline harness runs unminified, so a missing `className` reads correctly there; the build-smoke grep for literals is the backstop that a real minified bundle is correct. Keep that step non-optional.

---

## Critical Files

- [src/typescript/lib/core/BaseObject.ts](src/typescript/lib/core/BaseObject.ts) — the single `getClassName()` chokepoint being changed.
- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) (`init()` addClass at :4690; `data-layout` at :4469/:4495) — the CSS-class and layout-attribute identity sites (read-only for this plan).
- [src/typescript/lib/layout/LayoutSerialization.ts](src/typescript/lib/layout/LayoutSerialization.ts) (`managerKind` :160) and [src/typescript/lib/overlay/Dock.ts](src/typescript/lib/overlay/Dock.ts) (`regionKind` :1122, `isTab`/`isRegionContainer`) — the Split/Tab discrimination that mangling breaks.
- [src/typescript/lib/layout/Table.ts](src/typescript/lib/layout/Table.ts) (`attach` :68) — the `Table`/`TreeTable` name guard.
- [src/typescript/lib/component/list/AbstractCustomList.ts](src/typescript/lib/component/list/AbstractCustomList.ts) (:99, :106) — the `.List`/`.MultiSelectList` CSS-selector coupling to auto-added leaf classes.
- [src/typescript/lib/core/Callable.ts](src/typescript/lib/core/Callable.ts) — confirms `instance.constructor` stays the raw class (so `constructor.name` is the declaration name, not the alias) and that `callable()` doesn't affect identity.
- [tests/component/default-options-fallback.test.ts](tests/component/default-options-fallback.test.ts) — the manual-registry-test precedent the enforcement test mirrors.
- [tests/dom/TestDOM.ts](tests/dom/TestDOM.ts) (`RecordingDOMSink` :244) — how the class-on-element behaviour is asserted offline.
- [vite.config.ts](vite.config.ts), [vite.lib.config.ts](vite.lib.config.ts) — the `keepNames` removal.

---

## Non-Goals

- **Changing the persisted layout schema** — `kind` keys stay the lowercase literals they already are; no migration is needed or wanted.
- **A runtime class registry / auto-registration decorator** — rejected above; the static field + enforcement test is the chosen mechanism.
- **Annotating abstract, never-instantiated base classes** — they never surface a leaf name; the enforcement test scope defines the required set (callable-wrapped classes), not the abstract bases.
- **Touching the underscore-strip or `=== "Split"`/`"Tab"` comparison strings** — they already work through the fixed `getClassName()`; editing them is out of scope.
