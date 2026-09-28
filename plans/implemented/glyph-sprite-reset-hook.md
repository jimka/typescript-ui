---
touches-shared:
  - packages/lib/tests/component/activation-after-dispose.test.ts
---

# Glyph sprite reset hook — Implementation Plan

`component/display/Glyphs.ts` keeps the shared hidden SVG sprite in three
module-level variables: `_spriteMounted` and `_spriteElement`
([packages/lib/src/typescript/lib/component/display/Glyphs.ts:57-58](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L57))
and the `_mountedSymbols` record at
[Glyphs.ts:65](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L65).
All three are set once — the sprite at
[Glyphs.ts:132-133](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L132)
— and nothing in the library ever clears them. A `Handle` is only meaningful in
the registry that minted it, and `DOM.reset()`
([core/DOM.ts:3327](packages/lib/src/typescript/lib/core/DOM.ts#L3327)) throws
that registry away. So the first SVG glyph mounted after a reset appends a
`<symbol>` through a dead handle, into whatever element now holds that recycled
handle number.[^reproduced]

This plan gives `Glyphs.ts` a fourth module variable holding the sink its
handles were minted against, and a private helper that drops all sprite state
when `DOM.sink` is a different object. The pattern is
[core/ThemeVars.ts:35](packages/lib/src/typescript/lib/core/ThemeVars.ts#L35)'s,
applied to the write seam instead of the read seam. Nothing is exported, no new
API lands on `DOM`, and no test suite has to remember a teardown call.
`packages/lib/docs/concepts/dom-seams.md` gains the same rule in prose.

Three follow-ons ride along: `activation-after-dispose`'s `beforeAll` priming
workaround
([tests/component/activation-after-dispose.test.ts:29-44](packages/lib/tests/component/activation-after-dispose.test.ts#L29))
is deleted, one `Tree` case that passes only because a previous case's
`<symbol>` was still mounted gains a warm-up, and the false sentence in
[plans/research/render-review-2026-09-15/13-button-glyph-image.md:387-388](plans/research/render-review-2026-09-15/13-button-glyph-image.md#L387)
— which claims `DOM.reset()` "already resets
`_spriteMounted`/`_spriteElement`" — is corrected.

---

## Architecture Decisions

### The reset signal is the sink's own identity, checked lazily

`Glyphs.ts` remembers which `DOMSink` object minted its handles and compares it
against `DOM.sink` at the top of every exported function that touches sprite
state. A different object means the handles are dead, so the sprite record is
dropped and the next mount builds a fresh sprite. This identity check mirrors
[core/ThemeVars.ts:35](packages/lib/src/typescript/lib/core/ThemeVars.ts#L35),
which clears its cached theme-variable values the same way when `DOM.source`
changes.[^why-lazy-check]

### The check is keyed on `DOM.sink`, not `DOM.source`

The sprite handles are minted and consumed by the write seam, and six test
files install a spy *source* over the live sink without invalidating a single
handle. Keying on `DOM.source` would throw away a perfectly good sprite mid-test
in each of them.[^why-sink]

| Call | `DOM.sink` after | `DOM.source` after | Sprite state |
|---|---|---|---|
| `DOM.reset()` | new `ProductionDOMSink` | new `ProductionDOMSource` | dropped |
| `installTestDOM(config)` | new `RecordingDOMSink` | new `ModelledDOMSource` | dropped |
| `DOM.install({ source: spy })` | unchanged | spy | kept |
| `DOM.install({ sink: recorder })` | recorder | unchanged | dropped |

### `DOM` gains no registry of resettable module caches

There is no `DOM.onReset` list and no registration call. Exactly two modules in
the library cache a handle to a document-level singleton they created and expect
to find again for the module's lifetime — `Glyphs` and `core/Favicon.ts` — which
is one client too few to justify the machinery, and a `DOM.reset()`-only
registry would miss the `installTestDOM` and `DOM.install` cases the identity
check covers for free.[^why-no-registry]

### The sprite state stays module-level, and the definition registry is never cleared

`_spriteMounted`, `_spriteElement` and `_mountedSymbols` keep their current
scope; only their lifetime changes. `_glyphs`
([Glyphs.ts:34](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L34))
is untouched by the new helper — a `GlyphDef` is plain data with no handle in
it, apps register their icon set once at startup, and clearing it on a seam swap
would silently unregister every glyph.[^why-keep-registry]

### The rule is written into the seam doc rather than into new code

`packages/lib/docs/concepts/dom-seams.md` gains one paragraph in its *Swapping
the seams* section stating that a module caching a `Handle` between calls must
remember the seam that minted it and drop the cache when that seam is replaced.
That paragraph, plus the two worked instances it names, is the general answer
the registry would otherwise have been.[^why-doc]

---

## Internal Structure

Added to `Glyphs.ts` immediately after the `_mountedSymbols` declaration at
[Glyphs.ts:65](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L65):

```typescript
/**
 * The sink the sprite element and every mounted symbol above were minted
 * against. A `Handle` only resolves in the registry that minted it, so a
 * swapped sink invalidates all of them at once.
 */
let _spriteSink: DOMSink | null = null;

/**
 * Drops the sprite and its mounted-symbol record when `DOM.sink` is no longer
 * the sink they were built against, so the next mount builds a fresh sprite in
 * the live document instead of appending through a dead handle. Called first by
 * every exported function that touches sprite state.
 *
 * The dropped handles are not released: they belong to a registry that no
 * longer exists, and the sink that could release them is already gone. The
 * glyph *definition* registry is left alone — a `GlyphDef` holds no handle and
 * outlives any seam.
 */
function _forgetSpriteIfSinkChanged(): void {
    if (_spriteSink === DOM.sink) {
        return;
    }

    _spriteSink    = DOM.sink;
    _spriteElement = null;
    _spriteMounted = false;
    _mountedSymbols.clear();
}
```

`DOMSink` comes from the existing type-only import at
[Glyphs.ts:4](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L4),
which becomes `import type { DOMSink, Handle } from "~/core/DOM.js";`.

Four exported functions call the helper as their first statement.
`_addSymbolToSprite` and `_removeSymbolFromSprite` need no call of their own —
every path into them runs through one of the four first.

| Function | Line | Why it needs the call |
|---|---|---|
| `registerGlyph` | [74](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L74) | reads `_spriteMounted` to decide whether to mount now |
| `unregisterGlyph` | [88](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L88) | reads `_spriteMounted` to decide whether to unmount |
| `ensureGlyphSprite` | [117](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L117) | its `if (_spriteMounted) return;` early-out is the stale claim |
| `ensureGlyphSymbolMounted` | [143](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L143) | its `if (!_spriteMounted) return;` early-out is the stale claim |

`lookupGlyph` touches no sprite state and gets no call.

**Ordering rule:** in `ensureGlyphSprite` and `ensureGlyphSymbolMounted` the
helper call goes *above* the existing `_spriteMounted` early-out, not below it.
Below it, a stale `_spriteMounted === true` would return before the check ever
ran.

---

## Ordered Implementation Steps

1. **Write the failing test file.** Create
   `packages/lib/tests/component/display/GlyphSpriteSinkSwap.test.ts` with the
   `// @vitest-environment jsdom` pragma on line 1 and the four cases in
   `## Expected Behaviour` (S1–S4). It must not call `installTestDOM` — the
   modelled DOM cannot see the corruption.[^why-jsdom-here] Run
   `npx vitest run tests/component/display/GlyphSpriteSinkSwap.test.ts` from
   `packages/lib` — expect S1, S2 and S4 to fail and S3 to pass.

2. **Widen the type import** in
   `packages/lib/src/typescript/lib/component/display/Glyphs.ts` line 4 to
   `import type { DOMSink, Handle } from "~/core/DOM.js";`.

3. **Add `_spriteSink` and `_forgetSpriteIfSinkChanged`** to `Glyphs.ts`
   directly after the `_mountedSymbols` declaration, exactly as given in
   `## Internal Structure`.

4. **Call `_forgetSpriteIfSinkChanged()`** as the first statement of `registerGlyph`,
   `unregisterGlyph`, `ensureGlyphSprite` and `ensureGlyphSymbolMounted`,
   followed by a blank line. In the latter two it goes above the existing
   `_spriteMounted` early-out.

5. **Re-run step 1's file** — expect all four cases green. Then
   `npx eslint src/typescript/lib/component/display/Glyphs.ts` (the
   `local/no-raw-dom` rule has an empty baseline and must stay silent) and
   `npm run typecheck`.

6. **Delete the priming workaround.** In
   `packages/lib/tests/component/activation-after-dispose.test.ts`, delete lines
   29–44: the `// Primes the shared SVG glyph sprite …` comment block, the
   `beforeAll` it introduces, and the blank line after it. Drop `beforeAll` from
   the `vitest` import on line 20. Run
   `npx vitest run tests/component/activation-after-dispose.test.ts` — expect
   8 passing.

7. **Add the warm-up to the `Tree` icon-rebinding case.** In
   `packages/lib/tests/component/tree/Tree.test.ts`, immediately before the
   `sink.writes.length = 0;` at line 4096, insert:

   ```typescript
   // Warm-up: the incoming name's sprite `<symbol>` is mounted on its first
   // use in this case, which is a sprite write rather than an icon rebuild.
   // Mount it here so the count below sees only the rename.
   new Glyph('iltnr-b').getElement(true);
   ```

   `Glyph` is already imported at line 12. Run
   `npx vitest run tests/component/tree/Tree.test.ts` — expect 198 passing.

8. **Correct the three comments the change falsifies.** Each currently asserts
   that `DOM.reset()` leaves the sprite alone or that the sprite is mounted
   once per process. Replacement wording is in `## Expected Behaviour` under
   *Comment corrections*.
   - `packages/lib/tests/component/display/GlyphRenameSpriteMount.test.ts:9-15`
   - `packages/lib/tests/component/display/Glyph.test.ts:350-353`
   - `packages/lib/tests/component/button/Button.test.ts:565-566`

9. **Correct the research report.** In
   `plans/research/render-review-2026-09-15/13-button-glyph-image.md`, rewrite
   the *Risk / blast radius* bullet at lines 385-390 and append a dated
   correction bullet — text in `## Expected Behaviour` under *Report
   correction*. Then
   `grep -n 'already resets' plans/research/render-review-2026-09-15/13-button-glyph-image.md`
   — expect zero matches.

10. **Add the seam-doc paragraph.** In
    `packages/lib/docs/concepts/dom-seams.md`, insert after line 37 (the
    paragraph ending "it just reads `DOM.sink` / `DOM.source`."), as one
    unwrapped line matching the file's style:

    > A module that caches a `Handle` between calls must also remember which
    > seam minted it, and drop the cache when that seam is replaced — a handle
    > only resolves in the registry that minted it, so `install` and `reset`
    > invalidate every handle held anywhere in the library at once. The pattern
    > is a one-line identity check at the top of each entry point that touches
    > the cache, keyed on whichever seam produced the cached state:
    > `core/ThemeVars.ts` compares `DOM.source` before answering a cached theme
    > variable, and `component/display/Glyphs.ts` compares `DOM.sink` before
    > touching the shared glyph sprite. Nothing registers with `DOM`, and no
    > suite has to remember a teardown call.

11. **Run the whole suite**: `npm run test` from `packages/lib`
    (`typecheck:test` then `vitest run`). Expect 513 files and 8576 tests, of
    which 2 are `todo` and none fail.[^suite-baseline]

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Glyphs.ts` |
| Create | `packages/lib/tests/component/display/GlyphSpriteSinkSwap.test.ts` |
| Modify | `packages/lib/tests/component/activation-after-dispose.test.ts` — **shared** with the `test-dom-handle-eviction` plan[^shared-file] |
| Modify | `packages/lib/tests/component/tree/Tree.test.ts` |
| Modify | `packages/lib/tests/component/display/GlyphRenameSpriteMount.test.ts` — comment only |
| Modify | `packages/lib/tests/component/display/Glyph.test.ts` — comment only |
| Modify | `packages/lib/tests/component/button/Button.test.ts` — comment only |
| Modify | `packages/lib/docs/concepts/dom-seams.md` |
| Modify | `plans/research/render-review-2026-09-15/13-button-glyph-image.md` |

---

## Expected Behaviour

All four cases are unit-testable in the new jsdom file. They share the fixture
given below the table: two SVG-mode glyph definitions named `gss-alpha` and
`gss-beta` registered once at module scope[^top-level-register], an
`afterEach` of `DOM.reset()`, and the two helpers `symbolParent(name)` and
`spriteCount()`.

| Case | Steps | Assertion | Pins |
|---|---|---|---|
| **S1** | render `gss-alpha`; `DOM.reset()`; render `gss-beta` | `symbolParent('gss-beta') === 'svg'` | a first-seen symbol after a reset lands in a live sprite and throws nothing |
| **S2** | render `gss-alpha`; record `spriteCount()`; `DOM.reset()`; render `gss-alpha` again | count is `before + 1` **and** `symbolParent('gss-alpha') === 'svg'` | the sprite is rebuilt rather than reused, and the mounted-symbol record was cleared with it |
| **S3** | render `gss-alpha`; `DOM.reset()`; `lookupGlyph('gss-alpha')` | is defined | the definition registry survives — the helper must not clear `_glyphs` |
| **S4** | render `gss-alpha`; record `spriteCount()`; `DOM.install({ source: Object.create(DOM.source) })`; render `gss-beta` | count is unchanged **and** `symbolParent('gss-beta') === 'svg'` | a source-only swap keeps the sprite — this is the case that fails if the check is keyed on `DOM.source` |

### The new test file's fixture

Everything above the cases, verified to typecheck under
`tsconfig.test.json` and to fail on S1/S2/S4 before the fix:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { Glyph } from '~/component/display/Glyph';
import { lookupGlyph } from '~/component/display/Glyphs';

const ALPHA = { name: 'gss-alpha', kind: 'svg' as const, viewBox: '0 0 512 512', path: 'M0 0h512v512z' };
const BETA  = { name: 'gss-beta',  kind: 'svg' as const, viewBox: '0 0 512 512', path: 'M0 0h256v256z' };

Glyph.register(ALPHA, BETA);

afterEach(() => { DOM.reset(); });

/** The tag name of the element holding the `<symbol>` for `name`, or `'MISSING'`. */
function symbolParent(name: string): string {
    return document.querySelector('#ts-glyph-' + name)?.parentElement?.tagName ?? 'MISSING';
}

/** Every hidden sprite `<svg>` currently under the body. */
function spriteCount(): number {
    return document.body.querySelectorAll('svg[aria-hidden="true"]').length;
}
```

Each case renders a glyph with `new Glyph(name).getElement(true)` — unattached
to any host, which is enough to mount the sprite. `describe` title:
`'glyph sprite across a seam swap'`.

Suite-level behaviours, all covered by step 11's full run:

- `tests/component/activation-after-dispose.test.ts` passes all 8 cases with no
  priming step. Without the fix and without the priming, case A2 fails with
  `HierarchyRequestError`.
- `tests/component/tree/Tree.test.ts`'s *"a resolver returning a different name
  renames the same icon instance and builds nothing"* still asserts zero
  `createElementNS` writes, now with the warm-up supplying the `<symbol>` mount
  ahead of the measurement.
- No other test changes result. The full suite was run against a working copy of
  this change: one failure, the `Tree` case above.[^suite-baseline]

### Comment corrections

`GlyphRenameSpriteMount.test.ts` lines 9-15, replacing *"This needs its own
file, and exactly one case in it. The sprite and its mounted-symbol record are
module state that `DOM.reset()` does not touch, …"*:

```
// The sprite and its mounted-symbol record are module state, dropped when the
// installed sink changes — which `beforeEach`'s `installTestDOM` does, so this
// case starts with no sprite at all. Within the case, the moment anything has
// rendered an SVG glyph every later `Glyph.register` mounts its `<symbol>`
// there and then, leaving the rename nothing to mount, so the registration
// below must come before the first render. The file kept its own single case
// from when the sprite survived every reset and only a fresh module instance
// could stage this.
```

`Glyph.test.ts` lines 350-353, replacing the same claim:

```
// setGlyphName — the in-place rename. `beforeEach`'s `installTestDOM` swaps the
// sink, which drops the sprite and its mounted-symbol record, so each case
// starts with an empty sprite. Every case below that asserts a `<symbol>` mount
// still registers a name no other case in this file uses and drops it again
// afterwards, because the glyph *definition* registry does outlive a swap.
```

`Button.test.ts` lines 565-566, replacing *"the check sprite `<symbol>` is
module state mounted once per process, not once per rename"*:

```
        // Warm-up swap first: the check sprite `<symbol>` is mounted once per
        // installed sink, not once per rename.
```

### Report correction

`13-button-glyph-image.md` lines 385-390 become:

```
- **Risk / blast radius**: `Glyphs.ts` has three internal callers
  (`registerGlyph`, `unregisterGlyph`, `ensureGlyphSymbolMounted`) and no
  external ones; the set and the DOM must be kept in step across `DOM.reset()`.
  `tests/component/display/Glyph.test.ts` registers and unregisters SVG glyphs,
  which exercises both directions.
- **Correction (2026-09-26)**: the bullet above originally said `DOM.reset()`
  "already resets `_spriteMounted`/`_spriteElement`". It never did — nothing in
  the library cleared either variable, and the mounted-symbol set shipped with
  the same hole. `plans/glyph-sprite-reset-hook.md` closes it.
```

---

## Verification

From `packages/lib`:

- `npx vitest run tests/component/display/GlyphSpriteSinkSwap.test.ts` — 4
  passing. Before step 4 is complete, S1/S2/S4 must fail; a green run at that
  point means
  the test does not reach the defect.
- `npx vitest run tests/component/activation-after-dispose.test.ts` — 8 passing
  with the `beforeAll` gone.
- `npx vitest run tests/component/tree/Tree.test.ts` — 198 passing.
- `npm run typecheck` and `npm run typecheck:test` — both clean.
- `npx eslint src/typescript/lib/component/display/Glyphs.ts` — silent.
- `npm run test` — 513 files, 8576 tests (2 `todo`), none failing.
- `grep -rn 'already resets' plans/research/render-review-2026-09-15/13-button-glyph-image.md`
  — zero matches.
- `grep -n 'beforeAll' packages/lib/tests/component/activation-after-dispose.test.ts`
  — zero matches.

Nothing here needs a browser, a window, or `packages/qa`. The visual behaviour
is unchanged: production never calls `DOM.install` or `DOM.reset`, so
`_spriteSink` is assigned once on the first glyph mount and the comparison
succeeds forever after.

---

## Potential Challenges

- **A jsdom suite that resets repeatedly accumulates orphan sprites.** The real
  document survives `DOM.reset()`, so a dropped sprite `<svg>` stays in the body
  and the rebuilt one sits beside it, giving the document two `<symbol>`
  elements with the same id. `<use href="#id">` resolves to the first in
  document order, which carries identical path data, so rendering is unaffected;
  the elements are hidden and zero-sized; and only tests ever reset. S2 asserts
  the extra sprite deliberately, so the behaviour is pinned rather than
  accidental.
- **A test may currently pass only because an earlier case left a `<symbol>`
  mounted.** Step 11's full run is how that is found; exactly one such case
  exists today and step 7 fixes it.
- **Forgetting the ordering rule in step 4** leaves `ensureGlyphSprite` returning
  on a stale `_spriteMounted` before the check runs, which looks like the fix
  did nothing. S1 catches it.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/ThemeVars.ts](packages/lib/src/typescript/lib/core/ThemeVars.ts)
  — the precedent. Lines 22-24 and 35-38 are the whole pattern: remember the
  seam, compare by identity, clear on mismatch.
- [packages/lib/src/typescript/lib/core/DOM.ts:3313-3340](packages/lib/src/typescript/lib/core/DOM.ts#L3313)
  — `DOM.install` / `DOM.reset`, and why both produce new seam objects.
- [packages/lib/src/typescript/lib/core/DOM.ts:458-472](packages/lib/src/typescript/lib/core/DOM.ts#L458)
  — `HandleRegistry.resolve`, which throws on an unregistered handle.
- [packages/lib/src/typescript/lib/component/display/Glyphs.ts](packages/lib/src/typescript/lib/component/display/Glyphs.ts)
  — the file being changed; 195 lines, read it whole.
- [packages/lib/src/typescript/lib/core/Favicon.ts:74-125](packages/lib/src/typescript/lib/core/Favicon.ts#L74)
  — the same problem solved the other way, with an opt-in `_reset()`.
- [packages/lib/tests/dom/TestDOM.ts:1754-1777](packages/lib/tests/dom/TestDOM.ts#L1754)
  — `installTestDOM`, which rebuilds the handle table and clears three other
  module caches by hand.
- [packages/lib/src/typescript/lib/core/StyleTarget.ts:186-196](packages/lib/src/typescript/lib/core/StyleTarget.ts#L186)
  — the module cache that is deliberately *not* reset, and why that is correct
  there.

---

## Non-Goals

- **Converting `Favicon._reset()` to the identity check.** It would retire the
  `Favicon._reset()` calls in four test files, but nothing is broken there today
  and it is outside this defect. Worth doing on its own.
- **Releasing the dropped handles.** They belong to a discarded registry; the
  sink that could release them is already gone.
- **Restructuring `GlyphRenameSpriteMount.test.ts`.** Its single-case shape is no
  longer required once the sprite is per-sink, but the case still passes and
  moving it buys nothing. Only its comment changes.
- **Any change to the modelled DOM's handle eviction.** That is the
  `test-dom-handle-eviction` plan's scope.
- **Amending `plans/implemented/activation-after-dispose.md`.** Its
  implementation notes describe what was true when that branch shipped, and the
  repo keeps such records rather than rewriting them.

---

## Notes

[^reproduced]: Reproduced before drafting, in a throwaway jsdom test: render an
    SVG glyph, `DOM.reset()`, render a second SVG glyph. The second mount dies
    with `HierarchyRequestError: The operation would yield an incorrect node
    tree` — jsdom refusing a `<symbol>` appended under the `<path>` that now
    holds the recycled handle number. The same failure is recorded from the other
    direction in `plans/implemented/activation-after-dispose.md`'s
    implementation notes, and in `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`'s
    *Found while implementing the ten-plan batch (2026-09-25)* section.

[^why-lazy-check]: Three alternatives were considered and rejected. **(a)
    `DOM.reset()` calls a `Glyphs` reset directly** — `core/DOM.ts` would have to
    import `component/display/Glyphs.js`, which imports `core/DOM.js`: a cycle,
    and an inversion of the seam's place at the bottom of the stack. **(b) An
    exported `_resetGlyphSprite()` that suites call**, mirroring
    `Favicon._reset()` — this is the pattern that already failed. Four test files
    call `Favicon._reset()`, two of them with a comment explaining that it is not
    part of the feature under test and is only there because something else
    breaks without it; `activation-after-dispose`'s `beforeAll` is the same
    workaround arrived at independently, by an author who did not know the hook
    was owed. A signal a caller must remember is a signal a caller will forget.
    **(c) Moving the sprite off module scope**, into a class or a `DOM`-owned
    field — the sprite is genuinely one per document and every `Glyph` instance
    shares it, so module scope is the right home; only its lifetime was wrong.
    The lazy check also costs one reference comparison per call on a path that
    already does map lookups, so nothing measurable.

[^why-sink]: Six files install a wrapper or spy over the current source while
    leaving the sink in place: `tests/component/chart/ChartAxis.test.ts:53`,
    `tests/core/TextMeasure.test.ts:117`,
    `tests/component/TextBatchMeasure.test.ts:69`,
    `tests/core/BorderWidths.test.ts:69`, `tests/core/ThemeVars.test.ts:146`,
    `tests/overlay/Tooltip.test.ts:95`. In each, every handle stays valid, so a
    source-keyed check would discard a live sprite and build a duplicate
    mid-test. `ThemeVars` keys on `DOM.source` because that is the seam its
    cached values were *read* through; the sprite's handles are *written* through
    `DOM.sink`, so the same rule points at the sink here. `tests/dom/recorder.test.ts`
    is the mirror case — a sink installed alone — where dropping the sprite is
    exactly right.

[^why-no-registry]: Enumerated, not assumed: every module-level or `static`
    `Handle` holder outside `core/DOM.ts` was listed and classified.
    `overlay/Tooltip.ts:92,93,149`, `core/SpatialNavigation.ts:217`,
    `core/PendingTransitions.ts:18` and `core/FocusTraversal.ts:42` all hold
    transient per-interaction state that the next interaction overwrites or
    prunes. `core/FocusHistory.ts:73` holds a trail and already self-heals
    through its own `pruneStale()`, run before every navigation and query. That
    leaves `Glyphs._spriteElement` and `Favicon._link` as the only caches of a
    document-level singleton the module created and expects to find again for the
    module's lifetime. Two clients, one of which already has a working fix, is
    not a registry. A registry would also be strictly weaker: each module would
    still have to register (a top-level side effect, which ARCHITECTURE.md's
    *Defer DOM work to render time* section watches closely), and a list run from
    `DOM.reset()` would not fire for `installTestDOM` or a bare
    `DOM.install({ sink })`, both of which invalidate handles just as thoroughly.

[^why-keep-registry]: `_glyphs` is a `Map<string, GlyphDef>` seeded at module
    load with four `kind: "char"` entries and filled by `Glyph.register` from an
    app's icon set. It contains no handle and no document reference, so a seam
    swap cannot invalidate it. Clearing it would make every registered glyph
    vanish on the first `DOM.reset()`, which is why S3 pins its survival even
    though S3 passes before the fix as well as after.

[^why-doc]: The paragraph lands in *Swapping the seams*, next to the `install` /
    `reset` example, because that is where a reader learns the seams are
    swappable and therefore where the obligation the swap creates belongs. It
    names both worked instances, so the next module with a handle cache can copy
    one rather than rediscover the rule. `llms.txt` does not index the concepts
    pages (`grep -n dom-seams packages/lib/llms.txt` is empty and
    `scripts/llms/generate.mjs` never mentions `concepts`), so no regeneration is
    owed, and nothing exported changes, so `npm run docs:api` is unaffected.

[^why-jsdom-here]: The modelled DOM cannot show this defect, for the reason the
    post-campaign agenda's second bullet records: `TestDOM.ts`'s `release` only
    records and `removeElement` leaves the id index intact, so a dead handle
    still answers. The new file therefore keeps the `@vitest-environment jsdom`
    pragma and runs against the production sink/source pair, the recipe
    `tests/component/activation-after-dispose.test.ts` and
    `tests/dom/event-subtree-reentrant-dispose.test.ts` already use. The pragma
    also keeps `tests/setup/node-setup.ts` from installing the modelled baseline,
    since that file self-guards on `typeof document === 'undefined'`.

[^top-level-register]: `Glyph.register(ALPHA, BETA)` runs once at the test file's
    module scope rather than in a hook. Registration mounts nothing while no
    sprite exists, so it touches no DOM, and the definitions must outlive every
    `DOM.reset()` in the file for S3 to mean anything. Each vitest file gets its
    own module graph, so the two names do not leak to other files.

[^suite-baseline]: Measured on a working copy of this change against `master`
    (commit `6db01b15`): `npx vitest run` gave 511 files passing and 1 failing,
    8569 tests passing and 1 failing — the `Tree` icon-rebinding case, which
    asserts zero `createElementNS` writes after a rename and saw 2 once the
    sprite stopped carrying over between cases. With step 7's warm-up added,
    all 512 files pass. Step 1's new file brings the totals to 513 files and
    8576 tests.

[^shared-file]: `plans/test-dom-handle-eviction.md` is being drafted in parallel
    and had not landed in `plans/` when this plan was written. Both plans touch
    `packages/lib/tests/component/activation-after-dispose.test.ts`: this one
    deletes its `beforeAll` priming step, while that one makes the modelled DOM
    evict released handles, which could let the whole file drop its
    `@vitest-environment jsdom` pragma. If that plan lands first, re-locate the
    `beforeAll` block before deleting it — the surrounding imports and hooks may
    have moved. The two changes do not conflict in substance: the priming step is
    owed regardless of which DOM the file runs against.

---

## Implementation Notes

The change itself landed exactly as designed: `_spriteSink`,
`_forgetSpriteIfSinkChanged`, and the four first-statement calls, with the
helper above both `_spriteMounted` early-outs. The new test file failed on
S1/S2/S4 and passed S3 before the fix, S1 with the very
`HierarchyRequestError: The operation would yield an incorrect node tree` the
plan recorded from its throwaway reproduction, and all four passed after. The
`Tree` icon-rebinding case broke with exactly the predicted 2
`createElementNS` writes and step 7's warm-up restored it. Thirteen deviations
and corrections are worth recording, six of them found by the audit loop.

**The suite baseline is not the one `[^suite-baseline]` measured.** That
footnote measured against `master` at `6db01b15`; this branch is phase 2 of a
sequential batch and sits on `feature/test-dom-handle-eviction`, which added a
test file of its own. Measured on this branch's start point the baseline is 513
files and 8576 tests (2 `todo`), all green — already the totals the footnote
predicted for *after* this change. With this plan's file added the suite is 514
files and 8582 tests (2 `todo`), all green. The absolute numbers in step 11 and
in `## Verification` should be read as "baseline plus one file and six tests" —
six rather than the plan's four because the audit added two cases (below).

**One verification grep cannot pass as written.** `## Verification` asks for
zero matches of `grep -n 'already resets'` in
`plans/research/render-review-2026-09-15/13-button-glyph-image.md`, but the
correction bullet the plan itself prescribes quotes the retired phrase
verbatim — `the bullet above originally said … "already resets …"`. The false
*assertion* is gone, which is what the grep was standing in for; the one
surviving occurrence is inside the correction's quotation of it.

**The correction bullet points at `plans/implemented/`.** The plan's prescribed
text references `plans/glyph-sprite-reset-hook.md`, a path that stops resolving
the moment this branch's last commit moves the plan. It was written as
`plans/implemented/glyph-sprite-reset-hook.md`, the form the other research
reports under `render-review-2026-09-15/` use for landed plans.

**`[^why-jsdom-here]`'s justification was superseded before it was used.** That
footnote argues for the jsdom pragma on the grounds that `TestDOM.ts`'s
`release` only records and `removeElement` leaves the id index intact, so a
dead handle still answers. The phase-1 branch this one sits on changed exactly
that. The *instruction* still holds and was followed unchanged — jsdom pragma,
production seam pair, no `installTestDOM` — so the new file's header states the
reason that is still true instead: the modelled DOM models its own handle
table, so the corruption these cases pin is a property of the production
sink/source pair.

**The shared file needed no re-location.** `[^shared-file]` allowed for
`test-dom-handle-eviction` landing first and warned that the `beforeAll` block
might have moved. That plan did land first but did not touch
`tests/component/activation-after-dispose.test.ts` at all, so the priming block
was still at lines 29-44 exactly as described.

**A stale comment in the shared file was left alone, deliberately.** That
file's header still says the modelled DOM's `removeElement` "clears a handle's
parent but leaves it in the id index, so `DOM.source.getElementById()` still
answers after a dispose". The phase-1 branch made that false and rewrote the
identical claim in the sibling `tests/dom/event-subtree-reentrant-dispose.test.ts`,
but missed this copy. Correcting it is that plan's scope, not this one's —
`## Non-Goals` excludes modelled-DOM eviction, and a minimal shared-file diff
is what keeps the chained rebase resolvable — so it is left for the phase-1
author. The file's cases pass either way; only the explanation is out of date.

**A changelog entry was added beyond the file table.** `## Fixed` › `###
Components` in `docs/reference/changelog/next.md` gains an entry for the fix.
The plan's table lists only `docs/concepts/dom-seams.md`, but a consumer that
installs its own `DOMSink` through the documented `DOM.install` could reach
this defect, and the phase-1 branch set the precedent of recording a seam-level
fix there even when it changes no shipped behaviour.

**The seam-doc paragraph is not the plan's verbatim wording.** Step 10 prescribed
a block asserting that "`install` and `reset` invalidate every handle held
anywhere in the library at once", and offering `core/ThemeVars.ts` as a worked
instance of "a module that caches a `Handle`". Both halves are false. Only
`DOM.reset()` rebuilds the shared registry
([core/DOM.ts:3336](packages/lib/src/typescript/lib/core/DOM.ts#L3336));
`DOM.install` ([core/DOM.ts:3317](packages/lib/src/typescript/lib/core/DOM.ts#L3317))
reassigns the seam properties and leaves `_registry`
([core/DOM.ts:536](packages/lib/src/typescript/lib/core/DOM.ts#L536)) standing,
which is exactly why this plan keys the check on `DOM.sink` and why S4 asserts a
source-only install *keeps* the sprite — a reader following the prescribed
sentence literally would write the bug the plan's own *"keyed on `DOM.sink`, not
`DOM.source`"* decision exists to prevent. And `ThemeVars` caches
`Map<string, string>` ([core/ThemeVars.ts:19](packages/lib/src/typescript/lib/core/ThemeVars.ts#L19)),
holding no handle at all, so it cannot illustrate a handle cache. The shipped
paragraph states the obligation over seam-derived state generally — a minted
handle or a value read through a seam — distinguishes what `reset` and `install`
each do, and says the identity check is deliberately conservative rather than a
test for actual invalidation. The rule, the two worked instances, and the "no
registration, no teardown call" close are unchanged. The same false claim had
been restated in the new test file's own header and was corrected with it.

**The prescribed S2 and S4 assertions were vacuous, and were replaced.**
`## Expected Behaviour` pins S2's "the mounted-symbol record was cleared with
it" on `symbolParent('gss-alpha') === 'svg'`, and S4's on
`symbolParent('gss-beta') === 'svg'`. Both are `document.querySelector` id
lookups, and `## Potential Challenges` already predicted why they cannot work:
a reset orphans the sprite it replaces without removing it, so the document
holds several `<symbol>`s with the same id and the lookup only ever answers with
the oldest. Deleting `_mountedSymbols.clear()` from the helper left the entire
suite green — the one line the plan's S2 exists to pin was pinned by nothing.
Both cases now assert a *delta* on `document.querySelectorAll('#ts-glyph-…')`,
which is 1 without the clear and 2 with it; each independently fails when the
clear is removed. Scoping the query to the newest sprite instead does not work:
under jsdom a scoped `#id` query takes a document-wide `getElementById` fast
path and returns the earlier duplicate.

**Two cases were added beyond S1–S4, for guards the plan sanctioned but never
gave a case.** `## Internal Structure`'s table authorises the
`_forgetSpriteIfSinkChanged()` call in `registerGlyph` and `unregisterGlyph`,
but `## Expected Behaviour` covers neither, and the suite stayed green with
either one deleted. Each guards a hard throw: after a render and a `DOM.reset()`,
`Glyph.unregister(name)` reaches `DOM.sink.removeChild` on the discarded
registry's handles, and `Glyph.register(svgDef)` reaches `DOM.sink.appendChild`
on the dead sprite handle. Both now have a case. Writing the second one also
corrected a wrong expectation of mine: registering after a reset mounts
*nothing*, because the reset left no sprite to mount into, and the `<symbol>`
arrives on the name's first render — the assertion follows the contract rather
than the guess it started from.

**One line is deliberately left unpinned.** The guard in
`ensureGlyphSymbolMounted` cannot be reached with a stale sink: both callers
(`Glyph.mountSvgChild` and `Glyph.repaintName`) run `ensureGlyphSprite()`
immediately before it, which has already dropped the stale state, so removing
the guard leaves every test green. It stays because `## Internal Structure`
names it and its ordering rule wants it above the `_spriteMounted` early-out;
it is defence-in-depth on an `@internal` entry point, not dead weight, but no
behavioural test can distinguish it.

**The `_spriteSink` JSDoc carried the same over-claim as the seam doc.** It
asserted that "a swapped sink invalidates all of them at once", the third copy
of the sentence corrected above, and the helper's release note gave "they belong
to a registry that no longer exists" as the reason for not releasing — true
after `DOM.reset()`, false after a bare `DOM.install({ sink })`, where
`_registry` survives and the handles stay pinned. Both were reworded, and the
two commit messages that restated the claim were amended with it.

**The campaign agenda's own entry was closed, which the file table also omits.**
`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`'s *"`Glyphs.ts`
never resets its sprite handle"* bullet is the second record of this defect — the
plan's `[^reproduced]` footnote cites it — and it stated three things this branch
falsifies: that the module has no reset hook, that `activation-after-dispose`
works around the hole with a `beforeAll` priming step, and that
`13-button-glyph-image.md` asserts the opposite as fact. The phase directly below
this one on the stack set the precedent in its own bookkeeping commit
(`bf83fc4c`), appending a **Resolved by** paragraph plus corrections to the bullet
it closed; this branch does the same. The plan's file table names only
`13-button-glyph-image.md`, so this is a file beyond it.
