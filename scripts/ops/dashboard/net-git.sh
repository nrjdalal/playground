#!/usr/bin/env bash
# Runs one git call that reaches origin, with no terminal prompt and no credential helper (the repo is public), killing it by its own process group after NET_GIT_LIMIT seconds (20 by default), since a hidden keychain prompt hung the supervisor's ls-remote for good and macOS has no timeout.
# Usage: net-git.sh <git args>; prints git's output, or exits 124 with one line on stderr when the limit passed.
limit=${NET_GIT_LIMIT:-20}
out=$(mktemp) || exit 1
trap 'rm -f "$out"' EXIT
set -m
GIT_TERMINAL_PROMPT=0 git -c credential.helper= "$@" > "$out" 2>/dev/null &
pid=$!
set +m
i=0
while kill -0 "$pid" 2>/dev/null; do
  if [ "$i" -ge $((limit * 10)) ]; then
    kill -- "-$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    echo "net-git: git $1 gave no answer in ${limit}s, so it was stopped" >&2
    exit 124
  fi
  sleep 0.1
  i=$((i + 1))
done
wait "$pid" || exit $?
cat "$out"
