# Replace Graphify with CodeGraph — Implementation Plan

## Overview

Swap the project's knowledge-graph tooling from [Graphify](https://github.com/safishamsi/graphify) to [CodeGraph](https://github.com/colbymchenry/codegraph). Graphify is currently wired in as a first-class part of the workflow: a `_shared/graphify.md` reference cited by the `plan`, `implement`, and `debug` skills; a dedicated `graphify` commit bucket in the `commit` skill (rule #4 at [commit/SKILL.md:21](../.claude/skills/commit/SKILL.md#L21)); a PreToolUse hook in [.claude/settings.json](../.claude/settings.json) that nudges away from `grep`/`find`; and a checked-in `graphify-out/` directory containing `GRAPH_REPORT.md`, `graph.json`, `manifest.json`, `cost.json`, and a `cache/` tree.

CodeGraph replaces the *code-structure* slice of that workflow with a local SQLite index (`.codegraph/codegraph.db`) exposed through an MCP server. Indexing is tree-sitter only — no LLM API calls — and a native file watcher keeps the DB current while the MCP server runs, so there is no `update` step to invoke after edits and no graph artifact to commit. The user has accepted the tradeoff: we lose Graphify's doc/PDF/image/video extraction, the `GRAPH_REPORT.md` god-node summary, and community detection. The wins are zero LLM cost, no large diffs on every branch, and no manual refresh discipline.

This plan is tooling-only. It does not touch `src/**`, `docs/**`, or any public API. The bulk of the work lives under `.claude/skills/**`, plus the `graphify-out/` deletion, `.gitignore` and `.codegraph/` setup, and prose edits in four active `plans/*.md` files that still reference `graphify update`. Memory files under `~/.claude/projects/-home-jika-typescript-typescript/memory/` that name graphify (`feedback_graphify_directed.md`, `project_graphify_corpus.md`, and their `MEMORY.md` index entries) get removed since they describe a tool no longer in use.

---

## Architecture Decisions

### Replace `_shared/graphify.md` with `_shared/codegraph.md`, not delete it

Three skills (`plan`, `implement`, `debug`) cite [`_shared/graphify.md`](../.claude/skills/_shared/graphify.md) in their Required Reading. Deleting the file outright means each skill loses its "prefer the graph over grep" guidance. Replacing it with a short `_shared/codegraph.md` that points at the `mcp__codegraph__*` MCP tools (search, callers, callees, impact, context) preserves the structural-investigation discipline with one small content swap and one path rename across three callers. Keeps the shape symmetric, makes the diff reviewable, and leaves room for project-specific CodeGraph notes (e.g. when to fall back to file reads if `codegraph_status` shows the watcher is stale).

### Drop the `graphify` commit bucket entirely; do not introduce a `codegraph` bucket

The graphify bucket existed because `graphify-out/**` was version-controlled and produced large, noisy diffs that needed to be isolated from feature commits. CodeGraph's `.codegraph/codegraph.db` is a binary SQLite file regenerated locally by every developer's MCP server — there is no review value in committing it, and `.codegraph/` belongs in `.gitignore`. With nothing to commit, the bucket disappears and the `commit` skill simplifies from five buckets (code / docs / tooling / graphify / bookkeeping) to four (code / docs / tooling / bookkeeping). All graphify-specific ordering rules, follow-up rebase rules, and pitfalls in [commit/SKILL.md](../.claude/skills/commit/SKILL.md) come out with the bucket.

### Remove the PreToolUse hook in `.claude/settings.json`, do not retool it for CodeGraph

The current hook ([.claude/settings.json](../.claude/settings.json), `PreToolUse` matcher `Bash`) prints a reminder whenever the agent runs `grep`/`rg`/`find`, conditional on `graphify-out/graph.json` existing. The equivalent for CodeGraph would be "before grep, try `mcp__codegraph__codegraph_search`", but the value is lower: CodeGraph's MCP tools surface in the agent's tool list directly and are first-class candidates for symbol lookups without a nudge. Adding a hook for them adds friction (the hook fires on every `grep`-shaped command, including those that have nothing to do with code) for marginal benefit. Remove the hook; rely on the per-skill Required Reading to keep the discipline visible.

### Take a `pre-codegraph-migration` tag before deleting `graphify-out/`

`graphify-out/` is committed and 5,309 nodes / 4,148 edges of analysis the user has been relying on. Once CodeGraph is running, the user may discover gaps — non-code edges Graphify caught (cross-references in JSDoc, README, plan files) that CodeGraph won't surface. The rollback path is to revert the deletion commit. Tag `pre-codegraph-migration` on the merge base before deletion gives a stable point to `git diff` against if a discrepancy turns up months later.

### Do not invoke `codegraph init` from this plan

The CodeGraph install/configure steps are user-machine concerns (touching `~/.claude.json` and `~/.claude/settings.json`, running `curl … | sh`). The plan documents them so the user can follow along, but the implementer agent should not auto-run them: changes to global Claude config and arbitrary shell installs are out of scope for an automated implementation pass. The plan's Verification section confirms CodeGraph is reachable from Claude Code as a prerequisite before the deletion steps land.

### Memory files come out, not get rewritten

Two memory files document graphify-specific operational lessons: `feedback_graphify_directed.md` (always pass `--directed`) and `project_graphify_corpus.md` (target `src/typescript`, not the full repo). Both become meaningless once graphify is gone — CodeGraph has no equivalent flag and reads `.gitignore` for scope. Delete both files and remove their lines from the `MEMORY.md` index rather than rewriting them, since there is no current operational rule to preserve.

---

## Implementation

### New `_shared/codegraph.md`

```markdown
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
```

### Hook removal in `.claude/settings.json`

The entire `PreToolUse` array (lines covering the `Bash`-matcher graphify hook) comes out. The remaining `permissions` and `PostToolUse` (typecheck) sections stay untouched.

### Commit-skill simplification

Every reference to graphify in [commit/SKILL.md](../.claude/skills/commit/SKILL.md) is removed:
- Frontmatter `description` (line 3): drop `graphify /` from the bucket list.
- Bucket #4 (lines 21, 25–26): delete the rule, renumber Bookkeeping to #4.
- Follow-up changes section (line 29): drop the graphify-refresh rebase guidance.
- Body wrapping (line 56): drop the "mechanical graphify refreshes" example.
- Common pitfalls (lines 81, 84–85): drop the graphify-mixing and graphify-stacking pitfalls.

### Plan/implement/debug skill updates

Each `_shared/graphify.md` Required-Reading citation becomes `_shared/codegraph.md` with prose adjusted to drop the "run `graphify update`" line. In [plan/SKILL.md:81](../.claude/skills/plan/SKILL.md#L81), the Verification list drops the `graphify update .` example. In [implement/SKILL.md:111](../.claude/skills/implement/SKILL.md#L111), the Pre-termination checklist's commit-bucket line drops graphify.

### `.gitignore` and `.codegraph/`

Add `.codegraph/` to [.gitignore](../.gitignore) immediately after `node_modules` so the indexed DB never gets committed. `graphify-out/` is currently *not* in `.gitignore` (the whole tree is committed); after the deletion commit, no ignore entry is needed for it.

---

## Ordered Implementation Steps

This plan presumes the user has installed CodeGraph and registered the MCP server (see _Prerequisites_ in Verification). Implementer-agent work begins at step 1.

1. **Tag the rollback point.** `git tag pre-codegraph-migration` on the merge base before any deletions. Push tag separately when the user is ready (not part of the implementer's responsibility).
2. **Create [`.claude/skills/_shared/codegraph.md`](../.claude/skills/_shared/codegraph.md)** with the content from _Implementation_.
3. **Delete [`.claude/skills/_shared/graphify.md`](../.claude/skills/_shared/graphify.md).** → verify: `grep -rn '_shared/graphify.md' .claude/ — expect zero matches` (after step 4 lands).
4. **Update Required-Reading citations** in [plan/SKILL.md:12](../.claude/skills/plan/SKILL.md#L12), [implement/SKILL.md:12](../.claude/skills/implement/SKILL.md#L12), [debug/SKILL.md:9](../.claude/skills/debug/SKILL.md#L9). Replace `_shared/graphify.md` with `_shared/codegraph.md` and rewrite the description text to drop the `graphify update .` line.
5. **Strip the `graphify update .` example** from [plan/SKILL.md:81](../.claude/skills/plan/SKILL.md#L81) (Verification section).
6. **Drop the graphify bucket from [commit/SKILL.md](../.claude/skills/commit/SKILL.md)** per _Implementation_ (frontmatter, rule #4, ordering rules, follow-up section, body example, pitfalls). Renumber Bookkeeping to #4.
7. **Update the bucket-list line in [implement/SKILL.md:19](../.claude/skills/implement/SKILL.md#L19) and the Pre-termination checklist at [implement/SKILL.md:111](../.claude/skills/implement/SKILL.md#L111)** — both currently spell out `(code / documentation / tooling / graphify / bookkeeping)`. → verify: `grep -rn 'graphify' .claude/skills/ — expect zero matches`.
8. **Remove the PreToolUse hook from [.claude/settings.json](../.claude/settings.json).** Keep the surrounding JSON shape valid (`permissions` and `PostToolUse` stay).
9. **Add `.codegraph/` to [.gitignore](../.gitignore)** (one new line, after `node_modules`).
10. **Delete [`graphify-out/`](../graphify-out/) recursively.** `git rm -r graphify-out/`. This is the large diff.
11. **Edit active plan files that reference graphify update or graphify-out/:**
    - [plans/callable-inline-class.md:142](../callable-inline-class.md#L142) — drop the `graphify update .` step.
    - [plans/layout-manager-place-component-split.md:247,272,304](../layout-manager-place-component-split.md#L247) — drop the graphify update step, drop the `graphify update .` verification line, drop the `[CLAUDE.md](../CLAUDE.md) — … graphify update step` Critical Files note.
    - [plans/scrollbar-arrow-buttons.md:303](../scrollbar-arrow-buttons.md#L303) — drop the `Knowledge graph refresh` step.
    - [plans/npm-package.md:133](../npm-package.md#L133) — replace `graphify-out/` with `.codegraph/` in the publish-ignore list.
    - [plans/input-component-class-hierarchy-audit.md](../input-component-class-hierarchy-audit.md) — drop the `graphify update .` verification line.
    - [plans/layout-system-overhaul.md](../layout-system-overhaul.md) — drop two `graphify update .` steps; convert `graphify-out/GRAPH_REPORT.md` link in Overview + Critical Files to plain "Community NN" descriptions.
    - [plans/autocomplete-case-insensitive.md](../autocomplete-case-insensitive.md) — drop the `graphify update .` step; convert the `graphify-out/GRAPH_REPORT.md` Community 33/11 reference to plain text.
    - [plans/stylerule-constructor-redesign.md](../stylerule-constructor-redesign.md) — drop two `graphify update .` steps + the "Community 54" Critical Files link; rewrite the verification mentioning Community 54 as a plain note.
    - [plans/ui-component-bug-bash.md](../ui-component-bug-bash.md) — drop the `graphify update .` verification line.
    - [plans/picker-combobox-interaction-fix.md](../picker-combobox-interaction-fix.md) — drop the `graphify update` references in the Ordered Steps and the graph-refresh verification.
    - [plans/modal-glyph-theming.md](../modal-glyph-theming.md) — drop two `graphify update .` references.
    - [plans/rectify-inline-event-listeners.md](../rectify-inline-event-listeners.md) — drop the `graphify update .` verification line.
    → verify: `grep -rn 'graphify' plans/ — expect zero matches outside plans/in-progress/replace-graphify-with-codegraph.md itself (plans/implemented/ is historical, leave alone).`
12. **Delete memory files** `~/.claude/projects/-home-jika-typescript-typescript/memory/feedback_graphify_directed.md` and `.../project_graphify_corpus.md`. Edit `.../MEMORY.md` to remove the two corresponding index lines. → verify: `grep -n graphify ~/.claude/projects/-home-jika-typescript-typescript/memory/MEMORY.md — expect zero matches`.

Commit grouping follows the (now-four-bucket) `commit` skill:
- **Tooling** commit: steps 2–9, 12. All `.claude/**` and root-config edits plus memory deletion.
- **Tooling** commit (second, separate): step 10 — the `graphify-out/` deletion. Isolating the large diff keeps the first commit reviewable.
- **Bookkeeping** commit: step 11 — active-plan edits. Plans/ is bookkeeping per the existing rule.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `.claude/skills/_shared/codegraph.md` |
| Modify | `.claude/skills/plan/SKILL.md` (Required Reading + Verification example) |
| Modify | `.claude/skills/implement/SKILL.md` (Required Reading + bucket line + checklist) |
| Modify | `.claude/skills/debug/SKILL.md` (Required Reading) |
| Modify | `.claude/skills/commit/SKILL.md` (drop bucket #4, renumber, strip pitfalls/examples) |
| Modify | `.claude/settings.json` (remove PreToolUse hook) |
| Modify | `.gitignore` (add `.codegraph/`) |
| Modify | `plans/callable-inline-class.md` (drop graphify step) |
| Modify | `plans/layout-manager-place-component-split.md` (drop 3 graphify references) |
| Modify | `plans/scrollbar-arrow-buttons.md` (drop graphify step) |
| Modify | `plans/npm-package.md` (`graphify-out/` → `.codegraph/`) |
| Modify | `~/.claude/projects/-home-jika-typescript-typescript/memory/MEMORY.md` (drop 2 index lines) |
| Delete | `.claude/skills/_shared/graphify.md` |
| Delete | `graphify-out/` (entire tree) |
| Delete | `~/.claude/projects/-home-jika-typescript-typescript/memory/feedback_graphify_directed.md` |
| Delete | `~/.claude/projects/-home-jika-typescript-typescript/memory/project_graphify_corpus.md` |

---

## Verification

### Prerequisites (user, not implementer agent)

Before the implementer agent begins, the user has:

1. Installed CodeGraph: `curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh` (or `npx @colbymchenry/codegraph`).
2. Registered the MCP server in `~/.claude.json`:
   ```json
   {
     "mcpServers": {
       "codegraph": {
         "type": "stdio",
         "command": "codegraph",
         "args": ["serve", "--mcp"]
       }
     }
   }
   ```
3. (Optional) Added auto-allow permissions for `mcp__codegraph__*` to `~/.claude/settings.json`.
4. Run `codegraph init -i` from the project root to build the first `.codegraph/codegraph.db`.
5. Confirmed in a fresh Claude Code session that the `mcp__codegraph__*` tool list appears.

### Post-implementation checks

- **Grep invariants:**
  - `grep -rn 'graphify' .claude/ — expect zero matches.`
  - `grep -rn 'graphify' plans/ — expect zero matches.` (`plans/implemented/` is historical, leave it alone.)
  - `grep -rn 'graphify-out' . --exclude-dir=node_modules --exclude-dir=dist — expect zero matches.`
  - `grep -n graphify ~/.claude/projects/-home-jika-typescript-typescript/memory/MEMORY.md — expect zero matches.`
- **JSON validity:** `python3 -m json.tool .claude/settings.json > /dev/null` — exits 0.
- **`.gitignore` correctness:** `.codegraph/` line present; `git status` after a `codegraph init -i` shows no `.codegraph/**` in the change list.
- **Typecheck unchanged:** `npx tsc --noEmit` — 0 errors (unchanged baseline; this plan touches no `src/**`).
- **Docs build unchanged:** `npm run docs:build` — 0 errors, 0 link warnings (unchanged baseline; this plan touches no `docs/**`).

### Functional smoke (manual, in a fresh Claude Code session)

Reproduce three queries Graphify was being used for; confirm CodeGraph answers each via MCP tools:

1. **God-node equivalent / hub symbols.** Ask: "what are the most-called functions in `src/typescript/lib/core`?" Expected: agent invokes `mcp__codegraph__codegraph_callers` on candidates and returns a ranked list, hitting symbols like `Component`'s common methods (matches the kind of hub Graphify reported in `GRAPH_REPORT.md`).
2. **Cross-module dependency.** Ask: "what depends on `Theme.setTheme`?" Expected: `codegraph_callers` or `codegraph_impact` returns the call sites Graphify's directed graph used to surface.
3. **Impact analysis before a refactor.** Ask: "if I rename `getPreferredSize`, what breaks?" Expected: `codegraph_impact` returns the override chain and call sites — the use case that the `feedback_graphify_directed.md` memory was originally protecting (correct directionality of dependency edges).

If any of the three queries returns clearly worse results than `graphify-out/` was producing, stop and report — do not commit deletions until the user has signed off on the gap.

---

## Potential Challenges

- **CodeGraph watcher staleness.** Native file watchers can drop events on bulk operations (large rebases, branch switches). Mitigation: `codegraph_status` exposes index freshness; the `_shared/codegraph.md` rules call this out and document the `codegraph sync` fallback.
- **Loss of non-code edges.** Graphify extracted relationships from JSDoc, markdown, and PDFs that CodeGraph won't surface. Mitigation: the rollback tag plus the Verification smoke test catch this before the deletion commit lands. Long-term, fall back to grep on docs/ and JSDoc when CodeGraph misses a relationship.
- **Active-plan edits affect three plans the user is mid-work on.** Mitigation: confirm with the user that none of `callable-inline-class.md`, `layout-manager-place-component-split.md`, `scrollbar-arrow-buttons.md`, `npm-package.md` are currently being implemented (none are under `plans/in-progress/` per the implement-skill convention; verify before editing).
- **Memory deletions persist across projects.** The memory files at `~/.claude/projects/-home-jika-typescript-typescript/memory/` are project-scoped (the path includes `-home-jika-typescript-typescript`), so deletion here does not affect graphify memory for other projects. The user-level `~/.claude/skills/graphify/` skill stays — it's the user's, not the project's, and may be used elsewhere.

---

## Non-Goals

- **Replacing Graphify's doc/PDF/image/video extraction.** CodeGraph does not cover non-code artifacts. The user has accepted this tradeoff explicitly.
- **Building a CodeGraph equivalent of the `GRAPH_REPORT.md` god-node summary.** The MCP tool surface gives equivalent answers on demand; a pre-rendered report is not required.
- **Removing the user-level `~/.claude/skills/graphify/` skill.** That is a user-level installation, used across projects. Out of scope for this project's wiring.
- **Touching `plans/implemented/**`.** Those are historical artifacts. Their graphify references describe what was done at the time and should not be rewritten.
- **Modifying `src/**` or `docs/**`.** This is a tooling-only migration.

---

## Critical Files

The implementer must read each of these in full before editing:

- [`.claude/skills/_shared/graphify.md`](../.claude/skills/_shared/graphify.md) — the source of the replacement content's shape.
- [`.claude/skills/commit/SKILL.md`](../.claude/skills/commit/SKILL.md) — every graphify mention must be located and excised; renumbering the bucket list affects multiple sections.
- [`.claude/settings.json`](../.claude/settings.json) — JSON structure must survive hook removal cleanly.
- [`.claude/skills/plan/SKILL.md`](../.claude/skills/plan/SKILL.md), [`.claude/skills/implement/SKILL.md`](../.claude/skills/implement/SKILL.md), [`.claude/skills/debug/SKILL.md`](../.claude/skills/debug/SKILL.md) — each cites `_shared/graphify.md` in Required Reading; some cite `graphify update .` in body text.
- [`~/.claude/projects/-home-jika-typescript-typescript/memory/MEMORY.md`](~/.claude/projects/-home-jika-typescript-typescript/memory/MEMORY.md) — index entries to remove.
- The four active plans listed under step 11 — to confirm none are mid-implementation before edits.
