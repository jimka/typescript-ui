# Code Search: CodeGraph, ast-grep, grep

Three tools, three jobs. Pick by the *shape* of the query, not by habit.

## Decision rule — match the query to the tool

| Query shape | Right tool | Example |
|---|---|---|
| **Known string or one symbol, one answer.** Find a definition, an import, a literal. | `grep` (Bash) / `Grep` | "where is `setOverflow` defined", "find the string `--ts-ui-border-color`" |
| **Cross-module / graph question.** Callers, callees, change impact, what-depends-on-what. The answer needs the call graph, not the text. | **CodeGraph** | "every site that calls `Component.applyOptions`", "what breaks if I rename `setMinSize`", "show the call chain reaching `doLayout`" |
| **Structural pattern.** Find every occurrence of a *code shape* (e.g. a specific call form with placeholders) that regex can't express without false positives. | **ast-grep** | "every `super(opts, { ..._default$X, ...subclass })` call site", "every `if (opts.$X !== undefined) this.set$Y(opts.$X)` cascade", "every `class $C extends Component` declaration" |

If grep would need a complex regex and still pull false positives — that's the ast-grep signal. If the question is "what flows through this code" — that's the CodeGraph signal.

## CodeGraph — CLI (always available)

The CLI works in any session and reads `.codegraph/codegraph.db` directly. Prefer it over MCP unless the MCP tools are explicitly surfaced as deferred tools in the current session.

```bash
# Symbol search — find where something is defined, with file:line
codegraph query 'setOverflow'                          # everything matching
codegraph query 'setOverflow' -k function              # only functions
codegraph query 'Spacer' -k class                      # only classes
codegraph query 'setOverflow' -j | jq '.[].location'   # JSON for scripting

# Task-oriented context bundle — markdown digest of relevant symbols + code
codegraph context 'how does the layout shrink path handle minSize'
```

`codegraph query` is the workhorse — file:line + kind for any symbol, faster and more precise than `grep` for "find the definition of X". The `-k` filter eliminates noise (e.g. excluding tests, examples).

### Index freshness — important

On this project's filesystem (WSL2), the watcher and `codegraph sync` are unreliable. Both `codegraph status` and `codegraph sync` can report "Index is up to date" while the index is in fact stale — they trust their own bookkeeping rather than re-scanning files. Verified case: edits + commits land in `src/`, `sync` says "Already up to date", and `query` returns no results for the new symbols.

**Reliable refresh:**

```bash
codegraph index --force                # full re-index, works every time
codegraph index --force -q             # quiet form, suitable for git hooks
```

Run `codegraph index --force` whenever your most recent code edits matter to the query. If a `codegraph query` for a recently added/renamed symbol returns no results, that's the staleness signal — re-index and re-run.

Note: `codegraph serve --mcp` would normally watch and auto-sync, but the watcher relies on filesystem events that WSL2 delivers unreliably. Don't trust it on this machine.

## CodeGraph — MCP tools (when surfaced)

When the session lists `mcp__codegraph__*` as deferred tools, prefer them — they return structured graph data the CLI can only print as text. Load schemas via `ToolSearch` first:

```
ToolSearch query="select:mcp__codegraph__callers,mcp__codegraph__callees,mcp__codegraph__impact,mcp__codegraph__context,mcp__codegraph__search"
```

If `ToolSearch` returns nothing for those names, the MCP server isn't connected in this session — fall back to the CLI.

## ast-grep — structural matching

Installed at `/usr/local/bin/ast-grep`. **Use the full binary name `ast-grep`**, not `sg` — `sg` on this system resolves to `setsid`.

```bash
# Find every call shape — `$X` is a placeholder for any expression / identifier
ast-grep --lang ts --pattern 'super($OPTS, { ...$DEF, ...$SUB })' src/typescript/lib

# Find every options-cascade pattern in applyOptions
ast-grep --lang ts --pattern 'if (opts.$X !== undefined) this.set$Y(opts.$X)' src/typescript/lib

# Find every class declaration extending Component
ast-grep --lang ts --pattern 'class $C extends Component' src/typescript/lib

# Multi-line rewrite or query — write a rule file
ast-grep scan --rule rules/my-rule.yaml
```

The win over grep: `super($A, $B)` matches every call regardless of whitespace, line breaks, or argument complexity, with no false positives from comments or strings. Regex can't do that without a parser.

When ast-grep wins:
- Migrations ("every call to `setX(x, y)` should become `setX({ x, y })`")
- Audits ("every subclass that doesn't call `super.applyOptions`")
- Cascade patterns ("every site that writes a CSS rule via the lazy getter")

When ast-grep loses: comments, JSDoc text, plain strings, anything outside the AST. Use grep there.

## Notes

- For plain string matches in non-code files (markdown, JSON, comments), grep is still the right tool — CodeGraph indexes structure, not byte content.
- See the "Index freshness" subsection above for the WSL2 watcher caveat. Short version: trust `codegraph index --force`, not `codegraph sync` or `codegraph status`, when verifying that recent edits are queryable.
