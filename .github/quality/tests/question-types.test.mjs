import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const schema = JSON.parse(
  await readFile(new URL("../../../schema.json", import.meta.url), "utf8"),
);
const validate = new Ajv2020({ allErrors: true }).compile(schema);
const binaryQuestion = {
  questionType: "true-false",
  questionText: "A router can forward packets between different IP networks.",
  answerOptions: ["True", "False"],
  correctAnswers: 0,
};

test("true/false accepts either index as a scalar or one-element array", () => {
  for (const answer of [0, 1, [0], [1]]) {
    const question = { ...binaryQuestion, correctAnswers: answer };
    assert.equal(validate([question]), true, JSON.stringify(validate.errors));
  }
});

test("translated and reordered options use their stored positions", () => {
  const question = {
    ...binaryQuestion,
    answerOptions: ["Faux", "Vrai"],
    correctAnswers: 1,
  };
  assert.equal(validate([question]), true, JSON.stringify(validate.errors));
  assert.equal(question.answerOptions[question.correctAnswers], "Vrai");
});

test("omitted and explicit multiple-choice types retain single and multiple answers", () => {
  for (const questionType of [undefined, "multiple-choice"]) {
    for (const correctAnswers of [0, [0], [0, 1]]) {
      const question = {
        questionText: "Choose the matching options.",
        answerOptions: ["One", "Two"],
        correctAnswers,
      };
      if (questionType !== undefined) question.questionType = questionType;
      assert.equal(validate([question]), true, JSON.stringify(validate.errors));
      assert.equal(
        Object.hasOwn(question, "questionType"),
        questionType !== undefined,
      );
    }
  }
});

for (const [name, changes] of [
  ["unknown type", { questionType: "essay" }],
  ["null type", { questionType: null }],
  ["boolean type", { questionType: true }],
  ["a third option", { answerOptions: ["True", "False", "Other"] }],
  ["a missing option", { answerOptions: ["True"] }],
  ["duplicate option strings", { answerOptions: ["True", "True"] }],
  ["blank option strings", { answerOptions: ["True", " "] }],
  [
    "old option objects",
    {
      answerOptions: [
        { id: "true", text: "True" },
        { id: "false", text: "False" },
      ],
    },
  ],
  ["boolean options", { answerOptions: [true, false] }],
  ["both answers marked correct", { correctAnswers: [0, 1] }],
  ["no correct answer", { correctAnswers: [] }],
  ["an out-of-range scalar index", { correctAnswers: 2 }],
  ["an out-of-range array index", { correctAnswers: [2] }],
  ["a boolean answer", { correctAnswers: true }],
  ["a string answer", { correctAnswers: "True" }],
]) {
  test(`rejects true/false with ${name}`, () => {
    assert.equal(validate([{ ...binaryQuestion, ...changes }]), false);
  });
}

test("the example topic validates and demonstrates single-answer, multiselect, and true/false questions", async () => {
  const example = JSON.parse(
    await readFile(
      new URL(
        "./fixtures/question-types.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(validate(example), true, JSON.stringify(validate.errors));
  assert.ok(
    example.some(
      (question) =>
        question.questionType === "multiple-choice" &&
        Number.isInteger(question.correctAnswers),
    ),
  );
  assert.ok(
    example.some(
      (question) =>
        question.questionType === "multiple-choice" &&
        Array.isArray(question.correctAnswers) &&
        question.correctAnswers.length > 1,
    ),
  );
  assert.ok(example.some((question) => question.questionType === "true-false"));
});
