#!/usr/bin/env bash
set -euo pipefail

ref="${1:-main}"
root="$(git rev-parse --show-toplevel)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git clone --quiet --depth 1 --filter=blob:none --sparse \
  --branch "$ref" https://github.com/cursor/plugins.git "$tmp/plugins"
git -C "$tmp/plugins" sparse-checkout set pstack
upstream="$tmp/plugins/pstack"

if [[ ! -f "$upstream/.cursor-plugin/plugin.json" ]]; then
  echo "pstack plugin metadata not found at ref: $ref" >&2
  exit 1
fi

find "$upstream/skills" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | while read -r skill; do
  rm -rf "$root/skills/$skill"
  cp -R "$upstream/skills/$skill" "$root/skills/$skill"
done
rm -rf "$root/vendor/pstack/agents"
cp -R "$upstream/agents" "$root/vendor/pstack/agents"
cp "$upstream/LICENSE" "$root/vendor/pstack/LICENSE"
cp "$upstream/README.md" "$root/vendor/pstack/README.upstream.md"
cp "$upstream/.cursor-plugin/plugin.json" "$root/vendor/pstack/plugin.json"

commit="$(git -C "$tmp/plugins" rev-parse HEAD)"
date="$(git -C "$tmp/plugins" show -s --format=%cI HEAD)"
version="$(node -p "require('$root/vendor/pstack/plugin.json').version")"
printf 'Vendored pstack %s at %s (%s)\n' "$version" "$commit" "$date"
printf 'Update vendor/pstack/UPSTREAM.md and reapply Pi adaptations before committing.\n'
