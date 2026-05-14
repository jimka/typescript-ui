# Migration

Version-to-version breaking-change notes. The framework is currently at **v1.0.0** — there is no prior version to migrate from.

This page will accumulate entries as the framework evolves.

## Versioning policy

The package follows [Semantic Versioning](https://semver.org):

- **Major** — breaking changes to the public API. Renamed or removed exports, changed function signatures, behaviour changes that require code updates.
- **Minor** — new features and additive changes. Existing code continues to work.
- **Patch** — bug fixes and internal improvements with no API impact.

The "public API" means everything re-exported from the per-group barrels at `src/typescript/lib/<group>/index.ts` (the entries listed in the [`package.json` `exports` map](https://github.com/jimka/typescript-ui/blob/master/package.json)). Internal modules — even those exported as side-effect of a class hierarchy — are subject to change without notice.

## Pre-1.0 compatibility

There is none. The framework's first published version is `1.0.0`. Earlier development snapshots of the source tree are not supported as upgrade targets.

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
