# Orchestrator E2E Specification

## Purpose

Verify that the multi-model code review pipeline works end-to-end using real CodeBuddy CLI calls to two different models.

## Test Cases

### TC-1: DeepSeek returns valid results
- **Input:** `review-runner.mjs` source code
- **Model:** `deepseek-v4-pro`
- **Expected:** `success === true`, non-empty `summary` string, valid JSON structure

### TC-2: Qwen returns valid results
- **Input:** `review-runner.mjs` source code
- **Model:** `qwen-coder-plus`
- **Expected:** `success === true`, non-empty `summary` string, valid JSON structure

### TC-3: Divergent perspectives
- **Input:** Same code, same prompt, both models in parallel
- **Expected:** At least one model reports issues. If both report issues, findings differ (proving model-independent analysis).

## Prerequisites

- `DEEPSEEK_API_KEY` and `DASHSCOPE_API_KEY` set in environment
- `codebuddy` CLI installed and on PATH

## Running

```bash
pnpm test:e2e
```
