---
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
---

# CodeEditor Auto-Height Probe Reconciliation and WYSIWYG Surface Cleanup — Implementation Plan

## Overview

`CodeEditor.syncAutoHeight` ([`CodeEditor.ts:838`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L838)) sizes an auto-height editor to its rendered content. On a call where the document or width shape changed, it first commits a *probe height* — the content-only height, written with `this.setHeight(contentDesired)` at [`CodeEditor.ts:924`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L924) — purely so it can measure the horizontal scrollbar's thickness against a content-sized box. It then adds that reserve back and commits the real height. One of the three early-return guards after the reserve is measured, at [`CodeEditor.ts:988`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L988), returns *before* undoing the probe, so the editor is left committed at the probe height — short by exactly the reserve — and fires no `"heightchange"`. The state then locks in permanently. This plan fixes that guard and pins it with a test.

The same subsystem carries a second load-bearing defect: `WysiwygSurface.init` ([`MarkdownEditor.ts:204`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L204)) re-writes the `contenteditable` attribute with a raw `DOM.sink.apply(el, { setAttr: … })` call, bypassing the typed `setContentEditable` setter three methods below it. The override is also dead: the base class already replays the attribute onto the same element handle. Both are removed.

Three smaller items in the same three files ride along: a 26-line rationale comment that two JSDoc cross-references point at but that sits ~140 lines away from where they say it is; a `TABLE_ROW_CLASS` theme entry in [`editorTheme.ts:20`](packages/lib/src/typescript/lib/component/editor/editorTheme.ts#L20) that is stamped onto DOM but has no CSS rule behind it; and `MarkdownEditor`'s constructor ([`MarkdownEditor.ts:365`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L365)), which does not forward `subclassDefaults`.

---

## Architecture Decisions

### The probe commit is reconciled inside the equal-height guard

The equal-height guard — the one at [`CodeEditor.ts:988`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L988), which fires when the newly computed `desired` equals the height the call started at — gains one line, `this.setHeight(desired)`, before its `return`. It emits no `"heightchange"`, because in that branch the height ends where it started, so nothing a consumer tracks has moved.[^why-no-emit]

Only that guard needs the reconciliation. The two guards below it — the growth guard at [`CodeEditor.ts:992`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L992) and the sub-pixel-shrink guard at [`CodeEditor.ts:1012`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1012) — both require `!shapeChanged` (the document/width shape did not change on this call), and the probe commit only happens when `shapeChanged` is true. On those paths the box is still at `previousHeight` and there is nothing to undo.[^guards-audit]

`setHeight` short-circuits when the value is unchanged ([`Component.ts:3935`](packages/lib/src/typescript/lib/core/Component.ts#L3935)), so the new call costs nothing on the no-probe path and needs no `shapeChanged` test wrapped around it.

### `WysiwygSurface.init` is deleted, not rerouted

The override is removed outright rather than being rewritten to call `setContentEditable`. Its stated justification — that at init time a `getElement()`-based setter would miss the element — is factually wrong: `Component.init` passes its own `element` argument straight to `this._elementAttributes.attach(element)` ([`Component.ts:7066`](packages/lib/src/typescript/lib/core/Component.ts#L7066)), and `ElementAttributes.attach` writes the whole retained attribute state onto that passed handle ([`ElementAttributes.ts:122`](packages/lib/src/typescript/lib/core/ElementAttributes.ts#L122)). No `getElement()` call is involved anywhere on that path.[^attach-trace]

The behaviour is already covered by an existing test — [`ElementAttributeReplay.test.ts:47`](packages/lib/tests/core/ElementAttributeReplay.test.ts#L47), *"set before render: attribute is present on the created element"*, which asserts exactly `contenteditable` — so deleting the override restores conformance with ARCHITECTURE.md's *Three non-negotiable rules for every DOM write* ("No call site outside the typed setter … may touch the low-level API") with no behaviour to preserve.

### `TABLE_ROW_CLASS` is deleted rather than given a rule

The dead entry goes, taking the `EDITOR_THEME.tableRow` mapping with it. The read-only `Markdown` viewer this editor is built to match puts no class and no chrome on its `<tr>` at all — `Markdown.appendTableRow` ([`Markdown.ts:1579`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1579)) builds a bare `tr` and styles only the cells — so there is no row-level appearance for the editor to mirror.[^row-chrome]

### `MarkdownEditor` forwards `subclassDefaults` with no defaults constant of its own

The constructor becomes `constructor(value?, options?, subclassDefaults?)` with `super(options, subclassDefaults)`. `MarkdownEditor` declares no `_defaultMarkdownEditorOptions` bag, so there is nothing to spread the subclass bag over; the bare forward is the established shape for that case, used by [`MenuRow.ts:54`](packages/lib/src/typescript/lib/component/container/MenuRow.ts#L54) and [`AbstractInput.ts:68`](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L68) and documented on [`resolveClassDefaults`](packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L75). Do **not** invent a defaults constant to spread.[^no-defaults-bag]

---

## Public API

`MarkdownEditor`'s constructor gains an optional third parameter. Every existing call form stays valid.

```typescript
class MarkdownEditor extends Component<MarkdownEditorOptions> {
    constructor(
        value?: string,
        options?: MarkdownEditorOptions,
        subclassDefaults?: Partial<MarkdownEditorOptions>,
    );
}
```

No other exported signature changes. `MarkdownEditor.setContentEditable` / `getContentEditable` and `WysiwygSurface.setContentEditable` / `getContentEditable` keep their current signatures; the removed `WysiwygSurface.init` is `protected` on a class that is not exported.

---

## Internal Structure

The fixed guard in `syncAutoHeight`, replacing [`CodeEditor.ts:988-990`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L988):

```typescript
if (desired === previousHeight) {
    // The `shapeChanged` branch above committed `contentDesired` as an
    // intermediate probe height, so the horizontal-scrollbar reserve could
    // be measured against a content-sized box. Folding that reserve back in
    // landed on the height this call started at, so there is nothing to
    // report — but the box is still sitting at the probe height, short by
    // the reserve, until this puts it back. No `"heightchange"`: the height
    // did not move, so a consumer that pinned its own chrome to
    // `previousHeight` is already correct. `setHeight` no-ops when the box
    // is already at `desired`, which is the case on the `!shapeChanged`
    // path where no probe was committed.
    this.setHeight(desired);

    return;
}
```

---

## Ordered Implementation Steps

### Phase 1 — the auto-height probe bug (test first)

1. **Add the failing test** to [`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts), inside the existing `describe('CodeEditor autoHeightMaxRows', …)` block, directly after the test named `'measures the horizontal-scrollbar reserve against a content-sized box, not whatever height the box had before this call'` (currently ending at line 382). Follow that test's mocking style exactly — a faked `_view`, a `_scrollElement` from `DOM.sink.createElement('div')`, and `vi.spyOn` on `DOM.source.getScrollMetrics` / `getOffsetSize`. Leave `_contentElement` unset so the fractional-undershoot branch is skipped.

    ```typescript
    it('reconciles the intermediate probe commit when the scrollbar reserve makes the final height equal the height the call started at', () => {
        // Live repro from Markdown's fenced-code upgrade (Markdown.ts:1060,
        // 1081): the wrapper and the editor are both pinned to the
        // placeholder <pre>'s scrollHeight (115) before the first sync. That
        // call measures 100px of real content, commits it as the intermediate
        // probe (so the scrollbar reserve is read against a content-sized
        // box), measures a real 15px horizontal scrollbar, and lands on
        // desired = 115 — exactly the height it started at. The equal-height
        // early return is right about the height but leaves the box at the
        // 100px probe, showing a 15px gap under the block; and because the
        // next call sees an unchanged shape, the growth guard then refuses to
        // correct it, ever.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 5, length: 80 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        // Markdown's mount-time guess, from the placeholder <pre>.
        editor.setHeight(115);

        vi.spyOn(DOM.source, 'getScrollMetrics')
            .mockReturnValueOnce({
                scrollTop: 0, scrollLeft: 0,
                scrollWidth: 600, scrollHeight: 100,
                clientWidth: 500, clientHeight: 115,
            })
            .mockReturnValue({
                scrollTop: 0, scrollLeft: 0,
                scrollWidth: 600, scrollHeight: 100,
                clientWidth: 500, clientHeight: 100,
            });
        // A real, rendered horizontal scrollbar: 15px thick against the
        // content-sized (100px) box.
        vi.spyOn(DOM.source, 'getOffsetSize').mockReturnValue({ offsetTop: 0, offsetHeight: 115 });

        let fireCount = 0;
        editor.on('heightchange', () => { fireCount += 1; });

        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(115);
        // The height never moved from what the call started at, so there is
        // nothing for a consumer to re-pin.
        expect(fireCount).toBe(0);

        // The echo call CodeMirror's own measure pass fires right after: the
        // shape is unchanged, so the growth guard is armed. The height must
        // already be right rather than needing a growth that guard refuses.
        editor.syncAutoHeight();
        expect(editor.getHeight()).toBe(115);
        expect(fireCount).toBe(0);
    });
    ```

    Verify: `npx vitest run tests/component/code-editor.test.ts` from `packages/lib` — the new test fails on the first `expect(editor.getHeight()).toBe(115)`, reporting `100`.

2. **Apply the fix** in [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts): replace the three-line guard at lines 988-990 with the block in `## Internal Structure`. Change nothing else in `syncAutoHeight` — in particular leave the guards at lines 992-994 and 1012-1014 exactly as they are.

    Verify: `npx vitest run tests/component/code-editor.test.ts` — every test in the file passes, including every pre-existing auto-height test.

### Phase 2 — the WYSIWYG DOM-seam violation

3. **Add the replay regression test** to [`packages/lib/tests/component/markdown-editor.test.ts`](packages/lib/tests/component/markdown-editor.test.ts). First add a local `attrsOf` helper beside the existing `wysiwygOf` helper (currently at line 75), copying the shape from [`ElementAttributeReplay.test.ts:22-36`](packages/lib/tests/core/ElementAttributeReplay.test.ts#L22) but typed against the already-imported `RecordingDOMSink`:

    ```typescript
    /** Folds every apply patch for `handle` into the attribute state it produces. */
    function attrsOf(sink: RecordingDOMSink, handle: unknown): Record<string, string> {
        const attrs: Record<string, string> = {};

        for (const w of sink.writes) {
            if (w.op !== 'apply' || w.args[0] !== handle) continue;

            const patch = w.args[1] as { setAttr?: Record<string, string>; removeAttr?: string[] };

            for (const key of patch.removeAttr ?? []) delete attrs[key];
            for (const key of Object.keys(patch.setAttr ?? {})) attrs[key] = patch.setAttr![key];
        }

        return attrs;
    }
    ```

    Then add a new `describe` block immediately after the existing `describe('MarkdownEditor WYSIWYG surface line-height', …)` block:

    ```typescript
    describe('MarkdownEditor WYSIWYG surface contenteditable', () => {
        it('stamps contenteditable="true" onto the surface element through the base attribute buffer', () => {
            // `setContentEditable` caches through `setElementAttribute` during
            // detached construction; `Component.init` replays the buffer onto
            // the handle it is given (Component.ts:7066 ->
            // ElementAttributes.attach), so the surface needs no `init()`
            // override of its own to get the attribute onto its element.
            const editor = new MarkdownEditor('# Hi');
            const surface = wysiwygOf(editor);

            editor.getElement(true);
            const element = surface.getElement(true);

            expect(attrsOf(DOM.sink as RecordingDOMSink, element).contenteditable).toBe('true');
        });
    });
    ```

    Verify: `npx vitest run tests/component/markdown-editor.test.ts` — the new test passes *before* any source change (it is proving the base class already does the work).

4. **Delete the `init` override** in [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts): remove lines 189-214 — the whole JSDoc block starting `/**` at line 189 through the closing `}` of `init` at line 214, plus the blank line separating it from `setContentEditable`'s JSDoc.

5. **Remove the orphaned import** in the same file: delete line 5, `import type { Handle } from "~/core/DOM.js";`. `Handle` had exactly one use, in the deleted override's signature. Leave line 4's `import { DOM } from "~/core/DOM.js";` — `DOM.sink.mountView` at line 269 still needs it.

    Verify: `grep -n 'Handle' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — expect zero matches.

6. **Rewrite `setContentEditable`'s JSDoc** in the same file (the block currently at lines 216-227), dropping the now-dangling `{@link WysiwygSurface.init}` reference and the redundancy note:

    ```typescript
    /**
     * Sets whether this surface's element hosts an editable region. Caches the
     * state in `_contentEditable` and writes the `contenteditable` attribute
     * through `setElementAttribute`, whose buffer replays the value onto the
     * element once one is created — so a call made during detached
     * construction still lands.
     *
     * @param contentEditable - Whether the element is contenteditable.
     * @returns This surface, for method chaining.
     */
    ```

    Verify: `grep -n 'WysiwygSurface.init' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — expect zero matches. Then `npx vitest run tests/component/markdown-editor.test.ts` — the Phase 2 test still passes.

### Phase 3 — hygiene

7. **Move the misplaced rationale comment** in [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts). Cut the 26-line `//` block at lines 112-137 — its first line contains *trusts a height GROWTH only on the call where the* and its last ends *to fix at the source.* — which currently sits at module scope between `SUBPIXEL_HEIGHT_SLOP_PX` and `READONLY_FLASH_MS`, attached to no declaration. Paste it into the class body immediately **above** the JSDoc for `_lastSyncedShape` (that JSDoc currently runs lines 247-254; the field declaration is line 255). Re-indent every line to the class body's four-space level. Change no words. The JSDoc must stay directly adjacent to the declaration, so the moved block goes above the JSDoc, not between it and the field.

    Verify: `grep -n 'SUBPIXEL_HEIGHT_SLOP_PX = \|trusts a height GROWTH\|_lastSyncedShape' packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — expect one `trusts a height GROWTH` match (the moved block's first line), reported *after* the `SUBPIXEL_HEIGHT_SLOP_PX` constant and immediately before the first `_lastSyncedShape` match, and five `_lastSyncedShape` matches in total (the declaration, two cross-references, and two uses inside `syncAutoHeight`).

8. **Delete the dead theme entry** in [`packages/lib/src/typescript/lib/component/editor/editorTheme.ts`](packages/lib/src/typescript/lib/component/editor/editorTheme.ts): remove the `TABLE_ROW_CLASS` constant declaration at line 20 and the `tableRow: TABLE_ROW_CLASS,` entry in `EDITOR_THEME` at line 207. Add no `StyleRule`. Touch no other constant or rule.

    Verify: `grep -rn 'TABLE_ROW_CLASS\|ts-ui-mde-table-row' packages/lib/src packages/lib/tests packages/docs/src` — expect zero matches.

9. **Forward `subclassDefaults`** in [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) (constructor at line 365 before Phase 2's deletions shift it). Change the signature and the `super` call, and add the matching `@param` line to its JSDoc, wording it the same way [`CodeEditor.ts:274-276`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L274) does:

    ```typescript
    /**
     * Constructs a Markdown editor.
     *
     * @param value - Initial Markdown source (optional; defaults to `""`).
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(value?: string, options?: MarkdownEditorOptions, subclassDefaults?: Partial<MarkdownEditorOptions>) {
        super(options, subclassDefaults);
    ```

    Leave the rest of the constructor body untouched.

### Phase 4 — changelog and full verification

10. **Add the changelog entry** to [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) (currently the header prose only, no sections). Text in `## Documentation Impact`.

11. **Run the full suite** — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorTheme.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### `syncAutoHeight` probe reconciliation (unit-testable)

The repro, as the sequence of two calls Phase 1's test drives. `reserve` is the measured horizontal-scrollbar thickness; `desired` is `contentDesired + reserve`.

| Call | Shape | `previousHeight` | `contentDesired` | Probe commit | `reserve` | `desired` | Committed today | Committed after the fix |
|---|---|---|---|---|---|---|---|---|
| 1 (first sync) | new | 115 | 100 | 100 | 15 | 115 | **100** — returns at the equal-height guard, probe never undone | **115** |
| 2 (CodeMirror echo) | unchanged | 100 today / 115 fixed | 100 | none | 15 | 115 | **100** — growth guard rejects 115 > 100 | **115** — equal-height guard, box already there |

- Neither call emits `"heightchange"`: `desired` equals `previousHeight` on both, so the height a consumer tracks never moves.
- The unchanged-shape guards keep their current behaviour: a growth against an unchanged shape is still rejected, and a sub-pixel shrink against an unchanged shape is still ignored.
- Every existing test in `describe('CodeEditor autoHeightMaxRows', …)` (currently lines 163-842) must still pass unmodified. The fix is a strict no-op for all of them: each either never reaches the equal-height guard, or reaches it with the box already at `desired`.

### `WysiwygSurface` contenteditable (unit-testable)

- A freshly constructed `MarkdownEditor`'s WYSIWYG surface, once rendered, carries `contenteditable="true"` on its element — written by the base class's attribute buffer, with no `init` override present.
- `MarkdownEditor.getContentEditable()` still returns `true` by default and round-trips through `setContentEditable` (already covered by the existing test at [`markdown-editor.test.ts:127`](packages/lib/tests/component/markdown-editor.test.ts#L127)).

### `MarkdownEditor` constructor (unit-testable)

- `new MarkdownEditor('# Title')` and `new MarkdownEditor(undefined, { value: '# From options', readOnly: true })` behave exactly as today — the third parameter is optional and unused by any current caller.

### Manual verification

- **The code-block gap.** Run `npm run docs:dev` and open a docs page whose fenced code block is wide enough to render a horizontal scrollbar (any `packages/lib/docs/components/*.md` page with a long code line). Confirm there is no strip of empty wrapper background between the bottom of the editor's scrollbar and the end of the block. This is the user-visible symptom of the `:988` bug and cannot be checked offline — `CodeEditor` never mounts a live CodeMirror view under the test sink.
- **The WYSIWYG surface stays editable.** `MarkdownEditor`'s live `contenteditable` view only attaches in a browser. Confirm typing still works on the WYSIWYG surface after the `init` override is removed.
- **Editor table rows still render.** With `TABLE_ROW_CLASS` gone, confirm a table inserted in the WYSIWYG editor still shows its cell borders and padding (which come from the cell rules, not the row).

---

## Verification

From `packages/lib` unless noted:

1. `npx vitest run tests/component/code-editor.test.ts` — all pass, including the new probe-reconciliation test.
2. `npx vitest run tests/component/markdown-editor.test.ts` — all pass, including the new contenteditable-replay test.
3. `npm run typecheck` and `npm run typecheck:test` — clean. Catches a stale `Handle` reference if step 5 removed the import while a use remains.
4. `npm run lint` — clean. The `local/no-raw-dom` rule has an empty baseline; removing a `DOM.sink` call site cannot regress it, but the run also confirms no unused import survives.
5. `grep -rn 'TABLE_ROW_CLASS\|ts-ui-mde-table-row' packages/lib/src packages/lib/tests packages/docs/src` — zero matches.
6. `grep -n 'Handle\|WysiwygSurface.init' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — zero matches.
7. `npm run test` (repo root) — the full suite, green.
8. `npm run docs:api` (repo root) — finishes with **zero** warnings. Required by CODE_CONVENTIONS.md whenever public JSDoc changes; step 9 adds a `@param` to a public constructor and step 6 removes a `{@link}`.
9. The three manual checks in `## Expected Behaviour`.

---

## Documentation Impact

- **`MarkdownEditor`'s constructor** gains a third parameter, rendered into the API reference by TypeDoc from the source JSDoc — step 9 adds the `@param subclassDefaults` line, so no separate docs edit is needed. [`packages/lib/docs/components/MarkdownEditor.md`](packages/lib/docs/components/MarkdownEditor.md) shows only `new MarkdownEditor('# Title', { … })` call forms, which stay valid; do not edit it.
- **`{@link WysiwygSurface.init}` is removed** by step 6. `WysiwygSurface` is not exported, so the link renders nowhere today — but leaving it pointing at a deleted method would be a dangling reference.
- **`packages/lib/docs/reference/changelog/next.md`** — add a `## Fixed` section (the page currently has none) with:
  - **`### Components`** — *A fenced code block in a rendered `Markdown` document no longer leaves a strip of empty space below itself when the block shows a horizontal scrollbar. `CodeEditor`'s auto-height pass committed an intermediate measurement height and, on one path, returned without putting the height back; the gap then persisted for the life of the block.*

---

## Potential Challenges

- **The moved comment must not be reworded.** Step 7 is a pure relocation — two JSDoc cross-references depend on the block's content as well as its position. Cut and paste, re-indent, change nothing else.
- **Line numbers shift between phases.** Phase 2 deletes ~27 lines from `MarkdownEditor.ts` before step 9 edits the constructor, and step 7 moves 26 lines within `CodeEditor.ts`. Locate each edit by the symbol name given, not by the line number cited.
- **The Phase 2 test passes before the source change.** That is intentional, not a sign the test is wrong — it is proving the base class already carries the behaviour the override duplicated. Do not "fix" it into a failing test.
- **Which `getScrollMetrics` value is the once-value matters** in the Phase 1 test. The queued once-value (`clientHeight: 115`, the box's pre-probe height) serves the first read; the default (`clientHeight: 100`, the content-sized box) serves the post-probe read and every later call. Swapping which of the two carries `clientHeight: 100` makes the reserve come out at zero and the repro disappears.

---

## Critical Files

Read before implementing:

- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) — `syncAutoHeight` (line 838) and its three early-return guards; the orphaned comment block (lines 112-137); `_lastSyncedShape` (line 255); the constructor at line 278, which is the `subclassDefaults` precedent for step 9.
- [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — `WysiwygSurface`'s constructor (line 163, itself a correct `subclassDefaults` forward), its `init` override (line 204) and `setContentEditable` (line 228); `MarkdownEditor`'s constructor (line 365).
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `setElementAttribute` (line 1663), `setHeight`'s unchanged-value short circuit (line 3935), `init`'s `_elementAttributes.attach(element)` (line 7066), `render`'s `this.init(element)` (line 7169).
- [`packages/lib/src/typescript/lib/core/ElementAttributes.ts`](packages/lib/src/typescript/lib/core/ElementAttributes.ts) — `attach` (line 122), which writes onto the passed handle.
- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts) — `applyCodeEditorUpgrade` (line 1031, the mount-time height guess and the wrapper pin), `handleCodeEditorHeightChange` (line 1096), `appendTableRow` (line 1579, the viewer's unstyled `<tr>`).
- [`packages/lib/src/typescript/lib/component/container/MenuRow.ts`](packages/lib/src/typescript/lib/component/container/MenuRow.ts) — line 54, the `super(options, subclassDefaults)` shape for a class with no defaults constant.
- [`packages/lib/tests/core/ElementAttributeReplay.test.ts`](packages/lib/tests/core/ElementAttributeReplay.test.ts) — lines 22-55, the `attrsOf` helper and the existing proof that a pre-render attribute lands on the created element.
- [`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts) — lines 343-382, the mocking style the new test copies.

---

## Non-Goals

- **Restructuring `syncAutoHeight`'s three guards into one condition.** The comment blocks attached to each guard are load-bearing records of live-reproduced failures; merging the conditions would strand them. The fix is one line inside one guard.
- **Changing how `Markdown` pins its code-block wrapper.** `handleCodeEditorHeightChange` is correct given a correct `"heightchange"` contract; the defect is on the `CodeEditor` side and is fixed there.
- **Adding any row-level styling to the WYSIWYG editor's tables.** The read-only viewer has none; matching it is the point.
- **Giving `MarkdownEditor` a `_defaultMarkdownEditorOptions` bag.** It defaults no fields today, and inventing a constant to spread would be speculative.
- **Testing `CodeEditor`'s live CodeMirror mount or `MarkdownEditor`'s live Lexical view.** Both are foreign live widgets that never attach under the test sink; they stay in the manual-verify section.

---

## Notes

[^why-no-emit]: On this path `desired === previousHeight`, so the editor's height ends the call exactly where it started. `"heightchange"` exists so a consumer can re-pin chrome it sized to the editor — `Markdown.handleCodeEditorHeightChange` re-pins the `ts-ui-md-code-host` wrapper. That wrapper was pinned to `previousHeight` when the editor was created (`Markdown.ts:1060` sets the editor's height, `Markdown.ts:1081` the wrapper's, both from the placeholder `<pre>`'s `scrollHeight`), so it is already correct and an event would ask it to write back the value it holds. Emitting would also spend `applyCodeEditorUpgrade`'s one-shot `correctionWarned` flag (`Markdown.ts:1062-1076`) on a zero-delta event, so a genuine later correction would go unreported.

[^guards-audit]: All three guards were checked against the probe commit at `CodeEditor.ts:924`, which is inside `if (shapeChanged)`. `:992` reads `if (desired > previousHeight && !shapeChanged)` and `:1012` reads `if (desired < previousHeight && !shapeChanged && previousHeight - desired < 1)` — both can only fire when `shapeChanged` is false, i.e. when no probe was committed and `this.getHeight()` is still `previousHeight`. `:988` is the only guard with no `shapeChanged` term, and so the only one reachable after a probe. Adding `this.setHeight(desired)` to the other two would be a permanent no-op.

[^attach-trace]: Traced end to end. `WysiwygSurface`'s constructor calls `setContentEditable(true)` from its own body (after `super()` returns, so no cascade trap). That calls `Component.setElementAttribute` (`Component.ts:1663`), which stores into `ElementAttributes` — never touching `getElement()`. At render, `Component.render` creates the element and calls `this.init(element)` with that handle (`Component.ts:7169`); `Component.init` forwards the same handle to `this._elementAttributes.attach(element)` (`Component.ts:7066`); `ElementAttributes.attach` writes the whole retained state onto the handle it was passed via `DOM.sink.apply(handle, { setAttr })` (`ElementAttributes.ts:122-133`). The override's JSDoc claim about `getElement()` describes a mechanism that is not on this path at all.

[^row-chrome]: `Markdown.appendTableRow` (`Markdown.ts:1579`) creates a bare `tr` and adds classes only to the `th`/`td` children — the viewer's borders, padding, and alignment all live on the cells. The editor's own `editorTheme.ts` mirrors that: `TABLE_CELL_CLASS` and `TABLE_CELL_HEADER_CLASS` carry border and padding, `TABLE_CLASS` carries `border-collapse`. A row rule would have nothing to declare. The original `plans/implemented/markdown-tables.md` (step 8) called for four rules including a row one; three were written and the fourth was not, which is consistent with there being no declaration to give it. Repo-wide grep confirms nothing — no CSS, no test, no demo — selects `.ts-ui-mde-table-row`.

[^no-defaults-bag]: `resolveClassDefaults` (`ComponentDefaults.ts:75`) caches the frozen defaults bag per class constructor and treats `undefined` `subclassDefaults` as "nothing to overlay", so `super(options, subclassDefaults)` is complete for a class that defaults no fields of its own. `MenuRow`, `RadioMenuRow`, `CheckboxMenuRow`, and `AbstractInput` all use exactly this shape. The alternative — adding an empty `_defaultMarkdownEditorOptions` constant purely so the spread pattern could be copied from `CodeEditor` — adds a constant with no members and a cache key that varies for no reason.

---

## Implementation Notes

- **The changelog's `## Fixed` section already existed.** The plan's Documentation Impact section called for adding a `## Fixed` section "the page currently has none" — true when the plan was written, but this branch is stacked on top of several already-implemented plans (`credential-field-and-input-updateheight-dedup`, `menu-row-boolean-input-extraction`, and others) that landed their own `## Fixed` entries in `next.md` first, including an existing `### Components` subsection. The one planned bullet (the fenced-code-block gap) was appended to that existing `### Components` subsection instead of creating a duplicate header — same content, same place a fresh `## Fixed` section would have put it.
- **The three manual-verify checks in `## Expected Behaviour` were performed, not just documented.** `packages/lib`'s `node_modules` was symlinked from the main tree into the worktree (redirecting only the `@jimka/typescript-ui` entry to this worktree's own `packages/lib`, per the project's own worktree/dev-server conventions), `npm run build:lib` produced a fresh `dist/`, and both `npm run docs:dev` and the demo app (`npm run dev` in `packages/lib`) were launched and driven live via the Chrome DevTools MCP tools.
  - **Code-block gap:** `packages/lib/docs/components/ProgressSpinner.md`'s "Case 2" TypeScript block (line 88, 112 chars) renders with a genuine horizontal scrollbar under `docs:dev` (`.cm-scroller` measured `scrollWidth: 762` vs `clientWidth: 613`, `offsetHeight - clientHeight = 15px` reserve). The `.ts-ui-md-code-host` wrapper's rendered height matched the editor's exactly (`gap: 0`) — the bug's fingerprint (a wrapper 15px taller than the editor) did not appear. Confirmed both by DOM measurement and a screenshot: the scrollbar sits flush against the bottom of the code block's shaded background, no strip of empty space beneath it.
  - **WYSIWYG stays editable:** the demo app's "MD Editor" tab (`http://localhost:8015/#/md-editor`, backed by `MarkdownEditorPanel.ts`) was clicked into and typed into directly. The keystrokes landed in the Lexical document and the read-only `Markdown` preview panel on the right updated live to the identical text — confirming the surface still accepts input with the `init()` override removed.
  - **Editor table rows still render:** the same MD Editor demo's built-in table ("Column | Aligned" header, "Tables | yes" row) showed normal cell borders and padding in both the WYSIWYG editor and the read-only viewer, matching before/after the `TABLE_ROW_CLASS` removal — visually confirmed via screenshot.
  - Both dev servers were stopped and the browser tabs closed afterward; `node_modules` and `dist/` are gitignored, so none of this setup is tracked or left as a diff.
