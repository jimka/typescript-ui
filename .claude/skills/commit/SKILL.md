---
name: commit
description: Stage and commit work on a feature branch using the project's commit-bucket structure (code / documentation / tooling / bookkeeping), the one-functionality-per-code-commit rule, and the title-plus-paragraph message format. Use whenever the user asks you to commit on a `feature/*` branch, including follow-up commits after `/implement` has finished.
---

## When to use

- The user asks you to commit changes on a `feature/*` branch.
- You are about to commit at the end of a task, whether `/implement` drove the work or you arrived ad-hoc.
- Follow-up fixes, demo additions, or doc tweaks that land on a feature branch *after* `/implement` has wrapped — these are the cases that escape the `implement` skill's order rule, because `implement` has already exited.

For one-off commits on `master` or unrelated maintenance branches, fall back to a single conventional commit; the bucket rule below does not apply.

## Commit buckets

Every commit on a feature branch falls into exactly one of four buckets:

1. **Code** — one commit per *functionality* (see next section). Touches `src/**`, demo-panel updates, theme tokens / CSS, barrel exports, dependency fixes required for the functionality.
2. **Documentation** — one commit per functionality. Touches `docs/**`, changelog, migration notes. Auto-generated `docs/api/**` is included only if hand-edited.
3. **Tooling** — one commit per *tooling functionality*. Touches `.claude/**`, `ARCHITECTURE.md`, `CLAUDE.md`, and other repo-level governance or developer-workflow files. Tooling changes shape how the project is built or maintained but aren't shipped to library consumers, so they're a separate concern from feature code and product documentation.
4. **Bookkeeping** *(optional, any number)* — plan-file moves (`plans/` → `plans/in-progress/` → `plans/implemented/`) and similar pure-housekeeping changes. **Must contain only bookkeeping** — never fold housekeeping into a code, docs, or tooling commit. The move to `plans/implemented/` is always the very last commit on the branch, since it signals the work is complete.

Ordering rules:
- Within a single feature: code → docs.
- Tooling commits stand alone and may appear anywhere in the sequence; they don't trigger a docs commit by themselves.
- Bookkeeping commits may appear anywhere, except the plan-implemented move which always lands last.

**Follow-up changes.** If new changes arrive on the branch after the initial cycle (a bug found in review, a demo tweak, a doc fix), re-run the cycle for that new functionality: code, then docs.

## What counts as "one functionality"

A *functionality* is a user-facing capability, fix, or refactor — not a sub-step of one. Everything required to make that functionality work belongs in the same code commit, even when the changes span multiple files, subpaths, or layers.

When shipping a feature, the following all roll up into the **single** feature commit:

- The new component / class / function itself.
- Theme tokens, CSS, or assets the feature uses.
- Barrel exports needed to expose new public symbols.
- Type-system additions (new typed setters, enums) introduced *for* the feature.
- Bug fixes in dependencies discovered while wiring the feature up, when the fix exists only because the feature needs it.
- Demo-panel updates that exercise the feature (unless added much later — then they're a follow-up).

Split into multiple code commits **only** when the branch ships genuinely independent functionalities — e.g., a status-bar feature *and* an unrelated layout bug found mid-stream. The test: would each piece make sense on its own branch? If no, it's one commit.

## Commit message format

```
<one-sentence title>

<at most one paragraph describing the commit>
```

- **Title:** a single sentence, **80 characters max**. Starts with a capital letter and uses imperative mood ("Add", "Fix", "Refactor"). **No conventional-commit prefixes** (`feat(...)`, `fix(...)`, `docs(...)`, `chore(...)`) — the bucket is conveyed by the wording, not a tag. The existing history uses prefixes; do not copy that pattern.
- **Blank line** between title and body.
- **Body:** at most one paragraph, with each line wrapped at **80 characters max**. Explain *why* the change exists or *what* it enables, not a line-by-line restatement of the diff. The body is the default; omit it only when the title is genuinely self-explanatory (plan-file moves, trivial typo fixes).
- **No bullet lists, no headings, no checklists** in the body — one prose paragraph.
- **No author / co-author trailers.** No `Co-Authored-By:`, no "Generated with …" line.

This format is new. The repo's existing history mixes title-only messages with conventional-commit prefixes; do not use either as a template.

## Workflow

1. Run `git status` and `git diff` to see what's staged and unstaged.
2. Group changed paths into the four buckets. If the code or tooling bucket spans multiple genuinely independent functionalities, partition further.
3. For each commit, stage only that commit's files (`git add <paths>` — never `git add -A` or `git add .`), then commit with the format above. Pass the message via a HEREDOC so the blank line survives:
   ```
   git commit -m "$(cat <<'EOF'
   <title>

   <paragraph>
   EOF
   )"
   ```
4. After each commit, run `git status` to confirm only the intended files were committed.
5. Do **not** push, merge, or rebase onto a base branch — leave that for the user.

## Common pitfalls

- **Splitting one functionality into many code commits.** A new component plus its theme tokens plus the barrel export plus the typed-API fix it needed is *one* feature, hence *one* code commit.
- **Mixing bookkeeping into a code/docs/tooling commit.** If a plan-file move belongs alongside the feature, commit it separately as bookkeeping — don't tuck it into the feature commit and mention it in the body.
- **Putting tooling changes into the code bucket.** Skill updates, CLAUDE.md edits, and ARCHITECTURE.md additions are tooling, not code, even when they were prompted by a feature you just shipped.
- **Defaulting to title-only messages.** The history will tempt you; write a body unless the change is genuinely trivial.
