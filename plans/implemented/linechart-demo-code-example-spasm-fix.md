# CodeEditor Guess-Height Correction Diagnostic — Implementation Plan

## Overview

**Correction (see `## Addendum: Real-Chrome Trace — The Defect Was Real`):** the "no defect confirmed" conclusion below was wrong. A user-supplied real-Chrome performance trace, taken after this plan shipped, caught a real, sustained relayout storm on this page that the automated Chromium reproduction below never triggered. The root cause and its fix are not in this plan — they're the sibling `markdown-code-editor-resize-lag-fix` plan/branch, confirmed live (see the Addendum) to eliminate the storm. The diagnostic this plan ships is still valid, harmless, unrelated instrumentation for a genuinely separate one-shot correction; it is simply not the fix for the reported bug.

A user reported that the LineChart docs page's "In-memory series" fenced code example "spasms and never settles." This plan is the outcome of a thorough attempt to reproduce that report against `master` (which already has both `markdown-code-editor-highlighting` and `markdown-code-editor-autogrow-height` merged) and to root-cause it. Reproduction failed: two independent, navigation-time-instrumented page loads of `/typescript-ui/components/LineChart`, a theme-switch test, and a console-error check all show the fenced blocks reaching a final, stable geometry and staying there — no oscillation, no ongoing change, nothing matching "never settles." The full investigation log is in `## Addendum: Investigation Log`.

What the investigation did find, twice, identically, is a real but small and momentary visual correction: [`Markdown.applyCodeEditorUpgrade`](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L811) pins a fenced block's wrapper to a height guessed from the plain placeholder `<pre>`, and moments later `CodeEditor`'s own post-mount [`syncAutoHeight`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L676) corrects that guess to CodeMirror's real, measured content height — a one-frame snap that both shipped plans already designed and documented as intentional. On the "In-memory series" block specifically — the block named in the report — this correction measured 20px in both reproductions; the "Store-bound" block's was 29px. Since no defect was confirmed, this plan does not change any rendered behaviour. Its only deliverable is a diagnostic: a `console.warn` that fires if a future mount's guess-to-real correction is large enough to plausibly read as a visible snap, so a future report of this kind comes with hard numbers instead of a cold trail.

---

## Architecture Decisions

### No behavioural fix ships — the reported defect did not reproduce

Per the investigation log, every reproduction attempt (including one starting a `MutationObserver` and a `requestAnimationFrame` geometry poll before the docs app's own bootstrap script ran) shows the fenced blocks settling permanently within under a second of navigation and staying stable for 10–15+ seconds afterward, and a subsequent theme switch produces zero further change. Shipping a behavioural change for an unconfirmed defect risks solving the wrong problem while masking the real one if it resurfaces later.[^negative-result]

### The diagnostic follows the codebase's existing anomaly-`console.warn` pattern

`Grid.ts`, `Popover.ts`, and `Router.ts` all surface a structural anomaly with an ungated `console.warn("ClassName: message")` — [`Grid.ts:1036`](../packages/lib/src/typescript/lib/layout/Grid.ts#L1036) (`Grid: ${id} overlaps ${owner} at cell (${rr},${cc})`), [`Popover.ts:784`](../packages/lib/src/typescript/lib/overlay/Popover.ts#L784) (`Popover: explicit placement "..." overflows the viewport; falling back to "...".`), [`Router.ts:106`](../packages/lib/src/typescript/lib/router/Router.ts#L106). None of these are gated behind a build flag or `NODE_ENV` check. The new diagnostic in `Markdown.applyCodeEditorUpgrade` follows the same shape and the same `"ClassName: message"` prefix convention.

### One-shot per editor, gated by a fixed pixel threshold

The warn fires at most once per upgraded `CodeEditor` instance, only on its first `"heightchange"` event — the event that carries the guess-to-real correction. A later `"heightchange"` (e.g. from the pre-existing, separately-tracked `syncCodeEditors` width-resync path) never re-triggers it, so the diagnostic stays scoped to the mount-time correction it exists to surface. `GUESS_HEIGHT_CORRECTION_WARN_PX = 8` gates it: both reproductions measured a real correction of 20px and 29px, so 8px comfortably catches either while sitting above the sub-pixel/fractional rounding CodeMirror's own line metrics produce (the investigation log's raw trace shows fractional gutter heights like `19.5938px`).

### Two smoothing alternatives were considered and rejected

A CSS `transition: height` on the wrapper was the first candidate — it would turn the confirmed snap into a gentle animation with a one-line change. It is unsafe: `Markdown.measureContentHeight` reads the wrapper's height synchronously, in the same tick [`handleCodeEditorHeightChange`](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L857) sets it, and no code path re-measures after a transition completes. Adding a transition would make that synchronous read observe the *pre-transition* height, permanently understating `Markdown`'s reported min/preferred size once the animation finishes — a real clipping regression, not a cosmetic one.[^css-transition-rejected] Narrowing the placeholder-`<pre>`'s CSS padding/line-height to match CodeMirror's real rendering (removing the guess/correct delta at its source) was the second candidate; rejected because `PRE_CLASS` is shared by every fenced block, including ones that never upgrade, so the change's blast radius reaches every plain code block on every docs page, not just the momentary upgrade placeholder — out of proportion to a confirmed effect this small.[^pre-class-rejected]

---

## Addendum: Investigation Log

Reproduction used the `mcp__chrome-devtools__*` tools against the docs app's own dev server (`packages/docs`, confirmed via `readlink /proc/<pid>/cwd`, already running on `localhost:5174`), never a copy or a different tree.

**Navigation-time reproduction (the core test).** A fresh, isolated browser tab was navigated to `/typescript-ui/components/LineChart` with an `initScript` — code that runs before any of the app's own scripts — installing a `MutationObserver` on `document.body` and a `requestAnimationFrame` loop that recorded every `.ts-ui-md-code-host` wrapper's `getBoundingClientRect()` every frame. This captures the swap from the very first paint, unlike polling that starts after the page looks idle. Run twice independently (fresh navigation each time, same warm dev-server cache):

| t (ms after nav) | Event |
|---|---|
| ~480–580 | Placeholder `<pre>` wrappers first appear. |
| ~580–700 | Wrapper width narrows in 2–3 steps (683→372→360px) — ambient docs-shell layout settling (sidebar tree populating), before `CodeEditor` mounts; general to the page, not specific to this block. |
| ~680–800 | `applyCodeEditorUpgrade` pins the wrapper to its guess height (161px for "In-memory series", 113px for "Store-bound"). One frame later, `CodeEditor.mount()`'s own `syncAutoHeight()` call corrects it to the real value (141px and 84px — deltas of 20px and 29px). |
| 800 → end of window (10–15s) | Zero further change, in both runs. |

**Block comparison.** Both fenced blocks on the page ("In-memory series" and "Store-bound") go through the identical guess-then-correct step; the correction is larger on "Store-bound" (29px vs 20px) even though the user named "In-memory series" specifically — the two are not meaningfully distinguishable by this mechanism.

**Theme switch.** With the page already settled (10+ seconds after navigation), `mcp__chrome-devtools__emulate` flipped the emulated color scheme to `dark` while the same geometry poll ran for 4 more seconds. Zero change recorded — `ThemeManager.onThemeChange`'s unconditional `measureContentHeight()` call does not perturb an already-mounted `CodeEditor`'s committed height.

**Console.** `list_console_messages` showed only the Vite HMR client's own `[vite] connecting...` / `[vite] connected.` pair in every run — no errors, no warnings, no repeated messages.

**Throttled network + CPU (cold-session proxy).** `mcp__chrome-devtools__emulate` was set to `Slow 4G` + 4× CPU throttling and the same navigation-time instrumentation re-run. The page did not finish rendering the fenced blocks at all within a 20-second window — too extreme to isolate the `CodeEditor`-specific mechanism from the page's general slow-load behaviour, but directionally consistent with a cold dev-server session (the very first request for the `CodeEditor`/`@codemirror/*` chunks in a fresh `npm run docs:dev`, which Vite must transform on demand) stretching the pre-swap window far past the sub-second warm case measured above — during which ambient page reflow could visibly nudge the still-placeholder `<pre>` more than once. This is a plausible contributor to a "spasms" perception on a first cold load, but it was not independently confirmed, and no code change is proposed against it (see `## Non-Goals`).

**Concurrent-session interference.** The chrome-devtools MCP server's browser is shared across concurrent Claude sessions on this machine; page IDs, selections, and even `isolatedContext` names were observed to shift mid-investigation (other agents' pages appeared and disappeared, one under an unrelated `codeeditor-autoheight-investigation` context name). Every reproduction above was re-verified via `select_page` immediately before each read to rule out cross-session contamination.

---

## Addendum: Real-Chrome Trace — The Defect Was Real

After this plan shipped, the user recorded a 5.4-second DevTools performance trace in real Chrome on this same page — idle, no interaction — while noting the spasm did not reproduce for them in Chromium. That trace (`spasm-trace.json`, ~80k trace events) was analysed directly (Python + the raw trace-event JSON, not the chrome-devtools MCP's summarised insights) and shows a real, sustained relayout storm: 2537 browser `Layout` events over the 5.38s window, at a near-constant density of 40–59 per 100ms bucket for the *entire* capture — no decay, no convergence. Real committed frames (`Swap` events) ran at ~82/s, so this is roughly 5–6 forced synchronous layouts *per rendered frame*, continuously, matching "never settles" literally rather than as a one-off snap.

**Root cause, traced through the captured JS call stacks on `InvalidateLayout` events:** two functions are the actual re-entrant `scheduleLayout()` callers sustaining the loop — [`Markdown.measureContentHeight`](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L697) (via `handleCodeEditorHeightChange`) and [`Panel.scheduleGutterSettleOnShrink`](../packages/lib/src/typescript/lib/core/Panel.ts#L600). Both are designed to be idempotent/non-looping (each has a guard comment saying so), and each *is* correctly guarded against its own unchanged input. But `measureContentHeight`'s guard compares against `_measuredHeight`, and on `master` that value itself was genuinely oscillating frame to frame — because `measureContentHeight` reads `syncCodeEditors`'s wrapper geometry *before* flushing `commitBounds`'s buffered width write (the exact bug the sibling `markdown-code-editor-resize-lag-fix` plan root-caused and fixed, at the time unmerged). A stale-width read resizes the `CodeEditor` wrong, which reflows to a genuinely different height and fires another `"heightchange"`, which schedules another layout, whose `syncCodeEditors` reads a stale width again — a real, self-sustaining, two-function feedback loop, not a false report. `scheduleGutterSettleOnShrink` piggybacks on top of it: the oscillating content height perturbs the host `Panel`'s preferred size, which crosses its own shrink/grow edge every other frame and re-arms a "settle" pass each time. Neither function is itself buggy; both are reacting correctly to an input that shouldn't have been moving. The `AbstractChart`/`measureAxisMargin` call chain that dominates the raw `Layout` op counts in the trace is collateral — the whole page tree gets re-laid-out on every flush, so the (unrelated, non-buggy) `LineChart` demo pays for it too, which is almost certainly why the report named the LineChart page specifically even though the defect lives entirely in `Markdown`/`CodeEditor`/`Panel`.

**Live confirmation.** The `feature/markdown-code-editor-resize-lag-fix` worktree was built (`npm run build:lib && npm run docs:api`), served fresh on a dedicated port, and the same LineChart page was traced the same way (reload + ~7s idle, via `mcp__chrome-devtools__performance_start_trace`/`performance_stop_trace`). Result: 144 `Layout` events total over a 13.25s trace, all but one concentrated in the first ~1 second (mount), zero for the remaining ~12 seconds. Chrome DevTools' own `ForcedReflow` insight on that trace also bounds the only detected forced-reflow window to the same sub-second mount phase (92ms total), not a sustained condition. The storm is gone on that branch.

**Why the earlier reproduction attempt (above) failed.** Two contributing reasons, not mutually exclusive: (1) that investigation instrumented the fenced code block's own wrapper geometry, not the page's general relayout rate, so a storm that re-lays-out the whole tree without changing that one wrapper's final size would not have been caught by its `MutationObserver`/`rAF` poll; (2) the user's own hunch — real Chrome and the automated Chromium instance measure text at slightly different sub-pixel widths, and this bug's trigger condition (a scrollbar-gutter/width edge the stale-width read can land on the wrong side of) is exactly the kind of threshold a small text-width difference could flip. The fix closes the loop structurally (always read committed, current-frame geometry) regardless of which side of that threshold either browser's font metrics land on, so it does not depend on reproducing the exact browser-specific trigger to be correct.

**Net effect on this plan.** No code change is warranted *here* — the diagnostic this plan shipped remains valid, narrowly-scoped instrumentation for the separate, still-real, one-shot guess/correction snap it was built to surface. The reported "spasms and never settles" defect is real, root-caused, and already fixed on `markdown-code-editor-resize-lag-fix`; merging that branch is expected to resolve it on `master`.

---

## Internal Structure

`applyCodeEditorUpgrade`'s `editor.on("heightchange", ...)` wiring (currently a single-line inline closure) gains a one-shot, module-scoped-threshold check ahead of the existing call:

```typescript
// Markdown.ts — inside applyCodeEditorUpgrade, replacing the current
// single-line `editor.on("heightchange", ...)` wiring:
let correctionWarned = false;

editor.on("heightchange", (payload) => {
    if (!correctionWarned) {
        correctionWarned = true;

        const delta = Math.abs(payload.height - height);

        if (delta > GUESS_HEIGHT_CORRECTION_WARN_PX) {
            console.warn(
                `Markdown: fenced "${languageId}" code block's CodeEditor corrected its guessed ` +
                `height by ${Math.round(delta)}px (${height}px → ${payload.height}px) on mount.`,
            );
        }
    }

    this.handleCodeEditorHeightChange(wrapper, payload.height);
});
```

`height` is the same local variable `applyCodeEditorUpgrade` already computes from the placeholder `<pre>`'s measured `scrollHeight` (used today for `editor.setHeight(height)` and the wrapper's initial pin) — no new variable is needed to capture the guess. `correctionWarned` is a plain closure-local `let`, scoped to this one call (hence this one editor instance), not a new field on `Markdown` — nothing outside this method needs it. `handleCodeEditorHeightChange` itself is unchanged; every `"heightchange"` firing, warned or not, still resizes the wrapper and re-measures exactly as today.

---

## Ordered Implementation Steps

1. **[Markdown.ts] Add the `GUESS_HEIGHT_CORRECTION_WARN_PX` constant.** Place it next to `CODE_BLOCK_MAX_AUTO_ROWS` ([Markdown.ts:76](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L76)), value `8`, with the JSDoc reasoning from `## Architecture Decisions` (the two measured corrections, 20px/29px, and the sub-pixel-noise floor). Check: `grep -n "GUESS_HEIGHT_CORRECTION_WARN_PX" Markdown.ts` shows the constant and its later use.

2. **[Markdown.ts] Replace the `editor.on("heightchange", ...)` line in `applyCodeEditorUpgrade`** ([Markdown.ts:841](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L841)) with the `## Internal Structure` snippet above. No other line in `applyCodeEditorUpgrade` changes. Check: `grep -n "correctionWarned\|GUESS_HEIGHT_CORRECTION_WARN_PX" Markdown.ts` shows exactly one declaration and one use of each.

3. **[Markdown.test.ts] Quiet the existing heightchange test's new console output.** The existing `'wires a heightchange listener that resizes the wrapper and re-measures'` test ([Markdown.test.ts:842](../packages/lib/tests/component/display/Markdown.test.ts#L842)) mocks `getScrollMetrics` to `scrollHeight: 240` (the guess) and then fires `heightChangeListener!({ height: 360 })` — a 120px delta, which now trips the new warn. Add `const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});` near the top of that test (mirroring the existing `measureSpy` pattern in the same test) so its console output stays clean; no assertion on it is required by this test (that belongs to the new tests in step 4).

4. **[Markdown.test.ts] Add coverage in the `'Markdown.applyCodeEditorUpgrade (private, called directly)'` describe block** ([Markdown.test.ts:810](../packages/lib/tests/component/display/Markdown.test.ts#L810)), after the test touched in step 3. Cases per `## Expected Behaviour` below.

5. **Typecheck and run the full `packages/lib` test suite.** `npm run typecheck` (zero errors) and `npm test` (the new and updated `Markdown.test.ts` cases, plus the full existing suite green — no other file changes, so nothing else should move).

6. **Manual verification.** Run the docs app (`npm run docs:dev`) and open `/components/LineChart` with the browser console visible. Confirm the page renders identically to today (no visible behavioural change — this plan adds no rendering logic) and note whether the diagnostic fires; either outcome is expected and acceptable, since the diagnostic's purpose is to report the real number next time, not to force a particular one.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |

---

## Expected Behaviour

- `applyCodeEditorUpgrade`'s guess (from the mocked placeholder measurement) and the first `"heightchange"` payload differ by `GUESS_HEIGHT_CORRECTION_WARN_PX` (8px) or less: `console.warn` is not called. **Unit-testable** (spy on `console.warn`, mock `getScrollMetrics` to a `scrollHeight` within 8px of the fired `heightchange` payload, assert zero calls).
- The two differ by more than 8px: `console.warn` is called exactly once, with a message containing the language id, the guess height, and the corrected height. **Unit-testable.**
- A second `"heightchange"` firing on the same editor instance, regardless of its own delta from the first: `console.warn` is not called again (only the count from the first firing, zero or one, ever accumulates). **Unit-testable** (fire `heightChangeListener` twice with two different large-delta heights; assert the total call count is at most `1`).
- Every firing, warned or not, still resizes the wrapper and calls `measureContentHeight()` exactly as today — the diagnostic never short-circuits `handleCodeEditorHeightChange`. **Unit-testable** (mirrors the existing test's `heightWrite`/`measureSpy` assertions).
- A fenced block whose language does not map to a `CodeEditor` id never constructs an editor, so no `"heightchange"` event exists and the new code path is never reached. **Unit-testable implicitly** — the existing plain-`<pre>` tests in `'Markdown fenced code block'` ([Markdown.test.ts:156](../packages/lib/tests/component/display/Markdown.test.ts#L156)) stay untouched and green.
- The real, on-screen size of the guess-to-correction snap, and whether it fires at all against a real `CodeEditor`/CodeMirror mount: **manual-verify only** — `CodeEditor` is live-only (no `_view` under the modelled DOM sink), matching every other `CodeEditor`-touching test in this suite.

---

## Verification

- `npm run typecheck` (packages/lib) — zero errors.
- `npm test` (packages/lib) — the new and updated `Markdown.test.ts` cases from `## Expected Behaviour`, plus the full existing suite green.
- Manual smoke test per `## Ordered Implementation Steps`, step 6 — confirms zero visible/behavioural change on the real docs app.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](../packages/lib/src/typescript/lib/component/display/Markdown.ts) — `applyCodeEditorUpgrade` and `handleCodeEditorHeightChange`, the two methods this plan touches and reads.
- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) — `mount()` and `syncAutoHeight()`, read in full to confirm the guess-then-correct sequence is intentional, documented, shipped behaviour, not a bug this plan is fixing.
- [`plans/implemented/markdown-code-editor-highlighting.md`](implemented/markdown-code-editor-highlighting.md) and [`plans/implemented/markdown-code-editor-autogrow-height.md`](implemented/markdown-code-editor-autogrow-height.md) — the two shipped plans this investigation is built on; the autogrow-height plan's own Implementation Notes already flag a separate, unfixed `syncCodeEditors` width-resync timing gap (see `## Non-Goals`).
- [`packages/lib/src/typescript/lib/layout/Grid.ts`](../packages/lib/src/typescript/lib/layout/Grid.ts) (line 1036), [`packages/lib/src/typescript/lib/overlay/Popover.ts`](../packages/lib/src/typescript/lib/overlay/Popover.ts) (line 784) — the `console.warn` anomaly-surfacing precedent this plan's diagnostic follows.
- [`packages/lib/tests/component/display/Markdown.test.ts`](../packages/lib/tests/component/display/Markdown.test.ts) — `FakeCodeEditor` (line 779) and the existing `applyCodeEditorUpgrade`/heightchange tests this plan's new tests extend.

---

## Non-Goals

- **No fix to the guess/correction delta itself** (e.g. narrowing `PRE_CLASS`'s padding/line-height to match CodeMirror's real metrics) — considered and rejected; see `## Architecture Decisions`.
- **No CSS-transition smoothing of the wrapper resize** — considered and rejected as a correctness regression; see `## Architecture Decisions`.
- ~~**No fix to the `syncCodeEditors` width-resync one-cycle lag**...~~ **Superseded — this *is* the root cause.** See `## Addendum: Real-Chrome Trace — The Defect Was Real`. The lag was confirmed related to this report after all; its fix lives on `markdown-code-editor-resize-lag-fix`, not here.
- **No `NODE_ENV`/build-flag gating of the new `console.warn`** — matches the ungated style of every existing anomaly warning in this codebase (`Grid.ts`, `Popover.ts`, `Router.ts`, `Component.ts`).
- **No further live investigation of the cold-dev-server theory** (the throttled-network/CPU test in the Addendum was inconclusive, not confirming). A future report that includes whether the dev server was freshly started would let this be revisited with real data instead of a proxy test.

---

## Notes

[^negative-result]: Full reproduction attempts: two independent navigation-time-instrumented full-document loads of `/typescript-ui/components/LineChart` (via `mcp__chrome-devtools__navigate_page` with an `initScript` installing a `MutationObserver` + `requestAnimationFrame` geometry poll before any app script ran), a theme-switch test on an already-settled page, a console-error check, and a throttled-network/CPU proxy test for a cold dev-server session. None reproduced an ongoing or recurring geometry change; both full navigations converged to a stable, unchanging state within under a second and stayed there for the remainder of a 10–15 second observation window. See `## Addendum: Investigation Log` for the raw numbers.

[^css-transition-rejected]: `Markdown.measureContentHeight` ([Markdown.ts:697](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L697)) is called synchronously from `handleCodeEditorHeightChange` in the same tick the wrapper's height is written. A CSS `transition` on that height would mean the synchronous `DOM.source.getScrollMetrics(element).scrollHeight` read inside `measureContentHeight` observes the box mid-transition (effectively still at its pre-transition size, since the transition has had no wall-clock time to progress when read synchronously), not its animated target. No code path re-measures after a `transitionend`, so `Markdown`'s reported min/preferred size would permanently understate the block's real settled height once the animation finishes elsewhere — a real clipping risk for whatever scroll host wraps the `Markdown`, not merely a cosmetic rough edge.

[^pre-class-rejected]: `PRE_CLASS`'s padding (`0.6em 0.8em`) is applied to every fenced code block via `appendCode`'s unconditional `DOM.sink.apply(pre, { addClass: [PRE_CLASS] })` ([Markdown.ts:1222](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L1222)), including blocks with no supported language that never upgrade and keep this styling permanently. Its own class-rule comment already documents it as "the code frame's structural inset, not a visual nudge" ([Markdown.ts:148](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L148)) — a deliberate design choice from an earlier plan. Narrowing it to shrink the upgrade-time guess/correction delta would change the permanent appearance of every plain code block site-wide to chase a momentary, sub-30px transition on blocks that *do* upgrade — a mismatched trade even before accounting for how fragile matching CodeMirror's exact internal metrics in hand-written CSS would be.
