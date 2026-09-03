---
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/src/typescript/lib/component/editor/index.ts
  - packages/lib/docs/components/CodeEditor.md
---

# Formatter Options — Implementation Plan

## Overview

`CodeEditor.format()` takes no arguments
([CodeEditor.ts:546](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L546)),
and the `Formatter` type it dispatches to takes only `(source, cursorOffset)`
([LanguageRegistry.ts:14-19](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts#L14)).
So a consumer cannot influence *how* a document is formatted — indent width,
line width, quote style, and everything else are whatever the underlying
engine's own defaults happen to be. This plan adds that control.

Two engines back the five built-in languages: Prettier (`javascript`,
`json`, `html`, `markdown`) and `sql-formatter` (`sql`). A new exported
`FormatOptions` interface names the style knobs those two actually honour.
`Formatter` gains a third, optional `options` parameter; `format(options?)`
forwards its argument to it. Each engine's adapter —
[formatters/prettier.ts](packages/lib/src/typescript/lib/component/editor/formatters/prettier.ts)
and
[formatters/sql.ts](packages/lib/src/typescript/lib/component/editor/formatters/sql.ts)
— maps the fields its engine honours onto that engine's own config names and
drops the rest, through one shared helper in a new
`formatters/options.ts`.

Nothing about the no-formatter path changes: a language registered with a
grammar only still gets `format()`'s whole-document re-indent
([CodeEditor.ts:579-583](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L579)),
which ignores `FormatOptions` entirely.

---

## Architecture Decisions

### One flat options bag, not a per-language one

`FormatOptions` is a single flat interface covering every language, not a
map of language id to its own option set. Four of the five built-in
formatters are Prettier, and Prettier silently ignores an option its active
printer does not use, so a Markdown-only field and a JavaScript-only field
can sit in the same bag with no cross-talk.[^one-bag]

### Engine-neutral field names, renamed per adapter

The fields are named for the *editor* concept, not for Prettier's config
key: `indentWidth`, `lineWidth`, `semicolons` — not `tabWidth`,
`printWidth`, `semi`. Each adapter owns the rename onto its own engine's
name.[^neutral-names]

### The options travel on the `Formatter` call, not on `loadFormatter`

`LanguageDefinition.loadFormatter` keeps its `() => Promise<Formatter>`
signature; the options reach the formatter as its third call argument. A
formatter is loaded once per `format()` call and the loaded function stays
option-agnostic, so nothing has to be re-imported or cache-keyed when the
options change between calls.[^call-time]

### Each adapter maps through an exhaustive name table

An adapter declares a `Readonly<Record<keyof FormatOptions, string | null>>`
— every field mapped either to its engine's own option name, or to `null`
meaning "this engine does not honour it". Adding a field to `FormatOptions`
then fails the typecheck in both adapters until each one classifies it,
which is the only mechanism that keeps the two tables from silently drifting
out of date.[^exhaustive-table]

### The mapping omits an absent field rather than forwarding `undefined`

`mapFormatOptions` writes a key only when its value is not `undefined`.
This is a correctness requirement, not tidiness: `sql-formatter` merges the
caller's config over its own defaults with `Object.assign`, so an
explicitly-`undefined` key **erases** that default and produces mangled
output rather than default output.

| Config passed to `sql-formatter` | Output for `select a from b;` |
|---|---|
| `{}` | `"select\n  a\nfrom\n  b;"` |
| `{ tabWidth: 4 }` | `"select\n    a\nfrom\n    b;"` |
| `{ tabWidth: undefined, keywordCase: undefined }` | `"\na\n\nb;"` — both keywords deleted, indentation gone |

### `CodeEditor.format()`'s error contract is unchanged, and covers a bad option value

Neither the adapters nor `format()` validate an option's value. A value the
engine rejects — a fractional `indentWidth`, a negative `lineWidth` — makes
the engine throw, which is already `format()`'s documented "the formatter
threw" path: the promise rejects and the document is left untouched.[^no-validation]

---

## Public API

### `LanguageRegistry.ts`

```typescript
/**
 * Style knobs a {@link Formatter} may honour. Every field is optional;
 * an absent field means "leave that engine's own default alone". No field is
 * honoured by every built-in language — see the applicability table in
 * `docs/components/CodeEditor.md`.
 */
export interface FormatOptions {
    /** Spaces per indent level. */
    indentWidth?: number;
    /** Indent with tab characters instead of spaces. */
    useTabs?: boolean;
    /** Column the formatter wraps at. */
    lineWidth?: number;
    /** Prefer single quotes for string literals. */
    singleQuote?: boolean;
    /** Terminate statements with semicolons. */
    semicolons?: boolean;
    /** Where to print trailing commas. */
    trailingComma?: "none" | "es5" | "all";
    /** Parenthesise a sole arrow-function parameter. */
    arrowParens?: "always" | "avoid";
    /** Print spaces inside object braces. */
    bracketSpacing?: boolean;
    /** How to re-wrap prose. */
    proseWrap?: "always" | "never" | "preserve";
    /** How strictly to preserve significant whitespace in markup. */
    htmlWhitespaceSensitivity?: "css" | "strict" | "ignore";
    /** Case to print SQL keywords in. */
    keywordCase?: "preserve" | "upper" | "lower";
}

export type Formatter = (
    source: string,
    cursorOffset: number,
    options?: FormatOptions,
) =>
    | Promise<{ formatted: string; cursorOffset: number }>
    | { formatted: string; cursorOffset: number };
```

`LanguageDefinition` is unchanged.

### `formatters/options.ts` (new — internal, not exported from the barrel)

```typescript
/**
 * Maps each {@link FormatOptions} field to one engine's own option name, or
 * to `null` when that engine does not honour it.
 */
export type FormatOptionNames = Readonly<Record<keyof FormatOptions, string | null>>;

/**
 * Renames `options` onto one engine's config keys, dropping every field the
 * engine does not honour and every field that is absent.
 */
export function mapFormatOptions<T extends object>(
    options: FormatOptions | undefined,
    names: FormatOptionNames,
): Partial<T>;
```

### `CodeEditor.ts`

```typescript
class CodeEditor extends Component<CodeEditorOptions> {
    /** Formats the document via the active language's formatter, or re-indents it when the language has none. */
    async format(options?: FormatOptions): Promise<void>;
}
```

`format()` holds no formatting state: there is no `_formatOptions` field, no
`CodeEditorOptions.formatOptions`, and no setter. The options are a
per-call argument, so a caller that wants them applied on every format
passes them on every call.

### `index.ts` (barrel)

```typescript
export type { LanguageDefinition, Formatter, FormatOptions } from '~/component/editor/LanguageRegistry.js';
```

### Adapter signatures (unchanged)

```typescript
export function formatWithPrettier(parser: string, loadPlugins: () => Promise<Plugin[]>): Formatter
export const formatWithSql: Formatter
```

### Which language honours which field

Every ✔ and — below was checked by running the engine both ways and
comparing output.[^applicability-evidence]

| `FormatOptions` field | Engine option | `javascript` | `json` | `html` | `markdown` | `sql` |
|---|---|---|---|---|---|---|
| `indentWidth` | `tabWidth` (both engines) | ✔ | ✔ | ✔ | ✔ list nesting only | ✔ |
| `useTabs` | `useTabs` (both engines) | ✔ | ✔ | ✔ | — | ✔ |
| `lineWidth` | Prettier `printWidth` | ✔ | ✔ | ✔ | ✔ only with `proseWrap: "always"` | — |
| `singleQuote` | Prettier `singleQuote` | ✔ | — | — | — | — |
| `semicolons` | Prettier `semi` | ✔ | — | — | — | — |
| `trailingComma` | Prettier `trailingComma` | ✔ | — | — | — | — |
| `arrowParens` | Prettier `arrowParens` | ✔ | — | — | — | — |
| `bracketSpacing` | Prettier `bracketSpacing` | ✔ | ✔ | — | — | — |
| `proseWrap` | Prettier `proseWrap` | — | — | — | ✔ | — |
| `htmlWhitespaceSensitivity` | Prettier `htmlWhitespaceSensitivity` | — | — | ✔ | — | — |
| `keywordCase` | `sql-formatter` `keywordCase` | — | — | — | — | ✔ |

---

## Internal Structure

### `formatters/options.ts`

```typescript
export function mapFormatOptions<T extends object>(
    options: FormatOptions | undefined,
    names: FormatOptionNames,
): Partial<T> {
    const mapped: Record<string, unknown> = {};

    for (const [field, target] of Object.entries(names)) {
        const value = options?.[field as keyof FormatOptions];

        if (target !== null && value !== undefined) {
            mapped[target] = value;
        }
    }

    // The names table is the type bridge: every non-null target names a real
    // option of `T` whose type matches the `FormatOptions` field mapped onto
    // it. TypeScript cannot follow that correspondence through a string-keyed
    // write, so the assertion stands in for it.
    return mapped as Partial<T>;
}
```

### `formatters/prettier.ts`

The `Options` type import joins the existing `Plugin` one, and
`FormatOptions` joins the existing `Formatter` import; the runtime import of
`prettier/standalone` stays dynamic and unchanged.

```typescript
import type { Options, Plugin } from "prettier";
import { mapFormatOptions } from "~/component/editor/formatters/options.js";
import type { FormatOptionNames } from "~/component/editor/formatters/options.js";
import type { FormatOptions, Formatter } from "~/component/editor/LanguageRegistry.js";

/** Every `FormatOptions` field, mapped to its Prettier option name or to `null` when Prettier has none. */
const PRETTIER_OPTION_NAMES: FormatOptionNames = {
    indentWidth:               "tabWidth",
    useTabs:                   "useTabs",
    lineWidth:                 "printWidth",
    singleQuote:               "singleQuote",
    semicolons:                "semi",
    trailingComma:             "trailingComma",
    arrowParens:               "arrowParens",
    bracketSpacing:            "bracketSpacing",
    proseWrap:                 "proseWrap",
    htmlWhitespaceSensitivity: "htmlWhitespaceSensitivity",
    keywordCase:               null,
};

export function formatWithPrettier(
    parser: string,
    loadPlugins: () => Promise<Plugin[]>,
): Formatter {
    return async (source: string, cursorOffset: number, options?: FormatOptions) => {
        const [{ formatWithCursor }, plugins] = await Promise.all([
            import("prettier/standalone"),
            loadPlugins(),
        ]);

        // The mapped style options go first, so `parser`, `plugins`, and
        // `cursorOffset` — the three the adapter owns — cannot be displaced.
        return formatWithCursor(source, {
            ...mapFormatOptions<Options>(options, PRETTIER_OPTION_NAMES),
            parser,
            plugins,
            cursorOffset,
        });
    };
}
```

### `formatters/sql.ts`

`sql-formatter` exports a type of its own called `FormatOptions`, so its
import must be aliased — an unaliased `import type { FormatOptions } from
"sql-formatter"` would shadow the library's own new interface in this file.

```typescript
import type { FormatOptionsWithLanguage } from "sql-formatter";
import { mapFormatOptions } from "~/component/editor/formatters/options.js";
import type { FormatOptionNames } from "~/component/editor/formatters/options.js";
import type { FormatOptions, Formatter } from "~/component/editor/LanguageRegistry.js";

/** Every `FormatOptions` field, mapped to its `sql-formatter` option name or to `null` when it has none. */
const SQL_OPTION_NAMES: FormatOptionNames = {
    indentWidth:               "tabWidth",
    useTabs:                   "useTabs",
    keywordCase:               "keywordCase",
    lineWidth:                 null,
    singleQuote:               null,
    semicolons:                null,
    trailingComma:             null,
    arrowParens:               null,
    bracketSpacing:            null,
    proseWrap:                 null,
    htmlWhitespaceSensitivity: null,
};

export const formatWithSql: Formatter = async (
    source: string,
    cursorOffset: number,
    options?: FormatOptions,
) => {
    const { format } = await import("sql-formatter");
    const formatted = format(source, mapFormatOptions<FormatOptionsWithLanguage>(options, SQL_OPTION_NAMES));

    return { formatted, cursorOffset: Math.min(cursorOffset, formatted.length) };
};
```

### `CodeEditor.format`

Two lines change inside the existing method — the signature and the
formatter call:

```typescript
async format(options?: FormatOptions): Promise<void> {
    // ... unchanged language lookup and no-formatter fallback ...
    const result = await formatter(source, cursorOffset, options);
    // ... unchanged document replace ...
}
```

---

## Ordered Implementation Steps

Steps 1-5 are the test-first cycle for the mapping helper and the two
adapters; steps 6-8 wire `format()` and the barrel; steps 9-11 are the docs
and the final checks.

1. **[tests/component/code-editor.test.ts](packages/lib/tests/component/code-editor.test.ts)**
   — add the `mapFormatOptions`, `formatWithPrettier`, `formatWithSql`, and
   `format(options)`-dispatch cases from **Expected Behaviour**. Put the
   adapter cases next to the existing `describe('sql-formatter cursor clamp')`
   block ([:1406](packages/lib/tests/component/code-editor.test.ts#L1406))
   and the dispatch cases inside the existing
   `describe('CodeEditor format() dispatch')` block
   ([:1346](packages/lib/tests/component/code-editor.test.ts#L1346)).
   Two new imports are needed, alongside the file's existing
   `formatWithSql` one
   ([:6](packages/lib/tests/component/code-editor.test.ts#L6)):

   ```typescript
   import { formatWithPrettier } from '~/component/editor/formatters/prettier';
   import { mapFormatOptions } from '~/component/editor/formatters/options';
   import type { FormatOptionNames } from '~/component/editor/formatters/options';
   import type { FormatOptions } from '~/component/editor/LanguageRegistry';
   ```

   Run `npm test` — fails, since `FormatOptions` and `mapFormatOptions` do
   not exist yet.

2. **[LanguageRegistry.ts](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts)**
   — add the `FormatOptions` interface above `Formatter`
   ([:14](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts#L14)),
   then add `Formatter`'s third parameter and document it in the existing
   JSDoc's `@param` list. Per
   [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), `FormatOptions`'s own JSDoc
   must not `{@link}` a non-exported symbol — point at the doc page in prose
   instead, as shown in **Public API**.

3. **[formatters/options.ts](packages/lib/src/typescript/lib/component/editor/formatters/options.ts)**
   (new) — implement `FormatOptionNames` and `mapFormatOptions` per
   **Internal Structure**, with the SPDX header line every file in this
   directory carries.

4. **[formatters/prettier.ts](packages/lib/src/typescript/lib/component/editor/formatters/prettier.ts)**
   and
   **[formatters/sql.ts](packages/lib/src/typescript/lib/component/editor/formatters/sql.ts)**
   — add the two name tables and thread `options` through both adapters, per
   **Internal Structure**. Mind the aliased `sql-formatter` type import.

5. Check: `npm test` — green, including every new case.

6. **[CodeEditor.ts](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts)**
   — import `FormatOptions` alongside the existing `getLanguage` import
   ([:15](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L15)),
   add `format`'s optional parameter
   ([:546](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L546)),
   pass it to the `formatter(...)` call
   ([:560](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L560)),
   and add an `@param options` line to the method's JSDoc noting that a
   language with no formatter ignores it.

7. **[index.ts](packages/lib/src/typescript/lib/component/editor/index.ts)**
   — add `FormatOptions` to the existing type re-export on
   [:9](packages/lib/src/typescript/lib/component/editor/index.ts#L9).

8. Checks:
   - `npm run typecheck` and `npm run typecheck:test` — clean.
   - `npm run lint` — clean.
   - `npm test` — green.
   - `grep -rn 'formatter(source, cursorOffset)' packages/lib/src` — zero
     matches (the old two-argument call is gone).
   - `grep -c ': null,' packages/lib/src/typescript/lib/component/editor/formatters/sql.ts`
     — exactly 8, and the same grep against `prettier.ts` — exactly 1
     (`sql-formatter` honours 3 of the 11 fields, Prettier 10).

9. **[docs/components/CodeEditor.md](packages/lib/docs/components/CodeEditor.md)**
   — the three edits in **Documentation Impact**.

10. Final checks: `npm run docs:api` (must finish with **zero** warnings),
    `npm run docs:llms` followed by
    `git diff --stat packages/lib/llms.txt` (expect no change — the
    `CodeEditor` summary line is untouched), and `npm run build:lib`.

11. Run the manual case in **Verification**.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/formatters/options.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/formatters/prettier.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/formatters/sql.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/index.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |

---

## Expected Behaviour

### Unit-testable — `tests/component/code-editor.test.ts`

Both adapters are directly importable and run fine under vitest's node
environment — the file already unit-tests `formatWithSql` this way
([:1406-1417](packages/lib/tests/component/code-editor.test.ts#L1406)).

**`mapFormatOptions`**, driven by a table the test declares itself. Because
`FormatOptionNames` is a `Record` over *every* `FormatOptions` key, the test's
table must list all eleven fields — map `indentWidth` to `'tabWidth'` and the
other ten to `null`:

| `options` | Result |
|---|---|
| `undefined` | `{}` |
| `{}` | `{}` |
| `{ indentWidth: 4 }` | `{ tabWidth: 4 }` — renamed |
| `{ useTabs: true }` | `{}` — the field's target is `null` |
| `{ indentWidth: undefined }` | `{}`, and `'tabWidth' in result` is `false` — not a key holding `undefined` |
| `{ indentWidth: 4, useTabs: true }` | `{ tabWidth: 4 }` |

**`formatWithPrettier`**, over the source
`const a = {foo: "bar"}\nconst f = x => x\n`. `languages.ts`'s own
`loadBabelPlugins` is module-private, so the test builds the formatter with
its own loader:

```typescript
const jsFormatter = formatWithPrettier('babel-ts', async () => [
    await import('prettier/plugins/babel'),
    await import('prettier/plugins/estree'),
]);
```

| `options` | `formatted` |
|---|---|
| `undefined` | `const a = { foo: "bar" };\nconst f = (x) => x;\n` |
| `{ singleQuote: true }` | `const a = { foo: 'bar' };\nconst f = (x) => x;\n` |
| `{ semicolons: false }` | `const a = { foo: "bar" }\nconst f = (x) => x\n` |
| `{ arrowParens: "avoid" }` | `const a = { foo: "bar" };\nconst f = x => x;\n` |
| `{ indentWidth: 8, lineWidth: 20 }` | `const a = {\n        foo: "bar",\n};\nconst f = (x) => x;\n` |
| `{ keywordCase: "upper" }` | identical to the `undefined` row — a SQL-only field never reaches Prettier |
| `{ indentWidth: 2.5 }` | the promise **rejects** (Prettier refuses a fractional `tabWidth`) |

**`formatWithSql`**, over the source `select a from b;`:

| `options` | `formatted` |
|---|---|
| `undefined` | `select\n  a\nfrom\n  b;` |
| `{ keywordCase: "upper" }` | `SELECT\n  a\nFROM\n  b;` |
| `{ indentWidth: 4 }` | `select\n    a\nfrom\n    b;` |
| `{ useTabs: true }` | `select\n\ta\nfrom\n\tb;` |
| `{ lineWidth: 120, singleQuote: true, proseWrap: "always" }` | identical to the `undefined` row — Prettier-only fields never reach `sql-formatter` |
| `{ indentWidth: undefined, keywordCase: undefined }` | identical to the `undefined` row. This is the case that pins the omit-absent-fields rule: forwarding the `undefined`s instead yields `\na\n\nb;` |

The returned `cursorOffset` still clamps to the formatted length, options or
not — the existing two cases stay as they are.

**`CodeEditor.format(options)` dispatch** (offline, with a fake formatter
registered — the shape the existing `format() dispatch` block already uses):

| Call | The fake formatter's third argument |
|---|---|
| `editor.format()` | `undefined` |
| `editor.format({ indentWidth: 4 })` | `{ indentWidth: 4 }`, by identity |
| `editor.format({})` | `{}` |

For a language registered with no `loadFormatter`, `format({ indentWidth: 4 })`
still runs the re-indent fallback and resolves — the options are ignored,
and the existing fallback test needs no change.

### Manual verification — the docs demo app

`npm run dev`, then the **CodeEditor** demo panel. Its *Format* button calls
`format()` with no argument
([CodeEditorPanel.ts:50](packages/lib/src/typescript/CodeEditorPanel.ts#L50)),
so the sample JavaScript must reformat exactly as it does today: 2-space
indent, double quotes, semicolons. That is the whole manual check — nothing
in the demo app passes options.

---

## Verification

- `npm run typecheck` and `npm run typecheck:test` — clean.
- `npm run lint` — clean.
- `npm test` — green, with every new case above.
- `npm run docs:api` — finishes with zero warnings (required whenever
  public JSDoc changes; see [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)).
- `npm run docs:llms`, then `git diff --stat packages/lib/llms.txt` — no
  change.
- `npm run build:lib` — clean. **A downstream consumer resolves
  `@jimka/typescript-ui/component/editor` through the built `dist/`, so this
  step is what actually publishes `FormatOptions` to it.**
- `grep -rn 'formatter(source, cursorOffset)' packages/lib/src` — zero matches.
- Manual: the docs demo app's CodeEditor panel, per **Expected Behaviour**.

---

## Documentation Impact

- **Barrel / export surface:** `FormatOptions` joins `LanguageDefinition`
  and `Formatter` on
  [index.ts:9](packages/lib/src/typescript/lib/component/editor/index.ts#L9),
  reaching consumers as
  `import type { FormatOptions } from '@jimka/typescript-ui/component/editor'`.
- **[docs/components/CodeEditor.md](packages/lib/docs/components/CodeEditor.md)**
  — three edits:
  1. In the `format()` semantics section
     ([:76-82](packages/lib/docs/components/CodeEditor.md#L76)), change the
     opening line to `editor.format(options?)` and add a bullet: an option
     value the engine rejects (a fractional `indentWidth`) makes the promise
     reject and leaves the document untouched, the same as invalid syntax.
  2. Immediately after that section, add a **Formatting options** section
     holding the applicability table from **Public API** verbatim, plus a
     short code example passing `{ indentWidth: 4, singleQuote: true }`, and
     one sentence saying the options are per-call — the editor stores none.
  3. In the **Common methods** table
     ([:105](packages/lib/docs/components/CodeEditor.md#L105)), change the
     `format()` row to `format(options?)`.
- **`packages/lib/llms.txt`** needs no edit: the entry it carries for
  `CodeEditor` is generated from the class's summary line, which this plan
  does not touch. Regenerate and confirm no diff (step 10).
- **No sidebar change** — no new doc page is added.

---

## Potential Challenges

- **`sql-formatter`'s own exported `FormatOptions` type collides by name.**
  Importing it unaliased into `formatters/sql.ts` would shadow the library's
  new interface in the one file that needs both. Mitigation: `sql.ts` imports
  only `FormatOptionsWithLanguage`, as spelled out in **Internal Structure**.
- **An explicitly-`undefined` option key corrupts SQL output.** Covered by
  the omit-absent-fields rule and pinned by a named test case; the danger is
  a future refactor "simplifying" `mapFormatOptions` into an object spread.
  Mitigation: that test case, and the comment on the `value !== undefined`
  guard.
- **`Object.entries` over the name table loses the key type.** The
  `field as keyof FormatOptions` cast inside `mapFormatOptions` is safe only
  because the table's own type is `Record<keyof FormatOptions, …>`.
  Mitigation: keep `FormatOptionNames` as the table's declared type at both
  call sites — never a bare object literal.
- **Prettier validates option types eagerly.** `printWidth: 79.5` throws
  before any formatting happens, so a consumer that reads options from a
  config file must validate them; the library deliberately does not.
  Mitigation: documented in the `format()` semantics section (edit 1 above).

---

## Critical Files

- [packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts)
  — `Formatter` and `LanguageDefinition`, the types this plan extends.
- [packages/lib/src/typescript/lib/component/editor/formatters/prettier.ts](packages/lib/src/typescript/lib/component/editor/formatters/prettier.ts)
  — **the precedent the new `options.ts` module and both adapter edits
  follow**: a `Formatter`-shaped closure that dynamically imports its engine
  on first call and keeps a `import type` for that engine's types at module
  scope.
- [packages/lib/src/typescript/lib/component/editor/formatters/sql.ts](packages/lib/src/typescript/lib/component/editor/formatters/sql.ts)
  — the second adapter, and the one whose engine is intolerant of
  `undefined` config values.
- [packages/lib/src/typescript/lib/component/editor/CodeEditor.ts:532-583](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L532)
  — `format()` and `reindentFallback()`, the dispatch this plan threads
  options through.
- [packages/lib/src/typescript/lib/component/editor/languages.ts](packages/lib/src/typescript/lib/component/editor/languages.ts)
  — the five built-in registrations; unchanged by this plan, but it is where
  each language's parser id and plugin set are decided.
- [packages/lib/tests/component/code-editor.test.ts:1346-1418](packages/lib/tests/component/code-editor.test.ts#L1346)
  — the existing `format()` dispatch and `formatWithSql` blocks the new
  cases extend.
- [packages/lib/docs/components/CodeEditor.md](packages/lib/docs/components/CodeEditor.md)
  — the doc page, including the built-in-languages table the applicability
  table sits below.
- [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) — the no-`{@link}`-to-internal
  rule and the `npm run docs:api` zero-warning requirement.

---

## Non-Goals

- **No `CodeEditorOptions.formatOptions`, no `setFormatOptions`, no stored
  state.** The options are a per-call argument. A construction-time option
  would need a getter, a setter, and a documented interaction with the
  per-call argument, for a knob whose only consumer already re-reads its own
  configuration before every `format()` call.
- **No option reaches the no-formatter re-indent fallback.** Making
  `indentWidth` govern the fallback means configuring CodeMirror's
  `indentUnit` facet, which also governs Tab and auto-indent *while typing*
  — editor configuration, not a property of one `format()` call. It belongs
  to a separate `CodeEditorOptions` field, not to `FormatOptions`.
- **No validation, clamping, or normalization of option values.** An engine
  that rejects a value throws, and `format()`'s existing reject-and-leave-the-document-alone
  contract already covers it.
- **No SQL dialect selection.** `sql-formatter`'s `language` option picks
  among 20 dialects, which is a property of the *file* being formatted, not
  a style preference — and `CodeEditor` registers one `sql` language with no
  dialect detection to hang it off.
- **No per-language option overrides** (`{ markdown: { … } }`). One flat bag
  is enough while every language-specific field name is distinct; splitting
  the schema five ways for a collision that does not exist is unwarranted.
- **The remaining Prettier and `sql-formatter` options stay
  unexposed.**[^omitted-options]
- **No CSS or Python formatter.** Registering formatters for languages that
  have none is unrelated work.

---

## Notes

[^one-bag]: Verified by running Prettier with a deliberately irrelevant option
    for each parser: `semi: false` and `quoteProps: "preserve"` against the
    `json` parser, `singleQuote: true` against `markdown` and `html`, and
    `keywordCase: "upper"` (not a Prettier option at all) against
    `babel-ts` — every one produced byte-identical output to passing no
    option. Prettier tolerates an unknown option *name* silently; what it
    rejects is a known option with a wrong *type* or an out-of-range enum
    value. `sql-formatter` behaves the same way about unknown names
    (`printWidth`, `semi`, and a nonsense key were all ignored). So the two
    engines cannot interfere with each other through a shared bag. The
    rejected alternative was `Record<string, FormatOptions>` keyed by
    language id, which costs the consumer a five-way schema and buys nothing
    while no two language-specific fields share a name.

[^neutral-names]: Three reasons, in order of weight. The engines disagree
    with each other: Prettier's line-wrap knob is `printWidth` and
    `sql-formatter` has none, while both happen to agree on `tabWidth` and
    `useTabs` — so *some* renaming is unavoidable and picking Prettier's
    vocabulary wholesale would only hide that. The doc page already treats
    "Prettier" as an implementation detail of four of the five built-in
    languages, and a public option literally named `semi` writes that detail
    into the API permanently. And `semi` / `printWidth` are Prettier jargon
    a reader of a consumer's config file has no reason to recognise, where
    `semicolons` / `lineWidth` need no gloss.

[^call-time]: `loadFormatter` exists to defer a large dynamic `import()`
    until the first `format()` call, and its result is a plain function. If
    the options were a `loadFormatter(options)` parameter, every distinct
    option bag would either re-enter the loader — re-resolving the dynamic
    import, which the module cache makes cheap but which also rebuilds the
    closure — or need a cache keyed on the bag's contents. Neither buys
    anything: the engines take their options at format time, not at import
    time.

[^exhaustive-table]: The alternative — a hand-written chain of
    `if (options.indentWidth !== undefined) out.tabWidth = options.indentWidth`
    lines per adapter — behaves identically but goes stale silently. Adding a
    twelfth `FormatOptions` field would compile clean while both adapters
    quietly ignore it, and the failure surfaces as "my setting does nothing",
    which is the hardest kind to trace. `Readonly<Record<keyof FormatOptions,
    string | null>>` turns the same mistake into two compile errors naming
    the missing field.

[^no-validation]: Prettier throws `Invalid tabWidth value. Expected an
    integer, but received 2.5.` before formatting anything, and
    `sql-formatter` throws `RangeError: Invalid count value: -1` for a
    negative `tabWidth`. Both land on the path `format()` already documents
    for a formatter that throws: the whole-document replace is downstream of
    the `await`, so it never runs and the document is untouched. Duplicating
    each engine's own range checks inside the adapters would mean tracking
    two engines' validation rules across their version bumps, to convert a
    clean rejection into a different clean rejection.

[^applicability-evidence]: Each row was established by formatting a fixed
    sample twice — once with no options, once with the single option under
    test — and diffing. The non-obvious results, all confirmed this way
    against Prettier 3.9.6 and `sql-formatter` 15.8.2: `useTabs` changes
    nothing in Markdown, though `tabWidth` does (it sets nested-list
    indentation); `lineWidth` changes nothing in Markdown unless
    `proseWrap: "always"` is also set, because the default `"preserve"`
    leaves every prose line as authored; `singleQuote` changes nothing in
    HTML, whose printer always emits double-quoted attributes; and
    `bracketSpacing` *does* apply to JSON (`{ "a": 1 }` versus `{"a": 1}`),
    which is easy to assume it does not. A JSON document already on one line
    also stays on one line regardless of `lineWidth`, because Prettier's
    `objectWrap` default preserves the author's choice — the samples used to
    check `indentWidth` and `lineWidth` for JSON therefore start with a
    newline after the opening brace.

[^omitted-options]: Surveyed and left out. Prettier: `endOfLine` (a
    file-encoding concern that would have to govern every write, not just a
    formatted one, to be coherent), `objectWrap`, `quoteProps`,
    `jsxSingleQuote`, `bracketSameLine`, `singleAttributePerLine`,
    `vueIndentScriptAndStyle` (no Vue parser is registered),
    `embeddedLanguageFormatting`, `experimentalOperatorPosition`,
    `experimentalTernaries`, and the `Special`-category options
    (`rangeStart`/`rangeEnd`/`requirePragma`/`insertPragma`/`checkIgnorePragma`/`filepath`),
    which are Prettier-CLI concerns rather than style. `sql-formatter`:
    `identifierCase`, `dataTypeCase`, `functionCase`, `indentStyle`,
    `expressionWidth`, `logicalOperatorNewline`, `denseOperators`,
    `newlineBeforeSemicolon`, `linesBetweenQueries`, `params`, and
    `paramTypes`. `expressionWidth` deserves its own note: it looks like
    `lineWidth`'s SQL counterpart but is not — it caps the width of a
    parenthesised expression kept on one line (default 50), not the
    document's wrap column (Prettier's default 80), so mapping `lineWidth`
    onto it would silently reflow SQL in a way no one asked for. Each
    omitted option is one row in each adapter's name table away from being
    added later.
