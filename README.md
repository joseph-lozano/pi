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
| `extensions/` | Extensions (`exa`, `firecrawl`, `fast_mode`, `enable_search_tools`, `footer`, `git_interceptor`, `pi_cloak`) |
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

### Custom footer (`footer.ts`)

Always-on B1 footer (see `prototypes/footer.html`):

- **Row 1:** cwd · branch · git `+/−` (numstat) · phase anim on the right  
- **Row 2:** context ring · cache (last-turn db icon + session %) · provider · model · thinking · fast  
- **Phases:** idle `●` · think `sand` · tool `line` (includes edits) · stream pulse `●`  
- **Whimsy** on the working line only (spinner upright, message italic)  
- Git refreshes after `edit`/`write` and when the agent hands back to you

### Cursor SDK (`npm:pi-cursor-sdk`)

Default provider is `cursor` via `settings.json` (`packages: ["npm:pi-cursor-sdk"]`).
Install/refresh with `pi install npm:pi-cursor-sdk` (or `pi update`), then `/login` → API key → Cursor.

#### Cursor SDK caches (gitignored)

These live under this repo (`~/.pi/agent`) and are machine-local — do not commit them.

| File | How it is generated |
|------|---------------------|
| `cursor-sdk-model-list.json` | Written automatically by `pi-cursor-sdk` after a live `Cursor.models.list` discovery (mode `0600`, keyed by API-key fingerprint — the key is never stored). Warm startups reuse it within the TTL (`PI_CURSOR_SDK_MODEL_CACHE_TTL_MS`, default 24h). Force a refresh with `/cursor-refresh-models`. Disable with `PI_CURSOR_SDK_DISABLE_MODEL_CACHE=1`. |
| `cursor-sdk-context-windows.json` | Collected from live local Cursor runs (checkpoint-derived context windows). Used when refreshing package snapshots, e.g. `npm run refresh:cursor-snapshots -- --write --context-windows ~/.pi/agent/cursor-sdk-context-windows.json` inside a `pi-cursor-sdk` checkout. |

`auth.json`, `sessions/`, and other runtime files stay local and are gitignored.

