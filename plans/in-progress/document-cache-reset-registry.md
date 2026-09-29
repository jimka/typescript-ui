# Document cache reset registry — Implementation Plan

Two modules keep DOM handles in module-scoped state and must drop them when
the sink that minted those handles is replaced. A `Handle` is an opaque number
that only resolves in the registry that minted it
([core/DOM.ts:458](packages/lib/src/typescript/lib/core/DOM.ts#L458) throws on
any other), and `DOM.reset()`
([core/DOM.ts:3336](packages/lib/src/typescript/lib/core/DOM.ts#L3336))
rebuilds that registry from scratch.
[component/display/Glyphs.ts](packages/lib/src/typescript/lib/component/display/Glyphs.ts)
drops its sprite state automatically, by comparing `DOM.sink` against a
remembered `_spriteSink`
([Glyphs.ts:76](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L76))
at the top of four exported functions.
[core/Favicon.ts](packages/lib/src/typescript/lib/core/Favicon.ts) does not: it
exposes a manual `Favicon._reset()`
([Favicon.ts:123](packages/lib/src/typescript/lib/core/Favicon.ts#L123)) that
four test files must remember to call. Those two modules are still the only
ones in the library holding a cache of this shape; the addendum at the end of
this plan lists every module-scoped handle holder and says why the count is not
the reason to build the registry.[^census]

This plan replaces both arrangements with one push mechanism. `DOMSeams` gains
an `@internal` `onSinkChange(listener)`, and `install` / `reset` run every
registered listener after a swap that replaces the sink. `Glyphs.ts` and
`Favicon.ts` each register one named function at import and drop their own
state in it. `Favicon._reset()` and its four call sites are deleted; so are
`Glyphs`' `_spriteSink` and the four per-call comparisons that read it.
`DOMSeams.sink` and `DOMSeams.source` become `readonly`, which makes `install`
and `reset` the only routes a seam can be swapped through — and therefore the
only two places a listener has to run.

The defect is narrower than the post-campaign agenda records it. That file's
entry says `Favicon` "carries the same defect as `Glyphs`"
([00-post-campaign-agenda.md:1230](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L1230)),
which reads as though nothing resets `Favicon` at all. A hook does exist and it
works; what it lacks is automatic delivery. Stated accurately: `Favicon._link`
survives a sink swap unless the suite remembers `Favicon._reset()`, and seven
cases in two test files depend on that memory right now.[^seven-cases] The
production case is not reachable as the library ships.[^prod-reach]

---

## Architecture Decisions

### The mechanism is a listener list on `DOM`, run after every sink swap

`DOMSeams` gains `onSinkChange(listener: () => void): void`, a module-level
array of listeners, and a dispatch from `install` and `reset`. The precedent is
[core/Theme.ts:1381](packages/lib/src/typescript/lib/core/Theme.ts#L1381)'s
`ThemeManager.onThemeChange` — a plain listener array on the global singleton
that owns the changing state, dispatched with `forEach`
([Theme.ts:1498](packages/lib/src/typescript/lib/core/Theme.ts#L1498)) — and
`DOM`'s own doc comment already says it mirrors that singleton
([DOM.ts:3301-3312](packages/lib/src/typescript/lib/core/DOM.ts#L3301)).[^why-on-dom]

### Each cache registers at module scope, at import

`Glyphs.ts` and `Favicon.ts` each end with one `DOM.onSinkChange(fn)` call at
the module's top level. The precedent is
[core/BorderWidths.ts:112](packages/lib/src/typescript/lib/core/BorderWidths.ts#L112)'s
`ThemeManager.onThemeChange(clearBorderWidths)` — a module-scoped cache
subscribing itself, at import, to the global change that invalidates
it.[^why-import-time]

### The trigger is the sink's identity, not `reset` alone

`reset` always installs a fresh `ProductionDOMSink`, so it always notifies.
`install` notifies only when it is handed a sink that is not the object already
installed. A source-only `install` notifies nothing.

| Call | Notifies? | Why |
|---|---|---|
| `DOM.reset()` | yes | new registry *and* new sink; every handle is dead |
| `installTestDOM(config)` | yes | installs a `RecordingDOMSink` with a handle table of its own |
| `DOM.install({ sink: recorder })` | yes | later writes resolve through a sink that never minted the held handles |
| `DOM.install({ source: spy })` | no | handles stay valid; six suites install a source spy over a live sink |
| `DOM.install({ sink: DOM.sink })` | no | the installed sink is unchanged |

The last two rows are the arms this keeps: a source-keyed trigger would throw
away a live sprite in each of the six source-spy suites.[^why-sink-keyed]

### `DOMSeams.sink` and `DOMSeams.source` become `readonly`

Nothing outside `core/DOM.ts` may assign a seam; `install` and `reset` are the
only swap routes. Inside the module a `-readonly` mapped type gives
`core/DOM.ts` its own mutable view of the same object.[^why-readonly]

### `Glyphs.ts` drops its own sink-identity check

`_spriteSink` and the four `_forgetSpriteIfSinkChanged()` calls go away;
`_forgetSprite()` keeps only the clearing half and is reached from the registry
alone. Nothing production runs pays for the mechanism any more.[^why-cheaper]

### `Favicon._link` moves from a private static to module scope

`_link` becomes a module-level `let` beside a module-level `_forgetLink()`,
mirroring `Glyphs.ts`, `ThemeVars.ts` and `BorderWidths.ts`. A `private static`
cannot be reached from the module scope where the registration
lives.[^why-module-scope]

### `onSinkChange` is `@internal` and returns nothing

Its only callers are two library modules, so it stays out of the generated API
docs, and it hands back no unsubscribe function.[^why-internal-void]

### Source-keyed caches are left exactly as they are

`core/ThemeVars.ts` keeps its own `DOM.source` identity check
([ThemeVars.ts:35](packages/lib/src/typescript/lib/core/ThemeVars.ts#L35)), and
no `onSourceChange` is added. The two mechanisms answer different questions and
both stay documented.[^why-no-source-list]

---

## Public API

`core/DOM.ts` — two properties become `readonly`, one `@internal` method is
added:

```typescript
export interface DOMSeams {
    readonly sink: DOMSink;          // was `sink: DOMSink`
    readonly source: DOMSource;      // was `source: DOMSource`
    install(impls: { sink?: DOMSink; source?: DOMSource }): void;
    reset(): void;
    onSinkChange(listener: () => void): void;   // new, `@internal`
}
```

The existing doc comments on `sink`, `source`, `install` and `reset` are kept
and extended per step 4 — including their `{@link ProductionDOMSink}` /
`{@link ProductionDOMSource}` references, which stay as they are.

`core/Favicon.ts` — one method is deleted:

```typescript
// REMOVED. The `@internal` test-only hook and all four of its call sites go.
class Favicon {
    static _reset(): void;
}
```

`Favicon.install(href?: string): boolean` is unchanged in signature and in
behaviour.

---

## Internal Structure

### `core/DOM.ts`

The listener array, the dispatch, the mutable view and the seam object all go
between the end of the `DOMSeams` interface
([DOM.ts:3299](packages/lib/src/typescript/lib/core/DOM.ts#L3299)) and the
existing `DOM` doc comment at
[DOM.ts:3301](packages/lib/src/typescript/lib/core/DOM.ts#L3301). That doc
comment and its `@category Core` tag stay attached to the exported `DOM`
binding.

```typescript
/**
 * Listeners run after every swap that replaces the installed sink. Each one
 * belongs to a module-scoped cache holding state minted through a sink it no
 * longer has. There is no unregister: every such cache lives as long as the
 * process does.
 */
const _sinkChangeListeners: Array<() => void> = [];

/** Runs every sink-change listener. Called after a swap, never before one. */
function notifySinkChange(): void {
    _sinkChangeListeners.forEach(l => l());
}

/**
 * The seams as `core/DOM.ts` itself writes them. `DOMSeams` declares `sink`
 * and `source` `readonly`, so no caller outside this module can swap a seam
 * without going through `install` or `reset` — the only two places a
 * sink-change listener runs. This is the module's own mutable view of the very
 * same object the `DOM` binding below exports.
 */
type MutableDOMSeams = { -readonly [K in keyof DOMSeams]: DOMSeams[K] };

const _seams: MutableDOMSeams = {
    sink:   new ProductionDOMSink(),
    source: new ProductionDOMSource(),

    install(impls: { sink?: DOMSink; source?: DOMSource }): void {
        const sinkReplaced = impls.sink !== undefined && impls.sink !== _seams.sink;

        if (impls.sink) {
            _seams.sink = impls.sink;
        }

        if (impls.source) {
            _seams.source = impls.source;
        }

        if (sinkReplaced) {
            notifySinkChange();
        }
    },

    reset(): void {
        // Keep the existing "Disarm before anything is rebuilt" comment block
        // here, verbatim.
        _seams.sink.clearAllTimeouts();

        // Keep the existing "Rebuild the shared registry alongside the seams"
        // comment block here, verbatim.
        _registry     = new HandleRegistry();
        _seams.sink   = new ProductionDOMSink();
        _seams.source = new ProductionDOMSource();

        notifySinkChange();
    },

    onSinkChange(listener: () => void): void {
        _sinkChangeListeners.push(listener);
    },
};
```

The export line then reads `export const DOM: DOMSeams = _seams;`. Every
read and write inside these three method bodies goes through `_seams` rather
than `DOM` — the same object either way, but the module then reads one way
throughout, and `reset`'s two lines that already said `DOM.sink` change with
it.

**Ordering rule:** in both `install` and `reset`, `notifySinkChange()` is the
*last* statement, after every assignment. A listener reads `DOM.sink` and must
see the seam that replaced the one it was holding, not the one being discarded.

**`sinkReplaced` is computed before the assignment**, because the comparison is
against the outgoing sink. Computed after, it can never be true.

### `component/display/Glyphs.ts`

Lines 67-100 (the `_spriteSink` doc comment, its declaration, and
`_forgetSpriteIfSinkChanged`) are replaced by:

```typescript
/**
 * Drops the sprite and its mounted-symbol record, so the next mount builds a
 * fresh sprite in the live document instead of appending through a handle the
 * installed sink never minted. Registered with `DOM.onSinkChange` at the
 * bottom of this module and called from nowhere else.
 *
 * The dropped handles are not released: the sink that could release them is no
 * longer installed, and after a `DOM.reset()` the registry that held them is
 * gone as well. A bare `DOM.install({ sink })` does leave them pinned in the
 * surviving registry, which only a test can arrange and only for that test's
 * lifetime. The glyph *definition* registry is left alone — a `GlyphDef` holds
 * no handle and outlives any seam.
 */
function _forgetSprite(): void {
    _spriteElement = null;
    _spriteMounted = false;
    _mountedSymbols.clear();
}
```

and the module ends with:

```typescript
// Registered at import: the sprite element and every `<symbol>` in it are
// named by handles minted through the sink, so a replaced sink leaves none of
// them resolvable. Order against any other sink-change listener is irrelevant
// — each one clears only its own module's state.
DOM.onSinkChange(_forgetSprite);
```

### `core/Favicon.ts`

Inserted after `ICON_LINK_SELECTOR`
([Favicon.ts:52](packages/lib/src/typescript/lib/core/Favicon.ts#L52)), taking
over the doc comment that sits on the private static today:

```typescript
/**
 * The link this module injected, or `null` when it has not injected one. Held
 * so a later install swaps the `href` instead of stacking a second `<link>` —
 * the browser would honour the last one, but the page would accumulate a link
 * per call.
 */
let _link: Handle | null = null;

/**
 * Forgets the injected link, so the next `Favicon.install` appends a fresh one
 * instead of writing through a handle the installed sink never minted.
 * Registered with `DOM.onSinkChange` at the bottom of this module and called
 * from nowhere else.
 */
function _forgetLink(): void {
    _link = null;
}
```

`Favicon.install` keeps its body and its doc comment, with `Favicon._link`
rewritten to `_link` at all three sites
([Favicon.ts:93](packages/lib/src/typescript/lib/core/Favicon.ts#L93),
[:94](packages/lib/src/typescript/lib/core/Favicon.ts#L94),
[:110](packages/lib/src/typescript/lib/core/Favicon.ts#L110)). The module ends
with:

```typescript
// Registered at import: the injected `<link>` is named by a handle minted
// through the sink, so a replaced sink leaves it unresolvable.
DOM.onSinkChange(_forgetLink);
```

---

## Ordered Implementation Steps

Run every command from the worktree root unless a step says otherwise. Targeted
vitest runs use `cd packages/lib && npx vitest run <path>`; **never pass
`--root`**.

1. **Record the baseline.** `npm install`, then `npm test`. Expect 521 files
   and 8765 tests, 2 of them `todo`, none failing.[^baseline] Also run
   `npm run typecheck`, `npm run lint` (both silent) and `npm run docs:api`
   (0 errors, 14 warnings).

2. **Write the failing notification-surface file.** Create
   `packages/lib/tests/dom/sink-change-notification.test.ts` with cases N1-N6
   and the compile-time guard from `## Expected Behaviour`. It runs in the
   default `node` environment, mirroring
   [tests/dom/recorder.test.ts](packages/lib/tests/dom/recorder.test.ts).
   Confirm it is red both ways before going on: `npm run typecheck:test`
   reports that `onSinkChange` does not exist on `DOMSeams`, and
   `cd packages/lib && npx vitest run tests/dom/sink-change-notification.test.ts`
   fails at runtime with `DOM.onSinkChange is not a function` (vitest strips
   types rather than checking them, so the type error alone would not stop the
   run).

3. **Add the mechanism to `core/DOM.ts`.** Widen the `DOMSeams` interface with
   `readonly` on `sink` / `source` and the `@internal` `onSinkChange`
   declaration; add `_sinkChangeListeners`, `notifySinkChange`,
   `MutableDOMSeams` and `_seams` exactly as `## Internal Structure` gives
   them; change the export to `export const DOM: DOMSeams = _seams;`. Then
   `npm run typecheck` and `npm run typecheck:test` — both clean — and re-run
   step 2's file: N1-N6 green.

4. **Extend the seam property and method doc comments.** `sink` and `source`
   each gain a sentence saying the property is read-only and swapped through
   `install` or `reset`; `install` and `reset` each gain a sentence saying that
   a swap replacing the installed sink runs the registered sink-change
   listeners. Use prose, not `{@link}` — `onSinkChange` is `@internal` and
   linking it from a documented member is the warning
   [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) forbids.

5. **Migrate `Glyphs.ts`.** Narrow line 4 to
   `import type { Handle } from "~/core/DOM.js";`; delete lines 67-76
   (`_spriteSink` and its doc comment); replace
   `_forgetSpriteIfSinkChanged` with `_forgetSprite` as given; delete the four
   `_forgetSpriteIfSinkChanged();` statements and the blank line after each
   (at lines 110, 126, 157 and 185); append the registration at the bottom.
   Check: `grep -n '_spriteSink\|_forgetSpriteIfSinkChanged'
   packages/lib/src/typescript/lib/component/display/Glyphs.ts` — zero
   matches. Then `cd packages/lib && npx vitest run
   tests/component/display/GlyphSpriteSinkSwap.test.ts` — 6 passing.

6. **Migrate `Favicon.ts`.** Add `_link` and `_forgetLink` after
   `ICON_LINK_SELECTOR` (after line 52); delete the `private static _link`
   declaration and the doc comment above it (lines 68-74), whose text moves
   onto the new module-level `_link`; rewrite the three `Favicon._link`
   references inside `install` to `_link` (lines 93, 94 and 110); delete
   `Favicon._reset()` and its doc comment (lines 115-125); append the
   registration at the bottom. The `import { DOM, type Handle }` on line 3 is
   unchanged — both bindings are still used. Check: `grep -rn '_reset'
   packages/lib/src/typescript/lib/core/Favicon.ts` — zero matches.

7. **Add the two `Favicon` cases.** Append F1 and F2 from
   `## Expected Behaviour` to
   [tests/core/Favicon.test.ts](packages/lib/tests/core/Favicon.test.ts),
   reusing that file's existing `CONFIG`, `linkCreations`, `iconLink` and
   `iconWrites` helpers. Run the file — 9 passing.

8. **Delete the four manual hook calls.**
   - `tests/core/Favicon.test.ts`: drop line 71 from the `afterEach`, leaving
     only `DOM.reset();`. Keep the `Favicon` import — the file still calls
     `Favicon.install`.
   - `tests/core/Body.test.ts`: drop lines 20-26 (the six-line comment plus the
     call), leaving `afterEach(() => { DOM.reset(); });`. Drop the `Favicon`
     import at line 6.
   - `tests/core/BodyContextMenu.test.ts`: drop lines 50-57 (the seven-line
     comment plus the call). Drop the `Favicon` import at line 20.
   - `tests/core/ResizeDrag.test.ts`: drop line 107 and rewrite the comment at
     lines 104-106, which currently says "B1 configures both of these", to name
     one item instead of two: `// Body is a page-level singleton whose own
     module state outlives DOM.reset() too; B1 configures it, as
     BodyContextMenu.test.ts's afterEach does.` Drop the `Favicon` import at
     line 19.

   Check: `grep -rn 'Favicon._reset' packages/lib` — zero matches. Then
   `cd packages/lib && npx vitest run tests/core/Favicon.test.ts
   tests/core/Body.test.ts tests/core/BodyContextMenu.test.ts
   tests/core/ResizeDrag.test.ts` — 4 files, 42 passing (40 today plus F1 and
   F2).

9. **Correct the stale comment in `Favicon.test.ts`.** Lines 44-46 of
   `iconWrites`' doc comment claim that "a released handle still accepts writes
   offline". That stopped being true when the modelled DOM started honouring
   the production handle contract; a write through a dead handle now throws
   `TestHandleTable: handle N is not registered`. Replacement wording is in
   `## Expected Behaviour` under *Comment correction*.

10. **Rewrite the seam-doc paragraph.**
    [packages/lib/docs/concepts/dom-seams.md](packages/lib/docs/concepts/dom-seams.md)'s
    *Swapping the seams* section ends with a paragraph whose last sentence —
    "Nothing registers with `DOM`, and no suite has to remember a teardown
    call." — is now half false. Replacement text is in
    `## Documentation Impact`.

11. **Add the changelog entries.** In
    `packages/lib/docs/reference/changelog/next.md`, add a `## Breaking
    changes` › `### Core` entry for the `readonly` seams and a `## Fixed` ›
    `### Core` entry for the `Favicon` link. Create either heading if it is not
    already present; `## Breaking changes` precedes `## Changed`, `## Added` and
    `## Fixed`, as
    [0.10.0.md](packages/lib/docs/reference/changelog/0.10.0.md) orders them.
    Exact text is in `## Documentation Impact`.

12. **Correct the two research reports.**
    - `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`
      lines 1230-1234: append a dated correction bullet.
    - `plans/research/render-review-2026-09-15/03-core-dom-seam-events.md`
      line 231: the clause "`Favicon._reset()` exists for exactly this class of
      cross-reset staleness and shows the pattern" names a method that no
      longer exists. Both replacements are in `## Documentation Impact`.

13. **Run everything.** From the worktree root: `npm test` (expect 522 files
    and 8773 tests, 2 `todo`, none failing — the baseline plus one file with six
    cases and two cases added to `Favicon.test.ts`), `npm run typecheck`,
    `npm run lint`, `npm run docs:api` (0 errors, still 14 warnings) and
    `npm run docs:llms:check` (must still report 0 unaccounted for).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Favicon.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Glyphs.ts` |
| Create | `packages/lib/tests/dom/sink-change-notification.test.ts` |
| Modify | `packages/lib/tests/core/Favicon.test.ts` |
| Modify | `packages/lib/tests/core/Body.test.ts` |
| Modify | `packages/lib/tests/core/BodyContextMenu.test.ts` |
| Modify | `packages/lib/tests/core/ResizeDrag.test.ts` |
| Modify | `packages/lib/docs/concepts/dom-seams.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md` |
| Modify | `plans/research/render-review-2026-09-15/03-core-dom-seam-events.md` |

No file is deleted. `Favicon._reset()` is a method removal inside a surviving
file.

---

## Expected Behaviour

Every case below is unit-testable except the readonly guard, which is a
compile-time check that `npm run typecheck:test` enforces. The "Mutation it
catches" column names the shipped line whose removal or weakening turns the
case red; each was traced against the code paths rather than assumed.

### The notification surface — `tests/dom/sink-change-notification.test.ts`

Fixture: `import { DOM, ProductionDOMSink } from '~/core/DOM';` (N6 asserts the
instance type) and `import { RecordingDOMSink } from './TestDOM';`, an
`afterEach` of `DOM.reset()`, and a `counter(): () => void` helper that returns
a named listener closing over a mutable count. `describe` title:
`'sink-change notification'`.

| Case | Steps | Assertion | Mutation it catches |
|---|---|---|---|
| **N1** | register two counting listeners; `DOM.reset()` | both counts are `1` | `notifySinkChange()` deleted from `reset`; the second count also catches a dispatch that stops after one listener |
| **N2** | register one counter; `DOM.install({ sink: new RecordingDOMSink() })` | count is `1` | `notifySinkChange()` deleted from `install` |
| **N3** | register one counter; install a new `RecordingDOMSink` (count reaches `1`); then `DOM.install({ sink: DOM.sink })` | count is still `1` | `impls.sink !== _seams.sink` weakened to `impls.sink !== undefined` |
| **N4** | register one counter; install a new `RecordingDOMSink` (count reaches `1`); then `DOM.install({ source: Object.create(DOM.source) as typeof DOM.source })` | count is still `1` | a `notifySinkChange()` added to `install`'s source branch |
| **N5** | register a listener pushing `DOM.sink` onto a local array; `DOM.install({ sink: recorder })` | `seen[0]` `toBe(recorder)` | `notifySinkChange()` moved above the assignments in `install` |
| **N6** | same listener; install `recorder`, then `DOM.reset()` | `seen[1]` is a `ProductionDOMSink` and is not `recorder` | `notifySinkChange()` moved above the assignments in `reset` |

N3 and N4 each reach a count of `1` before the call under test, so neither is
satisfiable with both sides at zero — the distinction they draw is `1` against
`2`, not `0` against `0`.

The readonly guard is a never-called function in the same file, with
`noUnusedLocals` off under `tsconfig.test.json` and the `@ts-expect-error`
precedent at
[tests/core/Body.test.ts:69](packages/lib/tests/core/Body.test.ts#L69):

```typescript
/**
 * Never called. Present so `typecheck:test` fails if `DOMSeams` stops
 * declaring `sink` readonly: `install` and `reset` are the only swap routes
 * that run the sink-change listeners, and a direct assignment bypasses both.
 */
function readonlySinkGuard(): void {
    // @ts-expect-error — DOMSeams declares `sink` readonly.
    DOM.sink = new RecordingDOMSink();
}
```

Removing `readonly` makes the directive unused, which TypeScript reports as an
error of its own, so `npm run typecheck:test` goes red. That is the whole
assertion; the function has no runtime behaviour to check.

### `Favicon` across a sink swap — added to `tests/core/Favicon.test.ts`

| Case | Steps | Assertion | Mutation it catches |
|---|---|---|---|
| **F1** | `const first = installTestDOM(CONFIG)`; `Favicon.install('/a.svg')`; `const second = installTestDOM(CONFIG)`; `Favicon.install('/b.svg')` | `linkCreations(first) === 1`, `linkCreations(second) === 1`, `iconWrites(second)` equals `['/b.svg']` | `DOM.onSinkChange(_forgetLink)` deleted from `Favicon.ts` |
| **F2** | `const sink = installTestDOM(CONFIG)`; `Favicon.install('/a.svg')`; `DOM.install({ source: Object.create(DOM.source) as typeof DOM.source })`; `Favicon.install('/c.svg')` | `linkCreations(sink) === 1`, `iconWrites(sink)` equals `['/a.svg', '/c.svg']` | a `notifySinkChange()` added to `install`'s source branch |

F1's red direction was measured, not predicted. Without the registration the
second `Favicon.install` takes its `_link !== null` early-return branch and
calls `DOM.sink.apply` on a handle the rebuilt table never minted, which throws
`TestHandleTable: handle N is not registered` out of
`Favicon.install`.[^f1-measured] Were the rebuilt table ever to have re-minted
that number before the call, the write would land on the wrong stub instead and
`linkCreations(second)` would read `0` against the asserted `1` — so the case is
red by either route. Its green values were confirmed separately, by standing the
manual hook in for the mechanism between the two installs.

F2 is green before this change and green after it; it does not pin the fix. It
pins the `sinkReplaced` guard this change introduces, which is the symmetric
arm of F1 — the swap that must *not* drop the cache. Say so in the case's own
comment so no later reader mistakes it for coverage of the reset.

### Behaviours pinned by cases that already exist

Deleting `Favicon._reset()` outright is what makes these mean something: no
manual hook survives anywhere in the suite, so nothing else can clear `_link`
on the mechanism's behalf.

- **Seven existing cases become the registry's own regression net.** With the
  four hook calls deleted and `DOM.onSinkChange(_forgetLink)` absent, five
  cases in `tests/core/BodyContextMenu.test.ts` and two in
  `tests/core/Body.test.ts` fail, each throwing from `Favicon.install` by way
  of `Body.setFavicon` / `Body.init`.[^seven-cases] With the registration in
  place all seven pass.
- **`tests/core/ResizeDrag.test.ts`'s hook call is not load-bearing today.**
  Deleting it alone changes nothing in that file. It is removed because the
  method it calls is going away, not because anything depended on it.
- **The six cases in
  [tests/component/display/GlyphSpriteSinkSwap.test.ts](packages/lib/tests/component/display/GlyphSpriteSinkSwap.test.ts)
  all keep passing.** Four of them (a first-seen symbol after a reset, the
  sprite rebuild, unregistering after a reset, registering after a reset) go
  red if `DOM.onSinkChange(_forgetSprite)` is missing from `Glyphs.ts` — they
  were red before that module got its check and the new mechanism does the same
  work at a different moment. The source-only case is `Glyphs`' own arm of F2,
  and the definition-registry case pins `_forgetSprite` not clearing `_glyphs`.

### Comment correction

`tests/core/Favicon.test.ts` lines 44-46, replacing "Reads `sink.writes`
directly: a released handle still accepts writes offline, so an
`expect(…).not.toThrow()` assertion would pass whether or not the code under
test did anything.":

```
 * Reads `sink.writes` directly rather than asserting that a call did not
 * throw: the op log says which link received which `href`, which is the
 * contract, while a throw-or-not assertion cannot tell a fresh link from an
 * `href` swapped onto an existing one.
```

---

## Verification

From the worktree root:

- `npm test` — 522 files, 8773 tests (2 `todo`), none failing. This is
  `typecheck:test` followed by `vitest run`, so it covers the readonly guard.
- `npm run typecheck` and `npm run lint` — both silent. `Glyphs.ts` sits under
  the `local/no-raw-dom` rule's empty baseline and must stay clean; the
  narrowed type import on line 4 is what keeps `DOMSink` from becoming an
  unused import.
- `npm run docs:api` — 0 errors and 14 warnings, the pre-existing count. A
  fifteenth means a `{@link}` in step 4's doc text reached `onSinkChange`.
- `npm run docs:llms:check` (after `docs:api`) — "0 unaccounted for". Nothing
  new is exported and no catalogued summary sentence changes, so no
  regeneration is owed.

Targeted, from `packages/lib`:

- `npx vitest run tests/dom/sink-change-notification.test.ts` — 6 passing.
- `npx vitest run tests/component/display/GlyphSpriteSinkSwap.test.ts` — 6
  passing.
- `npx vitest run tests/core/Favicon.test.ts tests/core/Body.test.ts
  tests/core/BodyContextMenu.test.ts tests/core/ResizeDrag.test.ts` — 4 files,
  42 passing.

Greps:

- `grep -rn 'Favicon._reset' packages/lib` — zero matches.
- `grep -n '_spriteSink\|_forgetSpriteIfSinkChanged'
  packages/lib/src/typescript/lib/component/display/Glyphs.ts` — zero matches.
- `grep -rn 'Nothing registers with' packages/lib/docs` — zero matches, so
  step 10's paragraph really was replaced.

Nothing here needs a browser, a window or `packages/qa`. Production calls
neither `install` nor `reset` — `grep -rn 'DOM.reset()'
packages/lib/src/typescript` finds only comments, and `DOM.install` has no
production call site — so no rendered behaviour changes and there is nothing to
verify by hand.

---

## Documentation Impact

**`packages/lib/docs/concepts/dom-seams.md`** — replace the final paragraph of
*Swapping the seams* (the one beginning "A module that caches seam-derived
state between calls") with, as one unwrapped line matching the file's style:

> A module that caches seam-derived state between calls must drop that cache
> when the seam it came from is replaced. `reset` rebuilds the shared handle
> registry, so every handle minted before it is dead; an `install` leaves that
> registry standing but routes later calls through a seam that need not
> recognise a handle at all. Neither leaves a cache safe to reuse. State minted
> through the *write* seam — a `Handle` — is dropped by registration: the module
> hands `DOM` a named clearing function once, at import, and `install` and
> `reset` run it after any swap that replaces the installed sink, which is why
> `DOM.sink` and `DOM.source` are read-only and `install` is the only way to
> swap one. `component/display/Glyphs.ts` drops the shared glyph sprite that
> way, and `core/Favicon.ts` the `<link rel="icon">` it injected; neither test
> suite has to remember a teardown call. State merely *read* through the read
> seam — a value, not a handle — stays on a one-line `DOM.source` identity
> check at the top of the entry point that answers from it, as
> `core/ThemeVars.ts` does for a theme variable, because a source spy installed
> over a live sink invalidates nothing and the check is the cheaper signal there.

Do not add an `/api/` link for the registration method: `onSinkChange` is
`@internal` and TypeDoc generates no page for it.

**`packages/lib/docs/api/`** is generated output and is gitignored
(`.gitignore:14`), so it is not in the file table. Regenerating it shows `sink`
and `source` as read-only on `/api/core/interfaces/DOMSeams`, and does not show
`onSinkChange`. `Favicon`'s page loses nothing, because `_reset` was
`@internal` and never appeared on it.

**`packages/lib/llms.txt`** needs no edit. Its one `Favicon` row
([llms.txt:137](packages/lib/llms.txt#L137)) quotes the class's own first
sentence, which does not change.

**`packages/lib/docs/reference/changelog/next.md`** — two entries:

```markdown
## Breaking changes

### Core

- **`DOM.sink` and `DOM.source` are now read-only.** Swap a seam through
  `DOM.install({ sink, source })` or restore the production pair with
  `DOM.reset()`; a direct assignment no longer compiles. The two calls are what
  tell the library's seam-derived caches that the handles they hold have stopped
  resolving, so an assignment that went around them left stale handles behind.
  Code already using `install` / `reset` — which is every documented path —
  needs no change.

## Fixed

### Core

- **`Favicon` no longer writes the browser-tab icon through a stale element
  handle after the DOM seams are swapped.** The injected `<link rel="icon">`
  was remembered in module state that outlived a seam swap, so a later
  `Favicon.install` swapped the `href` on a handle the new sink had never
  minted instead of appending a fresh link. The cache is now dropped
  automatically whenever the installed sink is replaced. No consumer action is
  needed.
```

**`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`** —
append to the bullet at lines 1230-1234:

```
  **Taken, and the entry above is imprecise (2026-09-29).** `Favicon` was never
  wholly unreset: `Favicon._reset()` existed and worked, and seven cases in
  `tests/core/Body.test.ts` and `tests/core/BodyContextMenu.test.ts` depended
  on four suites remembering to call it. What it lacked was automatic delivery.
  `plans/document-cache-reset-registry.md` builds the registry the
  `glyph-sprite-reset-hook` plan declined, migrates both modules onto it, and
  deletes the manual hook and its four call sites.
```

**`plans/research/render-review-2026-09-15/03-core-dom-seam-events.md`** line
231 — replace the trailing clause so it no longer names a deleted method:

```
- **Risk / blast radius**: `tests/core/Body.test.ts` and any suite calling `installTestDOM` more than once per `Body` singleton. `Favicon` once carried a `_reset()` hook for exactly this class of cross-reset staleness; `plans/document-cache-reset-registry.md` replaced it with `DOM.onSinkChange`, which delivers the same drop without a suite having to ask.
```

---

## Potential Challenges

- **Computing `sinkReplaced` after the assignment silently disables the
  `install` half.** The comparison is against the outgoing sink, so it must run
  first. N2 catches it.
- **Notifying before the swap gives listeners the discarded seam.** Harmless
  for the two listeners this plan adds, both of which only null out state, but
  the rule is stated and N5 and N6 pin it, so a third listener that does read
  `DOM.sink` is safe by construction.
- **Deleting `Glyphs`' four call sites without adding the registration looks
  like the change did nothing**, because the sprite is simply never dropped.
  Four of the six `GlyphSpriteSinkSwap` cases catch it.
- **The narrowed type import is easy to miss.** Leaving line 4 as
  `import type { DOMSink, Handle }` after `_spriteSink` is gone makes `DOMSink`
  unused, which `npm run typecheck` reports (`noUnusedLocals` is on for
  `tsconfig.lib.json`).
- **`vi.resetModules()` gives each module graph its own listener array**, so
  `tests/unit/import-without-dom.test.ts` — which resets modules once per
  entry point — cannot accumulate duplicate listeners across graphs. Within one
  graph nothing registers twice, because a module body runs once.
- **Registering at import is a module-level side effect, but not a DOM one.**
  Pushing onto an array touches no document, so
  `tests/unit/import-without-dom.test.ts` stays green and
  [ARCHITECTURE.md](ARCHITECTURE.md)'s *Defer DOM work to render time* rule is
  not engaged.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/Theme.ts:1373-1391](packages/lib/src/typescript/lib/core/Theme.ts#L1373)
  and
  [:1498](packages/lib/src/typescript/lib/core/Theme.ts#L1498) — the precedent
  for the listener surface: an array on the singleton that owns the changing
  state, an `onXChange` method, a `forEach` dispatch with no error isolation.
- [packages/lib/src/typescript/lib/core/BorderWidths.ts:99-112](packages/lib/src/typescript/lib/core/BorderWidths.ts#L99)
  — the precedent for the registration: a module-scoped cache, a named clearing
  function, and one subscribing call at the module's top level.
- [packages/lib/src/typescript/lib/core/DOM.ts:3286-3340](packages/lib/src/typescript/lib/core/DOM.ts#L3286)
  — `DOMSeams`, `DOM`, `install` and `reset`; the whole seam swap point.
- [packages/lib/src/typescript/lib/core/DOM.ts:458-539](packages/lib/src/typescript/lib/core/DOM.ts#L458)
  — `HandleRegistry.resolve` / `isRegistered` / `release`, and the module-level
  `_registry` that `reset` replaces. This is why a stale handle is unusable.
- [packages/lib/src/typescript/lib/component/display/Glyphs.ts](packages/lib/src/typescript/lib/component/display/Glyphs.ts)
  — 238 lines; read it whole before editing.
- [packages/lib/src/typescript/lib/core/Favicon.ts](packages/lib/src/typescript/lib/core/Favicon.ts)
  — 126 lines; read it whole before editing.
- [packages/lib/src/typescript/lib/core/ThemeVars.ts](packages/lib/src/typescript/lib/core/ThemeVars.ts)
  — the lazy source-identity check that stays, and the shape `Glyphs` is
  leaving behind.
- [packages/lib/tests/dom/TestDOM.ts:1854-1877](packages/lib/tests/dom/TestDOM.ts#L1854)
  — `installTestDOM`, including the three module caches it still clears by hand.
- [packages/lib/tests/component/display/GlyphSpriteSinkSwap.test.ts](packages/lib/tests/component/display/GlyphSpriteSinkSwap.test.ts)
  — the six cases that must keep passing, and the model for the new file's
  shape.
- [plans/implemented/glyph-sprite-reset-hook.md](plans/implemented/glyph-sprite-reset-hook.md)
  — the design being generalised, and its *why-no-registry* footnote, whose
  census this plan re-ran.

---

## Non-Goals

- **An `onSourceChange` list, or migrating any source-keyed cache.**
  `ThemeVars`, `BorderWidths` and `TextMeasure` each have a working
  arrangement; adding a second list for no client is speculative.
- **Migrating any of the census's other six entries.** The addendum classifies
  each as transient or self-pruning; none caches a document-level singleton it
  expects to find again.
- **Making `installTestDOM` stop clearing its three caches by hand.** Those are
  source-keyed value caches, not sink-minted handles, and the clears guard
  against cross-file leakage rather than dead handles.
- **Releasing the dropped handles.** After `reset` the registry that held them
  is gone; after a bare `install({ sink })` the sink that could release them is
  no longer installed.
- **Pruning `Tooltip.elementAttachments`' entries for dead anchors.** A real
  but separate gap, and unrelated to a seam swap.
- **An unsubscribe for `onSinkChange`.** Every registrant is module-scoped and
  outlives everything.

---

## Addendum: the module-scoped handle census

Re-run against `master` rather than inherited from the earlier plan, because
that plan's client count is the fact it reasoned from and three days of commits
had landed since. Every module-level `let` / `const` and every `static` field
outside `core/DOM.ts` whose type names `Handle` was listed and classified.

| Holder | Shape | Joins the registry? |
|---|---|---|
| `Glyphs._spriteElement`, `Glyphs._mountedSymbols` ([Glyphs.ts:58](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L58), [:65](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L65)) | the sprite `<svg>` plus a `<symbol>`/`<path>` pair per name, minted through the sink, app-lifetime, never released | **yes** |
| `Favicon._link` ([Favicon.ts:74](packages/lib/src/typescript/lib/core/Favicon.ts#L74)) | the injected `<link>`, minted through the sink, app-lifetime, never released | **yes** |
| `Tooltip.elementAttachments` ([Tooltip.ts:92](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L92)) | keyed by an anchor handle the caller supplied; `detachElement` removes the entry | no |
| `Tooltip.activeElement`, `Tooltip.pointerTarget` ([:93](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L93), [:149](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L149)) | the current anchor and the last pointer target; both guarded by `DOM.source.isRegistered` before use | no |
| `SpatialNavigation._lastFocus` ([SpatialNavigation.ts:217](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L217)) | last-focused descendant per target, overwritten each navigation | no |
| `PendingTransitions.running` ([PendingTransitions.ts:18](packages/lib/src/typescript/lib/core/PendingTransitions.ts#L18)) | cancel functions for in-flight transitions, removed as each finishes | no |
| `FocusTraversal._releaseOwner` ([FocusTraversal.ts:42](packages/lib/src/typescript/lib/core/FocusTraversal.ts#L42)) | one-shot Escape-release owner, cleared on the next focus move | no |
| `FocusHistory._entries` ([FocusHistory.ts:73](packages/lib/src/typescript/lib/core/FocusHistory.ts#L73)) | the focus trail, self-healing through `pruneStale()` before every query | no |

**So the count is still exactly two**, which is the number the earlier plan
declined a registry over. The case for building it now does not rest on client
count, and must not be read that way. It rests on three things the count does
not capture: the manual hook is deleted along with the four calls a suite had
to remember (a lapse the repo has already discovered the hard way twice, in
`font-gated-body-init` and `native-context-menu-suppression`); four comparisons
leave a render and startup path; and joining becomes one line at module scope
instead of a call at the top of every entry point that touches the cache —
which is what `Glyphs`' own above-the-early-out ordering rule was a symptom of.

A second group of module caches describes the document without naming a handle,
and deliberately does not join: `StyleTarget._ruleCache` and
`_styleSheetWritten`
([StyleTarget.ts:193](packages/lib/src/typescript/lib/core/StyleTarget.ts#L193),
[:201](packages/lib/src/typescript/lib/core/StyleTarget.ts#L201)), the
`let _classRule: StyleRule | null` singletons across the component tree,
`Glyph._keyframesInjected`, `Markdown._classRulesEnsured`, `Theme._fontInjected`
and `PointerDrag._suppressRuleCreated`. Each holds a `StyleRule` /
`CSSStyleRule` or an "already written" flag, and the stylesheet they describe
survives a seam swap untouched — `StyleTarget.ts:200`'s comment already says so
in as many words.

---

## Notes

[^census]: The census was re-run against `master` rather than inherited from
    `plans/implemented/glyph-sprite-reset-hook.md`'s *why-no-registry*
    footnote, because that footnote's client count is the fact it declined a
    registry over and three days of commits had landed since it was written.
    The count is unchanged at two. The addendum's table has eight rows — the
    two that migrate and six that do not — and is followed by the second group
    of caches, the ones that describe the document without naming a handle and
    deliberately stay out.

[^seven-cases]: Measured, not predicted. With the four `Favicon._reset()` calls
    commented out on an otherwise untouched `master`,
    `npx vitest run tests/core/Body.test.ts tests/core/BodyContextMenu.test.ts
    tests/core/ResizeDrag.test.ts` gave 7 failures in 33 tests:
    `BodyContextMenu.test.ts` 5 of 9 and `Body.test.ts` 2 of 8, each throwing
    `TestHandleTable: handle N is not registered` out of `Favicon.install` by
    way of `Body.setFavicon` and `Body.init`. `ResizeDrag.test.ts` passed all
    16, so its own call was never load-bearing. The files were restored with
    `git checkout` immediately afterwards. This is what makes the deletion safe
    to prescribe *and* what makes it the mechanism's strongest regression net:
    with `Favicon._reset()` gone from the codebase there is no manual hook left
    for a case to pass on.

[^prod-reach]: Both modules' defect is reachable only through a seam swap, and
    a seam swap is something only a test suite or a consumer driving
    `DOM.install` / `DOM.reset` itself performs. `grep -rn 'DOM.reset()'
    packages/lib/src/typescript` finds nothing but comments, and `DOM.install`
    has no production call site either. Both caches name app-lifetime document
    singletons that
    [docs/concepts/dom-seams.md](packages/lib/docs/concepts/dom-seams.md) says
    are "deliberately never released", and neither the `<head>` nor the sprite
    is ever torn down at runtime, so in a shipped app the handles stay valid
    forever. That sets the stakes: this is test hygiene plus one documented-API
    edge — a consumer that installs its own `DOMSink` through the public
    `DOM.install` and then renders a glyph or re-installs the favicon. It is not
    a bug an ordinary gesture can reach, which is why the plan buys its safety
    with deletions rather than with new machinery.

[^why-on-dom]: `core/DOM.ts` owns the state that changes and sits at the bottom
    of the stack, so the listener list belongs on it — the same relationship
    `ThemeManager` has to the active theme, which `DOM`'s own doc comment
    already draws. Three alternatives were weighed. **A separate broker
    module** (the `core/PendingTransitions.ts` / `core/FocusReveal.ts` shape)
    exists to keep two peers from importing each other; here there is a natural
    owner and no cycle to avoid, since `Glyphs.ts` and `Favicon.ts` already
    import `DOM` and `DOM` imports neither. **A `ListenerBag`** is
    [ARCHITECTURE.md](ARCHITECTURE.md)'s surface for a `Component` emitting
    typed custom events; `DOM` is a plain object and the seam swap is not a
    component event, so `ThemeManager`'s plain array is the closer precedent.
    **Generalising the lazy identity check into a shared helper** keeps
    today's per-call cost, and leaves every new cache having to remember the
    call at each entry point — the discipline whose absence gave `Favicon` its
    manual hook in the first place. No error isolation is added around the
    dispatch, matching `ThemeManager`: both listeners only assign `null` or
    clear a `Map`, and [CLAUDE.md](CLAUDE.md) rules out handling an impossible
    failure.

[^why-import-time]: The registrant is module-scoped state with no lifecycle, so
    there is no constructor or `attach()` to register from — which is exactly
    `BorderWidths`' situation, and it registers at import.
    `BorderWidths.ts:108-111` records an ordering constraint for its own
    registration (ahead of every per-component theme listener); no such
    constraint exists here, because each sink-change listener clears only its
    own module's state and no listener reads another's, so the comment on each
    registration says so rather than copying a constraint that does not apply.

[^why-sink-keyed]: Six files install a wrapper or spy over the current source
    and leave the sink alone — `tests/component/chart/ChartAxis.test.ts:53`,
    `tests/core/TextMeasure.test.ts:117`,
    `tests/component/TextBatchMeasure.test.ts:69`,
    `tests/core/BorderWidths.test.ts:69`, `tests/core/ThemeVars.test.ts:146`
    and `tests/overlay/Tooltip.test.ts:95`. In each, every handle stays valid,
    so a source-keyed trigger would discard a live sprite mid-test and build a
    duplicate. Both caches' handles are minted through `DOM.sink.createElement`
    / `createElementNS`, so the sink is the seam that produced them and the
    right thing to key on. `tests/dom/recorder.test.ts` is the mirror case — a
    sink installed on its own — where dropping is exactly right.

[^why-readonly]: Removing `Glyphs`' lazy check makes `install` and `reset`
    load-bearing, and today `DOMSeams` declares `sink` and `source` as plain
    mutable properties, so `DOM.sink = mySink` compiles. The lazy check caught
    that route; a push mechanism cannot. Leaving the properties writable would
    therefore ship a hole the code being replaced did not have. Two fixes were
    considered. **Accessor properties on `DOM`**, with the setter notifying,
    would close it completely — and would turn the single hottest read in the
    library (`DOM.sink`, read on every write the framework makes) from a
    property load into a function call. That is precisely the per-call cost on a
    render path this work is meant to remove, so it was rejected. **`readonly`
    on the interface** costs nothing at runtime: a `-readonly` mapped type
    gives `core/DOM.ts` a mutable alias of the same object, and the exported
    binding stays `DOMSeams`. The shape was checked against `tsc` 6.0.3 before
    drafting: the mapped type compiles, `DOM.install` / `DOM.reset` /
    `DOM.onSinkChange` all still typecheck from a consumer, and `DOM.sink = x`
    fails with TS2540. Like every other boundary the library declares —
    `private`, `protected`, `@internal`, the `local/no-raw-dom` rule — this is
    a compile-time guarantee, not a runtime one. No in-repo caller assigns a
    seam directly (`grep -rn 'DOM.sink *=\|DOM.source *=' src tests scripts`
    finds only `core/DOM.ts` itself), so nothing breaks; it is a breaking change
    on paper only, and the changelog records it as one.

[^why-cheaper]: Today `registerGlyph`, `unregisterGlyph`, `ensureGlyphSprite`
    and `ensureGlyphSymbolMounted` each begin with a property read and a
    reference comparison. `ensureGlyphSprite` and `ensureGlyphSymbolMounted`
    both run on every SVG glyph mount and every rename
    ([Glyph.ts:793-794](packages/lib/src/typescript/lib/component/display/Glyph.ts#L793),
    [:858-859](packages/lib/src/typescript/lib/component/display/Glyph.ts#L858)),
    and `registerGlyph` runs once per registered glyph at startup — an app
    registering a full icon set does that thousands of times. Afterwards the
    comparison happens once per `install` / `reset`, neither of which production
    calls, so the four render- and startup-path sites drop to zero and nothing
    is added anywhere production reaches. The clock will not move; the work does,
    in the right direction, which is the trade the repo's own rule sanctions
    (a work win with a flat clock ships unless it costs considerable
    complexity — and this one removes lines rather than adding them).

[^why-module-scope]: TypeScript's `private` confines access to the class body,
    so a module-level `DOM.onSinkChange(Favicon._forgetLink)` does not compile.
    The alternatives were a static field initialiser calling `onSinkChange`
    (which leaves an unread private field behind, and buries the registration
    inside the class where a reader will not look for it) or a static
    initialisation block (a syntax the Oxc transformer the Vite build uses is
    not known to handle, and `DOMSeams`' own doc comment already records one
    Oxc constraint shaping this file). Moving `_link` to module scope is neither
    of those, and lands `Favicon.ts` on the shape its three sibling caches
    already use: module-level state, a module-level named clearing function, one
    registration at the bottom.

[^why-internal-void]: The method's only callers are `Glyphs.ts` and
    `Favicon.ts`, so `@internal` keeps it off `/api/core/interfaces/DOMSeams`
    and out of a consumer's surface, consistent with `_handleRegistrySize`
    ([DOM.ts:539](packages/lib/src/typescript/lib/core/DOM.ts#L539)) — the
    existing `@internal` export in the same file. `ThemeManager.onThemeChange`
    returns an unsubscribe because its callers are components that tear down;
    a module-scoped cache never does, so an unsubscribe here would be API with
    no caller, which the repo's pre-1.0 rule deletes rather than ships. The
    notification-surface tests assert on counter deltas instead, which needs no
    unregister: each vitest file gets its own module graph, so a probe listener
    cannot leak past the file that registered it.

[^why-no-source-list]: The two mechanisms answer different questions and the
    seam doc says so after step 10. A *handle* is worthless the moment the sink
    that minted it is replaced, and the holder cannot find out except by being
    told — hence registration. A *value read through the source* is merely
    possibly stale, the read is already going through a function the holder
    owns, and re-reading it costs one seam call — hence a one-line check at that
    function's top, which is also what keeps a source spy from throwing away a
    perfectly good cache. `ThemeVars` is the only source-keyed cache with that
    check today; `BorderWidths` and `TextMeasure` are cleared by
    `ThemeManager.onThemeChange` and by `installTestDOM` respectively, and both
    arrangements work. Adding `onSourceChange` for no client is the
    configurability [CLAUDE.md](CLAUDE.md) rules out.

[^baseline]: Measured in this plan's own worktree, branched from `master` at
    `467ffb4e`: `npx vitest run` from `packages/lib` gave 521 files and 8765
    tests, 8763 passing and 2 `todo`, none failing; `npm run typecheck` and
    `npm run lint` silent; `npm run docs:api` 0 errors and 14 warnings;
    `npm run docs:llms:check` "108 catalogued, 121 explicitly excluded, 0
    unaccounted for". Step 1 re-measures rather than trusting these numbers,
    because `master` moves — but of the twelve files this plan touches, only
    `docs/reference/changelog/next.md` differs between `467ffb4e` and the
    repository's current tip, and it differs only by a `## Fixed` ›
    `### Components` section, which is why step 11 says to create the headings
    it needs if they are absent.

[^f1-measured]: Reproduced before drafting, in a throwaway file under
    `tests/core/` that was deleted afterwards. Two `installTestDOM(CONFIG)`
    calls with a `Favicon.install` after each, and no `Favicon._reset()` in
    between, failed with `TestHandleTable: handle 3 is not registered` thrown
    from `RecordingDOMSink.apply` inside `Favicon.install` at
    `core/Favicon.ts:94` — the `href`-swap branch. Standing `Favicon._reset()`
    in for the mechanism between the two installs turned the same case green
    with `linkCreations === 1` and `iconWrites === ['/b.svg']`, which are the
    values F1 asserts. The same probe confirmed F2's values today:
    `linkCreations === 1` and `['/a.svg', '/c.svg']` after a source-only
    install. Worth recording separately: the throw is itself news. The comment
    at `tests/core/Favicon.test.ts:44-46` says a released handle still accepts
    writes offline, which the modelled DOM's handle eviction has since made
    false — step 9 corrects it.
