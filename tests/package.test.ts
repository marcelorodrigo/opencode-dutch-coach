import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const execFileAsync = promisify(execFile);
const repositoryDirectory = new URL("..", import.meta.url);

type PackedFile = {
  path: string;
};

type PackResult = {
  name: string;
  version: string;
  filename: string;
  files: PackedFile[];
};

test("pnpm artifact contains the plugin, skill, and publication metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-dutch-coach-pack-"));

  try {
    const { stdout } = await execFileAsync(
      "pnpm",
      ["pack", "--json", "--pack-destination", directory],
      { cwd: repositoryDirectory, encoding: "utf8" },
    );
    const pack = JSON.parse(stdout) as PackResult;
    assert.ok(pack);
    const packageJson = JSON.parse(await readFile(join(fileURLToPath(repositoryDirectory), "package.json"), "utf8"));

    assert.equal(pack.name, packageJson.name);
    assert.equal(pack.version, packageJson.version);
    assert.equal(packageJson.engines.node, ">=26");
    assert.ok(pack.filename.endsWith(`${packageJson.name}-${packageJson.version}.tgz`));
    assert.deepEqual(
      pack.files.map(({ path }) => path).sort(),
      [
        "LICENSE",
        "README.md",
        "dist/plugin.d.ts",
        "dist/plugin.js",
        "package.json",
        "skills/dutch-a1-a2-coach/SKILL.md",
        "skills/dutch-a2-b1-coach/SKILL.md",
      ],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
