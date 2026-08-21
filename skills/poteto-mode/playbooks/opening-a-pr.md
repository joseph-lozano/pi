### Opening a PR

**Prepare locally, then stop at the external-action gate.** This step never authorizes a push or PR mutation.

1. Read the complete diff and run the repository's real verification.
2. Apply **unslop** to commit and PR prose and run `/skill:no-comments` over comments in the changed code.
3. Keep the proposed change small and ordered. If dependent follow-ups exist, describe their intended order without assuming Graphite.
4. Draft the exact branch push, PR title, PR body, base branch, and any labels or reviewers.
5. Present that complete content and wait for explicit user approval.
6. Only after approval, perform exactly the approved external actions and verify the resulting remote PR with `gh pr view`.

**Reply before approval:** local verification, diff summary, and the exact proposed push and PR content. Do not claim a PR exists.
