import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Config, Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const skillsDirectory = resolve(packageDirectory, "../skills");
const skillFile = resolve(skillsDirectory, "dutch-a1-a2-coach", "SKILL.md");

const dutchCommand = {
  description: "Correct Dutch text or start an A1/A2 Dutch coaching session.",
  template: [
    "Use the `dutch-a1-a2-coach` skill for this request.",
    "If `$ARGUMENTS` contains non-whitespace text, correct that exact Dutch text.",
    "If `$ARGUMENTS` is empty or whitespace-only, start an interactive Dutch coaching session.",
  ].join("\n"),
};

class DutchCoachAssetMissingError extends Error {
  readonly path: string;

  constructor(path: string, cause: unknown) {
    super(
      `opencode-dutch-coach could not find its packaged skill at "${path}". ` +
        "Reinstall the package or check that the package artifact contains the skills directory.",
      { cause },
    );
    this.name = "DutchCoachAssetMissingError";
    this.path = path;
  }
}

function assertSkillAssetExists(path: string): void {
  try {
    if (!statSync(path).isFile()) {
      throw new Error("The skill asset is not a file.");
    }
  } catch (cause: unknown) {
    throw new DutchCoachAssetMissingError(path, cause);
  }
}

type ConfigHookOptions = {
  skillDirectory?: string;
  skillPath?: string;
};

type ConfigWithSkills = Config & {
  skills?: {
    paths?: string[];
    urls?: string[];
  };
};

function createConfigHook({
  skillDirectory = skillsDirectory,
  skillPath = skillFile,
}: ConfigHookOptions = {}): NonNullable<Hooks["config"]> {
  return async (config: Config): Promise<void> => {
    assertSkillAssetExists(skillPath);

    const configWithSkills = config as ConfigWithSkills;
    const skills = configWithSkills.skills ?? (configWithSkills.skills = {});
    const paths = skills.paths ?? (skills.paths = []);

    if (!paths.includes(skillDirectory)) {
      paths.push(skillDirectory);
    }

    const commands = config.command ?? (config.command = {});

    if (!Object.hasOwn(commands, "dutch")) {
      commands.dutch = dutchCommand;
    }
  };
}

const dutchCoachPlugin: Plugin = async (_input: PluginInput): Promise<Hooks> => ({
  config: createConfigHook(),
});

export default dutchCoachPlugin;
