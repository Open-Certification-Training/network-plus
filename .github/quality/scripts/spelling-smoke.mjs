import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const configuration = fileURLToPath(new URL("../_typos.toml", import.meta.url));
const binary = process.env.TYPOS_BIN || "typos";
// Build an intentional misspelling without introducing one into the source.
const misspelling = String.fromCharCode(114, 101, 99, 105, 101, 118, 101);

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "spelling-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  await writeFile(path.join(root, ".gitignore"), "node_modules/\n");
  await writeFile(
    path.join(root, "README.md"),
    "# Network devices\n\nReceive packets.\n",
  );
  await mkdir(path.join(root, "EXAM-VERSION/en/domain/objective"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "EXAM-VERSION/en/domain/objective/network-devices.json"),
    JSON.stringify([
      {
        questionText: "Which device forwards packets?",
        answerOptions: ["Router", "Patch panel"],
        correctAnswers: 0,
      },
    ]),
  );
  return root;
}

function spellcheck(root) {
  const result = spawnSync(
    binary,
    ["--isolated", "--config", configuration, "."],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  if (result.error)
    throw new Error(
      `Cannot run Typos: ${result.error.message}. Install Typos or set TYPOS_BIN to its executable.`,
    );
  return result;
}

test("spelling accepts valid content and excludes dependencies, lockfiles, and Git internals", async (t) => {
  const root = await fixture(t);
  for (const file of [
    "package-lock.json",
    ".github/quality/package-lock.json",
    "node_modules/example.txt",
    ".github/quality/node_modules/example.txt",
    ".git/example.txt",
  ]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), misspelling);
  }
  const result = spellcheck(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const file of [
  "README.md",
  "EXAM-VERSION/en/domain/objective/network-devices.json",
  ".github/workflows/quality.yml",
]) {
  test(`spelling fails for a typo in ${file}`, async (t) => {
    const root = await fixture(t);
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    const content = file.endsWith(".json")
      ? JSON.stringify([
          {
            questionText: `Devices ${misspelling} packets.`,
            answerOptions: ["True", "False"],
            correctAnswers: 0,
          },
        ])
      : `name: ${misspelling}\n`;
    await writeFile(path.join(root, file), content);
    const result = spellcheck(root);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.ok(
      (result.stdout + result.stderr).includes(file),
      result.stdout + result.stderr,
    );
  });
}
