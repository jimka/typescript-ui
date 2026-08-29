# Migration

Version-to-version breaking-change notes. Each version below links to its own
page covering one upgrade and listing the changes that need code updates. See
[Versioning policy](#versioning-policy) for what counts as a breaking change.

## Versions

- [Next](/reference/migration/next) — unreleased
- [0.8.0](/reference/migration/0.8.0) — upgrading from 0.7.0
- [0.6.0](/reference/migration/0.6.0) — upgrading from 0.5.0
- [0.5.0](/reference/migration/0.5.0) — upgrading from 0.4.1
- [0.4.1](/reference/migration/0.4.1) — upgrading from 0.4.0
- [0.4.0](/reference/migration/0.4.0) — upgrading from 0.2.x
- [0.2.0](/reference/migration/0.2.0) — upgrading from 0.1.x

A version with no page here made no breaking change from the one before it.

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
that require code updates do get a page here — [0.2.0](/reference/migration/0.2.0)
is one — so read the page for the version you are moving to rather than
relying on the version bump to tell you whether anything changed.

## Upgrade procedure

When moving to a new version:

1. Read the [Versions](#versions) list above for the version you are moving to, plus any version between it and the one you are on.
2. Update the dependency: `npm install @jimka/typescript-ui@<version>`.
3. Run `npm run typecheck` (or your equivalent) to surface signature mismatches.
4. Address each error using the corresponding migration page.
5. Run your test suite or manually exercise the app.

## See also

- [Changelog](/reference/changelog) — full release history.
- [GitHub releases](https://github.com/jimka/typescript-ui/releases) — release notes per version.
