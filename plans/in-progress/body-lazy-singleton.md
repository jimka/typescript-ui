---
touches-shared:
  - packages/lib/src/typescript/lib/core/Theme.ts
  - packages/lib/tests/setup/node-setup.ts
  - packages/qa/tests/mount.test.ts
  - ARCHITECTURE.md
  - packages/lib/docs/reference/changelog/next.md
  - plans/research/render-review-2026-09-15/01-phase2-status-pass.md
---

# Body as a lazy singleton — Implementation Plan

## Overview

[`core/Body.ts:47`](packages/lib/src/typescript/lib/core/Body.ts#L47) declares
`private static readonly INSTANCE: Body = new Body()`, so evaluating the module
constructs the page body: it reads the viewport, adds a resize listener, and
applies `ModernTheme`. That makes `./core` the one public entry point that
cannot be imported where there is no DOM — a Node script, a Vitest `node`
suite, an SSR build. `plans/implemented/no-dom-access-at-import.md` fixed every
other entry and left this one out of scope, recording it as a positive
assertion in
[`tests/unit/import-without-dom.test.ts:20`](packages/lib/tests/unit/import-without-dom.test.ts#L20),
which asserts that importing `./core` *rejects*.

This plan constructs the singleton on the first `Body.init()` /
`Body.getInstance()` call instead, following `Tooltip`'s lazy accessor
([`overlay/Tooltip.ts:185`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L185)).
`ThemeManager` gains one framework-internal door so the constructor applies
`ModernTheme` only when the app has not chosen a theme itself. Both timing
consequences were settled for the campaign on 2026-09-20 and are implemented
here rather than re-opened.[^decision]

The change is small in code — five product call sites across the monorepo, all
through `Body.init` or `Body.getInstance`, none of them touched — and its
weight is in the records that pinned the old behaviour: the entry-point guard,
the font-download test, `ARCHITECTURE.md`'s recorded exception, and
`docs/components/Body.md`'s "constructed when the module is first imported"
guarantee.

---

## Architecture Decisions

### The singleton is created on first use, mirroring `Tooltip`

`Body.instance` becomes a nullable private static, and `getInstance()`
constructs on first call. `init()` routes through `getInstance()` rather than
reaching the field, so there is one construction site.[^tooltip-precedent]

### `ThemeManager` records whether a theme was ever set

`ThemeManager` gains a private `themeApplied` flag, set by `setTheme`, and a
framework-internal `_applyDefaultTheme()` that applies `ModernTheme` only while
that flag is false. `Body`'s constructor calls `_applyDefaultTheme()` instead
of `setTheme(ModernTheme)`.

A flag is needed because `ThemeManager.current` already *is* `ModernTheme`
before anything runs ([`core/Theme.ts:1332`](packages/lib/src/typescript/lib/core/Theme.ts#L1332)),
so its value cannot distinguish "nobody chose" from "somebody chose Modern".
`setTheme` is the only writer of the flag.[^why-flag]

Today the eager construction guarantees that an app's own `setTheme` runs
*after* `Body`'s, because `Body`'s runs during the import that the app's first
line depends on. Going lazy would invert that for an app that sets a theme
before mounting — the sequence
[`docs/recipes/custom-theme.md:38-48`](packages/lib/docs/recipes/custom-theme.md#L38)
teaches. The flag keeps today's outcome in all three orderings:

| Order | What the app does | Theme in force after the body is first reached | Why |
|---|---|---|---|
| A | nothing, then `Body.init({ … })` | `ModernTheme` | no `setTheme` ran, so the constructor applies the default |
| B | `setTheme(DarkTheme)`, then `Body.init({ … })` | `DarkTheme` | a `setTheme` ran, so the constructor applies nothing |
| C | `Body.init({ … })`, then `setTheme(DarkTheme)` | `DarkTheme` | the app's call is the later one |

### `getInstance()` stays public

`Body.getInstance()` has real consumers outside the library —
[`packages/qa/src/harness/tree.ts:17`](packages/qa/src/harness/tree.ts#L17)
walks the component tree from it — and three documentation pages teach it, so
the pre-1.0 rule that deletes caller-less public API does not reach it.
`Tooltip.getInstance` is private because `Tooltip`'s public surface is its
other statics; only its *shape* is the precedent here, not its
visibility.[^public-surface]

### The default theme now lands after an app has built its tree

An app builds its shell and then calls `Body.init({ components: [shell] })`, so
the first theme application now happens with that shell already constructed.
Every component built before that first touch therefore receives one
theme-change callback and re-measures. That is correct — those components were
constructed before any theme variable existed on `<html>`, so their first
measurements were taken against the browser's own default font — and it costs
one re-measure of a tree that has not been laid out yet.

Under jsdom that re-measure is not free: it reaches a canvas 2D context, which
jsdom does not implement, and the QA app already records that gap
([`packages/qa/tests/mount.test.ts:126-138`](packages/qa/tests/mount.test.ts#L126)).
The two QA files that mount panels under jsdom therefore construct the
singleton before they build anything.[^qa-prime]

### `tests/setup/node-setup.ts` keeps its top-level DOM install

The top-level `installTestDOM` + `_flushDeferredStyleSheetWrites()` block
([`node-setup.ts:46-49`](packages/lib/tests/setup/node-setup.ts#L46)) stays.
Only its comment changes, because the comment's first reason — `core/Body.ts`
rendering at import — stops being true while its second, the stylesheet flush,
does not. Removing the block fails eight test files.[^node-setup-measured]

---

## Public API

No exported signature changes. `getInstance()` gains an explicit return type it
did not annotate before, and one framework-internal static joins `ThemeManager`
beside the existing `_themeListenerCount`:

```typescript
class Body extends Component<BodyOptions> {
    private static instance: Body | null;          // was: private static readonly INSTANCE: Body = new Body()

    static getInstance(): Body;                    // constructs on first call
    static init(options?: BodyOptions): Body;      // unchanged
}

class ThemeManager {
    private static themeApplied: boolean;          // new; written only by setTheme

    /** @internal */
    static _applyDefaultTheme(): void;             // new
}
```

---

## Internal Structure

`core/Theme.ts` — the flag and its one reader:

```typescript
    private static current: Theme = ModernTheme;
    // `current` starts at ModernTheme, so its value cannot say whether an app
    // ever chose a theme. This flag can: `setTheme` is its only writer.
    private static themeApplied: boolean = false;
```

```typescript
    /**
     * Applies {@link ModernTheme} unless a theme has already been set, so a
     * `setTheme` call made before the page body is first reached keeps its
     * choice.
     *
     * @internal Framework-internal; called once, from `Body`'s constructor.
     */
    static _applyDefaultTheme(): void {
        if (ThemeManager.themeApplied) {
            return;
        }

        ThemeManager.setTheme(ModernTheme);
    }
```

`core/Body.ts` — the lazy accessor:

```typescript
    private static instance: Body | null = null;

    static getInstance(): Body {
        if (!Body.instance) {
            Body.instance = new Body();
        }

        return Body.instance;
    }
```

---

## Ordered Implementation Steps

Steps 1–3 pin the new behaviour and are expected to fail; step 4 and 5 make
them pass. Run everything from `packages/lib` unless a step says otherwise.

1. **`packages/lib/tests/unit/import-without-dom.test.ts` — drop the
   exception (red).** Replace the comment at lines 15–19 and the set at line 20
   with:

   ```typescript
   // Every entry imports cleanly: `core/Body.ts` constructs its singleton on
   // first use, so nothing in the library renders at import. A new entry that
   // reintroduces an import-time DOM touch fails here rather than reaching a
   // consumer.
   const KNOWN_IMPORT_TIME_DOM: ReadonlySet<string> = new Set<string>();
   ```

   Run `npx vitest run tests/unit/import-without-dom.test.ts` — expect the
   `./core` case to fail with `document is not defined`.

2. **`packages/lib/tests/dom/fonts-ready.test.ts` — rewrite the download
   case (red).** Replace the whole `ThemeManager — web font download` describe
   (lines 130–151) with the two cases below. The first is new; the second is
   the old case re-aimed at the body rather than at a bare `setTheme`, which is
   what now decides when the download starts.

   ```typescript
   describe('Body — web font download', () => {
       afterEach(async () => {
           Reflect.deleteProperty(document, 'fonts');

           // Constructing the body arms the startup gate in its own fresh
           // module graph; release that copy, the way the gate cases below do.
           const { releaseFirstLayout } = await import('~/core/FirstLayoutGate');
           releaseFirstLayout();
           vi.resetModules();
       });

       it('starts no download when the module is imported', async () => {
           const fontSet = installIdleFontSet();

           // `ensureFontLoaded` is guarded by a module-level once-flag, so this
           // needs a module graph where it has not already run — independent of
           // whatever else in this file has called setTheme.
           vi.resetModules();
           await import('~/core/Body');

           expect(fontSet.loadCalls).toEqual([]);
       });

       it('starts the download when the body is first reached, not at first paint', async () => {
           const fontSet = installIdleFontSet();

           vi.resetModules();
           const { Body: FreshBody } = await import('~/core/Body');

           FreshBody.getInstance();

           // Nothing has been laid out yet — the fetch is under way regardless,
           // which is the whole point: it overlaps the first layout instead of
           // following it.
           expect(fontSet.loadCalls).toEqual(['14px "Manrope Variable"']);
       });
   });
   ```

   Run `npx vitest run tests/dom/fonts-ready.test.ts` — expect
   `starts no download when the module is imported` to fail.

3. **`packages/lib/tests/core/Body.test.ts` — pin laziness and the theme
   rule (red).** Add `vi` to the `vitest` import on line 1, then append the
   describe below. Each case needs a *fresh module graph*, because the
   singleton and the theme flag are module state that the file's other cases
   have already moved; `installTestDOM` must be re-imported inside that graph
   too, or the freshly imported `Body` uses a different `~/core/DOM` copy that
   still has the production seams.

   ```typescript
   describe('Body — lazy construction', () => {
       afterEach(() => DOM.reset());

       it('B2. writes nothing until the singleton is first reached', async () => {
           vi.resetModules();

           const { installTestDOM: freshInstallTestDOM } = await import('../dom/TestDOM');
           const sink = freshInstallTestDOM(CONFIG);
           const { Body: FreshBody } = await import('~/core/Body');

           const writesAfterImport = sink.writes.length;

           FreshBody.getInstance();

           expect(writesAfterImport).toBe(0);
           expect(sink.writes.length).toBeGreaterThan(0);
       });

       it('B3. applies ModernTheme when the app set no theme', async () => {
           vi.resetModules();

           const { installTestDOM: freshInstallTestDOM } = await import('../dom/TestDOM');
           freshInstallTestDOM(CONFIG);
           const { ThemeManager: FreshThemeManager, ModernTheme: FreshModernTheme } = await import('~/core/Theme');
           const { Body: FreshBody } = await import('~/core/Body');

           const setTheme = vi.spyOn(FreshThemeManager, 'setTheme');

           FreshBody.getInstance();

           expect(setTheme).toHaveBeenCalledWith(FreshModernTheme);
       });

       it('B4. keeps a theme the app chose before the body was reached', async () => {
           vi.resetModules();

           const { installTestDOM: freshInstallTestDOM } = await import('../dom/TestDOM');
           freshInstallTestDOM(CONFIG);
           const { ThemeManager: FreshThemeManager, DarkTheme: FreshDarkTheme } = await import('~/core/Theme');
           const { Body: FreshBody } = await import('~/core/Body');

           FreshThemeManager.setTheme(FreshDarkTheme);

           const setTheme = vi.spyOn(FreshThemeManager, 'setTheme');

           FreshBody.init({});

           expect(setTheme).not.toHaveBeenCalled();
           expect(FreshThemeManager.getTheme()).toBe(FreshDarkTheme);
       });
   });
   ```

   Run `npx vitest run tests/core/Body.test.ts` — expect B2 and B3 to fail and
   B4 to pass.[^b4-today]

4. **`packages/lib/src/typescript/lib/core/Theme.ts` — the flag and the
   default-theme door.** Add `themeApplied` under `current` (line 1332) and
   `ThemeManager.themeApplied = true;` as the first statement of `setTheme`
   (line 1366), both as shown in `## Internal Structure`. Add
   `_applyDefaultTheme()` *after* `setTheme`'s closing brace and before the
   `// Guards the onFontsReady subscription …` comment at line 1404 — putting
   it before `setTheme` would leave `setTheme` wearing `_applyDefaultTheme`'s
   JSDoc. Verify: `npm run typecheck` clean.

5. **`packages/lib/src/typescript/lib/core/Body.ts` — the lazy singleton.**
   - Line 47: replace the `INSTANCE` field with
     `private static instance: Body | null = null;`.
   - Lines 57–59: replace `getInstance`'s body with the guarded construction
     from `## Internal Structure`, and annotate the return type `: Body`.
   - Lines 85–106: in `init`, add `const instance = Body.getInstance();` as the
     first statement and replace all five `this.INSTANCE` references with
     `instance`.
   - Line 190: `ThemeManager.setTheme(ModernTheme);` →
     `ThemeManager._applyDefaultTheme();`.
   - Line 7: drop the now-unused `ModernTheme` from the `~/core/Theme.js`
     import, leaving `import { ThemeManager } from "~/core/Theme.js";`.

   Verify: `npm run typecheck` and `npx eslint src` clean, then re-run the
   three files from steps 1–3 — expect green.

6. **Grep checkpoint.** From `packages/lib`:
   `grep -rn 'INSTANCE' src/typescript/lib/core/Body.ts` — expect zero matches.

7. **`packages/lib/src/typescript/lib/core/Body.ts` — the comments that
   describe the old timing.** Four edits, none behavioural:
   - `getInstance`'s JSDoc (lines 49–56): add that it creates the instance on
     first call, mirroring
     [`Tooltip.ts:180-184`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L180).
   - `init`'s `@remarks` (lines 78–83): "The singleton is constructed once per
     page load" → "The singleton is constructed on the first `init` /
     `getInstance` call and then lives for the page".
   - The two inline comments inside `init` (lines 89–92 and 97–100): "which
     also runs during the singleton's construction at module import" → "which
     also runs during the singleton's construction on first use".

8. **`packages/lib/tests/setup/node-setup.ts` — the stale reason.** Replace
   lines 31–34 with:

   ```typescript
   // Install at setup-file top level too, not only per-test: the flush below
   // writes through the DOM seam, so a sink must be installed before it runs,
   // and it must run before the test file's module graph imports its modules.
   // Setup files evaluate before that graph, which is what makes both possible.
   ```

   Leave the code below it and the paragraph about the flush untouched.

9. **`packages/qa/tests/panels.test.ts` — construct the body before the
   first build.** Replace the header comment's first sentence — lines 3–5, from
   "The panels import the built library" up to and including "production DOM
   seam." — with "The panels mount into the real page body, and P3 lays a chart
   out through the production DOM seam." Leave the rest of line 5 ("So this file
   needs a real") and everything after it as it is. Then insert, immediately
   above `const HERE = …` on line 24:

   ```typescript
   // The library applies its default theme at the first `Body` touch, and
   // `mountPanel` builds a panel before it calls `Body.init`. Constructing the
   // singleton here keeps that theme pass ahead of every tree this file builds,
   // so it never re-measures a built control through the canvas 2D context
   // jsdom does not implement (the gap `mount.test.ts`'s JSDOM_GAPS names).
   Body.getInstance();
   ```

10. **`packages/qa/tests/mount.test.ts` — the same prime.** Replace the
    sentence on lines 5–6 ("The panels import the built library, whose `core`
    entry point reads `document` at import time, so this file needs a real
    DOM.") with "The panels mount into the real page body, so this file needs a
    real DOM." Leave the rest of line 6 ("jsdom lays") and everything after it
    as it is. Then insert the same `Body.getInstance();` block immediately above
    `const SMOKE_SCALE` on line 20, with the last clause of the comment reading
    "(the gap JSDOM_GAPS names below)".

11. **Run the QA suite.** The QA app resolves the library from
    `packages/lib/dist`, so build it first: `npm run build:lib` from the
    repository root, then `npx vitest run --dir tests` from `packages/qa` —
    expect 12 files, 244 tests, green. Do **not** start the QA dev server or a
    panel window.

12. **Docs — `packages/lib/docs/components/Body.md`.** Rewrite the Singleton
    bullet (line 81) as:

    ```markdown
    - **Singleton** — constructed on the first `Body.init()` or `Body.getInstance()` call, not when the `Body` module is imported. Both hand back that same instance for the rest of the page's life. Do not `Body()` yourself.
    ```

    and extend the Theme bootstrap bullet (line 84) with a second sentence: "A
    theme chosen before the body is first reached is kept — `Body` applies
    `ModernTheme` only when no theme has been set."

13. **Docs — `ARCHITECTURE.md`, *Defer DOM work to render time*.** In the
    *Module load* bullet (line 326), replace the last two sentences with:
    "`packages/lib/tests/unit/import-without-dom.test.ts` checks that every
    non-wildcard entry point imports with no DOM present. One module-level DOM
    touch is a recorded exception: `component/display/Glyph.ts`'s
    `prefers-reduced-motion` listener, which the `matchMedia` seam makes inert
    off-browser."

14. **Docs — the changelog.** Add to
    `packages/lib/docs/reference/changelog/next.md`, under `## Changed` →
    `### Core`:

    ```markdown
    - **The `Body` singleton is constructed on the first `Body.init()` /
      `Body.getInstance()` call**, not when `@jimka/typescript-ui/core` is
      imported, so every entry point now imports where there is no DOM — a
      Node script, a Vitest `node` suite, an SSR build. Two timing
      consequences: the bundled Manrope download starts at that first call
      rather than at import, and a theme chosen with `ThemeManager.setTheme`
      before the body is first reached is kept, because `Body` applies
      `ModernTheme` only when no theme has been set. Public signatures are
      unchanged.
    ```

15. **The register.** In
    `plans/research/render-review-2026-09-15/01-phase2-status-pass.md`, change
    item 4's verdict in the *Agenda items* table (line 86) from "open, needs a
    decision" to "**settled** by `plans/body-lazy-singleton.md`", and append to
    the item-4 bullet of *Decisions taken 2026-09-20* (line 423) a sentence in
    the inline style the neighbouring entries use: **Settled by
    `plans/body-lazy-singleton.md` (2026-09-20)**, noting that the "no theme
    has been set" state is a `ThemeManager` flag written only by `setTheme`,
    and that the default theme now reaches components built before the first
    `Body` touch.

16. **Full verification.** Run the `## Verification` block end to end.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Theme.ts` |
| Modify | `packages/lib/tests/unit/import-without-dom.test.ts` |
| Modify | `packages/lib/tests/dom/fonts-ready.test.ts` |
| Modify | `packages/lib/tests/core/Body.test.ts` |
| Modify | `packages/lib/tests/setup/node-setup.ts` |
| Modify | `packages/qa/tests/panels.test.ts` |
| Modify | `packages/qa/tests/mount.test.ts` |
| Modify | `packages/lib/docs/components/Body.md` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `plans/research/render-review-2026-09-15/01-phase2-status-pass.md` |

---

## Expected Behaviour

Unit-testable. Cases 1–5 are the assertions added in steps 1–3; 6 and 7 are
already covered by suites that exist; 8 is what the QA run in step 11 exercises:

1. **Every public entry point imports with no DOM.** With the production seams
   and no `document`, importing each non-wildcard `exports` key of
   `packages/lib/package.json` resolves — `./core` included.
2. **Importing `~/core/Body` writes nothing.** In a fresh module graph with the
   modelled DOM installed, the recording sink has zero writes after the import
   and at least one after the first `Body.getInstance()`.
3. **No font download at import; one at first use.** In a fresh graph with an
   idle font-set stub, importing `~/core/Body` records no `load` call, and the
   first `Body.getInstance()` records `14px "Manrope Variable"` — still before
   anything is laid out.
4. **`ModernTheme` when nobody chose.** With no prior `setTheme`, the first
   `Body.getInstance()` calls `setTheme(ModernTheme)` (order A in the table
   above).
5. **An earlier choice is kept.** After `setTheme(DarkTheme)`, the first
   `Body.init({})` calls `setTheme` no further and `getTheme()` is still
   `DarkTheme` (order B).
6. **A later choice still wins.** `Body.init({})` then `setTheme(DarkTheme)`
   leaves `DarkTheme` in force (order C) — unchanged from today, and already
   covered by the theme suites.
7. **A second `init()` behaves as before.** `Body.init({})` twice returns the
   same instance, rebinds the element buffers, and registers the `contextmenu`
   viewport listener exactly once — the existing assertions in
   [`tests/core/BodyContextMenu.test.ts:98`](packages/lib/tests/core/BodyContextMenu.test.ts#L98)
   keep passing unchanged, because only *when* the first construction happens
   moved.
8. **Components built before the first `Body` touch re-measure once.** Building
   a `Button`, then calling `Body.init({ components: [button] })` with no prior
   `setTheme`, fires the button's theme-change callback during that call. This
   is the new edge; the QA jsdom files are where it first showed up, and step 9
   and 10's prime is the response.

Manual verification — a person opens the page in a browser. Do not launch the
QA panel host, MiniBrowser or any Tauri command for either of these:

9. **The demo app still mounts and is themed.** `npm run dev` in
   `packages/lib`, open the served page: the shell renders with Manrope and
   Modern colours, and the theme cycle button in `MiscPanel` still switches
   themes.
10. **The docs app still mounts.** `npm run docs:dev`, open the served page.

---

## Verification

From the repository root unless stated:

- `npm run typecheck` — clean.
- `cd packages/lib && npx tsc -p tsconfig.test.json --noEmit` — clean.
- `cd packages/lib && npx eslint src` — clean.
- `npm test` — the whole library suite green. The success criterion is
  concrete: `'./core'` is gone from `KNOWN_IMPORT_TIME_DOM` and
  `tests/unit/import-without-dom.test.ts` passes with **every** entry point
  importable without a DOM (24 cases).
- `npm run build:lib` — builds, and is the prerequisite for the QA run below,
  which resolves the library from `packages/lib/dist`.
- `cd packages/qa && npx vitest run --dir tests` — 12 files, 244 tests, green.
  This is the check that the QA app still starts: `tests/mount.test.ts` mounts
  every panel through the real `mountPanel`. **Never launch a QA panel,
  MiniBrowser or Tauri command.**
- `cd packages/docs && npx vitest run` — green. It needs the generated API tree
  at `packages/lib/docs/api`, so run `npm run docs:api` first if it is absent.
- `npm run docs:api` — finishes with no new warning naming `Body` or
  `ThemeManager`.[^typedoc-baseline]
- `npm run docs:llms:check` — the coverage gate passes; run `npm run docs:llms`
  and commit the result if the generated `llms.txt` files change.
- `grep -rn "at import time\|at module import" packages/lib/tests packages/qa/tests packages/lib/src/typescript/lib/core/Body.ts` —
  no surviving hit may still attribute an import-time DOM touch to `Body`.

---

## Documentation Impact

- `packages/lib/docs/components/Body.md` — the Singleton note (line 81)
  documents the eagerness as a guarantee and is rewritten; the Theme bootstrap
  note (line 84) gains the precedence sentence. Step 12.
- `ARCHITECTURE.md` — the *Module load* bullet names `core/Body.ts`'s `INSTANCE`
  as one of two recorded exceptions and says the guard exempts `./core`. Both
  clauses go. Step 13.
- `packages/lib/docs/reference/changelog/next.md` — a *Changed › Core* entry.
  Step 14.
- `packages/lib/docs/reference/migration/next.md` — **no entry.** Nothing is
  removed or renamed and no call becomes a compile error, so there is nothing
  for a consumer to act on.
- `plans/research/render-review-2026-09-15/01-phase2-status-pass.md` — item 4's
  row and decision bullet. Step 15.
- No change to `packages/lib/llms.txt` or `scripts/llms/manifest.data.mjs`:
  their `Body` rule is about `init` versus `getInstance`, which is unchanged.
  No change to `packages/lib/docs/concepts/theming.md` either — "Because `Body`
  calls `setTheme` on construction, any app that mounts the framework gets
  Manrope automatically" stays true when construction moves.
- No change to `packages/lib/docs/recipes/custom-theme.md`: its "call `setTheme`
  before mounting any component" sequence is exactly the contract the new flag
  preserves.

---

## Potential Challenges

- **The default theme reaching an already-built tree.** Expected Behaviour 8 —
  correct in a browser, fatal under jsdom, where the re-measure hits a canvas
  2D context jsdom does not implement. Mitigation: steps 9 and 10 construct the
  singleton before those files build anything, which is a one-line restoration
  of today's ordering inside the test.
- **`mount.test.ts` passes today without the prime, by luck.** Its first mount
  is `canvas-idle`, alphabetically first and free of any text-measuring
  control. Mitigation: prime it anyway (step 10), so the pass stops depending on
  panel order.
- **Fresh-graph tests that forget to re-import `installTestDOM`.** A
  `vi.resetModules()` graph gets its own `~/core/DOM`, so a statically imported
  `installTestDOM` installs into the wrong copy and the fresh `Body` throws
  `document is not defined`. Mitigation: step 3's snippets import
  `../dom/TestDOM` inside each case; copy them verbatim.
- **Stylesheet order.** Constructing the body writes three shared framework
  rules and one per-instance `#id` rule, and nothing else, so its move does not
  reorder any class rule against another.[^rule-order] Mitigation: the existing
  order suites (`tests/core/StyleTarget.test.ts` E1–E9,
  `tests/component/input/focusRing.test.ts` F1–F2) must stay green, and they do.
- **The startup layout gate is armed later.** `holdFirstLayout()` runs inside
  `setTheme`, so it now arms at the first `Body` touch rather than at import. An
  app that somehow flushes a layout before touching `Body` no longer has its
  first flush held. Mitigation: none needed — the gate exists to pair with the
  font download, and the two still start together.

---

## Critical Files

- [`packages/lib/src/typescript/lib/overlay/Tooltip.ts:78`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L78)
  and [`:185`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L185) — the
  lazy-singleton precedent this plan copies: nullable private static, guarded
  construction inside the accessor.
- [`packages/lib/src/typescript/lib/core/Body.ts`](packages/lib/src/typescript/lib/core/Body.ts) —
  the class being changed; read the constructor (`:183-191`) and `init`
  (`:85-106`) together before editing either.
- [`packages/lib/src/typescript/lib/core/Theme.ts:1331-1402`](packages/lib/src/typescript/lib/core/Theme.ts#L1331) —
  `ThemeManager`'s statics and `setTheme`, including `_themeListenerCount`
  (`:1350`), the naming precedent for `_applyDefaultTheme`.
- [`packages/lib/tests/unit/import-without-dom.test.ts`](packages/lib/tests/unit/import-without-dom.test.ts) —
  the guard that defines this plan's success criterion.
- [`packages/lib/tests/setup/node-setup.ts`](packages/lib/tests/setup/node-setup.ts) —
  read the whole file before touching the comment; the block has two reasons and
  only one of them changes.
- [`packages/qa/src/mount.ts:79-81`](packages/qa/src/mount.ts#L79) — build,
  then `Body.init`; the ordering that makes Expected Behaviour 8 visible.
- `plans/research/render-review-2026-09-15/01-phase2-status-pass.md`, *Decisions
  taken 2026-09-20* — the settled decision this plan implements.

---

## Non-Goals

- **Removing `tests/setup/node-setup.ts`'s top-level DOM install.** Measured as
  load-bearing for a second reason.[^node-setup-measured]
- **Guarding `ProductionDOMSource.measureFontMetrics` against a null 2D
  context** ([`core/DOM.ts:2396`](packages/lib/src/typescript/lib/core/DOM.ts#L2396)).
  The cast at `:2401` hides a null jsdom returns; it is pre-existing, the QA app
  already records it as an environment gap, and hardening it is a separate
  change.
- **Making `getInstance()` private, or adding a `dispose`/reset door for tests.**
  The first has consumers and documentation; the second is speculative API
  nothing asks for.
- **Any change to the five product call sites.** `packages/create-app/template/src/main.ts`,
  `packages/docs/src/main.ts`, `packages/lib/src/typescript/main.ts`,
  `packages/qa/src/mount.ts` and `packages/qa/src/harness/tree.ts` all go
  through `Body.init` / `Body.getInstance` and keep working untouched.
- **Anything else in the correctness register.** Item 4 only.

---

## Notes

[^decision]: `plans/research/render-review-2026-09-15/01-phase2-status-pass.md`,
    *Decisions taken 2026-09-20*, item 4: "`Body` may go lazy, and both
    consequences are accepted." The font download may start at the first
    `Body.init()`/`getInstance()` instead of at module import, and the
    constructor applies `ModernTheme` only when no theme has been set. The same
    entry names `Tooltip.getInstance` as the precedent, requires `'./core'` out
    of `KNOWN_IMPORT_TIME_DOM`, and says the `fonts-ready` case that pins
    "starts the download when the rules are installed, not at first paint" is
    rewritten rather than kept. Neither consequence is re-opened here.

[^tooltip-precedent]: `Tooltip` declares `private static instance: Tooltip | null = null`
    (`overlay/Tooltip.ts:78`) and constructs inside its accessor
    (`:185-191`): `if (!Tooltip.instance) { Tooltip.instance = new Tooltip(); }`.
    The same field shape appears in `diagnostics/DiagnosticsOverlay.ts:66` and
    `diagnostics/StyleAuditOverlay.ts:39`, so it is the library's settled way to
    hold a lazily built singleton and `Body` takes it rather than inventing one
    — a module-level `let`, a getter property, or a `Proxy` would each be new.
    `Tooltip` is the one the decision names, and the one whose accessor shape
    `getInstance()` copies. Routing `init`
    through `getInstance()` rather than through the field keeps a single
    construction site, so a future caller cannot reach an unconstructed
    singleton.

[^why-flag]: Two alternatives were considered and rejected. Making
    `ThemeManager.current` nullable (`Theme | null`) and having `getTheme()`
    return `current ?? ModernTheme` distinguishes the states, but it moves a
    null check into every internal reader of a hot static and still needs a
    door for `Body` to read the state through. Having `Body` call
    `ThemeManager.setTheme(ThemeManager.getTheme())` needs no new state at all
    and gets the right theme in all three orderings, but it *re-applies* the
    app's theme, which fans out a second `reflowText()` to every subscribed
    component. That is not hypothetical: with that variant,
    `tests/component/table/HeaderThemeReflow.test.ts`'s third case fails —
    the re-application reaches undisposed tables from earlier cases in the file
    and writes through their stale handles (`TestHandleTable: handle 25 is not
    registered`). The flag skips the work entirely when an app has chosen, which
    is both cheaper and what the decision literally says.

[^public-surface]: `Body.getInstance()` is called from `packages/qa/src/harness/tree.ts:17`,
    `packages/qa/tests/mount.test.ts`, `packages/docs/tests/DocsSidebar.test.ts:59`
    and three `packages/lib` test files, and is taught by
    `docs/components/Body.md:36`, `docs/reference/troubleshooting.md:34` and
    rule 4 of `packages/lib/llms.txt`. The pre-1.0 policy deletes public API
    with no callers anywhere and privatises API used only inside the library;
    neither branch applies.

[^qa-prime]: `mountPanel` builds the panel and then calls `Body.init`
    (`packages/qa/src/mount.ts:79-81`), so under the new ordering the first
    mount in a jsdom file applies the default theme to an already-built tree.
    In `packages/qa/tests/panels.test.ts` that tree is `chart-line`'s, whose
    `Button` re-measures through `Util.opticalCenterOffset` →
    `ProductionDOMSource.measureFontMetrics`, and jsdom's
    `getContext("2d")` returns null: `TypeError: Cannot set properties of null
    (setting 'font')` — the identical message `mount.test.ts`'s `JSDOM_GAPS`
    already records for `table-rows`, `form-flat` and `form-nested`.
    Constructing the singleton at the top of the file restores today's order
    (theme first, trees after) in one line. Stubbing
    `HTMLCanvasElement.prototype.getContext`, the way
    `plans/canvas-idle-loops.md` step 11 does for one describe in
    `mount.test.ts`, was rejected here: it is eight lines that make these files
    exercise font measurement, which is not what they are for, and it would
    couple this plan to that one landing first.

[^node-setup-measured]: Deleting the top-level
    `installTestDOM(BASELINE_CONFIG); _flushDeferredStyleSheetWrites();` block
    with `Body` already lazy was measured: eight test files fail —
    `component/container/VirtualScroller.test.ts`,
    `component/content-box-containment.test.ts`,
    `component/input/AutoCompleteField.test.ts`, `DateField.test.ts`,
    `DateTimeField.test.ts`, `TimeField.test.ts`, `focusRing.test.ts` and
    `core/ComponentDispose.test.ts`. The flush is what marks the stylesheet as
    written so each module's load-time rule lands in the baseline sink instead
    of whichever test first renders, and the flush needs a sink installed to
    write through — so both lines stay and only the comment's first reason
    changes.

[^b4-today]: B4 passes before the source change too, because today's eager
    construction has already applied `ModernTheme` by the time the case's
    `setTheme(DarkTheme)` runs, so no further `setTheme` happens inside
    `init({})` either. It is a regression guard for the lazy path rather than a
    red-then-green case; B2 and B3 are the ones that must fail first.

[^rule-order]: Measured in a fresh module graph with the modelled DOM:
    constructing the body inserts exactly four rules —
    `:where(.ts-ui-component)`, `.ts-ui-component.undisplayed`,
    `.ts-ui-component.invisible:not(.undisplayed)` and one `#<uuid>`
    per-instance rule. The first three are the shared framework rules any first
    render writes, so they are written by whichever component renders first
    instead; the fourth is unique to the body's own element. The one real
    ordering shift is that a load-time stylesheet write registered *after*
    `./core` was imported used to land behind those three framework rules and
    now lands ahead of them, because the deferral queue holds everything until
    the app's own first real write. No load-time rule shares a property with a
    `.ts-ui-component` state rule, and `:where()` carries zero specificity, so
    nothing resolves differently — which the order suites confirm.

[^typedoc-baseline]: `npm run docs:api` already reports 15 warnings, none of
    them from `core/Body.ts` or `core/Theme.ts` — all are public JSDoc linking
    to unexported symbols in unrelated files (`SpatialNavigation`,
    `MarkdownViewer`, `MarkdownEditor`, `FieldDecorator`). `_applyDefaultTheme` is `@internal`, so TypeDoc excludes
    it and links to it are not possible from rendered docs; the count must not
    grow and no new warning may name `Body` or `ThemeManager`.
