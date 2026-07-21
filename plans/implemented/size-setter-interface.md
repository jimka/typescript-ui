# Size Setters Take a `Size` — Implementation Plan

## Overview

`Component` exposes three size-hint setters that take two numbers — [`setPreferredSize`](packages/lib/src/typescript/lib/core/Component.ts#L2599), [`setMinSize`](packages/lib/src/typescript/lib/core/Component.ts#L2692), [`setMaxSize`](packages/lib/src/typescript/lib/core/Component.ts#L2734) — while the matching options-bag fields (`preferredSize`, `minSize`, `maxSize`) take a `Size` object. This plan removes that mismatch: all three setters take a single `Size`.

```typescript
setPreferredSize(size: Size): this
setMinSize(size: Size): this
setMaxSize(size: Size): this
```

This is a breaking change with no compatibility shim. Every call site in the library moves in the same commit — 215 call sites across 74 files in `packages/lib/src` and `packages/lib/tests`, plus 6 method declarations and the 3 forwarding lines in [`Component.applyOptions`](packages/lib/src/typescript/lib/core/Component.ts#L561). The library version goes to `0.2.0`.

The change is mechanical and is applied with `ast-grep`, not by hand. A missed call site is a compile error, never a silent bug — TypeScript is the safety net.

---

## Precondition

**Base this work on `master` after the existing 3-branch stack has merged.** Three unmerged branches are waiting: `feature/markdown-tables` → `feature/hash-router` → `feature/packages-docs`, 23 commits total. None of them touches `Component.ts`, but this change edits 74 files across the library and would force a painful rebase of the stack if it landed first. Do not start until `git log master` contains those commits.

---

## Architecture Decisions

### The `Size` parameter follows `setSize`

[`Component.setSize(size: Size)`](packages/lib/src/typescript/lib/core/Component.ts#L3026) already takes a single `Size` and is the pattern the three hint setters are being brought into line with.[^precedent] `setSize` itself does not change, and gains no two-number form.

### No `(width, height)` overload, no deprecation period

The two-number form is deleted outright.[^clean-break]

### `Size` is structural, so callers need no import

`Size` is an `export interface` in [`primitive/Size.ts`](packages/lib/src/typescript/lib/primitive/Size.ts#L8) with exactly two required fields, `width` and `height`. TypeScript matches object literals structurally, so `c.setMinSize({ width: 180, height: 0 })` compiles with no `import { Size }` anywhere. This is why the migration adds zero import lines to 74 files.

### No runtime type guard

The setters do not check that they received an object.[^no-guard]

### The stored `Size` stays a fresh copy

Each setter keeps building its own `{ width, height }` object rather than storing the caller's argument, so a caller that mutates its object afterwards cannot silently change the component's constraint.[^copy]

### Call sites migrate with `ast-grep`, in one commit

The rewrite is three `ast-grep` commands (given verbatim in the steps). The signature change and its 215 call sites land as **one** code commit.[^atomic]

### sqladmin is a separate plan

The 17 call sites in the sqladmin repo are **not** part of this plan.[^sqladmin]

---

## Public API

```typescript
// packages/lib/src/typescript/lib/core/Component.ts
setPreferredSize(size: Size): this
setMinSize(size: Size): this
setMaxSize(size: Size): this

// packages/lib/src/typescript/lib/component/display/Glyph.ts
setPreferredSize(size: Size): this        // also locks min and max to the same size

// packages/lib/src/typescript/lib/component/input/Text.ts
setPreferredSize(size: Size): this        // also sets _hasExplicitPreferredSize

// packages/lib/src/typescript/lib/component/button/Button.ts
setPreferredSize(size: Size): this        // also sets _consumerSetPreferredSize
```

Unchanged: `setSize(size: Size)`, `getPreferredSize()`, `getMinSize()`, `getMaxSize()`, the `preferredSize` / `minSize` / `maxSize` options-bag fields, the `Size` interface, `UNBOUNDED` / `isUnbounded` / `saturate`, and the `data-preferredSize` / `data-minSize` / `data-maxSize` attribute formats.

---

## The transformation

Every call site changes the same way. The rewrite wraps the two arguments in an object literal and touches nothing else.

| Before | After |
|---|---|
| `sidebar.setPreferredSize(240, 0)` | `sidebar.setPreferredSize({ width: 240, height: 0 })` |
| `this.setMaxSize(UNBOUNDED, THUMB_SIZE)` | `this.setMaxSize({ width: UNBOUNDED, height: THUMB_SIZE })` |
| `this.setMaxSize(Number.MAX_VALUE, Math.max(0, availableHeight))` | `this.setMaxSize({ width: Number.MAX_VALUE, height: Math.max(0, availableHeight) })` |
| `super.setPreferredSize(width, height)` | `super.setPreferredSize({ width: width, height: height })` |

The last row shows the property style to use: explicit `width: width`, not the `{ width, height }` shorthand. `Component.ts` writes its `Size` returns that way already, and it is what the `ast-grep` replacement produces.

---

## Ordered Implementation Steps

Work on a branch off `master` (after the precondition above is met).

### 1. Write the tests first

Add the cases from `## Expected Behaviour` to the existing test files:

| Cases | File |
|---|---|
| 1-7 (base setters) | [`packages/lib/tests/component/Component.test.ts`](packages/lib/tests/component/Component.test.ts) |
| 8 (Glyph lock) | [`packages/lib/tests/component/display/Glyph.test.ts`](packages/lib/tests/component/display/Glyph.test.ts) |
| 9 (Button pin) | [`packages/lib/tests/component/button/Button.test.ts`](packages/lib/tests/component/button/Button.test.ts) |
| 10 (Text explicit size) | [`packages/lib/tests/component/input/TextIntrinsicHeight.test.ts`](packages/lib/tests/component/input/TextIntrinsicHeight.test.ts) |

They will not compile until step 2 — that is expected; run them once step 4 is done.

### 2. Change the three base declarations

In [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts):

- `setPreferredSize` (line ~2599), `setMinSize` (~2692), `setMaxSize` (~2734): replace the `width: number, height: number` parameter list with `size: Size`.
- In each body, replace the early-return comparison operands and the `next` construction:

```typescript
setPreferredSize(size: Size): this {
    const prev = this._options.preferredSize;
    if (prev && prev.width === size.width && prev.height === size.height) {
        return this;
    }

    const next: Size = { width: size.width, height: size.height };
    // ... rest unchanged
```

  Apply the same two edits in `setMinSize` and `setMaxSize`. **Keep the `const next: Size = { … }` copy** — do not assign `size` directly (see the copy decision above).
- Update each JSDoc block: replace the two `@param width` / `@param height` lines with one `@param size` line. `setMaxSize`'s note about `UNBOUNDED` moves onto the `@param size` line.

### 3. Change the three overrides by hand

Each override's parameter list becomes `size: Size`, and its `super.` calls pass `size` straight through. Update each JSDoc `@param` block the same way as step 2.

- [`packages/lib/src/typescript/lib/component/display/Glyph.ts:284`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L284) — body becomes `super.setPreferredSize(size); super.setMinSize(size); super.setMaxSize(size);`
- [`packages/lib/src/typescript/lib/component/input/Text.ts:334`](packages/lib/src/typescript/lib/component/input/Text.ts#L334) — body becomes `this._hasExplicitPreferredSize = true; super.setPreferredSize(size);`
- [`packages/lib/src/typescript/lib/component/button/Button.ts:1865`](packages/lib/src/typescript/lib/component/button/Button.ts#L1865) — body becomes `this._consumerSetPreferredSize = true; super.setPreferredSize(size);`

Leave `Text.setCalculatedSize(width, height)` (line ~340) with its two-number signature — it is a private helper, not one of the three setters. Its `super.setPreferredSize(width, height)` call is fixed by step 4.

There are no overrides of `setMinSize` or `setMaxSize` anywhere in the repo.

### 4. Rewrite every call site

Run from the repo root. Preview first, then apply.

```bash
# Preview (prints the diff, changes nothing)
ast-grep -p '$R.setPreferredSize($W, $H)' -r '$R.setPreferredSize({ width: $W, height: $H })' -l ts --dry packages/lib/src packages/lib/tests
```

Then apply all three:

```bash
ast-grep -p '$R.setPreferredSize($W, $H)' -r '$R.setPreferredSize({ width: $W, height: $H })' -l ts -U packages/lib/src packages/lib/tests
ast-grep -p '$R.setMinSize($W, $H)'       -r '$R.setMinSize({ width: $W, height: $H })'       -l ts -U packages/lib/src packages/lib/tests
ast-grep -p '$R.setMaxSize($W, $H)'       -r '$R.setMaxSize({ width: $W, height: $H })'       -l ts -U packages/lib/src packages/lib/tests
```

Expected counts on a `master` baseline: 102, 51, 62 — 215 total. Use `/usr/local/bin/ast-grep`, not `sg` (on Linux `sg` is the group-switching command).

The pattern matches call expressions only, so it does not touch the method declarations from steps 2 and 3. It matches `super.setX(...)` as well as `this.setX(...)` and `someChild.setX(...)`.

### 5. Fix the three `applyOptions` forwarders

In [`packages/lib/src/typescript/lib/core/Component.ts:561-563`](packages/lib/src/typescript/lib/core/Component.ts#L561), the three lines currently split the bag's `Size` apart only to rebuild it. Pass it through:

```typescript
if (options.preferredSize   !== undefined) this.setPreferredSize(options.preferredSize);
if (options.minSize         !== undefined) this.setMinSize(options.minSize);
if (options.maxSize         !== undefined) this.setMaxSize(options.maxSize);
```

Keep the column alignment of the surrounding block.

### 6. Prove nothing was missed

```bash
# Each must print nothing.
ast-grep -p '$R.setPreferredSize($W, $H)' -l ts packages/lib/src packages/lib/tests
ast-grep -p '$R.setMinSize($W, $H)'       -l ts packages/lib/src packages/lib/tests
ast-grep -p '$R.setMaxSize($W, $H)'       -l ts packages/lib/src packages/lib/tests
```

Then run the type checks — these are the real proof:

```bash
npm run typecheck        # packages/lib source
npm -w packages/lib run typecheck:test
npm run lint
npm run test
```

### 7. Bump the version

In [`packages/lib/package.json`](packages/lib/package.json#L3), `"version": "0.1.0"` → `"version": "0.2.0"`.

### 8. Update the docs

Rewrite every authored code sample and signature mention. The generated `packages/lib/docs/api/` tree is git-ignored and regenerates — do not edit it.

| File | What to change |
|---|---|
| `packages/lib/docs/concepts/sizing.md` | Lines 9-11 signature table (`setPreferredSize(w, h)` → `setPreferredSize(size)`); the `setMinSize(200, 0)` / `setMaxSize(0, 0)` prose at line 41; the code block at lines 44-46; the `setMinSize(120, 0)` / `setPreferredSize(0, 0)` example at line 53 |
| `packages/lib/docs/guide/mental-model.md` | Line 111 `setPreferredSize(200, 100)` |
| `packages/lib/docs/layouts/Absolute.md` | Line 27 |
| `packages/lib/docs/concepts/component-lifecycle.md` | Line 80 |
| `packages/lib/docs/components/TextArea.md`, `TextField.md`, `UsernameField.md`, `PasswordField.md`, `ProgressBar.md`, `MultiSelectList.md`, `Slider.md`, `Image.md`, `List.md` | One `setPreferredSize(w, h)` code line each (`Image.md` also has a signature-table row at line 19) |
| `packages/lib/docs/components/Canvas.md`, `WebGLCanvas.md` | Signature-table row `setPreferredSize(w, h)` |

These files mention the setters by bare name with no signature and need **no** edit: `packages/lib/docs/concepts/performance.md`, `concepts/layout-system.md`, `reference/faq.md`, `components/Button.md`, `components/TabCloseButton.md`, `components/Markdown.md`, `packages/lib/llms.txt`, and the three mentions in `ARCHITECTURE.md`'s *Size constraints: who is responsible for what* section.

**Do not touch `plans/implemented/`.** Those are historical records of past work, not live documentation.

### 9. Add the release notes

- [`packages/lib/docs/reference/changelog.md`](packages/lib/docs/reference/changelog.md): add a `## 0.2.0` section above `## 0.1.0`, stating that `setPreferredSize` / `setMinSize` / `setMaxSize` now take a single `Size` and showing the before/after one-liner.
- [`packages/lib/docs/reference/migration.md`](packages/lib/docs/reference/migration.md): add a `## 0.1.0 → 0.2.0` section with the same before/after, noting that `Size` is structural so no import is needed, and that `npm run typecheck` surfaces every affected site. While there, fix the stale opening line — it says the framework is "currently at **v0.0.0** — pre-release, not yet published", which the new entry directly contradicts.

### 10. Rebuild the docs

```bash
npm run docs:build
```

Must finish with **0 errors and 0 link warnings** (typedoc's "unsupported TypeScript version" notice is the one accepted exception).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` (3 declarations, 3 `applyOptions` lines) |
| Modify | `packages/lib/src/typescript/lib/component/display/Glyph.ts` (override) |
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` (override + `setCalculatedSize` body) |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` (override) |
| Modify | ~70 further files under `packages/lib/src` and `packages/lib/tests` — call sites only, all rewritten by step 4 |
| Modify | `packages/lib/package.json` (version → `0.2.0`) |
| Modify | `packages/lib/tests/component/Component.test.ts`, `packages/lib/tests/component/display/Glyph.test.ts` (new cases) |
| Modify | `packages/lib/docs/concepts/sizing.md`, `guide/mental-model.md`, `layouts/Absolute.md`, `concepts/component-lifecycle.md`, and the component pages listed in step 8 |
| Modify | `packages/lib/docs/reference/changelog.md`, `packages/lib/docs/reference/migration.md` |

Nothing is created or deleted.

---

## Expected Behaviour

All of these are unit-testable in the offline harness — none needs a browser.

**Base setters**

1. `c.setPreferredSize({ width: 120, height: 32 })` → `c.getPreferredSize()` reports `{ width: 120, height: 32 }`.
2. `c.setMinSize({ width: 180, height: 0 })` → the component's CSS rule carries `minWidth: "180px"`, `minHeight: "0px"`, and the `data-minSize` attribute matches the pre-change format.
3. `c.setMaxSize({ width: UNBOUNDED, height: 24 })` → CSS rule carries `maxWidth: "none"` (the `isUnbounded` branch) and `maxHeight: "24px"`.
4. **Value equality, not object identity.** Calling `setPreferredSize({ width: 10, height: 10 })` twice with two *different* objects of equal value fires the preferred-size-change callback once, not twice. The early return compares fields.
5. **The stored size is a copy.** After `const s = { width: 10, height: 10 }; c.setPreferredSize(s); s.width = 999;`, `c.getPreferredSize()` still reports width `10`.
6. **Options bag and setter agree.** `new Component({ preferredSize: { width: 200, height: 100 } })` produces the same reported preferred size as `new Component().setPreferredSize({ width: 200, height: 100 })`. Same for `minSize` and `maxSize`.
7. All three setters still return `this`, so `c.setMinSize({…}).setMaxSize({…})` chains.

**Overrides**

8. `glyph.setPreferredSize({ width: 16, height: 16 })` locks all three hints: min, preferred, and max all report `16 × 16`.
9. `button.setPreferredSize({ width: 100, height: 40 })` pins the size — a later internal recompute does not overwrite it.
10. `text.setPreferredSize({ width: 80, height: 20 })` suppresses the auto-measured size; a subsequent measurement does not overwrite the explicit value.

**Manual check**

11. Run the dev app (`npm run dev`, http://localhost:8015) and click through the demo panels — every panel is a call site. Layouts must look identical to before the change. The demo panels are the only place a wrong-argument regression would show visually rather than as a compile error.

---

## Verification

1. `npm run typecheck` and `npm -w packages/lib run typecheck:test` — both clean. This is the completeness proof: any missed call site is a compile error here.
2. The three `ast-grep` searches from step 6 print nothing.
3. `npm run test` — full suite green, including the new cases.
4. `npm run lint` — clean.
5. `npm run docs:build` — 0 errors, 0 link warnings.
6. `grep -rnE 'set(Preferred|Min|Max)Size\([^{)]+,' packages/lib/docs --include='*.md' | grep -v docs/api` — no matches (catches a doc sample missed in step 8).
7. Manual: the dev-app pass from behaviour case 11.

---

## Documentation Impact

The three setters are public members of `Component`, exported from `@jimka/typescript-ui/core`. Their API pages under `packages/lib/docs/api/` regenerate from the JSDoc — no hand-edit, and the tree is git-ignored. The authored pages needing edits are enumerated in step 8; the release notes in step 9 are the consumer-facing record of the break.

`packages/lib/llms.txt` mentions the three names at line 104 without signatures, so it needs no change. It is regenerated by `npm run docs:llms` as part of `docs:build`; that run should leave it byte-identical.

---

## Potential Challenges

- **The rewrite silently matching nothing.** An `ast-grep` pattern that fails to parse matches zero nodes and reports success. Mitigation: step 4 requires running `--dry` first and comparing against the expected counts (102 / 51 / 62).
- **`sg` is not `ast-grep` on Linux.** `/usr/bin/sg` is the group-switching command. Mitigation: the steps spell out `ast-grep`.
- **The version bump is easy to forget** because nothing fails without it. Mitigation: it is its own step, and the changelog entry in step 9 names the version.
- **Publishing to npm is a human step.** Nothing in this plan runs `npm publish`; the follow-up sqladmin work is blocked until a human does.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — the three setters (~2599 / ~2692 / ~2734), the `applyOptions` forwarders (561-563), and the `setSize(size: Size)` precedent at ~3026.
- [`packages/lib/src/typescript/lib/primitive/Size.ts`](packages/lib/src/typescript/lib/primitive/Size.ts) — the `Size` interface and the `UNBOUNDED` / `isUnbounded` / `saturate` sentinel helpers.
- [`packages/lib/src/typescript/lib/component/display/Glyph.ts:284`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L284), [`component/input/Text.ts:334`](packages/lib/src/typescript/lib/component/input/Text.ts#L334), [`component/button/Button.ts:1865`](packages/lib/src/typescript/lib/component/button/Button.ts#L1865) — the three overrides.
- [`packages/lib/docs/concepts/sizing.md`](packages/lib/docs/concepts/sizing.md) — the consumer-facing sizing doc, and the page with the most signature mentions.
- [`ARCHITECTURE.md`](ARCHITECTURE.md), section *Size constraints: who is responsible for what* — the rules these setters implement.

---

## Non-Goals

- **No `(width, height)` overload and no deprecation window.** The old form is gone in `0.2.0`.
- **No change to `setSize`, `setWidth`, `setHeight`, or any getter.**
- **No opportunistic rewriting of call sites.** Several sites become expressible more neatly once a `Size` is accepted — e.g. `this.setPreferredSize(field.getWidth(), field.getHeight())` in `validation/FieldDecorator.ts` could become `this.setPreferredSize(field.getSize())`. Leave them as the mechanical wrap produces. Changing behaviour under cover of a mechanical migration is how regressions get in.
- **No normalising of `Number.MAX_VALUE` to `UNBOUNDED`.** Several `setMaxSize` sites pass `Number.MAX_VALUE` where `UNBOUNDED` is the current idiom (`overlay/Menu.ts`, `component/container/TabBar.ts`, `component/container/ScrollStrip.ts`, `src/typescript/BindingPanel.ts`). `isUnbounded` accepts both. That cleanup is a separate change.
- **No runtime argument validation.**
- **No sqladmin changes.** They are blocked on `0.2.0` being published to npm and belong in their own plan (see the sqladmin decision above).
- **No new root `CHANGELOG.md`.** The project already keeps release history in `packages/lib/docs/reference/changelog.md`.

---

## Implementation Notes

- **Two of the plan's ten test cases were missed on the first pass and added
  during the audit fix cycle.** Cases 9 (Button pins a consumer-set preferred
  size against a later `recomputePreferredSize`) and 10 (an explicit
  `Text.setPreferredSize` suppresses auto-measure) were specified for
  `Button.test.ts` and `TextIntrinsicHeight.test.ts`, and both files were
  initially left untouched — so the two rewritten override bodies shipped with
  no coverage. Both tests now exist and were verified non-vacuous by disabling
  each guard in turn and confirming they go red.
- **The base version was `0.1.1`, not the `0.1.0` the plan assumed.** `0.1.1`
  shipped after the plan was written. `packages/lib/package.json` was correctly
  bumped `0.1.1` → `0.2.0`, but the plan's prose carried the stale predecessor
  into the migration page, which claimed to document a `0.1.0 → 0.2.0` upgrade
  and so was wrong for anyone on the published `0.1.1`. The heading is now
  **"Upgrading from 0.1.x to 0.2.0"**, which covers both shipped releases.
- **That heading change also fixed a silently broken anchor.** The original
  heading `## 0.1.0 → 0.2.0` slugifies to `_0-1-0-→-0-2-0` under VitePress's
  rules — digit-initial headings get an `_` prefix, and `→` is not in the
  special-character class, so it survives verbatim. The changelog's link to
  `#0-1-0-0-2-0` therefore matched nothing and landed readers at the top of the
  page. `ignoreDeadLinks: true` in `.vitepress/config.mts` is why `docs:build`
  stayed green. The replacement slug, `upgrading-from-0-1-x-to-0-2-0`, was
  verified against VitePress's own `slugify` implementation rather than assumed.
- **`setMinSize` had 52 call sites, not the 51 the plan predicted.** The other
  two counts matched (`setPreferredSize` 102, `setMaxSize` 62). No behavioural
  significance; recorded because the plan states a specific number.
- **Three prose comments were re-flowed in an unplanned commit.** They quoted
  the two-number form (`setPreferredSize(0, 30)` and similar) and so described a
  signature that no longer compiles. No plan step called for this; it is cleanup
  of staleness that this change itself introduced.
- **One unplanned documentation fix:** the stale `setSize(w, h)` row in
  `packages/lib/docs/concepts/sizing.md` was corrected alongside the planned
  edits.

---

## Notes

[^precedent]: The precedent search covered every size-related setter on `Component`. `setSize(size: Size)` at `Component.ts:3026` is the only sibling that takes a size at all, and it already takes the interface. `setX` / `setY` / `setWidth` / `setHeight` are single-scalar setters, so they establish nothing either way. The options bag has taken `Size` objects for `preferredSize` / `minSize` / `maxSize` since it existed. So the two-number form is the outlier, not the norm — this change removes an inconsistency rather than introducing a new pattern.

[^clean-break]: The package is at `0.1.0`. `packages/lib/docs/reference/migration.md` already states the policy this plan follows: "**`0.x.y` (pre-release)** — anything may change in any release, including breaking the public API." An additive overload would have to be carried until `1.0.0` and would keep the inconsistency visible in the type signature — which is the thing being fixed. Pre-1.0 is the cheapest moment to break: the only known external consumer is sqladmin, at 17 call sites.

[^no-guard]: Argued both ways. **For a guard:** a plain-JS consumer calling `c.setMinSize(180, 0)` gets `size.width === undefined`, the CSS write becomes `minWidth: "undefinedpx"`, the browser drops the invalid declaration, and the layout is quietly wrong. **Against, and decisive:** (a) there is no precedent — the library contains zero `typeof x !== "number"` argument checks and zero dev-mode branches (`import.meta.env.DEV`, `process.env.NODE_ENV`, `__DEV__` all appear nowhere in `packages/lib/src/typescript/lib`), so a guard would be a new pattern introduced for one method family; (b) with no dev/prod build split the check would ship to production on a path that runs during every layout negotiation; (c) the failure is not actually silent — DevTools shows the rejected `minWidth: undefinedpx` declaration and the component's `data-minSize` attribute renders as `undefined`, both of which point straight at the setter; (d) the library ships `.d.ts` files, so every TypeScript consumer gets a compile error, and the changelog and migration entries cover the rest.

[^copy]: The current setters already build `const next: Size = { width, height }` because they receive loose numbers. Once a `Size` comes in, assigning it directly to `this._options.preferredSize` would be shorter but would alias the caller's object into component state — a caller reusing one scratch `Size` across several components would wire them all together. Keeping the copy preserves today's behaviour exactly and costs one object allocation per *changed* size (the early return means an unchanged size allocates nothing).

[^atomic]: The `commit` skill's rule is one functionality per code commit, and splitting is allowed "only when the branch ships genuinely independent functionalities". A signature change and its call sites are not independent: neither half compiles alone, so a split would put a broken build in the branch's history and break `git bisect`. The whole thing — declarations, overrides, 215 call sites, tests, and the version bump — is one code commit, followed by a separate documentation commit for step 8 and step 9 (docs are their own bucket). Size is not a reason to split; 215 lines of identical mechanical wrap read as one diff.

[^sqladmin]: sqladmin (`/home/jika/typescript/sqladmin`, base branch local `main`) has 17 call sites in 7 files: `frontend/src/shell/{treeExplorerView,ActivityBar,SqlAdminShell}.ts` and `frontend/src/dock/{ExplainNode,StructurePanel,ExplainDiagramPanel,TableCardNode}.ts` — `setPreferredSize` 9, `setMinSize` 6, `setMaxSize` 2, `setSize` 0. It consumes the library from npm as `"@jimka/typescript-ui": "^0.1.0"`; there is no symlink or local path resolution. A caret range on a `0.x` version pins the minor, so `0.2.0` is not picked up by an `npm update` — sqladmin needs an explicit bump to `^0.2.0`, and cannot even install the new version until a human has published it. That publish sits between the two halves and no plan can execute across it. Keeping the sqladmin work here would leave a plan permanently half-done in `plans/`; as its own plan it is a clean, self-contained unit (bump the dependency, run the same three `ast-grep` commands over `frontend/src`, typecheck) that starts the moment `0.2.0` is on npm. The forced order is: this plan → merge → `npm publish` (human) → the sqladmin plan.
