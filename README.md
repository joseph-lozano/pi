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
| `extensions/` | Extensions (`exa`, `firecrawl`, `fast_mode`, `footer`) |
| `skills/` | Skills |
| `prompts/` | Prompt templates |
| `themes/` | Themes |

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

`auth.json`, `sessions/`, and other runtime files stay local and are gitignored.
