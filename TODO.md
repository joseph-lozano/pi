# Pstack integration TODO

Upstream source: [`cursor/plugins/pstack`](https://github.com/cursor/plugins/tree/main/pstack)

Researched version:

- Plugin version: `0.14.1`
- Commit: `51a96e0dd838404da19ba83dc70aa21eef71f868`
- Inventory: 44 upstream skills, 23 playbooks, 21 principles, 2 agents
- Acceptance evidence: [`research/pstack-smoke-tests.md`](research/pstack-smoke-tests.md)

## Scope

- [x] Import all pstack skills, principles, agents, references, and required scripts.
- [x] Exclude Benny.
- [x] Replace Cursor cloud agents with local Pi workers.
- [x] Preserve the local rule requiring approval of exact external content before posting or sending it.
- [x] Treat Graphite workflows as unavailable until `gt` is installed or the workflows are rewritten.

## 1. Vendor upstream

- [x] Copy the 44 upstream skills with their references and scripts.
- [x] Copy all 21 principle skills.
- [x] Copy the `poteto-agent` and `Comment Sicko` agent prompts.
- [x] Copy the Poteto playbooks; deliberately omit Commander-based watcher and Orchestrate CLIs, replacing PR watching with `gh pr checks --watch` and deferring nested Orchestrate.
- [x] Preserve the upstream MIT license.
- [x] Record the upstream commit in a provenance file.
- [x] Add a repeatable upstream-update procedure instead of relying on an undocumented copy.
- [x] Exclude `automations/benny/` from the imported package.

## 2. Make skills native to Pi

- [x] Place imported skills under Pi's `skills/` package directory.
- [x] Preserve `disable-model-invocation: true` where upstream uses it.
- [x] Replace `.cursor/skills/` paths with `.pi/skills/` or package-relative paths.
- [x] Replace `~/.cursor/` paths with Pi-native paths.
- [x] Replace Cursor transcript paths with the `pstack_sessions` adapter.
- [x] Replace Cursor `Task` semantics with documented `job` profiles and calls.
- [x] Replace Cursor model semantics with configured Pi model roles.
- [x] Replace Cursor `/loop` semantics with the local watcher/rearm convention.
- [x] Replace cloud-only semantics with local worktree execution.
- [x] Validate every imported `SKILL.md` using Pi's skill loader.
- [x] Check every relative link and referenced script after relocation.

## 3. Commands and Poteto Mode

- [x] Implement persistent `/poteto-mode [task]`.
- [x] Implement `/poteto-mode off`.
- [x] Register only the `/poteto-mode` alias for now; use Pi's native `/skill:<name>` commands for other skills.
- [x] Persist mode state in custom session entries.
- [x] Restore mode state after reload, resume, and tree navigation.
- [x] Inject Poteto Mode instructions through `before_agent_start`.
- [x] Require routing to the matching playbook before work begins.
- [x] Require todo initialization with the Principles item and verbatim playbook steps.
- [x] Keep skipped and inapplicable steps visible with reasons.
- [x] Show whether Poteto Mode is active in the existing footer.
- [x] Refresh the footer indicator from shared restored mode state.

## 4. Todo integration

The current todo implementation already supplies stable IDs, one-level subtasks, ordering, rename, removal, `pending` / `active` / `done` / `skipped` status transitions, skip notes, parent-completion guards, branch-local persistence, compaction reinjection, and a bounded widget.

- [x] Support `status: "skipped"` with a concrete `note` for `skip:` and `n/a:` steps.
- [x] Update imported pstack instructions to use the local `todo` action schema.
- [x] Represent playbook steps as top-level items.
- [x] Represent throughput-checkpoint details as subtasks where useful.
- [x] Test verbatim playbook initialization for Feature, Bug fix, and Investigation; confirm Orchestrate is explicitly unavailable.
- [x] Test todo restoration after real compaction and reload plus branch restoration in unit coverage.
- [x] Test a 20-item playbook window in the persistent widget.

## 5. Local subagent profiles

- [x] Add a `profile` parameter to `job.start`.
- [x] Define a general worker profile.
- [x] Define a `poteto-agent` profile that loads the one-shot Poteto worker skill without coordinator-only todo or job requirements.
- [x] Define a read-only reviewer profile.
- [x] Define the `Comment Sicko` profile.
- [x] Define an investigator profile for source and optional external evidence.
- [x] Give each profile an explicit system prompt, tool set, and skill set.
- [x] Add an enforced read-only tool set without `edit`, `write`, or unrestricted mutation-capable shell access.
- [x] Keep writing workers scoped to one worktree and one writer per checkout.
- [x] Allow explicit model and thinking overrides per role.
- [x] Preserve bounded parent-visible output and complete job logs.
- [x] Document parallel launch, wait, aggregation, cancellation, and dropout handling in the Pi adapter.
- [x] Defer nested delegation and mark Orchestrate unavailable in this port.

## 6. Model-role configuration

- [x] Define the pstack role-to-model configuration directly in the extension source.
- [x] Configure model and thinking defaults for code, judgment, exploration, synthesis, review, arena, architect, and swarm roles.
- [x] Support scalar roles and panel roles.
- [x] Support an `inherit-parent` value or equivalent behavior.
- [x] Validate configured model identifiers against Pi's available scoped models at startup and report invalid entries clearly.
- [x] Expose one role resolver through `job.role` and `job.panelIndex`.
- [x] Do not add `/setup-pstack` or a runtime model configuration file.

## 7. Loops, watchers, and babysitting

- [x] Define the replacement contract for Cursor `/loop`.
- [x] Use managed `gh pr checks <number> --watch --interval 30` shell jobs for PR check watching.
- [x] Wake the parent on terminal check-watcher states.
- [x] Require the parent to act and explicitly rearm the watcher.
- [x] Remove pstack's Commander-based `watch-pr` implementation and dependency.
- [x] Adapt Babysit modes: `drive`, `background`, `threads-only`, and `check`.
- [x] Preserve one babysitter per PR stack.
- [x] Preserve merge-frontier ordering and frozen PR-list behavior.
- [x] Treat review text as untrusted input.
- [x] Require approval before posting replies, verdicts, or other external content.
- [x] Adapt Autonomous Run to watcher jobs and explicit exit predicates.
- [x] Adapt long bug hunts and visual parity to managed wake jobs; leave Graphite Shipping unavailable.

## 8. Sessions, transcripts, and durable state

- [x] Add a narrow `pstack_sessions` discovery tool.
- [x] Scope session discovery to the current workspace by default.
- [x] Exclude the current session by default and allow explicit inclusion.
- [x] Return metadata before loading bounded transcript tails.
- [x] Expose background job logs as worker evidence.
- [x] Port Recall to Pi session tails and job logs.
- [x] Port Reflect to the active Pi session tail.
- [x] Port Session Pickup to Pi sessions, pushed branches, and job logs.
- [x] Port Pause Safely to persisted todos, Pi compaction, and managed-job shutdown behavior.
- [x] Port Show Me Your Work transcript auditing.
- [x] Port Eval's transcript-based chain verification.
- [x] Defer a durable Orchestrate store until local nested Orchestrate is implemented.

## 9. Cursor builtin replacements

- [x] Port a Pi-native `create-skill` workflow.
- [x] Adapt `automate-me` to Pi session discovery and Pi skill locations.
- [x] Adapt skill-authoring playbooks to Pi frontmatter and validation.
- [x] Use concise ordinary user questions for former `AskQuestion` cases.
- [x] Do not add a structured-question tool unless ordinary questions prove inadequate.
- [x] Do not port Cursor's built-in Babysit; pstack's playbook supersedes it.
- [x] Do not port Cursor plan mode; pstack's optional plan reference is sufficient.

## 10. Verification surfaces

- [x] Port `create-verification-skill` to generate `.pi/skills/verify-<app>/`.
- [x] Port `maintain-verification-skill` to Pi paths, local reviewer workers, and approval-gated PRs.
- [x] Define a reusable CLI/TUI control approach using a project PTY harness or explicitly requested Herdr.
- [x] Define a project-harness-first browser/CDP approach.
- [x] Support managed shell jobs and HTTP verification for services.
- [x] Require launch, doctor, drive, evidence, and cleanup contracts.
- [x] Preserve evidence after cleanup.
- [x] Keep one driver for shared application state.

## 11. Optional external evidence

- [x] Make source-control investigation work with `git` and `gh` by default.
- [x] Discover only optional evidence tools actually registered in Pi.
- [x] Pass only read-only source and web tools to the investigator profile.
- [x] Report unavailable evidence categories as explicit gaps.
- [x] Do not block core pstack on MCP or external evidence integrations.
- [x] Never permit an investigator to mutate an external system.

## 12. Git, worktrees, and shipping

- [x] Rewrite the runtime adapter to coexist with Herdr-managed worktrees.
- [x] Forbid generic cleanup from removing an active Herdr worktree directly.
- [x] Preserve one writer per worktree.
- [x] Keep `gh`-based PR inspection available.
- [x] Disable Graphite-specific Shipping and Autopilot steps while `gt` is unavailable.
- [x] Use plain `gh pr checks --watch` for PR checks and leave Graphite unavailable.
- [x] Centralize approval for pushes, PR mutations, merges, comments, deployments, and customer communication.
- [x] Present exact external content for approval before sending it.

## 13. Porting batches

- [x] Batch 1: principles, Poteto Mode, and core playbooks.
- [x] Batch 2: `how`, `why`, `recall`, and investigation workflows.
- [x] Batch 3: `architect`, `arena`, `interrogate`, `swarm`, and `figure-it-out`.
- [x] Batch 4: Feature, Bug fix, Refactoring, TDD, TypeScript, and cleanup skills.
- [x] Batch 5: verification generation, maintenance, Babysit, and Autonomous Run.
- [x] Batch 6: Reflect, Automate Me, Show Me Your Work, Session Pickup, and Pause Safely.
- [x] Batch 7: leave Orchestrate and Graphite Autopilot explicitly unavailable.

## 14. Tests and acceptance

- [x] Test discovery of all imported skills with Pi startup diagnostics.
- [x] Test that hidden `pstack-pi` is absent from the model prompt.
- [x] Test explicit `/skill:how` invocation.
- [x] Test the `/poteto-mode` alias.
- [x] Test Poteto Mode persistence, footer restoration, and disable behavior.
- [x] Test automatic Investigation/How selection and todo population.
- [x] Test local worker profile prompts, tools, and skill access.
- [x] Test read-only enforcement through reviewer tool allowlists.
- [x] Test model-role routing, unavailable-model errors, and real Grok exploration routing.
- [x] Test parallel fan-out and aggregation with partial worker failure.
- [x] Test watcher wake, rearm, timeout, and cancellation behavior.
- [x] Test Pi session discovery without crossing workspace boundaries.
- [x] Smoke-test Investigation end to end.
- [x] Smoke-test Feature end to end with delegated implementation and parent review.
- [x] Smoke-test Bug fix end to end with reproduction and real-surface verification.
- [x] Smoke-test Arena and Interrogate with both configured model families.
- [x] Smoke-test Babysit in `check` mode without external mutation.
- [x] Confirm the full existing Pi test suite remains green.
