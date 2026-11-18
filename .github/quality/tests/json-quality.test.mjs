import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkRepository } from "../scripts/json-quality.mjs";

const schema = await readFile(
  new URL("../../../schema.json", import.meta.url),
  "utf8",
);
const questionFile = "Sample Exam/en/1-Domain/1-Objective/network devices.json";
const configFile = ".github/quality/package.json";
const validQuestion = {
  questionText: "Which options are network devices? Select all that apply.",
  answerOptions: ["Router", "Switch", "Spreadsheet"],
  correctAnswers: [0, 1],
};

async function fixture(t, question = validQuestion) {
  const root = await mkdtemp(path.join(os.tmpdir(), "question-quality-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  await mkdir(path.join(root, path.dirname(questionFile)), { recursive: true });
  await mkdir(path.join(root, path.dirname(configFile)), { recursive: true });
  await writeFile(path.join(root, "schema.json"), schema);
  await writeFile(path.join(root, ".gitignore"), "node_modules/\n");
  await writeFile(
    path.join(root, configFile),
    JSON.stringify({
      questionDirectories: ["Sample Exam"],
    }),
  );
  await writeFile(path.join(root, questionFile), JSON.stringify([question]));
  return root;
}

test("accepts a one-question topic with multiple correct answers and omitted optional fields", async (t) => {
  const result = await checkRepository(await fixture(t), "validate");
  assert.deepEqual(result.errors, []);
  assert.equal(result.count, 2);
});

test("accepts multiple question types together in one topic", async (t) => {
  const root = await fixture(t);
  const questions = [
    validQuestion,
    {
      questionType: "true-false",
      questionText: "A router can connect IP networks.",
      answerOptions: ["True", "False"],
      correctAnswers: 0,
    },
  ];
  await writeFile(path.join(root, questionFile), JSON.stringify(questions));
  assert.deepEqual((await checkRepository(root, "validate")).errors, []);
});

for (const [name, data] of [
  ["an empty topic", []],
  ["a bare question object", validQuestion],
  ["a wrapper object", { questions: [validQuestion] }],
  ["a non-question entry", [validQuestion, null]],
  ["a nested question array", [[validQuestion]]],
]) {
  test(`rejects ${name}`, async (t) => {
    const root = await fixture(t);
    await writeFile(path.join(root, questionFile), JSON.stringify(data));
    const { errors } = await checkRepository(root, "validate");
    assert.ok(
      errors.some((error) => error.startsWith(`${questionFile}:`)),
      errors.join("\n"),
    );
  });
}

test("checks answer bounds against each question's own options and reports both locations", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, questionFile),
    JSON.stringify([
      { ...validQuestion, correctAnswers: 3 },
      {
        questionText: "Choose an option.",
        answerOptions: ["One", "Two"],
        correctAnswers: [0, 2],
      },
    ]),
  );
  const { errors } = await checkRepository(root, "validate");
  assert.equal(errors.length, 2);
  assert.ok(
    errors.some(
      (error) =>
        error.startsWith(`${questionFile}:/0/correctAnswers:`) &&
        error.includes("expected 0 through 2"),
    ),
  );
  assert.ok(
    errors.some(
      (error) =>
        error.startsWith(`${questionFile}:/1/correctAnswers/1:`) &&
        error.includes("expected 0 through 1"),
    ),
  );
});

test("schema errors identify an invalid question after a valid question", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, questionFile),
    JSON.stringify([
      validQuestion,
      { ...validQuestion, answerOptions: ["Only one option"] },
    ]),
  );
  const { errors } = await checkRepository(root, "validate");
  assert.ok(
    errors.some((error) =>
      error.startsWith(`${questionFile}:/1/answerOptions:`),
    ),
    errors.join("\n"),
  );
});

for (const answer of [0, [0], 2, [2]]) {
  test(`accepts the boundary answer index ${JSON.stringify(answer)}`, async (t) => {
    const root = await fixture(t, {
      ...validQuestion,
      correctAnswers: answer,
    });
    assert.deepEqual((await checkRepository(root, "validate")).errors, []);
  });
}

for (const [name, changes, expected] of [
  [
    "missing required fields",
    { questionText: undefined },
    /required property 'questionText'/,
  ],
  ["unknown properties", { unsupported: true }, /additional properties/],
  ["blank wording", { questionText: "  " }, /pattern/],
  ["invalid difficulty", { difficulty: "advanced" }, /allowed values/],
  ["repeated correct answers", { correctAnswers: [0, 0] }, /duplicate items/],
  [
    "an out-of-range scalar answer",
    { correctAnswers: 3 },
    /\/0\/correctAnswers: answer index 3 is out of range/,
  ],
  [
    "an out-of-range index in multiple answers",
    { correctAnswers: [0, 3] },
    /\/0\/correctAnswers\/1: answer index 3 is out of range/,
  ],
  ["a negative scalar index", { correctAnswers: -1 }, /must be >= 0/],
  ["a negative array index", { correctAnswers: [-1] }, /must be >= 0/],
  ["a fractional scalar index", { correctAnswers: 0.5 }, /must be integer/],
  ["a fractional array index", { correctAnswers: [0.5] }, /must be integer/],
  ["a string answer", { correctAnswers: "Router" }, /must be integer/],
  ["a numeric string answer", { correctAnswers: "0" }, /must be integer/],
  ["string answer indexes", { correctAnswers: ["0"] }, /must be integer/],
  ["a boolean answer", { correctAnswers: true }, /must be integer/],
  ["null answers", { correctAnswers: null }, /must be integer/],
  ["no correct answers", { correctAnswers: [] }, /fewer than 1 items/],
  [
    "duplicate option strings",
    { answerOptions: ["Router", "Router"] },
    /duplicate items/,
  ],
  ["blank option strings", { answerOptions: [" ", "Switch"] }, /pattern/],
  [
    "old option objects",
    {
      answerOptions: [
        { id: "a", text: "Router" },
        { id: "b", text: "Switch" },
      ],
    },
    /must be string/,
  ],
]) {
  test(`rejects ${name} and identifies the question file`, async (t) => {
    const root = await fixture(t, { ...validQuestion, ...changes });
    const { errors } = await checkRepository(root, "validate");
    assert.ok(
      errors.some(
        (error) => error.startsWith(questionFile) && expected.test(error),
      ),
      errors.join("\n"),
    );
  });
}

test("rejects the legacy question format", async (t) => {
  const root = await fixture(t, {
    meta: {},
    question: [{ text: "Old question" }],
  });
  assert.ok((await checkRepository(root, "validate")).errors.length > 0);
});

test("validates JSON outside question directories without treating it as a question", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "settings.json"), '{"enabled": true}');
  assert.deepEqual((await checkRepository(root, "validate")).errors, []);
  await writeFile(path.join(root, "settings.json"), '{"enabled": true,}');
  assert.ok(
    (await checkRepository(root, "validate")).errors.some((error) =>
      error.startsWith("settings.json:"),
    ),
  );
});

test("fails if a configured exam directory has no questions", async (t) => {
  const root = await fixture(t);
  await rm(path.join(root, "Sample Exam"), { recursive: true });
  assert.ok(
    (await checkRepository(root, "validate")).errors.includes(
      "Sample Exam: no valid JSON topic files found",
    ),
  );
});

test("rejects invalid configuration and invalid schemas", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "schema.json"), '{"type": "invalid-type"}');
  assert.ok(
    (await checkRepository(root, "validate")).errors.some((error) =>
      error.startsWith("schema.json:"),
    ),
  );
  await writeFile(path.join(root, configFile), '{"questionDirectories": []}');
  assert.ok(
    (await checkRepository(root, "validate")).errors.some((error) =>
      error.startsWith(`${configFile}:`),
    ),
  );
});

test("ignores dependencies but checks tracked files even when ignored", async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, "node_modules"));
  await writeFile(path.join(root, "node_modules/broken.json"), "invalid");
  assert.deepEqual((await checkRepository(root, "validate")).errors, []);
  execFileSync("git", ["add", "--force", "node_modules/broken.json"], {
    cwd: root,
  });
  assert.ok(
    (await checkRepository(root, "validate")).errors.some((error) =>
      error.startsWith("node_modules/broken.json:"),
    ),
  );
});

test("formatting preserves values, supports spaces in paths, and is idempotent", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, questionFile),
    JSON.stringify([
      validQuestion,
      {
        ...validQuestion,
        questionText: "Choose one device.",
        correctAnswers: 0,
      },
    ]),
  );
  const numbers =
    '{ "large":9007199254740993, "precise":0.1234567890123456789, "text":"café", "nested":[true,null] }\r\n';
  await writeFile(path.join(root, "numbers.json"), numbers);
  assert.ok((await checkRepository(root, "check")).errors.length > 0);
  const before = await readFile(path.join(root, questionFile), "utf8");
  const result = await checkRepository(root, "format");
  assert.deepEqual(result.errors, []);
  assert.ok(result.changed.includes(questionFile));
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, questionFile), "utf8")),
    JSON.parse(before),
  );
  const formatted = await readFile(path.join(root, "numbers.json"), "utf8");
  assert.match(formatted, /9007199254740993/);
  assert.match(formatted, /0\.1234567890123456789/);
  assert.match(formatted, /café/);
  assert.equal(formatted.includes("\r"), false);
  assert.ok(formatted.endsWith("\n"));
  assert.deepEqual((await checkRepository(root, "check")).errors, []);
  assert.deepEqual((await checkRepository(root, "format")).changed, []);
});

test("all JSON checks skip tracked and untracked content throughout .github", async (t) => {
  const root = await fixture(t);
  const ignoredFiles = new Map([
    [configFile, await readFile(path.join(root, configFile), "utf8")],
    [".github/settings.json", '{ "enabled":true }'],
    [".github/quality/broken.json", '{"unfinished":'],
  ]);
  for (const [file, source] of ignoredFiles) {
    await writeFile(path.join(root, file), source);
  }
  execFileSync("git", ["add", "--", ".github/settings.json"], { cwd: root });

  const before = await checkRepository(root, "check");
  assert.ok(before.errors.some((error) => error.startsWith(questionFile)));
  assert.ok(before.errors.every((error) => !error.startsWith(".github/")));
  const result = await checkRepository(root, "format");
  assert.deepEqual(result.errors, []);
  assert.ok(result.changed.includes(questionFile));
  assert.ok(result.changed.every((file) => !file.startsWith(".github/")));
  assert.deepEqual((await checkRepository(root, "check")).errors, []);
  for (const [file, source] of ignoredFiles) {
    assert.equal(await readFile(path.join(root, file), "utf8"), source);
  }
  const validation = await checkRepository(root, "validate");
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.count, 2);
});

test("formatting does not modify any files when one file contains invalid JSON", async (t) => {
  const root = await fixture(t);
  const before = await readFile(path.join(root, questionFile), "utf8");
  await writeFile(path.join(root, "broken.json"), '{"text": "unfinished",}');
  const result = await checkRepository(root, "format");
  assert.ok(result.errors.some((error) => error.startsWith("broken.json:")));
  assert.equal(await readFile(path.join(root, questionFile), "utf8"), before);
});

test("the CLI fails for invalid content and prints the offending file", async (t) => {
  const root = await fixture(t, {
    ...validQuestion,
    correctAnswers: 3,
  });
  const script = new URL("../scripts/json-quality.mjs", import.meta.url);
  assert.throws(
    () =>
      execFileSync(process.execPath, [script.pathname, "validate"], {
        cwd: root,
        stdio: "pipe",
      }),
    (error) =>
      error.status === 1 && error.stderr.toString().includes(questionFile),
  );
});

for (const directory of [".", ".github/quality"]) {
  test(`the validation CLI checks the repository when run from ${directory}`, async (t) => {
    const root = await fixture(t);
    const script = new URL("../scripts/json-quality.mjs", import.meta.url);
    const output = execFileSync(
      process.execPath,
      [script.pathname, "validate"],
      {
        cwd: path.join(root, directory),
        encoding: "utf8",
      },
    );
    assert.match(output, /JSON validate passed \(2 files\)/);
    await writeFile(path.join(root, questionFile), "invalid JSON");
    assert.throws(
      () =>
        execFileSync(process.execPath, [script.pathname, "validate"], {
          cwd: path.join(root, directory),
          stdio: "pipe",
        }),
      (error) =>
        error.status === 1 && error.stderr.toString().includes(questionFile),
    );
  });
}

for (const [name, source] of [
  ["invalid JSON syntax", "[{}"],
  [
    "an invalid topic schema",
    JSON.stringify([{ ...validQuestion, questionText: undefined }]),
  ],
]) {
  test(`the validation CLI fails for ${name}`, async (t) => {
    const root = await fixture(t);
    await writeFile(path.join(root, questionFile), source);
    const script = new URL("../scripts/json-quality.mjs", import.meta.url);
    assert.throws(
      () =>
        execFileSync(process.execPath, [script.pathname, "validate"], {
          cwd: root,
          stdio: "pipe",
        }),
      (error) =>
        error.status === 1 && error.stderr.toString().includes(questionFile),
    );
  });
}

test("the formatting CLI fails until the formatting fix is applied", async (t) => {
  const root = await fixture(t);
  const cwd = path.join(root, ".github/quality");
  const script = new URL("../scripts/json-quality.mjs", import.meta.url);
  assert.throws(
    () =>
      execFileSync(process.execPath, [script.pathname, "check"], {
        cwd,
        stdio: "pipe",
      }),
    (error) =>
      error.status === 1 &&
      error.stderr
        .toString()
        .includes("npm --prefix .github/quality run format:json"),
  );
  execFileSync(process.execPath, [script.pathname, "format"], { cwd });
  const output = execFileSync(process.execPath, [script.pathname, "check"], {
    cwd,
    encoding: "utf8",
  });
  assert.match(output, /JSON check passed/);
  assert.deepEqual((await checkRepository(root, "check")).errors, []);
});
