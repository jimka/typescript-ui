# StatusBar Baseline Alignment — Implementation Plan

## Overview

`StatusBar` widgets do not share a baseline, and the bar clips its taller widgets at the bottom edge. Both defects trace to the same structure: the bar nests three `HBox` rows (a left zone, a flex `Spacer`, a right zone) inside an outer `HBox`, and stretches all three ([StatusBar.ts:103](src/typescript/lib/component/container/StatusBar.ts#L103), [:117](src/typescript/lib/component/container/StatusBar.ts#L117), [:122](src/typescript/lib/component/container/StatusBar.ts#L122)).

Stretching disables `HBox`'s baseline pass ([HBox.ts:476-478](src/typescript/lib/layout/HBox.ts#L476)) and makes `getContentBaseline()` return `null` ([HBox.ts:45-48](src/typescript/lib/layout/HBox.ts#L45)), so nothing aligns. But simply deleting the three `setStretching(true)` calls makes things **worse** — it was measured at a 4px bottom clip, because the nesting hides each zone's tall children from the other zone's baseline. This plan is a rewrite after that naive fix was tried in a real app and reproduced exactly that clip.

The fix is to **flatten the three zones into a single `HBox` row**. Measured, this is the only shape whose content fits the bar's 21px content box at all. It also deletes two `Container`s and two `HBox`es. Two supporting changes are required: the offline test harness must honour `line-height` (today it silently ignores it, so this bug is not currently testable), and the bar's widget-height budget must be documented — a stock glyph-only `Button` is **22px** and physically cannot fit, no matter the layout.

---

## Measured Baseline Data

Every number below was measured offline via `installTestDOM` with the baked test font (`ascent 13`, `descent 3`, font box `16`) and theme `--ts-ui-font-size: 14px` / `--ts-ui-line-padding: 2px`. **These are the numbers the implementer asserts against.** The bar's content box (the "band") is `STATUS_BAR_HEIGHT (22) − STATUS_BAR_BORDER_TOP_WIDTH (1)` = **21px**.

Leaf widgets:

| Widget | preferred | `getBaseline()` |
|---|---|---|
| `Text("Hello")` + `centerInHeight(21)` | 33×**21** | **16** |
| `Text("Hello")` plain | 33×16 | 13 |
| `Text("")` + `centerInHeight(21)` | **0×0** | **`null`** |
| `Glyph` default | 16×16 | 13 |
| `Button({glyph, flat, compact})` | **22×22** (min **22×22**) | **`null`** |
| `Button({glyph, flat, compact})` + `pinGlyphSize(14)` | 20×20 (min 20×20) | `null` |
| `Button({text})` | 38×30 | 20 |
| identity widget — `Component({layoutManager: new HBox({spacing:6}), components:[Glyph, Text]})` | 42×**16** | **13** |
| bare `Container` (default `Absolute` layout) | `null` | `null` |
| `Spacer.flex()` | `null` | `null` |

Whole-bar shapes, for the exact sqladmin composition (message `Text` + identity widget + glyph-only history `Button`). `absBaseline` is the widget's baseline in bar coordinates — **equal values mean aligned**:

| Shape | row height wanted | msg absBaseline | identity absBaseline | button bottom | verdict |
|---|---|---|---|---|---|
| **A** — nested, stretching (today) | 22 | 16 | **13** | 22 | misaligned by 3px; clips 1px |
| **B** — nested, un-stretched (the naive fix) | **25** | 16 | 16 ✓ | **25** | aligned but **clips 4px** |
| **B** + `pinGlyphSize(14)` button | **23** | 16 | 16 ✓ | **23** | aligned but **still clips 2px** |
| **C** — flattened, 22px button | 22 | 16 | 16 ✓ | 22 | aligned; clips 1px (button too tall) |
| **C** — flattened, `pinGlyphSize(14)` button | **21** | 16 | 16 ✓ | **20.5** | **aligned, nothing clips** |
| **C** — flattened, empty message | 20 | — | 13 | 20 | nothing clips; sits 3px high (anchor collapsed) |

Three conclusions fall straight out, and they drive every decision below:

1. **Shape B is not a fix.** It reproduces the reported regression precisely (a 4px bottom clip), and pinning the button smaller only reduces it to 2px. The nesting itself is the defect.
2. **Only Shape C fits.** Flattened with a 20px button, the row wants exactly 21px — the band, exactly — and every baseline coincides at 16.
3. **A stock glyph-only `Button` cannot fit a `StatusBar`.** `flat + compact` measures 22×22 with a hard **min of 22×22** (`2 inset + 1 border + 16 glyph + 1 border + 2 inset`). `setPreferredSize(20, 20)` does **not** shrink it — the min floors it back to 22. Only `pinGlyphSize(14)` (→ 20×20) works. This clips 1px even *today*, so it is a pre-existing defect independent of alignment.

---

## Architecture Decisions

### Flatten the three zones into one `HBox` — this is the fix

Previously recorded as a Non-Goal; the empirical evidence promotes it to *the* fix. Shape C is the only measured composition whose content fits 21px.

The mechanism: `computeRowHeight` returns `rowAscent + rowDescent` ([LayoutManager.ts:571-600](src/typescript/lib/layout/LayoutManager.ts#L571)), where `computeRowMetrics` ([:538](src/typescript/lib/layout/LayoutManager.ts#L538)) takes `rowAscent` as the **max baseline** and `rowDescent` as the **max `height − baseline`**, each possibly from a *different* child. Nesting compounds this. In Shape B, the right zone's own row sees only the identity widget's baseline (13) and a `null`-baseline button, so `nullChildY` ([LayoutManager.ts:522-526](src/typescript/lib/layout/LayoutManager.ts#L522)) centres the button against the zone's **local 16px text line** rather than the bar's 21px anchor — placing it at y=0 and making the zone 22px tall while its baseline stays a shallow 13. The outer row then aligns that shallow 13 to the anchor's 16, pushing the whole zone down 3px: `3 + 22 = 25`. The zone boundary is what hides the button from the anchor.

Flattened, the button is a direct sibling of the anchor: `rowAscent` is 16 and `rowDescent` 5, giving a 21px text line, so `nullChildY` centres the 20px button at `max(0, (21−20)/2) = 0.5` — inside the band. Same widgets, same anchor, no clip.

This also deletes code — two `Container`s and two `HBox`es — and removes the `outer` spacing-0 / zone spacing-4 split in favour of one spacing. It is the "delete compensation rather than add more" direction the user prefers, and it lands there on evidence rather than taste.

### `centerInHeight` stays — it is the bar's row anchor, and it is measured

Confirmed by measurement, and unchanged from the previous plan. `centerInHeight(21)` is `setLineHeight(21)` ([Text.ts:1041-1054](src/typescript/lib/component/input/Text.ts#L1041)); it gives the message `Text` a **21×** line box with a baseline of **16** versus 16px/13 plain. That deep baseline is what every other widget aligns to, and the 21px line box is what makes the row exactly fill the band.

It is not cosmetic padding and must not be deleted. `HBox` has **no** cross-axis centring — `crossPlacement` ([BoxLayout.ts:447](src/typescript/lib/layout/BoxLayout.ts#L447)) honours only a cross-axis `fill` or an `anchor` *edge*, and `crossAnchorEdge` ([:485-511](src/typescript/lib/layout/BoxLayout.ts#L485)) returns `null` for `CENTER`, deliberately ([doc at :430-434](src/typescript/lib/layout/BoxLayout.ts#L430)). So a `centerInHeight`'d text anchor is the only library mechanism that centres a row in a taller band, and per-widget `align-self` is not an escape hatch. Delete the anchor and `rowAscent` drops to 13, top-anchoring the whole bar.

### Do not add cross-axis `CENTER` to `HBox`, and do not change `STATUS_BAR_HEIGHT`

Two tempting bigger swings, both rejected on evidence.

**Cross-axis centring is not needed.** Shape C already fits exactly and aligns exactly using the existing baseline pass. `CENTER`'s inertness is a documented design decision affecting every `HBox` and `VBox`; changing it to fix a bar that the baseline pass already handles would be a large blast radius for no gain.

**The 22px height is correct and load-bearing.** `--ts-ui-statusbar-height` is `'22px'`, set once in [BaseTheme.ts:70](src/typescript/lib/core/themes/BaseTheme.ts#L70) and overridden by **no** theme (`ModernTheme`, `ClassicTheme`, `DarkTheme` set only colours) — so it is genuinely in lockstep with `STATUS_BAR_HEIGHT = 22` exactly as its doc comment claims ([StatusBar.ts:11-17](src/typescript/lib/component/container/StatusBar.ts#L11)). Growing the bar to accommodate one oversized button would change every `StatusBar` in every app and every theme. The widget is wrong, not the bar: 21px is a coherent budget that `Text`, `Glyph`, `IconText`, `ProgressBar`, `ProgressSpinner`, and the identity widget all fit inside. Document the budget instead.

### A glyph-only `Button` is 22px and does not fit — that is a consumer sizing bug, documented not worked around

Measured: `flat + compact` is 22×22 with min 22×22, versus a 21px band. It clips 1px in **every** shape including today's, so it is pre-existing and orthogonal to alignment. `setPreferredSize` cannot fix it (min floors it); only `pinGlyphSize(14)` → 20×20 does.

The library's job here is to make the budget explicit, not to reach into consumer widgets and resize them. Step 6 documents "widgets must be ≤21px tall, and a stock `flat`+`compact` glyph `Button` is 22px — pin its glyph to 14px." sqladmin's own `NotificationHistoryButton` plan owns the app-side call.

This is the one place the "prefer library defaults over hardcoded values" preference does not survive contact with the evidence: `pinGlyphSize(14)` is a hardcoded value, but the default simply does not fit and no layout change makes it fit. Correctness wins; the number is documented with its arithmetic.

### The offline harness must honour `line-height` — otherwise none of this is testable

`ModelledDOMSource.measureText` ([tests/dom/TestDOM.ts:742-773](tests/dom/TestDOM.ts#L742)) ignores `options.lineHeight` entirely: it returns `height = ceil(ascent + descent)` and `baseline = round(ascent)` unconditionally. So offline, `centerInHeight(21)` measures **16px/13** — identical to no anchor at all. Production does the opposite: it applies `lineHeight` to the probe span and derives `baseline` from a zero-height ref span's offset ([DOM.ts:1619-1667](src/typescript/lib/core/DOM.ts#L1619)), yielding 21px/16.

The whole bug lives in that gap, so the harness cannot express it until the model matches production. Step 1 fixes it. **Verified: with the fix in place the entire existing suite still passes — 203 files, 2343 tests, zero changes required elsewhere.** The model was simply incomplete, not relied upon for its wrongness.

---

## Public API

Unchanged. `addLeft`, `addRight`, `removeLeft`, `removeRight`, `setMessage`, `getMessage`, `clearMessage`, `setDefaultMessage`, `getDefaultMessage`, `StatusBarOptions`, and the exported `STATUS_BAR_HEIGHT` all keep their current signatures and semantics. The zones are private, so flattening them is not a breaking change.

---

## Internal Structure

The flattened constructor. `_spacer` becomes a field (the pivot that separates left from right); `_leftZone` / `_rightZone` are deleted.

```typescript
private _spacer!: Spacer;   // the flex pivot: left widgets before it, right widgets after

// in the constructor, replacing the outer/leftBox/rightBox trio:
const row = new HBox();
row.setComponentSpacing(STATUS_BAR_SPACING);   // 4 — the zones' former internal spacing
this.setLayoutManager(row);                    // no setStretching: the default (false) is what we want

this._messageText = new Text("");
this._messageText.centerInHeight(STATUS_BAR_HEIGHT - STATUS_BAR_BORDER_TOP_WIDTH);

this._spacer = Spacer.flex();

this.addComponent(this._messageText);
this.addComponent(this._spacer);
```

`addLeft` inserts before the pivot; `addRight` appends. `insertComponent` clamps its index ([Component.ts:4350](src/typescript/lib/core/Component.ts#L4350)), and `getComponents()` ([:4503](src/typescript/lib/core/Component.ts#L4503)) gives the pivot's live index:

```typescript
addLeft(component: Component): this {
    this.insertComponent(component, this.getComponents().indexOf(this._spacer));

    return this;
}

addRight(component: Component): this {
    this.addComponent(component);

    return this;
}

removeLeft(component: Component): this {   // removeRight is identical
    this.removeComponent(component);

    return this;
}
```

---

## Ordered Implementation Steps

1. **Fix the offline harness first** — nothing else is testable until it lands. In `tests/dom/TestDOM.ts`, make `measureText` honour `options.lineHeight`, mirroring production: resolve the CSS value to px (fall back to the font box when absent or unparseable), floor the line box at the font box, and lower the baseline by the half-leading:

   ```typescript
   const fontBox    = font.ascent + font.descent;
   const lineHeight = Math.max(fontBox, this.resolveLineHeightPx(options?.lineHeight, fontBox));
   // Mirror production: a line box taller than the font box splits the
   // surplus evenly above and below, which lowers the baseline.
   const baseline   = Math.round((lineHeight - fontBox) / 2 + font.ascent);
   ```

   Use `baseline` in both `return`s (the wrap branch and the single-line branch) in place of `Math.round(font.ascent)`, and keep the existing wrap-height logic (`ceil(lineHeight * lines)`) reading the new `lineHeight`. Add the private helper:

   ```typescript
   private resolveLineHeightPx(lineHeight: string | undefined, fontBox: number): number {
       if (lineHeight === undefined) {
           return fontBox;
       }

       const px = parseFloat(lineHeight);

       return isNaN(px) ? fontBox : px;
   }
   ```

   Checkpoint: `npx vitest run` — **203 files / 2343 tests must all still pass**. This was verified; any failure means the edit diverged from the above.

   Checkpoint: a `Text("Hello")` with `centerInHeight(21)` now reports `getPreferredSize().height === 21` and `getBaseline() === 16` (it reported 16 and 13 before).

2. **Add a spacing constant** to `src/typescript/lib/component/container/StatusBar.ts`, beside the existing constants, documented per the repo's magic-number rule:

   ```typescript
   /**
    * Gap between adjacent status-bar widgets. Carries over the spacing the
    * former per-zone `HBox`es used; the outer row previously used 0 because
    * the zones butted against the flex spacer, which absorbs any gap anyway.
    */
   const STATUS_BAR_SPACING: number = 4;
   ```

3. **Flatten the constructor** in the same file, per *Internal Structure*. Delete the `outer` / `leftBox` / `rightBox` `HBox`es, the `_leftZone` / `_rightZone` `Container`s and their fields, and all three `setStretching(true)` calls. Add the `_spacer` field. Keep every other constructor line — the colours, the border, `setMinSize` / `setMaxSize`, the `Insets(0, 6, 0, 6)` default, the ARIA `role="status"` / `aria-live="polite"`, and the message/defaultMessage dispatch — **byte-identical**.

   Do **not** write `setStretching(false)`; `_stretching` already defaults to `false` ([BoxLayout.ts:111](src/typescript/lib/layout/BoxLayout.ts#L111)).

   Checkpoints: `grep -n 'setStretching\|_leftZone\|_rightZone' src/typescript/lib/component/container/StatusBar.ts` — expect **zero** matches. `grep -cn 'new HBox' …/StatusBar.ts` — expect **1** (was 3). `grep -n 'Container' …/StatusBar.ts` — the `Container` import and the `extends Container` clause remain; the two `new Container()` calls are gone.

4. **Keep the `centerInHeight` call**, and document why it exists so it is not mistaken for dead compensation again. Above it:

   ```typescript
   // The bar's row anchor, not cosmetic padding: a 21px line box (the strip
   // height minus its top border) gives this Text a 21px preferred height and
   // a baseline of 16 rather than 16px/13. That deep baseline becomes the
   // row's rowAscent — what every other widget aligns to — and the 21px line
   // box is what makes the row exactly fill the band, so a baseline-less
   // widget is centred against 21px rather than a shorter text line. HBox has
   // no cross-axis centring (CENTER is inert in BoxLayout.crossPlacement), so
   // this anchor is the only thing centring the bar's content. Removing it
   // drops rowAscent to 13 and top-anchors the whole row.
   ```

5. **Rewrite `addLeft` / `addRight` / `removeLeft` / `removeRight`** per *Internal Structure*, and update their JSDoc: each widget keeps its own preferred height and is baseline-aligned to the message text; `addLeft` places before the flex pivot, `addRight` after. State the **21px** height budget in both `@param` docs.

6. **Update the `StatusBar` class JSDoc** ([StatusBar.ts:56-81](src/typescript/lib/component/container/StatusBar.ts#L56)). It currently describes the three-zone split, which no longer exists. Rewrite it as: a single baseline-aligned `HBox` row — message text, a flex spacer, then the right-hand widgets — where widgets exposing a real baseline (`Text`, `Glyph`, `IconText`, a labelled `Button`, `ProgressBar`, `ProgressSpinner`, or a container laid out by a non-stretching `HBox`/`VBox`) line up on the message text's baseline, and baseline-less widgets are centred in the text line. State the budget: **widgets must be ≤21px tall** (`STATUS_BAR_HEIGHT` minus the 1px top border), and note that a stock `flat`+`compact` glyph-only `Button` is 22px — call `pinGlyphSize(14)` to bring it to 20px.

   Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) *"Don't `{@link}` internal symbols from public JSDoc"*, keep this prose — do **not** `{@link}` `crossPlacement`, `computeRowMetrics`, `rowChildY`, `nullChildY`, or `getContentBaseline`.

7. **Update `docs/components/StatusBar.md`.** The zone table at [:25-29](docs/components/StatusBar.md#L25) describes the removed structure, and [:31](docs/components/StatusBar.md#L31) claims the outer `HBox` "runs in stretching mode and will clamp tall children to the bar's height" — now false twice over (nothing stretches; nothing clamps). Replace both with the single-row description and the 21px budget from step 6, including the glyph-only-`Button` note.

   Checkpoint: `grep -rn 'stretching\|zone' docs/components/StatusBar.md` — expect zero matches.

8. **Add the tests** from *Expected Behaviour* to `tests/component/container/StatusBar.test.ts`, following that file's existing `installTestDOM(CONFIG)` + `afterEach(() => DOM.reset())` idiom. The `CONFIG` there has an empty `themeVars`; the new geometry tests need the font vars, so give them a local config carrying `--ts-ui-font-family: 'TestSans'`, `--ts-ui-font-size: '14px'`, `--ts-ui-line-padding: '2px'`.

9. **Run the checkpoints** in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `tests/dom/TestDOM.ts` |
| Modify | `src/typescript/lib/component/container/StatusBar.ts` |
| Modify | `docs/components/StatusBar.md` |
| Modify | `tests/component/container/StatusBar.test.ts` |

---

## Expected Behaviour

### Unit-testable

Layout maths is pure and runs offline once step 1 lands: `installTestDOM` swaps in a modelled source answering every metric from `tests/dom/font-metrics.test-font.json`, with no browser and no jsdom (see [tests/dom/baseline.test.ts:1-2](tests/dom/baseline.test.ts#L1)) — which is what neutralises the `document`-at-import-scope constraint. To drive geometry, follow the `ProgressBar.test.ts:135-147` idiom: `getElement(true)`, `setWidth`/`setHeight`, `doLayout()`, then assert on children.

Numbers below are the **measured** values from *Measured Baseline Data* under the test font.

1. **The harness honours `line-height`** (guards step 1). `new Text('Hello')` with `centerInHeight(21)` reports `getPreferredSize()` of `33×21` and `getBaseline() === 16`; the same `Text` without the anchor reports `33×16` and `getBaseline() === 13`.
2. **The bar's layout manager does not stretch.** A constructed `StatusBar`'s layout manager reports `isStretching() === false`. Direct regression guard for the three deleted calls.
3. **The bar holds one flat row.** `getComponents()` on a fresh `StatusBar` has length 2 — the message `Text` then the flex `Spacer` — and contains no intermediate `Container`. Guards the flattening against a partial revert to zones.
4. **`addLeft` inserts before the pivot; `addRight` appends after it.** After `addLeft(a)` and `addRight(b)`, the child order is `[messageText, a, spacer, b]`. This is the ordering contract the flattened shape rests on.
5. **THE REPORTED BUG — every baseline-bearing widget shares a baseline.** Build the sqladmin composition: `setMessage('Hello')`; `addRight` an identity widget (`new Component({layoutManager: new HBox({spacing:6}), components:[new Glyph('unicode-arrow-up'), new Text('user')]})`); `setWidth(400)`; `setHeight(21)`; `doLayout()`. Then for the message `Text` and the identity widget's inner `Text`, `component.getY() + …ancestor offsets… + component.getBaseline()` must be **equal — 16 for both**. Fails before the change (16 vs 13), passes after.
6. **THE NO-CLIPPING REQUIREMENT — no widget may cross the bar's bottom edge.** With the composition from behaviour 5 **plus** a `Button({glyph:'unicode-arrow-up', flat:true, compact:true})` carrying `pinGlyphSize(14)`, after `doLayout()` **every** child satisfies `y + height <= 21`. Measured: message `0..21`, identity `3..19`, button `0.5..20.5`. Assert the invariant across all children by iteration, not three hard-coded rows, so a future widget cannot silently reintroduce a clip. **This is the regression guard for the bug this rewrite exists to fix** — it fails at 25 (nested, un-stretched) and passes at 21 (flattened).
7. **The row wants exactly the band.** For the same composition, the layout manager's `getPreferredSize().height === 21`. Pins the "fits exactly" result and is the earliest tripwire if a widget's metrics drift.
8. **A baseline-less widget is centred in the text line, not top-anchored.** The pinned button from behaviour 6 lands at `y === 0.5` — `max(0, (21 − 20) / 2)`. This is the value that only the flattened shape produces (nested gives `y = 3`), so it distinguishes the two shapes directly.
9. **A glyph-only `Button` reports a null baseline and a 22×22 minimum.** `new Button({glyph:'unicode-arrow-up', flat:true, compact:true})` has `getBaseline() === null` and `getMinSize()` of `22×22`; after `pinGlyphSize(14)` it is `20×20`. Pins why the consumer must pin the glyph, and proves `setPreferredSize` cannot substitute.
10. **An empty message collapses the anchor.** A `Text('')` with `centerInHeight(21)` reports `getBaseline() === null` and `getPreferredSize()` of `0×0`. Pins the documented limitation so a future change to `Text`'s empty-collapse branch surfaces here rather than silently moving the bar's alignment.
11. **The bar stays 22px.** After `doLayout()` at any width, the bar's height is still `STATUS_BAR_HEIGHT`; flattening must not let it grow or collapse.
12. **Message behaviour is untouched.** Every existing test in `tests/component/container/StatusBar.test.ts` — defaults, `setMessage` round-trip, `setDefaultMessage`, `clearMessage`, timed revert via fake timers — passes unchanged. This change is layout-only.

### Manual visual verification

The harness models metrics but not real font rasterisation, so the optical result needs eyes:

- **Demo:** `npm run dev`, open the *Misc* panel, and open the table window built at [src/typescript/MiscPanel.ts:518](src/typescript/MiscPanel.ts#L518) (its `StatusBar` carries a `defaultMessage` and updates on `cellclick`). Confirm the message is vertically centred, is not clipped at the bottom, and does not shift as the message changes length.
- **sqladmin:** log in (Host `sqladmin-db`, not `localhost`). Confirm (a) the right-zone identity badge's username sits on the same baseline as the left-zone message, with the user glyph's ink on that line; (b) **nothing is clipped at the bar's bottom edge** — the specific symptom reported ("top inset present, bottom clipped"). Requires `npm run build:lib` in typescript-ui first — **never** `npm run build`.
- **Theme sweep:** toggle light/dark/classic and confirm alignment holds (the anchor resolves `--ts-ui-line-padding` through the theme). All three themes inherit the same 22px height, so a difference here would indicate a token regression.

---

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — the **whole** suite. Two independent reasons: the `TestDOM` change touches every offline metric consumer (verified: 203 files / 2343 tests pass), and `HBox`/`VBox`/`Grid`/`HFlow` share `computeRowMetrics`, so a stray edit there surfaces across `tests/component/layout/`.
- `grep -n 'setStretching\|_leftZone\|_rightZone' src/typescript/lib/component/container/StatusBar.ts` — zero matches.
- `grep -c 'new HBox' src/typescript/lib/component/container/StatusBar.ts` — exactly **1**.
- `grep -n 'centerInHeight' src/typescript/lib/component/container/StatusBar.ts` — exactly **1** match. It must survive.
- `grep -rn 'stretching\|zone' docs/components/StatusBar.md` — zero matches.
- `grep -rn 'centerInHeight' src/typescript/lib/` — unchanged at `MenuItem.ts` (×4), `PaginationBar.ts`, `VideoPlayer.ts`, `Dialog.ts`, `StatusBar.ts`, plus the definition and example in `Text.ts`. No other call site may be edited: `PaginationBar.ts:96` and `VideoPlayer.ts:609` use the same idiom **correctly** (non-stretching `HBox` + an anchor matching the tallest sibling) and do not share this bug.
- `npm run docs:build` — zero warnings (repo rule for touched public JSDoc).
- Manual checks per *Expected Behaviour → Manual visual verification*.

---

## Documentation Impact

No public API change — no signature, export, or barrel movement; the flattened zones were private. `STATUS_BAR_HEIGHT` stays exported; `STATUS_BAR_BORDER_TOP_WIDTH` and the new `STATUS_BAR_SPACING` stay private.

`docs/components/StatusBar.md` **must** change (step 7): the zone table at `:25-29` documents a structure that no longer exists, and `:31` documents stretching/clamping behaviour that is removed. Both are replaced by the single-row description plus the 21px widget budget.

No sidebar or catalog changes — `docs/components/index.md` and `docs/.vitepress/config.mts` list `StatusBar` by name only. No other page describes the bar's structure: `docs/concepts/performance.md`, `docs/reference/troubleshooting.md`, and `docs/reference/changelog.md` mention it only in passing.

---

## Potential Challenges

- **A stock glyph-only `Button` still clips by 1px.** Measured 22×22 with min 22×22 against a 21px band — pre-existing (it clips today too) and unfixable by layout. Consumers must call `pinGlyphSize(14)`. Documented in step 6; `setPreferredSize` is *not* a substitute (the min floors it back to 22) and unit test 9 pins that.
- **An empty message removes the anchor.** `Text` collapses to `(0,0)` with a `null` baseline regardless of its pinned line height ([Text.ts:405-411](src/typescript/lib/component/input/Text.ts#L405)) — the `minLineHeight` floor applies only in the non-empty branch. Measured: with no message the row wants 20px and the identity widget's baseline sits at 13 instead of 16, so widgets sit 3px higher until the first message arrives. Nothing clips, and it is strictly better than today's permanent misalignment; sqladmin never hits it (`setMessage` at `SqlAdminController.ts:259` precedes `addRight` at `:265`). Consumer mitigation: pass `defaultMessage`. Pinned by unit test 10. Do **not** "fix" it by changing `Text`'s empty-collapse branch — that branch is deliberate ("an empty Text (e.g. the label slot of an icon-only button) must collapse so it doesn't inflate the container and knock the icon off-centre") and is relied on by `Button`, `Label.ts:88`, `IconLabel.ts:142`, `ComboBox.ts:778`, and `list/renderer/Glyph.ts:129`.
- **The `_spacer` pivot must stay a child.** `addLeft` derives its index from `getComponents().indexOf(this._spacer)`. Nothing removes the spacer today, but a future `removeLeft(spacer)`-style call would return `-1` and `insertComponent` would clamp it to 0, silently prepending before the message. If this worries the implementer, guard `addLeft` on `indexOf(...) >= 0`.
- **`getBaseline()` on `Text` forces a measurement.** It calls `calculateSize()` when `_measurementDirty` ([Text.ts:441-447](src/typescript/lib/component/input/Text.ts#L441)), which needs the modelled source installed — call `installTestDOM(CONFIG)` before constructing, as the existing tests do.
- **The existing `StatusBar.test.ts` `CONFIG` has empty `themeVars`.** Geometry tests need the font vars or the anchor maths will not reproduce the documented numbers; use a local config (step 8).

---

## Critical Files

- [src/typescript/lib/component/container/StatusBar.ts](src/typescript/lib/component/container/StatusBar.ts) — the component being flattened.
- [tests/dom/TestDOM.ts:742-773](tests/dom/TestDOM.ts#L742) — `ModelledDOMSource.measureText`, the harness gap fixed in step 1.
- [src/typescript/lib/core/DOM.ts:1619-1667](src/typescript/lib/core/DOM.ts#L1619) — production `measureText`; the behaviour the model must mirror.
- [src/typescript/lib/layout/LayoutManager.ts](src/typescript/lib/layout/LayoutManager.ts) — `nullChildY` (522), `computeRowMetrics` (538), `computeRowHeight` (571): the ascent/descent-from-different-children mechanism behind the clip.
- [src/typescript/lib/layout/HBox.ts](src/typescript/lib/layout/HBox.ts) — `getContentBaseline` (45), the stretching ternary (476-478), `rowChildY` (647).
- [src/typescript/lib/layout/BoxLayout.ts](src/typescript/lib/layout/BoxLayout.ts) — `_stretching = false` default (111), `crossPlacement` (447), `crossAnchorEdge` (485).
- [src/typescript/lib/component/input/Text.ts](src/typescript/lib/component/input/Text.ts) — `getBaseline` (441), the empty-text collapse (405-411), `centerInHeight` (1041).
- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) — `getBaseline` delegation (2687), `insertComponent` (4350), `getComponents` (4503).
- [src/typescript/lib/component/display/PaginationBar.ts:80-96](src/typescript/lib/component/display/PaginationBar.ts#L80) — the correct single-row + anchor idiom this bar becomes; do not edit.
- [tests/component/container/StatusBar.test.ts](tests/component/container/StatusBar.test.ts) and [tests/component/display/ProgressBar.test.ts:129-157](tests/component/display/ProgressBar.test.ts#L129) — the test and layout-driving idioms.
- [ARCHITECTURE.md](ARCHITECTURE.md) — *"No cosmetic insets or padding"* (trace a misplacement to its layout cause — here a disabled baseline pass plus a nesting boundary) and *"Compose before specializing"* (the flatten deletes two containers and two layouts without relocating complexity).

---

## Non-Goals

- **Adding cross-axis centring to `HBox`.** `crossPlacement`'s inert `CENTER` is a documented, deliberate decision affecting every box layout. Shape C fits exactly using the existing baseline pass, so the capability is not needed.
- **Changing `STATUS_BAR_HEIGHT` / `--ts-ui-statusbar-height`.** Both are 22 and in lockstep; the token is set once in `BaseTheme.ts:70` and overridden by no theme. Growing the bar to fit one oversized button would change every `StatusBar` in every app.
- **Resizing consumer widgets from inside `StatusBar`.** The bar documents its 21px budget; reaching into an added widget to shrink it would couple the bar to widget internals.
- **Changing `Text`'s empty-text collapse.** Deliberate, and depended on by icon-only `Button`s plus four renderer classes.
- **Any sqladmin change.** The identity widget already reports a real baseline (measured 13). The `pinGlyphSize(14)` call for the history button belongs to sqladmin's own `notification-history-statusbar` plan.
- **Touching `PaginationBar`, `VideoPlayer`, `MenuItem`, or `Dialog`.** They use `centerInHeight` correctly against a non-stretching single row — the shape this plan moves `StatusBar` toward.
