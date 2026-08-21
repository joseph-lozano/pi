### Worktree and simulator cleanup

**You own the audit, not deletion authority.** Inventory disk use and propose a safe cleanup set. Never remove an active Herdr worktree or destroy uncommitted state.

1. Record `df -h /` and enumerate worktrees only through `git worktree list --porcelain`.
2. For each path, collect age, size, branch, merge state, `git status --short`, and open PR state. Use `pstack_sessions` metadata as supporting evidence, never as sole proof of inactivity.
3. Any path under `.herdr/worktrees/` is Herdr-managed. Hold it unless the user explicitly asks to use Herdr for cleanup; then follow the Herdr skill and remove it only through the supported Herdr workflow.
4. Hold the current worktree, pinned or named work, any worktree with tracked or untracked changes, and anything whose ownership is uncertain.
5. Present the exact candidate paths, evidence, and removal commands. Wait for explicit user approval before any `git worktree remove`, `rm -rf`, simulator deletion, or cache clearing.
6. After approval, remove only the approved paths, run `git worktree prune`, re-list worktrees, and report `df -h /` before and after.
7. Treat simulators and caches as a separate approval batch. Name exact simulator runtimes or cache paths and estimated sizes; never include Pi sessions, credentials, active Herdr state, or project artifacts by default.

**Reply:** disk usage, the evidence table, held paths with reasons, and the exact proposed cleanup commands. Before approval this playbook produces a proposal only.
