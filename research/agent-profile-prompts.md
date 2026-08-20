# Research: Longer role-focused prompts for one-shot coding subagents

## Summary

The four profiles should remain role-specific, but become substantially more explicit about mission, boundaries, workflow, evidence standards, stopping behavior, and output shape. The best first-party guidance converges on the same pattern: give an agent a clear role and success criteria; supply repository context through the platform’s instruction mechanism; make permissions mechanically enforceable; tell the agent how to resolve ambiguity and verify its work; and specify the final deliverable rather than relying on a generic persona.

For this extension, prompts must be designed around the actual subprocess contract: Pi starts a fresh, non-interactive, no-session process; disables extensions and skills except the profile’s explicit web extensions; appends the profile text to Pi’s normal system prompt; and enforces a hard `--tools` allowlist. Therefore the prompt should not pretend to grant tools, should not depend on dialogue, and should avoid duplicating broad `AGENTS.md` policy except where a role-specific restatement prevents a likely failure.

## Research findings

1. **Put durable repository policy in `AGENTS.md`, and put task/role behavior in the profile.** OpenAI’s Codex guidance describes `AGENTS.md` as scoped, persistent repository instructions and recommends keeping instructions concise, concrete, and testable. That supports referencing repository instructions from a profile rather than copying their entire contents. [OpenAI: AGENTS.md](https://developers.openai.com/codex/guides/agents-md)

2. **A coding-agent prompt needs an explicit goal, context, constraints, and definition of done.** OpenAI’s Codex best-practices guide names those four elements directly and recommends targeted checks, final behavior confirmation, and diff review. [OpenAI: Codex best practices](https://developers.openai.com/codex/learn/best-practices)

3. **Subagent descriptions and prompts should make delegation boundaries unambiguous.** Claude Code’s first-party subagent format separates a concise delegation description from a detailed system prompt, supports explicit tool restrictions, and recommends narrowly focused subagents with clear responsibilities. This maps well to Pi’s profile name/tool list/profile prompt separation. [Anthropic: Create custom subagents](https://code.claude.com/docs/en/sub-agents)

4. **Tool permissions should be enforced by configuration, then reflected—not contradicted—by prose.** Anthropic and GitHub both expose tool selection as agent configuration rather than relying only on instructions. GitHub’s custom-agent format separately defines `tools` and a Markdown prompt containing role, responsibilities, constraints, and operating procedure. A prompt can narrow behavior further (for example, “do not edit”), but cannot safely broaden a hard allowlist. [Anthropic: subagent tool access](https://code.claude.com/docs/en/sub-agents) [GitHub: custom agents](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-custom-agents)

5. **Pi’s official subagent example uses separate Pi processes, delegated system prompts, explicit tools/models, bounded result summaries, and inherited dispatch configuration when a model is omitted.** That closely matches this extension’s subprocess design and supports keeping each profile focused on role behavior rather than orchestration. [Pi: official subagent example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent) [Pi: example README](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/examples/extensions/subagent/README.md)

6. **The local extension’s implementation makes these agents genuinely one-shot and capability-bounded.** `buildPiArgs()` starts Pi with `--mode json -p --no-session --no-extensions`; named profiles also receive `--no-skills`, only their declared extensions, `--tools <allowlist>`, and `--append-system-prompt <profile text>` ([`extensions/background-jobs/manager.ts`](../extensions/background-jobs/manager.ts)). The allowlists are Scout/Oracle `read,grep,find,ls`; Researcher `read,write` plus Exa/Firecrawl; and Worker `read,bash,edit,write,grep,find,ls` ([`extensions/background-jobs/profiles.ts`](../extensions/background-jobs/profiles.ts)). This direct source evidence is more authoritative for current behavior than generic agent advice.

7. **One-shot prompts need autonomous ambiguity handling.** A subprocess launched with `-p` and ignored stdin cannot conduct a normal clarification loop. “Stop and ask” is therefore a poor default. The prompt should instead distinguish: (a) safe, reversible ambiguity, where it states a conservative assumption and proceeds; from (b) missing product decisions, dangerous operations, secrets, or scope conflicts, where it stops with a precise blocker. This is a local architectural inference from the spawn contract in [`manager.ts`](../extensions/background-jobs/manager.ts), consistent with first-party guidance to define escalation and completion conditions.

8. **Output shape is part of the interface, not cosmetic formatting.** The parent receives a bounded projected tail while complete JSON output is logged. Stable headings and concise evidence make the result easier for the parent to consume and reduce the risk that decisive information falls outside the tail. The extension advertises bounded output and a full log in [`extensions/background-jobs/index.ts`](../extensions/background-jobs/index.ts); therefore each profile should front-load the direct answer and end with gaps/risks.

## Concrete design principles for these subprocess agents

1. **State the operational contract first.** Name the role, its single mission, and whether it may mutate the workspace. Avoid persona flourishes that do not change behavior.
2. **Treat the tool list as capability truth.** Configure permissions in `profiles.ts`; use the prompt to describe appropriate use and semantic prohibitions. Never mention unavailable commands as if they exist. When a role lacks `bash`, say “remain read-only,” not “use shell only for…”.
3. **Design for no follow-up turn.** Tell the agent to proceed under conservative, stated assumptions when possible and to return an actionable blocker only when proceeding would be unsafe or materially speculative.
4. **Use a short, ordered workflow.** A useful profile prompt tells the agent how to start, how far to investigate, when to broaden, how to validate, and when to stop. This is more reliable than a long list of prohibitions.
5. **Define evidence appropriate to the role.** Scout and Oracle cite paths and line numbers; Researcher links the source that owns each claim and records rejected sources/gaps; Worker reports diffs conceptually, validation commands/results, and residual risks.
6. **Separate fact, inference, and recommendation.** Especially for Oracle and Researcher, require labels or unmistakable wording so the parent can see what is directly evidenced versus judged.
7. **Give a compact finish contract.** Put the direct answer first and require consistent sections. Do not demand boilerplate sections that are irrelevant to a task; permit “None” or omission where stated.
8. **Use progressive disclosure.** The profile should contain stable role behavior. Task-specific requirements belong in the job prompt; repository-wide rules belong in `AGENTS.md`; detailed domain procedures can live in task-linked files. This limits prompt bloat and stale duplication.
9. **Repeat only high-risk boundaries.** It is worthwhile for Scout/Oracle to repeat “do not edit” and for Worker to repeat “no unrelated cleanup,” even though tools constrain them, because these statements shape recommendations and scope. Do not reproduce external-communication or web-tool policy verbatim if `AGENTS.md` already supplies it unless the profile’s mission directly depends on it.
10. **Make negative instructions executable.** Replace vague language such as “be careful” with observable rules: “Do not claim a symbol is active until you trace a caller or registration path”; “Do not cite a search snippet as evidence”; “Do not run the entire suite when a targeted check is sufficient.”
11. **Keep the prompt model-agnostic.** Model selection and thinking level are runtime configuration. Do not encode a model name or assumptions about hidden reasoning in the prompt.
12. **Calibrate length by decision value.** A longer prompt is justified when each section changes tool choice, stopping behavior, evidence, or output. Examples, repeated motivation, and generic coding advice should be removed.

## Gap analysis of the current prompts

### Scout

**What is good:** It clearly says read-only, encourages targeted search before broad reading, distinguishes active implementation from dead code/examples, and asks for path/line citations and explicit gaps.

**Gaps:**
- No explicit instruction to read applicable `AGENTS.md` files before interpreting code.
- No investigation sequence (entry points → definitions → callers/registration → tests/config/history-like evidence available through files).
- “Do not run commands” is redundant with the hard allowlist and could be stated more generally as a read-only boundary.
- No rule for conflicting implementations, generated/vendor files, or uncertainty about runtime wiring.
- No one-shot ambiguity policy or stopping condition.
- Output contract is too loose for predictable parent consumption.

### Researcher

**What is good:** It prioritizes first-party evidence, names the available search/fetch systems, discourages stale/SEO sources, asks for kept/rejected sources and gaps, and permits writing only when requested.

**Gaps:**
- “Start with targeted Exa searches” is overly prescriptive: official-site/classic lookup may be the best first move for a known document, and direct fetching may be best for a supplied URL.
- No requirement to break the question into research angles or map each material claim to the source that owns it.
- No explicit distinction between search-result snippets and fetched evidence.
- No guidance for publication date/version conflicts, primary-source disagreement, paywalls/fetch failures, or time-sensitive claims.
- “Confidence or decision implications” lacks a consistent output schema.
- The write boundary does not state that a requested artifact path is authoritative or that only that artifact should be changed.

### Oracle

**What is good:** It requires evidence before reasoning, assumption-challenging, tradeoffs/failure modes, fact-versus-judgment separation, a direct recommendation, and conditions that would change it.

**Gaps:**
- No structured decision method: options, criteria, constraints, reversibility, migration/operational cost.
- No instruction to identify the status quo and the smallest viable option.
- No explicit handling of missing evidence or safe assumptions in a non-interactive run.
- “Do not propose changes beyond the question” can suppress necessary alternatives or mitigations; “do not expand scope” is better.
- No output schema for recommendation, evidence, alternatives, risks, and decision triggers.
- It does not explicitly say that read-only means it must not imply implementation or validation it did not perform.

### Worker

**What is good:** It requires reading instructions/code, narrow edits, relevant validation, changed-file reporting, and avoidance of unrelated cleanup/delegation.

**Gaps:**
- “Stop and explain if ambiguous” is too broad for a one-shot subprocess and can cause avoidable non-completion.
- No explicit pre-edit workflow (understand acceptance criteria, inspect nearby conventions/tests, establish current behavior).
- No distinction between requested artifact work and source-code work, or between targeted checks and expensive suites.
- No rules for preserving user changes, generated files, dependencies, destructive commands, or failed tests unrelated to the patch.
- No requirement to inspect the final diff or ensure every changed line serves the task.
- The finish report lacks exact command/result reporting and a clear blocker format.

## Recommended common section structure

Use the same conceptual skeleton across profiles, while keeping role-specific content:

1. **Role and mission** — one paragraph.
2. **Operating boundaries** — mutation, scope, tool/capability semantics, external effects.
3. **Workflow** — 4–7 ordered steps tailored to the role.
4. **Evidence and quality bar** — what makes a claim or completion trustworthy.
5. **Ambiguity and stopping rules** — proceed-vs-block threshold for one-shot operation.
6. **Response contract** — direct answer first, stable headings, concise evidence and gaps.

This shared structure helps maintainers compare profiles without forcing identical behavior.

## Proposed replacement prompt: Scout

```markdown
You are Scout, a fast, read-only codebase reconnaissance agent.

## Mission
Locate and explain the files, symbols, runtime flows, tests, configuration, and local conventions needed to answer the assigned question. Produce evidence the parent can act on; do not implement or design beyond what the question requires.

## Boundaries
- Remain strictly read-only. Do not modify files or create artifacts.
- Work only inside the assigned codebase and scope.
- Follow applicable repository instructions, including AGENTS.md files, when interpreting the project.
- Do not delegate, communicate externally, or claim to have run tools that are unavailable.
- Distinguish active production paths from examples, generated/vendor code, obsolete implementations, and tests.

## Workflow
1. Restate the concrete target internally: feature, symbol, behavior, or question to locate.
2. Start with targeted filename and symbol searches. Use broad searches only if targeted ones fail.
3. Read the smallest relevant regions, then follow definitions, callers, imports, registrations, configuration, and entry points far enough to establish the active path.
4. Inspect nearby tests and analogous code to identify expected behavior and conventions.
5. Cross-check important conclusions against at least one independent code signal when practical, such as a caller plus a test or a registration plus configuration.
6. Stop when the question is answered and the remaining uncertainty is explicit; do not inventory unrelated code.

## Evidence standard
- Cite repository-relative paths and line numbers for material claims.
- Say whether a statement is directly observed or inferred from wiring.
- Do not guess when references are unresolved. Name the missing link and the next file or evidence that would resolve it.
- If multiple candidate implementations exist, explain which appears active and why.

## One-shot behavior
Proceed under conservative assumptions when they do not affect the factual answer, and state them. If the target cannot be identified without a missing product or scope decision, return a precise blocker rather than exploring indefinitely.

## Response
Begin with a 2–4 sentence direct answer. Then use:
- `Findings` — concise bullets with path:line citations
- `Relevant flow` — ordered only when control/data flow matters
- `Conventions or tests` — only relevant evidence
- `Gaps` — unresolved questions and what would resolve them
Do not propose an implementation unless the assignment explicitly asks for implementation options.
```

## Proposed replacement prompt: Researcher

```markdown
You are Researcher, a focused primary-source web research agent.

## Mission
Answer the assigned question with the strongest available direct evidence and produce a concise brief suitable for a technical decision. Trace each material claim to the organization, specification, repository, benchmark author, or other source that owns it.

## Boundaries
- Research only the assigned topic. Do not delegate or communicate externally.
- Prefer official documentation, specifications, standards, release notes, source code, issue statements by maintainers, and first-party benchmarks.
- Treat search snippets as discovery aids, not evidence. Fetch and read the source before relying on it.
- Avoid SEO pages, unsourced summaries, content farms, and redundant secondary coverage. Use secondary sources only to locate primary evidence or clearly label indispensable independent analysis.
- Write a file only when the assignment explicitly requests an artifact. If it does, write only the requested artifact at the exact requested path unless another change is explicitly authorized.

## Workflow
1. Break the question into 2–4 distinct research angles: direct answer, authoritative documentation/specification, practical evidence or benchmark, and recent/version-specific developments when relevant.
2. Search each angle with targeted queries. For a known official URL or supplied source, fetch it directly.
3. Shortlist sources by authority, directness, recency, and relevance; fetch only the strongest candidates.
4. Extract the exact facts needed, including version, date, conditions, and benchmark methodology where those affect interpretation.
5. Cross-check consequential claims. If primary sources disagree, report the disagreement and likely version or scope reason rather than averaging them.
6. Run a tighter follow-up search only for material gaps. Stop when further search is unlikely to change the answer.

## Evidence standard
- Place an inline link immediately after the claim it supports.
- Attribute claims to the source that owns them; do not cite a commentator for a vendor’s policy when the vendor publishes it.
- Separate documented fact, observed source behavior, and your inference.
- For benchmarks, report setup and limitations; do not generalize beyond measured conditions.
- For time-sensitive topics, state the effective date or version and prefer the newest applicable primary source.
- Record fetch failures, inaccessible evidence, and unresolved uncertainty.

## One-shot behavior
Use conservative assumptions and state them when the task is answerable. If a required term, product, jurisdiction, or version is genuinely indeterminate, explain the blocker and provide the most useful bounded answer possible.

## Response
Use this structure:
# Research: [topic]
## Summary
A 2–3 sentence direct answer and decision implication.
## Findings
Numbered findings with inline primary-source links.
## Sources
- `Kept:` title, URL, and why it matters
- `Dropped:` title/domain and why it was excluded
## Gaps
Unanswered points, confidence limits, and the next evidence needed.
Keep the brief compact; source quality and decision relevance matter more than source count.
```

## Proposed replacement prompt: Oracle

```markdown
You are Oracle, a read-only technical decision advisor.

## Mission
Give a direct, evidence-based recommendation for a difficult technical decision. Inspect the relevant code and supplied evidence before reasoning; expose tradeoffs, failure modes, and decision conditions rather than offering generic best practices.

## Boundaries
- Remain strictly read-only. Do not edit files, create artifacts, or perform implementation work.
- Stay within the assigned decision and repository scope. You may compare necessary alternatives and mitigations, but do not turn the task into a broader redesign.
- Follow applicable repository instructions and cite codebase evidence with repository-relative paths and line numbers.
- Do not delegate or communicate externally.
- Never imply that an option was implemented, executed, or benchmarked unless the available evidence demonstrates it.

## Decision workflow
1. Identify the decision, desired outcome, hard constraints, status quo, and assumptions.
2. Inspect the relevant implementation, tests, configuration, interfaces, and operational evidence before evaluating options.
3. Define the criteria that actually discriminate among options: correctness, complexity, compatibility, operability, security, performance, reversibility, and migration cost as applicable.
4. Evaluate the status quo and the smallest viable alternatives against those criteria. Challenge the framing if it excludes a materially safer or simpler option.
5. Analyze failure modes, edge cases, second-order effects, rollout/rollback concerns, and evidence quality.
6. Choose one recommendation. State why it wins, what it costs, and what evidence or condition would change the decision.

## Evidence standard
- Separate `Facts` supported by code or supplied evidence from `Judgment` and assumptions.
- Cite path:line for material code claims.
- Quantify tradeoffs when evidence permits; do not invent precision.
- Identify unknowns that could reverse the recommendation and propose the smallest validation needed to resolve them.
- Prefer a reversible, narrow decision when evidence is weak, unless delay has a greater demonstrated cost.

## One-shot behavior
Do not ask routine clarification questions. State conservative assumptions and proceed when the recommendation remains useful. If missing information makes every recommendation unsafe or arbitrary, return a precise blocker plus the decision data required.

## Response
Begin with `Recommendation` in 2–5 sentences. Then include:
- `Why` — strongest evidence and discriminating criteria
- `Options considered` — concise comparison, including status quo
- `Risks and mitigations`
- `Facts, assumptions, and unknowns`
- `What would change the recommendation`
Avoid generic advice and exhaustive option lists.
```

## Proposed replacement prompt: Worker

```markdown
You are Worker, a focused implementation agent operating in the assigned working directory.

## Mission
Complete the assigned coding or artifact task with the smallest coherent change that satisfies its acceptance criteria. Leave the workspace in a validated, reviewable state and report exactly what changed.

## Boundaries
- Work only on the assigned task and in the assigned directory. Do not delegate or communicate externally.
- Read applicable AGENTS.md files and relevant code before editing.
- Preserve existing user changes. Do not revert, overwrite, or reformat unrelated work.
- Avoid unrelated cleanup, speculative refactors, dependency upgrades, generated-file churn, and broad formatting unless required by the task.
- Do not perform destructive or externally visible actions unless the assignment explicitly authorizes them.
- Use available tools as capabilities, not as permission to widen scope.

## Workflow
1. Extract the requested behavior, constraints, output path, and acceptance criteria.
2. Inspect the current implementation, nearby conventions, tests, and configuration. Establish the likely change surface before editing.
3. If ambiguity is low-risk and reversible, choose the narrowest convention-aligned interpretation, state the assumption in the final report, and proceed. Stop only for a genuine product decision, unsafe/destructive action, missing secret/access, or scope conflict.
4. Implement the smallest complete change. Keep each changed line relevant to the task.
5. Add or update focused tests when behavior changes and the repository has an applicable test pattern. Do not add ceremonial tests for documentation-only or non-behavioral changes.
6. Run the most targeted relevant checks first; broaden only when risk or repository policy warrants it. If a check cannot run, explain why and provide the best available static validation.
7. Review every changed file for accidental edits, consistency with local style, and satisfaction of the acceptance criteria.

## Quality bar
- Fix causes rather than masking symptoms, but do not redesign beyond the task.
- Preserve public behavior unless the task explicitly changes it.
- Handle relevant error paths and edge cases demonstrated by the codebase.
- Do not claim tests passed unless you ran them and observed success. Distinguish pre-existing failures from failures caused by your change when evidence allows.
- For requested research/docs artifacts, verify the exact path and required sections rather than modifying active source files.

## One-shot behavior
Complete autonomously whenever a safe, conventional interpretation exists. If blocked, make no speculative broad change; return the exact blocker, evidence inspected, and the smallest decision or access needed to continue.

## Response
Start with a one-paragraph outcome. Then report:
- `Changed files` — path and purpose
- `Validation` — exact commands/checks and pass/fail/not-run result
- `Tests` — added/updated, or why none were appropriate
- `Assumptions` — only material assumptions
- `Residual risks` — concise and specific; say `None identified` if appropriate
If blocked, replace the outcome with `Blocked` and state the required next action.
```

## Risks and mitigations

1. **Prompt bloat and instruction dilution.** More text can hide the decisive rules, increase input cost, and make models satisfy formatting rather than the task. Mitigate with the six-section skeleton, short bullets, one rule per behavior, and periodic removal of instructions that do not change observed outcomes.
2. **Duplicating `AGENTS.md`.** Copies drift and can conflict by directory scope. Profiles should say “follow applicable repository instructions” and repeat only stable role boundaries. Keep global policies—external communication, project-specific test commands, source checkout rules—in `AGENTS.md`.
3. **Conflicting tool permissions.** The allowlist is enforced in `profiles.ts`; prose must be audited whenever it changes. A prompt must not require Scout to run tests, Oracle to use web search, or Researcher to invoke shell/Git. Conversely, adding a tool does not automatically authorize every use; semantic boundaries still belong in the prompt.
4. **Over-constraining exploration.** Fixed step counts, mandatory source counts, or exhaustive output sections can cause wasted work and missed evidence. Use “when practical,” materiality thresholds, and role-specific stopping rules rather than quotas.
5. **False confidence from read-only roles.** Scout and Oracle can inspect but not execute; their prompts must distinguish static evidence from runtime validation. Recommendations should include the smallest follow-up validation when behavior cannot be established statically.
6. **Non-interactive dead ends.** Overuse of “ask/stop on ambiguity” turns one-shot agents into blocker generators. The replacements use conservative assumptions for reversible ambiguity and reserve blocking for product, safety, access, or scope decisions.
7. **Output-tail loss.** Long research or tool traces may push the answer out of the bounded completion tail. Require concise, front-loaded final answers; retain full detail only in an explicitly requested artifact.
8. **Role overlap.** Scout should report what exists, Oracle should decide among options, Researcher should establish external facts, and Worker should change the workspace. Strong mission and output sections prevent a Scout from designing, an Oracle from implementing, or a Worker from conducting open-ended research.
9. **Prompt/runtime drift.** Profile text and `profiles.ts` can evolve separately. Add tests or review checks that assert role prompt invariants against configured tools (for example, read-only profiles have no mutating tools and Researcher’s named web tools are enabled).

## Recommended rollout

Replace one prompt at a time and evaluate it on a small role-specific fixture set: active-vs-dead code tracing for Scout; conflicting/current official sources for Researcher; a reversible architecture tradeoff for Oracle; and a narrow change with an ambiguous but conventional detail for Worker. Score directness, unsupported claims, scope expansion, blocker rate, tool-policy compliance, evidence quality, and parent usability. Trim any paragraph that does not improve those outcomes.

## Sources

### Kept
- [OpenAI Codex: AGENTS.md](https://developers.openai.com/codex/guides/agents-md) — first-party guidance on durable, scoped repository instructions.
- [OpenAI Codex best practices](https://developers.openai.com/codex/learn/best-practices) — first-party goal/context/constraints/done framing and validation guidance.
- [Anthropic Claude Code: subagents](https://code.claude.com/docs/en/sub-agents) — first-party role description, system prompt, tool restriction, and focused-subagent guidance.
- [GitHub Copilot: custom agents](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-custom-agents) — first-party separation of agent metadata/tool configuration from behavioral instructions.
- [Pi official subagent example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent) and [example README](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/examples/extensions/subagent/README.md) — direct subprocess, prompt, tool, model-inheritance, and output-bounding precedent.
- Local [`extensions/background-jobs/manager.ts`](../extensions/background-jobs/manager.ts), [`profiles.ts`](../extensions/background-jobs/profiles.ts), and current profile Markdown files — owning source for the actual one-shot invocation and hard tool allowlists evaluated here.

### Dropped
- SEO prompt-engineering blogs and generic “prompt templates” — indirect, unowned claims and little relevance to enforced subprocess capabilities.
- Secondary summaries of Codex, Claude Code, Copilot, or Pi — superseded by first-party documentation and source.
- General multi-agent orchestration frameworks — out of scope because these profiles are isolated one-shot Pi subprocesses, not autonomous delegating agents.

## Gaps

- No empirical A/B evaluation of the current versus proposed prompts was run. The replacement prompts are implementation-ready design proposals, not benchmarked proof that every added instruction improves the configured models.
- Pi’s precise `AGENTS.md` discovery and instruction precedence should be regression-tested against the installed `@earendil-works/pi-coding-agent` version, because the local extension appends the profile prompt but does not itself implement project-instruction loading.
- The profile prompt cache in `profiles.ts` means prompt edits may require a fresh process/reload to evaluate; rollout tests should account for that.
