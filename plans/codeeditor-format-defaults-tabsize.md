---
depends-on: [codeeditor-live-editing-options]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# CodeEditor format() Indent-Width Default from tabSize — Implementation Plan

## Overview

[`CodeEditor.format()`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L900)
takes a per-call `options?: FormatOptions`
([LanguageRegistry.ts:14-37](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts#L14))
bag and forwards it to the active language's formatter unchanged
([CodeEditor.ts:914](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L914)).
`FormatOptions.indentWidth` controls how many spaces the formatter uses per
indent level; an absent field today leaves the formatter's own default alone.
Separately, `getTabSize()`
([CodeEditor.ts:722-724](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L722))
returns the live editor's own tab-stop width — a construction-time /
runtime `CodeEditorOptions` field, `number | null`, unrelated to `format()`
today.

This plan makes `format()` default `indentWidth` from `getTabSize()` when the
caller's `options` omits it and a `tabSize` is actually set, so a reformat's
indent width matches what the live editor already renders. An explicit
`options.indentWidth` always overrides the default, and the default is
inert when `tabSize` is unset — `format()`'s behaviour for every call that
doesn't hit the new case is unchanged. The whole change lives inside
`format()`'s own dispatch: one new private helper method, a one-line call-site
edit, JSDoc on `format()` and on `FormatOptions.indentWidth`, a
`docs/components/CodeEditor.md` update, a changelog entry, and unit tests. No
option, accessor, or other public API is added.

---

## Architecture Decisions

### A new private helper computes the effective options; `format()` calls it in place of the raw argument

`format()` gains a private `resolveFormatOptions(options?: FormatOptions):
FormatOptions | undefined` method, and its formatter-dispatch call
([CodeEditor.ts:914](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L914))
changes from `await formatter(source, cursorOffset, options)` to
`await formatter(source, cursorOffset, this.resolveFormatOptions(options))`.
This mirrors the file's own precedent: `applyFormatted`
([CodeEditor.ts:936](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L936))
and `reindentFallback`
([CodeEditor.ts:969](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L969))
are each already factored out of `format()` specifically so their own decision
logic is unit-testable without a live `EditorView` — their own doc comments
say so in those words. `resolveFormatOptions` is the same move applied to the
new merge decision.[^precedent]

### The merge returns the caller's `options` object unchanged unless a default actually applies

`resolveFormatOptions` builds a new object — `{ ...options, indentWidth:
tabSize }` — **only** when `options?.indentWidth === undefined` and
`getTabSize()` is not `null`. In every other case it returns `options` by
reference, untouched. This is not an optimization; it is required for
correctness. `format()`'s pre-existing test
`'passes format() options through to the formatter as its third argument'`
([code-editor.test.ts:1967-1991](packages/lib/tests/component/code-editor.test.ts#L1967))
asserts `received[1]).toBe(options)` — reference identity — for the
explicit-`indentWidth` case, with the comment `// forwarded by identity, not
copied`. An unconditional `{ ...options, indentWidth: … }` spread always
allocates a new object, even when its contents are identical to the input, so
an unconditional merge would fail that pre-existing, otherwise-unrelated
test.[^identity-test] Because that test's editor never sets `tabSize`, its
three cases end up exercising the "return `options` unchanged" branch either
way, so this plan's implementation makes it pass with **no edit** to that
test.

The rule, worked through the cases this plan's own tests drive (`--` means
the argument is omitted entirely):

| Caller's `options` | `tabSize` | Effective options passed to the formatter | New object? |
|---|---|---|---|
| `--` | unset (`null`) | `--` (still `undefined`) | no — forwarded as-is |
| `{ indentWidth: 2 }` | `8` | `{ indentWidth: 2 }` | no — explicit wins, forwarded as-is |
| `--` | `4` | `{ indentWidth: 4 }` | yes — new object |
| `{ lineWidth: 100 }` | `4` | `{ lineWidth: 100, indentWidth: 4 }` | yes — new object, `lineWidth` kept |
| `{}` | unset (`null`) | `{}` | no — forwarded as-is |

### The default reaches every formatter-backed language; it is inert for `python`

`format()` only ever calls `resolveFormatOptions` on the branch where
`def.loadFormatter` exists
([CodeEditor.ts:904-908](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L904));
a language with no formatter (`python` is the only one today, per
[languages.ts](packages/lib/src/typescript/lib/component/editor/languages.ts))
runs `reindentFallback()` instead, which takes no `options` argument at all —
`docs/components/CodeEditor.md`'s `format()` semantics section already
documents this fallback as "ignoring `options` entirely." For every language
that does have a formatter, `indentWidth` maps onto a real engine option:
both `formatWithPrettier`
([prettier.ts:10](packages/lib/src/typescript/lib/component/editor/formatters/prettier.ts#L10))
and `formatWithSql`
([sql.ts:10](packages/lib/src/typescript/lib/component/editor/formatters/sql.ts#L10))
map `indentWidth` to `tabWidth`, and `PRETTIER_OPTION_NAMES` is one shared
table used by every Prettier-backed language entry (`javascript`, `json`,
`html`, `markdown`, `css`), not a per-parser table. So this default is
meaningful for all six formatter-backed built-in languages — `javascript`,
`json`, `html`, `sql`, `markdown`, `css` — and inert only for
`python`.[^css-table-gap]

### No change to the "no-op skip" mechanism

`applyFormatted`
([CodeEditor.ts:936-960](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L936))
skips its own dispatch when `formatted === this.getValue()`, comparing the
formatter's *output* text against the document, not `options` in any way.
Defaulting `indentWidth` can change what the formatter *produces* — a
document already 2-space indented (Prettier's own default) is no longer a
no-op once `indentWidth` defaults to `8` — but the comparison itself, and
everything else `applyFormatted` does (scroll snapshot, cursor clamp), is
untouched. No code in `applyFormatted` changes.

---

## Internal Structure

```typescript
/**
 * Resolves the effective `FormatOptions` passed to the formatter: an
 * explicit `options.indentWidth` always wins; when it is absent, this
 * editor's own tab-stop width ({@link CodeEditor.getTabSize}) fills it in,
 * if set, so a reformat's indent width matches what the live editor already
 * renders. Returns `options` unchanged — by reference — whenever no default
 * applies, so a caller that never touches `tabSize` sees exactly today's
 * behaviour.
 *
 * Factored out of `format()` so the merge is unit-testable in isolation,
 * mirroring how {@link CodeEditor.applyFormatted} and
 * {@link CodeEditor.reindentFallback} are factored out for the same reason.
 *
 * @param options - The caller-supplied format options, or `undefined`.
 * @returns `options` unchanged when no default applies, or a new object
 *   carrying every field of `options` plus the defaulted `indentWidth`.
 */
private resolveFormatOptions(options?: FormatOptions): FormatOptions | undefined {
    const tabSize = this.getTabSize();

    if (options?.indentWidth !== undefined || tabSize === null) {
        return options;
    }

    return { ...options, indentWidth: tabSize };
}
```

`format()`'s dispatch line changes from:

```typescript
const result = await formatter(source, cursorOffset, options);
```

to:

```typescript
const result = await formatter(source, cursorOffset, this.resolveFormatOptions(options));
```

No other line in `format()` changes.

### The five new `format()` dispatch tests

Added as a new `describe` block in `code-editor.test.ts` (placement: step 6
below). Each registers its own recording formatter under a fresh test
language id and asserts on what it received — the same pattern
`'passes format() options through to the formatter as its third argument'`
([code-editor.test.ts:1967-1991](packages/lib/tests/component/code-editor.test.ts#L1967))
already uses:

```typescript
describe('CodeEditor format() indentWidth default from tabSize', () => {
    const TAB_SIZE_DEFAULT_LANG = 'test-tabsize-default-lang';

    function registerRecordingFormatter(received: (FormatOptions | undefined)[]): void {
        const formatter: Formatter = async (source, _cursorOffset, options) => {
            received.push(options);

            return { formatted: source, cursorOffset: 0 };
        };

        registerLanguage({
            id: TAB_SIZE_DEFAULT_LANG,
            loadExtension: async () => [] as any,
            loadFormatter: async () => formatter,
        });
    }

    it('leaves options.indentWidth undefined when both options and tabSize are unset, unchanged from today', async () => {
        const received: (FormatOptions | undefined)[] = [];
        registerRecordingFormatter(received);

        const editor = new CodeEditor('x', { language: TAB_SIZE_DEFAULT_LANG });

        await editor.format();

        expect(received[0]).toBeUndefined();
    });

    it('an explicit options.indentWidth wins over tabSize, forwarded unchanged', async () => {
        const received: (FormatOptions | undefined)[] = [];
        registerRecordingFormatter(received);

        const editor  = new CodeEditor('x', { language: TAB_SIZE_DEFAULT_LANG, tabSize: 8 });
        const options: FormatOptions = { indentWidth: 2 };

        await editor.format(options);

        expect(received[0]).toEqual({ indentWidth: 2 });
        expect(received[0]).toBe(options);
    });

    it('defaults indentWidth from tabSize when format() is called with no options at all', async () => {
        const received: (FormatOptions | undefined)[] = [];
        registerRecordingFormatter(received);

        const editor = new CodeEditor('x', { language: TAB_SIZE_DEFAULT_LANG, tabSize: 4 });

        await editor.format();

        expect(received[0]).toEqual({ indentWidth: 4 });
    });

    it('preserves the rest of a partial options object alongside the injected default', async () => {
        const received: (FormatOptions | undefined)[] = [];
        registerRecordingFormatter(received);

        const editor  = new CodeEditor('x', { language: TAB_SIZE_DEFAULT_LANG, tabSize: 4 });
        const options: FormatOptions = { lineWidth: 100 };

        await editor.format(options);

        expect(received[0]).toEqual({ lineWidth: 100, indentWidth: 4 });
        expect(received[0]).not.toBe(options);
        expect(options).toEqual({ lineWidth: 100 }); // caller's object is not mutated
    });

    it('forwards an empty options object unchanged when tabSize is unset', async () => {
        const received: (FormatOptions | undefined)[] = [];
        registerRecordingFormatter(received);

        const editor  = new CodeEditor('x', { language: TAB_SIZE_DEFAULT_LANG });
        const options: FormatOptions = {};

        await editor.format(options);

        expect(received[0]).toBe(options);
    });
});
```

---

## Ordered Implementation Steps

Throughout, `TEST` means
`npm -w packages/lib exec -- vitest run tests/component/code-editor.test.ts`.

1. Confirm the dependency has landed: `git log --oneline -1 --
   plans/implemented/codeeditor-live-editing-options.md` on `master` returns
   a commit, and
   `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` already
   has `getTabSize()`. If either check fails, stop — this plan's dependency
   has not actually merged yet.
2. `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — add the
   `resolveFormatOptions` private method exactly as given in `## Internal
   Structure`, placed immediately after `format()`'s closing brace
   ([CodeEditor.ts:917](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L917))
   and before `applyFormatted`'s doc comment
   ([CodeEditor.ts:919](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L919)).
   *Check:* `npm -w packages/lib run typecheck`.
3. Same file — change `format()`'s formatter-dispatch line
   ([CodeEditor.ts:914](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L914))
   from `const result = await formatter(source, cursorOffset, options);` to
   `const result = await formatter(source, cursorOffset,
   this.resolveFormatOptions(options));`.
   *Check:* `TEST` — every pre-existing test in `'CodeEditor format()
   dispatch'` still passes unedited (per *The merge returns the caller's
   `options` object unchanged unless a default actually applies* above, none
   of them sets `tabSize`, so none hits the new branch).
4. Same file — extend `format()`'s doc comment
   ([CodeEditor.ts:874-899](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L874)):
   - Append one sentence to the end of the `@remarks` paragraph (after "…e.g.
     a first-time format of a wholly unformatted file."):
     > When `options` omits `indentWidth` and this editor's own tab-stop
     > width ({@link CodeEditor.getTabSize}) is set, the formatter runs with
     > `indentWidth` defaulted to it; an explicit `options.indentWidth`
     > always overrides this default, and it has no effect when `tabSize` is
     > unset.
   - Extend the `@param options` line from "…re-indent fallback runs
     instead)." to "…re-indent fallback runs instead). An omitted
     `indentWidth` is defaulted from this editor's own `tabSize`, when set —
     see `@remarks`."
5. `packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts` —
   replace `FormatOptions.indentWidth`'s doc comment
   ([LanguageRegistry.ts:15-16](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts#L15))
   from `/** Spaces per indent level. */` to:
   ```typescript
   /**
    * Spaces per indent level. When omitted, {@link CodeEditor.format}
    * defaults this from the editor's own {@link CodeEditor.getTabSize |
    * tabSize}, if set; pass an explicit value to opt out.
    */
   ```
   `{@link CodeEditor}` already appears in this file with no local import
   ([LanguageRegistry.ts:66](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts#L66)) —
   TypeDoc resolves it project-wide, so no import is needed here either.
   *Check:* `npm run docs:api` — 0 errors, 0 link warnings.
6. `packages/lib/tests/component/code-editor.test.ts` — add the
   `describe('CodeEditor format() indentWidth default from tabSize', ...)`
   block given in full in `## Internal Structure`, placed right after the
   `'CodeEditor format() dispatch'` block closes
   ([code-editor.test.ts:1992](packages/lib/tests/component/code-editor.test.ts#L1992)),
   before `describe('sql-formatter cursor clamp', ...)`
   ([code-editor.test.ts:1994](packages/lib/tests/component/code-editor.test.ts#L1994)).
   *Check:* `TEST`.
7. `packages/lib/docs/components/CodeEditor.md` — per `## Documentation
   Impact` below.
8. `packages/lib/docs/reference/changelog/next.md` — add the changelog entry
   from `## Documentation Impact` below.
   *Check:* `npm run docs:api` — 0 errors, 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Unit-testable (offline harness, `packages/lib/tests/component/code-editor.test.ts`)

The five cases given in full in `## Internal Structure` ›
*The five new `format()` dispatch tests*, each a direct instance of one row
of the `## Architecture Decisions` worked-example table: both unset stays
`undefined`; an explicit `indentWidth` wins and is forwarded by reference;
`tabSize` alone (no `options` argument at all) defaults `indentWidth`; a
partial `options` object keeps its other fields, gains the default, and is
not itself mutated; an empty `{}` with `tabSize` unset is forwarded by
reference unchanged.

Also verify unedited: every pre-existing case in `'CodeEditor format()
dispatch'` — none of those editors ever set `tabSize`, so none of them
exercises the new default and all must keep passing exactly as written,
including `received[1]).toBe(options)` at
[code-editor.test.ts:1989](packages/lib/tests/component/code-editor.test.ts#L1989).

### Manual verification only (live-only component; the offline sink never mounts a view)

Run in the dev app (`npm run dev`, `http://localhost:8015`, **CodeEditor**
section). No `CodeEditorPanel.ts` code change is needed — its existing "Tab
size" and "Format" buttons already exercise this:

- With the JavaScript sample untouched (already 2-space indented — Prettier's
  own default), clicking "Format" is a visible no-op, same as before this
  plan.
- Click "Tab size: 4" once (cycles to `8`), then click "Format": the sample
  reformats to 8-space indentation — visible confirmation that `format()`
  picked up `tabSize` with no `indentWidth` passed anywhere in the demo's own
  `formatBtn` handler
  ([CodeEditorPanel.ts:126](packages/lib/src/typescript/CodeEditorPanel.ts#L126),
  unmodified).
- Cycle "Tab size" back toward its other presets and click "Format" again
  each time — the indentation width follows.

---

## Verification

- `npm -w packages/lib run typecheck` — clean.
- `TEST` (`npm -w packages/lib exec -- vitest run tests/component/code-editor.test.ts`)
  — full file green, every pre-existing case passing unedited.
- `npm run docs:api` — 0 errors, 0 link warnings.
- Manual smoke test: the two steps in `## Expected Behaviour` › *Manual
  verification only*, in the dev app's **CodeEditor** section.

---

## Documentation Impact

**`format()`'s own JSDoc and `FormatOptions.indentWidth`'s doc comment.** See
steps 4 and 5 above for the exact replacement text.

**`packages/lib/docs/components/CodeEditor.md`.** Append to the end of the
**Formatting options** section
([CodeEditor.md:109-136](packages/lib/docs/components/CodeEditor.md#L109)),
after the existing closing paragraph that distinguishes `indentWidth` from
`tabSize` (ending "…see [Construction](#construction)."):

```markdown
When a `format()` call omits `indentWidth` and this editor's `tabSize` is
set, `format()` defaults `indentWidth` to it, so a reformat's indent width
matches what the editor already renders — the one place the two options
interact. An explicit `indentWidth` always overrides this default:

| Caller's `options` | `tabSize` | Effective `indentWidth` |
| --- | --- | --- |
| `{ indentWidth: 2 }` | `8` | `2` — explicit wins |
| `{}` or omitted | `4` | `4` — defaulted from `tabSize` |
| `{}` or omitted | unset | unset — today's behaviour, unchanged |

This default reaches every built-in language that has a formatter
(`javascript`, `json`, `html`, `sql`, `markdown`, `css`) — each maps
`indentWidth` onto its own engine's `tabWidth`-equivalent option. `python`
has no formatter at all, so `format()` re-indents instead and `options`
(including this default) never reaches it.
```

No other section of `CodeEditor.md` needs a change: the "`format()`
semantics" section's bullets, the construction options table, and the
methods table are all still accurate — no option or method is added or
renamed.

**`packages/lib/docs/reference/changelog/next.md`.** One bullet under
`## Changed` › `### Components`, appended right after the existing
`tabSize`/`lineNumbers`/`spellcheck` bullet
(the one ending "…which only shapes `format()`'s one-shot reformat output. No
consumer action is needed.") and before the `### Menu` heading:

```markdown
- **`CodeEditor.format()` now defaults `FormatOptions.indentWidth` from the
  editor's own `tabSize` when the caller omits it and `tabSize` is set.** An
  explicit `indentWidth` always wins, and the default is inert when
  `tabSize` is unset — unchanged from before. This keeps a reformat's indent
  width matching what the live editor already renders without requiring
  every caller to pass `tabSize` into every `format()` call by hand. No
  consumer action is needed.
```

**No new export.** `resolveFormatOptions` is a private method; nothing new is
exported from `component/editor`'s barrel.

---

## Potential Challenges

- **The applicability table in "Formatting options" is already missing a
  `css` column** (it lists `javascript` / `json` / `html` / `markdown` /
  `sql` but not `css`, even though `css` has a Prettier-backed formatter).
  This predates this plan — leave it alone; fixing it is a separate, unrelated
  documentation gap.[^css-table-gap]
- **A document that already matches the defaulted formatter's output is
  still a no-op.** E.g. an 8-space-indented file with `tabSize: 8` and no
  explicit `indentWidth`: the formatter reproduces the same text,
  `applyFormatted`'s existing `formatted === this.getValue()` check still
  skips the dispatch, and this plan changes nothing about that path — see
  *No change to the "no-op skip" mechanism* above.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) | `format()` (L900-917) is edited; `applyFormatted` (L936-960) and `reindentFallback` (L969-973) are the precedent `resolveFormatOptions` mirrors; `getTabSize()` (L722-724) is read, not modified. |
| [`packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts`](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts) | `FormatOptions.indentWidth` (L15-16) gets its doc comment extended; the interface's field semantics are otherwise untouched. |
| [`packages/lib/src/typescript/lib/component/editor/formatters/prettier.ts`](packages/lib/src/typescript/lib/component/editor/formatters/prettier.ts) | `PRETTIER_OPTION_NAMES` (L9-21) is the evidence that `indentWidth` maps uniformly across every Prettier-backed language, not per-parser. Not modified. |
| [`packages/lib/src/typescript/lib/component/editor/formatters/sql.ts`](packages/lib/src/typescript/lib/component/editor/formatters/sql.ts) | `SQL_OPTION_NAMES` (L9-21) is the same evidence for the `sql` language. Not modified. |
| [`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts) | `'CodeEditor format() dispatch'` (L1816-1992), especially the `'passes format() options through…'` test (L1967-1991), is both the precedent the new tests copy and the pre-existing test whose identity assertion this plan's merge logic must not break. |
| [`packages/lib/docs/components/CodeEditor.md`](packages/lib/docs/components/CodeEditor.md) | The **Formatting options** section (L109-136) is edited; its existing applicability table (L119-131) and `indentWidth`-vs-`tabSize` paragraph are the voice and structure to match. |

---

## Non-Goals

- **No change to `FormatOptions.useTabs`, or any other `FormatOptions` field's
  semantics.** Only `indentWidth`'s *source*, when omitted, changes.
- **No change to `tabSize`'s own semantics, accessors, or default.**
  `getTabSize()` / `setTabSize()` are read, never modified.
- **No bidirectional sync.** `tabSize` never reads from or writes to
  `FormatOptions` state, and this plan does not make it do so. The default is
  one-directional and lives entirely inside `format()`'s own dispatch (via
  `resolveFormatOptions`), not as a shared source of truth.
- **No new public API surface.** No new `CodeEditorOptions` field, no new
  accessor, no new export. `resolveFormatOptions` is private.
- **No `CodeEditorPanel.ts` change.** Its existing "Tab size" and "Format"
  buttons already exercise the new default with no code change — see
  `## Expected Behaviour` › *Manual verification only*.
- **No fix for the missing `css` column** in `CodeEditor.md`'s applicability
  table. See `## Potential Challenges`.

---

## Notes

[^precedent]: `applyFormatted`'s own doc comment
    ([CodeEditor.ts:927-931](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L927))
    reads: "Factored out of `format()` so the apply-or-skip decision, and the
    dispatched transaction's shape, are unit-testable against an injected
    duck-typed view…"; `reindentFallback`'s
    ([CodeEditor.ts:962-967](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L962))
    reads: "Factored out from `format()` so the dispatch decision (formatter
    vs. this fallback) is unit-testable by spying on this method…". Both
    justify the same move this plan makes for the new options-merge decision,
    which is exactly as small and exactly as worth isolating: a pure function
    of `options` and `this.getTabSize()`, with no view and no async work.

[^identity-test]: Verified directly: `Object.is({ a: 1 }, { a: 1 })` is
    `false` in JavaScript regardless of content — object identity is
    reference identity, never structural. Any code path that does
    `{ ...options, indentWidth: x }` unconditionally therefore always returns
    a new reference, even on a call where `x` happens to equal
    `options.indentWidth` already. The pre-existing test's `toBe(options)`
    assertion is a strict reference check (`Object.is` under the hood in
    Vitest), so it would fail under an unconditional-merge implementation
    regardless of `tabSize`'s value in that specific test — the fix is the
    conditional return in `resolveFormatOptions`, not a change to the test.

[^css-table-gap]: Checked directly against `languages.ts`
    ([languages.ts:93-101](packages/lib/src/typescript/lib/component/editor/languages.ts#L93)):
    `css` is registered with `loadFormatter: async () =>
    formatWithPrettier("css", …)`, the same `formatWithPrettier` adapter and
    the same shared `PRETTIER_OPTION_NAMES` table every other Prettier-backed
    language uses, so `indentWidth` applies to it identically. The
    applicability table in `CodeEditor.md`'s **Formatting options** section
    was last touched by the `codeeditor-live-editing-options` plan, which
    added `tabSize` documentation elsewhere on the same page without editing
    this table — the missing `css` column predates both that plan and this
    one. The `codeeditor-codemirror-feature-expansion` plan's own
    Documentation Impact section left a structurally identical gap alone
    ("The table is also missing a row for the existing `autoHeightMinRows`
    option — leave that gap alone; it predates this plan"), which is the
    precedent this plan follows rather than expanding its own scope to fix an
    unrelated table.
