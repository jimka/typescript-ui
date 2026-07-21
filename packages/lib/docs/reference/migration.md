# Migration

Version-to-version breaking-change notes. The framework follows [Semantic
Versioning](https://semver.org) with the pre-1.0 caveat below: anything may
change in any `0.x.y` release, including the public API.

## 0.1.0 → 0.2.0

`Component.setPreferredSize`, `setMinSize`, and `setMaxSize` now take a
single `Size` object instead of two loose numbers:

```typescript
// Before
sidebar.setPreferredSize(240, 0);
sidebar.setMinSize(180, 0);
sidebar.setMaxSize(360, 0);

// After
sidebar.setPreferredSize({ width: 240, height: 0 });
sidebar.setMinSize({ width: 180, height: 0 });
sidebar.setMaxSize({ width: 360, height: 0 });
```

`Size` is a structural interface (`{ width: number; height: number }`), so no
import is needed — an object literal with those two fields satisfies it.
There is no `(width, height)` overload and no deprecation window. Run `npm
run typecheck` after upgrading; every affected call site becomes a compile
error, so the type checker finds them all for you.

## Versioning policy

The package follows [Semantic Versioning](https://semver.org), with the standard pre-1.0 caveat:

- **`0.x.y` (pre-release)** — anything may change in any release, including breaking the public API. The package is in active development and not yet recommended for use outside the project itself.
- **`1.0.0` and beyond:**
  - **Major** — breaking changes to the public API. Renamed or removed exports, changed function signatures, behaviour changes that require code updates.
  - **Minor** — new features and additive changes. Existing code continues to work.
  - **Patch** — bug fixes and internal improvements with no API impact.

The "public API" means everything re-exported from the per-group barrels at `src/typescript/lib/<group>/index.ts` (the entries listed in the [`package.json` `exports` map](https://github.com/jimka/typescript-ui/blob/master/package.json)). Internal modules — even those exported as side-effect of a class hierarchy — are subject to change without notice.

## Pre-1.0 compatibility

None. Anything in a `0.x.y` release may change without a migration note. Once `1.0.0` ships, this page will start tracking breaking changes between subsequent major versions.

## Upgrade procedure

When a new major version is released:

1. Read this page from top to bottom for breaking changes that affect your code.
2. Update the dependency version: `npm install @jimka/typescript-ui@^X.0.0`.
3. Run `npm run typecheck` (or your equivalent) to surface signature mismatches.
4. Address each error using the corresponding migration note below.
5. Run your test suite or manually exercise the app.

## See also

- [Changelog](/reference/changelog) — full release history.
- [GitHub releases](https://github.com/jimka/typescript-ui/releases) — release notes per version.
