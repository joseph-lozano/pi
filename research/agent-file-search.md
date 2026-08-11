# How coding agents handle file search (vs bash)

Research date: 2026-08-11  
Question: How do other coding agents solve the problems that dedicated `fd`/`rg` (or Glob/Grep) tools address — and what should *this* pi setup do?

## Problems under study

When an agent searches a codebase only through a freeform shell tool, these failure modes show up repeatedly:

1. **Wrong binary / bad defaults** — `grep -r` / `find` instead of gitignore-aware `rg`/`fd`
2. **Context blowups** — unbounded output floods the window
3. **Silent truncation** — model thinks a file “isn’t there”
4. **No result ranking** — filesystem walk order instead of “recent files first”
5. **Bash addiction** — model ignores structured search tools even when they exist
6. **Latency at monorepo scale** — even good `rg` becomes multi-second

This note maps how major harnesses handle those problems, then compares to **current pi** and the **davis7dotsh/my-pi-setup `file-search` extension**.

---

## Executive summary

| Approach | Who | Verdict for us |
|----------|-----|----------------|
| Dedicated Glob + Grep tools (structured, capped, gitignore-aware) | Claude Code, OpenCode, Gemini CLI, Cursor, Continue | **Industry default** for multi-model harnesses |
| Shell-only + prompt nudge to use `rg` | Codex CLI (current main), OpenHands | Works when the *model is RL’d* for that shell; weaker for cross-model |
| Shell-only by default; optional structured find/grep | **pi (current)** | We already have the tools; they’re just **off by default** |
| Re-wrap fd/rg as extension tools | davis `file-search` | Largely **duplicates pi builtins**; skip as a vendor |
| Indexed / Instant Grep | Cursor (editor + monorepo path) | Overkill for personal pi; interesting later for huge repos |
| Explore subagent for broad search | Cursor, Claude Code Agent tool | Orthogonal: manage context, not search quality |
| Auto-enrich small result sets | Gemini CLI | High-leverage UX idea if we ever tune grep |

**Bottom line for this repo:** don’t vendor davis `file-search`. Either **enable pi’s built-in `find` + `grep`** (and maybe `ls`), or stay on bash and accept the industry “shell-first” tradeoff. The interesting steals are **prompt/steering**, **mtime sort**, **output modes**, and **auto-context on tiny hit sets** — not another binary wrapper.

---

## Design space (what every implementation chooses)

From primary implementations and cross-agent source surveys ([wasnotwas](https://wasnotwas.com/writing/grep-across-agents/), [glob survey](https://raw.githubusercontent.com/avifenesh/tools/main/agent-knowledge/glob-impl-and-prompts-in-major-tools.md)):

1. **Separate name-search vs content-search?** (Glob/find vs Grep)
2. **Default return shape:** paths only vs match lines vs counts
3. **Caps:** match count, byte budget, line length, timeout, kill-on-limit
4. **Sort:** mtime newest-first vs walk order
5. **Ignore policy:** gitignore, tool-specific ignore, hidden files
6. **Binary provisioning:** system PATH vs bundled vs download-on-demand
7. **Steering:** tool description gravity vs shell-only prompt vs hooks that block bash grep
8. **Follow-up reduction:** auto context enrichment, files_with_matches → read two-phase
9. **Scale path:** plain rg vs local regex index (Cursor Instant Grep)

---

## Agent-by-agent

### Claude Code — structured Glob + Grep (default tools)

**Source:** [Tools reference](https://code.claude.com/docs/en/tools-reference)

- **`Glob`**: name patterns with `**`; results **sorted by mtime**; **capped at 100** with truncation flag. Docs note Glob does **not** respect `.gitignore` by default (env `CLAUDE_CODE_GLOB_NO_IGNORE=false` to change) — opposite of Grep.
- **`Grep`**: ripgrep-backed; modes `files_with_matches` (**default**), `content`, `count`; gitignore-aware; `glob` / `type` / multiline / pagination (`head_limit`, `offset`).
- **`Bash`**: still present; long output → file path + preview rather than dumping everything; backgrounding for long commands.
- Also has **`LSP`** for definition/references when a language server plugin is installed — structured search complement, not a grep replacement.
- **`Agent` / Explore-style fan-out**: docs explicitly push open-ended multi-round glob+grep into a subagent so the parent context stays clean.

**How it handles the problems:** structured tools + caps + two-phase default (files first) + subagent for wide exploration. Community still reports “bash addiction” (models calling `grep -r` anyway); some users add hooks to force builtins.

### Codex CLI — shell-first with `rg` prompt

**Source:** `codex-rs/core/gpt_5_codex_prompt.md` in [openai/codex](https://github.com/openai/codex)

> When searching for text or files, prefer using `rg` or `rg --files` respectively because `rg` is much faster than alternatives like `grep`.

- Current `main` tool handlers center on **shell / unified_exec**, not a dedicated `grep_files` handler (older writeups described a filenames-only `rg --files-with-matches` tool; that path is not present in the tree checked for this note).
- Philosophy: trust a model **trained** to use `rg` well inside a sandboxed shell.

**How it handles the problems:** training + prompt, not tool schema. Weak if the model isn’t Codex-shaped (falls back to `find`/`grep -r`). No guaranteed mtime sort or result cap unless the model pipes `head`.

### OpenCode — Glob + Grep tools, thin wrappers

**Source:** [glob.ts](https://raw.githubusercontent.com/sst/opencode/dev/packages/opencode/src/tool/glob.ts), [grep.ts](https://raw.githubusercontent.com/sst/opencode/dev/packages/opencode/src/tool/grep.ts)

- **`glob`**: ripgrep files backend; **limit 100**; explicit truncation marker; optional path with anti-`"undefined"` description text.
- **`grep`**: content matches; **limit 100**; grouped by file; “more matches available” marker.
- Permission ask on each call.

**How it handles the problems:** classic structured split + hard caps + clear truncation. Minimal feature set (no auto-enrich, limited params).

### Gemini CLI — richest Grep wrapper + auto-enrichment

**Source:** [google-gemini/gemini-cli `ripGrep.ts`](https://raw.githubusercontent.com/google-gemini/gemini-cli/main/packages/core/src/tools/ripGrep.ts)

- Broad parameter surface: context/before/after, case, fixed_strings, ignore toggles, max per file / total max, names_only, etc.
- **`enrichWithRipgrepAutoContext`**: if **1–3 matches** and caller didn’t request context, automatically re-search with **50 lines** (1 hit) or **15 lines** (2–3 hits) of context. Intent: cut follow-up read turns.
- Binary fallback chain historically includes download / system grep / JS (per secondary surveys); primary path is rg JSON streaming.

**How it handles the problems:** caps + configurability + **smarter small-result UX**. Best “reduce turn count” idea in the set.

### Cursor — Grep tool + Instant Grep index + Explore subagent

**Sources:** [Search docs](https://cursor.com/docs/agent/tools/search), [Fast regex search blog](https://cursor.com/blog/fast-regex-search)

- Agent still thinks in **grep/regex** terms; harness may back it with **Instant Grep** (local n-gram style index) when plain `rg` is too slow on monorepos (blog cites multi-second `rg` on large trees).
- **Explore subagent**: parallel searches in a child context; returns summary so parent isn’t filled with raw hits.
- CLI path (per wasnotwas source dig): content-default modes, bundled rg, multi-layer limits (timeout, hard line kill, client budget), `.cursorignore`.

**How it handles the problems:** structured tool + **scale index** + **context isolation**. Indexing is the only approach that truly fixes monorepo latency; everything else is wrapper hygiene.

### OpenHands — no structured grep (shell-first)

**Source:** secondary survey of CodeAct tool set ([wasnotwas](https://wasnotwas.com/writing/grep-across-agents/)); earlier structured search deprecated.

- Model runs `rg`/`grep` via bash; keep structured tools for edits.

**How it handles the problems:** mostly doesn’t, beyond model skill. Coherent if you fully trust shell + sandbox.

### Aider — not an agentic grep loop

Repo-map (tree-sitter) + explicit `/add` rather than open-ended tool search. Different product shape; not a peer for this decision.

### Roo / Cline — combined search_files

Single tool with regex + optional `file_pattern` (glob filter). Uses VS Code’s rg where available. Weaker separation of name vs content search (models confuse the two params).

### davis7dotsh/my-pi-setup `file-search`

**Source:** local clone of [davis7dotsh/my-pi-setup](https://github.com/davis7dotsh/my-pi-setup) `extensions/file-search/`

- Registers tools named **`fd`** and **`rg`**
- Structured args, `--` safety, gitignore defaults, 60s timeout, 1000 fd / 100 rg-per-file style limits, 2000 lines / 50KB truncation with spill file
- Binary resolve: system → local bin → download
- Prompt guidelines: prefer these over bash find/grep

This is a solid **2010s–2024 harness pattern** — and it is almost exactly what **pi core already implements**.

---

## What pi already does (critical local finding)

**Installed package:** `@earendil-works/pi-coding-agent` (this machine’s copy under mise node 24).

### Built-in tools exist

From `dist/core/tools/`:

| Tool | Backend | Defaults / limits |
|------|---------|-------------------|
| `find` | `fd` via `ensureTool("fd")` | glob patterns, gitignore-aware, default limit **1000**, 50KB head truncate, hidden on |
| `grep` | `rg --json` via `ensureTool("rg")` | default **100** matches, optional context/glob/literal/ignoreCase, 50KB + **500-char** line cap, kill rg when match limit hit |
| `ls` | (read-only listing) | part of read-only set |
| `bash` | shell | truncates to **last** 2000 lines / 50KB (tail — good for errors); full output spill path |

Binary bootstrap lives in `dist/utils/tools-manager.js` (download fd/rg from GitHub releases into agent `bin/` if missing) — same job davis’s extension does.

### Default active set does *not* include them

From `dist/core/sdk.js` and docs/quickstart.md:

> By default, pi gives the model four tools: `read`, `write`, `edit`, `bash`.  
> Additional built-in read-only tools (`grep`, `find`, `ls`) are available through tool options.

`defaultActiveToolNames = ["read", "bash", "edit", "write"]`.

`createAllToolDefinitions` still registers find/grep/ls into the registry; they just aren’t active unless enabled via `--tools` / session tool selection / API `tools` option.

### System prompt steering

From `dist/core/system-prompt.js`:

- If bash is on **and** grep/find/ls are **off**: guideline  
  `Use bash for file operations like ls, rg, find`
- Tool snippets only appear for **active** tools with snippets  
  (`find`: “Find files by glob pattern (respects .gitignore)”;  
   `grep`: “Search file contents for patterns (respects .gitignore)”).

So pi’s *current default* is intentionally **Codex-like shell-first**, while still shipping **Claude-like structured tools** for opt-in.

### Asymmetric truncation (good design)

`truncate.js`: head truncation for file/search-style output; bash keeps the **tail**. davis’s extension reuses the same pi helpers.

---

## Comparison matrix (problems × approaches)

| Problem | bash only | Claude Glob/Grep | Codex shell+rg prompt | Gemini Grep | Cursor + Instant Grep | pi builtins (if enabled) | davis file-search |
|---------|-----------|------------------|----------------------|-------------|----------------------|--------------------------|-------------------|
| Bad defaults / gitignore | model-dependent | strong (Grep) | prompt only | strong | strong | strong | strong |
| Context blowup | bash caps only | hard caps | model must pipe | hard caps | multi-layer caps | hard caps | hard caps |
| Silent truncation | mediocre | explicit flags | weak | explicit | explicit | explicit notices | spill path notice |
| Recent-file bias | rare | Glob mtime sort | rare | Glob mtime | often mtime sort | **no mtime sort** in find/grep | **no mtime sort** |
| Bash addiction | N/A | still happens | intended | still happens | still happens | if both on, competition | if both on, competition |
| Monorepo latency | bad | rg-bound | rg-bound | rg-bound | **index** | rg-bound | rg-bound |
| Cross-model portability | weak | strong | weak | strong | strong | strong when enabled | strong |
| Implementation cost for us | 0 | N/A | 0 | N/A | high | **settings/flags** | medium (duplicate) |

---

## Patterns worth stealing (ranked)

### 1. Enable structured search tools (or accept shell-first deliberately)

Industry split:

- **Multi-model / open harnesses** → dedicated Glob+Grep (Claude, OpenCode, Gemini, Cursor, Continue)
- **Single RL’d model** → shell + `rg` nudge (Codex)
- **pi** → can do either; default is shell-first

For Grok / multi-provider use, **enabling `find`+`grep`** matches the multi-model consensus better than hoping bash+rg is used well.

### 2. Explicit truncation + “narrow your pattern” copy

Convergent: cap ~100 paths / ~100 matches, say so out loud. Silent truncation is worse than empty.

pi and davis already do this. Keep it.

### 3. mtime newest-first on name search

Claude / OpenCode / Gemini Glob all sort by modification time.  
pi `find` and davis `fd` currently do **not** (fd order / max-results).  
**Cheap quality win** if we ever customize find output.

### 4. Default `files_with_matches` vs content

Claude defaults to paths-only (two-phase: search → read).  
Cursor CLI defaults to content (one-shot inspection).  

Tradeoff:

- paths-only → less context, more turns  
- content → more context, fewer turns, easier blowups  

Gemini’s auto-enrich is a hybrid: start lean, widen only when hits are few.

### 5. Auto-enrich on 1–3 hits (Gemini)

Highest-leverage *behavioral* idea not in pi today.  
When `grep` returns a handful of matches with `context=0`, automatically attach 15–50 lines so the model doesn’t burn a turn on `read`.

### 6. Prompt gravity + optional bash guardrails

Tool descriptions that say “use this instead of bash find/grep” matter.  
Some Claude users add **hooks** that deny `Bash(grep*)` / `Bash(find*)`. That’s a nuclear option; only if bash addiction is measured and painful.

### 7. Explore / subagent for wide search (not a better grep)

Cursor docs and Claude’s Agent tool treat **broad search** as a **context management** problem: fan out in a child, return a digest.  
That’s closer to “steal subagents” than “steal file-search”.

### 8. Instant Grep / local index — only if monorepos hurt

Cursor’s blog is clear: plain rg is fine until repos are huge; then index.  
Not the first problem for a personal agent config.

### 9. LSP as complement

Claude’s LSP tool (go-to-def, references) fixes “grep for a symbol name and pray” for typed languages. Separate track; plugin-heavy.

---

## Implications for *this* pi setup

### Do not vendor davis `file-search`

Reasons:

1. pi already implements `find`/`grep` with fd/rg, ensureTool download, gitignore, caps, truncation, spill files.
2. Adding extension `fd`/`rg` tools **duplicates** builtins and risks **two competing search tools** plus bash.
3. davis adds Effect/download machinery we don’t need on top of `tools-manager.js`.

davis’s extension is best read as: “what pi’s optional tools look like when forced always-on and renamed.”

### Prefer one of these paths

**Path A — Enable builtins (recommended first experiment)**  
Turn on `find`, `grep`, and optionally `ls` via pi’s tool selection (`--tools` / settings if exposed / small session default we configure).  
Confirm system prompt lists their snippets and stops saying “use bash for rg/find” only.

Expected gains vs current bash-default:

- structured args, consistent gitignore, match caps, kill-on-limit  
- less `grep -r` / `find . -name` thrash with non-Codex models  

**Path B — Stay shell-first**  
Rely on bash truncation + model skill + AGENTS.md line: “prefer `rg` / `fd` via bash.”  
Matches Codex; fine if Grok already behaves.

**Path C — Thin enhancements on top of builtins (later)**  
Only if Path A still hurts:

- mtime sort on `find` results (extension wrapping or upstream PR)
- Gemini-style auto-context for tiny `grep` result sets
- AGENTS.md / promptGuidelines: prefer find/grep over bash for search
- optional hook denying bash `find`/`grep`/`rg` if addiction persists
- subagents for wide exploration (separate feature)

### What *not* to optimize first

- Bundling another fd/rg downloader  
- Full Instant Grep index  
- Replacing bash  

---

## Open questions / verification gaps

1. **Exact settings key** to persist default tools as `read,bash,edit,write,find,grep,ls` in `settings.json` — quickstart says “tool options”; CLI has `--tools`. Confirm whether user settings support a permanent default without a flag each launch.
2. **Whether Grok-class models** bash-addict when both bash and grep are present (Claude community says yes sometimes).
3. **Codex `grep_files` tool** — documented in March 2026 secondary sources; **not** in current `openai/codex` handlers tree checked for this note. Treat filenames-only Codex tool as historical unless re-verified on a release tag.
4. **Claude native builds** — Reddit claims some builds shim Glob/Grep into Bash; official docs still list Glob/Grep as first-class tools. Trust docs + observed tool list in a live session if this matters.

---

## Sources

### Primary / first-party

- Claude Code tools reference: https://code.claude.com/docs/en/tools-reference  
- Cursor search docs: https://cursor.com/docs/agent/tools/search  
- Cursor Instant Grep engineering: https://cursor.com/blog/fast-regex-search  
- OpenCode glob tool source: https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/glob.ts  
- OpenCode grep tool source: https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/grep.ts  
- Gemini CLI ripGrep tool source: https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/tools/ripGrep.ts  
- Codex prompt (`gpt_5_codex_prompt.md`): https://github.com/openai/codex (local sparse clone, 2026-08-11)  
- pi coding agent (installed): `@earendil-works/pi-coding-agent`  
  - `docs/quickstart.md` (default four tools; optional grep/find/ls)  
  - `dist/core/tools/{find,grep,bash,truncate,index}.js`  
  - `dist/utils/tools-manager.js`  
  - `dist/core/sdk.js`, `dist/core/system-prompt.js`  
- davis setup: https://github.com/davis7dotsh/my-pi-setup `extensions/file-search/`

### High-quality secondary (used for cross-check, not sole authority)

- wasnotwas, “How coding agents search code”: https://wasnotwas.com/writing/grep-across-agents/  
- avifenesh tools knowledge, glob survey: https://raw.githubusercontent.com/avifenesh/tools/main/agent-knowledge/glob-impl-and-prompts-in-major-tools.md  

---

## Recommendation (one paragraph)

The field converged on **structured, capped, gitignore-aware name search + content search**, with optional **mtime ranking**, **explicit truncation**, and (for scale) **indexes** or **explore subagents**. Shell-only remains viable when the model is trained for it. **pi already implements the convergent structured tools**; our gap is almost certainly **activation and steering**, not missing an extension. Skip vendoring davis `file-search`. Next concrete step: enable built-in `find`/`grep` (and measure whether bash search drops), then consider mtime sort and Gemini-style auto-context only if still needed.
