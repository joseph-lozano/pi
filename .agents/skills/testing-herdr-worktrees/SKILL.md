---
name: testing-herdr-worktrees
description: Test a feature from an isolated Herdr git worktree. Use whenever HERDR_ENV=1, the current checkout is a Herdr worktree, and the user asks to test, exercise, validate, smoke-test, or try a feature.
compatibility: Requires the Herdr CLI and a Herdr-managed pane.
---

# Test from a Herdr worktree

Run the feature from the worktree that contains the changes. Keep the user's current tab focused and collect evidence from the real program.

## 1. Confirm the test target

1. Load the `herdr` skill. Its runtime checks and CLI safety rules apply throughout this workflow.
2. Confirm Herdr and the linked worktree:

   ```bash
   test "${HERDR_ENV:-}" = 1
   root="$(git rev-parse --show-toplevel)"
   git_dir="$(git -C "$root" rev-parse --path-format=absolute --git-dir)"
   common_dir="$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)"
   test "$git_dir" != "$common_dir"
   git -C "$root" status --short --branch
   ```

   If any check fails, stop this workflow. Report that testing requires a Herdr-managed pane and a linked Git worktree. Do not create a tab or run the feature from another checkout.

3. Read the repo instructions and identify the command, extension, server, or agent that must load from `root`.
4. Define a concrete pass condition before launching. Include the expected user-facing result and any artifact, log, or file that can prove it.

This step is complete when the test command and observable pass condition are explicit.

## 2. Prepare an isolated tab

Choose one tab command below. For a Pi config checkout, use the Pi-specific command instead of the generic command. Preserve the user's focus.

```bash
branch="$(git -C "$root" branch --show-current)"
label="test-${branch//\//-}"
herdr tab create \
  --workspace "$HERDR_WORKSPACE_ID" \
  --cwd "$root" \
  --label "$label" \
  --no-focus
```

Read the root pane ID from `.result.root_pane.pane_id`.

Install missing worktree-local dependencies before launch. Keep generated dependencies and credentials on paths already covered by `.gitignore`.

### Pi config checkouts

A Pi config worktree must run as the config directory for the test process. Leave `~/.pi/agent` pointing at the live checkout and leave `setup.sh` alone.

If the test needs provider credentials, first confirm `auth.json` is ignored, then link the existing credential file into the worktree:

```bash
git -C "$root" check-ignore -q auth.json
ln -sf "$HOME/.pi/agent/auth.json" "$root/auth.json"
```

Create the tab with process-local Pi paths instead of the generic command above:

```bash
session_dir="${TMPDIR:-/tmp}/pi-${branch//\//-}-sessions"
herdr tab create \
  --workspace "$HERDR_WORKSPACE_ID" \
  --cwd "$root" \
  --label "$label" \
  --env "PI_CODING_AGENT_DIR=$root" \
  --env "PI_CODING_AGENT_SESSION_DIR=$session_dir" \
  --no-focus
```

This step is complete when the new tab's shell is rooted in the worktree and has every process-local path needed to load the changed code.

## 3. Launch the real program

For Pi, start a uniquely named agent in the returned pane:

```bash
herdr agent start <test-name> --kind pi --pane <pane-id> --timeout 60000
```

For an ordinary CLI, server, or test runner, use the pane directly:

```bash
herdr pane run <pane-id> '<launch command>'
```

If startup exits, inspect before retrying:

```bash
herdr pane read <pane-id> --source recent-unwrapped --lines 160
herdr pane process-info --pane <pane-id>
```

Retry only after the output identifies a transient first-run action or after fixing the startup fault. A process that stays ready in the worktree completes this step.

## 4. Exercise the feature

For an interactive agent, submit one reproducible test prompt:

```bash
herdr agent prompt <test-name> \
  'Exercise <feature> using <input>. Inspect the returned result and any artifact path. Verify the artifact independently. Report the exact pass/fail evidence. Do not edit files.' \
  --wait --timeout 240000
```

For other programs, drive the public CLI, HTTP endpoint, UI, or file output that a user would encounter. Prefer one representative success case; add a boundary or failure case when the feature depends on a limit or fallback.

This step is complete when the real program has produced the expected result or a reproducible failure.

## 5. Verify and report

1. Read the test transcript or pane output:

   ```bash
   herdr agent read <test-name> --source recent-unwrapped --lines 160
   # or
   herdr pane read <pane-id> --source recent-unwrapped --lines 160
   ```

2. Independently inspect claimed files, logs, counts, response fields, or boundary content from the controlling pane. Do not rely only on the test agent's summary.
3. Report:
   - Herdr tab and agent or pane name
   - command or prompt used
   - pass or fail
   - concise measured evidence
   - artifact paths
   - any untested case or startup issue
4. Leave the test tab open unless the user asks to close it.

The workflow is complete only when the reported evidence reproduces the pass condition from step 1.
