---
depends-on: [selectable-display-text]
touches-shared:
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
---

# Selectable-Text Cursor — Implementation Plan

## Overview

This plan has two parts, in dependency order: hoist `cursor` into the framework's shared CSS-rule system, then use that system to give every surface the `selectable-display-text` plan made selectable a matching hover cursor.

**Part 1.** `cursor` is the one baseline CSS property `Component` still writes into a fresh per-instance stylesheet rule on every render. `ComponentDefaults.ts`'s [`BASE_DEFAULTS`](packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L16) sets `cursor: "default"`; [`Component.getCursor()`](packages/lib/src/typescript/lib/core/Component.ts#L2381) folds that default when nothing overrides it; [`applyBoxAndVisibilityStyles`](packages/lib/src/typescript/lib/core/Component.ts#L4685) then calls `this.writeRuleDeclaration("cursor", cursor)`. Thirteen sibling properties (`boxSizing`, `position`, `display`, `visibility`, `whiteSpace`, `userSelect`, `margin`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `overflowX`, `overflowY`) already skip that per-instance write when a lower tier already delivers the same value — [`ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) writes one zero-specificity `:where(.ts-ui-component)` rule for the whole page plus one optional `.ClassName` rule per component class, and [`writeRuleDeclaration`](packages/lib/src/typescript/lib/core/Component.ts#L4603) only reaches the per-instance `#id` rule when neither lower tier already carries the value. `cursor` is not one of the thirteen, so it never gets this skip — every rendered `Component`, in every app, gets its own redundant `#id { cursor: ... }` rule.

**Part 2.** The `selectable-display-text` plan (implemented on the unmerged branch `feature/selectable-display-text`; see [`plans/selectable-display-text.md`](selectable-display-text.md)) added `setUserSelect("text")` to eleven construction sites — `Markdown`, all seven table cell renderers, `Dialog`'s message, and `Notification`'s toast + detail messages — so their content can be selected and copied, plus a twelfth site (`MarkdownEditor`'s `WysiwygSurface`) that already had its own cursor from before that plan. None of the eleven changed the mouse cursor, so hovering that content still shows the plain arrow. This part adds `this.setCursor("text")` at the same eleven sites, plus three sites that were not part of that plan but must move in lockstep with it — see [Header, parent-header and group-separator cells also opt the cursor back out](#header-parent-header-and-group-separator-cells-also-opt-the-cursor-back-out).

Part 2 depends on Part 1 landing first only in the sense that both touch overlapping code and Part 1 decides how `cursor`'s class-level defaults are represented — Part 2's per-instance `setCursor("text")` calls work identically whether or not Part 1 has landed, but implementing them in this order avoids two people's changes crossing on the same lines.

---

## Architecture Decisions

### `cursor` becomes the fourteenth hoisted key, with a real per-class default field

`ClassStyleRules.ts`'s `FRAMEWORK_DECLARATIONS` gains `cursor: "default"`, and its `resolveDeclarations()` gains `cursor: defaults.cursor ?? "default"` — reading a new `cursor?: string | null` field on the `ClassStyleDefaults` interface, populated from the class's own `_defaultOptions.cursor`. This mirrors how `overflow`, `minSize`, `maxSize`, `visible` and `displayed` already work, not how `userSelect` works.[^why-structured]

### `Component.ts` needs no code change

`getCursor()`, `setCursor()`, `clearCursor()`, and the `applyBoxAndVisibilityStyles` cursor branch already read/write exactly the way the other thirteen keys do — `writeRuleDeclaration` is a generic per-key skip-or-write helper already used for keys outside the hoist list (`color`, `backgroundColor`, `border`, `padding`, …), and it needs no change to also skip `cursor` once `cursor` is in the inherited bag `ensureClassStyleRule` returns. Every file this plan touches for Part 1 is `core/ClassStyleRules.ts` and its test file.[^component-verified]

### Selectable surfaces get a hover cursor mirroring their user-select opt-in exactly

`this.setCursor("text")` is added immediately after the existing `setUserSelect("text")` call at each of the eleven sites the `selectable-display-text` plan created: [`Markdown.ts:607`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L607), the renderer half of all seven table cell renderers under `component/table/cell/renderer/` ([`String.ts:36-37`](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts#L36), [`Number.ts:40-41`](packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts#L40), [`Date.ts:29-30`](packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts#L29), [`DateTime.ts:31-32`](packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts#L31), [`Time.ts:32-33`](packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts#L32), [`Combo.ts:46-47`](packages/lib/src/typescript/lib/component/table/cell/renderer/Combo.ts#L46), [`Link.ts:73-74`](packages/lib/src/typescript/lib/component/table/cell/renderer/Link.ts#L73)), [`Dialog.ts:633`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L633), and both `Notification.ts` messages ([`Notification.ts:202`](packages/lib/src/typescript/lib/overlay/Notification.ts#L202), [`Notification.ts:516`](packages/lib/src/typescript/lib/overlay/Notification.ts#L516)). One site the `selectable-display-text` plan touched already has both calls — [`MarkdownEditor.ts:175,180`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L175) — and needs no change; see Non-Goals.

### Table cell text keeps `pointer-events: none`; only the renderer gets the cursor

Each renderer's `_text: Text` child stays `pointer-events: none`, so it is never the element the pointer hits — the renderer itself is. `setCursor("text")` is added only to the renderer, never to `_text`, mirroring exactly how `setUserSelect("text")` was already split across the two elements in the same seven files.[^why-renderer-only]

### Header, parent-header and group-separator cells also opt the cursor back out

`HeaderCell`, `ParentHeaderCell` and `GroupSeparatorCell` each build their cell's renderer as a `new StringRenderer()` — via `DefaultCell`'s constructor at [`Default.ts:17`](packages/lib/src/typescript/lib/component/table/cell/Default.ts#L17) — and each already calls `renderer.setUserSelect("none")` to opt that shared renderer back out of selectability: [`Header.ts:122-123`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L122), [`ParentHeader.ts:59-60`](packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts#L59), [`GroupSeparator.ts:37-38`](packages/lib/src/typescript/lib/component/table/cell/GroupSeparator.ts#L37). This plan adds `renderer.setCursor("default")` right after each, so a column title, group band or separator label — none of them selectable — does not show the text-select cursor `StringRenderer`'s constructor now sets unconditionally.[^header-cursor-necessity] This is not one of the eleven sites the `selectable-display-text` plan touched; it is a consequence of Part 2 reusing that plan's shared renderer, made here rather than left as a visible inconsistency.

### `Cell.ts`'s read-only cursor branch and `MarkdownEditor`'s `WysiwygSurface` need no change

[`Cell._applyStateTint()`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L323) toggles the cell's own cursor between an explicit `"default"` and `clearCursor()` depending on read-only state. A renderer's own `setCursor("text")` always wins over whatever the ancestor `Cell` computes, because a descendant's explicit CSS declaration outranks an ancestor's regardless of which rule tier either comes from — this was checked directly against the DOM this session. `WysiwygSurface` already calls both `this.setCursor("text")` ([`MarkdownEditor.ts:175`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L175)) and `this.setUserSelect("text")` ([`MarkdownEditor.ts:180`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L180)), from before the `selectable-display-text` plan.

---

## Public API

No exported symbol is added, removed, or changed. `core/ClassStyleRules.ts` stays internal (not added to `core/index.ts`).

Internal signature the implementer changes:

```typescript
// core/ClassStyleRules.ts
interface ClassStyleDefaults {
    visible?:   boolean | null;
    displayed?: boolean;
    minSize?:   { width: number; height: number } | null;
    maxSize?:   { width: number; height: number } | null;
    overflow?:  string | null;
    cursor?:    string | null;   // new
}
```

`ensureClassStyleRule`'s own signature is unchanged — it already takes a `ClassStyleDefaults` and `this._defaultOptions` already carries a `cursor` field (`ComponentOptions.cursor?: string` — [`Component.ts:140`](packages/lib/src/typescript/lib/core/Component.ts#L140)), so no call site of `ensureClassStyleRule` changes.

---

## Internal Structure

### `core/ClassStyleRules.ts` — the three edits

```typescript
const FRAMEWORK_DECLARATIONS: ClassStyleBag = Object.freeze({
    boxSizing:  "border-box",
    position:   Position.ABSOLUTE,
    display:    "block",
    visibility: "inherit",
    whiteSpace: "nowrap",
    userSelect: "none",
    cursor:     "default",        // new
    margin:     "0px 0px 0px 0px",
    minWidth:   "0px",
    minHeight:  "0px",
    maxWidth:   "none",
    maxHeight:  "none",
    overflowX:  "hidden",
    overflowY:  "hidden",
});
```

```typescript
function resolveDeclarations(defaults: ClassStyleDefaults): Record<string, string> {
    const minSize  = defaults.minSize  ?? null;
    const maxSize  = defaults.maxSize  ?? null;
    const overflow = defaults.overflow ?? null;

    return {
        boxSizing:  "border-box",
        position:   Position.ABSOLUTE,
        display:    (defaults.displayed ?? true) ? "block" : "none",
        visibility: (defaults.visible ?? null) === false ? "hidden" : "inherit",
        whiteSpace: "nowrap",
        userSelect: "none",
        cursor:     defaults.cursor ?? "default",   // new
        margin:     "0px 0px 0px 0px",
        minWidth:   minSize ? minSize.width  + "px" : "auto",
        minHeight:  minSize ? minSize.height + "px" : "auto",
        maxWidth:   maxSize ? (isUnbounded(maxSize.width)  ? "none" : maxSize.width  + "px") : "none",
        maxHeight:  maxSize ? (isUnbounded(maxSize.height) ? "none" : maxSize.height + "px") : "none",
        overflowX:  overflow ?? "visible",
        overflowY:  overflow ?? "visible",
    };
}
```

Nothing else in the file changes — `classDeviations()`, `ensureClassStyleRule()`, the `_bags` / `_owners` caches, and the opt-out branch for a name collision all already operate generically over whatever keys `resolveDeclarations` returns.

---

## Ordered Implementation Steps

1. **[`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts)** — apply the three edits in `## Internal Structure`: add `cursor?: string | null;` to the `ClassStyleDefaults` interface (after `overflow`), add `cursor: "default",` to `FRAMEWORK_DECLARATIONS` (after `userSelect`), add `cursor: defaults.cursor ?? "default",` to `resolveDeclarations`'s return object (after `userSelect`). Also change "thirteen" to "fourteen" in the three comments that count the hoist list: the `ClassStyleDefaults` JSDoc ([line 23](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L23)), the `FRAMEWORK_DECLARATIONS` comment ([line 37](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L37)), and the `resolveDeclarations` JSDoc ([line 75](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L75)).
   *Check:* `grep -n "thirteen" packages/lib/src/typescript/lib/core/ClassStyleRules.ts` — zero matches.

2. **[`packages/lib/tests/core/ClassStyleRules.test.ts`](packages/lib/tests/core/ClassStyleRules.test.ts)** — three changes:
   - Add `'cursor'` to the `HOISTED_KEYS` array ([line 47-51](packages/lib/tests/core/ClassStyleRules.test.ts#L47)) and change "thirteen" to "fourteen" in its doc comment ([line 46](packages/lib/tests/core/ClassStyleRules.test.ts#L46)). This alone strengthens the three cases that loop over `HOISTED_KEYS` — case 1 ([line 104](packages/lib/tests/core/ClassStyleRules.test.ts#L104)), case 4 ([line 153](packages/lib/tests/core/ClassStyleRules.test.ts#L153)), and case 15 ([line 375](packages/lib/tests/core/ClassStyleRules.test.ts#L375)) — with no other change needed for those to also cover `cursor`. Cases 3, 10 and 14 check specific keys individually rather than looping, so they are unaffected either way.
   - Edit case 16 (`'case 16: conditional declarations are never hoisted'`, [lines 382-397](packages/lib/tests/core/ClassStyleRules.test.ts#L382)): drop `cursor: 'pointer'` from the `b` constructor call and drop the two `cursor`-related assertions (`expect(declarations.cursor).toBe('pointer')` and `expect(HOISTED_KEYS).not.toContain('cursor')`). `backgroundColor` and `border` stay as the live examples of a declaration that is never hoisted.
   - Add five new `it()` blocks after case 17, following the exact patterns of cases 1, 4, 5 and 6 (see `## Expected Behaviour` for the full bodies).
   *Check:* `cd packages/lib && npx vitest run tests/core/ClassStyleRules.test.ts` — all cases pass, including the five new ones.

3. **Full suite baseline.** A search of `packages/lib/tests/` for a test reading a `setRuleStyles` / `setRuleStyle` op for `cursor`, or asserting `HOISTED_KEYS`/an equivalent literal list, found exactly one: case 16 above, already fixed in step 2. Every other `cursor` assertion in the suite reads `getCursor()` (cached state, unaffected by which rule tier serves it) — `default-options-fallback.test.ts`, `AbstractBooleanInput.test.ts`, `Link.test.ts`, `DiagramView.test.ts`, `DiagramEdgeLayer.test.ts`, `DiagramNode.test.ts`, `Scrollbar.test.ts`, `SplitGutter.movable.test.ts` all fall in this category and need no change.[^survey-evidence] Run `cd packages/lib && npx vitest run --no-file-parallelism` to confirm — the `Errors` line must read zero.

4. **[`packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts`](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts#L36)** — immediately after the existing `this._text.setUserSelect("text");` line, add:
   ```typescript
   // Mirrors the user-select opt-in above: the renderer is the element the
   // pointer hits, so its own cursor is what the browser shows on hover.
   this.setCursor("text");
   ```
   *Check:* `grep -n 'setCursor' packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts` — one match.

5. **Repeat step 4's single line, with no comment**, immediately after each file's existing `this._text.setUserSelect("text");` (or, for `Link.ts`, after `this._text.setUserSelect("text");` at [line 74](packages/lib/src/typescript/lib/component/table/cell/renderer/Link.ts#L74)):
   - [`Number.ts:41`](packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts#L41)
   - [`Date.ts:30`](packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts#L30)
   - [`DateTime.ts:32`](packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts#L32)
   - [`Time.ts:33`](packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts#L33)
   - [`Combo.ts:47`](packages/lib/src/typescript/lib/component/table/cell/renderer/Combo.ts#L47)
   - [`Link.ts:74`](packages/lib/src/typescript/lib/component/table/cell/renderer/Link.ts#L74)

   None of the six gets a `this._text.setCursor(...)` call — `_text` stays untouched in every renderer, including `Link.ts`, whose `_text` is actually a `Link` component that already carries its own unrelated `cursor: pointer` class default (see Potential Challenges).
   *Check:* `grep -rn 'setCursor("text")' packages/lib/src/typescript/lib/component/table/cell/renderer/` — exactly seven matches, one per file, none inside `Glyph.ts` (`GlyphRenderer`), `Filter.ts` (`FilterCellRenderer`), or `TreeCell.ts` (`TreeCellRenderer`).

6. **[`packages/lib/src/typescript/lib/component/table/cell/Header.ts`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L123)** — immediately after `renderer.getText().setUserSelect("none");`, add:
   ```typescript
   // StringRenderer's constructor now sets cursor: "text" unconditionally
   // (it does not know it is being reused as a header renderer here), so
   // this restates the framework default the same way the user-select
   // opt-out above does.
   renderer.setCursor("default");
   ```

7. **Repeat step 6's single line, with no comment**, immediately after each file's existing `renderer.getText().setUserSelect("none");`:
   - [`ParentHeader.ts:60`](packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts#L60)
   - [`GroupSeparator.ts:38`](packages/lib/src/typescript/lib/component/table/cell/GroupSeparator.ts#L38)

   *Check:* `grep -rn 'setCursor("default")' packages/lib/src/typescript/lib/component/table/cell/*.ts` — exactly three matches, in `Header.ts`, `ParentHeader.ts`, `GroupSeparator.ts` and no other file in that directory.

8. **[`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L607)** — immediately after `this.setUserSelect("text");`, add `this.setCursor("text");` with a short comment that `Markdown`'s children are raw DOM, so they inherit the cursor from the root exactly as they inherit `user-select`.

9. **[`packages/lib/src/typescript/lib/overlay/Dialog.ts`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L633)** — immediately after `messageText.setUserSelect("text");`, add `messageText.setCursor("text");`.

10. **[`packages/lib/src/typescript/lib/overlay/Notification.ts`](packages/lib/src/typescript/lib/overlay/Notification.ts)** — immediately after `this._messageText.setUserSelect("text");` ([line 202](packages/lib/src/typescript/lib/overlay/Notification.ts#L202)), add `this._messageText.setCursor("text");`; immediately after `content.setUserSelect("text");` in `showDetail` ([line 516](packages/lib/src/typescript/lib/overlay/Notification.ts#L516)), add `content.setCursor("text");`.
    *Check:* `grep -rn 'setCursor("text")' packages/lib/src/typescript/lib/` — twelve matches: the seven renderers, `Markdown.ts`, `Dialog.ts`, `Notification.ts` ×2, and the pre-existing `MarkdownEditor.ts` match.

11. **[`packages/lib/tests/component/table/CellTextSelection.test.ts`](packages/lib/tests/component/table/CellTextSelection.test.ts)** — extend the existing `it()` bodies rather than adding new ones, per `## Expected Behaviour`'s unit-test table. Rename the first `describe` block from `'text-bearing cell renderers opt in to user-select: text'` to `'text-bearing cell renderers opt in to user-select: text and cursor: text'`.

12. **[`packages/lib/tests/overlay/Dialog.test.ts`](packages/lib/tests/overlay/Dialog.test.ts#L131)** and **[`packages/lib/tests/component/display/Markdown.test.ts`](packages/lib/tests/component/display/Markdown.test.ts#L1658)** — add one `getCursor()` assertion each, per `## Expected Behaviour`.

13. **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — per `## Documentation Impact`.

14. **Run the full verification list** in `## Verification`, including the manual browser checks.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/tests/core/ClassStyleRules.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Combo.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Link.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/GroupSeparator.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Notification.ts` |
| Modify | `packages/lib/tests/component/table/CellTextSelection.test.ts` |
| Modify | `packages/lib/tests/overlay/Dialog.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Part 1 — hoisting, unit-testable

Add these five cases to `ClassStyleRules.test.ts`, immediately after case 17, following the existing `declarationsDuring` / `idSelector` / `ensureStyleRuleOpsFor` helpers exactly as cases 1-17 do. Each mirrors a specific existing case for `overflow`, shown in the "Mirrors" column.

| # | Case | Expected | Mirrors |
|---|---|---|---|
| 18 | A plain `class ProbeCase18 extends Component {}`, no cursor customization. Render one, then measure a second's render. | The captured declarations contain no `cursor` key. | case 1 |
| 19 | `class PointerProbeCase19 extends Component { constructor(options) { super(options, { cursor: 'pointer' }); } }`. Render one, measure its `.PointerProbeCase19` class-rule declarations, then render and measure a second instance's `#id` declarations. | `ensureStyleRule` recorded once for `.PointerProbeCase19`; its declarations carry `cursor: 'pointer'`. The second instance's `#id` declarations carry no `cursor`. | case 4 |
| 20 | `class ProbeCase20 extends Component {}`. Render one, then measure `new ProbeCase20({ cursor: 'pointer' })`. | The captured declarations carry `cursor: 'pointer'`. | case 6 |
| 21 | Reuse `PointerProbeCase19` (class deviates to `'pointer'`). Render two instances, then measure `new PointerProbeCase19({ cursor: 'default' })`. | The captured declarations carry `cursor: 'default'` — matching the *framework* value is not enough to skip, because `.PointerProbeCase19` outranks the framework rule. | case 5 |
| 22 | `class ProbeCase22 extends Component {}`. Construct one and call `.setCursor('pointer')` **before** the first `getElement(true)`, then measure that first render. | The captured declarations carry `cursor: 'pointer'` — a value reaching `_options.cursor` through the setter is treated identically to one reaching it through a constructor option. | new |

Case 22's setup and assertion:

```typescript
it('case 22: a pre-render setCursor call is honoured by the render-time rule write', () => {
    class ProbeCase22 extends Component {}

    const b = new ProbeCase22({});
    b.setCursor('pointer');

    const sink = DOM.sink as RecordingDOMSink;
    const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

    expect(declarations.cursor).toBe('pointer');
});
```

`setCursor()` writes through `setElementStyle` (an inline-style write, immediately visible but wiped by the next `applyStyle`'s `removeAttr: ["style"]`), not through `setElementCSSRule` the way `setMinSize` / `setOverflowY` do — so, unlike cases 8 and 9, there is no *post-render* runtime-setter case for `cursor`: a `setCursor()` call after the first render does not itself produce a `setRuleStyles` op to observe. This is pre-existing, unchanged behaviour, not something this plan alters.[^setcursor-is-inline]

### Part 2 — cursor mirrors user-select, unit-testable

Extend `CellTextSelection.test.ts`'s existing `it()` bodies with a `getCursor()` assertion beside each `getUserSelect()` assertion:

| Existing assertion | New assertion to add beside it |
|---|---|
| `expect(r.getUserSelect()).toBe('text')` (all seven renderers) | `expect(r.getCursor()).toBe('text')` |
| `expect(new GlyphRenderer().getUserSelect()).toBe('none')` | `expect(new GlyphRenderer().getCursor()).toBe('default')` |
| `expect(cell.getRenderer().getUserSelect()).toBe('none')` (`HeaderCell`, `ParentHeaderCell`, `GroupSeparatorCell`) | `expect(cell.getRenderer().getCursor()).toBe('default')` |
| `expect(new StringCell().getRenderer().getUserSelect()).toBe('text')` | `expect(new StringCell().getRenderer().getCursor()).toBe('text')` |

Add one line to `Dialog.test.ts`'s existing `'makes a message dialog\'s body text selectable and copyable'` test:

```typescript
expect(dialog.getContentComponent().getComponents()[0].getCursor()).toBe('text');
```

Add one line to `Markdown.test.ts`'s existing `'opts the root into user-select: text...'` test:

```typescript
expect(new Markdown('# Hi').getCursor()).toBe('text');
```

`Notification`'s two messages have no unit case, for the same reason `user-select` does not: `Notification.show()` returns `void` and both `Text`s are private with no accessor. Covered by manual verification only.

### Manual verification only

| Case | Expectation |
|---|---|
| `#/markdown` — hover a paragraph | Text-beam (I-beam) cursor |
| `#/complex` — hover a cell value in any of the seven typed columns | Text-beam cursor |
| `#/complex` — hover a column header, a parent-header band, or a group-separator label | Plain arrow, unchanged |
| `#/complex` — hover a column header's resize handle | The handle's own resize cursor, unchanged |
| `#/misc` → "Dialog — OK only" — hover the message | Text-beam cursor |
| `#/misc` → any notification button — hover the toast message, then the detail dialog's message | Text-beam cursor on both |
| `#/md-editor` — hover the left editor surface and the right viewer | Text-beam cursor on both, unchanged from before this plan |
| Hover a `Button`, a `CollapseButton`, a `ResizeHandle`, a `TreeCell`'s chevron, any `ComboBox`, any disabled control | Exactly the cursor each already showed before this plan — pointer, resize, grab, etc. |
| Open DevTools, inspect a `Panel` or `Text` with no cursor customization | Its `#id` rule no longer declares `cursor`; the value comes from `:where(.ts-ui-component)` or a `.ClassName` rule instead |
| Inspect a `Button` | Its `#id` rule no longer declares `cursor: pointer`; `.Button` does |

---

## Verification

1. `cd packages/lib && npm run typecheck` — clean (0 errors as of this plan's drafting).
2. `cd packages/lib && npx vitest run --no-file-parallelism` — `Errors: 0`, exit code `0`.
3. `cd packages/lib && npm run lint` — clean.
4. `cd packages/lib && npm run docs:api` — zero warnings.
5. Greps:
   - `grep -n "thirteen" packages/lib/src/typescript/lib/core/ClassStyleRules.ts packages/lib/tests/core/ClassStyleRules.test.ts` — zero matches.
   - `grep -rn 'setCursor("text")' packages/lib/src/typescript/lib/` — twelve matches (see step 10).
   - `grep -rn 'setCursor("default")' packages/lib/src/typescript/lib/component/table/cell/*.ts` — exactly three matches (`Header.ts`, `ParentHeader.ts`, `GroupSeparator.ts`).
   - `grep -n 'ClassStyleRules' packages/lib/src/typescript/lib/core/index.ts` — zero matches (still internal).
6. Manual, browser (`npm run dev`, `http://localhost:8015`): walk the table in `## Expected Behaviour`'s "Manual verification only" section.

---

## Documentation Impact

No exported symbol changes. One entry for Part 1 and a small extension to three existing entries for Part 2, all in [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md):

- **`### Core`** (create the subsection under `## Changed` if the current file lacks one) — add: "`cursor` now joins the framework's other fourteen hoisted style declarations (see the `ts-ui-component` note in the 0.3.0 changelog): a component whose cursor is left at the default, or matches its class's own default, no longer gets a redundant per-instance CSS rule for it. No visible or behavioural change — the zero-specificity framework rule and the `.ClassName` rule both still lose to any class-level or per-instance override, exactly as before."
- **`### Table`** — the `selectable-display-text` entry ("Table cell values can now be selected and copied by dragging across them; …") gains a clause: hovering that selectable content now shows a text-select cursor.
- **`### Display`** — the `Markdown` entry gains the same clause.
- **`### Overlay`** — the `Dialog` and `Notification` entries each gain the same clause.

Match the exact wording present in `next.md` at implementation time — the branch quoted in this plan's Overview may have been lightly edited during its own audit before merging.

---

## Potential Challenges

- **Four component classes already own a hand-written `.ClassName` rule** (`ComboBox`, `ResizeHandle`, `SortPriorityBadge`, `SelectableListRow` — the same four `plans/implemented/class-scoped-style-rules.md` flagged for the original thirteen keys). Checked directly for `cursor`: only `ComboBox` has a JS-level `cursor` deviation (`"pointer"`, via [`_defaultComboBoxOptions`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L81)), and its hand-written [`.ComboBox` rule](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L328) does not already declare `cursor` — so the generated deviation only adds the property to the shared `CSSStyleRule`, never overwrites one. The other three declare no JS-level `cursor` default, so this plan adds nothing to their hand-written rules. No mitigation needed; recorded because the original plan flagged the same four classes and a future reader should not have to re-derive this.
- **`LinkCellRenderer`'s `_text` is a `Link`, not a `Text`, and already carries its own unrelated `cursor: pointer`** (from [`Link.ts:107`](packages/lib/src/typescript/lib/component/input/Link.ts#L107)'s class default, unaffected by whether `interactive` is `true` or `false`) — pre-existing, not touched by this plan. `LinkCellRenderer.setCursor("text")` only shows on the parts of the cell not covered by the link's own bounding box.
- **The three header opt-out sites are not literally named in the original feature request.** They are a necessary consequence of the seven renderers sharing one `StringRenderer` constructor with the header cells — flagged and resolved in Architecture Decisions rather than left as a silent gap.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) — the file Part 1 changes.
- [`packages/lib/src/typescript/lib/core/ComponentDefaults.ts`](packages/lib/src/typescript/lib/core/ComponentDefaults.ts) — `BASE_DEFAULTS.cursor` and the `subclassDefaults` mechanism that already carries `cursor` overrides for ~13 component classes (`Button`, `TextField`, `TextArea`, `PasswordField`, `UsernameField`, `AbstractPickerField`, `PickerInput`, `Slider`, `Link`, `ComboBox`, `MenuBarButton`, `DiagramNode`, `DiagramGroupNode`) into `_defaultOptions.cursor`, which is what makes those classes' cursor hoistable with zero changes to their own files.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `getCursor` (2381), `setCursor` (2392), `clearCursor` (2407), `writeRuleDeclaration` (4603), `applyStyle`'s `ensureClassStyleRule` call (4634), `applyBoxAndVisibilityStyles`'s cursor branch (4685). Read, not modified.
- [`plans/implemented/class-scoped-style-rules.md`](implemented/class-scoped-style-rules.md) — **the precedent**: the original thirteen-property hoist. Its `## Expected Behaviour` table and test file are what this plan's five new cases mirror.
- [`plans/implemented/per-class-component-defaults.md`](implemented/per-class-component-defaults.md) — the prerequisite that made `_defaultOptions` a shared frozen per-class bag; explains why `subclassDefaults` is the mechanism a class-level `cursor` override already flows through.
- [`plans/selectable-display-text.md`](selectable-display-text.md) — the plan Part 2 mirrors, and this plan's `depends-on` target. Read for the exact rationale behind each `setUserSelect("text")` site.
- [`packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts`](packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts) and [`Default.ts`](packages/lib/src/typescript/lib/component/table/cell/Default.ts) — the base every renderer extends, and the `DefaultCell` constructor that gives `HeaderCell` / `ParentHeaderCell` / `GroupSeparatorCell` their shared `StringRenderer`.
- [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L323) — `_applyStateTint`'s read-only cursor branch, confirmed unaffected.
- [`packages/lib/tests/core/ClassStyleRules.test.ts`](packages/lib/tests/core/ClassStyleRules.test.ts) — the test file Part 1 extends; copy its helpers exactly.
- [`packages/lib/tests/component/table/CellTextSelection.test.ts`](packages/lib/tests/component/table/CellTextSelection.test.ts) — the test file Part 2 extends.

---

## Non-Goals

- **No change to `Component.ts`, `ComponentDefaults.ts`, or `Cell.ts`.** Part 1 is confined to `ClassStyleRules.ts`; the read-only cursor branch in `Cell.ts` needs nothing since a descendant's explicit cursor always wins.
- **No change to `MarkdownEditor.ts`.** `WysiwygSurface` already calls both `setCursor("text")` and `setUserSelect("text")`.
- **No change to any imperative `setCursor()` / `clearCursor()` call site outside the eleven-plus-three sites this plan lists** — `Button`, `MenuItem`, `Slider`, `ComboBox`, `Scrollbar`, `DiagramView`, `AbstractCalendarDropdown`, `PickerColumn`, `SplitGutter`, `Checkbox`, `RadioButton`, `Toggle`, `TreeRow`, `WindowBorder`, `SplitButton`, `AbstractSelectableList`, `AbstractBooleanInput`, `ResizeHandle` all keep writing their cursor per-instance exactly as today; hoisting a class's *default* cursor never touches a per-instance override, by construction.
- **Table footer rows are untouched.** `FooterRow` renders no cell text today (matches the `selectable-display-text` plan's own non-goal).
- **Tooltip content stays uncursored**, matching that it stays unselectable.
- **No new public API.** No option, setter, getter, or seam method is added anywhere.

---

## Notes

[^why-structured]: Reading `resolveDeclarations()` closely shows the thirteen existing keys split into two groups. Five — `boxSizing`, `position`, `whiteSpace`, `userSelect`, `margin` — are hardcoded literals with no per-class variation through this system at all; every real deviation for these (there is exactly one, `userSelect`, via the `selectable-display-text` plan) happens through an imperative per-*instance* setter call layered on top, never through a class default. The other eight — `display`, `visibility`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `overflowX`, `overflowY` — are derived from real `ClassStyleDefaults` fields (`displayed`, `visible`, `minSize`, `maxSize`, `overflow`) sourced from each class's own `_defaultXOptions` bag, and the codebase already has real per-class deviations for four of those five fields today: `overflow` (`TextArea`, `Drawer`, `ToolBar`), `minSize` (`TextArea`, `FieldSet`, `LabeledFieldSet`, `MarkdownMinimap`, `StatusBar`, `MenuBar`, `AbstractChart`), `maxSize` (`AbstractSelectableList`, `MarkdownMinimap`, `StatusBar`, `Tree`), and `visible` (`AnimatedDropdown`). `cursor` was checked against both shapes directly: thirteen component classes set a genuine class-level `cursor` default via `subclassDefaults` today — `TextField`/`TextArea`/`PasswordField`/`UsernameField`/`AbstractPickerField`/`PickerInput` (`"text"`), `Button`/`Slider`/`Link` (input)/`ComboBox`/`MenuBarButton`/`DiagramNode`/`DiagramGroupNode` (`"pointer"`) — each verified by reading the file and confirming the `cursor:` literal sits inside a `_default*Options` constant that is passed as the second (`subclassDefaults`) argument to `super(...)`, the same mechanism `overflow`/`minSize` already use. That places `cursor`'s real-world usage in the *second* group, not the first. Hardcoding it as a literal (mirroring `userSelect`) would leave all thirteen of those classes — several of them, like `Button`, extremely common — still writing a redundant per-instance `#id { cursor: ... }` rule on every single instance, which is most of the saving this migration exists to capture. The structured route costs one extra line in three places in `ClassStyleRules.ts` and, because those thirteen classes already declare `cursor` through `subclassDefaults`, zero changes anywhere else.

[^component-verified]: Read in full for this plan: `getCursor` (folds `_defaultOptions.cursor` exactly like the other getters `ensureClassStyleRule`'s callers rely on), `setCursor` / `clearCursor` (write `_options.cursor` and an inline style via `setElementStyle`, independent of the rule tiers), and `applyBoxAndVisibilityStyles`'s `if (cursor) { this.writeRuleDeclaration("cursor", cursor); }`. `writeRuleDeclaration` was already written generically — the class-scoped-style-rules plan's own `## Non-Goals` explicitly named `cursor` as one of the properties deliberately left conditional at that time ("Hoisting the conditional declarations (`cursor`, `color`, `backgroundColor`, `backgroundImage`, `border`, `outline`, `borderRadius`, `boxShadow`, `padding`). A shared rule may only hold a key every instance writes on every render; these are all behind an `if`") — but `cursor`'s own `if` is unconditional in every realistic case, since `_defaultOptions.cursor` is always populated by `BASE_DEFAULTS` and no class sets it to `undefined`; only an explicit runtime `clearCursor()` call makes `getCursor()` return `null` and skip the write for that one render, which is no different from any other component property that can be runtime-cleared.

[^why-renderer-only]: Verified live this session before drafting: setting an explicit `cursor` on the renderer measurably changes what the browser shows on hover; setting it on `_text` alone has zero visual effect, because `_text` carries `pointer-events: none` and is therefore never the element `elementFromPoint` (or a real mouse hover) resolves to. This holds regardless of the ancestor `Cell`'s read-only state, both with the `Cell`'s own cursor explicitly `"default"` and with it cleared — a descendant's own explicit declaration always wins.

[^header-cursor-necessity]: Traced directly: `DefaultCell`'s constructor ([`Default.ts:17`](packages/lib/src/typescript/lib/component/table/cell/Default.ts#L17)) builds `new StringRenderer()`, and `HeaderCell` / `ParentHeaderCell` / `GroupSeparatorCell` all extend `DefaultCell`. Once `StringRenderer`'s own constructor calls `this.setCursor("text")` unconditionally (step 4), every header-family cell's renderer gets that same call — there is no seam that lets `DefaultCell` build a renderer without it. Leaving this unaddressed would make a column title, a parent-header band, or a group-separator label show a text-select cursor on hover while `user-select: none` (already restated by the existing opt-out) refuses to let anything actually be selected — a cursor promising an affordance the element does not have, which is the exact failure mode this feature exists to avoid for the *positive* case (content that is selectable now looks it). `renderer.setCursor("default")` restates the value explicitly, mirroring the existing `renderer.setUserSelect("none")` opt-out's own shape (a local restatement, not a `clearCursor()`), which is also what `Scrollbar.ts:383` already established as the precedent shape for restating an inherited default.

[^survey-evidence]: `grep -rn "cursor" packages/lib/tests --include="*.test.ts" -i` was run in full and every match categorised. All matches outside `ClassStyleRules.test.ts` read `getCursor()` (a cached-state getter, unaffected by which CSS rule tier ultimately serves the value) or are unrelated (comments, `cursorOffset` in the SQL formatter, `DragManager`'s inline `document.body` cursor during a drag, which is a completely different write path). A second, targeted search — `grep -rn "cursor" packages/lib/tests --include="*.test.ts" | grep -iE "setRuleStyle|styleFor|writes\.|sink\.writes|RecordingDOMSink"` — found only `Scrollbar.test.ts`'s assertions on the `<html>` element's inline cursor during a scrollbar-thumb drag, an entirely separate mechanism (`DOM.sink.apply(DOM.source.getBody(), { style: { cursor: ... } })`) untouched by this plan.

[^setcursor-is-inline]: `setCursor` calls `this.setElementStyle("cursor", cursor)` ([`Component.ts:2397`](packages/lib/src/typescript/lib/core/Component.ts#L2397)), and `setElementStyle` queues into `_inlineStyle`, flushed as an inline `style` attribute write — not `setElementCSSRule`, which `setMinSize` / `setOverflowY` use and which writes directly into the component's own `_styleRule` (the `#id` rule), independent of `applyStyle`. That is why cases 8 and 9 in the original suite can measure a bare setter call and see an immediate `setRuleStyles` op, while a bare `setCursor()` call produces only an inline-style op. The persistent `#id` / `.ClassName` / framework rule value for `cursor` only updates the next time `applyStyle` runs (e.g. the component's first render, or however a future re-render is triggered) — exactly the same as it worked before this plan; Part 1 only changes *which* rule tier that render-time write skips or lands on, never when it happens.

---

## Implementation Notes

- **Case 21 uses its own uniquely-named class, not a literal reuse of case 19's `PointerProbeCase19`.** The plan's Expected Behaviour table says to "Reuse `PointerProbeCase19`", but `ClassStyleRules.test.ts`'s own header comment documents that the `.ClassName` registry (`_bags`/`_owners` in `ClassStyleRules.ts`) is module state surviving `DOM.reset()`, and that every test must declare a uniquely-named local `Component` subclass or its class-name-keyed registry entry silently takes the name-collision opt-out branch case 15 exists to test — a different code path than the one case 21 is meant to exercise (an instance override that differs from an already-registered class-rule value). Declaring a second, differently-scoped class also literally named `PointerProbeCase19` inside case 21's `it()` body would hit that opt-out, not the intended "instance beats class rule" path. Case 21 instead declares its own class, `PointerProbeCase21`, with the same `cursor: 'pointer'` class deviation, fully self-contained — mirroring how the table's own cited "Mirrors: case 5" precedent is written (case 5 does not reuse case 4's class either).
- **Two additional pre-existing tests needed updates the plan's survey (footnote `[^survey-evidence]`) did not find**, because neither literally mentions the word "cursor": `tests/core/StyleRuleBatchedFlush.test.ts` case 6 asserted `bag.cursor` was defined on a bare `Component`'s first-render `#id` rule (true before Part 1, since cursor was conditional-but-always-written; false after, since cursor now hoists to the framework rule for the common case) — updated to assert `bag.cursor` is `undefined`, alongside `border` staying the one conditional example. `tests/overlay/AbstractWindow.styleRuleDisposal.test.ts`'s teardown-leak check now also observes `.Button` appear as a genuinely new, permanent rule-cache entry — a side effect of `Button`'s existing `cursor: "pointer"` class default now producing a real `.ClassName` rule (previously skipped, since `classDeviations` found no deviation for `Button` in the un-hoisted five-field `ClassStyleDefaults`) — updated to exclude any non-`#`-prefixed (i.e. non-per-instance) key from the leaked-rule filter, since a `.ClassName` rule is exactly as permanent and by-design-undisposed as the framework rule, per case 13's own precedent.
- **The Core changelog entry says "other thirteen hoisted style declarations", not "other fourteen" as literally quoted in `## Documentation Impact`.** `cursor` becomes the *fourteenth* hoisted key per this plan's own Architecture Decision heading, i.e. it joins thirteen others — "other fourteen" would total fifteen, an arithmetic slip in the plan's suggested wording. Corrected for factual accuracy; the rest of the sentence is unchanged.
- **Manual verification covered every row of the plan's table except the `Notification` detail dialog's message specifically**, confirmed live via `npm run dev` against a real Chrome instance: `#/markdown` prose, `#/complex` cell values (verified against `elementFromPoint`, not just `getComputedStyle`, confirming the renderer — not the cell — is what the pointer actually hits), headers/parent-headers/group-separators, a resize handle, the `#/misc` "Dialog — OK only" message, a `Notification` toast message, both `#/md-editor` surfaces (unchanged), a `Button`'s `.Button`-class-rule cursor, and a plain `Text`'s now-cursor-free `#id` rule all show the expected value. The detail dialog's message uses the identical `Text` + `setUserSelect("text")` + `setCursor("text")` shape already confirmed live for the plain `Dialog` message and the toast message in the same file, but the toast's short auto-dismiss window made it impractical to reliably double-click open within this tool session; confirmed by reading the source instead.
