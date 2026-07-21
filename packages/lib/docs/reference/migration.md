# Migration

Version-to-version breaking-change notes. Each entry below covers one upgrade
and lists the changes that need code updates. See [Versioning
policy](#versioning-policy) for what counts as a breaking change.

## Upgrading from 0.1.x to 0.2.0

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

The public API is not stable before `1.0.0`: any `0.x.y` release may break it,
and the version number alone is not a compatibility guarantee. Breaking changes
that require code updates do get an entry on this page — the `0.1.x` to `0.2.0`
note above is one — so read the entry for the version you are moving to rather
than relying on the version bump to tell you whether anything changed.

## Upgrade procedure

When moving to a new version:

1. Read the entry for that version above, plus any entry between it and the version you are on.
2. Update the dependency: `npm install @jimka/typescript-ui@<version>`.
3. Run `npm run typecheck` (or your equivalent) to surface signature mismatches.
4. Address each error using the corresponding migration note above.
5. Run your test suite or manually exercise the app.

## See also

- [Changelog](/reference/changelog) — full release history.
- [GitHub releases](https://github.com/jimka/typescript-ui/releases) — release notes per version.
