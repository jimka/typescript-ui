---
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts
  - packages/lib/src/typescript/lib/component/editor/languages.ts
  - packages/lib/src/typescript/lib/component/editor/formatters/sql.ts
  - packages/lib/src/typescript/lib/component/editor/index.ts
  - packages/lib/src/typescript/CodeEditorPanel.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# CodeEditor Language Options — Implementation Plan

## Overview

`CodeEditor`'s built-in `"sql"` language calls `@codemirror/lang-sql`'s `sql()` with no dialect ([languages.ts:69-79](packages/lib/src/typescript/lib/component/editor/languages.ts#L69)), which means CodeMirror's generic `StandardSQL` grammar. With `lint` on, valid PostgreSQL is then reported as a parse error. The SQLAdmin consumer app hit three such constructs: the `@>` and `<@` operators, and dollar-quoted strings (`$$ … $$`, `$tag$ … $tag$`). The same grammar also drives highlighting and keyword completion. The SQL formatter ([formatters/sql.ts:31-40](packages/lib/src/typescript/lib/component/editor/formatters/sql.ts#L31)) uses `sql-formatter`'s generic `"sql"` language, which throws on all three constructs.[^measured]

This plan lets a consumer pass **language options** along with the language, through `setLanguage(id, options?)` and a `languageOptions` construction option. `CodeEditor` treats the options as an opaque bag (`LanguageOptions`, a `Record<string, unknown>`). It hands the bag to the language's three loaders, declared in [LanguageRegistry.ts](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts#L76).

The built-in `"sql"` language defines and exports `SqlLanguageOptions { dialect?: "standard" | "postgresql" }`. The dialect drives grammar, highlighting, completion and lint, all of which come from the one grammar, plus `format()`. Without options, behaviour is exactly as today. SQLAdmin will call `setLanguage("sql", { dialect: "postgresql" })`. Ships in 0.11.0.

---

## Architecture Decisions

### Options are an opaque bag that travels with the language id

`CodeEditor` gets no language-specific names. It stores a `LanguageOptions` bag next to the language id and passes it to the language's `loadExtension`, `loadFormatter` and `loadLintSource`. It never reads a field of the bag. Each language defines, documents and exports the shape it reads; the built-in `"sql"` language exports `SqlLanguageOptions`.

This follows the shape `FormatOptions` already set ([LanguageRegistry.ts:14-41](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts#L14)): settings handed to a language's engine, which ignores what does not concern it. Several other designs were rejected, including this plan's earlier SQL-named `sqlDialect` API.[^alternatives]

### `setLanguage(id, options?)` replaces both id and options; omitted options mean `{}`

Every `setLanguage` call stores a fresh shallow copy of `options`. When `options` is omitted, it stores `{}`. So options never outlive the call that set them.[^options-reset]

| Call sequence | `getLanguage()` | `getLanguageOptions()` |
| --- | --- | --- |
| `setLanguage("sql", { dialect: "postgresql" })` | `"sql"` | `{ dialect: "postgresql" }` |
| …then `setLanguage("json")` | `"json"` | `{}` |
| …then `setLanguage("sql")` | `"sql"` | `{}` (dialect is `"standard"` again) |
| `setLanguage(null)` | `null` | `{}` |

`applyOptions` caches the `languageOptions` construction option (as a copy), like `language`. It applies to the language the editor mounts with. `languageOptions` has no setter of its own: its only runtime writer is `setLanguage`, because options belong to one language.[^no-own-setter]

`getLanguageOptions()` returns a shallow copy. A caller mutating the result cannot change what the loaders see.

### A mounted `setLanguage` always reloads; stale loads are detected by the identity of the stored options

On a mounted editor, `setLanguage` already reloads the grammar and refreshes lint on every call, even with the same id ([CodeEditor.ts:806-833](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L806)). That stays. So `setLanguage("sql", { dialect: "postgresql" })` on an editor already showing SQL reloads both. Re-running `refreshLint()` is what makes the diagnostics update.[^relint]

Today a late async result is dropped when `getLanguage()` no longer equals the id the load started for ([CodeEditor.ts:828](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L828), [869](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L869)). The check becomes: same id **and** the stored options object is the very object (`===`) captured when the load started. Every `setLanguage` stores a new copy, so any later `setLanguage` call makes earlier loads stale, even one with equal content. No field-by-field comparison is needed.[^identity-guard]

| Call order | Resolution order | Installed grammar |
| --- | --- | --- |
| `setLanguage("sql", { dialect: "postgresql" })`, then `setLanguage("sql", { dialect: "standard" })` | `standard` load resolves, then `postgresql` load resolves | `StandardSQL` — the `postgresql` result is dropped because its options object is no longer the stored one |
| `setLanguage("sql", { dialect: "postgresql" })` only | resolves | `PostgreSQL` |

The mount path stops calling the public `setLanguage` ([CodeEditor.ts:2211-2215](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2211)). Calling it would overwrite the constructor's `languageOptions` with `{}`. Mount calls a new private `loadActiveLanguage()` instead, which holds today's view-side body of `setLanguage`.

### The `"sql"` language reads `dialect` and falls back to `"standard"` for anything it does not recognise

| `options` passed to the `"sql"` loaders | Dialect used |
| --- | --- |
| omitted, `{}`, `{ dialect: "standard" }` | `standard` |
| `{ dialect: "postgresql" }` | `postgresql` |
| `{ dialect: "postgres" }`, `{ dialect: 42 }`, `{ dialect: "toString" }` | `standard` (unrecognised, ignored) |
| `{ dialect: "postgresql", other: 1 }` | `postgresql` (unknown keys ignored) |

There is no warning. That matches `setLanguage`, which silently ignores an unregistered id ([CodeEditor.ts:821-825](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L821)). A consumer catches typos at compile time by writing `satisfies SqlLanguageOptions` at the call site, as the docs show.[^no-warning]

| `dialect` | `@codemirror/lang-sql` export | `sql-formatter` `language` |
| --- | --- | --- |
| `"standard"` | `StandardSQL` | `"sql"` |
| `"postgresql"` | `PostgreSQL` | `"postgresql"` |

Only these two dialects are offered because only these two were measured. Adding another later means one more union member and one more table row.[^two-dialects] `"standard"` gives grammar and formatter output identical to today's.[^default-standard]

### Highlighting, completion and lint all follow the grammar; the formatter gets the dialect separately

`sql({ dialect })` returns one `LanguageSupport` carrying the dialect's parser (highlighting) and its keyword completion source. The lint source `collectSyntaxErrors` ([syntaxDiagnostics.ts:26](packages/lib/src/typescript/lib/component/editor/syntaxDiagnostics.ts#L26)) walks whatever tree that grammar built, so the `"sql"` `loadLintSource` stays unchanged. The formatter is a separate engine, so `loadFormatter` maps the dialect to `sql-formatter`'s `language` itself.[^formatter-in-scope]

### `formatWithSql` becomes a factory taking the engine's language name, like `formatWithPrettier`

`formatWithSql` changes from a `Formatter` constant to `formatWithSql(language: SqlLanguage): Formatter`, where `SqlLanguage` is `sql-formatter`'s own type. This mirrors [`formatWithPrettier(parser, loadPlugins)`](packages/lib/src/typescript/lib/component/editor/formatters/prettier.ts#L40), which takes the engine's parser id while `languages.ts` owns the mapping from language to engine name. The dialect table therefore lives only in `languages.ts`, and `formatters/sql.ts` knows nothing about `SqlLanguageOptions`. `formatWithSql` is not exported from the barrel.

### Every loader receives the bag

`loadLintSource` receives `LanguageOptions` too, even though `collectSyntaxErrors` ignores it. A custom lint source may depend on the options, and one argument for all three loaders keeps the contract uniform.[^lint-gets-bag] The parameter is optional, so an existing definition written as `async () => …` still type-checks.

### `LanguageOptions` and `SqlLanguageOptions` are `type` aliases, not interfaces

`LanguageOptions = Record<string, unknown>`. `SqlLanguageOptions` must be declared with `type`, not `interface`. Otherwise a variable typed `SqlLanguageOptions` would not be assignable to `setLanguage`'s `LanguageOptions` parameter.[^type-alias]

### The demo panel gets an SQL sample and a dialect toggle

[CodeEditorPanel.ts](packages/lib/src/typescript/CodeEditorPanel.ts#L186) already has one button per language as a manual-verify handle. It gains:

- an `SQL` button with a PostgreSQL sample;
- a `Dialect: standard` / `Dialect: postgresql` toggle that calls `setLanguage('sql', { dialect } satisfies SqlLanguageOptions)` without touching the document. The toggle follows the shape of `toggleLint` ([CodeEditorPanel.ts:259](packages/lib/src/typescript/CodeEditorPanel.ts#L259)).

---

## Public API

```typescript
// component/editor/LanguageRegistry.ts

/**
 * Settings for one language, passed with its id to `CodeEditor.setLanguage`
 * and on to that language's loaders. `CodeEditor` never reads a field;
 * each language documents the shape it accepts (the built-in `"sql"`
 * language: `SqlLanguageOptions`).
 *
 * @category Components
 */
export type LanguageOptions = Record<string, unknown>;

export interface LanguageDefinition {
    id: string;
    label?: string;
    loadExtension: (options?: LanguageOptions) => Promise<Extension>;
    loadFormatter?: (options?: LanguageOptions) => Promise<Formatter>;
    loadLintSource?: (options?: LanguageOptions) => Promise<LintSource>;
}
```

```typescript
// component/editor/languages.ts

/**
 * Options the built-in `"sql"` language reads. An unrecognised `dialect`
 * value falls back to `"standard"`.
 *
 * @category Components
 */
export type SqlLanguageOptions = {
    /** SQL dialect for highlighting, completion, lint and format(). Default `"standard"`. */
    dialect?: "standard" | "postgresql";
};
```

```typescript
// component/editor/CodeEditor.ts

export interface CodeEditorOptions extends ComponentOptions {
    // …existing fields…
    /** Options for `language`, passed to its loaders. Default `{}`. See the language's own options type. */
    languageOptions?: LanguageOptions;
}

class CodeEditor {
    setLanguage(id: string | null, options?: LanguageOptions): this;  // widened; stores { ...(options ?? {}) }
    getLanguageOptions(): LanguageOptions;                              // shallow copy of the stored bag; {} when unset
}
```

- Backing store: `this._options.languageOptions`. It always holds a copy owned by the editor, never the caller's object.
- Barrel ([index.ts](packages/lib/src/typescript/lib/component/editor/index.ts)): add `LanguageOptions` to the `LanguageRegistry.js` type-export line, and add `export type { SqlLanguageOptions } from '~/component/editor/languages.js';`.

```typescript
// component/editor/formatters/sql.ts (internal, not in the barrel)
export function formatWithSql(language: SqlLanguage): Formatter;
```

---

## Implementation

`languages.ts`, the `"sql"` entry. Grammar entries are export **names**, not values, so `@codemirror/lang-sql` stays behind the dynamic `import()`:

```typescript
/**
 * What each SqlLanguageOptions dialect selects in the two engines: the
 * `@codemirror/lang-sql` export (a name, so the grammar package stays behind
 * the dynamic import) and the `sql-formatter` language.
 */
const SQL_DIALECTS: Record<NonNullable<SqlLanguageOptions["dialect"]>, { grammar: "StandardSQL" | "PostgreSQL"; formatter: SqlLanguage }> = {
    standard:   { grammar: "StandardSQL", formatter: "sql" },
    postgresql: { grammar: "PostgreSQL",  formatter: "postgresql" },
};

/**
 * Resolves the "sql" loaders' options to a dialect entry. Anything other than
 * a recognised `dialect` string falls back to "standard".
 */
function resolveDialectEntry(options?: LanguageOptions): (typeof SQL_DIALECTS)[keyof typeof SQL_DIALECTS] {
    const dialect = options?.dialect;

    if (typeof dialect === "string" && Object.hasOwn(SQL_DIALECTS, dialect)) {
        return SQL_DIALECTS[dialect as keyof typeof SQL_DIALECTS];
    }

    return SQL_DIALECTS.standard;
}

registerLanguage({
    id: "sql",
    label: "SQL",
    loadExtension: async (options) => {
        const langSql = await import("@codemirror/lang-sql");

        return langSql.sql({ dialect: langSql[resolveDialectEntry(options).grammar] });
    },
    loadFormatter: async (options) => formatWithSql(resolveDialectEntry(options).formatter),
    loadLintSource: async () => collectSyntaxErrors,
});
```

`resolveDialectEntry` uses `Object.hasOwn`, not `in`, so inherited keys such as `"toString"` fall back to `"standard"`.

`formatters/sql.ts`. The adapter-owned `language` goes after the mapped options, as `formatWithPrettier` does with `parser`:

```typescript
export function formatWithSql(language: SqlLanguage): Formatter {
    return async (source: string, cursorOffset: number, options?: FormatOptions) => {
        const { format } = await import("sql-formatter");
        const formatted = format(source, {
            ...mapFormatOptions<FormatOptionsWithLanguage>(options, SQL_OPTION_NAMES),
            language,
        });

        return { formatted, cursorOffset: Math.min(cursorOffset, formatted.length) };
    };
}
```

`CodeEditor.ts`:

```typescript
setLanguage(id: string | null, options?: LanguageOptions): this {
    this._options.language        = id ?? undefined;
    this._options.languageOptions = { ...(options ?? {}) };
    this.loadActiveLanguage();

    return this;
}

getLanguageOptions(): LanguageOptions {
    return { ...(this._options.languageOptions ?? {}) };
}

private loadActiveLanguage(): void {
    if (!this._view) {
        return;
    }

    this.refreshLint();

    const id = this.getLanguage();

    if (!id) {
        this._view.dispatch({ effects: this._langCompartment.reconfigure([]) });

        return;
    }

    const def = getLanguage(id);

    if (!def) {
        return;
    }

    const options = this._options.languageOptions;

    void def.loadExtension(options).then((extension) => {
        if (this._view && this.isCurrentLanguageLoad(id, options)) {
            this._view.dispatch({ effects: this._langCompartment.reconfigure(extension) });
        }
    });
}

private isCurrentLanguageLoad(id: string, options: LanguageOptions | undefined): boolean {
    return this.getLanguage() === id && this._options.languageOptions === options;
}
```

Loaders receive the stored object itself, not a copy, so the `===` check compares against the object the load captured. The stored value is `undefined` only when `setLanguage` was never called and no `languageOptions` was constructed. In that case `undefined === undefined` is correct, because nothing has replaced it.

---

## Ordered Implementation Steps

1. **`LanguageRegistry.ts` — type and loader signatures.**
   - Add `LanguageOptions` above `LanguageDefinition` ([L69](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts#L69)), with the JSDoc from *Public API*.
   - Change the three loader signatures ([L82-86](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts#L82)) to take `options?: LanguageOptions`.
   - Add one line to each loader's JSDoc: "Receives the options passed with the language id to `CodeEditor.setLanguage` (or the `languageOptions` option); must not mutate them."
   - Check: `npm run typecheck` (from `packages/lib`) is clean.

2. **`formatters/sql.ts` — factory.**
   - Replace the `formatWithSql` constant with the `formatWithSql(language)` factory from *Implementation*.
   - Import `SqlLanguage` as a type from `"sql-formatter"`, beside the existing `FormatOptionsWithLanguage` import.
   - Rewrite the JSDoc as a factory doc (`@param language` — the `sql-formatter` language; `@returns`), keeping the cursor-clamp sentence.

3. **`languages.ts` — `SqlLanguageOptions` and the dialect-aware `"sql"` entry.**
   - Add the exported `SqlLanguageOptions` (declared with `type`), `SQL_DIALECTS`, `resolveDialectEntry`, and the rewritten `"sql"` registration ([L69-79](packages/lib/src/typescript/lib/component/editor/languages.ts#L69)) from *Implementation*.
   - Import `LanguageOptions` as a type from `LanguageRegistry.js`, and `SqlLanguage` as a type from `"sql-formatter"`.
   - Leave every other language untouched.
   - Check: `grep -n 'from "@codemirror/lang-sql"' packages/lib/src/typescript/lib/component/editor/languages.ts` → zero matches. Only the dynamic `import(...)` remains.

4. **`CodeEditor.ts` — option, `setLanguage`, `getLanguageOptions`, `loadActiveLanguage`.**
   - Import the type `LanguageOptions` from `LanguageRegistry.js`, next to the existing `FormatOptions` import ([L34](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L34)).
   - Add `languageOptions?: LanguageOptions` to `CodeEditorOptions`, right after `language` ([L179-180](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L179)). Its JSDoc says: options for `language`, passed to its loaders; the editor never reads them; see the language's own options type (`SqlLanguageOptions` for `"sql"`); default `{}`.
   - In `applyOptions` ([L713](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L713)), after the `language` line, add `if (options.languageOptions !== undefined) this._options.languageOptions = { ...options.languageOptions };`. Do not add it to `_defaultCodeEditorOptions`.
   - Replace `setLanguage` ([L806-833](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L806)) with the version in *Implementation*. Move its view-side body into the new private `loadActiveLanguage()`, placed directly after it.
   - Rewrite `setLanguage`'s JSDoc to cover these points:
     - it caches the id and a copy of `options`;
     - omitted options mean `{}`, so switching language drops the previous language's options;
     - when mounted, every call reloads the grammar and refreshes lint, including a re-call with the same id;
     - in a rapid sequence of calls, only the latest is applied.
   - Add `@param options` to that JSDoc. Give `loadActiveLanguage` and `isCurrentLanguageLoad` JSDoc describing what each does.
   - Add `getLanguageOptions()` after `getLanguage` ([L788-790](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L788)). Its JSDoc says it returns a shallow copy of the active language's options, or `{}` when none are set.
   - Add the private `isCurrentLanguageLoad()` after `loadActiveLanguage`.
   - In `mount()` ([L2211-2215](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2211)), replace `this.setLanguage(language)` with `this.loadActiveLanguage()`, keeping the `if (language)` guard.
   - In the comment at [L2075-2078](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2075), change "runs setLanguage(language)" to "runs loadActiveLanguage()". Find any other comment saying `mount` calls `setLanguage` with `grep -n "setLanguage" packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` and update it the same way.

5. **`CodeEditor.ts` — pass the bag to lint and format.**
   - In `refreshLint` ([L859-875](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L859)):
     - Widen the guard to `if (!id || !def?.loadLintSource)`. TypeScript does not narrow `id` from `def`, and a null `id` already yields an undefined `def`, so behaviour is unchanged.
     - Add `const options = this._options.languageOptions;` and call `def.loadLintSource(options)`.
     - Change the `.then` check to `this._view && this.getLint() && this.isCurrentLanguageLoad(id, options)`.
     - In its JSDoc, replace "still equals the id this call started for" with "is still the id and options object this call started for".
   - In `format()` ([L1418](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1418)), call `await def.loadFormatter(this._options.languageOptions)`.
   - Check: `grep -n 'this.getLanguage() === id' packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` → exactly one match, inside `isCurrentLanguageLoad`.

6. **`index.ts` — barrel.**
   - Add `LanguageOptions` to the `LanguageRegistry.js` type-export line ([L9](packages/lib/src/typescript/lib/component/editor/index.ts#L9)).
   - Add `export type { SqlLanguageOptions } from '~/component/editor/languages.js';` directly below that line.

7. **Tests — update the existing `formatWithSql` call sites.**
   - In [code-editor.test.ts](packages/lib/tests/component/code-editor.test.ts#L2727), two blocks call `formatWithSql(src, …)`: `sql-formatter cursor clamp` (L2727-2739) and `formatWithSql options` (L2834-2876).
   - Change each call to `formatWithSql('sql')(src, …)`. Expected outputs stay identical.
   - Check: `grep -n "formatWithSql(SOURCE\|formatWithSql('select" packages/lib/tests/component/code-editor.test.ts` → zero matches.

8. **Tests — new cases.** Write the unit-testable cases in *Expected Behaviour* first (test-first), in two new `describe` blocks in `code-editor.test.ts`.
   - `describe('built-in sql language options', …)` covers cases 1-8.
     - Load the real definition with `await getLanguage('sql')!.loadExtension(...)`.
     - Build an `EditorState` with that extension and force a full parse, as `buildJsonState` does ([L2178-2184](packages/lib/tests/component/code-editor.test.ts#L2178)): `ensureSyntaxTree(state, state.doc.length, Infinity)`, then `state.update({}).state`.
     - Then read one of: `collectSyntaxErrors`; `syntaxTree(...).resolveInner(pos, 1).name`; or the completion sources from `state.languageDataAt('autocomplete', pos)`, run against `new CompletionContext(state, pos, true)`.
     - Imports: add `syntaxTree` to the existing `@codemirror/language` import, `import { CompletionContext } from '@codemirror/autocomplete'`, and `import type { SqlLanguageOptions } from '~/component/editor/languages'`.
   - `describe('CodeEditor languageOptions', …)` covers cases 9-17.
     - Use registered test languages whose loaders record their argument.
     - Use the fake `editor._view = { dispatch }` pattern from the `CodeEditor lint` block ([L1406-1438](packages/lib/tests/component/code-editor.test.ts#L1406)).
     - A grammar reconfigure is a dispatch whose `effects.value.compartment === editor._langCompartment`. Its `effects.value.extension` is the installed extension.
   - Check: `npm test` (from `packages/lib`) is green, including `typecheck:test`, which also compiles case 17.

9. **Demo — `CodeEditorPanel.ts`.**
   - Add a `SAMPLE_SQL` constant after `SAMPLE_JSON` ([L54](packages/lib/src/typescript/CodeEditorPanel.ts#L54)) holding `PG_CONTAINS`, `PG_CONTAINED` and `PG_DOLLAR` from *Expected Behaviour*, one per line. Add a comment naming it the manual-verify handle for the SQL dialect option.
   - Add `upperToolbar.addComponent(this.makeLanguageButton('SQL', 'sql', SAMPLE_SQL));` after the JSON button ([L189](packages/lib/src/typescript/CodeEditorPanel.ts#L189)).
   - Add a `private readonly _dialectBtn: Button;` field next to `_lintBtn` ([L107](packages/lib/src/typescript/CodeEditorPanel.ts#L107)).
   - Create the button as `new Button({ text: 'Dialect: standard' })` after `_lintBtn` ([L143-144](packages/lib/src/typescript/CodeEditorPanel.ts#L143)). Wire it to a new `toggleDialect()`, and add it to `upperToolbar` right after `_lintBtn`.
   - `toggleDialect()` does the following:
     - reads `this._editor.getLanguageOptions().dialect`;
     - picks `'standard'` when that value is `'postgresql'`, and `'postgresql'` otherwise;
     - calls `this._editor.setLanguage('sql', { dialect: next } satisfies SqlLanguageOptions)`, leaving the document alone;
     - sets the button text to `Dialect: ${next}`.
   - Its JSDoc notes that the toggle switches the editor to SQL if another language is active.
   - In `makeLanguageButton`'s handler ([L301-311](packages/lib/src/typescript/CodeEditorPanel.ts#L301)), also call `this._dialectBtn.setText('Dialect: standard')`, because `setLanguage` without options resets the dialect.
   - Import `SqlLanguageOptions` as a type from the same module the panel imports `CodeEditor` from.

10. **Docs — `docs/components/CodeEditor.md`.**
    - *Construction* table: add a row after `language` ([L35](packages/lib/docs/components/CodeEditor.md#L35)): `` | `languageOptions` | `LanguageOptions` | `{}` | Options for `language`, passed to its loaders — see [Language options](#language-options). | ``.
    - After the paragraph ending at L63, before `### Registering a language`, add a `### Language options` subsection. It contains:
      - **How options are passed:** `setLanguage(id, options?)` and `languageOptions` pass a bag to that language.
      - **The reset rule:** omitted options mean `{}`, so switching language drops them. Include the call-sequence table from *Architecture Decisions*.
      - **Reloading:** re-calling `setLanguage` on a mounted editor reloads the grammar and refreshes lint.
      - **What `"sql"` reads:** `SqlLanguageOptions.dialect`, the dialect table, the fallback rule for unrecognised values, and the three constructs `"standard"` reports as errors.
      - **Both usage forms:**

        ```typescript
        editor.setLanguage('sql', { dialect: 'postgresql' } satisfies SqlLanguageOptions);
        new CodeEditor(text, { language: 'sql', languageOptions: { dialect: 'postgresql' }, lint: true });
        ```

      - **A recommendation** to write `satisfies SqlLanguageOptions`, which catches typos at compile time.
    - *Registering a language* ([L65](packages/lib/docs/components/CodeEditor.md#L65)): after the code block, add a paragraph. It says that each loader is called with the language's options. A custom language declares its options type with `type`, not `interface`, so it can be passed as `LanguageOptions`, and ignores fields it does not recognise.
    - *Common methods* ([L287](packages/lib/docs/components/CodeEditor.md#L287)):
      - Change the `setLanguage(id)` row to `` `getLanguage()` / `setLanguage(id, options?)` ``, with purpose "Read or swap the active language and its options (grammar loads lazily; omitted options reset to `{}`)."
      - Add a row `` `getLanguageOptions()` `` with purpose "Read a copy of the active language's options."
    - *Linting* ([L316](packages/lib/docs/components/CodeEditor.md#L316)): add a sentence saying that SQL diagnostics follow the dialect set in the [language options](#language-options).

11. **Changelog — `docs/reference/changelog/next.md`.** Under `## Added` → `### Components` ([L133](packages/lib/docs/reference/changelog/next.md#L133)), add:

    > - **`CodeEditor` languages accept options, and SQL can be parsed as PostgreSQL.** `setLanguage(id, options?)` and the new `languageOptions` construction option pass a settings bag to the language, and `getLanguageOptions()` reads it back. Options travel with the language: omitting them, or switching to another language, resets them to `{}`. The built-in `sql` language reads `SqlLanguageOptions` (`{ dialect?: "standard" | "postgresql" }`, default `"standard"`). The dialect sets the grammar used for highlighting, keyword completion and lint, and the engine `format()` uses. Under the default generic dialect, PostgreSQL's `@>` and `<@` operators and dollar-quoted strings (`$$ … $$`) are reported as syntax errors, and `format()` rejects them. With `setLanguage("sql", { dialect: "postgresql" })`, they parse and format cleanly. `LanguageDefinition`'s three loaders now receive the options; definitions that take no argument keep working. No consumer action is needed.

12. **Final checks.** See *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/formatters/sql.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/languages.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/index.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/src/typescript/CodeEditorPanel.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Sample strings used throughout. The `PG_*` strings are PostgreSQL-only constructs.

| Name | Text |
| --- | --- |
| `PG_CONTAINS` | `SELECT * FROM t WHERE c @> '{}'::jsonb;` |
| `PG_CONTAINED` | `SELECT * FROM t WHERE c <@ '{}'::jsonb;` |
| `PG_DOLLAR` | `CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;` |
| `PG_TAGGED` | `CREATE OR REPLACE FUNCTION f() RETURNS int AS $function$ SELECT 1 $function$;` |
| `PLAIN` | `SELECT a, b FROM t WHERE a = 1;` |

**Built-in `"sql"` definition (unit-testable, no view needed):**

1. With `loadExtension({ dialect: 'postgresql' })`, `collectSyntaxErrors` returns `[]` for each of `PG_CONTAINS`, `PG_CONTAINED`, `PG_DOLLAR` and `PG_TAGGED`.
2. With `loadExtension()`, `loadExtension({})` and `loadExtension({ dialect: 'standard' })`, `collectSyntaxErrors` returns at least one diagnostic for each of the four `PG_*` strings. Assert `length > 0`, not an exact count.[^measured]
3. `PLAIN` returns `[]` under both dialects.
4. Highlighting: in `SELECT $$ BEGIN RETURN 1; END; $$;`, offset 12 is inside the `$$` body. The node there resolves to `String` with `{ dialect: 'postgresql' }`, and to something other than `String` with no options.
5. Completion: take the document `SELECT jso` with the cursor at its end. The labels from all `autocomplete` sources include `jsonb` with `{ dialect: 'postgresql' }`, and exclude it with no options.
6. `loadFormatter({ dialect: 'postgresql' })` returns a formatter that formats `PG_CONTAINS` without throwing, and its output contains `@>`. `loadFormatter()` returns a formatter that rejects on `PG_CONTAINS`.
7. Fallback: `loadExtension({ dialect: 'postgres' })`, `loadExtension({ dialect: 42 })` and `loadExtension({ dialect: 'toString' })` each report at least one diagnostic for `PG_CONTAINS`. `loadExtension({ dialect: 'postgresql', other: 1 })` reports `[]`.
8. `formatWithSql('sql')(PG_CONTAINS, 0)` rejects. `formatWithSql('postgresql')(PG_DOLLAR, 0)` resolves. `formatWithSql('sql')('select a from b;', 0)` still yields `'select\n  a\nfrom\n  b;'`, as today.

**`CodeEditor` (unit-testable, offline or with a fake `_view`):**

9. Defaults and construction:
   - `new CodeEditor().getLanguageOptions()` returns `{}`.
   - `new CodeEditor(undefined, { language: 'sql', languageOptions: { dialect: 'postgresql' } }).getLanguageOptions()` returns `{ dialect: 'postgresql' }`.
   - Mutating the returned object does not change the next `getLanguageOptions()` result.
10. Offline round-trips follow the call-sequence table:
    - `setLanguage('sql', { dialect: 'postgresql' })` → `{ dialect: 'postgresql' }`.
    - Then `setLanguage('json')` → `{}`.
    - Then `setLanguage('sql')` → `{}`.
    - `setLanguage(null)` → `{}`.
    - Mutating the object passed to `setLanguage` afterwards does not change `getLanguageOptions()`.
11. With a fake view and a test language whose `loadExtension` records its argument:
    - `setLanguage(id, { dialect: 'postgresql' })` passes an object equal to `{ dialect: 'postgresql' }` (`toEqual`) that is not the caller's object (`not.toBe`).
    - `setLanguage(id)` passes `{}`.
12. With a fake view, `lint: true`, and a test language whose `loadLintSource` records its argument, `setLanguage(id, { a: 1 })` passes `{ a: 1 }` to `loadLintSource`.
13. Take an editor built with `{ language: <test lang>, languageOptions: { a: 1 } }` whose test language's `loadFormatter` records its argument. Calling `format()` passes `{ a: 1 }` to `loadFormatter`.
14. With the editor mounted (fake view), call `setLanguage(id, { a: 1 })`, then `setLanguage(id, { a: 2 })`, with the same id:
    - `loadExtension` is called twice.
    - Once both resolve, only the second dispatches a grammar reconfigure.
    - With `lint: true`, `loadLintSource` is also called twice.
15. A stale result is dropped (the table under *Architecture Decisions*):
    - Use a test language whose `loadExtension` returns a deferred promise per call.
    - Call `setLanguage(id, { dialect: 'postgresql' })`, then `setLanguage(id, { dialect: 'standard' })`.
    - Resolve the second load first, then the first.
    - Only the second load's extension is ever dispatched to `_langCompartment`.
16. The mount path keeps constructor options:
    - Construct with `{ language: <test lang>, languageOptions: { a: 1 } }`, set the fake view, and call the private `loadActiveLanguage()`.
    - `loadExtension` receives `{ a: 1 }`.
    - `getLanguageOptions()` still returns `{ a: 1 }`.
17. Typing, compiled by `typecheck:test`: both of these compile.
    - `const sqlOptions: SqlLanguageOptions = { dialect: 'postgresql' }; editor.setLanguage('sql', sqlOptions);`
    - `editor.setLanguage('sql', { dialect: 'postgresql' } satisfies SqlLanguageOptions);`

**Manual verification (live CodeMirror view — the offline harness never mounts one):**

18. In the demo's CodeEditor panel, press **SQL**, then **Lint: on**. With `Dialect: standard`, the `@>`, `<@` and `$$` lines show error squiggles. Press **Dialect** to switch to `postgresql`. Within about a second, without typing, the squiggles disappear and the `$$` body is coloured as a string.
19. With `Dialect: postgresql`, type `jso` on a new line. The completion list offers `json` and `jsonb`. Switch back to `standard`: typing `jso` offers neither.
20. With `Dialect: postgresql`, press **Format**. The document reformats and keeps `@>`, `<@` and the `$$` body. With `Dialect: standard`, **Format** rejects: the promise rejects and the document is untouched.
21. Press **JS**, then **SQL**. The dialect label reads `standard`, and with lint on the SQL sample shows squiggles again, because switching language dropped the options.

---

## Verification

- From `packages/lib`, run `npm run typecheck`, `npm test` (which includes `typecheck:test`) and `npm run lint`.
- `npm run docs:api` finishes with zero warnings.
- The grep checks in steps 3, 5 and 7 pass.
- `grep -rn 'languageOptions\|SqlLanguageOptions' packages/lib/docs/components/CodeEditor.md packages/lib/docs/reference/changelog/next.md` → matches in both files.
- Manual cases 18-21 pass in the lib dev server (`npm run dev` from `packages/lib`, CodeEditor demo section).

---

## Documentation Impact

- **Barrel:** `LanguageOptions` and `SqlLanguageOptions` join the type exports of `@jimka/typescript-ui/component/editor`. Both carry `@category Components`, like `FormatOptions`.
- **[docs/components/CodeEditor.md](packages/lib/docs/components/CodeEditor.md):** the new *Language options* subsection, with anchor `#language-options`, used by the construction row and the linting sentence. Plus the registering, common-methods and linting edits in step 10.
- **[docs/reference/changelog/next.md](packages/lib/docs/reference/changelog/next.md):** the *Added → Components* entry in step 11.
- **No migration note.** `setLanguage`'s new parameter is optional, and every existing call behaves as before.
- **No `llms.txt` change.** Its coverage check tracks classes only.

---

## Potential Challenges

- **Re-lint timing after a reload.** `loadActiveLanguage` starts the lint refresh before the new grammar lands. This works because CodeMirror's linter runs its source about 750 ms after the reconfigure and reads the syntax tree at that moment. By then the already-imported grammar has been swapped in. This is today's `setLanguage` behaviour. If manual case 18 shows stale squiggles, call `refreshLint()` from the `loadExtension` `.then`, after the grammar reconfigure. Do not add a timer.
- **`langSql[...]` indexing type.** TypeScript may reject indexing the module namespace with `"StandardSQL" | "PostgreSQL"`. If so, destructure `{ sql, StandardSQL, PostgreSQL }` and index a local `{ StandardSQL, PostgreSQL }` object with the same key.
- **`interface` vs `type`.** Do not convert `SqlLanguageOptions` into an `interface`. Case 17 fails to compile if it is.
- **Concurrent edits to `CodeEditor.ts`.** `plans/markdown-source-mode-editing.md` and `plans/overlay-scrollbars-non-panel.md` also modify this file; the latter touches its `applyOptions` and option list. Whichever plan lands second rebases. The edits are in different members.
- **Fake `_view` in tests.** Tests reach private members through `as any`, as the existing lint tests do. Keep that pattern instead of widening visibility.

---

## Critical Files

- **[CodeEditor.ts](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts)** — these members:
  - `CodeEditorOptions` (L176) and `applyOptions` (L709);
  - `getLanguage` / `setLanguage` (L788-833) and `refreshLint` (L848);
  - `format` (L1408);
  - `mount()`'s compartment seeding (L2075) and language load (L2211).
- **[LanguageRegistry.ts](packages/lib/src/typescript/lib/component/editor/LanguageRegistry.ts)** — `FormatOptions`, the precedent for engine settings a language honours or ignores, and `LanguageDefinition`.
- **[languages.ts](packages/lib/src/typescript/lib/component/editor/languages.ts)** — the `"sql"` entry, and the lazy-import rule in its header comment.
- **[formatters/prettier.ts](packages/lib/src/typescript/lib/component/editor/formatters/prettier.ts#L40)** — `formatWithPrettier`, the factory precedent.
- **[formatters/sql.ts](packages/lib/src/typescript/lib/component/editor/formatters/sql.ts)** and **[formatters/options.ts](packages/lib/src/typescript/lib/component/editor/formatters/options.ts)**.
- **[syntaxDiagnostics.ts](packages/lib/src/typescript/lib/component/editor/syntaxDiagnostics.ts)** — why lint follows the grammar.
- **[code-editor.test.ts](packages/lib/tests/component/code-editor.test.ts)** — the `CodeEditor lint` block (fake-view pattern), `buildJsonState`, and the `formatWithSql` blocks.
- **[CodeEditorPanel.ts](packages/lib/src/typescript/CodeEditorPanel.ts)** — the demo's language row, `toggleLint` and `makeLanguageButton`.
- **`node_modules/@codemirror/lang-sql/dist/index.d.ts`** (repo root) — `SQLConfig.dialect`, `StandardSQL` and `PostgreSQL`.

---

## Non-Goals

- **Dialects other than PostgreSQL.** Not requested and not measured. Adding one is additive.
- **Options for the other built-in languages.** None needs any today; they ignore the bag.
- **A typed per-language options map.** Rejected; see the alternatives footnote.
- **Changing the default to PostgreSQL.** Rejected; see the alternatives footnote.
- **Unclosed-paren diagnostic placement** (SQLAdmin's adjacent `LIBRARY_NOTES.md` entry). The PostgreSQL grammar reports the same position.
- **A `libpg_query`-backed lint source.** This plan only makes one possible to write.
- **Schema-aware SQL completion** (`SQLConfig.schema`). It is outside `CodeEditor`'s grammar-bounded completion scope.
- **SQLAdmin adopting the option.** That is app work, after 0.11.0 ships.

---

## Notes

[^measured]: Measured on the repo's installed `@codemirror/lang-sql` 6.10.0 and `sql-formatter` 15.8.2, counting parse-tree error nodes the way `collectSyntaxErrors` does.
    Error nodes under `StandardSQL` vs `PostgreSQL`: `PG_CONTAINS` 1 vs 0, `PG_CONTAINED` 1 vs 0, `PG_DOLLAR` 2 vs 0, `PG_TAGGED` 4 vs 0, `PLAIN` 0 vs 0. These match SQLAdmin's `LIBRARY_NOTES.md`.
    `sql-formatter`'s default `"sql"` language throws `Parse error: Unexpected …` on all four `PG_*` strings. With `language: "postgresql"` it formats all four, and `PLAIN`'s output is unchanged.
    `collectSyntaxErrors` merges adjacent error nodes, so the diagnostic count can be lower than the error-node count. That is why the tests assert `> 0`.
    Also measured: `SELECT jso` completes to `json`/`jsonb` only under `PostgreSQL`, and the `$$` body parses as a `String` node only under `PostgreSQL`.

[^alternatives]: Rejected designs, in the order considered:
    - **A SQL-named API on `CodeEditor`**: a `sqlDialect` option with its own getter and setter, plus a `sqlDialect` field in the loader argument. This was the first draft of this plan. The user rejected it because `CodeEditor` is a generic code editor and must not carry language-specific names; each further language setting would have added another such member.
    - **A fully typed per-language options map**: a registry interface that consumers extend by declaration merging, so `setLanguage("sql", …)` would type-check its options from the id. Rejected as too much type machinery for a single option. The opaque bag, plus an exported per-language type used with `satisfies`, gives call-site checking without it.
    - **Switching the built-in default to PostgreSQL**: every consumer writing generic or non-Postgres SQL would silently get different diagnostics, completions and `format()` output.
    - **A separate `"postgresql"` language id**: adds a second "SQL" entry to every `listLanguages()` picker, and another per future dialect, when the dialect is a property of one language.
    - **A consumer-registered, dialect-parameterised definition registered over `"sql"`**: the registry is process-wide, so every editor in the app would share one dialect, and app startup would depend on registration order.

[^options-reset]: Options mean something only to the language that defined them. Keeping `{ dialect: "postgresql" }` after a switch to `"json"` would leave dead state behind, and a later `setLanguage("sql")` would silently bring it back. The same call would then behave differently depending on history. Resetting on every call makes `setLanguage(id, options)` a complete statement of the editor's language state.

[^no-own-setter]: ARCHITECTURE.md's rule 3 asks for each options-bag field to have a matching setter. Here that setter is `setLanguage` itself: it already writes `language`, and it now writes `languageOptions` too. A separate `setLanguageOptions` would let options change while the id stays the same, or be set for the wrong language. That is exactly the mismatch the reset rule exists to prevent.

[^identity-guard]: Two alternatives were weighed.
    - **A field-by-field (shallow-equal) comparison** needs a comparison helper and a rule for nested values. It would also let a stale load with equal content pass, which is harmless but no simpler.
    - **Comparing the caller's own object** breaks when a caller reuses one object and mutates it between calls.
    Storing a fresh copy on each call and comparing with `===` is the simplest rule that is always correct: a load is current until the next `setLanguage`. It is the existing id-only rule, extended to calls that pass the same id.

[^no-warning]: A warning on an unrecognised value would need the editor or the registry to know each language's valid values, or each language to log on its own. Both add surface area to catch a mistake that `satisfies SqlLanguageOptions` already catches at compile time. Falling back keeps the editor usable, which matches how an unknown language id behaves.

[^two-dialects]: `@codemirror/lang-sql` has eight dialects and `sql-formatter` about twenty languages, and the two sets do not match one-to-one; Cassandra, for example, has no formatter counterpart. Offering only measured values avoids shipping a mapping nobody has checked. `SQL_DIALECTS` is typed as a `Record` over the `dialect` union, so TypeScript rejects a new union member until the table has a row for it.

[^default-standard]: `"standard"` maps to `StandardSQL` and to `sql-formatter`'s `"sql"`. Those are exactly what `sql()` with no config and `format()` with no `language` use today, so passing no options gives identical grammar and formatter output. The existing `formatWithSql options` tests pin this for the formatter.

[^formatter-in-scope]: SQLAdmin's query editor calls `format()` (`frontend/src/dock/QueryPanel.ts:699` in the sqladmin repo). Under the generic formatter, that call rejects any document containing `@>`, `<@` or `$$`. An editor set to `"postgresql"` would then lint clean but refuse to format the same text.

[^lint-gets-bag]: The adjacent SQLAdmin note proposes a `libpg_query`-backed lint source, which only makes sense for PostgreSQL. Such a source needs the options; without them it would have to be registered as a separate language. Passing the bag costs one argument. The widened stale check in `refreshLint` stops a late result for old options from being installed.

[^relint]: `@codemirror/lint`'s plugin schedules a new run only in three cases: `update.docChanged` is true, the lint config facet changed, or a `needsRefresh` hook fires (`node_modules/@codemirror/lint/dist/index.js`, around line 325). Swapping only the grammar compartment triggers none of these. Without a lint refresh, the old dialect's squiggles would stay until the next keystroke. `refreshLint()` installs a fresh `linter(...)` instance, which changes the config facet and triggers a run.

[^type-alias]: TypeScript gives an object-literal `type` alias an implicit index signature, but not an `interface`. So `const o: SqlLanguageOptions = …; setLanguage("sql", o)` compiles only when `SqlLanguageOptions` is a `type`. With an `interface`, it fails with "Index signature for type 'string' is missing". An inline object literal checked with `satisfies` works either way, which is why case 17 tests the typed-variable form.
