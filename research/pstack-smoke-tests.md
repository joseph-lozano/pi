# Pstack smoke-test evidence

Date: 2026-08-21

These tests ran Pi with `PI_CODING_AGENT_DIR` set to the `pstack` worktree and a process-local session directory. The Herdr tabs remain open in the originating test session; `/tmp` artifacts are disposable and the setup commands below describe the fixtures.

## Runtime and skill loading

Tab: `test-pstack-runtime`

- Pi startup loaded `pstack`, `todo`, `background-jobs`, and the vendored skill inventory with no skill diagnostics after correcting the Poteto name and adapter location.
- `/poteto-mode` displayed `🥔 poteto` in the existing footer.
- `/reload` restored the enabled footer state from the session entry.
- The disable command removed the footer indicator (now exposed as `/poteto-off`).
- A direct system-prompt check returned `pstack-pi=no, how=yes`, confirming the hidden adapter is not model-invocable while `how` remains discoverable.
- `/skill:how Where is the pstack model-role configuration defined?` completed through a read-only worker and cited `extensions/pstack/models.ts`.

Session directory: `/tmp/pi-pstack-pstack-smoke-sessions`

## Investigation and todos

Prompt:

```text
/poteto-mode Explain where todo statuses are defined in this repository. This is read-only; do not edit files.
```

Evidence:

- Routed to Investigation and How.
- Created nine hierarchical playbook todos in verbatim order after the Principles seed.
- Persisted a skipped Why item with a concrete reason.
- Launched a read-only reviewer.
- Completed without repository changes.
- Manual `/compact` compacted 36,210 tokens; the complete todo widget remained visible afterward.
- `pstack_sessions list` and `jobs` returned one workspace session and one current-session worker log.

## Profile and model routing

Explicit exploration worker:

```text
job start, kind pi, mode blocking, profile reviewer, role exploration
```

Evidence: `job_mt2c5zow_2.log` reported provider `xai`, model `grok-4.6`, and returned `PROFILE_OK`. Unit tests independently verify reviewer, investigator, and Comment Sicko profiles omit `bash`, `edit`, and `write`.

## Feature

Tab: `test-pstack-feature`

Fixture: a disposable JavaScript `Counter` class with one passing increment test.

Prompt:

```text
/poteto-mode Add Counter.decrement() in src/counter.js. It must subtract one but never go below zero. Add focused node:test coverage. Delegate implementation to a local poteto worker, review its diff in the parent, and run the real test command. Do not commit or communicate externally.
```

Evidence:

- Thirteen Feature playbook todos, including throughput-checkpoint children and reasoned skips.
- Poteto writer changed only `src/counter.js` and `test/counter.test.js`.
- Parent reviewed the complete diff.
- Independent `npm test`: 3 passed, 0 failed.
- `git diff --check`: passed.
- No commit or external action.

Disposable repository: `/tmp/pstack-feature-fSjyMH`

## Bug fix

Tab: `test-pstack-bug`

Fixture: a committed `clamp` implementation whose inner `Math.max` incorrectly used `maximum` instead of `value`; both supplied tests failed.

Prompt:

```text
/poteto-mode Fix the failing clamp tests. Reproduce the failure first, identify and explain the root-cause mechanism, delegate the smallest fix to a local poteto worker, review its diff, and verify through npm test. Do not commit or communicate externally.
```

Evidence:

- Reproduced 0 passed, 2 failed before editing.
- Identified the ignored-input mechanism.
- Poteto worker made one operand change.
- Parent reviewed the diff and reran the original surface.
- Final `npm test`: 2 passed, 0 failed.
- No commit or external action.

Disposable repository: `/tmp/pstack-bug-ZjHjBU`

## Interrogate and Arena

Interrogate ran against the disposable Feature diff. Two read-only reviewers used:

- `openai-codex/gpt-5.6-sol`
- `xai/grok-4.6`

Both returned zero findings and the parent produced an agreement map without modifying files.

Arena prompt requested exactly two design candidates and isolated artifacts under `/tmp/pstack-arena-smoke`. Candidate and judge logs used both configured model families. Arena framed, fanned out, cross-judged, selected, grafted, and verified six phases. `git status --short` remained empty.

## Babysit check and real watcher

Babysit check-mode prompt targeted public upstream PR `cursor/plugins#236` and prohibited mutation. It reported:

- Cursor Bugbot passed.
- No blocking review decision.
- GitHub merge state `CLEAN` and mergeable.
- No reply, fix, push, resolve, or other mutation.

A fresh Pi process in tab `test-pstack-watcher` ran the exact managed shell job:

```text
gh pr checks 236 --repo cursor/plugins --watch --interval 30
```

Job `job_mt2dh737_1` completed with exit code 0 and Bugbot pass output. Log:

```text
/tmp/pi-pstack-watcher-smoke-sessions/background-jobs/job_mt2dh737_1.log
```

## Automated suite

The suite covers mode state, prompt safety, model roles, unavailable-model detection, canonical workspace session scope, symlink rejection, bounded log tails, worker profile tools, one-writer checkout locks, partial fan-out failure, watcher wake/rearm/timeout/cancel, todo hierarchy, compaction support, and existing Pi extensions.

Run:

```text
bun test
```

## Expanded pre-merge smoke pass

Date: 2026-08-21

Fresh Herdr tabs loaded Pi from the `pstack` worktree with isolated session directories.

- **Five-model panel routing:** five concurrent `interrogate-reviewers` jobs at panel indexes 0–4 returned `ROUTE_0` through `ROUTE_4`. Independent JSON log inspection confirmed, in order, `xai/grok-4.6`, `xai/grok-4.5`, `openai-codex/gpt-5.6-sol`, `openai-codex/gpt-5.6-luna`, and `openai-codex/gpt-5.6-terra`.
- **Poteto Mode:** `/poteto-mode` injected the workflow prompt (`POTETO_ACTIVE`), displayed bare `🥔` immediately after the background-job array, survived `/reload`, and `/poteto-off` removed the indicator.
- **Todo display contract:** an over-80-character item without `displayName` was rejected. Retrying with `displayName: "Human display label"` retained the exact full text for `todo get`, while the widget showed only the display name and no ID. Todo calls rendered on one line.
- **Compact session calls:** after reload, `pstack_sessions list` rendered as the single line `pstack sessions list`.
- **Reflect:** an intentionally empty session ran judgment, tooling, and divergent reviewers concurrently. Grok 4.6 handled judgment/divergent, Luna handled tooling, all returned `NO_FINDINGS`, and Grok 4.6 synthesis produced empty Accepted, Rejected, and Backlog sections without inventing findings. An earlier run exposed and led to fixing the old forced 3–5 finding requirement.
- **Model controls:** real one-shot requests passed for Sol Max, Luna High, Terra High, and Grok 4.5 High. Exact `FOOBAR` controls failed for xAI and OpenAI Codex, confirming no generic unknown-model fallback.
- **Repository state:** no smoke agent modified tracked files. Final `bun test`: 53 passed, 0 failed.
