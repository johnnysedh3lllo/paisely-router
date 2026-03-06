# Publishing to NPM

This guide covers package preparation, npm authentication, publish flow, and maintenance for `paisely-router`.

Once tests compile and pass, you can publish the latest version of `paisely-router` to the npm registry.

### 1. Prepare the Package
- **Version Number:** Choose your version number. Update `"version"` inside `package.json` following semantic versioning (e.g., jump from `0.1.0` to `0.1.1` for patches, `0.2.0` for minor features).
- **Verify Configuration:** Ensure `main`, `module`, `types`, and `exports` inside `package.json` correctly point to the `dist/` folder containing the compiled code, and `repository.url` uses `git+https://...`.
- **Build Step:** The package relies on ES Modules output, so build the source with TypeScript via:
  ```bash
  npm run build
  ```
  *(Note: `package.json` often includes a `"prepare": "npm run build"` script that automatically runs prior to publishing, but it never hurts to double-check).*

### 2. Set Up npm Account & Authentication
If this is your first time publishing, you need to configure your local machine to talk to npm:
- **Create an Account:** If you don't have one, sign up at [npmjs.com](https://www.npmjs.com/). It is highly recommended to enable Two-Factor Authentication (2FA).
- **Log In:** From your terminal, type:
  ```bash
  npm login
  ```
  You will be prompted to enter your credentials and 2FA token.
  If your CLI reports `ENEEDAUTH`, run `npm adduser` and complete login.
- **Test Login:** Verify you are logged in properly with:
  ```bash
  npm whoami
  ```

### 3. Run Pre-Publish Checks
To avoid publishing broken packages, run these checks a final time:
1. Run the consolidated check:
   ```bash
   npm run prepublish:check
   ```
   This runs tests, build, and `npm pack --dry-run`.
2. Optionally create the real tarball:
   ```bash
   npm pack
   ```
3. Inspect tarball contents:
   ```bash
   tar -tf paisely-router-<version>.tgz
   ```
   Confirm you have `dist/`, `package.json`, and docs (`Publishing to NPM.md`, `router-docs.md`).

### 4. Publish
If everything looks correct, run:
```bash
npm publish --access public
```
*Note: If you run into an error like "name already exists" or a 2FA prompt fails, read the terminal output—most npm CLI errors explain exactly what went wrong or if you forgot a One-Time Password.*

### 5. Post-Publish Maintenance
- **Bumping Versions:** Always bump the version in `package.json` before trying to publish again. `npm version patch`, `npm version minor`, or `npm version major` can automate this and create a git commit/tag simultaneously.
- **Deprecating or Unpublishing:** If you publish a severe bug by accident, you can use `npm deprecate` to warn users quickly. You can only fully unpublish a version within the first 72 hours of its release.
- **Tagging Releases:** Tag each published version to keep source and package versions aligned:
  ```bash
  git tag -a v0.1.0 -m "Release v0.1.0"
  git push origin v0.1.0
  ```

## Troubleshooting

- **`403 Forbidden` or authentication error**
  - Run `npm whoami` to verify login state.
  - Re-authenticate with `npm login`.
  - If needed, use `npm adduser` (some environments prompt this instead of `npm login`).
  - If 2FA is enabled, use an up-to-date OTP.

- **npm warns it auto-corrected `package.json` fields during publish**
  - Run `npm pkg fix`.
  - Re-check `repository.url` and other metadata fields before publishing again.

- **`You cannot publish over the previously published versions`**
  - Bump version first (`npm version patch` or manual `package.json` update).

- **Package name already exists**
  - Pick a unique package name, or publish under a scope (`@your-scope/paisely-router`).

- **Missing files in published package**
  - Check `files` in `package.json`.
  - Re-run `npm pack` and inspect tarball contents before publishing.

- **Build/type errors during publish**
  - Run `npm run build` locally.
  - Fix `tsconfig`/source errors before retrying `npm publish`.
