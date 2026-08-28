import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import type { Config, PluginInput } from "@opencode-ai/plugin";

import { createDutchCoachPlugin } from "../src/plugin.js";

const expectedSkillDirectory = join(import.meta.dirname, "..", "skills");

type TestConfig = Config & {
  skills?: {
    paths?: string[];
    urls?: string[];
  };
};

function assertRegisteredConfig(
  config: TestConfig,
): asserts config is TestConfig & {
  skills: {
    paths: string[];
    urls?: string[];
  };
  command: NonNullable<Config["command"]>;
} {
  assert.ok(config.skills);
  assert.ok(config.skills.paths);
  assert.ok(config.command);
}

async function register(config: TestConfig): Promise<void> {
  const dutchCoachPlugin = createDutchCoachPlugin(() => {});
  const hooks = await dutchCoachPlugin({} as PluginInput);
  assert.ok(hooks.config);
  await hooks.config(config);
}

test("starts the automatic updater once during plugin initialization", async () => {
  const input = {} as PluginInput;
  const calls: PluginInput[] = [];
  const dutchCoachPlugin = createDutchCoachPlugin((receivedInput) => {
    calls.push(receivedInput);
  });

  await dutchCoachPlugin(input);

  assert.deepEqual(calls, [input]);
});

test("registers the packaged skill and Dutch command in an empty config", async () => {
  const config: TestConfig = {};
  await register(config);

  assert.ok(config.skills);
  assert.ok(config.command);
  assert.ok(config.command.dutch);
  assert.deepEqual(config.skills.paths, [expectedSkillDirectory]);
  assert.equal(
    config.command.dutch.description,
    "Correct Dutch text or start an adaptive A1/A2 or A2/B1 Dutch coaching session.",
  );
  assert.match(config.command.dutch.template, /dutch-a1-a2-coach/);
  assert.match(config.command.dutch.template, /dutch-a2-b1-coach/);
  assert.match(config.command.dutch.template, /explicit target level/i);
  assert.match(config.command.dutch.template, /When evidence is weak/i);
  assert.match(
    config.command.dutch.template,
    /empty, whitespace-only, or only an explicit level \(A1, A2, A2-B1, or B1\)/i,
  );
  assert.match(
    config.command.dutch.template,
    /correction mode only when `\$ARGUMENTS` contains learner Dutch text/i,
  );
});

test("preserves existing skills, URLs, commands, and unrelated config", async () => {
  const existingPath = "/tmp/existing-opencode-skills";
  const existingCommand = {
    description: "Existing command",
    template: "Keep this command",
  };
  const config: TestConfig = {
    model: "provider/model",
    skills: {
      paths: [existingPath],
      urls: ["https://example.test/skills"],
    },
    command: {
      existing: existingCommand,
    },
  };

  await register(config);

  assertRegisteredConfig(config);
  assert.deepEqual(config.skills.paths, [existingPath, expectedSkillDirectory]);
  assert.deepEqual(config.skills.urls, ["https://example.test/skills"]);
  assert.strictEqual(config.command.existing, existingCommand);
  assert.equal(config.model, "provider/model");
});

test("does not duplicate the skill path or command when called repeatedly", async () => {
  const config: TestConfig = {};

  await register(config);
  await register(config);

  assertRegisteredConfig(config);
  assert.deepEqual(config.skills.paths, [expectedSkillDirectory]);
  assert.equal(Object.keys(config.command).length, 1);
});

test("does not replace an existing Dutch command", async () => {
  const existingCommand = {
    description: "Project-specific Dutch command",
    template: "Use the project workflow",
  };
  const config = { command: { dutch: existingCommand } };

  await register(config);

  assert.strictEqual(config.command.dutch, existingCommand);
});

test("fails with a domain-specific error when the skill asset is missing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-dutch-coach-"));
  const pluginDirectory = join(directory, "dist");
  await mkdir(pluginDirectory);
  const pluginPath = join(pluginDirectory, "plugin.mts");
  const updatePath = join(pluginDirectory, "update.js");
  const source = await readFile(new URL("../dist/plugin.js", import.meta.url), "utf8");
  const updateSource = await readFile(new URL("../dist/update.js", import.meta.url), "utf8");
  await writeFile(pluginPath, source);
  await writeFile(updatePath, updateSource);
  const nodeModulesDirectory = join(directory, "node_modules");
  await mkdir(nodeModulesDirectory);
  await symlink(
    fileURLToPath(new URL(".", import.meta.resolve("semver"))),
    join(nodeModulesDirectory, "semver"),
    "dir",
  );
  const realDirectory = await realpath(directory);

  try {
    const module = await import(`file://${pluginPath}?missing-asset-test`);
    const plugin = module.createDutchCoachPlugin(() => {});
    const hooks = await plugin({} as PluginInput);
    assert.ok(hooks.config);
    await assert.rejects(hooks.config({}), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "DutchCoachAssetMissingError");
      assert.equal(
        (error as Error & { path: string }).path,
        resolve(realDirectory, "skills", "dutch-a1-a2-coach", "SKILL.md"),
      );
      assert.match(error.message, /reinstall the package/i);
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
