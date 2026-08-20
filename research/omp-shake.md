# Research: upstream omp.sh `/shake`

Research date: 2026-08-20  
Upstream examined: [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi) at commit [`72000acfeb902e21816252699482887f34d1a5a4`](https://github.com/can1357/oh-my-pi/tree/72000acfeb902e21816252699482887f34d1a5a4) (the official repository behind omp.sh).

## Summary

`/shake` is a **persistent, artifact-backed context rewrite**, not a command that simply deletes old messages. Its default `elide` mode replaces selected old tool-result payloads and large delimited text regions while deliberately retaining assistant `toolCall` blocks; `images` instead persistently strips image data and is not recoverable. Pi’s `context` hook can emulate the model-facing shape non-destructively for ordinary agent-turn calls, but not `/shake`’s in-place session rewrite, artifact recovery, runtime resets, compaction, or branch summarization through that hook alone.

## Findings

1. **Commands and parsing (informational).** The registered command is described as “Drop heavy content from context (tool results, large blocks).” Its syntax is `/shake [elide|images]`. Parsing is exactly `args.trim().toLowerCase()`: empty input and `elide` select elision, `images` selects image removal, and every other value—including a multiword value—returns `Unknown /shake mode "…". Use elide or images.` Thus case and surrounding whitespace are ignored, but there are no flags, numeric knobs, or additional modes. [Command implementation](https://raw.githubusercontent.com/can1357/oh-my-pi/72000acfeb902e21816252699482887f34d1a5a4/packages/coding-agent/src/slash-commands/builtin-lifecycle.ts)

2. **Default `elide` policy (informational).** Manual shake uses the fixed `AGGRESSIVE_SHAKE_CONFIG`: `protectTokens: 4_000`, `minSavings: 0`, `protectedTools: ["skill", isSkillReadToolResult]`, and `fenceMinTokens: 400`. Candidate collection walks the persisted current branch and normally protects the newest ~4,000 tokens. Already-pruned regions and protected skill results are skipped. A non-error tool result marked “useless” can bypass the recent-tail protection. [Collector/config source](https://raw.githubusercontent.com/can1357/oh-my-pi/72000acfeb902e21816252699482887f34d1a5a4/packages/agent/src/compaction/shake.ts) · [Compaction docs](https://raw.githubusercontent.com/can1357/oh-my-pi/72000acfeb902e21816252699482887f34d1a5a4/docs/compaction.md)

3. **Precisely what text is removed (informational).** For an eligible `toolResult`, shake targets and replaces the result’s **entire content payload**; it does not delete the message envelope. Separately, in text content belonging to user, developer, assistant, or custom messages, it can replace a completed fenced-code span or lowercase top-level XML span estimated at least 400 tokens. Unterminated delimiters are not candidates. This means `/shake` is broader than “strip tool results”: it can elide large, delimited prose/code regions too, while leaving ordinary text alone. [Exact region collector](https://raw.githubusercontent.com/can1357/oh-my-pi/72000acfeb902e21816252699482887f34d1a5a4/packages/agent/src/compaction/shake.ts)

4. **Tool-call/result pairing is intentionally preserved (important compatibility property).** Assistant `toolCall` blocks are **never shake targets**. Only the paired `toolResult` content may become an elision placeholder, so the assistant call and result-message identity remain in context and provider pairing constraints remain valid. Upstream tests explicitly assert both that recent results are retained under tail protection and that assistant tool calls are never targeted. [Tests](https://raw.githubusercontent.com/can1357/oh-my-pi/72000acfeb902e21816252699482887f34d1a5a4/packages/agent/test/shake.test.ts) · [Implementation](https://raw.githubusercontent.com/can1357/oh-my-pi/72000acfeb902e21816252699482887f34d1a5a4/packages/agent/src/compaction/shake.ts)

5. **Elision is persisted and recoverable (informational).** Before rewriting, the session layer stores all selected originals in one session artifact. Each region is replaced with `[shaken ~N tokens — recover: artifact://ID (region K)]`. It then rewrites persisted entries, rebuilds agent context, resets provider/advisor state, and closes provider sessions. The operation therefore changes resumed/future context, not just the next request, while retaining an explicit recovery route. [Session integration](https://raw.githubusercontent.com/can1357/oh-my-pi/72000acfeb902e21816252699482887f34d1a5a4/packages/coding-agent/src/session/session-maintenance.ts)

6. **`images` mode has different, destructive semantics (informational).** It walks every entry on the current branch. It removes image blocks from user/developer/custom/hook-message array content; from `toolResult.content` and image-like `{type:"image"}` records in `details.images`; from separate `custom_message` entry arrays; and clears each `fileMention.file.image`. If removal would produce a zero-block user/tool message, it inserts `[image removed]` because providers reject empty block arrays. This rewrite is persisted, rebuilds agent messages, resets advisor runtimes, and closes provider sessions, but unlike `elide` it creates no artifact and is not recoverable. [Maintenance flow](https://raw.githubusercontent.com/can1357/oh-my-pi/72000acfeb902e21816252699482887f34d1a5a4/packages/coding-agent/src/session/session-maintenance.ts) · [Image rewriting helpers](https://raw.githubusercontent.com/can1357/oh-my-pi/72000acfeb902e21816252699482887f34d1a5a4/packages/coding-agent/src/session/messages.ts)

7. **High-level comparison with Pi’s `context` hook (important implementation constraint).** Pi fires `context` before ordinary agent-turn LLM calls and gives handlers a deep copy of `event.messages`, safe to filter or rewrite by returning `{messages}`. That is sufficient to preserve assistant tool calls while transiently replacing paired results or large spans for those turns. It is explicitly non-destructive, however: `ctx.sessionManager` is read-only, so the hook itself cannot rewrite persisted branch entries, create omp-style `artifact://` objects, synchronize stored token accounting, or perform omp’s provider/advisor lifecycle resets. Default compaction and branch-summary generation prepare their own inputs from stored entries and do not expose a supported hook return for transformed inputs, so they may include excerpts from results masked in ordinary turns. A faithful Pi feature therefore needs custom summarization machinery beyond a `context` handler; a hook-only version is an approximation whose original session remains unchanged. [Pi extension docs: `context` and read-only `sessionManager`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md) · [Pi session/message format](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/session-format.md)

## Edge-case checklist

- `/shake`, `/shake elide`, and case/whitespace variants select elision; unsupported arguments fail rather than silently falling back.
- The newest ~4,000 tokens are normally protected; “useless,” non-error tool results are the stated exception.
- Skill tool results and skill-read results are protected.
- Already-pruned material is not shaken again.
- Only completed fenced code/lowercase top-level XML spans meeting the 400-token floor qualify; unterminated spans do not.
- Assistant tool calls remain; result content is substituted, not the entire paired message removed.
- Empty content after image stripping gets `[image removed]` where required for provider validity.
- Elided text/results are artifact-recoverable; stripped images are not.

## Sources

### Kept (primary only)

- [Official oh-my-pi repository, pinned commit](https://github.com/can1357/oh-my-pi/tree/72000acfeb902e21816252699482887f34d1a5a4) — upstream identity and immutable revision.
- [`packages/agent/src/compaction/shake.ts`](https://raw.githubusercontent.com/can1357/oh-my-pi/72000acfeb902e21816252699482887f34d1a5a4/packages/agent/src/compaction/shake.ts) — candidate selection, protection, delimiters, and config.
- [`packages/agent/test/shake.test.ts`](https://raw.githubusercontent.com/can1357/oh-my-pi/72000acfeb902e21816252699482887f34d1a5a4/packages/agent/test/shake.test.ts) — direct executable evidence for tail retention and tool-call preservation.
- [`packages/coding-agent/src/session/session-maintenance.ts`](https://raw.githubusercontent.com/can1357/oh-my-pi/72000acfeb902e21816252699482887f34d1a5a4/packages/coding-agent/src/session/session-maintenance.ts) — artifacts, persistence, context rebuild, and image-mode orchestration.
- [`packages/coding-agent/src/session/messages.ts`](https://raw.githubusercontent.com/can1357/oh-my-pi/72000acfeb902e21816252699482887f34d1a5a4/packages/coding-agent/src/session/messages.ts) — exact image locations and empty-content fallback.
- [`packages/coding-agent/src/slash-commands/builtin-lifecycle.ts`](https://raw.githubusercontent.com/can1357/oh-my-pi/72000acfeb902e21816252699482887f34d1a5a4/packages/coding-agent/src/slash-commands/builtin-lifecycle.ts) — command registration and exact argument parser.
- [`docs/compaction.md`](https://raw.githubusercontent.com/can1357/oh-my-pi/72000acfeb902e21816252699482887f34d1a5a4/docs/compaction.md) — upstream documentation.
- [Pi official extension docs](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md) and [session format](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/session-format.md) — official hook and message/session contracts (also verified locally in Pi 0.84.2).

### Dropped

- Search snippets, third-party articles, package indexes, and social posts — excluded because the task requires primary sources and the implementation/tests are definitive.

## Gaps

No material semantic gap was found for the requested comparison. The findings are pinned to commit `72000ac`; later upstream commits may change thresholds, candidate eligibility, or command modes. No upstream commands or tests were executed locally; conclusions come from the pinned official implementation, tests, and docs.
