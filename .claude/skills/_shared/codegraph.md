# CodeGraph Knowledge Index

This project uses CodeGraph (https://github.com/colbymchenry/codegraph) to expose
a tree-sitter-built symbol/call-graph index of `src/**` via MCP. The index lives
at `.codegraph/codegraph.db` and stays current automatically while the MCP server
runs (native file watcher).

## Rules

- For cross-module questions ("what calls X", "what does Y depend on", "what
  breaks if I change Z"), prefer the `mcp__codegraph__*` MCP tools over grep or
  reading files:
  - `codegraph_search` — symbol/name search
  - `codegraph_callers` / `codegraph_callees` — call graph
  - `codegraph_impact` — change-impact analysis
  - `codegraph_context` — symbol with surrounding context
  - `codegraph_node` / `codegraph_files` — node and file lookup
- For plain string matches in non-code files (markdown, JSON, comments), grep
  is still the right tool. CodeGraph indexes code structure, not byte content.
- Run `codegraph_status` if results look stale; the watcher can fall behind on
  heavy edits. A manual `codegraph sync` from the shell forces a re-index.
