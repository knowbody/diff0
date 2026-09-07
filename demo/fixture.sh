#!/usr/bin/env bash
# Shared copy boundary: fixtures carry source and locks, never installed/runtime state.
copy_demo_fixture() {
  local source_dir="$1" destination_dir="$2"
  mkdir -p "$destination_dir"
  rsync -a --exclude node_modules --exclude .eve --exclude .git "$source_dir/" "$destination_dir/"
  printf 'node_modules/\n.eve/\n' > "$destination_dir/.gitignore"
}
