---
name: implement
description: Implement a pre-generated implementation plan from {workspace}/plans/. Use whenever the user asks you to implement, build, or carry out a plan that exists in plans/ — never open the plan and start editing source files freehand; this skill is the entry point and enforces the project's implementation flow.
---

## Required reading

Before producing any code or commits, read in full:

- [`CODE_CONVENTIONS.md`](../../../CODE_CONVENTIONS.md) — Code style, JSDoc, Framework rules, deferred DOM writes.
- [`.claude/skills/_shared/docs-conventions.md`](../_shared/docs-conventions.md) — Documentation updates, JSDoc cross-bucket links, typedoc-callable plugin.
- [`.claude/skills/_shared/plan-frontmatter.md`](../_shared/plan-frontmatter.md) — Optional plan frontmatter spec.
- [`.claude/skills/_shared/worktree.md`](../_shared/worktree.md) — Worktree location, creation, reuse, and no-op cleanup. All implementation work happens in a worktree under `.worktrees/`.

These contain the project's authoritative conventions. Sections below assume you've read them.

## Git workflow

All commits made during implementation follow the `commit` skill: bucket structure (code / documentation / tooling / bookkeeping), one-functionality-per-code-commit, and the title-plus-paragraph message format. Read [`../commit/SKILL.md`](../commit/SKILL.md) before making any commits.

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

Worktrees are parent-orchestrated, not harness-isolated, so every concurrent run lives under a predictable, browsable root (see [`_shared/worktree.md`](../_shared/worktree.md)).

Before fanning out, **track the whole batch on master in a single bookkeeping commit** per _In-progress lifecycle_: stage only the untracked plans being started (skip any already tracked, never stage other plans or unrelated changes) and commit them together, so every worktree branches from a master that already carries its plan. Then, per phase:

1. Pre-create a worktree per plan: `git worktree add .worktrees/<plan-slug> -b feature/<plan-slug>`.
2. Launch one `Agent` per plan, `subagent_type: "general-purpose"`, **without** `isolation: "worktree"` (worktrees already exist). Prompt each agent to `cd .worktrees/<plan-slug>` and re-enter this skill in single-plan mode for its assigned plan. The branch is already checked out — _Work Instructions_ step 3.5 detects this and stays on it.
3. Wait for the phase to complete before starting the next.
4. **Cleanup no-op worktrees** per `_shared/worktree.md`: for each returned branch with no commits beyond `master`, remove the worktree and delete the branch.
5. Surface each surviving worktree path and branch so the user can merge in order.

## In-progress lifecycle

**Invariant: an implement run must never leave an uncommitted change in the main working tree.** Every plan-file move is a `git mv` performed *inside the worktree* on `feature/<slug>` — the main tree is never edited, deleted from, or copied into. The historical "copy across and delete the main-tree copy" step is gone: it only avoided a git trace because plans used to be untracked, and once a plan was committed to master that delete landed as a dangling, never-committed deletion on master.

- **Track on master first (before any worktree exists).** Every plan in the batch being started must be tracked on master before its worktree is branched, so the worktree inherits the plan instead of needing a hand-copy. If a plan is still untracked (the `plan` skill leaves it so), commit it to master as a bookkeeping commit — staging **only** the plans being started, **one commit for the whole batch** (never one-per-plan), and never touching any other plan or unrelated change. A plan already tracked needs no commit.
- **Start of work (inside the worktree):** `git mv plans/<slug>.md plans/in-progress/<slug>.md`, commit as bookkeeping. The plan is already present because the worktree branched from a master that tracks it.
- **Completion (inside the worktree):** `git mv plans/in-progress/<slug>.md plans/implemented/<slug>.md`, commit as bookkeeping — the last commit on the branch.
- **Abort:** just remove the worktree and delete the branch. The main tree's `plans/<slug>.md` was never touched and stays on master, so nothing needs restoring.

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

In the worktree, before declaring done: `git fetch origin && git rebase origin/master`. Resolve any conflicts in the worktree and re-run typecheck + `docs:build` + smoke. Don't return a branch that won't merge.

## Audit

Before declaring done, run the [`audit`](../audit/SKILL.md) skill to get an independent fresh-context review of the implementation. Pass the target as **implemented plan + branch**: plan path `plans/implemented/<slug>.md` and branch `feature/<slug>`. Follow the audit skill's spawn protocol and prompt template — do not inline your own.

Implementation-specific handling of the returned report:
- BLOCKING empty → proceed to _Pre-termination checklist_.
- BLOCKING non-empty → fix each issue in a follow-up commit (separate from the original three-commit structure), then re-run the audit. Hard cap: 3 audit cycles. If still not converging, stop and surface the remaining findings to the user.

## Test-first

Implement each functionality **test-first**: write the test that pins its *expected* behaviour before the code exists, watch it fail, then implement until it passes. Take the expected behaviour from the plan's `## Expected Behaviour` / acceptance criteria and the contract (JSDoc, signatures, how callers use it) — **never** from whatever the code currently emits. Writing the test first makes that discipline automatic: with no implementation yet, there is no current output to anchor the assertion to.

- One functionality at a time: red (a failing test derived from the contract) → green (the minimal code that satisfies it) → next.
- If a contract-derived test fails in a way you didn't predict, stop and decide whether the bug is in the expectation or the surrounding code, and surface it — don't rewrite the assertion to match the code.

**Escape hatch — behaviour the offline harness can't exercise.** Large parts of this framework are not unit-testable offline: the recording DOM sink doesn't deliver events to listeners, `elementsFromPoint` returns empty, geometry is not measured. For action-on-click, drag, focus, window resize, and visual output, an automated red-green cycle is impossible. There, still **describe the expected behaviour first** (in the plan or a test comment), implement, then verify with a documented manual step via the [`verify`](../verify/SKILL.md) or [`run`](../run/SKILL.md) skill — and say so explicitly. The principle is *describe expected behaviour first, then implement, then verify*: an honest manual-verify step is the substitute when an automated test isn't possible, never a silent skip.

## Post-edit verification

Before treating any step as done, walk these in order:

- **Trigger re-render.** After multi-file changes, call `doLayout()` (or the equivalent re-render hook for the surface touched). Layout does not re-run automatically just because a backing field changed.
- **Refactor regression check.** When you change a setter's signature or semantics, re-test the original call sites. The canonical telltale: `setBorder()` with no args must preserve the existing border, not clear it. If a similar zero-arg-preserves-state contract exists for the setter you touched, exercise it.
- **Inheritance chain sweep.** A change in a base class or shared helper typically affects more than the call site that surfaced the request. Enumerate subclasses and sibling components that share the touched code path before declaring done.

## Pre-termination checklist

Walk this list before yielding control. Any unchecked item means you are not done:

- [ ] Plan file is at `plans/implemented/<slug>.md`
- [ ] Each new unit-testable behaviour is covered by a test written before its implementation and now passing; offline-untestable behaviour has a documented manual-verify step (never silently skipped)
- [ ] `npx tsc --noEmit` reports 0 errors
- [ ] `npm run docs:build` reports 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is acceptable)
- [ ] Audit returned no BLOCKING issues on the most recent cycle
- [ ] Commits follow the `commit` skill's bucket structure (code / docs / tooling / bookkeeping), plus any audit-fix commits
- [ ] Work was done in a worktree under `.worktrees/` (not the main tree), and the rebase-clean checkpoint passed

If any item is unchecked, resume at the appropriate step. Do not stop just because the last file write succeeded or the last command returned cleanly.

## Work Instructions

1. Resolve every plan name to `plans/<name>.md`. Reject if any file is missing.
2. **If >1 plan:** run _Order derivation_, confirm the schedule with the user, then per phase fan out per _Multi-plan dispatch_. Stop here as orchestrator.
3. **Single-plan mode:**
   1. Locate the plan per _Resume detection_. Skip the steps marked **(fresh only)** when resuming.
   2. Read the plan.
   3. Check the codebase for incompatibilities (renamed/removed APIs, signature changes, file moves, broken assumptions). Update the plan in place if drift is found.
   4. If incompatibilities were found, stop and ask the user to review.
   5. **(fresh only)** Track the plan on master, then branch the worktree. If the plan is still untracked, commit it to master first as a bookkeeping commit (staging only this plan — see _In-progress lifecycle_; a parent dispatch will already have done this for the batch in one commit). Then work in a worktree under `.worktrees/` per [`_shared/worktree.md`](../_shared/worktree.md) — never edit source in the main tree. If a parent dispatch already placed you in `.worktrees/<slug>` with `feature/<slug>` checked out, stay there. Otherwise create it: `git worktree add .worktrees/<slug> -b feature/<slug>`, then `cd .worktrees/<slug>`. Reuse an existing `.worktrees/<slug>` rather than duplicating it.
   6. **(fresh only)** Move the plan into in-progress per _In-progress lifecycle_: inside the worktree, `git mv plans/<slug>.md plans/in-progress/<slug>.md` and commit the move as bookkeeping. The plan is already tracked (step 5), so never copy from or delete in the main tree.
   7. Implement **test-first** (see _Test-first_): for each functionality, write the failing behavioural test before the code, then implement to green. On resume, pick up at the step identified by _Resume detection_.

      **Definition of done for this step:** every file in the plan's "Files to Create/Modify/Delete" table has been written; each functionality's expected behaviour was pinned by a test written before its implementation and now passes (or, where the offline harness can't exercise it, a documented manual-verify step substitutes); every entry in "Ordered Implementation Steps" is addressed; and `npx tsc --noEmit` is clean. Do not advance to step 8 until this clears. Running `git status` / `ls` and seeing reasonable output is not the same as verifying this list.
   8. Add a demo of the new feature to one of the demo panels, if applicable.
   9. Edit any `touches-shared` files last, one commit per file (_Shared-file etiquette_).
   10. `git mv plans/in-progress/<slug>.md plans/implemented/<slug>.md` (inside the worktree). Commit as bookkeeping.
   11. Update `docs/` per the rules in `_shared/docs-conventions.md`.
   12. Run _Rebase-clean checkpoint_.
   13. Run _Audit_. Fix any BLOCKING findings and re-audit until clean.
   14. Walk _Pre-termination checklist_. Yield only when every item is checked.
