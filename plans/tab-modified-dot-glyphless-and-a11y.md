---
touches-shared:
  - packages/lib/src/typescript/lib/component/button/TabButton.ts
  - packages/lib/src/typescript/lib/component/container/TabBar.ts
  - packages/lib/src/typescript/lib/layout/Tab.ts
  - packages/lib/src/typescript/lib/core/Aria.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Tab Modified Dot: Glyph-less Tabs and Accessible Cue — Implementation Plan

## Overview

The "unsaved changes" dot a tab shows through `Tab.setTabModified` → `TabBar.setEntryModified` → `TabButton.setModified` has three defects, reported by the SQLAdmin consumer app. This plan fixes all three; it ships in 0.11.0.

1. **Glyph-less tabs show nothing.** [`TabButton.positionModifiedBadge`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L546) computes `shown = this._modified && glyph !== null` (line 554), so a modified tab without a leading glyph never shows the dot. The library's own Tab demo (`packages/lib/src/typescript/TabDemoPanel.ts`, *Toggle Modified*) reproduces it on every tab except "Alpha".
2. **No accessible cue.** The modified state reaches assistive technology in no form, so a screen-reader user cannot tell a dirty tab from a clean one.
3. **Stale docs.** The `MODIFIED_GLYPH` comment ([TabButton.ts:21](packages/lib/src/typescript/lib/component/button/TabButton.ts#L21)) and three doc pages still describe the dot as "trailing the label", the placement commit `df98c1f6` replaced with a badge over the leading glyph's corner.

The code changes live in `TabButton.ts` and `core/Aria.ts`, with JSDoc-only edits in `TabBar.ts` and `Tab.ts`. The public tab API (`setTabModified`, `setEntryModified`, `setModified` and their readers) keeps its signatures.

---

## Architecture Decisions

### Glyph-less placement — the dot sits on the content row's upper-left corner

**For review.** When a tab has no leading glyph, the badge is centred on the upper-left corner of the button's content row (`_content`). On a glyph-less tab that corner is the label's own upper-left corner. With a glyph, the badge stays exactly where it is today, on the glyph's upper-left corner. Size, colour, z-index and the no-hit-testing setting do not change.[^placement]

The rule, stated once: **the dot is centred on the upper-left corner of the first thing in the tab's content row — the glyph when there is one, otherwise the label.**

| Tab | `_content` at | Glyph at (inside `_content`) | Anchor point | Badge `x, y` (dot size 8) |
|---|---|---|---|---|
| With glyph | (10, 4) | (0, 6) | (10, 10) | (6, 6) |
| No glyph | (10, 4) | — | (10, 4) | (6, 0) |
| Not modified | any | any | — | hidden |

The overlay technique does not change: the badge stays a raw-appended `Glyph` on the button's own element, re-pinned each layout pass by `TabBar.positionModifiedBadges`. It never enters the content row, so it cannot shift the label or resize the tab — the property `df98c1f6` introduced it for.[^df98-rationale]

### Accessible cue — `aria-description="Modified"` on the tab button

While a tab is modified, its `TabButton` carries `aria-description="Modified"`. Clearing the modified state removes the attribute. The write happens inside `TabButton.setModified`, the same way [`ToggleButton.setSelected`](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L174) writes `aria-pressed` from its own state setter.[^why-description]

The string is a module constant, `MODIFIED_DESCRIPTION = "Modified"`, hard-coded in English like the library's other built-in accessible strings (`ProgressSpinner`'s `"Loading"`, `ToolBar`'s `"More"`).[^i18n]

### `Aria` gains `setDescription` / `getDescription` / `clearDescription`

`aria-description` is not yet in the typed [`Aria`](packages/lib/src/typescript/lib/core/Aria.ts#L86) accessor. ARCHITECTURE.md's attribute table says ARIA goes through `this.getAria()` and to "extend `Aria.ts` if missing". The three new methods copy [`setLabel` / `getLabel` / `clearLabel`](packages/lib/src/typescript/lib/core/Aria.ts#L738) line for line, with `"description"` as the attribute key. That includes `clearLabel`'s rule that clearing an attribute that was never set writes nothing.[^aria-shape]

### Historical changelog stays untouched

`docs/reference/changelog/0.10.0.md:599-603` also says "trailing a tab's label". It is not edited. Released changelog pages are only changed by release commits, and `next.md` already corrects an earlier release's notes by writing a new entry (the `"columnresizeend"` entry under *Added › Components*). The new `next.md` entry says that 0.10.0's notes gave the wrong placement.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/core/Aria.ts — class Aria (new methods)
setDescription(value: string): this;   // writes aria-description
getDescription(): string | null;       // cached value, or null when unset
clearDescription(): this;              // removes aria-description; no write when unset
```

`TabButton.setModified(modified: boolean): this`, `isModified(): boolean` and `positionModifiedBadge(): void` keep their signatures. What changes is behaviour: `positionModifiedBadge` now shows the badge on a glyph-less modified tab, and `setModified` also writes or clears `aria-description`.

No options-bag field is added. `_modified` is runtime state with no options field (see the field comment at [TabButton.ts:230](packages/lib/src/typescript/lib/component/button/TabButton.ts#L230)). The ARIA value is cached by `Aria`'s own attribute map, as for every other `Aria` setter.

---

## Implementation

`positionModifiedBadge` after the change (JSDoc omitted; step 4 gives it):

```typescript
positionModifiedBadge(): void {
    const badge = this._modifiedGlyph;

    if (!badge) {
        return;
    }

    badge.setVisible(this._modified);

    if (!this._modified) {
        return;
    }

    const dotSize = ThemeManager.getResolvedScale().glyphXs;

    // (keep the existing setPreferredSize comment and the three sizing calls unchanged)
    badge.setPreferredSize({ width: dotSize, height: dotSize });
    badge.setWidth(dotSize);
    badge.setHeight(dotSize);

    // The glyph, when there is one, leads the content row; otherwise the
    // label does, and it sits flush with `_content`'s own origin.
    const glyph   = this.getGlyph();
    const anchorX = this._content.getX() + (glyph ? glyph.getX() : 0);
    const anchorY = this._content.getY() + (glyph ? glyph.getY() : 0);

    badge.setX(Math.round(anchorX - dotSize / 2));
    badge.setY(Math.round(anchorY - dotSize / 2));
}
```

The ARIA write in `setModified`. It goes directly after `this._modified = modified;` and before the lazy-build branch, so a `setModified(false)` that never built a badge still clears correctly:

```typescript
this._modified = modified;

if (modified) {
    this.getAria().setDescription(MODIFIED_DESCRIPTION);
} else {
    this.getAria().clearDescription();
}
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/core/Aria.ts`** — add `setDescription(value)`, `getDescription()` and `clearDescription()` directly after `clearLabel` (line 761), before `setOrientation`. Copy the bodies of `setLabel` / `getLabel` / `clearLabel`, using attribute key `"description"` and DOM name `"aria-description"`. Write the JSDoc in the same style: `setDescription` says it gives supplementary text that assistive technology reads after the element's name and role; `clearDescription` says it is the null companion to `setDescription`.
   Check: `grep -n "aria-description" packages/lib/src/typescript/lib/core/Aria.ts` shows the `clearDescription` removal line.

2. **`packages/lib/tests/core/Aria.test.ts`** — add tests E1–E3 (see *Expected Behaviour*). Put E1 in a new `describe('Aria — description', …)` after `'Aria — label'`. Put E2 and E3 in `'Aria — unchanged writes are skipped'`, copying the `clearLabel writes nothing…` test (line 197) and its `labelRemovals` helper, with `aria-description` in place of `aria-label`.
   Check: `npx vitest run tests/core/Aria.test.ts` (from `packages/lib`) passes.

3. **`packages/lib/src/typescript/lib/component/button/TabButton.ts`, top of file** —
   - Replace the `MODIFIED_GLYPH` doc comment (line 21) with: `/** Registry name of the "unsaved changes" badge — a plain filled disc pinned over the upper-left corner of the tab's leading glyph, or of its label when there is no glyph. */`
   - Directly below it, add:
     ```typescript
     /**
      * The `aria-description` a modified tab carries, so assistive technology
      * announces the state the dot shows visually. English, like the library's
      * other built-in accessible strings.
      */
     const MODIFIED_DESCRIPTION = "Modified";
     ```

4. **`TabButton.ts`, badge code** —
   - `_modifiedGlyph` field comment (lines 234-240): replace "it pins to the leading glyph's corner" with "it pins to the upper-left corner of the content row's leading item (the glyph, else the label)". Leave the rest.
   - `setModified` (line 470): add the ARIA write from *Implementation*. In its JSDoc, change the first sentence to "…a small dot pinned over the upper-left corner of the tab's leading glyph — or of the label, on a tab with no glyph — half-covering it." Add: "While shown, the button also carries `aria-description="Modified"`, so assistive technology announces the state."
   - `positionModifiedBadge` (line 546): replace the body with the one in *Implementation*. In its JSDoc, replace the sentence starting "The badge is shown only while both {@link isModified} and a leading glyph are true — …" and the sentence after it with: "The badge is shown exactly while {@link isModified} is true. It anchors to the leading glyph's upper-left corner, or to the content row's own upper-left corner (the label's) when the tab has no glyph. A lazy tab can gain its glyph after being marked modified, or lose it later, and the per-layout re-pin moves the badge between the two anchors." Update the `@remarks` so it also covers the glyph-less case: there, `_content`'s own position is the anchor.
   Check: `grep -n "glyph !== null" packages/lib/src/typescript/lib/component/button/TabButton.ts` finds nothing.

5. **`packages/lib/src/typescript/lib/component/container/TabBar.ts:2924`** — `positionModifiedBadges` JSDoc: change it to "Re-pins every modified tab's badge to the upper-left corner of its leading glyph, or of its label when it has no glyph. Cheap to call unconditionally each layout pass — `TabButton` itself no-ops for a tab that isn't modified."

6. **`packages/lib/src/typescript/lib/layout/Tab.ts:1432`** — `setTabModified` JSDoc: change the first sentence to "…a small dot pinned over the upper-left corner of the tab's leading glyph (or of its label, when the tab has no glyph), half-covering it." Add: "The tab button also carries `aria-description="Modified"` while marked."

7. **`packages/lib/tests/component/button/TabButton.test.ts`** — in `describe('TabButton modified indicator')` (line 176):
   - Add a `badgeVisible(btn)` helper next to `badgeOf`. It reads `_modifiedGlyph` and returns its `isVisible()`.
   - Replace the test `'positionModifiedBadge no-ops when the tab is not modified or carries no glyph'` (line 286) with tests T1–T4.
   - Add tests T5–T7 (ARIA).
   Check: `npx vitest run tests/component/button/TabButton.test.ts` passes.

8. **`packages/lib/tests/layout/Tab.tabModified.test.ts`** — add test T8 to `describe('Tab modified indicator')`.

9. **Docs** —
   - `packages/lib/docs/components/TabButton.md` *Modified indicator* (lines 28-37): change "a small filled dot trailing the label" to "a small filled dot over the upper-left corner of the tab's leading glyph — or of the label, on a tab with no glyph". Replace the "Unlike the busy wash, the dot is a real content-row child…" paragraph with: "Like the busy wash, the dot is an overlay rather than a content-row child, so showing it never moves the label or resizes the tab. Its colour reads `--ts-ui-tab-indicator-color`, the same accent the strip's active-tab underline and the busy wash's fallback use. While shown, the button also carries `aria-description="Modified"`, so screen readers announce the state along with the tab's name." In *Notes*, add a bullet that the modified badge is overlaid and re-pinned by `TabBar` each layout pass, like the close button.
   - `packages/lib/docs/layouts/Tab.md:107`: replace "a small filled dot trailing a tab's label … rather than baked into the label text" with "a small filled dot over the upper-left corner of the tab's leading glyph, or of its label when the tab has no glyph — a persistent "unsaved changes" marker that survives label truncation, since it is drawn over the tab rather than baked into the label text, and that screen readers announce as the tab's description".
   - `packages/lib/docs/components/TabBar.md:64`: change "a cell's trailing "unsaved changes" dot" to "a cell's "unsaved changes" dot (over the leading glyph's corner, or the label's)".
   - `packages/lib/docs/concepts/accessibility.md`: after the paragraph ending "…just as it does from the tab button." (the `Tab` keyboard paragraph under *Keyboard navigation: RovingTabIndex*), add: "A tab marked modified with [`setTabModified`](/api/layout/classes/Tab#settabmodified) carries `aria-description="Modified"`, so its unsaved state is announced as well as drawn."
   Check: `grep -rn -i "trailing" packages/lib/docs/components/TabButton.md packages/lib/docs/layouts/Tab.md packages/lib/docs/components/TabBar.md | grep -i "dot\|label"` finds nothing.

10. **`packages/lib/docs/reference/changelog/next.md`** — add three entries:
    - Under `## Fixed` › `### Components` (append at the end of that sub-section):
      ```markdown
      - **A modified tab without a glyph now shows its "unsaved changes" dot.**
        The dot was drawn only as a badge over a tab's leading glyph, so
        `Tab.setTabModified(content, true)` on a glyph-less tab showed nothing.
        On such a tab the dot now sits over the label's upper-left corner,
        still as an overlay that never moves the label. The 0.10.0 notes
        described this dot as trailing the label; since 0.10.0 it has been a
        badge on the glyph's corner.
      ```
    - Under `## Added` › `### Components` (append):
      ```markdown
      - **A modified tab is announced to assistive technology.** While
        `Tab.setTabModified` (or `TabButton.setModified`) marks a tab, its
        button carries `aria-description="Modified"`, so a screen reader
        reports the unsaved state along with the tab's name.
      ```
    - Under `## Added` › `### Core` (append):
      ```markdown
      - **`Aria` gains `setDescription` / `getDescription` / `clearDescription`**
        for `aria-description`, mirroring the `setLabel` / `getLabel` /
        `clearLabel` trio.
      ```

11. **Full checks** — see *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Aria.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` (JSDoc only) |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` (JSDoc only) |
| Modify | `packages/lib/tests/core/Aria.test.ts` |
| Modify | `packages/lib/tests/component/button/TabButton.test.ts` |
| Modify | `packages/lib/tests/layout/Tab.tabModified.test.ts` |
| Modify | `packages/lib/docs/components/TabButton.md` |
| Modify | `packages/lib/docs/layouts/Tab.md` |
| Modify | `packages/lib/docs/components/TabBar.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

**`Aria` (unit-testable, `tests/core/Aria.test.ts`)**

- **E1** `getDescription()` is `null` on a fresh component. After `setDescription('Modified')` it returns `'Modified'`. After `clearDescription()` it is `null` again.
- **E2** On a rendered component, `clearDescription()` with no description ever set records no `apply` patch whose `removeAttr` holds `aria-description`. `setDescription('Modified')` followed by `clearDescription()` records exactly one such removal. A second `clearDescription()` records none.
- **E3** `setDescription('Modified')` called twice records exactly one `apply` patch with `setAttr['aria-description'] === 'Modified'`.

**`TabButton` placement (unit-testable, `tests/component/button/TabButton.test.ts`)** — set positions by hand with `contentRow(btn).setX/setY` and `glyph.setX/setY`, as the existing corner test (line 264) does. Compare against `badge.getWidth()` as `dotSize`.

- **T1** Glyph-less modified tab: `new TabButton('Home')`, `setModified(true)`, content row at (10, 4), `positionModifiedBadge()`. The badge is visible, `x = Math.round(10 - dotSize / 2)` and `y = Math.round(4 - dotSize / 2)`.
- **T2** Glyph gained while modified: start as T1, then `setGlyph('xmark')`, place the glyph at (0, 6) and the content row at (10, 4), `positionModifiedBadge()`. The badge is still visible and moves to `(Math.round(10 - dotSize / 2), Math.round(10 - dotSize / 2))`.
- **T3** Glyph lost while modified: `new TabButton('Home', { glyph: 'xmark' })`, `setModified(true)`, `clearGlyph()`, content row at (10, 4), `positionModifiedBadge()`. The badge is still visible at the content-row anchor of T1.
- **T4** Not modified: `setModified(true)` then `setModified(false)` on a glyph-less tab, then `positionModifiedBadge()`. The badge is hidden (`isVisible() === false`). A never-modified glyph-less tab's `positionModifiedBadge()` does not throw and builds no badge (`badgeOf(btn) === null`).
- The existing test at line 264 (with-glyph anchor) stays unchanged and must still pass.

**`TabButton` ARIA (unit-testable, same file)**

- **T5** A fresh `TabButton` has `getAria().getDescription() === null`.
- **T6** `setModified(true)` → `getAria().getDescription() === 'Modified'`. `setModified(false)` → `null`. `setModified(true)` again → `'Modified'`.
- **T7** A glyph-less tab behaves the same as T6. The ARIA cue does not depend on the glyph.

**`Tab` integration (unit-testable, `tests/layout/Tab.tabModified.test.ts`)**

- **T8** A tab marked with `setTabModified(content, true)` *before* its first `doLayout()` (use the pattern of the test at line 125), then laid out: `barEntries(tab)[0].button.getAria().getDescription() === 'Modified'`.

**Manual (needs a browser)**

- **M1** Library dev server, *Tab* demo section, *Toggle Modified* on a glyph-less tab: a dot appears over the label's upper-left corner. The label does not move and the tab does not resize. Toggle again: the dot disappears. On "Alpha" (the tab with a glyph), the dot is on the star's corner as before.
- **M2** Same check with the strip compact and, if the demo exposes them, west/east and rotated orientations: the dot stays fully inside the tab and does not make the first letter unreadable.
- **M3** Chrome DevTools → Elements → Accessibility pane on a modified tab button: *Description* reads "Modified". It is absent once the tab is toggled clean.

---

## Verification

From `packages/lib`:

- `npm run typecheck` and `npm run typecheck:test` — clean.
- `npx vitest run tests/core/Aria.test.ts tests/component/button/TabButton.test.ts tests/layout/Tab.tabModified.test.ts tests/component/container/TabBar.test.ts` — E1–E3 and T1–T8 pass, as do the existing modified, busy and close tests.
- `npm test` — full suite green.
- `npm run lint` — clean. No new DOM access: the ARIA write goes through `getAria()`.
- `npm run docs:api` — zero warnings (CODE_CONVENTIONS.md, *Don't `{@link}` internal symbols*). The new `Aria` JSDoc may `{@link}` only its own public siblings.
- `grep -n "glyph !== null" src/typescript/lib/component/button/TabButton.ts` — no match.
- Manual M1–M3: `npm run dev` from `packages/lib`, open the *Tab* section.

---

## Documentation Impact

- `Aria` is already exported from the `core` entry point. The three new methods appear on its generated API page with no export change. `docs/concepts/accessibility.md` already links there ("See `Aria` for the full list").
- Prose pages updated in step 9: `docs/components/TabButton.md`, `docs/layouts/Tab.md`, `docs/components/TabBar.md`, `docs/concepts/accessibility.md`.
- Changelog: `docs/reference/changelog/next.md` (step 10). `0.10.0.md` is not edited (see *Historical changelog stays untouched*).
- `llms.txt` needs no change: no class is added, and its coverage check only tracks classes.

---

## Potential Challenges

- **`aria-description` support varies by browser and screen reader.** Chromium and Firefox expose it; WebKit support is newer, and the WebKitGTK + Orca pairing a Tauri shell would use is unconfirmed. M3's DevTools check is the minimum bar; try one real screen reader if one is at hand.
- **Two things named "description".** `Button` already has `setDescription` / `getDescription` / `clearDescription` for its visible subtitle. The new methods are on `Aria`, reached through `getAria()`, so the names do not collide. Tests and docs must say `getAria().getDescription()`, never `btn.getDescription()`.
- **Badge vs first letter.** At the default scale the dot's lower-right quarter lands in the space above the label's capitals. M1/M2 confirm it stays legible; if it does not, report back rather than nudging it with an offset (ARCHITECTURE.md, *No cosmetic insets or padding*).

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/button/TabButton.ts`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L457) — `setModified`, `positionModifiedBadge`, and the busy-wash / close-button overlays they mirror.
- [`packages/lib/src/typescript/lib/core/Aria.ts`](packages/lib/src/typescript/lib/core/Aria.ts#L738) — `setLabel` / `getLabel` / `clearLabel`, the shape the new methods copy.
- [`packages/lib/src/typescript/lib/component/button/ToggleButton.ts:174`](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L174) — `setSelected` writing `aria-pressed` from the state setter, the precedent for the ARIA write.
- [`packages/lib/src/typescript/lib/component/button/Button.ts:1626`](packages/lib/src/typescript/lib/component/button/Button.ts#L1626) — `_rebuildContentRow`: a glyph-less tab's `_content` holds only the title column, which is why `_content`'s origin is the label's corner.
- [`packages/lib/src/typescript/lib/component/container/TabBar.ts:2242`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2242) — `computeTabButtonInsets` and `stripChrome`: the clearance that keeps the half-dot overhang inside the button.
- [`packages/lib/tests/component/button/TabButton.test.ts:176`](packages/lib/tests/component/button/TabButton.test.ts#L176) — the existing modified-indicator tests and their private-field helpers.
- [`packages/lib/tests/core/Aria.test.ts:138`](packages/lib/tests/core/Aria.test.ts#L138) — label tests to copy.
- `plans/implemented/tab-modified-glyph.md` — the original plan and its *Revision: corner badge* section.

---

## Non-Goals

- **No trailing-the-label dot, and no close-✕ swap.** Both were rejected before.[^placement]
- **No change to the with-glyph placement.** The existing corner-over-glyph badge is untouched.
- **No localisation of `"Modified"`.** The library has no string-localisation layer. Other built-in accessible strings are English too.
- **No live announcement** (`aria-live`) when a tab becomes modified. The description is read when the tab is focused or read, which is the normal way to learn a tab's state.
- **No `aria-busy` for `setBusy`.** That is a similar gap for the busy wash, but it was not reported and has different semantics. It is left for its own change.
- **No edit to `0.10.0.md`.**

---

## Notes

[^placement]: **Alternatives considered** (listed for the user's review):
    - *Trailing the label, as a content-row child* — the pre-`df98c1f6` design. Rejected: that commit moved away from it because the dot "pushed the label over", and a row child competes with the label for width. Bringing it back only for glyph-less tabs would restore the rejected behaviour for exactly those tabs. SQLAdmin's write-up suggested it as a "trailing-dot fallback", and this plan does not follow that suggestion.
    - *Centred in the leading inset (the gap left of the label)* — the leading inset is `2 × tabButtonInset`: 8 px at base 14, but only about 4 px in the compact strip, narrower than the 8 px `glyphXs` dot. Widening the inset when a tab becomes modified would move the label, which is what `df98c1f6` rejected.
    - *In the close-✕ slot (VS Code, Sublime Text)* — only closeable tabs have that slot, so it cannot be the fallback for a non-closeable tab. `plans/implemented/tab-modified-glyph.md` (*Non-Goals*) already rejected a hover swap between ✕ and dot, because swapping a glyph rebuilds the content row on every hover.
    - *A fixed corner of the tab's own outer box* — on a wide fixed-width tab with a centred label, the dot ends up far from the text and looks like a mark on the strip rather than on the tab's name. It would also be a second placement rule next to the glyph rule.
    - *A marker in the label text (`*name` like Eclipse, `name ●`)* — `Tab.setTabModified` exists because a marker baked into the label can be lost when the label truncates. It would also change the tab's accessible name and its tooltip.
    - *Recolouring or italicising the label (JetBrains)* — italic already means something else here (`setTabItalic`, preview tabs), and colour alone does not work for colour-blind users.

    The chosen rule keeps the model `df98c1f6` set up — a badge on the corner of the tab's leading content — and just says what counts as "leading" when there is no glyph. It needs no new geometry: the same `anchor − dotSize / 2` centring, with `_content`'s origin as the anchor.

[^df98-rationale]: Commit `df98c1f6` ("Move the tab-modified indicator onto a corner badge over the file glyph") gives its reason: the dot "previously rode as its own child in the tab's content row, pushing the label over". The glyph-less fallback keeps the badge off the content row for that reason. Clearance was checked against [`computeTabButtonInsets`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2242) and `stripChrome`. Half the dot is `glyphXs / 2` = 4/14 of the base size. The leading inset is `2 × tabButtonInset` = 8/14 of base (about 4/14 compact), and the north/south strip adds the same `pad × 2` above the label. So the half-dot that sticks out up and left stays inside the button at every base size. The compact strip is at most one pixel short, from `Math.round`.

[^why-description]: The library has no ARIA *state* for "modified" (unlike `aria-selected`, `aria-pressed` or `aria-readonly`), so the cue has to be text. `aria-description` adds that text without touching the tab's accessible name. Three other options were rejected:
    - *A suffix on the accessible name via `aria-label` ("Report.sql, modified")* — this would fight `Button._reflectAccessibleName`, which owns `aria-label` and clears it on every `setText` while the label is visible, so a rename would silently drop the suffix. It would also rename the tab panel, because `Tab` points the panel's `aria-labelledby` at the button ([Tab.ts:1746](packages/lib/src/typescript/lib/layout/Tab.ts#L1746)).
    - *`aria-describedby` pointing at the badge with an `aria-label`* — this needs two new `Aria` methods, an id reference to an overlay that is hidden when clean, and rules about computing names from hidden elements. That is more code for the same announcement.
    - *Visually hidden text inside the button* — it adds a DOM node the content-row rebuild would have to keep, and it also changes the accessible name.

[^i18n]: Hard-coded English accessible strings the library already ships: `ProgressSpinner` (`"Loading"`), `ToolBar`'s overflow trigger (`"More"`), `MenuBar` (`"Main menu"`), `Notification`'s close button (`"Dismiss notification"`), `NotificationHistoryButton` (`"Notification history"`). `"Modified"` matches the API's own name for the state (`setModified`, `setTabModified`).

[^aria-shape]: `setLabel` / `clearLabel` fit better than `setHidden(value | null)`'s single-setter shape: `aria-description` is free text like `aria-label`, and `clearLabel`'s JSDoc already explains why a null companion is better than `setX("")`. Giving the two free-text attributes the same three-method shape keeps `Aria` consistent.
