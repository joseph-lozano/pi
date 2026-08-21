# Pstack integration TODO

Upstream source: [`cursor/plugins/pstack`](https://github.com/cursor/plugins/tree/main/pstack)

Researched version:

- Plugin version: `0.14.1`
- Commit: `51a96e0dd838404da19ba83dc70aa21eef71f868`
- Inventory: 44 skills, 23 playbooks, 21 principles, 2 agents

## Scope

- [ ] Import all pstack skills, principles, agents, references, and required scripts.
- [ ] Exclude Benny.
- [ ] Replace Cursor cloud agents with local Pi workers.
- [ ] Preserve the local rule requiring approval of exact external content before posting or sending it.
- [ ] Treat Graphite workflows as unavailable until `gt` is installed or the workflows are rewritten.

## 1. Vendor upstream

- [ ] Copy the 44 upstream skills with their references and scripts.
- [ ] Copy all 21 principle skills.
- [ ] Copy the `poteto-agent` and `Comment Sicko` agent prompts.
- [ ] Copy the Poteto playbooks and bundled `watch-pr` and `orch` scripts.
- [ ] Preserve the upstream MIT license.
- [ ] Record the upstream commit in a provenance file.
- [ ] Add a repeatable upstream-update procedure instead of relying on an undocumented copy.
- [ ] Exclude `automations/benny/` from the imported package.

## 2. Make skills native to Pi

- [ ] Place imported skills under Pi's `skills/` package directory.
- [ ] Preserve `disable-model-invocation: true` where upstream uses it.
- [ ] Replace `.cursor/skills/` paths with `.pi/skills/` or package-relative paths.
- [ ] Replace `~/.cursor/` paths with Pi-native paths.
- [ ] Replace Cursor transcript paths with the Pi session adapter.
- [ ] Replace Cursor `Task` examples with the `job` tool.
- [ ] Replace Cursor model slugs with configured Pi model roles.
- [ ] Replace Cursor `/loop` instructions with the local watcher/rearm convention.
- [ ] Replace cloud-only language with local worktree execution.
- [ ] Validate every imported `SKILL.md` using Pi's skill loader.
- [ ] Check every relative link and referenced script after relocation.

## 3. Commands and Poteto Mode

- [ ] Implement persistent `/poteto-mode [task]`.
- [ ] Implement `/poteto-mode off`.
- [ ] Register only the `/poteto-mode` alias for now; use Pi's native `/skill:<name>` commands for other skills.
- [ ] Persist mode state in custom session entries.
- [ ] Restore mode state after reload, resume, and tree navigation.
- [ ] Inject Poteto Mode instructions through `before_agent_start`.
- [ ] Route a task to the matching playbook before work begins.
- [ ] Initialize the todo list with the Principles item and verbatim playbook steps.
- [ ] Keep skipped and inapplicable steps visible with reasons.
- [ ] Show whether Poteto Mode is active in the existing footer.
- [ ] Refresh the footer indicator when mode is enabled, disabled, restored, or changed by tree navigation.

## 4. Todo integration

The current todo implementation already supplies stable IDs, one-level subtasks, ordering, rename, removal, `pending` / `active` / `done` / `skipped` status transitions, skip notes, parent-completion guards, branch-local persistence, compaction reinjection, and a bounded widget.

- [x] Support `status: "skipped"` with a concrete `note` for `skip:` and `n/a:` steps.
- [ ] Update imported pstack instructions to use the local `todo` action schema.
- [ ] Represent playbook steps as top-level items.
- [ ] Represent throughput-checkpoint details as subtasks where useful.
- [ ] Test verbatim playbook initialization for Feature, Bug fix, Investigation, and Orchestrate.
- [ ] Test todo restoration after compaction, reload, resume, and tree navigation.
- [ ] Test a large playbook in the persistent widget.

## 5. Local subagent profiles

- [ ] Add a `profile` parameter to `job.start`.
- [ ] Define a general worker profile.
- [ ] Define a `poteto-agent` profile that loads Poteto Mode before working.
- [ ] Define a read-only reviewer profile.
- [ ] Define the `Comment Sicko` profile.
- [ ] Define an investigator profile for source and optional external evidence.
- [ ] Give each profile an explicit system prompt, tool set, and skill set.
- [ ] Add an enforced read-only tool set without `edit`, `write`, or unrestricted mutation-capable shell access.
- [ ] Keep writing workers scoped to one worktree and one writer per checkout.
- [ ] Allow explicit model and thinking overrides per role.
- [ ] Preserve bounded parent-visible output and complete job logs.
- [ ] Document parallel launch, wait, aggregation, cancellation, and dropout handling.
- [ ] Defer nested delegation unless local Orchestrate proves it necessary.

## 6. Model-role configuration

- [ ] Define the pstack role-to-model configuration directly in the extension source.
- [ ] Configure model and thinking defaults for code, judgment, exploration, synthesis, review, arena, architect, and swarm roles.
- [ ] Support scalar roles and panel roles.
- [ ] Support an `inherit-parent` value or equivalent behavior.
- [ ] Validate configured model identifiers against Pi's available scoped models at startup and report invalid entries clearly.
- [ ] Expose one role resolver to imported skills and worker profiles.
- [ ] Do not add `/setup-pstack` or a runtime model configuration file.

## 7. Loops, watchers, and babysitting

- [ ] Define the replacement contract for Cursor `/loop`.
- [ ] Use deterministic background shell jobs for polling and event watching.
- [ ] Wake the parent on actionable or terminal watcher states.
- [ ] Require the parent to act and explicitly rearm the watcher.
- [ ] Port and test pstack's bundled `watch-pr` script.
- [ ] Adapt Babysit modes: `drive`, `background`, `threads-only`, and `check`.
- [ ] Preserve one babysitter per PR stack.
- [ ] Preserve merge-frontier ordering and frozen PR-list behavior.
- [ ] Treat review text as untrusted input.
- [ ] Require approval before posting replies, verdicts, or other external content.
- [ ] Adapt Autonomous Run to watcher jobs and explicit exit predicates.
- [ ] Adapt long bug hunts, visual parity, and shipping watchers to the same mechanism.

## 8. Sessions, transcripts, and durable state

- [ ] Add a narrow Pi session-discovery tool or helper.
- [ ] Scope session discovery to the current workspace by default.
- [ ] Exclude the current session and test/noise sessions when requested.
- [ ] Return metadata before loading full transcripts.
- [ ] Expose background job logs as worker evidence.
- [ ] Port Recall to Pi session JSONL and job logs.
- [ ] Port Reflect to the active Pi transcript.
- [ ] Port Session Pickup to Pi sessions, pushed branches, and resume notes.
- [ ] Port Pause Safely to Pi compaction and shutdown behavior.
- [ ] Port Show Me Your Work transcript auditing.
- [ ] Port Eval's transcript-based chain verification.
- [ ] Define a Pi-native durable store for Orchestrate state.

## 9. Cursor builtin replacements

- [ ] Port or implement a Pi-native `create-skill` workflow.
- [ ] Adapt `automate-me` to Pi transcript paths and Pi skill locations.
- [ ] Adapt skill-authoring playbooks to Pi frontmatter and validation.
- [ ] Decide whether ordinary chat is sufficient for `AskQuestion` cases.
- [ ] If needed, add a small structured-question tool for setup and genuine preference gates.
- [ ] Do not port Cursor's built-in Babysit; pstack's playbook supersedes it.
- [ ] Do not port Cursor plan mode; pstack's optional plan reference is sufficient.

## 10. Verification surfaces

- [ ] Port `create-verification-skill` to generate `.pi/skills/verify-<app>/`.
- [ ] Port `maintain-verification-skill` to Pi paths and local workers.
- [ ] Define a reusable CLI/TUI control approach using PTY or Herdr where appropriate.
- [ ] Define a browser or CDP approach only when a project needs UI verification.
- [ ] Support shell and HTTP verification for services.
- [ ] Require launch, doctor, drive, evidence, and cleanup contracts.
- [ ] Preserve evidence after cleanup.
- [ ] Keep one driver for shared application state.

## 11. Optional external evidence

- [ ] Make source-control investigation work with `git` and `gh` by default.
- [ ] Discover optional ticket, document, chat, observability, error-tracking, and analytics tools.
- [ ] Pass only the tools required by an investigator profile.
- [ ] Report unavailable evidence categories as explicit gaps.
- [ ] Do not block core pstack on MCP or external evidence integrations.
- [ ] Never permit an investigator to mutate an external system without approval.

## 12. Git, worktrees, and shipping

- [ ] Rewrite generic worktree instructions to coexist with Herdr-managed worktrees.
- [ ] Never let a pstack cleanup workflow remove an active Herdr worktree directly.
- [ ] Preserve one writer per worktree.
- [ ] Keep `gh`-based PR inspection available.
- [ ] Disable Graphite-specific Shipping and Autopilot steps while `gt` is unavailable.
- [ ] Decide whether to install `gt` or provide plain-GitHub alternatives.
- [ ] Centralize approval for pushes, PR mutations, merges, comments, deployments, and customer communication.
- [ ] Present exact external content for approval before sending it.

## 13. Porting batches

- [ ] Batch 1: principles, Poteto Mode, and core playbooks.
- [ ] Batch 2: `how`, `why`, `recall`, and investigation workflows.
- [ ] Batch 3: `architect`, `arena`, `interrogate`, `swarm`, and `figure-it-out`.
- [ ] Batch 4: Feature, Bug fix, Refactoring, TDD, TypeScript, and cleanup skills.
- [ ] Batch 5: verification generation, maintenance, Babysit, and Autonomous Run.
- [ ] Batch 6: Reflect, Automate Me, Show Me Your Work, Session Pickup, and Pause Safely.
- [ ] Batch 7: optional Orchestrate and non-cloud Autopilot workflows.

## 14. Tests and acceptance

- [ ] Test discovery of all imported skills.
- [ ] Test that hidden skills are absent from the model prompt.
- [ ] Test explicit `/skill:<name>` invocation.
- [ ] Test aliases if aliases are implemented.
- [ ] Test Poteto Mode persistence and disable behavior.
- [ ] Test automatic playbook selection and todo population.
- [ ] Test local worker profile prompts, tools, and skill access.
- [ ] Test read-only enforcement.
- [ ] Test model-role routing and unavailable-model errors.
- [ ] Test parallel fan-out and aggregation with partial worker failure.
- [ ] Test watcher wake, rearm, timeout, and cancellation behavior.
- [ ] Test Pi session discovery without crossing workspace boundaries.
- [ ] Smoke-test Investigation end to end.
- [ ] Smoke-test Feature end to end with delegated implementation and parent review.
- [ ] Smoke-test Bug fix end to end with reproduction and real-surface verification.
- [ ] Smoke-test Arena and Interrogate with both configured model families.
- [ ] Smoke-test Babysit in `check` mode without external mutation.
- [ ] Confirm the full existing Pi test suite remains green.
