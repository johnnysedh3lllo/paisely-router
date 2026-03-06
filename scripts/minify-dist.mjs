import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { minify } from "terser";

const root = "dist";

function getJsFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...getJsFiles(fullPath));
      continue;
    }

    if (entry.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

const jsFiles = getJsFiles(root);

for (const file of jsFiles) {
  const source = readFileSync(file, "utf8");
  const result = await minify(source, {
    module: true,
    compress: {
      module: true,
      toplevel: true,
      passes: 2,
    },
    mangle: {
      toplevel: true,
    },
    format: { comments: false },
  });

  if (!result.code) {
    throw new Error(`Failed to minify ${file}`);
  }

  writeFileSync(file, result.code);
}
