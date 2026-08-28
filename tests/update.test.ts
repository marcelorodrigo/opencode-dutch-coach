import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  checkAutoUpdate,
  isAutoUpdatableSpecification,
  isVersionNewer,
  startAutoUpdate,
  updateRemoveDirectory,
} from "../src/update.js";

import type { PluginInput } from "@opencode-ai/plugin";

test("isVersionNewer compares stable semantic versions", () => {
  assert.equal(isVersionNewer("0.2.0", "0.1.9"), true);
  assert.equal(isVersionNewer("0.1.9", "0.1.9"), false);
  assert.equal(isVersionNewer("0.1.9", "0.2.0"), false);
  assert.equal(isVersionNewer("v1.0.0", "0.9.9"), true);
});

test("isVersionNewer compares prerelease versions", () => {
  assert.equal(isVersionNewer("1.0.0", "1.0.0-beta.1"), true);
  assert.equal(isVersionNewer("1.0.0-beta.2", "1.0.0-beta.1"), true);
  assert.equal(isVersionNewer("1.0.0-beta.1", "1.0.0-beta.2"), false);
  assert.equal(isVersionNewer("1.0.0-beta", "1.0.0-1"), true);
});

test("isVersionNewer rejects malformed versions", () => {
  assert.equal(isVersionNewer("latest", "1.0.0"), false);
  assert.equal(isVersionNewer("1.0", "1.0.0"), false);
  assert.equal(isVersionNewer("1.0.1", "current"), false);
});

test("isAutoUpdatableSpecification allows npm tags and ranges", () => {
  for (const specification of [
    "latest",
    "*",
    "^0.1.0",
    "~0.1.0",
    ">=0.1.0",
    ">0.1.0",
    "<=1.0.0",
    "<1.0.0",
    "0.1.0 || 0.2.0",
    "0.1.0 - 0.2.0",
    "1.x",
    "^1",
    "~1.2",
    ">=1.0.0 <2.0.0 || 3.x",
  ]) {
    assert.equal(isAutoUpdatableSpecification(specification), true, specification);
  }
});

test("isAutoUpdatableSpecification rejects pinned and non-registry specifications", () => {
  for (const specification of [
    "",
    "0.1.0",
    "file:../opencode-dutch-coach",
    "github:example/opencode-dutch-coach",
    "foo || bar",
    "0.1.0 || file:../opencode-dutch-coach",
    "^file:../opencode-dutch-coach",
    ">=not-a-version",
  ]) {
    assert.equal(isAutoUpdatableSpecification(specification), false, specification);
  }
});

test("updateRemoveDirectory selects an updateable OpenCode wrapper", async () => {
  const fixture = await createWrapperFixture("latest");

  try {
    assert.equal(
      await updateRemoveDirectory(fixture.packageDirectory, "opencode-dutch-coach"),
      fixture.wrapperDirectory,
    );
  } finally {
    await rm(fixture.rootDirectory, { recursive: true, force: true });
  }
});

test("updateRemoveDirectory skips a version-locked OpenCode wrapper", async () => {
  const fixture = await createWrapperFixture("0.1.0");

  try {
    assert.equal(
      await updateRemoveDirectory(fixture.packageDirectory, "opencode-dutch-coach"),
      undefined,
    );
  } finally {
    await rm(fixture.rootDirectory, { recursive: true, force: true });
  }
});

test("updateRemoveDirectory skips packages outside an OpenCode wrapper", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "opencode-dutch-coach-update-"));
  const packageDirectory = join(rootDirectory, "opencode-dutch-coach");
  await writePackageJson(packageDirectory, {
    name: "opencode-dutch-coach",
    version: "0.1.0",
  });

  try {
    assert.equal(
      await updateRemoveDirectory(packageDirectory, "opencode-dutch-coach"),
      undefined,
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test("updateRemoveDirectory never selects a project root for a flat installation", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "opencode-dutch-coach-project-"));
  const packageDirectory = join(rootDirectory, "node_modules", "opencode-dutch-coach");
  await writePackageJson(rootDirectory, {
    dependencies: { "opencode-dutch-coach": "^0.1.0" },
  });
  await writePackageJson(packageDirectory, {
    name: "opencode-dutch-coach",
    version: "0.1.0",
  });

  try {
    assert.equal(
      await updateRemoveDirectory(packageDirectory, "opencode-dutch-coach"),
      undefined,
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test("checkAutoUpdate removes an updateable wrapper for a newer npm version", async () => {
  const removed: string[] = [];
  const signal = new AbortController().signal;

  const result = await checkAutoUpdate(signal, {
    findPackageDirectory: async () => "/cache/opencode-dutch-coach@latest/node_modules/opencode-dutch-coach",
    readPackageJson: async () => ({ name: "opencode-dutch-coach", version: "0.1.0" }),
    fetchLatestVersion: async (_name, receivedSignal) => {
      assert.strictEqual(receivedSignal, signal);
      return "0.2.0";
    },
    updateRemoveDirectory: async () => "/cache/opencode-dutch-coach@latest",
    removeDirectory: async (path) => {
      removed.push(path);
    },
  });

  assert.deepEqual(result, {
    updated: true,
    name: "opencode-dutch-coach",
    current: "0.1.0",
    latest: "0.2.0",
  });
  assert.deepEqual(removed, ["/cache/opencode-dutch-coach@latest"]);
});

test("checkAutoUpdate does not remove a wrapper when npm has no newer version", async () => {
  let removed = false;

  const result = await checkAutoUpdate(new AbortController().signal, {
    findPackageDirectory: async () => "/cache/package",
    readPackageJson: async () => ({ name: "opencode-dutch-coach", version: "0.1.0" }),
    fetchLatestVersion: async () => "0.1.0",
    updateRemoveDirectory: async () => "/cache/wrapper",
    removeDirectory: async () => {
      removed = true;
    },
  });

  assert.deepEqual(result, { updated: false });
  assert.equal(removed, false);
});

test("checkAutoUpdate reports a failed wrapper removal without claiming an update", async () => {
  const result = await checkAutoUpdate(new AbortController().signal, {
    findPackageDirectory: async () => "/cache/package",
    readPackageJson: async () => ({ name: "opencode-dutch-coach", version: "0.1.0" }),
    fetchLatestVersion: async () => "0.2.0",
    updateRemoveDirectory: async () => "/cache/wrapper",
    removeDirectory: async () => {
      throw new Error("read-only cache");
    },
  });

  assert.deepEqual(result, {
    updated: false,
    error: "remove_failed",
    name: "opencode-dutch-coach",
    current: "0.1.0",
    latest: "0.2.0",
  });
});

test("startAutoUpdate aborts after ten seconds and only toasts successful updates", async () => {
  const scheduled: Array<{ callback: () => void; delay: number }> = [];
  const cancelled: unknown[] = [];
  const toasts: unknown[] = [];
  let signal: AbortSignal | undefined;
  let resolveCheck: ((result: { updated: true; name: string; current: string; latest: string }) => void) | undefined;
  const timer = {} as ReturnType<typeof setTimeout>;
  const input = {
    client: {
      tui: {
        showToast: (toast: unknown) => {
          toasts.push(toast);
          return Promise.resolve({});
        },
      },
    },
  } as unknown as PluginInput;

  startAutoUpdate(input, {
    check: (receivedSignal) => {
      signal = receivedSignal;
      return new Promise((resolve) => {
        resolveCheck = resolve;
      });
    },
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay });
      return timer;
    },
    cancel: (receivedTimer) => {
      cancelled.push(receivedTimer);
    },
  });

  assert.equal(scheduled[0]?.delay, 10_000);
  scheduled[0]?.callback();
  assert.equal(signal?.aborted, true);

  resolveCheck?.({
    updated: true,
    name: "opencode-dutch-coach",
    current: "0.1.0",
    latest: "0.2.0",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(scheduled[1]?.delay, 5000);
  assert.deepEqual(cancelled, [timer]);
  assert.deepEqual(toasts, []);

  scheduled[1]?.callback();
  assert.deepEqual(toasts, [
    {
      body: {
        title: "Dutch Coach update ready",
        message:
          "Updated opencode-dutch-coach from 0.1.0 to 0.2.0. Restart OpenCode to finish.",
        variant: "info",
        duration: 7000,
      },
    },
  ]);
});

test("startAutoUpdate suppresses synchronous and asynchronous toast failures", async () => {
  for (const showToast of [
    () => {
      throw new Error("TUI unavailable");
    },
    () => Promise.reject(new Error("TUI unavailable")),
  ]) {
    const scheduled: Array<() => void> = [];
    const input = { client: { tui: { showToast } } } as unknown as PluginInput;

    startAutoUpdate(input, {
      check: async () => ({
        updated: true,
        name: "opencode-dutch-coach",
        current: "0.1.0",
        latest: "0.2.0",
      }),
      schedule: (callback) => {
        scheduled.push(callback);
        return {} as ReturnType<typeof setTimeout>;
      },
      cancel: () => {},
    });

    await Promise.resolve();
    scheduled[1]?.();
    await Promise.resolve();
  }
});

async function createWrapperFixture(specification: string): Promise<{
  rootDirectory: string;
  wrapperDirectory: string;
  packageDirectory: string;
}> {
  const rootDirectory = await mkdtemp(join(tmpdir(), "opencode-dutch-coach-update-"));
  const wrapperDirectory = join(rootDirectory, `opencode-dutch-coach@${specification}`);
  const packageDirectory = join(wrapperDirectory, "node_modules", "opencode-dutch-coach");

  await writePackageJson(wrapperDirectory, {
    dependencies: { "opencode-dutch-coach": "0.1.0" },
  });
  await writePackageJson(packageDirectory, {
    name: "opencode-dutch-coach",
    version: "0.1.0",
  });

  return { rootDirectory, wrapperDirectory, packageDirectory };
}

async function writePackageJson(directory: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "package.json"), `${JSON.stringify(data)}\n`, "utf8");
}
