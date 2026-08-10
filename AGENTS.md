# Agent instructions

## Web research

Use the Exa and Firecrawl tools for anything on the public web.

- **Discover:** prefer `exa_search` (semantic, good longform/docs). Use `firecrawl_search` when you want classic SERP / official-site hits.
- **Read pages:** prefer `firecrawl_fetch` for full markdown on known URLs. `exa_fetch` is fine for normal HTML articles and is often fast; avoid relying on it for GitHub blob pages or Reddit.
- **GitHub:** prefer raw URLs (`raw.githubusercontent.com`), or `git clone` into a `mktemp -d` dir and `read` locally — not HTML fetch.
- Keep searches focused; fetch only the shortlist you need.
