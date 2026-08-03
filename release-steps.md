
## Update version string

Update version in the following files:
- packages/create-app/package.json
- packages/create-app/template/package.json
- packages/docs/package.json
- packages/lib/package.json

Run `npm install --package-lock-only` at the root to update package-lock.json

## Verify publish readiness.

Verify that the changelog and migration guides looks ok and contains everything in the coming version.

Run from root:
- npm run test
- npm run lint
- npm run typecheck
- npm run build:lib

And make sure everything looks OK!

Run in packages/lib and packages/create-app
- npm pack --dry-run

To validate that the packages tar up correctly.

## Publish

Commit and push the version bump.

To publish, run the following in packages/lib and packages/create-app:

`npm publish`

NOTE: packages/docs is published when pushing to master through GitHub pages.

If publish succeeds, create a new Git tag with the version and push it.