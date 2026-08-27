import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const execFileAsync = promisify(execFile);
const repositoryDirectory = fileURLToPath(new URL("..", import.meta.url));

type PackResult = {
  filename: string;
};

type ExecResult = {
  stdout: string;
  stderr: string;
};

type ResolvedConfig = {
  skills: {
    paths: string[];
    urls: string[];
  };
  command: {
    dutch: {
      description: string;
    };
    existing: {
      template: string;
    };
  };
};

type DiscoveredSkill = {
  name: string;
};

async function packPackage(directory: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "pnpm",
    ["pack", "--json", "--pack-destination", directory],
    { cwd: repositoryDirectory, encoding: "utf8" },
  );
  const pack = JSON.parse(stdout) as PackResult;
  return resolve(directory, pack.filename);
}

async function runOpenCode(
  args: string[],
  cwd: string,
  configContent: unknown,
  configDirectory: string,
  runtimeDirectory: string,
): Promise<ExecResult> {
  const result = await execFileAsync("opencode", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: runtimeDirectory,
      XDG_CONFIG_HOME: join(runtimeDirectory, "xdg-config"),
      XDG_DATA_HOME: join(runtimeDirectory, "xdg-data"),
      XDG_STATE_HOME: join(runtimeDirectory, "xdg-state"),
      XDG_CACHE_HOME: join(runtimeDirectory, "xdg-cache"),
      OPENCODE_CONFIG: "",
      OPENCODE_CONFIG_CONTENT: JSON.stringify(configContent),
      OPENCODE_CONFIG_DIR: configDirectory,
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    },
  });

  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

test("OpenCode discovers the skill and command from the packed artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-dutch-coach-integration-"));
  const packageDirectory = join(directory, "package");
  const fixtureDirectory = join(directory, "fixture");
  const configDirectory = join(directory, "config");
  const runtimeDirectory = join(directory, "runtime");

  try {
    await mkdir(packageDirectory);
    await mkdir(fixtureDirectory);
    await mkdir(configDirectory);
    await mkdir(runtimeDirectory);
    const tarball = await packPackage(packageDirectory);
    await writeFile(
      join(fixtureDirectory, "package.json"),
      JSON.stringify({
        name: "opencode-dutch-coach-fixture",
        private: true,
      }),
    );
    await execFileAsync("pnpm", ["add", "--ignore-scripts", tarball], {
      cwd: fixtureDirectory,
      encoding: "utf8",
    });

    const installedPackage = await realpath(
      join(fixtureDirectory, "node_modules", "opencode-dutch-coach"),
    );
    const installedPlugin = join(installedPackage, "dist", "plugin.js");
    const fixtureConfig = {
      $schema: "https://opencode.ai/config.json",
      plugin: [`file://${installedPlugin}`],
      skills: {
        urls: ["https://example.test/skills"],
      },
      command: {
        existing: {
          description: "Fixture command",
          template: "Keep this command",
        },
      },
    };

    const config = await runOpenCode(
      ["debug", "config", "--log-level", "ERROR"],
      fixtureDirectory,
      fixtureConfig,
      configDirectory,
      runtimeDirectory,
    );
    const resolvedConfig = JSON.parse(config.stdout) as ResolvedConfig;
    assert.ok(resolvedConfig.skills.paths.some((path: string) =>
      path.endsWith("/node_modules/opencode-dutch-coach/skills"),
    ));
    assert.equal(
      resolvedConfig.command.dutch.description,
      "Correct Dutch text or start an A1/A2 Dutch coaching session.",
    );
    assert.deepEqual(resolvedConfig.skills.urls, ["https://example.test/skills"]);
    assert.equal(resolvedConfig.command.existing.template, "Keep this command");

    const skills = await runOpenCode(
      ["debug", "skill", "--log-level", "ERROR"],
      fixtureDirectory,
      fixtureConfig,
      configDirectory,
      runtimeDirectory,
    );
    const discoveredSkills = JSON.parse(skills.stdout) as DiscoveredSkill[];
    assert.ok(
      discoveredSkills.some(({ name }) => name === "dutch-a1-a2-coach"),
      `Discovered skills: ${discoveredSkills.map(({ name }) => name).join(", ")}`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
