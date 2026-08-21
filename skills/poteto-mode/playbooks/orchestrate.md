### Orchestrate

> **Pi status:** Deferred.

This port does not yet support nested delegation and intentionally does not ship the upstream Commander-based Orchestrate CLI. Do not select this playbook.

Use Multi-phase plan with parent-owned local `job` workers instead. Keep one writer per worktree, persist the phase checklist through `todo`, and let the parent own all integration and human gates.
