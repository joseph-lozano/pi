# Upstream provenance

This repository vendors and adapts the `pstack` plugin from Cursor's public
plugin repository.

- Repository: https://github.com/cursor/plugins
- Subdirectory: `pstack/`
- Plugin version: `0.14.1`
- Commit: `51a96e0dd838404da19ba83dc70aa21eef71f868`
- Commit date: `2026-08-20T16:38:27-07:00`
- License: MIT; see `LICENSE`

Imported into the active Pi `skills/` directory:

- all upstream skills and principles
- all references and scripts nested under those skills

Retained as source material under `vendor/pstack/`:

- upstream agent definitions
- upstream README and plugin metadata

Excluded deliberately:

- `automations/`, including Benny
- Cursor cloud-agent runtime behavior

The active skill copies are adapted for Pi and may differ from upstream.
Run `scripts/vendor-pstack.sh <git-ref>` only when intentionally beginning an
upstream refresh; it replaces the active pstack skill directories and must be
followed by review and reapplication of Pi-specific adaptations.
