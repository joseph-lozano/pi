---
name: setup-pstack
description: Explain or modify the static pstack model-role policy in this Pi configuration. Use only when explicitly asked to change pstack model choices.
disable-model-invocation: true
---

> **Pi runtime:** Before applying this skill, read [`../pstack-pi/SKILL.md`](../pstack-pi/SKILL.md).

# Pstack model policy

This Pi port does not use Cursor model slugs, `.cursor/rules`, a runtime model file, or `/setup-pstack`. Model choices are source-controlled in `extensions/pstack/models.ts`.

## Procedure

1. Read `extensions/pstack/models.ts` and `settings.json` completely.
2. Enumerate `ctx.scopedModels` through the pstack extension or inspect the configured `enabledModels`; never invent a model identifier.
3. Show the requested role changes and their current values.
4. If the user asked to modify configuration, edit the static `PSTACK_MODELS` map.
5. Preserve scalar roles, panel roles, thinking levels, and `inherit-parent` support.
6. Run `tests/pstack.test.ts` and the full test suite.
7. Reload Pi and confirm that startup reports no unavailable configured model.

The supported roles are defined by `PstackModelRole` in `extensions/pstack/models.ts`. Workers select them through `job.role`; panel members use `job.panelIndex`.
