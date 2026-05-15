---
name: plan
description: Produce an implementation plan for a described feature, saved as a markdown file in the {workspace}/plans folder using the project's established plan format.
---

## Purpose

Given a description of a feature or change, produce a written implementation plan in the same Markdown format as the existing files in `{workspace}/plans/` and save it to that folder. The plan is a design artefact — it does **not** modify source code. Implementation is performed later by the `implement` skill.

---

## Work Instructions

1. **Understand the request.** Read the feature description carefully. If something material is unclear or ambiguous (scope, intended API, integration points), ask before drafting — per CLAUDE.md "Think Before Coding".
2. **Investigate the codebase.** Read the relevant existing files, look for established patterns (similar components, layout managers, etc.), and identify integration points (`Theme.ts`, `index.ts`, parent classes, related plans). The plan must cite real files/lines, not invented ones.
3. **Skim a recent plan** in `plans/` (e.g. the most recently added) for tone/structure, and the corresponding `plans/implemented/` entries for sense of how shipped plans look. Match that style.
4. **Draft the plan** following the format below.
5. **Choose a filename**: kebab-case, descriptive, no `.md` redundancy in the name itself. Example: `tab-reordering.md`, `image-cell-renderer.md`. Match existing file-naming style in `plans/`.
6. **Save** to `{workspace}/plans/<name>.md`. Never put it directly in `plans/implemented/` — that folder is for plans the user has finished implementing.
7. **Report** the path and a one-sentence summary back to the user. Do not auto-implement; the user will trigger that separately via `/implement`.

---

## Plan Format

The format is descriptive, not rigid. Every plan starts with a title and an Overview. The remaining sections appear *only when they add information* — omit a section rather than padding it. The order below reflects the canonical sequence used in the existing plans.

### Title (required)

`# {Feature Name} — Implementation Plan`

The em-dash (`—`) is the established separator. Variants like `Component — FontAwesome Replacement Plan` are acceptable when more specific.

### `## Overview` (required)

One to three short paragraphs. State *what* is being built, *where* it lives in the codebase, and *what existing pieces it touches*. Cite real files using markdown links of the form `[Path/To/File.ts:LINE](../src/.../File.ts#LLINE)` when referencing specific call sites or constants. End with `---` separator.

### `## Architecture Decisions` (almost always present)

The opinionated heart of the plan. A series of short subsections, each headed by a `### {Decision title}` and one short paragraph explaining the choice and the rationale. Include the rejected alternative when it sharpens the explanation. Examples of decision titles seen in existing plans:

- "Curated registry, not auto-extraction"
- "`SpinButton extends Button` (not `Component`)"
- "Native `<select multiple>` element"
- "Z-index layering" (often presented as a small table)

End with `---`.

### `## Public API (TypeScript Signatures)` (when the change adds or changes exported APIs)

A code block per exported class/interface, with method signatures only — no bodies. Include the `extends`/`implements` clause and any unusual TypeScript tricks (e.g. `declare` for type narrowing) that the implementation will rely on. End with `---`.

### `## Theme Tokens` (when the change introduces CSS custom properties)

A small markdown table:

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-foo-bar` | `value` | `value` | what it controls |

Followed by a sentence on which `Theme.ts` blocks need the new entries (`Theme` interface, `DefaultTheme`, `DarkTheme`, `themeToVars`).

### `## Internal Structure` / `## Implementation` (when helpful)

Diagrams (ASCII tree of the DOM/component hierarchy), private state shape, key private method bodies — short snippets only, not the whole class. Reserve full code for ambiguous or non-obvious logic.

### `## Ordered Implementation Steps` (required)

A numbered or `### Step N — title` sequence describing the order of changes. Each step states the file affected and what to do. Steps should be small enough to execute and verify independently. Include grep/typecheck checkpoints where they catch regressions cheaply (e.g. "`grep -rn 'fontawesome' src/` — expect zero matches"). End with `---`.

### `## Files to Create / Modify / Delete` (required)

A markdown table:

| Action | File |
|---|---|
| Create | `path/to/NewFile.ts` |
| Modify | `path/to/ExistingFile.ts` |
| Delete | `path/to/Removed.ts` |

End with `---`.

### `## Verification` (when the plan ships behaviour the user will test)

A numbered list of concrete checks: typecheck commands, grep invariants, manual smoke tests, theme-toggle tests, layout-regression checks, `npm run docs:build` (0 errors and 0 link warnings is the bar — the lone acceptable warning is typedoc's "unsupported TypeScript version" notice), and `graphify update .` to refresh the knowledge graph. Be specific — name the demo screen or window the user should open.

### `## Documentation Impact` (when the plan adds, removes, or restructures public symbols)

A short section enumerating the doc work required:

- Which per-subpath barrel needs the new symbol exported (`src/typescript/lib/<group>/index.ts`). Every public symbol must travel through one and only one barrel — there is no root barrel.
- Which curated `.md` page under `docs/<group>/` covers the symbol (create if it's a brand-new class; update the catalog `docs/<group>/index.md` and the sidebar in `docs/.vitepress/config.mts` either way).
- Cross-bucket JSDoc references: the plan should call out any place where the new class is referenced from JSDoc in a *different* subpath — those references need the markdown link form `[\`Foo\`](/api/<subpath>/<kind>/Foo)` rather than `{@link Foo}`, since `{@link}` only resolves within the same entry-point bucket.
- If the plan renames or removes an existing exported symbol: list every doc page that currently references it (a quick `grep -rln '\bOldName\b' docs/`) so the implementer doesn't miss a stale link or alias.

Skip this section for bug fixes and internal refactors that don't touch the public API surface.

### `## Potential Challenges` (when there are real gotchas)

Bullet points naming each pitfall with a one-sentence mitigation. Skip if there are none worth flagging.

### `## Critical Files` (almost always present)

Bullet list of the files an implementer must read before touching code — parent classes, the file the new class mimics, theme tokens, the export surface. These are the *reference* files, not necessarily files being modified.

### `## Non-Goals` (when scope creep is a real risk)

Bullets stating what is intentionally **not** covered, with a short reason. Helpful when reviewers might assume the plan does more than it does.

---

## Tone and Style

- **Concise and opinionated.** Plans state the chosen approach, not a survey of all possibilities. Mention rejected alternatives only when the rejection is the interesting decision.
- **Cite real code.** Every file path must exist; every line number should be accurate at the time of writing. Use `[Path:LINE](../path#LLINE)` markdown links.
- **No filler.** No "this section will describe…", no "in conclusion…". Just say the thing.
- **Adhere to CLAUDE.md.** The plan must respect the project's coding guidelines: surgical changes, simplicity first, framework setter API over direct DOM, `Event` class for listeners, one-element-per-class, theme tokens in `Theme.ts`. If the requested feature would violate one of these, flag it in Architecture Decisions instead of silently working around it.
- **Specify the typed-setter surface for any new DOM property.** When the plan introduces a new CSS rule, attribute, or any other DOM write that the framework doesn't already cover, name the typed setter to add (e.g. `setLineHeight(value: number | string)` on `Glyph`) and the cached backing field that goes with it (e.g. `private _lineHeight: string | null = null;`). Three non-negotiable rules: (1) every call site — including constructors — writes through the typed setter, never through `setElementCSSRule` / `setElementCSSRules` / `setElementStyle` / `setElementAttribute` / `removeElementAttribute` directly; (2) every DOM write caches the value in a class field, so subsequent reads never hit the DOM; (3) every typed setter has a matching optional field on the class's `XOptions` bag and is forwarded from `applyOptions(options)`, so the construction-time and post-construction APIs stay in lockstep. The same rules apply to matching `clearX` / `removeX` companions. List the setter, backing field, and option in the `## Public API` section so the implementer has a single place to look.
- **Em-dash separators.** Plans use `—` (U+2014) in titles and Architecture Decision headings, not `--` or `-`.
- **Section dividers.** A `---` horizontal rule between top-level sections.

---

## What Not To Do

- Do **not** modify any source files. The plan is a `.md` document; nothing else changes.
- Do **not** put the new plan in `plans/implemented/` — that subfolder is for plans the user has already implemented.
- Do **not** invent files, classes, or APIs. Verify via Read/grep before naming them.
- Do **not** include a "Next Steps" or "Future Work" section unless the user asks; use `## Non-Goals` instead.
- Do **not** auto-run `/implement` after producing the plan. Hand it back to the user.
