#!/usr/bin/env bash
# Prints the branch the live dashboard rolls to: canary when the repo's main checkout (the clone install.sh made, listed first by git worktree list) sits on canary, else main; a detached or unreadable checkout follows main.
# Usage: upstream.sh, run anywhere inside the dashboard's checkout.
cloned=$(git worktree list --porcelain 2>/dev/null | awk '/^$/{exit} /^branch refs\/heads\//{sub("refs/heads/","",$2); print $2; exit}')
[ "$cloned" = canary ] && echo canary || echo main
