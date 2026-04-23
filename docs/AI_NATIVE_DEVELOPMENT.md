# AI-Native Development

This project uses an auditable AI-assisted development workflow so the repository can show more than code alone.

## Why This Exists

Job descriptions for AI-native engineering often mention tools such as:

- OpenAI Codex
- Cursor
- Claude Code
- Antigravity

A codebase cannot reliably prove interactive tool usage after the fact unless the team leaves a paper trail. This document and the PR template create that trail.

## What To Record In PRs

For any meaningful feature, fix, or refactor, contributors should capture:

- which AI-native tool(s) were used
- what part of the task they accelerated
- what the human engineer verified manually
- any prompts, summaries, or transcripts worth preserving

## Recommended Evidence

- Short workflow summary:
  - "Codex used for multi-file refactor and build verification."
  - "Cursor used for UI iteration and route-level cleanup."
  - "Claude Code used for debugging orchestration edge cases."
- Verification summary:
  - tests run
  - build commands run
  - screenshots or links when UI changed
- Artifacts when useful:
  - prompt snippets
  - reasoning summaries
  - before/after metrics

## Current Repo Support

- `.github/pull_request_template.md` includes an `AI-native development evidence` section.
- README calls out the AI-native workflow so reviewers and recruiters can find it quickly.

## Notes

- This process does not claim that AI tools replaced engineering judgment.
- It shows that the team uses AI-native tooling deliberately and keeps human verification in the loop.
