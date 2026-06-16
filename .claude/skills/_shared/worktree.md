# Worktree convention

File-modifying skills do their work in a git worktree under `.worktrees/`, never directly in the main working tree. This keeps the main tree on its current branch, isolates concurrent runs, and makes in-flight work browsable (`ls .worktrees/`).

## Location & naming

- Root: `.worktrees/<slug>` at the project root. `<slug>` is the kebab-case feature/plan name.
- Branch: `feature/<slug>`.
- `.worktrees/` is already in `.gitignore` — do not re-add it.

## Create

- New branch: `git worktree add .worktrees/<slug> -b feature/<slug>`.
- Existing branch (resume): `git worktree add .worktrees/<slug> feature/<slug>`.
- All file work — edits, plan drafts, commits — happens from inside `.worktrees/<slug>`. `cd` there first.

## Reuse before creating

Run `git worktree list` first. If `.worktrees/<slug>` already exists (a parent dispatch, an earlier run, or a paused implementation created it), use it instead of creating a duplicate.

## Remove no-op worktrees

A worktree that produced no commits beyond `master` — `git -C .worktrees/<slug> log feature/<slug> --not master` is empty — is cleaned up:

```
git worktree remove .worktrees/<slug>
git branch -D feature/<slug>
```

Surface every surviving worktree path and branch so the user can merge in order. Never merge, rebase onto a base branch, or push on the user's behalf.
