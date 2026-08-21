---
name: create-skill
description: Create or revise a Pi Agent Skill with valid frontmatter, focused instructions, and optional references or scripts. Use when explicitly asked to author a reusable skill.
disable-model-invocation: true
---

# Create a Pi skill

1. Read Pi's installed `docs/skills.md` completely before authoring.
2. Choose the destination:
   - project-local: `.pi/skills/<name>/SKILL.md`
   - personal/config package: `<agent-dir>/skills/<name>/SKILL.md`
3. Use a lowercase name of letters, digits, and hyphens, at most 64 characters. The directory must match the frontmatter `name`.
4. Write frontmatter with `name` and a concrete `description`. Add `disable-model-invocation: true` for heavy, opinionated, destructive, or explicitly invoked workflows.
5. Keep `SKILL.md` focused. Put detailed examples, rubrics, or source-specific instructions in `references/`; put deterministic operations in `scripts/`.
6. Resolve every relative path from the skill directory and verify every link.
7. Do not duplicate global agent instructions or embed credentials.
8. Reload Pi, inspect skill diagnostics, and exercise one representative invocation.

Prefer revising an existing skill over creating a near-duplicate. Do not create, edit, or post anything in an external system without explicit approval of the exact content.
