# Quality tooling

This directory contains the dependencies, scripts, tests, and spelling configuration used by the repository's pull request checks. Run the commands below from the repository root with Node.js 22 or newer.

```sh
npm --prefix .github/quality ci --ignore-scripts
npm --prefix .github/quality run validate:json
npm --prefix .github/quality run check:json
npm --prefix .github/quality test
```

The JSON commands find the Git repository root and scan tracked and unignored JSON files outside `.github/`. Validation, formatting checks, automatic formatting, and spelling all exclude the entire `.github/` directory from reviewed content. Validation uses the root [schema.json](../../schema.json) for questions. The tools still load their configuration from this directory; set `questionDirectories` in [package.json](package.json) to the top-level exam folders that contain topic files.

To fix JSON formatting:

```sh
npm --prefix .github/quality run format:json
```

The formatting workflow uses this command and adds a separate formatting commit when a pull request comes from a branch in this repository. Fork pull requests receive the formatting check.

Pull request and push workflows skip changes confined to `.github/`. When other files change, the checks run with `.github/` excluded from their content scans.

Spelling uses Typos 1.49.0. With that version installed and available on your `PATH`, run:

```sh
typos --isolated --config .github/quality/_typos.toml
npm --prefix .github/quality run test:spelling
```

Alternatively, set `TYPOS_BIN` to the Typos executable when running the spelling smoke tests. Spelling checks repository content outside `.github/`. Lockfiles, Git internals, and ignored dependencies are also excluded. Add intentional terms to [_typos.toml](_typos.toml) under `[default.extend-words]`.

The final **Quality gate** requires spelling, JSON validation, JSON formatting, and validator tests to pass. Select that check in branch protection to require it before merging.
