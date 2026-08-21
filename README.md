# pi config

Personal [pi](https://pi.dev) coding agent config. This repo is symlinked to `~/.pi/agent`.

## Setup

```bash
./setup.sh
npm install
```

The setup script installs Pi if needed, backs up any existing `~/.pi/agent`, preserves credentials/sessions, and links this repo in its place.

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

Automatic threshold and overflow compaction run the same shake operation and
cancel native compaction. After a recoverable overflow, Pi retries the failed
turn against the shaken context. If no older tool results are eligible, Pi
warns that more room may require a manual `/compact` instead of retrying the
same oversized context. The built-in `/compact [instructions]` command remains
available and is never intercepted.

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

### Session checklist (`todo/`)

The `todo` tool keeps a minimal branch-local checklist with `pending`, `active`,
`done`, and `skipped` states. Updates are persisted as custom session entries,
restored on reload, resume, or tree navigation, and injected into each agent
turn so workflow steps remain visible after compaction. A persistent widget
above the editor shows progress and the current checklist; clearing the list
hides it. Items receive collision-checked `todo_<time>_<sequence>` IDs for agent
tool operations, but the human widget does not show them. `text` is the full
agent-visible instruction and may contain up to 2,000 characters. The widget
uses an optional human-facing `displayName`, limited to 80 characters; new items
with text longer than 80 characters must provide one. `set` accepts object seeds
(`{ text, displayName?, children? }`) to create a parent and children atomically;
long child text uses `{ text, displayName }`. `add` can attach a one-level
subtask to an existing top-level `parentId`. `update`, `rename`, and `remove` address items by ID; removing a
parent also removes its subtasks. A parent cannot be marked done or skipped
until every subtask is closed. `move` places an item before or after another ID
and adopts the anchor's level; top-level items carry their subtasks as a block.
Lists are limited to 50 items, full text to 2,000 characters, display names to
80, and notes to 160. Actions are
`get`, `set`, `add`, `update`, `rename`, `move`, `remove`, and `clear`; tool
calls use a compact one-line renderer. Large lists show a terminal-width-
bounded widget window around the active or first pending item.

### Pstack (`pstack/` + `skills/`)

The vendored pstack skills are pinned and attributed under `vendor/pstack/`.
`/poteto-mode [task]` enables the branch-persisted mode; `/poteto-off`
disables it. Active mode injects the Poteto router, requires verbatim playbook
todos, and appears as `🥔 poteto` in the existing footer. Other workflows use
Pi's native `/skill:<name>` command, for example `/skill:how`.

Pstack delegates through the managed `job` tool. Pi workers support `general`,
`writer`, `poteto`, `reviewer`, `comment-sicko`, and `investigator` profiles.
Reviewer and investigator profiles omit `bash`, `edit`, and `write`. Static
model roles live in `extensions/pstack/models.ts`; `job.role` and optional
`panelIndex` route work across the configured Sol and Grok models.

`pstack_sessions` lists or reads bounded tails from sessions and worker logs in
the current workspace only. Historical content is labeled untrusted. PR checks
use managed `gh pr checks --watch` shell jobs. Benny, cloud agents, Graphite
shipping, nested Orchestrate, and the upstream Commander-based CLIs are not
included. Every external mutation still requires explicit approval of the
exact action or content.

### One-off asides (`btw/`)

`/btw <question>` asks the active model a one-off question using the current
conversation context. The answer appears in a cancellable, scrollable overlay
and is not appended to the session, so it does not continue or alter the main
conversation.

### Custom footer (`footer.ts`)

Always-on B1 footer (see `prototypes/footer.html`):

- **Row 1:** cwd · branch · git `+/−` (numstat) · background-job emoji array (`[]` when idle) · Poteto Mode `🥔` · phase anim on the right
- **Row 2:** context ring · cache (last-turn db icon + session %) · provider · model · thinking · fast
- **Phases:** idle `●` · think `sand` · tool `line` (includes edits) · stream pulse `●`  
- **Whimsy** on the working line only (spinner upright, message italic)  
- Git refreshes after `edit`/`write` and when the agent hands back to you

`auth.json`, `sessions/`, and other runtime files stay local and are gitignored.

