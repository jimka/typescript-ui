---
name: implement
description: Implement a pre-generated implementation plan from {workspace}/plans/. Use whenever the user asks you to implement, build, or carry out a plan that exists in plans/ — never open the plan and start editing source files freehand; this skill is the entry point and enforces the project's implementation flow.
---

## Required reading

Before producing any code or commits, read in full:

- [`CODE_CONVENTIONS.md`](../../../CODE_CONVENTIONS.md) — Code style, JSDoc, Framework rules, deferred DOM writes.
- [`.claude/skills/_shared/docs-conventions.md`](../_shared/docs-conventions.md) — Documentation updates, JSDoc cross-bucket links, typedoc-callable plugin.
- [`.claude/skills/_shared/graphify.md`](../_shared/graphify.md) — Use the knowledge graph (not grep) to investigate the codebase; run `graphify update .` once code edits land.
- [`.claude/skills/_shared/plan-frontmatter.md`](../_shared/plan-frontmatter.md) — Optional plan frontmatter spec.

These contain the project's authoritative conventions. Sections below assume you've read them.

## Git workflow

All commits made during implementation follow the `commit` skill: bucket structure (code / documentation / tooling / graphify / bookkeeping), one-functionality-per-code-commit, and the title-plus-paragraph message format. Read [`../commit/SKILL.md`](../commit/SKILL.md) before making any commits.

Implementation-specific notes that supplement the `commit` skill:

- Plan-file moves (`plans/` → `plans/in-progress/` → `plans/implemented/`) are bookkeeping commits — never fold them into the code commit.
- **Do not merge or rebase onto a base branch.** Leave for the user.
- **Do not push.** User publishes.

## Order derivation

When the batch has >1 plan and frontmatter is incomplete:

- **Hard deps:** grep each plan body for the kebab-case basenames of other plans in the batch; prose mentions become candidate `depends-on`. Show ambiguous matches; let the user accept/reject.
- **Soft conflicts:** parse each plan's `## Files to Create / Modify / Delete` table; any path in ≥2 plans is `touches-shared`.

Build a DAG from hard deps. Reject cycles. Topo-sort; within each level, greedy-group plans with disjoint `touches-shared` into parallel sets. Print the phase plan and confirm before fanning out. Do not write derived values back to plan files.

## Multi-plan dispatch

Worktrees are parent-orchestrated, not harness-isolated, so every concurrent run lives under a predictable, browsable root. Per phase:

1. Pre-create a worktree per plan: `git worktree add .worktrees/<plan-slug> -b feature/<plan-slug>`.
2. Launch one `Agent` per plan, `subagent_type: "general-purpose"`, **without** `isolation: "worktree"` (worktrees already exist). Prompt each agent to `cd .worktrees/<plan-slug>` and re-enter this skill in single-plan mode for its assigned plan. The branch is already checked out — _Work Instructions_ step 3.4 stays on it.
3. Wait for the phase to complete before starting the next.
4. **Cleanup no-op worktrees.** For each returned branch, if `git -C .worktrees/<plan-slug> log feature/<plan-slug> --not master` is empty, run `git worktree remove .worktrees/<plan-slug>` and `git branch -D feature/<plan-slug>`.
5. Surface each surviving worktree path and branch so the user can merge in order.

Add `.worktrees/` to `.gitignore` once at the project root. The path is conventional and lets the user `ls .worktrees/` between phases to inspect in-flight work.

## In-progress lifecycle

- Start of work: move plan from `plans/` to `plans/in-progress/`. Commit.
- Completion: move from `plans/in-progress/` to `plans/implemented/` in the code commit.
- Abort: move back to `plans/`.

`plans/in-progress/` acts as a soft lock — other invocations should skip plans listed there.

## Resume detection

When entering single-plan mode, locate the plan:

- `plans/<slug>.md` → **fresh start**.
- `plans/in-progress/<slug>.md` → **resume**. Skip the fresh-start steps in _Work Instructions_. Confirm the matching worktree (`cd .worktrees/<slug>`); if missing but the branch exists, recreate it with `git worktree add .worktrees/<slug> feature/<slug>`. If neither worktree nor branch exists, abort and ask the user.
- `plans/implemented/<slug>.md` → **already done**. Stop and confirm with the user before treating it as a new run.
- None of the above → reject the invocation.

On resume, before implementing further, reconstruct progress: `git log feature/<slug> --not master` for committed work, `git status` for uncommitted edits, and map both back to the plan's `## Ordered Implementation Steps`. State which step you'll pick up at; confirm with the user if the mapping is ambiguous.

## Shared-file etiquette

When `touches-shared` is non-empty: edit each shared file last; one atomic commit per shared file; keep diffs minimal.

## Rebase-clean checkpoint

In worktree mode, before declaring done: `git fetch origin && git rebase origin/master`. Resolve any conflicts in the worktree and re-run typecheck + `docs:build` + smoke. Don't return a branch that won't merge.

## Expert review

Before declaring done, spawn a sub-agent to review the implementation with a fresh context window. The review must be independent: the sub-agent gets only the plan path and branch name, not your reasoning or summary of what you did.

Invocation: `Agent({ subagent_type: "general-purpose", description: "Implementation review", prompt: <below> })`.

Prompt template:

> Review the implementation of plan `plans/implemented/<slug>.md` on branch `feature/<slug>`. Start by reading the plan in full, then read `CODE_CONVENTIONS.md` and `.claude/skills/_shared/docs-conventions.md` for the project's authoritative rules. Then run `git diff master...HEAD` and audit the diff against those rules. Verify every entry in the plan's Ordered Implementation Steps and Files to Create/Modify/Delete table is addressed.
>
> Return two lists, citing file paths and line numbers:
> - **BLOCKING:** correctness bugs, missing plan items, framework-rule violations, regressions, type errors, doc-build breakage.
> - **ADVISORY:** style nits, refactor opportunities, future-work observations.
>
> Do not fix anything. Report only.

On return:
- BLOCKING empty → proceed to _Pre-termination checklist_.
- BLOCKING non-empty → fix each issue in a follow-up commit (separate from the original three-commit structure), then re-spawn a fresh reviewer. Hard cap: 3 review cycles. If still not converging, stop and surface the remaining findings to the user.

## Post-edit verification

Before treating any step as done, walk these in order:

- **Trigger re-render.** After multi-file changes, call `doLayout()` (or the equivalent re-render hook for the surface touched). Layout does not re-run automatically just because a backing field changed.
- **Refactor regression check.** When you change a setter's signature or semantics, re-test the original call sites. The canonical telltale: `setBorder()` with no args must preserve the existing border, not clear it. If a similar zero-arg-preserves-state contract exists for the setter you touched, exercise it.
- **Inheritance chain sweep.** A change in a base class or shared helper typically affects more than the call site that surfaced the request. Enumerate subclasses and sibling components that share the touched code path before declaring done.

## Pre-termination checklist

Walk this list before yielding control. Any unchecked item means you are not done:

- [ ] Plan file is at `plans/implemented/<slug>.md`
- [ ] `npx tsc --noEmit` reports 0 errors
- [ ] `npm run docs:build` reports 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is acceptable)
- [ ] Expert review returned no BLOCKING issues on the most recent cycle
- [ ] Commits follow the `commit` skill's bucket structure (code / docs / tooling / graphify / bookkeeping), plus any review-fix commits
- [ ] If in worktree mode: rebase-clean checkpoint passed

If any item is unchecked, resume at the appropriate step. Do not stop just because the last file write succeeded or the last command returned cleanly.

## Work Instructions

1. Resolve every plan name to `plans/<name>.md`. Reject if any file is missing.
2. **If >1 plan:** run _Order derivation_, confirm the schedule with the user, then per phase fan out per _Multi-plan dispatch_. Stop here as orchestrator.
3. **Single-plan mode:**
   1. Locate the plan per _Resume detection_. Skip the steps marked **(fresh only)** when resuming.
   2. Read the plan.
   3. Check the codebase for incompatibilities (renamed/removed APIs, signature changes, file moves, broken assumptions). Update the plan in place if drift is found.
   4. If incompatibilities were found, stop and ask the user to review.
   5. **(fresh only)** If on `master`, create and check out `feature/<short-feature-slug>`. Otherwise stay on the current branch.
   6. **(fresh only)** Move the plan from `plans/` to `plans/in-progress/`. Commit.
   7. Implement. On resume, pick up at the step identified by _Resume detection_.

      **Definition of done for this step:** every file in the plan's "Files to Create/Modify/Delete" table has been written, every entry in "Ordered Implementation Steps" is addressed, and `npx tsc --noEmit` is clean. Do not advance to step 8 until this clears. Running `git status` / `ls` and seeing reasonable output is not the same as verifying this list.
   8. Extend demo panel(s) where applicable.
   9. Edit any `touches-shared` files last, one commit per file (_Shared-file etiquette_).
   10. Move plan from `plans/in-progress/` to `plans/implemented/`. Commit as bookkeeping.
   11. Update `docs/` per the rules in `_shared/docs-conventions.md`.
   12. Run _Rebase-clean checkpoint_.
   13. Run _Expert review_. Fix any BLOCKING findings and re-review until clean.
   14. Walk _Pre-termination checklist_. Yield only when every item is checked.
