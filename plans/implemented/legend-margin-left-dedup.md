# Legend `margin-left` Class-Tier Dedup — Implementation Plan

## Overview

`Legend` writes `margin-left: 10px` onto every instance's own `#id` CSS rule, from a raw `setElementCSSRule` call inside its `applyStyle` override ([packages/lib/src/typescript/lib/component/container/Legend.ts:65](packages/lib/src/typescript/lib/component/container/Legend.ts#L65)). Every `Legend` in the app writes the identical declaration, so the live Style Audit panel ([packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts](packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts)) flags it as a duplicate-body rule. This plan moves that declaration onto the shared `.Legend` class rule, which already exists.

`Legend` already declares `ownClassStyleDefaults` ([Legend.ts:34](packages/lib/src/typescript/lib/component/container/Legend.ts#L34)), added when its `position: static` was hoisted the same way. The class tier's resolver, `resolveDeclarations` ([core/ClassStyleRules.ts:204](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L204)), has no `margin-left` case today, so it gains one. `StyleBag` ([core/ClassStyleRules.ts:40](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L40)) gains a matching `marginLeft` field and `STYLE_WRITERS` ([core/ClassStyleRules.ts:276](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L276)) a matching writer.

Four files change: `ClassStyleRules.ts`, `Legend.ts`, one stale JSDoc example in `core/Component.ts`, and the existing `Legend.classStyleDefaults.test.ts`.

---

## Architecture Decisions

### Hoist through a new `marginLeft` key, not the existing `margin` shorthand

`StyleBag` gains `marginLeft?: string | null`. The existing `margin` field stays untouched and `resolveDeclarations` keeps writing its hardcoded `"0px 0px 0px 0px"` literal.[^why-not-margin]

### `marginLeft` resolves through a truthy gate, not `position`'s fallback form

The new line in `resolveDeclarations` is a conditional that adds the key only when the class declares one — `if (defaults.marginLeft) declarations.marginLeft = defaults.marginLeft;` — mirroring the `outline` / `foregroundColor` / `backgroundColor` / `shadow` / `borderRadius` conditionals directly above it ([core/ClassStyleRules.ts:231-237](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L231-L237)). It is **not** the `position: defaults.position ?? Position.ABSOLUTE` fallback shape the prior hoist used.[^why-not-fallback]

| Class's resolved bag | `resolveDeclarations` output | That class's `.ClassName` rule |
|---|---|---|
| no `marginLeft` (every class today) | key absent entirely | unchanged — no new declaration, no new rule |
| `marginLeft: "10px"` (`Legend`) | `marginLeft: "10px"` | gains `margin-left: 10px` |
| `marginLeft: null` | key absent (falsy) | unchanged |

### `Legend.applyStyle` is deleted, not reduced to a `super` call

Removing the `setElementCSSRule` line leaves an override whose whole body is `super.applyStyle(element); return this;`, so the override goes too. The `Handle` import it was the only user of goes with it. `Legend.LEFT_MARGIN` stays — `ownClassStyleDefaults` now reads it.

### The rendered CSS declaration is unchanged; only its selector moves

`setElementCSSRule("marginLeft", …)` queues the camelCase key `marginLeft` with the string `"10px"`. `resolveDeclarations` copies `defaults.marginLeft` through verbatim under the same camelCase key, and both paths reach the stylesheet through the same `setRuleStyles` sink call. The declaration text is identical; the selector carrying it changes.

| | Selector | Specificity | `margin-left` declaration |
|---|---|---|---|
| framework rule (unchanged) | `:where(.ts-ui-component)` | 0,0,0 | via `margin: 0px 0px 0px 0px` |
| class rule — before | `.Legend` | 0,1,0 | none (rule holds `position: static` only) |
| class rule — after | `.Legend` | 0,1,0 | `margin-left: 10px` — **wins** |
| instance rule — before | `#<uuid>` | 1,0,0 | `margin-left: 10px` (one per instance) |
| instance rule — after | `#<uuid>` | 1,0,0 | none |

`.Legend` outranks the zero-specificity framework rule whatever order the sheet ends up in, so the framework's `margin` shorthand cannot reclaim the left side. No intermediate rule competes: `.Text`, `Legend`'s parent level, declares no margin of any kind.[^cascade-evidence]

### Adding to the existing bag cannot trip the first-declaration trap

Giving a class `ownClassStyleDefaults` for the *first* time flips it onto the hierarchy-aware `resolveClassLevel` path, which stops consulting the flat `getClassStyleDefaults()` / `_defaultOptions` bag for that class's rule — so a sibling field living only in the flat bag silently disappears from the rendered CSS. Call that the first-declaration trap. `Legend` crossed that boundary in the `position` hoist, so `chainParticipates(Legend)` is already `true` and adding a second field to a bag that already exists changes no path.[^first-declaration-trap] `Legend` also has no `_default<Name>Options` bag and no subclasses, so nothing can be stranded on the flat path and no DOM class list widens.

---

## Internal Structure

### `core/ClassStyleRules.ts` — three additive edits

**1. `StyleBag` gains the field**, immediately after `border?:` and before the `// The four properties applyStyle writes today…` comment block (keeping that comment's count accurate):

```typescript
    border?:          BorderOptions | string | null;
    // Longhand override for the `margin` shorthand `resolveDeclarations`
    // hardcodes below. Class-authored only — no `Component` setter writes it
    // and no `ComponentOptions` field of this name exists. See
    // `Legend.ownClassStyleDefaults`.
    marginLeft?:      string | null;
```

**2. `resolveDeclarations` gains one conditional**, immediately after the `if (defaults.borderRadius)` line ([core/ClassStyleRules.ts:237](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L237)):

```typescript
    if (defaults.borderRadius)    declarations.borderRadius    = defaults.borderRadius;

    // Truthy-gated like the chrome group above: absent for every class that
    // declares none, so no class gains a spurious deviation against the
    // framework rule (which has no `marginLeft` key to compare against).
    // Emitted after the `margin` shorthand in key order, so a rule that ever
    // carried both would apply the longhand last.
    if (defaults.marginLeft)      declarations.marginLeft      = defaults.marginLeft;
```

**3. `STYLE_WRITERS` gains a writer**, next to the existing `margin` entry ([core/ClassStyleRules.ts:302](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L302)):

```typescript
    margin:          (v) => ({ margin: v ?? null }),
    marginLeft:      (v) => ({ marginLeft: v ?? null }),
```

This entry is mandatory, not optional: `STYLE_WRITERS` is typed `{ [K in keyof StyleBag]-?: … }`, so omitting it fails `npm run typecheck`.

### `component/container/Legend.ts` — bag entry in, override out

```typescript
    protected static readonly ownClassStyleDefaults: StyleBag = {
        position:   Position.STATIC,
        marginLeft: `${Legend.LEFT_MARGIN}px`,
    };
```

`LEFT_MARGIN` is declared above `ownClassStyleDefaults` in the class body, so it is initialised by the time this initialiser runs. The whole `applyStyle` override ([Legend.ts:53-68](packages/lib/src/typescript/lib/component/container/Legend.ts#L53-L68)) is deleted, along with `import type { Handle } from "~/core/DOM.js";`. The class comment on `LEFT_MARGIN` and the constructor are untouched.

The `ownClassStyleDefaults` block comment gains one sentence naming `marginLeft`'s reason, since the deleted `applyStyle` JSDoc was where that reason lived:

```typescript
    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. Mirrors the constructor's
    // own `setPosition(Position.STATIC)` call below, so every Legend instance
    // dedupes its position declaration onto the shared `.Legend` class rule
    // instead of repeating it on its own `#id` rule. `marginLeft` overrides
    // the framework rule's zeroed `margin` shorthand so the title clears the
    // fieldset's left border corner instead of hugging it.
```

### `core/Component.ts` — one stale JSDoc example

`applySubclassStyles`'s doc comment names `Legend`'s `marginLeft` as an example of a subclass that overrides `applyStyle` directly ([core/Component.ts:5957](packages/lib/src/typescript/lib/core/Component.ts#L5957)). That override is gone, so the example drops to `Markdown`'s alone:

```typescript
     * value (`Markdown`'s `maxWidth`) has no need of
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`** — apply all three edits from `## Internal Structure`: the `StyleBag` field, the `resolveDeclarations` conditional, the `STYLE_WRITERS` entry.
   *Check:* `npm run typecheck` from `packages/lib`.

2. **`packages/lib/tests/component/container/Legend.classStyleDefaults.test.ts`** — update the existing single test case per `## Expected Behaviour` rows 1-3, before touching `Legend.ts`. Two new assertions, one changed assertion, and a comment update:
   - `expect(classDeclarations.marginLeft).toBe('10px');` — new, beside the existing `classDeclarations.position` assertion.
   - `expect(declarations.position).toBeNull();` → `expect(declarations.position).toBeUndefined();`
   - `expect(declarations.marginLeft).toBeUndefined();` — new.
   - Extend the file-header comment to say the case now covers `marginLeft` too.

   The `toBeNull()` → `toBeUndefined()` change is required, not cosmetic: once `marginLeft` leaves the `#id` rule, that rule holds nothing but `null` removals and is never materialised, so its keys read back as absent — see `## Expected Behaviour` row 2.
   *Check:* `npx vitest run tests/component/container/Legend.classStyleDefaults.test.ts` from `packages/lib` — **expected to FAIL** at this point, on both halves: `.Legend` carries no `marginLeft` yet, and the `#id` rule still materialises because the raw write is still there. This is the red half of the cycle.

3. **`packages/lib/src/typescript/lib/component/container/Legend.ts`** — add `marginLeft` to `ownClassStyleDefaults`, extend that block comment, delete the `applyStyle` override and the `Handle` import, per `## Internal Structure`.
   *Check:* `npx vitest run tests/component/container/Legend.classStyleDefaults.test.ts` — now green. `grep -n 'setElementCSSRule\|Handle' packages/lib/src/typescript/lib/component/container/Legend.ts` — zero matches. `npm run typecheck`.

4. **`packages/lib/src/typescript/lib/core/Component.ts`** — drop `` `Legend`'s `marginLeft`, `` from the `applySubclassStyles` JSDoc example. Leave the two other `Legend` mentions in the file alone (lines 493 and 4145) — both are about `setPosition`, not `applyStyle`.
   *Check:* `grep -n 'marginLeft' packages/lib/src/typescript/lib/core/Component.ts` — zero matches.

5. **Full verification.** See `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/Legend.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/tests/component/container/Legend.classStyleDefaults.test.ts` |

---

## Expected Behaviour

Rows 1-4 are unit-testable with the existing `installTestDOM` / `RecordingDOMSink` harness and the `idSelector` / `declarationsDuring` helpers already in `Legend.classStyleDefaults.test.ts`. Rows 5-6 are manual.

| # | Case | Expected |
|---|---|---|
| 1 | The `.Legend` class rule, captured from the render pass of `new FieldSet('Title')` | Declares `position: 'static'` **and** `marginLeft: '10px'` |
| 2 | The legend's own `#id` rule, same render pass | No write reaches that selector at all: both `declarations.position` and `declarations.marginLeft` are `undefined`, not `null`[^undefined-not-null] |
| 3 | `_ruleCacheHas('.Legend')` and `legend.getPosition()` | Still `true` and `'static'` — unchanged from today |
| 4 | Any class that declares no `marginLeft` (i.e. every class but `Legend`) | Its resolved bag and its `.ClassName` rule are byte-for-byte what they are today; a class with no rule today still gets none |
| 5 | Demo app tabs rendering a `FieldSet` — "Misc.", "Complex", "Content Box" ([packages/lib/src/typescript/main.ts:65-89](packages/lib/src/typescript/main.ts#L65-L89)) | Every fieldset title sits 10px clear of the left border corner, pixel-identical to before |
| 6 | The "Style Audit" tab, before and after, having visited a `FieldSet` tab | The duplicate-body row whose `component` field names `Legend` is gone from the ranked list |

---

## Verification

From `packages/lib`:

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants:

- `grep -n 'setElementCSSRule' packages/lib/src/typescript/lib/component/container/Legend.ts` — zero matches.
- `grep -n 'Handle' packages/lib/src/typescript/lib/component/container/Legend.ts` — zero matches.
- `grep -n 'marginLeft' packages/lib/src/typescript/lib/core/Component.ts` — zero matches.
- `grep -n 'marginLeft' packages/lib/src/typescript/lib/core/ClassStyleRules.ts` — hits in all three places: the `StyleBag` field, the `resolveDeclarations` conditional, the `STYLE_WRITERS` entry.

**Manual verification (rows 5-6) is required.** Start a dev server (`npm run dev`) from this worktree on a spare port — never the user's existing server, which may be serving a different tree. Open the "Misc.", "Complex", and "Content Box" tabs and confirm each fieldset title's left inset is unchanged, then open the "Style Audit" tab and confirm no ranked duplicate row names `Legend`.

---

## Potential Challenges

- **Test row 2 flips from `null` to `undefined`.** The raw `marginLeft` write is the only real declaration keeping a legend's `#id` rule alive, so removing it drops that rule below the materialisation threshold and its keys become absent rather than present-with-`null`. Handled by step 2. If the assertion is left as `toBeNull()`, the suite fails with `expected undefined to be null` — a correct failure, not a flake.
- **`STYLE_WRITERS` is exhaustively typed.** Adding the `StyleBag` field without the writer is a typecheck error, so step 1's three edits must land together.
- **A conditional key must never be introduced with value `undefined`.** `resolveDeclarations`'s own comment ([core/ClassStyleRules.ts:227-230](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L227-L230)) states the rule; the truthy gate in step 1 satisfies it. Assigning `declarations.marginLeft = defaults.marginLeft ?? undefined` unconditionally would break `deviationsFrom` for every class.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | The three edit sites. Read `resolveDeclarations` (its conditional-key rule), `STYLE_WRITERS` (the exhaustive mapped type), `deviationsFrom` / `resolveClassLevel` (how a class rule's body is diffed against its parent level) |
| `packages/lib/src/typescript/lib/component/container/Legend.ts` | The class being changed; its existing `ownClassStyleDefaults` is the shape the new field joins |
| `packages/lib/tests/component/container/Legend.classStyleDefaults.test.ts` | The `position`-hoist test this plan extends — its `declarationsDuring` / `idSelector` helpers and its positive/negative assertion split are the template |
| `plans/implemented/class-hierarchy-cascade.md` | The `ownClassStyleDefaults` / `resolveClassLevel` / `chainParticipates` mechanism this change registers into |
| `plans/implemented/class-tier-default-hoists-batch.md` | Its Implementation Notes carry both the first-declaration trap and the `toBeNull()`-vs-`toBeUndefined()` finding this plan applies |
| `packages/lib/src/typescript/lib/core/Component.ts` | `flushStyleBag` (why a class-default-only `marginLeft` queues no instance write), `SKIP_ON_MATCH_KEYS` / `FRAMEWORK_BASELINE_KEYS` (why neither needs a new entry), and the stale JSDoc in `applySubclassStyles` |

---

## Non-Goals

- **Adding `marginLeft` to `SKIP_ON_MATCH_KEYS` or `FRAMEWORK_BASELINE_KEYS`** ([core/Component.ts:385,406](packages/lib/src/typescript/lib/core/Component.ts#L385)). Neither is needed: `flushStyleBag`'s default branch already skips a key no instance declared and no framework baseline covers, which is exactly the wanted outcome.[^no-component-sets]
- **Adding the other three margin longhands, or a `marginLeft` setter / `ComponentOptions` field.** Nothing needs them; `Legend` is the only class whose class-tier bag has a margin value to declare.
- **`MenuItem`'s and `MenuSeparator`'s raw `margin: "4px 0"` writes** ([component/container/MenuItem.ts:239](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L239), [component/container/MenuSeparator.ts:57](packages/lib/src/typescript/lib/component/container/MenuSeparator.ts#L57)) — the only other raw margin writes in the library. `MenuItem`'s is conditional on `config.separator`, so it is not class-uniform at all; `MenuSeparator`'s is, but it sits beside a `borderTop` write built from a constructor-supplied CSS-variable prefix, so hoisting it is a separate judgement about that whole constructor. Neither is this round.
- **Making `resolveDeclarations` read the existing `margin` shorthand field.** Rejected — see the first `## Architecture Decisions` footnote.
- **A changelog entry.** No exported symbol changes and nothing renders differently. The `position` hoist this plan follows shipped with no changelog entry either (commit `5d63a9bd`, three files, none under `docs/`).
- **The other duplicate-body rows the Style Audit panel currently ranks.** One class per round.

---

## Notes

[^why-not-margin]: `StyleBag.margin` already exists and already has a `STYLE_WRITERS` entry, so making `resolveDeclarations` read it (`margin: defaults.margin ?? "0px 0px 0px 0px"`, the exact shape the `position` hoist used) looks like the smaller change — and it is wrong. `resolveDeclarations` is reached with a plain `getClassStyleDefaults()` bag, whose base implementation returns `_defaultOptions` verbatim ([core/Component.ts:5763](packages/lib/src/typescript/lib/core/Component.ts#L5763)), and `FloatingPanel` registers `margin: DEFAULT_MARGIN` — a **number** of pixels for corner anchoring, not a CSS string — in its own `_defaultFloatingPanelOptions` ([component/container/FloatingPanel.ts:42](packages/lib/src/typescript/lib/component/container/FloatingPanel.ts#L42)). Reading `defaults.margin` would emit `margin: 24` onto `.FloatingPanel`, a unitless non-zero length the CSSOM drops, silently replacing that class's zeroed margin. This is the same name-collision hazard `TextStyleBag` was namespaced to avoid, documented at [core/ClassStyleRules.ts:72-85](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L72-L85). `marginLeft` collides with nothing: outside `Legend.ts`'s own write, a repo-wide grep finds the identifier only inside two CodeMirror blockquote theme literals (`component/display/Markdown.ts:195`, `component/editor/editorTheme.ts:65`), neither of which is a `StyleBag` or a `_defaultOptions` bag.

[^why-not-fallback]: `position` could take the `defaults.position ?? Position.ABSOLUTE` form because `FRAMEWORK_DECLARATIONS` already carries a `position` key ([core/ClassStyleRules.ts:106](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L106)), so a class declaring nothing resolves to the identical framework value and `deviationsFrom` filters the key back out. `FRAMEWORK_DECLARATIONS` has no `marginLeft` key. An unconditional `marginLeft` — with any fallback at all — would therefore differ from `against["marginLeft"]`, which is `undefined`, for **every** class, so `deviationsFrom` ([core/ClassStyleRules.ts:475](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L475)) would report it as a deviation everywhere and `resolveClassLevel` would insert a `.ClassName` rule for every class that has none today. Adding a `marginLeft` entry to `FRAMEWORK_DECLARATIONS` instead would put a redundant `margin-left: 0` on the framework rule for the sake of one class. The truthy gate avoids both.

[^cascade-evidence]: Confirmed by instrumenting the existing `Legend.classStyleDefaults.test.ts` render path and dumping every `setRuleStyles` call. `:where(.ts-ui-component)` receives `margin: "0px 0px 0px 0px"`; `.Text` receives eleven font declarations and no margin; `.Legend` receives `{position: "static"}`; the legend's own `#id` rule receives `{whiteSpace: null, overflowX: null, overflowY: null, textOverflow: null, lineHeight: null, position: null, display: null, userSelect: null, minWidth: null, minHeight: null, maxWidth: null, maxHeight: null, marginLeft: "10px"}`. `margin` never reaches the `#id` rule because it is in `SKIP_ON_MATCH_KEYS` and no `Legend` instance declares it, so no higher-specificity shorthand can reclaim the left side after the move either.

[^first-declaration-trap]: The trap `class-tier-default-hoists-batch.md` documents (its `ToolBar` finding) is that giving a class `ownClassStyleDefaults` for the *first* time flips `chainParticipates` to `true`, which makes `ensureClassStyleRule` take the `resolveClassLevel` path and stop consulting `getClassStyleDefaults()` / `_defaultOptions` for that class's rule — so any sibling field living only in the flat bag silently vanishes. `Legend` crossed that boundary in commit `5d63a9bd` and survived it: it has no `_default<Name>Options` bag, its constructor forwards no `subclassDefaults`, and its only `super()` argument is the structural `tag: "legend"`. There is nothing on the flat path to lose. The class also has no subclasses, so no descendant's DOM class list widens as a side effect.

[^undefined-not-null]: `flushStyleBag` queues an explicit `null` removal for each hoistable key the instance declared but that matches a lower tier — `position` among them, since `Legend`'s constructor calls `setPosition` unconditionally. `materialiseWhenNeeded` ([core/Component.ts:5976](packages/lib/src/typescript/lib/core/Component.ts#L5976)) then skips the rule entirely when every queued entry is a `null` removal, so no `setRuleStyles` call is recorded and every key reads back as absent rather than present-with-`null`. Today the raw `marginLeft: "10px"` write is the single real declaration keeping the legend's `#id` rule alive — the instrumented dump in the cascade footnote shows it beside twelve `null`s — so removing it drops the rule below the materialisation threshold. `class-tier-default-hoists-batch.md`'s Implementation Notes hit the identical flip for five classes and settled on `.toBeUndefined()` for exactly this reason.

[^no-component-sets]: In `flushStyleBag` ([core/Component.ts:5362-5385](packages/lib/src/typescript/lib/core/Component.ts#L5362-L5385)), a pending key that the instance layer never declared and that is absent from `FRAMEWORK_BASELINE_KEYS` hits `continue` and produces no `#id` write at all — the branch `backgroundColor` and `shadow` already take. `marginLeft` joins the pending set (it is a key of `_classLayer.resolved`), takes that branch, and the lower tier's `.Legend` rule supplies the value through the ordinary cascade. Adding it to either constant would instead queue a redundant `null` removal on every `Legend`'s `#id` rule.

## Implementation Notes

**A second pre-existing test, outside the plan's `## Files to Create / Modify / Delete` table, also depended on the raw `marginLeft` write and had to be updated.** `tests/component/input/TextClassStyleHoisting.test.ts`'s `"Legend's #id rule is not empty..."` case used `Legend` specifically because its old raw `applyStyle` write was the one real declaration that kept the `#id` rule materialised, letting the test observe `lineHeight`/`textOverflow`'s explicit `null` removals sitting beside it. With `marginLeft` moved to the class tier, nothing real remains queued for a plain `Legend`'s `#id` rule — instrumented via a temporary sink dump, `legend.getElement(true)` now records zero `setRuleStyles` calls for the `#id` selector at all, matching `materialiseWhenNeeded`'s "skip when every queued entry is a null removal" rule this plan's own `[^undefined-not-null]` footnote already describes, generalised one step further (the batch here isn't just all-`null`, it has nothing real to trigger materialisation in the first place). Rewrote the test to assert `declarations` is `{}`, matching the sibling "constructor-time numeric lineHeight" case in the same file that documents the identical never-materialises outcome for a plain `Text`. No other file references the deleted `applyStyle` override or its `marginLeft` write.

**Manual verification (plan rows 5-6) performed live**, dev server on `localhost:8123` from this worktree. Rows 5: `computed.marginLeft` read `10px` for every legend across the "Misc." (1), "Complex" (3), and "Content Box" (16) tabs — 20 legends total, all consistent — and `document.styleSheets` showed a single `.Legend { position: static; margin-left: 10px; }` rule with no per-instance override. Row 6: the "Style Audit" tab's ranked duplicate-body table, refreshed after visiting all three tabs, contains no row naming `Legend` in its `component` column, and a full-page text search for "Legend" returns no match.
