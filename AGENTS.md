# Agent instructions

## Tool calls

Before complex tool calls, especially bash/shell, state in one sentence what you're about to do and why.

## External communications

Do not create, edit, or send comments or messages in any external system—including GitHub, Notion, Slack, or similar services—without explicit human approval of the exact content in the current conversation. Before posting, present the complete proposed content and wait for sign-off. A request to investigate, review, or work on an external item does not constitute approval to communicate externally.

## Web research

Use the Exa and Firecrawl tools for anything on the public web.

- **Discover:** prefer `exa_search` (semantic, good longform/docs). Use `firecrawl_search` when you want classic SERP / official-site hits.
- **Read pages:** prefer `firecrawl_fetch` for full markdown on known URLs. `exa_fetch` is fine for normal HTML articles and is often fast; avoid relying on it for GitHub blob pages or Reddit.
- **GitHub:** prefer raw URLs (`raw.githubusercontent.com`), or `git clone` into a `mktemp -d` dir and `read` locally — not HTML fetch.
- Keep searches focused; fetch only the shortlist you need.
