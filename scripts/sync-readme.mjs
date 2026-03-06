import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const mode = process.argv[2];
const root = resolve(process.cwd());

const readme = resolve(root, "README.md");
const githubReadme = resolve(root, "docs", "github-readme-source.md");
const npmReadme = resolve(root, "docs", "npm-readme-source.md");

if (mode === "npm") {
  if (!existsSync(npmReadme)) {
    throw new Error("README.npm.md not found.");
  }
  copyFileSync(npmReadme, readme);
  process.exit(0);
}

if (mode === "github") {
  if (!existsSync(githubReadme)) {
    throw new Error("README.github.md not found.");
  }
  copyFileSync(githubReadme, readme);
  process.exit(0);
}

throw new Error('Usage: node scripts/sync-readme.mjs <npm|github>');
