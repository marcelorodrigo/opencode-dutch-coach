import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const repositoryDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillDirectoryName = "dutch-a1-a2-coach";
const skillPath = join(repositoryDirectory, "skills", skillDirectoryName, "SKILL.md");

type Frontmatter = {
  fields: Record<string, string>;
  body: string;
};

function parseFrontmatter(source: string): Frontmatter {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "SKILL.md must start with YAML frontmatter");
  const content = match[1];
  assert.ok(content);

  const entries = content
      .split("\n")
      .map((line: string) => {
        const field = line.match(/^([a-z]+):\s*(.+)$/);
        if (!field?.[1] || !field[2]) {
          return undefined;
        }
        return [field[1], field[2]] as const;
      })
      .filter((entry): entry is readonly [string, string] => entry !== undefined);
  const fields = Object.fromEntries(entries);

  return { fields, body: source.slice(match[0].length) };
}

function requiredField(fields: Record<string, string>, key: string): string {
  const value = fields[key];
  assert.ok(value, `SKILL.md frontmatter must define ${key}`);
  return value;
}

test("has valid OpenCode skill metadata", async () => {
  const source = await readFile(skillPath, "utf8");
  const { fields } = parseFrontmatter(source);
  const name = requiredField(fields, "name");
  const description = requiredField(fields, "description");

  assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(name, skillDirectoryName);
  assert.ok(name.length >= 1 && name.length <= 64);
  assert.ok(description.length >= 1 && description.length <= 1024);
  assert.match(description, /Dutch correction/i);
  assert.match(description, /common Dutch mistakes/i);
  assert.match(description, /A1\/A2/i);
});

test("documents the correction response contract", async () => {
  const source = await readFile(skillPath, "utf8");
  const { body } = parseFrontmatter(source);

  assert.match(body, /## Correction Mode/);
  assert.match(body, /### Corrected Dutch/);
  assert.match(body, /### What to learn/);
  assert.match(body, /### Try again/);
  assert.match(body, /no more than three/i);
  assert.match(body, /simple English/i);
  assert.match(body, /Do not invent a correction/i);
  assert.match(body, /already correct/i);
});

test("documents interactive coaching without automatic interception or cross-session memory", async () => {
  const source = await readFile(skillPath, "utf8");
  const { body } = parseFrontmatter(source);

  assert.match(body, /## Interactive Coaching Mode/);
  assert.match(body, /no learner text/i);
  assert.match(body, /one simple Dutch question or give one short Dutch prompt/i);
  assert.match(body, /Do not automatically interrupt or correct every Dutch message/i);
  assert.match(body, /only within the current conversation/i);
  assert.match(body, /do not claim to remember the learner across\s+sessions/i);
});
