# pi config

Personal [pi](https://pi.dev) coding agent config. This repo is symlinked to `~/.pi/agent`.

## Setup

```bash
./setup.sh
npm install
```

That backs up any existing `~/.pi/agent`, preserves credentials/sessions, and links this repo in its place.

## Env

```bash
export FIRECRAWL_API_KEY=...
export EXA_API_KEY=...
```

## Layout

| Path | Purpose |
|------|---------|
| `settings.json` | Global settings |
| `AGENTS.md` | Global agent instructions |
| `extensions/` | Extensions |
| `cloak.json` | Secret-masking rules for `pi_cloak` (committed) |
| `skills/` | Skills |
| `prompts/` | Prompt templates |
| `themes/` | Themes |

### Git interceptor (`git_interceptor.ts`)

Guards agent `bash` commands that mention `git`:

1. Prefixes `GIT_EDITOR=true`, `GIT_SEQUENCE_EDITOR=true`, `GIT_MERGE_AUTOEDIT=no`
   so interactive editors cannot hang the tool call.
2. Blocks `--no-verify` (agent must fix hook failures or ask you).

Reload with `/reload` after adding or changing the extension.

### Context shake (`shake.ts`)

`/shake` masks older tool-result payloads in future ordinary agent turns while
leaving the stored transcript and assistant tool calls intact. It protects an
approximate 4,000-token recent tail and persists selected tool-call IDs as
branch-local deltas, so the filtering survives `/reload`, resume, and `/tree`.

This is intentionally non-destructive. Unlike omp's native command, Pi
extensions cannot rewrite session history or create recoverable artifacts.
Pi's default compaction and branch-summary model calls read the original stored
entries rather than the extension's filtered context, so their summaries may
include excerpts from shaken results. Provider caches and the session JSONL may
also retain the original content. `/shake` is not deletion or a confidentiality
boundary.

### Secret cloaking (`pi_cloak.ts` + `cloak.json`)

On `read` tool results, masks values matching `cloak.json` rules (`.env*`,
`auth.json` tokens, common JSON secret keys, etc.). Does **not** cloak
`bash`/`cat` output. Commands: `/cloak-status`. Edit `cloak.json` then
`/reload` or start a new session.

### Search tools (`find` / `grep` / `ls`)

Pi ships structured search tools backed by `fd`/`rg`, but defaults to only
`read`/`bash`/`edit`/`write`. There is no `settings.json` key for this — use
`--tools` or `setActiveTools`.

`extensions/enable_search_tools.ts` enables `find`, `grep`, and `ls` on every
`session_start` (keeps whatever else is already active). Reload with `/reload`
if a session was already running when the extension was added.

Background: `research/agent-file-search.md`.

### Fast mode (OpenAI + xAI)

`extensions/fast_mode.ts` adds `/fast` for priority service tiers:

- **xAI** (`grok-4.5`, etc.) — `service_tier: "priority"` on Responses/Completions
- **OpenAI** — `service_tier: "priority"` on Responses/Completions
- **OpenAI Codex** — `service_tier: "priority"` on Codex Responses

State is gitignored `fast-mode.json`. Commands: `/fast`, `/fast on|off|status`.
The custom footer shows a nerd-font bolt when fast is on (hidden when off).
Reload with `/reload` if the session was already running when the extension changed.

### Retry failed turns (`retry.ts`)

`extensions/retry.ts` adds `/retry`. After a provider error or an aborted leaf,
it branches before the failed response and retries the original user message
without duplicating it. It refuses to run while the agent is busy or when the
last turn completed normally. State stays in memory; `/reload` reconstructs the
original user message from the session.

### Custom footer (`footer.ts`)

Always-on B1 footer (see `prototypes/footer.html`):

- **Row 1:** cwd · branch · git `+/−` (numstat) · phase anim on the right  
- **Row 2:** context ring · cache (last-turn db icon + session %) · provider · model · thinking · fast  
- **Phases:** idle `●` · think `sand` · tool `line` (includes edits) · stream pulse `●`  
- **Whimsy** on the working line only (spinner upright, message italic)  
- Git refreshes after `edit`/`write` and when the agent hands back to you

`auth.json`, `sessions/`, and other runtime files stay local and are gitignored.

