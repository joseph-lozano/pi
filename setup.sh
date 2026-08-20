#!/usr/bin/env bash
# Link this repository to the canonical pi agent config directory (~/.pi/agent).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_HOME="${HOME}/.pi"
TARGET="${PI_HOME}/agent"

if command -v pi >/dev/null 2>&1; then
  echo "Pi already installed: $(command -v pi)"
else
  if ! command -v npm >/dev/null 2>&1; then
    echo "Cannot install Pi: npm is not available." >&2
    exit 1
  fi
  echo "Installing Pi"
  npm install -g --ignore-scripts @earendil-works/pi-coding-agent
fi

mkdir -p "${PI_HOME}"

# Runtime / secret paths to preserve across the switch.
PRESERVE=(
  auth.json
  sessions
  trust.json
  models-store.json
  npm
  git
)

copy_preserve_from() {
  local src="$1"
  local name
  for name in "${PRESERVE[@]}"; do
    if [[ -e "${src}/${name}" && ! -e "${REPO_DIR}/${name}" ]]; then
      echo "Preserving ${name} -> repo"
      cp -a "${src}/${name}" "${REPO_DIR}/${name}"
    fi
  done
}

if [[ -L "${TARGET}" ]]; then
  current="$(readlink "${TARGET}")"
  if [[ "${current}" == "${REPO_DIR}" ]]; then
    echo "Already linked: ${TARGET} -> ${REPO_DIR}"
    exit 0
  fi
  echo "Replacing existing symlink ${TARGET} -> ${current}"
  # If the old link points at a real dir, pull runtime files from there first.
  if [[ -d "${current}" ]]; then
    copy_preserve_from "${current}"
  fi
  rm "${TARGET}"
elif [[ -d "${TARGET}" ]]; then
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup="${TARGET}.bak-${stamp}"
  echo "Backing up ${TARGET} -> ${backup}"
  copy_preserve_from "${TARGET}"
  mv "${TARGET}" "${backup}"
elif [[ -e "${TARGET}" ]]; then
  echo "Refusing to replace unexpected file: ${TARGET}" >&2
  exit 1
fi

ln -s "${REPO_DIR}" "${TARGET}"
echo "Linked ${TARGET} -> ${REPO_DIR}"
echo "Done. Start a new pi session (or /reload) to pick up config changes."
