import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const repositoryDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillDefinitions = [
  {
    directory: "dutch-a1-a2-coach",
    level: /A1\/A2/i,
  },
  {
    directory: "dutch-a2-b1-coach",
    level: /A2[/-]B1/i,
  },
] as const;

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

for (const { directory, level } of skillDefinitions) {
  test(`${directory} has valid OpenCode skill metadata`, async () => {
    const source = await readFile(join(repositoryDirectory, "skills", directory, "SKILL.md"), "utf8");
    const { fields } = parseFrontmatter(source);
    const name = requiredField(fields, "name");
    const description = requiredField(fields, "description");

    assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(name, directory);
    assert.ok(name.length >= 1 && name.length <= 64);
    assert.ok(description.length >= 1 && description.length <= 1024);
    assert.match(description, /Dutch correction/i);
    assert.match(description, /common Dutch mistakes/i);
    assert.match(description, level);
  });
}

for (const { directory } of skillDefinitions) {
  test(`${directory} documents the correction response contract`, async () => {
    const source = await readFile(join(repositoryDirectory, "skills", directory, "SKILL.md"), "utf8");
    const { body } = parseFrontmatter(source);

    assert.match(body, /## Correction Mode/);
    assert.match(body, /### Corrected Dutch/);
    assert.match(body, /### What to learn/);
    assert.match(body, /### Try again/);
    assert.match(body, /no more than three/i);
    assert.match(body, /English/);
    assert.match(body, /Do not invent a correction/i);
    assert.match(body, /already correct/i);
    assert.match(body, /Incorrect/);
    assert.match(body, /Correct but less natural/);
    assert.match(body, /Unclear/);
  });
}

for (const { directory } of skillDefinitions) {
  test(`${directory} documents interactive coaching without automatic interception or cross-session memory`, async () => {
    const source = await readFile(join(repositoryDirectory, "skills", directory, "SKILL.md"), "utf8");
    const { body } = parseFrontmatter(source);

    assert.match(body, /## Interactive Coaching Mode/);
    assert.match(body, /no learner text/i);
    assert.match(body, /one .*Dutch question or give one .*Dutch prompt/i);
    assert.match(body, /Do not automatically interrupt or\s+correct every Dutch message/i);
    assert.match(body, /only within the current conversation/i);
    assert.match(body, /do not claim to remember the learner across\s+sessions/i);
  });
}

test("keeps the A1/A2 coach focused on foundational Dutch", async () => {
  const source = await readFile(
    join(repositoryDirectory, "skills", "dutch-a1-a2-coach", "SKILL.md"),
    "utf8",
  );
  assert.match(source, /foundational|beginner|elementary/i);
  assert.match(source, /Do not silently move into\s+advanced grammar/i);
});

test("documents the A2/B1 grammar and practice scope", async () => {
  const source = await readFile(
    join(repositoryDirectory, "skills", "dutch-a2-b1-coach", "SKILL.md"),
    "utf8",
  );

  for (const topic of [
    "subordinate clauses",
    "inversion",
    "cohesion",
    "Tense",
    "modal",
    "relative clauses",
    "collocations",
    "register",
    "idiomatic naturalness",
  ]) {
    assert.match(source, new RegExp(topic, "i"));
  }
  assert.match(source, /Do not silently move beyond B1/i);
  assert.match(source, /connected response/i);
});
