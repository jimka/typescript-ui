---
name: plan
description: Produce an implementation plan for a described feature, saved as a markdown file in {workspace}/plans/ using the project's established plan format. Use whenever the user asks for a plan, design, or approach for non-trivial work — never hand-write plan markdown freehand; this skill enforces the format the `implement` skill consumes.
---

## Required reading

Before drafting, read in full:

- [`CODE_CONVENTIONS.md`](../../../CODE_CONVENTIONS.md) — Code style, JSDoc, Framework rules. Plans must not silently violate these; flag any unavoidable violation in `## Architecture Decisions`.
- [`.claude/skills/_shared/docs-conventions.md`](../_shared/docs-conventions.md) — What docs need to change when public API moves. Cited from `## Documentation Impact`.
- [`.claude/skills/_shared/plan-frontmatter.md`](../_shared/plan-frontmatter.md) — Optional plan frontmatter spec.

## Purpose

Produce a written Markdown plan matching `{workspace}/plans/` conventions. Plans are design artefacts — they do **not** modify source code. Execution happens later via `/implement`.

## Work Instructions

**Every plan is drafted by a spawned sub-agent — never by the parent context.** Investigation (reading files, grepping, walking the codebase) pollutes the parent's working memory with details that are no longer needed once the plan is on disk. Pushing the work into a sub-agent keeps the parent context lean for the user's next request and forces a self-contained, file-only artefact.

1. **Understand the request.** Ask if scope, intended API, or integration points are unclear. Do this in the parent context, before spawning.
2. **Pick the filename(s).** Kebab-case, descriptive (e.g. `tab-reordering.md`). For a single plan, derive one name; for multiple independent plans, derive each before dispatch and confirm they differ.
3. **Spawn one sub-agent per plan.** Use the `Agent` tool with `subagent_type: "general-purpose"`. Send each invocation in a single message — when there are multiple, they run in parallel (see _Parallel Plans_ below for the relatedness check). The parent does no file reading on behalf of the plan after this point; the sub-agent does it.
4. **Brief each sub-agent** per _Spawned-agent prompt rules_ below.
5. **Report all paths together** when the agents return. Do not auto-implement.

## Spawned-agent prompt rules

Every spawned plan agent gets a self-contained prompt because sub-agents don't inherit this skill. Each prompt must:

- Start with: `Read /home/jika/typescript/typescript/.claude/skills/plan/SKILL.md first and follow it exactly. Do not modify source code — produce a Markdown plan only.` This pulls the skill in fresh on the sub-agent side, so the **Plan Format**, **Style**, and **What Not To Do** sections below apply to the sub-agent's output without you needing to paste them.
- **Name the output filename up front** (kebab-case, derived from the feature) as the absolute path `{workspace}/plans/<name>.md`. Tell it to confirm via `ls plans/` that it doesn't collide.
- **Scope narrowly:** one feature, the files it should investigate, the success criteria, and any architecture decisions you've already made for it. Hand over the **question**, not a script of steps — the sub-agent's job is to read code and form judgements, not to follow your prescriptions.
- **Tell it to report back only the final path and a one-sentence summary.** Do not ask it to dump the plan body into the response — the file on disk is the artefact.

## Parallel Plans

When the user asks for **multiple independent plans in one request**, every plan still goes through its own sub-agent (per Work Instructions step 3). The parallelism is just sending the multiple `Agent` calls in a single message so they run concurrently. Skip the parallel send for related plans that should cross-reference each other's decisions — spawn them sequentially so each can read what the previous wrote.

Additional rules when fanning out:

- **Confirm filenames differ before dispatch** so two agents don't race on the same path.
- After all agents return, **report all paths together** in one message. Do not auto-implement any of them.

If the features turn out to share architecture or touch the same files, abort the fan-out and plan them sequentially instead — coherence beats throughput.

When you can confidently identify cross-plan dependencies (hard deps in the prose, shared files in the `## Files to Create / Modify / Delete` tables), set the `depends-on` and `touches-shared` frontmatter keys on each plan (spec: `.claude/skills/_shared/plan-frontmatter.md`). When in doubt, omit them — `/implement` derives missing values per its _Order derivation_ rules.

After all parallel agents return, emit a short phase plan in the closing summary (the same shape `/implement` will derive) so the user can see the suggested execution order alongside the file paths.

## Plan Format

Descriptive, not rigid. Include a section only when it adds information. Canonical order:

### Frontmatter (optional)
YAML block at line 1, listing `depends-on` and/or `touches-shared`. Spec: `.claude/skills/_shared/plan-frontmatter.md`. Omit when uncertain; `/implement` derives missing values.

### Title (required)
`# {Feature Name} — Implementation Plan` (em-dash `—`, not `--`).

### `## Overview` (required)
One to three short paragraphs: *what* is being built, *where* it lives, *what* it touches. Cite files as `[Path/To/File.ts:LINE](../src/.../File.ts#LLINE)`. End with `---`.

### `## Architecture Decisions` (almost always)
Series of `### {Decision}` subsections, each a short paragraph stating the choice and rationale. Include rejected alternatives only when the rejection sharpens the explanation.

### `## Public API (TypeScript Signatures)` (when APIs change)
Code blocks per exported class/interface, signatures only. Include `extends`/`implements` and any TS tricks the implementer must use.

**For any new DOM property:** name the typed setter (e.g. `setLineHeight`), the cached backing field (`_lineHeight`), and the matching `XOptions` field. `/implement` enforces full call-site routing and option forwarding.

### `## Theme Tokens` (when CSS custom properties are added)
Table: `CSS Custom Property | Light Default | Dark Default | Purpose`. Note which `Theme.ts` blocks need entries (`Theme`, `DefaultTheme`, `DarkTheme`, `themeToVars`).

### `## Internal Structure` / `## Implementation` (when helpful)
Short snippets for non-obvious logic only — DOM tree, private state shape, key method bodies.

### `## Ordered Implementation Steps` (required)
Numbered steps. Each names the file and what to do. Include cheap regression checkpoints (e.g. `grep -rn 'fontawesome' src/ — expect zero matches`).

### `## Files to Create / Modify / Delete` (required)
Table: `Action | File`.

### `## Verification` (when behaviour is testable)
Concrete checks: typecheck, grep invariants, manual smoke tests, theme-toggle, `npm run docs:build` (0 errors and 0 link warnings — typedoc's "unsupported TypeScript version" notice is the lone acceptable warning). Name the demo screen.

### `## Documentation Impact` (when public API changes)
- Which per-subpath barrel exports the symbol (`src/typescript/lib/<group>/index.ts` — there is no root barrel).
- Which curated page under `docs/<group>/` covers it; update its catalog `index.md` and the sidebar in `docs/.vitepress/config.mts`.
- Cross-bucket JSDoc references (need markdown links, not `{@link}` — see `_shared/docs-conventions.md`).
- Renames/removals: list every doc page referencing the old name (`grep -rln '\bOldName\b' docs/`).

Skip for internal refactors and bug fixes.

### `## Potential Challenges` (when there are gotchas)
Bullets, each with one-sentence mitigation.

### `## Critical Files` (almost always)
Reference files the implementer must read — parent classes, mimicked components, theme tokens, export surface.

### `## Non-Goals` (when scope creep is a risk)
Bullets stating what's intentionally out, with reason.

## Style

- **Concise and opinionated.** State the choice, not a survey.
- **Cite real code.** Every path exists; line numbers accurate at write time.
- **No filler.** No "this section will…", no "in conclusion…".
- **Respect CLAUDE.md and `CODE_CONVENTIONS.md`.** Surgical changes, typed setters, `Event` class, one-element-per-class, theme tokens in `Theme.ts`. If the feature would violate one, flag it in `## Architecture Decisions`.
- **Em-dash `—`** in titles and decision headings, not `--` or `-`.
- **`---` horizontal rules** between top-level sections.

## What Not To Do

- Don't modify source files.
- Don't put new plans in `plans/implemented/`.
- Don't invent files, classes, or APIs — verify before naming.
- Don't include "Next Steps" or "Future Work" — use `## Non-Goals`.
- Don't auto-run `/implement`.
