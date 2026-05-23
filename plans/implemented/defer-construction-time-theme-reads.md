# Defer Construction-Time Theme Reads — Implementation Plan

## Overview

Two component constructors currently call `getComputedStyle(document.documentElement).getPropertyValue("--ts-ui-…")` synchronously during `super()` / field-init time:

- [`ProgressSpinner`](../src/typescript/lib/component/display/ProgressSpinner.ts) — `getThemeFontSize()` at [ProgressSpinner.ts:31-37](../src/typescript/lib/component/display/ProgressSpinner.ts#L31-L37), called from the constructor at [ProgressSpinner.ts:68](../src/typescript/lib/component/display/ProgressSpinner.ts#L68) when no explicit `size` is passed.
- [`Text`](../src/typescript/lib/component/input/Text.ts) — `readThemeLineHeightPx()` at [Text.ts:214-227](../src/typescript/lib/component/input/Text.ts#L214-L227), called from the constructor at [Text.ts:96](../src/typescript/lib/component/input/Text.ts#L96) to populate `_defaultOptions.lineHeight`.

[ARCHITECTURE.md](../ARCHITECTURE.md#defer-dom-work-to-render-time) ("Defer DOM work to render time") forbids construction-time layout reads: *"Measurement: never read layout (`getBoundingClientRect`, `getComputedStyle`) during construction. Defer to a layout pass or theme-change callback."* The reads happen before the component is attached, so they either force a synchronous layout on the document root or return the empty string before the stylesheet has applied — and they spend cycles on every construction even when no consumer reads the resulting value.

This plan migrates both call sites to render-time deferral, mirroring the existing `ThemeManager.onThemeChange` seam that [`Text.ts:101-123`](../src/typescript/lib/component/input/Text.ts#L101-L123) and [`ProgressSpinner.ts:90-105`](../src/typescript/lib/component/display/ProgressSpinner.ts#L90-L105) already use for post-theme-change updates. The two violations diverge in shape — `ProgressSpinner`'s `_size` feeds JS layout math (`Math.min(this._size, inner.width, inner.height)`), so it must stay a `number` and the read must move to first-layout time. `Text`'s `_defaultOptions.lineHeight` is only consulted by `getLineHeight()` and `calculateSize()`, both of which already run lazily — the construction-time call is redundant work and gets dropped outright.

---

## Architecture Decisions

### `ThemeManager.onThemeChange` does not fire on subscribe — keep a one-shot first-read seam

Confirmed by reading the contract at [Theme.ts:802-857](../src/typescript/lib/core/Theme.ts#L802-L857): `onThemeChange` pushes the listener onto an array and returns an unsubscribe closure; the listener only fires on a subsequent `setTheme(...)` call. So "register a theme listener" alone is **not** enough to populate the first value — a one-shot first-read still has to fire from a render-time seam (whichever runs first: `init()`, `applyStyle()`, or a `getPreferredSize()` / `doLayout()` call).

This sets the design constraint for both fixes: the read must move out of `constructor()` into a method that runs at-or-after first attach. For `ProgressSpinner` that's `doLayout()` (already overridden and centred on `_size`). For `Text` we don't need any first-read at all — `getLineHeight()` already falls back through `_options.lineHeight` → `_defaultOptions.lineHeight` → `null`, and `calculateSize()` runs lazily on the first `getPreferredSize` / `getBaseline` call, by which time the theme-change listener (if it has fired) will have populated `_defaultOptions.lineHeight`.

### `ProgressSpinner`: defer `getThemeFontSize()` to `doLayout()`, not to a CSS expression

`_size` is consumed by JS math at [ProgressSpinner.ts:238](../src/typescript/lib/component/display/ProgressSpinner.ts#L238) (`Math.min(this._size, inner.width, inner.height)`) and at [ProgressSpinner.ts:88](../src/typescript/lib/component/display/ProgressSpinner.ts#L88) (`setPreferredSize(this._size, this._size)`). A CSS expression like `var(--ts-ui-font-size, 14px)` won't compose with those reads — they need a number.

Migration: construct with `_size = 14` (the existing fallback inside `getThemeFontSize`), then resolve the true theme value during `doLayout()`. The `_trackThemeFontSize` flag and the existing `ThemeManager.onThemeChange` listener already handle post-attach updates; the new first-read happens once at the first `doLayout()` and is gated by a `_themeFontSizeResolved` flag so we don't repeatedly read on every layout pass.

`setPreferredSize` is also called at [ProgressSpinner.ts:88](../src/typescript/lib/component/display/ProgressSpinner.ts#L88) with the fallback `14` at construction time — that write goes through the framework's queued style buffer, which is correct. The first `doLayout()` re-issues the preferred size with the resolved theme value before the parent measures the spinner (`scheduleLayout()` from the theme-change path already exists for the same purpose, so the resize plumbing is exercised).

### `Text`: drop the construction-time `readThemeLineHeightPx` call entirely

`_defaultOptions.lineHeight` is only read by:
- [`getLineHeight()`](../src/typescript/lib/component/input/Text.ts#L683-L685) — returns `_options.lineHeight ?? _defaultOptions.lineHeight ?? null`. Caller-visible from `calculateSize` and `applyStyle`.
- [`readThemeLineHeightPx()`](../src/typescript/lib/component/input/Text.ts#L214-L227) — uses it as a self-fallback (only relevant on re-entry after the theme-change path has already populated it).

Neither runs during construction. `calculateSize()` is deferred (the comment at [Text.ts:132-135](../src/typescript/lib/component/input/Text.ts#L132-L135) makes this explicit: *"Off-screen text measurement is deferred until the first getPreferredSize / getBaseline call so construction stays JS-only"*). `applyStyle` runs from `render()`. By the time either fires, the component is attached and `getComputedStyle` is safe.

Action: delete the line `this._defaultOptions.lineHeight = this.readThemeLineHeightPx();` at [Text.ts:96](../src/typescript/lib/component/input/Text.ts#L96). Move the first read to a lazy point inside the same lazy chain (`calculateSize`) — specifically, populate `_defaultOptions.lineHeight` on the first call to `calculateSize()` if it is still undefined. The theme-change callback at [Text.ts:118-120](../src/typescript/lib/component/input/Text.ts#L118-L120) continues to refresh the field on every subsequent theme change.

### Why not move the Text first-read into `init()` / `applyStyle`

`init()` and `applyStyle` run on `getElement(true)` / first render. Moving the read there would also work, but it duplicates the theme-change callback's logic and adds work to the render path. `calculateSize` is the natural fallback site because it's the only consumer that needs `_defaultOptions.lineHeight` resolved — `applyStyle` writes `this._lineHeightCSSRule` (the var-binding expression) to the DOM directly, which doesn't need the resolved px value. Keep the resolution next to its only consumer.

### `setFontSize` string-arg branch ([Text.ts:536](../src/typescript/lib/component/input/Text.ts#L536)) stays as-is

The task description confirms it's not on the construction-time path — the cascade-driven `setFontSize(14)` hits the number branch. The string branch is called from public API after construction, when the component is (or could be) attached. Out of scope.

### `Component.setBorder` `var(...)` branch ([Component.ts:1111](../src/typescript/lib/core/Component.ts#L1111)) stays as-is

Also called from setter paths that run after construction (via `applyOptions` cascade or post-construction `setBorder(...)`). The construction-time cascade can reach it, but the value passed is the typed `BorderOptions` object in the default path — the `var(...)` string branch only triggers when a caller explicitly passes a `var(...)` literal. Out of scope for this plan; flag it as a candidate for a follow-up if the audit broadens.

---

## Public API (TypeScript Signatures)

No public-API changes. All affected methods (`getSpinnerSize`, `getLineHeight`, `setSpinnerSize`, `setLineHeight`, constructors) retain their current signatures and return types. The migration is internal.

---

## Internal Structure

### `ProgressSpinner` — new state and seam

```typescript
class ProgressSpinner extends Component {

    private _arc: Component;
    private _size: number;
    private _trackThemeFontSize: boolean;
    private _themeFontSizeResolved: boolean = false; // NEW
    private _overlayTarget: Component | null = null;

    constructor(size?: number, options?: ProgressSpinnerOptions) {
        super();

        this._trackThemeFontSize = size === undefined;
        // Was: this._size = this._trackThemeFontSize ? getThemeFontSize() : size!;
        // Now: defer the theme read to first doLayout(); use the same 14 fallback
        // that getThemeFontSize uses when the variable is missing.
        this._size = this._trackThemeFontSize ? 14 : size!;

        // ... unchanged arc construction, theme-listener registration, etc.
    }

    doLayout(): this {
        if (this._trackThemeFontSize && !this._themeFontSizeResolved) {
            this._themeFontSizeResolved = true;

            const next = readThemeFontSizePx();
            if (next !== this._size) {
                this._size = next;
                this.setPreferredSize(next, next);
            }
        }

        // ... existing doLayout body unchanged.
    }
}
```

Rename `getThemeFontSize()` to `readThemeFontSizePx()` (matching the `readThemeLineHeightPx` convention in `Text.ts`) — same body, same fallback. The theme-change callback at [ProgressSpinner.ts:91-104](../src/typescript/lib/component/display/ProgressSpinner.ts#L91-L104) calls the same helper, so the rename touches both call sites.

### `Text` — drop the construction-time call

```typescript
constructor(text?: String, options?: TOptions) {
    super({ ..._defaultTextOptions, ...(options ?? {}), tag: options?.tag ?? "span" } as TOptions);

    this._defaultOptions.fontFamily = "var(--ts-ui-font-family, system-ui, sans-serif)";
    // DELETED: this._defaultOptions.lineHeight = this.readThemeLineHeightPx();

    this.clearInsets();
    this.setElementCSSRule("lineHeight", this._lineHeightCSSRule);

    // ... unchanged theme-listener registration and rest of constructor.
}

private calculateSize(): void {
    this._measurementDirty = false;

    if (!this._autoMeasure) {
        return;
    }

    // First-read deferral: populate the default line-height the first time
    // we measure, when the component is attached and getComputedStyle is safe.
    // Subsequent reads come through ThemeManager.onThemeChange at line 119.
    if (this._defaultOptions.lineHeight === undefined) {
        this._defaultOptions.lineHeight = this.readThemeLineHeightPx();
    }

    // ... unchanged measurement body.
}
```

The comment block at [Text.ts:31-44](../src/typescript/lib/component/input/Text.ts#L31-L44) explaining why `lineHeight` is omitted from `_defaultTextOptions` already documents the carve-out — update the second bullet to reflect the new deferral point (resolved in `calculateSize` on first measure, not in the constructor body).

---

## Ordered Implementation Steps

1. **`ProgressSpinner.ts`**: rename `getThemeFontSize` → `readThemeFontSizePx`. Add `_themeFontSizeResolved: boolean = false` field. Change the constructor `_size` initializer to `this._trackThemeFontSize ? 14 : size!`. Update the existing theme-change callback at lines 91-104 to use the renamed helper (body unchanged otherwise — `_trackThemeFontSize` gate, `_size === next` short-circuit, `setPreferredSize`, `scheduleLayout`).
   - **Verify**: `grep -n 'getThemeFontSize' src/typescript/lib/component/display/ProgressSpinner.ts` → 0 hits. `grep -n 'readThemeFontSizePx' src/typescript/lib/component/display/ProgressSpinner.ts` → 3 hits (declaration + two call sites: theme-change callback + `doLayout`).

2. **`ProgressSpinner.ts:doLayout`**: prepend the first-read gate (`if (this._trackThemeFontSize && !this._themeFontSizeResolved) { … }`). After the read, set `_themeFontSizeResolved = true`, then update `_size` and `setPreferredSize` only when the resolved value differs from the existing `14` fallback. The rest of `doLayout` is unchanged.
   - **Verify**: `npx tsc --noEmit` clean. Open `http://localhost:8015`, navigate to *MiscPanel* → the inline spinner at line 666 (`new ProgressSpinner()` with no size) renders at the theme font-size (~14px in light). Toggle theme — the spinner re-sizes via the existing theme-change path. Resize the panel — no layout flicker.

3. **`Text.ts`**: delete the line `this._defaultOptions.lineHeight = this.readThemeLineHeightPx();` at line 96. Update the doc comment at lines 31-44 (the `_defaultTextOptions` carve-out block) — second bullet now says "resolved lazily on first `calculateSize()`".
   - **Verify**: `grep -n 'readThemeLineHeightPx' src/typescript/lib/component/input/Text.ts` → 3 hits (declaration + theme-change callback at line 119 + new lazy fallback in `calculateSize`).

4. **`Text.ts:calculateSize`**: at the top of the method (after `this._measurementDirty = false` and before the `_autoMeasure` gate, since the gate would skip the resolution when auto-measure is off — see *Potential Challenges*), insert the lazy fallback: `if (this._defaultOptions.lineHeight === undefined) { this._defaultOptions.lineHeight = this.readThemeLineHeightPx(); }`. No other changes to `calculateSize`.
   - **Verify**: `npx tsc --noEmit` clean. Open `http://localhost:8015`, any panel with `Text` components — line-height visually matches the theme's `1.2` multiplier × the resolved font size. Toggle theme — line-height updates via existing path.

5. **Audit grep**: `grep -rn 'getComputedStyle' src/typescript --include="*.ts"`. Expected surviving sites:
   - `Text.ts:103` — inside `ThemeManager.onThemeChange` callback (allowed seam).
   - `Text.ts:221` — inside `readThemeLineHeightPx`, called only from theme-change + new lazy `calculateSize` path (post-attach).
   - `Text.ts:536` — inside `setFontSize` string-arg branch (post-construction API).
   - `ProgressSpinner.ts` — inside `readThemeFontSizePx`, called only from theme-change + `doLayout` (post-attach).
   - `Theme.ts:809` — JSDoc reference (not a call).
   - `Component.ts:1111` — inside `setBorder` `var(...)` branch (post-construction API).
   - `Component.ts:1757`, `Component.ts:1769` — commented-out (not active).
   - `Util.ts:197` — inside `measureTextMetrics` (off-screen probe helper, runs at measurement time).
   - `Popover.ts:906` — inside positioning logic that runs at show-time.

   No call should appear on a constructor or `applyOptions` path.

6. **`npm run typecheck` + `npm run build:lib` + `npm run docs:build`**. All clean; `docs:build` reports 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the only acceptable warning).

7. **Manual smoke test on `http://localhost:8015`** (per *Verification* below).

8. **`graphify update . --directed`**. Refresh the graph; commit `graphify-out/**` as its own commit per the repo convention.

---

## Files to Create / Modify / Delete

| Action | File |
|--------|------|
| Modify | `src/typescript/lib/component/display/ProgressSpinner.ts` — rename helper, add `_themeFontSizeResolved` flag, defer first read to `doLayout()`. |
| Modify | `src/typescript/lib/component/input/Text.ts` — drop construction-time `readThemeLineHeightPx` call; move first read into `calculateSize`. Update `_defaultTextOptions` doc comment. |

No new files. No deletions. No public API changes.

---

## Verification

- `grep -rn 'getComputedStyle' src/typescript --include="*.ts"` → expected sites listed in step 5 above; **no** call inside a constructor body, `applyOptions`, or class-field initializer.
- `npx tsc --noEmit` → 0 errors.
- `npm run build:lib` → clean.
- `npm run docs:build` → 0 errors, 0 link warnings.
- Manual smoke at `http://localhost:8015`:
  - *MiscPanel* → spinner section: the inline spinner (constructed without an explicit size at [MiscPanel.ts:666](../src/typescript/MiscPanel.ts#L666)) renders at the theme font size (~14px in light, also 14px in dark per [Theme.ts:298](../src/typescript/lib/core/Theme.ts#L298) / [Theme.ts:483](../src/typescript/lib/core/Theme.ts#L483) since both built-in themes share the size; verify the theme-change wiring still calls `setPreferredSize` by inspecting the spinner after toggling). Explicitly-sized spinners (e.g. `new ProgressSpinner(24)` at [Window.ts:253](../src/typescript/lib/core/Window.ts#L253), [Tab.ts:496](../src/typescript/lib/layout/Tab.ts#L496), [TablePanel.ts:79](../src/typescript/lib/component/table/TablePanel.ts#L79), and the overlay at [MiscPanel.ts:719](../src/typescript/MiscPanel.ts#L719)) are unaffected.
  - Text-heavy panels: line-height appears correct on first paint (no flicker / no zero-height collapse). Toggle theme — text re-flows. Rapidly toggle theme multiple times — no console errors, no layout jumps.
  - *MiscPanel* slow-table benchmark (the project's stress test) — open DevTools, scroll, sort, resize columns. The deferred line-height resolution should be invisible; if any `Text` component renders with a wrong baseline on first paint, the deferral point in `calculateSize` is firing too late and needs to move to `applyStyle` instead (see *Potential Challenges*).
- `graphify update . --directed` succeeds without errors; the graph keeps a `readThemeFontSizePx` node where `getThemeFontSize` used to live.

---

## Potential Challenges

- **`calculateSize` is short-circuited by `_autoMeasure: false`** — components that opt out of auto-measure (e.g. `Text` inside a [`Fit`](../src/typescript/lib/layout/Fit.ts) layout that sizes them externally) never enter the measurement body. Mitigation: place the lazy fallback **before** the `_autoMeasure` gate, so even non-measuring `Text` instances populate `_defaultOptions.lineHeight` the first time the layout cycle touches them. The cost is one cheap `getComputedStyle` read on first layout, which is exactly the point of the deferral.
- **Order of first `doLayout()` vs first paint for `ProgressSpinner`** — if a caller reads `getSpinnerSize()` (line 136-138) before the first layout, they get the `14` fallback instead of the resolved theme size. Audit shows no internal consumer of `getSpinnerSize()` runs before `doLayout()`; external consumers asking for an "exact size" should pass an explicit `size` argument anyway (which bypasses the deferral entirely via `_trackThemeFontSize = false`). Document this in the JSDoc on `getSpinnerSize`: *"Returns the most recently resolved diameter; when the spinner tracks the theme font-size, the resolved value is only available after the first layout pass."*
- **Theme tokens missing at first layout** — `getComputedStyle` returns the empty string if the `<style>` block carrying the theme variables hasn't been parsed yet. The fallback (`14` for spinner, `fs * 1.2` for line-height) covers this case correctly; the theme-change listener will refresh on the next `setTheme` call. No additional defensive code needed.
- **`_themeFontSizeResolved` resets if the user later calls `setSpinnerSize(...)` then back to "track theme"** — currently impossible because `setSpinnerSize` sets `_trackThemeFontSize = false` permanently (line 149). If a future API restores tracking, also reset `_themeFontSizeResolved = false` so the next layout re-resolves. Not a concern for this plan.

---

## Critical Files

- [src/typescript/lib/component/display/ProgressSpinner.ts](../src/typescript/lib/component/display/ProgressSpinner.ts) — the file under refactor.
- [src/typescript/lib/component/input/Text.ts](../src/typescript/lib/component/input/Text.ts) — the second file under refactor; constructor + theme-listener at lines 83-136; `calculateSize` at lines 268-298; `readThemeLineHeightPx` at lines 214-227.
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — `ThemeManager.onThemeChange` contract at lines 812-817: pushes to a listener array, does **not** fire on subscribe. `setTheme` at lines 831-847 fires the listeners after writing CSS variables.
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — `applyStyle` at line 2613 (render-time seam), `init`/`render` at line 3228, `doLayout` contract.
- [ARCHITECTURE.md](../ARCHITECTURE.md) — *Defer DOM work to render time* section at lines 87-96. The non-negotiable rule this plan enforces.
- [project_theme_system memory note](../../../home/jika/.claude/projects/-home-jika-typescript-typescript/memory/project_theme_system.md) — context on how the theme system works and which tokens exist.

---

## Non-Goals

- **Removing `getComputedStyle` from `setBorder` ([Component.ts:1111](../src/typescript/lib/core/Component.ts#L1111))** — that branch runs from `setBorder("var(--ts-ui-border-color, …)")` calls, which can fire post-construction via `applyOptions` cascade. The cascade-driven path is on a construction call chain, but the `var(...)` literal branch only triggers when a caller explicitly passes a `var(...)` string. Verifying the cascade never reaches it is a separate audit; out of scope here.
- **Removing the `setFontSize` string-arg branch read ([Text.ts:536](../src/typescript/lib/component/input/Text.ts#L536))** — confirmed by the task description as not on the construction-time path. Out of scope.
- **Adding subscribe-time fire to `ThemeManager.onThemeChange`** — would simplify both call sites by eliminating the need for first-read seams. However, it changes the contract of every existing subscriber (they'd all fire one extra time at construction, potentially before they expect it). Scope creep for a focused deferral fix.
- **Generalising the "lazy first-read" pattern into a `Component` helper** — only two sites use this pattern today. Pulling it into a base method is speculative until a third use case appears.
- **Auditing `Util.measureTextMetrics` and `Popover` positioning reads** — both are explicitly post-attach (measurement helper called during layout, positioning called during show). Not violations.
