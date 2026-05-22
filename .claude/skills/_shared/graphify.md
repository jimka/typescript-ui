# Graphify Knowledge Graph

This project maintains a knowledge graph at `graphify-out/`. Consult it before grep for any codebase question — the graph traverses extracted + inferred edges; grep only scans bytes.

## Rules

- Before answering architecture or codebase questions, read `graphify-out/GRAPH_REPORT.md` for god nodes and community structure.
- If `graphify-out/wiki/index.md` exists, navigate it instead of reading raw files.
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep.
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost).
