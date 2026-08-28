import { readFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PluginInput } from "@opencode-ai/plugin";
import { valid, validRange } from "semver";

type PackageJson = {
  name?: string;
  version?: string;
};

export type UpdateResult =
  | { updated: true; name: string; current: string; latest: string }
  | { updated: false; error: "remove_failed"; name: string; current: string; latest: string }
  | { updated: false };

type Timer = ReturnType<typeof setTimeout>;

type AutoUpdateDependencies = {
  check: (signal: AbortSignal) => Promise<UpdateResult>;
  schedule: (callback: () => void, delay: number) => Timer;
  cancel: (timer: Timer) => void;
};

type UpdateCheckDependencies = {
  findPackageDirectory: (name: string) => Promise<string | undefined>;
  readPackageJson: (path: string) => Promise<PackageJson | undefined>;
  fetchLatestVersion: (name: string, signal: AbortSignal) => Promise<string | undefined>;
  updateRemoveDirectory: (packageDirectory: string, name: string) => Promise<string | undefined>;
  removeDirectory: (path: string) => Promise<void>;
};

const packageName = "opencode-dutch-coach";

const defaultAutoUpdateDependencies: AutoUpdateDependencies = {
  check: checkAutoUpdate,
  schedule: setTimeout,
  cancel: clearTimeout,
};

export function startAutoUpdate(
  input: PluginInput,
  dependencies: AutoUpdateDependencies = defaultAutoUpdateDependencies,
): void {
  const controller = new AbortController();
  const timeout = dependencies.schedule(() => controller.abort(), 10_000);

  void dependencies
    .check(controller.signal)
    .then((result) => {
      if (!result.updated) {
        return;
      }

      dependencies.schedule(() => {
        try {
          const toast = input.client.tui.showToast({
            body: {
              title: "Dutch Coach update ready",
              message: `Updated ${result.name} from ${result.current} to ${result.latest}. Restart OpenCode to finish.`,
              variant: "info",
              duration: 7000,
            },
          });
          void Promise.resolve(toast).catch(() => {});
        } catch {
          // Notifications are best-effort and must not disrupt OpenCode startup.
        }
      }, 5000);
    })
    .catch(() => {})
    .finally(() => dependencies.cancel(timeout));
}

const defaultUpdateCheckDependencies: UpdateCheckDependencies = {
  findPackageDirectory,
  readPackageJson,
  fetchLatestVersion,
  updateRemoveDirectory,
  removeDirectory: async (path) => rm(path, { recursive: true, force: true }),
};

export async function checkAutoUpdate(
  signal: AbortSignal,
  dependencies: UpdateCheckDependencies = defaultUpdateCheckDependencies,
): Promise<UpdateResult> {
  const packageDirectory = await dependencies.findPackageDirectory(packageName);
  if (!packageDirectory) {
    return { updated: false };
  }

  const packageJson = await dependencies.readPackageJson(join(packageDirectory, "package.json"));
  if (!packageJson?.name || !packageJson.version) {
    return { updated: false };
  }

  const latest = await dependencies.fetchLatestVersion(packageJson.name, signal);
  if (!latest || !isVersionNewer(latest, packageJson.version)) {
    return { updated: false };
  }

  const removeDirectory = await dependencies.updateRemoveDirectory(
    packageDirectory,
    packageJson.name,
  );
  if (!removeDirectory) {
    return { updated: false };
  }

  try {
    await dependencies.removeDirectory(removeDirectory);
  } catch {
    return {
      updated: false,
      error: "remove_failed",
      name: packageJson.name,
      current: packageJson.version,
      latest,
    };
  }

  return {
    updated: true,
    name: packageJson.name,
    current: packageJson.version,
    latest,
  };
}

async function findPackageDirectory(name: string): Promise<string | undefined> {
  let directory = dirname(fileURLToPath(import.meta.url));

  for (;;) {
    const packageJson = await readPackageJson(join(directory, "package.json"));
    if (packageJson?.name === name) {
      return directory;
    }

    const parent = dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}

export async function updateRemoveDirectory(
  packageDirectory: string,
  name: string,
): Promise<string | undefined> {
  const packageParent = dirname(packageDirectory);
  const nodeModulesDirectory = basename(packageParent).startsWith("@")
    ? dirname(packageParent)
    : packageParent;

  if (basename(nodeModulesDirectory) !== "node_modules") {
    return undefined;
  }

  const wrapperDirectory = dirname(nodeModulesDirectory);
  const specification = getWrapperSpecification(wrapperDirectory, name);

  if (!specification || !isAutoUpdatableSpecification(specification)) {
    return undefined;
  }

  return wrapperDirectory;
}

function getWrapperSpecification(wrapperDirectory: string, name: string): string | undefined {
  if (name.startsWith("@")) {
    const [scope, packageName] = name.split("/");
    if (!scope || !packageName || basename(dirname(wrapperDirectory)) !== scope) {
      return undefined;
    }

    const prefix = `${packageName}@`;
    const wrapperName = basename(wrapperDirectory);
    return wrapperName.startsWith(prefix) ? wrapperName.slice(prefix.length) : undefined;
  }

  const prefix = `${name}@`;
  const wrapperName = basename(wrapperDirectory);
  return wrapperName.startsWith(prefix) ? wrapperName.slice(prefix.length) : undefined;
}

export function isAutoUpdatableSpecification(specification: string): boolean {
  const value = specification.trim();
  if (!value) {
    return false;
  }
  if (value === "latest" || value === "*") {
    return true;
  }
  return valid(value) === null && validRange(value) !== null;
}

async function readPackageJson(path: string): Promise<PackageJson | undefined> {
  try {
    const data: unknown = JSON.parse(await readFile(path, "utf8"));
    return data && typeof data === "object" ? (data as PackageJson) : undefined;
  } catch {
    return undefined;
  }
}

async function fetchLatestVersion(name: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
      signal,
    });
    if (!response.ok) {
      return undefined;
    }

    const data: unknown = await response.json();
    if (!data || typeof data !== "object") {
      return undefined;
    }

    const version = (data as { version?: unknown }).version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

export function isVersionNewer(latest: string, current: string): boolean {
  const next = parseVersion(latest);
  const previous = parseVersion(current);
  if (!next || !previous) {
    return false;
  }

  for (const index of [0, 1, 2] as const) {
    const nextPart = next.parts[index];
    const previousPart = previous.parts[index];
    if (nextPart !== previousPart) {
      return nextPart > previousPart;
    }
  }

  if (next.prerelease.length === 0 && previous.prerelease.length > 0) {
    return true;
  }
  if (next.prerelease.length > 0 && previous.prerelease.length === 0) {
    return false;
  }

  for (
    let index = 0;
    index < Math.max(next.prerelease.length, previous.prerelease.length);
    index += 1
  ) {
    const nextIdentifier = next.prerelease[index];
    const previousIdentifier = previous.prerelease[index];
    if (nextIdentifier === undefined) {
      return false;
    }
    if (previousIdentifier === undefined) {
      return true;
    }
    if (nextIdentifier === previousIdentifier) {
      continue;
    }

    const nextNumber = /^\d+$/.test(nextIdentifier) ? Number(nextIdentifier) : undefined;
    const previousNumber = /^\d+$/.test(previousIdentifier)
      ? Number(previousIdentifier)
      : undefined;

    if (nextNumber !== undefined && previousNumber !== undefined) {
      return nextNumber > previousNumber;
    }
    if (nextNumber !== undefined) {
      return false;
    }
    if (previousNumber !== undefined) {
      return true;
    }
    return nextIdentifier > previousIdentifier;
  }

  return false;
}

function parseVersion(version: string):
  | { parts: readonly [number, number, number]; prerelease: string[] }
  | undefined {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.+)?$/);
  if (!match?.[1] || !match[2] || !match[3]) {
    return undefined;
  }

  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? [],
  };
}
