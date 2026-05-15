---
name: plan
description: Produce an implementation plan for a described feature, saved as a markdown file in the {workspace}/plans folder using the project's established plan format.
---

## Purpose

Produce a written Markdown plan matching `{workspace}/plans/` conventions. Plans are design artefacts — they do **not** modify source code. Execution happens later via `/implement`.

## Work Instructions

1. **Understand the request.** Ask if scope, intended API, or integration points are unclear.
2. **Investigate.** Read relevant files. Cite real paths/lines — no invented files or APIs.
3. **Match style.** Skim a recent plan in `plans/` and an entry under `plans/implemented/` for tone.
4. **Draft** following the format below.
5. **Filename**: kebab-case, descriptive (e.g. `tab-reordering.md`).
6. **Save** to `{workspace}/plans/<name>.md`. Never `plans/implemented/` — that folder is for shipped plans.
7. **Report** the path and a one-sentence summary. Do not auto-implement.

## Plan Format

Descriptive, not rigid. Include a section only when it adds information. Canonical order:

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
Concrete checks: typecheck, grep invariants, manual smoke tests, theme-toggle, `npm run docs:build` (0 errors and 0 link warnings — typedoc's "unsupported TypeScript version" notice is the lone acceptable warning), `graphify update .`. Name the demo screen.

### `## Documentation Impact` (when public API changes)
- Which per-subpath barrel exports the symbol (`src/typescript/lib/<group>/index.ts` — there is no root barrel).
- Which curated page under `docs/<group>/` covers it; update its catalog `index.md` and the sidebar in `docs/.vitepress/config.mts`.
- Cross-bucket JSDoc references (need markdown links, not `{@link}`).
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
- **Respect CLAUDE.md.** Surgical changes, typed setters, `Event` class, one-element-per-class, theme tokens in `Theme.ts`. If the feature would violate one, flag it in Architecture Decisions.
- **Em-dash `—`** in titles and decision headings, not `--` or `-`.
- **`---` horizontal rules** between top-level sections.

## What Not To Do

- Don't modify source files.
- Don't put new plans in `plans/implemented/`.
- Don't invent files, classes, or APIs — verify before naming.
- Don't include "Next Steps" or "Future Work" — use `## Non-Goals`.
- Don't auto-run `/implement`.
