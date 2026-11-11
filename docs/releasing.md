# Releasing Cove

Cove uses npm for its CLI distribution. The package version is maintained in
`package.json`; keep the version printed by `cove --version` in
`src/cli/index.ts` synchronized with it.

## Before publishing

Run these commands from the repository root in an environment with the
project's development dependencies installed:

```sh
npm install
npm test
npm run build
npm pack --dry-run
```

The `prepublishOnly` lifecycle runs the test suite before publication, and
`prepack` builds the TypeScript CLI. Inspect the package file list and verify
that it contains `dist/src/`, `README.md`, `CHANGELOG.md`, `LICENSE`, `docs/`,
and `schemas/`.

Confirm that the intended version is not already published:

```sh
npm view @sheldev/cove-compiler@0.1.4 version
```

If npm reports that the version does not exist, publish it:

```sh
npm login
npm publish
```

The package's `publishConfig` sets scoped-package access to public. If this is
the first public publication for the scope/package, npm may require explicit
public access; use `npm publish --access public` if prompted.

Verify the registry after publication:

```sh
npm view @sheldev/cove-compiler@0.1.4 version
npm view @sheldev/cove-compiler dist.tarball
```

## Tag the source release

From the repository's Git checkout, after committing the release files:

```sh
git tag -a v0.1.4 -m "Cove 0.1.4"
git push origin v0.1.4
```

Create the matching hosted release from tag `v0.1.4` and attach the changelog
or release notes. Do not tag or publish until the npm artifact has passed the
checks above.
