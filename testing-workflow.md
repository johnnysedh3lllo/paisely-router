# Testing Workflow

This document explains how to run and maintain tests while developing `paisely-router`.

## One-Time Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the suite once to verify your environment:
   ```bash
   npm test
   ```

## Daily Development Workflow

1. Make your code change in `src/`.
2. Add or update tests in `tests/` for the changed behavior.
3. Run tests in watch mode while iterating:
   ```bash
   npm run test:watch
   ```
4. Before opening a PR, run the full suite:
   ```bash
   npm test
   ```

## Pre-Publish Workflow

Run this command before publishing:

1. `npm run prepublish:check`

It runs:
- `npm test`
- `npm run build`
- `npm pack --dry-run`

If you want an actual tarball file after the dry run:

2. `npm pack`

Then inspect the tarball to confirm expected files are included:

```bash
tar -tf paisely-router-<version>.tgz
```

## How to Interpret Test Output

- `Test Files X passed` and `Tests Y passed`: full success.
- A failed test prints:
  - the file and test name,
  - assertion error details,
  - stack trace with line numbers.

When a test fails:

1. Start with the first failure in output.
2. Fix code or test expectations.
3. Re-run only the relevant test file:
   ```bash
   npm test -- tests/<file>.test.ts
   ```
4. Re-run full suite when targeted tests are green.
