---
depends-on: [image-intrinsic-size-lifecycle]
touches-shared: ["packages/lib/src/typescript/lib/component/display/Image.ts"]
---

# Image Loading and Error Visual States — Implementation Plan

## Overview

`Image` ([packages/lib/src/typescript/lib/component/display/Image.ts](packages/lib/src/typescript/lib/component/display/Image.ts)) gives no visual feedback while a source is decoding and none when it fails: a broken image today just shows the browser's default broken-image icon, unstyled, and a still-loading image shows nothing at all. This plan adds two declared visual states — `.loading` and `.broken` — driven by the native `load`/`error` bridge that the `image-intrinsic-size-lifecycle` plan ([plans/image-intrinsic-size-lifecycle.md](plans/image-intrinsic-size-lifecycle.md)) adds to `Image` first. That plan must implement before this one: it introduces `handleLoad()`, the `_onLoad`/`_onError` native listener fields, and the cached `_naturalSize` field this plan's steps assume already exist.

This plan uses the framework's `ownStyleStates` mechanism — the same one `Checkbox`'s `CheckboxBox` delegate and `SplitGutter` already use for a declared, class-tier-shared visual toggle — rather than a hand-written per-instance CSS rule. It touches only `Image.ts`, its test file, and its docs page.

---

## Architecture Decisions

### `.loading` and `.broken` are declared via `ownStyleStates`, not hand-written CSS

Per [ARCHITECTURE.md](ARCHITECTURE.md)'s *Component CSS tiers and state-rule dedup*, a component-level toggle state is declared as a `protected static readonly ownStyleStates: readonly StyleStateSpec[]` entry, each `{ selector, extract }` pair generating a shared `.Image.loading` / `.Image.broken` class-tier rule with an automatic `:not(...)` guard against the resting tier and every higher-priority declared state. `Image` extends `Component` directly (no delegate, per *One DOM element per class* — `Image` owns one `<img>`), so this plan follows `SplitGutter`'s shape ([SplitGutter.ts:121-126](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L121-L126)) exactly: a leaf `Component` subclass declaring its own `ownStyleStates` list with no delegate and no hierarchy-cascade opt-in.[^no-restate]

```typescript
const IMAGE_LOADING_DECLARATIONS: StyleBag = {
    backgroundColor: "var(--ts-ui-image-loading-bg, rgba(0, 0, 0, 0.06))",
};

const IMAGE_BROKEN_DECLARATIONS: StyleBag = {
    backgroundColor: "var(--ts-ui-image-broken-bg, rgba(220, 60, 60, 0.08))",
};

protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
    { selector: ".loading", extract: (): StyleBag => IMAGE_LOADING_DECLARATIONS },
    { selector: ".broken",  extract: (): StyleBag => IMAGE_BROKEN_DECLARATIONS },
];
```

Both states declare only `backgroundColor` — a flat wash, no icon and no animation.[^no-icon] `.loading` is declared first, `.broken` second; the two are never simultaneously active on one instance (see the state machine below), so their relative priority is never exercised — the order only fixes which guard clause each generated rule carries.

### State-token CSS variables are not registered in `Theme.ts`

`--ts-ui-image-loading-bg` and `--ts-ui-image-broken-bg` follow `Scrollbar`'s pattern ([Scrollbar.ts:137-139](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L137-L139), `--ts-ui-scrollbar-arrow-disabled-color`) — a `var(--token, fallback)` with no matching entry in the structured `Theme` object or `Theme.ts`'s CSS-variable map — rather than `Checkbox`/`RadioButton`'s pattern of a registered `theme.form.checkbox.indeterminateBackground`-style field. Both patterns are live in this codebase today; this plan picks the lighter one so the change stays inside `Image.ts` (matching the file list every other `Image` sibling plan uses) instead of also touching `Theme.ts`'s type, defaults, and CSS-variable map for two single-component tokens.[^theme-choice]

### `isLoading()` / `isBroken()` are read-only; there is no public setter

`.loading` and `.broken` are derived from the native `load`/`error` events, not caller configuration — nothing external should be able to force an `Image` into "broken" by calling a setter, the way a consumer legitimately can for `ToggleButton.setSelected` or `SplitGutter.setOpaque`. So this plan adds only `isLoading()` / `isBroken()`, each a one-line forward to the inherited `isStyleState(...)`, mirroring `SplitGutter.isOpaque()` ([SplitGutter.ts:312](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L312)).

### Broken images report a fixed placeholder size instead of `{0, 0}` / `null`

`image-intrinsic-size-lifecycle` makes `getMinSize()` report `{0, 0}` and `getPreferredSize()` report `null` before an image has decoded, because "no opinion yet" is correct while a result is still pending. A failed decode is not still pending — nothing further will arrive for this source — so `handleError()` publishes a fixed placeholder size instead, the same way `handleLoad()` publishes the real natural size. This plan adds a module constant, `IMAGE_BROKEN_PLACEHOLDER_PX = 48`, and:

- `handleError()` calls `this.setPreferredSize({...})` with that placeholder (plus perimeter), gated on `!this.getPreferredSizeConstraint()` — the same explicit-size-wins gate `handleLoad()` uses, so a caller-supplied `preferredSize` still wins.
- `getMinSize()` gains a new first branch: when `.broken` is active and no explicit `setMinSize` constraint exists, return `{48, 48}`.

This mirrors `handleLoad()`'s own shape (cache/derive, then publish once, gated on caller intent) rather than inventing a second mechanism for the same kind of decision.

### `.loading` does not change size

Only the broken state gets a placeholder size. The pre-load contract `image-intrinsic-size-lifecycle` establishes — `getMinSize()` returns `{0, 0}` and `getPreferredSize()` returns `null` before `load`/`error` fires — is left unchanged while `.loading` is active; this plan's `.loading` state is visual-only. Giving loading a placeholder size too was considered and rejected: it isn't part of what was asked (the audit finding is about a missing *visual* affordance, not a missing pre-load size), and it would contradict `image-intrinsic-size-lifecycle`'s own "no opinion pre-load" decision for no added benefit.

### Re-entry: `setSrc` resets `.loading` and `.broken` together

`src` is construction-only in `image-intrinsic-size-lifecycle`'s scope, so within *this* plan's dependency there is no re-entry case to handle — an `Image` is constructed, then loads or breaks, once. But `image-attribute-options-surface` (a sibling plan, not a dependency of this one) adds a mutable `setSrc`, and its own `## Architecture Decisions` explicitly says its `setSrc` "does not assume... any future loading-state indicator" and only invalidates `_naturalSize`. This plan closes that gap from its own side: it adds a private `resetLoadState()` that clears `.broken` and re-sets `.loading`, called unconditionally from the constructor (first entry) and — per a conditional step in `## Ordered Implementation Steps` — from `setSrc`, if that method already exists on `Image` by the time this plan is implemented.[^setSrc-coordination]

| Sequence | `.loading` | `.broken` |
|---|---|---|
| `new Image('/a.png')` constructed | active | inactive |
| `_onLoad()` fires | inactive | inactive |
| `setSrc('/b.png')` called (once that method exists) | active again | inactive |
| New `_onError()` fires for `/b.png` | inactive | active |

---

## Public API

```typescript
class Image extends Component<ImageOptions> {
    /** Whether the image is currently decoding — active from construction
     *  (or a source change, once `setSrc` exists) until `load` or `error`
     *  fires. */
    isLoading(): boolean;

    /** Whether the most recent decode attempt failed. */
    isBroken(): boolean;
}
```

No `ImageOptions` field is added — `.loading` / `.broken` are derived state, not construction-time configuration.

---

## Internal Structure

New module-level constants, alongside `image-intrinsic-size-lifecycle`'s `IMAGE_AUTO_MIN_CAP_PX`:

```typescript
// Fallback square size published as the broken image's preferred/min size
// when no explicit size was requested, so a failed decode still reserves a
// visible box instead of collapsing to nothing. A fixed literal, not
// theme-scaled: this is a layout decision (big enough to read as a
// deliberate placeholder), not a chrome token.
const IMAGE_BROKEN_PLACEHOLDER_PX = 48;

/** `.loading`'s chrome — a flat neutral wash while the image decodes. */
const IMAGE_LOADING_DECLARATIONS: StyleBag = {
    backgroundColor: "var(--ts-ui-image-loading-bg, rgba(0, 0, 0, 0.06))",
};

/** `.broken`'s chrome — a flat, distinct wash marking a failed decode. */
const IMAGE_BROKEN_DECLARATIONS: StyleBag = {
    backgroundColor: "var(--ts-ui-image-broken-bg, rgba(220, 60, 60, 0.08))",
};
```

The declared-states field and the two read-only getters, in the `Image` class body:

```typescript
protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
    { selector: ".loading", extract: (): StyleBag => IMAGE_LOADING_DECLARATIONS },
    { selector: ".broken",  extract: (): StyleBag => IMAGE_BROKEN_DECLARATIONS },
];

isLoading(): boolean {
    return this.isStyleState(".loading");
}

isBroken(): boolean {
    return this.isStyleState(".broken");
}

/**
 * Re-enters the loading state: clears `.broken` and sets `.loading`. Called
 * from the constructor (initial entry) and — once `Image.setSrc` exists —
 * from `setSrc` (re-entry on a source change).
 */
private resetLoadState(): void {
    this.setStyleState(".broken", false);
    this.setStyleState(".loading", true);
}
```

The constructor gains one line, right after the existing `this.clearInsets();`:

```typescript
this.resetLoadState();
```

`handleLoad()` (added by `image-intrinsic-size-lifecycle`) gains two lines, clearing both states unconditionally so it is correct regardless of what state the instance was in before `load` fired:

```typescript
private handleLoad(): void {
    const element = this.getElement();
    if (!element) {
        return;
    }

    const natural = DOM.source.getNaturalSize(element);
    this._naturalSize = { width: natural.width, height: natural.height };

    this.setStyleState(".loading", false);   // new
    this.setStyleState(".broken", false);    // new

    if (!this.getPreferredSizeConstraint()) {
        const perimeter = this.getPerimeterSize();

        this.setPreferredSize({
            width:  this._naturalSize.width  + perimeter.left + perimeter.right,
            height: this._naturalSize.height + perimeter.top  + perimeter.bottom,
        });
    }

    this.emit("load");
}
```

A new `handleError()`, the same shape as `handleLoad()` but with no element-existence guard: unlike `handleLoad()`, it never reads from the DOM (there is no natural size to read on failure), and `setStyleState`/`setPreferredSize` both already no-op their own DOM writes when no element exists yet, per `Checkbox`'s own comment on the same point ([Checkbox.ts:132-137](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L132-L137)).

```typescript
private handleError(): void {
    this.setStyleState(".loading", false);
    this.setStyleState(".broken", true);

    if (!this.getPreferredSizeConstraint()) {
        const perimeter = this.getPerimeterSize();

        this.setPreferredSize({
            width:  IMAGE_BROKEN_PLACEHOLDER_PX + perimeter.left + perimeter.right,
            height: IMAGE_BROKEN_PLACEHOLDER_PX + perimeter.top  + perimeter.bottom,
        });
    }

    this.emit("error");
}
```

`_onError`'s initializer (added by `image-intrinsic-size-lifecycle` as `() => this.emit("error")`) changes to call the new handler instead:

```typescript
private readonly _onError: () => void = () => this.handleError();
```

`getMinSize()` (added by `image-intrinsic-size-lifecycle`) gains a new first branch — inserted, not replacing anything, so it applies regardless of what the rest of the method looks like by the time this plan runs (see `## Potential Challenges`):

```typescript
getMinSize(): Size | null {
    if (!this.getMinSizeConstraint() && this.isBroken()) {
        return { width: IMAGE_BROKEN_PLACEHOLDER_PX, height: IMAGE_BROKEN_PLACEHOLDER_PX };
    }

    // ...the rest of the method's existing body, unchanged...
}
```

---

## Ordered Implementation Steps

Run these only after `image-intrinsic-size-lifecycle` has been implemented and `Image.ts` carries `_naturalSize`, `_onLoad`, `_onError`, `handleLoad()`, and a `getMinSize()` override.

1. **Add the `StyleBag` / `StyleStateSpec` type import.** In `Image.ts`'s import block, add `import { type StyleBag, type StyleStateSpec } from "~/core/ClassStyleRules.js";`, matching `Checkbox.ts`'s import ([Checkbox.ts:10](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L10)).
   Verify: `grep -n "StyleStateSpec" packages/lib/src/typescript/lib/component/display/Image.ts` shows the import.

2. **Add the three module-level constants** (`IMAGE_BROKEN_PLACEHOLDER_PX`, `IMAGE_LOADING_DECLARATIONS`, `IMAGE_BROKEN_DECLARATIONS`) from `## Internal Structure`, near the file's other module-level constants.

3. **Add the `ownStyleStates` field** from `## Internal Structure` to the `Image` class body.

4. **Add `isLoading()`, `isBroken()`, and the private `resetLoadState()`** from `## Internal Structure`, each with a doc comment.

5. **Add `this.resetLoadState();`** to the constructor body, right after `this.clearInsets();`.

6. **Edit `handleLoad()`**: add the two `setStyleState` clear calls from `## Internal Structure`, right after the `_naturalSize` assignment and before the `getPreferredSizeConstraint()` check.
   Verify: `grep -n 'setStyleState(".loading", false)' packages/lib/src/typescript/lib/component/display/Image.ts` shows one match inside `handleLoad`.

7. **Add `private handleError(): void`** from `## Internal Structure`, near `handleLoad()`.

8. **Change `_onError`'s initializer** from `() => this.emit("error")` to `() => this.handleError();`.
   Verify: `grep -n "_onError" packages/lib/src/typescript/lib/component/display/Image.ts` shows the field calling `handleError`, not `emit` directly.

9. **Edit `getMinSize()`**: insert the new `.broken` branch from `## Internal Structure` as the method's first statement, before whatever branch(es) already exist. Do not remove or reorder the existing body.
   Verify: `grep -n "isBroken()" packages/lib/src/typescript/lib/component/display/Image.ts` shows it used inside `getMinSize`.

10. **Conditional — only if `Image` already declares a public `setSrc(src: string): this` method** (added by `image-attribute-options-surface`, if that plan has already landed): add `this.resetLoadState();` as the first line of `setSrc`'s body, before its existing `this._naturalSize = null;` line. If `setSrc` does not exist yet, skip this step — there is no way to re-enter the loading state until that sibling plan adds a mutable `src`.
    Verify (only if the step applied): `grep -n -A 2 "setSrc(src: string): this {" packages/lib/src/typescript/lib/component/display/Image.ts` shows `resetLoadState()` as the first line of the method body.

11. **Update the class-level JSDoc** to mention the `.loading` / `.broken` visual states and `isLoading()` / `isBroken()` — see `## Documentation Impact`.

12. **Typecheck.** `npm run typecheck` — expect zero errors.

13. **Update `packages/lib/tests/component/display/Image.test.ts`** per `## Expected Behaviour` below, using the same `Bridged`-cast direct-handler-invocation pattern the dependency plan's own test rewrite uses for `_onLoad` (mirrors `Video.test.ts:250`).

14. **Run tests.** `npm test` — all `Image.test.ts` cases green, no regressions elsewhere.

15. **Update `packages/lib/docs/components/Image.md`** per `## Documentation Impact`.

16. **Run `npm run docs:api`** — expect zero TypeDoc warnings.

17. **Re-read the full diff of `Image.ts` once, end to end**, checking: `handleLoad()` clears both states; `handleError()` sets `.broken` and clears `.loading`; `_onError` calls `handleError`, not a bare `emit`; `getMinSize()`'s new branch is a prepended early return, not a replacement of the existing body; the constructor calls `resetLoadState()` exactly once; `isLoading()` / `isBroken()` are both referenced somewhere (tests, at minimum — no orphans).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Image.ts` |
| Modify | `packages/lib/tests/component/display/Image.test.ts` |
| Modify | `packages/lib/docs/components/Image.md` |

---

## Expected Behaviour

All rows are unit-testable offline: casting the `Image` instance to a narrow `{ _onLoad: () => void; _onError: () => void }` type (matching the dependency plan's own test pattern, itself matching `Video.test.ts`'s `Bridged` type) invokes the native-event bridge directly, since the offline harness cannot dispatch a real non-bubbling `load`/`error` event. `TestDOM.ts`'s `setNaturalSize` seeds `_onLoad`'s natural-size read where needed. The only non-automatable case is the actual visual appearance of the two washes in a real browser.

### State machine

| Step | `isLoading()` | `isBroken()` |
|---|---|---|
| `new Image('/a.png')` constructed | `true` | `false` |
| `_onLoad()` fires | `false` | `false` |
| *(separate instance)* `new Image('/a.png')`, then `_onError()` fires | `false` | `true` |

### CSS class tokens

- A freshly constructed `Image`, after `getElement(true)`, carries the DOM class `loading` and not `broken`.
- After `_onLoad()` fires, the element carries neither `loading` nor `broken`.
- After `_onError()` fires, the element carries `broken` and not `loading`.

### Size reporting when broken

| Scenario | `getPreferredSize()` | `getMinSize()` |
|---|---|---|
| `_onError()` fires, no explicit `preferredSize`, no explicit `setMinSize` | `{48, 48}` | `{48, 48}` |
| Constructed with `{ preferredSize: { width: 120, height: 40 } }`, then `_onError()` fires | `{120, 40}` (unchanged — explicit size wins) | `{48, 48}` (min still auto-derives, independent of the preferred-size constraint — mirrors the dependency plan's own load-path precedent) |
| `setMinSize({ width: 10, height: 10 })` called (before or after `_onError()`), no `preferredSize` set | auto-fits to the placeholder as normal | `{10, 10}` (explicit constraint wins regardless of `.broken`) |

### Events (regression coverage, not new behaviour)

- `_onError()` firing still fires the `"error"` custom event registered via `on("error", fn)` (unchanged public contract from the dependency plan; now routed through `handleError()` instead of an inline `emit`).
- `_onLoad()` firing still fires `"load"` and still auto-publishes the natural size, in addition to now clearing both style states.

### Manual verification (not automatable)

- Real browser: open the `Image` docs demo (`npm run docs:dev`, `/components/Image`), confirm a slow-loading image shows the neutral loading wash before it decodes, and a deliberately broken `src` (e.g. a 404 URL) shows the distinct broken wash at a 48×48 placeholder box instead of the browser's default broken-image icon with no styling.

---

## Verification

- `npm run typecheck` — zero errors.
- `npm test` — `Image.test.ts` green, full suite green.
- `npm run docs:api` — zero TypeDoc warnings.
- `grep -n 'setStyleState(".loading"' packages/lib/src/typescript/lib/component/display/Image.ts` — matches in both `resetLoadState()` and `handleLoad()`/`handleError()`.
- Manual smoke test per `## Expected Behaviour`'s last bullet.

---

## Documentation Impact

`Image` gains two public methods and two declared visual states — update:

- **`packages/lib/docs/components/Image.md`**: add a "Notes" bullet: "`Image` shows a neutral placeholder wash (`.loading`) while a source is decoding, and a distinct wash (`.broken`) if the decode fails — check `isLoading()` / `isBroken()`, or style the states directly via the theme variables `--ts-ui-image-loading-bg` / `--ts-ui-image-broken-bg`. A broken image reports a fixed 48×48 placeholder size instead of collapsing to nothing." Add `isLoading()` / `isBroken()` rows to the "Common methods" table.
- **`Image.ts`'s class-level JSDoc**: mention the two declared states and the broken-state placeholder size — see step 11 above.
- Run `npm run docs:api` (step 16) — must finish with zero warnings.

---

## Potential Challenges

- **`getMinSize()`'s existing body shape is uncertain at plan-write time.** This plan does not depend on `image-object-fit-aspect-ratio`, which also rewrites `getMinSize()` (deleting the natural-size cap branch entirely and adding an `_aspectMinSize`-based branch instead). Because this plan's `.broken` branch is specified as a *prepended* early return rather than a body replacement, it is correct regardless of which shape the rest of the method has by the time this plan is implemented — but the implementer must still locate the current body and insert, not overwrite.
- **`setSrc` may not exist yet.** Step 10 is conditional on `image-attribute-options-surface` having already landed. Check the file before assuming either state, the same way that sibling plan itself checks for `applyOptions`'s existence before editing it.
- **`.loading` and `.broken` must never both be DOM-present at once.** `handleError()` clears `.loading` before setting `.broken`, and `resetLoadState()` clears `.broken` before setting `.loading`, in that order — both are synchronous `setStyleState` calls, so there is no intermediate frame where both classes are present. Preserve this ordering; do not reorder either pair of calls.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/display/Image.ts](packages/lib/src/typescript/lib/component/display/Image.ts) — the file this plan modifies.
- [plans/image-intrinsic-size-lifecycle.md](plans/image-intrinsic-size-lifecycle.md) — the dependency this plan builds on; defines `_naturalSize`, `handleLoad()`, `_onLoad`/`_onError`, and the pre-load `{0, 0}` / `null` size contract this plan leaves unchanged for the loading state.
- [packages/lib/src/typescript/lib/component/container/SplitGutter.ts](packages/lib/src/typescript/lib/component/container/SplitGutter.ts) (lines 89-126, 312-330) — the precedent this plan mirrors: a leaf `Component` subclass (no delegate, no hierarchy-cascade opt-in) declaring `ownStyleStates` with a constant `StyleBag` extract, plus the `isOpaque()`-shaped read-only forwarder.
- [packages/lib/src/typescript/lib/component/input/Checkbox.ts](packages/lib/src/typescript/lib/component/input/Checkbox.ts) (lines 52-140) — a second precedent for the same mechanism (two declared states on one class), read to confirm the shape generalizes beyond a single-state class.
- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) (lines 400-425 `ownStyleStates`/`.undisplayed`/`.invisible`, 5936-5989 `setStyleState`/`isStyleState`, 3245-3436 `getPreferredSizeConstraint`/`getPreferredSize`/`getMinSizeConstraint`/`getMinSize`, 3655-3689 `getPerimeterSize`) — the mechanism and contracts this plan's overrides must honor. Note line 408-410's comment: a subclass declaring its own `ownStyleStates` does not need to restate `Component`'s `.undisplayed`/`.invisible` entries.
- [packages/lib/src/typescript/lib/core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) (lines 44-93 `StyleBag`, 632-642 `StyleStateSpec`) — the exact types `ownStyleStates` entries must satisfy.
- [ARCHITECTURE.md](ARCHITECTURE.md), *Component CSS tiers and state-rule dedup* and *One DOM element per class* — the rules this plan's approach follows.
- [packages/lib/tests/component/display/Video.test.ts](packages/lib/tests/component/display/Video.test.ts) (lines 244-314) — the direct-handler-invocation offline test pattern this plan's tests mirror for `_onError`.

---

## Non-Goals

- **`src`/`alt`/other attribute options, `object-fit`/aspect-ratio, `srcset`/`decode()`.** Each is its own sibling plan; this plan only adds the two visual states and their size/lifecycle wiring.
- **A composed placeholder component (progress indication, a retry affordance, a spinner).** The audit's route (b) — see the task framing this plan was drafted against. Nothing in this plan's scope calls for more than a flat wash: no progress signal exists to show (the native `load`/`error` events carry none), and a retry affordance needs a redesigned public API this plan wasn't asked to add. If a future need for either arises, it crosses the "mostly coordination → specialize" line in [ARCHITECTURE.md](ARCHITECTURE.md)'s *Compose before specializing* and deserves its own plan.
- **An icon or `backgroundImage` in the broken-state wash.** No existing component in this codebase renders an icon via a CSS `background-image` data URI — every icon precedent (`Glyph` and its registry) renders inline SVG as its own element, which `Image`'s one-`<img>`-element constraint rules out here. Adding a new data-URI-icon pattern for one component's placeholder is disproportionate; a flat `backgroundColor` wash, matching every other single-property `ownStyleStates` precedent in this codebase (`SplitGutter.opaque`, `RadioButtonRing.selected`), is the simpler and consistent choice.
- **`Theme.ts` registration for the two new CSS variables.** See `## Architecture Decisions`, *State-token CSS variables are not registered in `Theme.ts`*.
- **A new public event (e.g. `"loadstart"`) for entering the loading state.** Not requested, and `isLoading()` already gives a poll-based answer; the existing `"load"` / `"error"` events (from the dependency plan) are unchanged.
- **ARIA wiring (`aria-busy`, role changes) for the loading/broken states.** Not requested; out of this plan's scope.

---

## Notes

[^no-restate]: `Component`'s own `ownStyleStates` (`.undisplayed` / `.invisible`, [Component.ts:416-425](packages/lib/src/typescript/lib/core/Component.ts#L416-L425)) carries an explicit comment: "A subclass that declares its own `ownStyleStates`... does not inherit these entries and is not required to restate them" — `isDisplayed()` / `isVisible()` read `_activeStates` directly rather than through the CSS-resolution path this mechanism otherwise governs. `SplitGutter.ownStyleStates` ([SplitGutter.ts:121-126](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L121-L126)) confirms this in practice: it declares only its own `.opaque` entry, with no `...Component.ownStyleStates` spread. This plan follows the same shape — `Image.ownStyleStates` lists only `.loading` and `.broken`, confirmed safe by the same comment that licenses `SplitGutter`'s identical omission.

[^no-icon]: An icon (via `backgroundImage`) and a shimmer animation (via `StyleRule.ensureKeyframes`, the mechanism `ProgressSpinner` uses for its rotating arc) were both considered for `.loading` and rejected for the same reason: `CLAUDE.md`'s Simplicity First ("no features beyond what was asked") and this task's own framing, which treats a flat wash as the default and a richer placeholder as something that would cross into the composed-component route (b) this plan explicitly does not take — see `## Non-Goals`. `ProgressSpinner`'s keyframe animation is a real, working precedent for *if* an animated indicator were wanted later, but it lives on a dedicated inner `Component` (`ProgressSpinnerArc`) that `Image`'s one-DOM-element constraint doesn't allow composing in without introducing a second element.

[^theme-choice]: Both patterns are genuinely live precedent, not one legacy and one current: `Checkbox`/`RadioButton`/`Cell`'s state tokens (`--ts-ui-checkbox-bg-indeterminate`, `--ts-ui-radio-bg-selected`, `--ts-ui-table-cell-readonly-bg`) are all registered in `Theme.ts`'s structured `Theme` interface and its `var()`-name-to-`theme.*`-field map (confirmed by grep against `packages/lib/src/typescript/lib/core/Theme.ts`); `Scrollbar`'s (`--ts-ui-scrollbar-arrow-disabled-color`, `--ts-ui-scrollbar-arrow-hover-bg`, `--ts-ui-scrollbar-thumb-hover`) are not registered anywhere — confirmed by the same grep returning zero matches for those three names. Registering `Image`'s two tokens would mean adding a new `image: {...}` section to the `Theme` interface, a matching section to the default theme object, and two new lines in the CSS-variable map — three additional edits to a shared, heavily-cross-referenced file for two single-component tokens. This plan follows `Scrollbar`'s lighter path instead, keeping the change inside `Image.ts` alone, consistent with every sibling `Image` plan's own `## Files to Create / Modify / Delete` table. A caller who wants to theme these two properties can still do so today by setting the CSS custom property directly (e.g. in a stylesheet or via `:root` overrides) — the `var(...)` fallback shape works identically whether or not `Theme.ts` knows about the variable.

[^setSrc-coordination]: `image-attribute-options-surface` is not a dependency of this plan (only `image-intrinsic-size-lifecycle` is), so `Image.setSrc` may or may not exist by the time this plan is implemented — the two plans' relative order is not fixed. This mirrors exactly the situation `image-object-fit-aspect-ratio`'s own `## Architecture Decisions` describes for its `setWidth`/`setHeight` overrides and `applyOptions`: a soft (non-`depends-on`) interaction with a sibling plan, resolved by checking for the symbol's existence at implementation time rather than assuming an order. This plan cannot edit `image-attribute-options-surface`'s own file to add the reciprocal call — it is a separate, already-drafted plan — so the conditional step here is the only coordination point available; the reader implementing `image-attribute-options-surface` (or `setSrc` under any later plan) should check for `resetLoadState()`'s existence and call it in `setSrc`, matching how that plan's own steps already accommodate `image-object-fit-aspect-ratio` in the other direction.
