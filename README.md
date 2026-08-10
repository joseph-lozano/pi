# pi config

Personal [pi](https://pi.dev) coding agent config. This repo is symlinked to `~/.pi/agent`.

## Setup

```bash
./setup.sh
```

That backs up any existing `~/.pi/agent`, preserves credentials/sessions, and links this repo in its place.

## Layout

| Path | Purpose |
|------|---------|
| `settings.json` | Global settings |
| `AGENTS.md` | Global agent instructions |
| `skills/` | Skills |
| `extensions/` | Extensions |
| `prompts/` | Prompt templates |
| `themes/` | Themes |

`auth.json`, `sessions/`, and other runtime files stay local and are gitignored.
