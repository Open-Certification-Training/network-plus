import { execFileSync } from "node:child_process";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { format } from "prettier";

// Explicit options keep local and CI formatting identical without loading plugins.
const formatOptions = {
  parser: "json",
  tabWidth: 2,
  useTabs: false,
  printWidth: 80,
  endOfLine: "lf",
};
const configFile = ".github/quality/package.json";

export async function checkRepository(root, mode) {
  if (!["validate", "check", "format"].includes(mode)) {
    throw new Error(
      "Usage: node .github/quality/scripts/json-quality.mjs <validate|check|format>",
    );
  }

  // Include new files locally, respect .gitignore, and handle spaces in paths.
  const files = [
    ...new Set(
      execFileSync(
        "git",
        [
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
          "--",
          "*.json",
          ":(top,exclude).github/**",
        ],
        { cwd: root, encoding: "utf8" },
      )
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
  const documents = new Map();
  const errors = [];
  const changed = [];

  for (const file of files) {
    try {
      const fullPath = path.join(root, file);
      const info = await lstat(fullPath);
      if (!info.isFile())
        throw new Error("JSON must be a regular file, not a symbolic link");
      const source = await readFile(fullPath, "utf8");
      // Parse first: formatting must never repair invalid JSON syntax silently.
      documents.set(file, { source, data: JSON.parse(source) });
    } catch (error) {
      if (error.code !== "ENOENT") errors.push(`${file}: ${error.message}`);
    }
  }

  if (mode === "validate") {
    const schema = documents.get("schema.json");
    // Read the tooling configuration without including it in reviewed content.
    let config;
    try {
      config = JSON.parse(await readFile(path.join(root, configFile), "utf8"));
    } catch (error) {
      errors.push(`${configFile}: cannot load configuration: ${error.message}`);
      return { errors, changed, count: documents.size };
    }
    if (!schema) errors.push("schema.json: a valid topic schema is required");
    const directories = config?.questionDirectories;
    if (
      !Array.isArray(directories) ||
      directories.length === 0 ||
      directories.some(
        (directory) =>
          typeof directory !== "string" ||
          !/^[^./\\][^/\\]*$/.test(directory) ||
          directory === "node_modules",
      )
    ) {
      errors.push(
        `${configFile}: questionDirectories must list top-level exam directories`,
      );
      return { errors, changed, count: documents.size };
    }

    let validate;
    if (schema) {
      try {
        validate = new Ajv2020({ allErrors: true }).compile(schema.data);
      } catch (error) {
        errors.push(`schema.json: ${error.message}`);
      }
    }

    for (const directory of directories) {
      const topics = [...documents].filter(([file]) =>
        file.startsWith(`${directory}/`),
      );
      if (topics.length === 0) {
        errors.push(`${directory}: no valid JSON topic files found`);
      }
      for (const [file, { data }] of topics) {
        if (!validate) continue;
        if (!validate(data)) {
          for (const error of validate.errors) {
            errors.push(
              `${file}:${error.instancePath || "/"}: ${error.message}`,
            );
          }
          continue;
        }
        for (const [questionIndex, question] of data.entries()) {
          const answersAreArray = Array.isArray(question.correctAnswers);
          const indexes = answersAreArray
            ? question.correctAnswers
            : [question.correctAnswers];
          for (const [position, index] of indexes.entries()) {
            if (index >= question.answerOptions.length) {
              const answerPath = answersAreArray
                ? `/${questionIndex}/correctAnswers/${position}`
                : `/${questionIndex}/correctAnswers`;
              errors.push(
                `${file}:${answerPath}: answer index ${index} is out of range; expected 0 through ${question.answerOptions.length - 1}`,
              );
            }
          }
        }
      }
    }
  } else {
    const updates = [];
    for (const [file, { source }] of documents) {
      const formatted = await format(source, formatOptions);
      if (formatted !== source) {
        changed.push(file);
        updates.push([file, formatted]);
        if (mode === "check")
          errors.push(
            `${file}: run npm --prefix .github/quality run format:json`,
          );
      }
    }
    // Leave all files untouched if any document has invalid JSON.
    if (mode === "format" && errors.length === 0) {
      for (const [file, formatted] of updates) {
        await writeFile(path.join(root, file), formatted, "utf8");
      }
    }
  }
  return { errors, changed, count: documents.size };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const mode = process.argv[2];
    // npm runs scripts from the tooling directory; always check the entire repo.
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    const result = await checkRepository(root, mode);
    for (const error of result.errors) console.error(error);
    if (result.errors.length) {
      process.exitCode = 1;
    } else {
      console.log(`JSON ${mode} passed (${result.count} files).`);
      if (mode === "format")
        console.log(`Formatted ${result.changed.length} files.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
