---
name: debug
description: Investigate a bug, layout/sizing issue, or performance regression in this framework. Use when the user reports incorrect rendering, slow performance, broken behaviour, or asks why something isn't working.
---

## Required reading

- [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) — the framework rules a fix must not silently violate. A bug that goes away only because a typed setter was bypassed is not fixed.

## Approach

Root-cause first, fix second. Read the actual call chain. Don't propose a fix until you can name the function, class, or line that produced the wrong behaviour.

## Heuristics

- Before pursuing CSS-based fixes for layout/sizing issues, first check for explicit size constraints (`setMaxSize`, `setPreferredSize`, fixed toolbar heights) that may be the root cause.
- Always append `'px'` units to numeric DOM style values. A bare number assigned to `element.style.width` becomes the string `"42"`, which is invalid CSS — Chrome silently drops it.
- For slow rendering, profile for O(N²) lookups (e.g. `CSS.insertRule` scanning the rule list) and live-DOM mutation overhead before optimising elsewhere. The MiscPanel slow-table is the project's standing stress test; success bar is "decently fast with F12 open."

## After fixing

- Trigger `doLayout()` or equivalent re-render hooks at the surface where the bug appeared.
- Trace the inheritance chain and check sibling/dependent components for the same root cause — bugs in a base class typically affect more than the call site that surfaced the report.
- Enumerate call sites before declaring done; a refactor that fixes one path may have left others in the original broken state.
