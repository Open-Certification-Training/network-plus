#!/usr/bin/env bash
set -euo pipefail

check_names=("Spelling" "JSON validation" "JSON formatting" "Validator tests")
check_results=(
  "${SPELLING_RESULT:-missing}"
  "${JSON_RESULT:-missing}"
  "${FORMATTING_RESULT:-missing}"
  "${TESTS_RESULT:-missing}"
)
gate_exit=0

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '| Check | Result |\n| --- | --- |\n' >> "$GITHUB_STEP_SUMMARY"
fi

for index in "${!check_names[@]}"; do
  check_result="${check_results[$index]}"
  printf '%s: %s\n' "${check_names[$index]}" "$check_result"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '| %s | %s |\n' "${check_names[$index]}" "$check_result" >> "$GITHUB_STEP_SUMMARY"
  fi
  if [[ "$check_result" != "success" ]]; then
    gate_exit=1
  fi
done

exit "$gate_exit"
