---
name: audit
description: Launch a fresh-context sub-agent to expertly audit a target — an implementation plan, a code change, a branch diff, a file, or an open-ended subject the user names. Use whenever the user asks for an independent audit, review, critique, or second opinion. The auditor is primed as both an expert reviewer and a domain expert in whatever the target requires.
---

## Purpose

Get an independent, expert review of a target the user names. The whole point is a **fresh context**: the reviewer inherits none of your reasoning, summaries, or judgements about the work — it forms its own opinion from the artefacts.

Generalised from the `implement` skill's _Expert review_ section ([`../implement/SKILL.md`](../implement/SKILL.md)). This skill stands alone and works on any target, not just freshly-implemented plans.

## Identify the target

Before spawning, pin down **what** is being reviewed. If the user's request is ambiguous, ask. Common shapes:

| Target | What to pass to the reviewer |
|---|---|
| Implementation plan | Plan path (`plans/<slug>.md`, `plans/in-progress/<slug>.md`, or `plans/implemented/<slug>.md`) |
| Implemented plan + branch | Plan path **and** branch (`feature/<slug>`) |
| Branch / PR diff | Branch + base (e.g. `feature/<x>` vs `master`) |
| Specific files | Absolute paths or globs |
| Open-ended subject | One-paragraph brief: what to review, where to find it, what "good" looks like |

If the user names a target you cannot locate (missing plan file, unknown branch), stop and ask rather than guess.

## Worktree

For branch-shaped targets (branch/PR diff, implemented-plan + branch), the review runs inside a worktree so the user's main tree keeps its current branch (see [`_shared/worktree.md`](../_shared/worktree.md)):

- **Reuse first.** Run `git worktree list`. If `.worktrees/<slug>` already exists for the branch — e.g. an `/implement` run created it — point the reviewer there. Do not remove it; it isn't yours.
- **Else create.** `git worktree add .worktrees/<slug> feature/<slug>`. After the reviewer returns, remove the worktree you created (`git worktree remove .worktrees/<slug>`); leave the branch alone.
- **In-place targets.** Plan files, specific files, and open-ended subjects are read where they sit — no worktree.

Pass the chosen worktree path to the reviewer (it must `cd` there before reading).

## Spawn the reviewer

Invocation: `Agent({ subagent_type: "general-purpose", description: "Expert review", prompt: <below> })`.

Adapt the **Target** and **Method** lines to the target shape. Keep the rule pointers and report shape verbatim — they are not negotiable.

> You are an independent expert reviewer for this project.
>
> **Required reading (in order, before forming any opinion):**
> 1. `ARCHITECTURE.md` — binding framework rules (event handling, one-element-per-class, typed setters, positioning, …).
> 2. `CODE_CONVENTIONS.md` — code style, JSDoc, framework rules, deferred DOM writes.
> 3. `.claude/skills/_shared/docs-conventions.md` — documentation rules (read only if the target touches public API or docs).
> 4. For plan reviews: `.claude/skills/plan/SKILL.md` (plan format) and `.claude/skills/_shared/plan-frontmatter.md` (optional frontmatter spec).
> 5. For implementation reviews: `.claude/skills/implement/SKILL.md` so you know what the implementer was required to do.
>
> **Where to work:** <worktree path, or "the main working tree">. If a worktree path is given, `cd` into it before reading anything — the target lives there, not in the main tree.
>
> **Target:** <one paragraph: what to review, where to find it, success criteria>.
>
> **Domain expertise:** before judging, read the surrounding code the target depends on or modifies — parent classes, mimicked components, layout managers, theme tokens, export surface, whatever applies. A reviewer who hasn't loaded the domain produces shallow findings. Become an expert in the slice you need before you judge.
>
> **Method:**
> - **Plan:** read the plan in full, verify every claim against the cited code (line numbers, APIs, file paths — plans must not invent any), and check conformance to the format in `.claude/skills/plan/SKILL.md`. Unavoidable rule violations must be flagged in the plan's `## Architecture Decisions`.
> - **Code change:** run `git diff <base>...<head>` (or read the named files) and audit the diff against the rule documents. If a plan exists, verify every entry in its `## Ordered Implementation Steps` and `## Files to Create / Modify / Delete` table is addressed.
> - **Open-ended subject:** read the relevant source, then judge against the rule documents and your domain reading.
>
> **Report — two lists, every item citing file:line:**
> - **BLOCKING:** correctness bugs, framework-rule violations, plan-format violations, missing plan items, regressions, type errors, doc-build breakage, factual inaccuracies (invented APIs, stale paths, wrong line numbers).
> - **ADVISORY:** style nits, refactor opportunities, future-work observations, things worth knowing but not required to act on.
>
> **Do not fix anything. Report only.** Be specific and concise — every finding cites a file:line and states what's wrong.

## After the reviewer returns

Surface the report to the user in full — both lists, citations preserved. Do not silently filter or compress findings.

Act only on user request:
- **BLOCKING** fixes: address each, then optionally re-spawn a fresh reviewer for a follow-up cycle (hard cap: 3 cycles before stopping and surfacing remaining findings).
- **ADVISORY** fixes: only when the user asks.

If this review is part of an `implement` flow, defer to the `implement` skill's _Expert review_ section — that flow has stricter loop semantics. This skill is for standalone reviews kicked off by the user.

## What Not To Do

- Don't perform the review yourself in the parent context. The point is an independent fresh-context read.
- Don't summarise or pre-filter the reviewer's findings.
- Don't auto-fix BLOCKING items unless the user asks.
- Don't paste your own analysis into the reviewer's prompt. Give it only the target + the rule pointers.
