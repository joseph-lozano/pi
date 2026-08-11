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
| `extensions/` | Extensions (`exa`, `firecrawl`, `xai_fast`) |
| `skills/` | Skills |
| `prompts/` | Prompt templates |
| `themes/` | Themes |

### xAI fast mode

`extensions/xai_fast.ts` adds `/fast` for Grok Priority Processing
(`service_tier: "priority"` on the xAI Responses/Completions APIs).
State lives in gitignored `xai-fast.json`. Use `/fast`, `/fast on|off|status`.
Reload with `/reload` if the session was already running when the extension was added.

`auth.json`, `sessions/`, and other runtime files stay local and are gitignored.
