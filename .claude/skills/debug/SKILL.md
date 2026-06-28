---
name: debug
description: Investigate a bug, layout/sizing issue, or performance regression in this framework. Use when the user reports incorrect rendering, slow performance, broken behaviour, or asks why something isn't working.
---

## Required reading

- [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) — the framework rules a fix must not silently violate. A bug that goes away only because a typed setter was bypassed is not fixed.

## Where to work

Debug works where the buggy feature already lives — it does **not** create new worktrees. Run `git worktree list` to find out:

- **Existing worktree.** If the feature has a worktree (conventionally `.worktrees/<slug>`), do all investigation and fixes there.
- **Main tree.** Otherwise, if the feature is checked out in the main working tree, work there.
- **Neither.** If the feature is on a branch that is neither checked out in the main tree nor has a worktree, stop and ask the user how to proceed — do not create a worktree or switch the main tree's branch yourself.

## Approach

Root-cause first, fix second. Read the actual call chain. Don't propose a fix until you can name the function, class, or line that produced the wrong behaviour.

## Heuristics

- Before pursuing CSS-based fixes for layout/sizing issues, first check for explicit size constraints (`setMaxSize`, `setPreferredSize`, fixed toolbar heights) that may be the root cause.
- Always append `'px'` units to numeric DOM style values. A bare number assigned to `element.style.width` becomes the string `"42"`, which is invalid CSS — Chrome silently drops it.
- For slow rendering, profile for O(N²) lookups (e.g. `CSS.insertRule` scanning the rule list) and live-DOM mutation overhead before optimising elsewhere. The MiscPanel slow-table is the project's standing stress test; success bar is "decently fast with F12 open."

## Fixing: test-first

Once you've named the root cause, fix it **test-first** — the same discipline the [`implement`](~/.claude/skills/implement/SKILL.md) skill applies to new functionality, framed for a bug:

- Write a **regression test that reproduces the bug** before you touch the fix. It must fail against the current code, and fail for the *right reason* — it pins the **correct expected behaviour** (from the contract: JSDoc, signatures, how callers use it), never the buggy output the code currently emits. A test that passes before your fix is testing the wrong thing; watch it go red first.
- Then implement the fix until it goes green. One root cause at a time: red → green → next.
- When the root cause lives in a base class or shared helper, add a test at the lowest level that exercises the mechanism **and** one at the surface the bug was reported on, so a future refactor that relocates the fix still has to keep both honest.
- If the test fails in a way you didn't predict, stop and decide whether the bug is in your expectation or elsewhere — don't rewrite the assertion to match the code.

**Escape hatch — behaviour the offline harness can't exercise.** The recording DOM sink delivers no events to listeners, `elementsFromPoint` returns empty, and there is no real paint. For action-on-click, drag, focus, window resize, and visual output an automated red-green cycle is impossible (layout/sizing geometry, by contrast, *is* modelled offline via `TestDOM` — write the test). Where it's genuinely impossible, **describe the expected behaviour first** (a test comment or the bug write-up), fix, then verify with a documented step via the [`verify`](../verify/SKILL.md) or [`run`](../run/SKILL.md) skill — and say so explicitly. Describe-then-verify is the substitute when an automated test isn't possible, never a silent skip.

## After fixing

- Trigger `doLayout()` or equivalent re-render hooks at the surface where the bug appeared.
- Trace the inheritance chain and check sibling/dependent components for the same root cause — bugs in a base class typically affect more than the call site that surfaced the report.
- Enumerate call sites before declaring done; a refactor that fixes one path may have left others in the original broken state.
