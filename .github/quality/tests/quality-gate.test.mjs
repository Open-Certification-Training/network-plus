import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../scripts/quality-gate.sh", import.meta.url),
);
const success = {
  SPELLING_RESULT: "success",
  JSON_RESULT: "success",
  FORMATTING_RESULT: "success",
  TESTS_RESULT: "success",
};

function runGate(results, summary = "") {
  return spawnSync("bash", [script], {
    env: { ...process.env, ...results, GITHUB_STEP_SUMMARY: summary },
    encoding: "utf8",
  });
}

test("quality gate passes only when all checks succeed", () => {
  const result = runGate(success);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const check of Object.keys(success)) {
  test(`quality gate rejects unsuccessful or missing ${check}`, () => {
    for (const state of ["failure", "cancelled", "skipped", ""]) {
      const result = runGate({ ...success, [check]: state });
      assert.equal(
        result.status,
        1,
        `${check}=${state}: ${result.stdout}${result.stderr}`,
      );
    }
  });
}

test("quality gate writes a readable summary even when a check fails", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "quality-gate-summary-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const summary = path.join(directory, "summary.md");
  const result = runGate({ ...success, SPELLING_RESULT: "failure" }, summary);
  assert.equal(result.status, 1);
  const markdown = await readFile(summary, "utf8");
  assert.ok(markdown.includes("| Spelling | failure |"));
  assert.ok(markdown.includes("| JSON validation | success |"));
  assert.ok(markdown.includes("| JSON formatting | success |"));
  assert.ok(markdown.includes("| Validator tests | success |"));
});
