#!/usr/bin/env bash
# Checks what the skills need on this machine, one
# line per need: "ok", "MISSING" with its fix, or "optional". Exit 1 when a required need
# is missing.
#   check.sh         check only
#   check.sh --fix   also install missing required tools (Homebrew) and the home skill set,
#                    then check again; what needs a person (gh auth login, a plugin install)
#                    stays a printed command
# MCP servers can only be checked from inside Claude Code; the setup skill does that
# part, along with each "mcp <label> <tool>, ..." line an extension's check prints. Each
# extension's own scripts/setup/check.sh runs last, for its skills' needs.
set -u
FIX=0; [ "${1:-}" = "--fix" ] && FIX=1
# The checkout: the one spawn.sh exports, else the one this script sits in, else the one the
# playground command runs from, since a session's skills are a copy outside the checkout.
HERE="$(cd "$(dirname "$0")" && pwd -P)"
REPO="${PLAYGROUND_REPO:-}"
[ -n "$REPO" ] || [ ! -f "$HERE/../../../../../scripts/link-skills.sh" ] || REPO="$(cd "$HERE/../../../../.." && pwd -P)"
[ -n "$REPO" ] || ! command -v playground >/dev/null || REPO="$(cd "$(dirname "$(readlink -f "$(command -v playground)")")/../../../.." && pwd -P)"
MIN_CLAUDE="2.1.224" # messages between sessions (every skill's learning clause); 2.1.218 for background: false
missing=0

say() { printf '%-8s %-22s %s\n' "$1" "$2" "$3"; }
ok() { say "ok" "$1" "$2"; }
miss() { # name, required (1/0), fix
  if [ "$2" = 1 ]; then say "MISSING" "$1" "fix: $3"; missing=1; else say "optional" "$1" "missing; fix: $3"; fi
}
newer_or_equal() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; } # $1 >= $2
has() { command -v "$1" >/dev/null 2>&1; }
install_hint() { if has brew; then echo "brew install $1"; else echo "install $1"; fi; }

tool() { # command, brew formula, required, what for
  if ! has "$1" && [ "$FIX" = 1 ] && [ "$3" = 1 ] && has brew; then brew install "$2" >&2; fi
  if has "$1"; then ok "$1" "$4"; else miss "$1" "$3" "$(install_hint "$2") ($4)"; fi
}

tool git git 1 "every skill"
tool gh gh 1 "PR and branch checks, PRs"
if has gh; then
  if gh auth status --active -h github.com >/dev/null 2>&1; then ok "gh login" "github.com"; else miss "gh login" 1 "run: gh auth login"; fi
  # Without gh as git's helper, a non-interactive fetch can stall on a macOS keychain prompt.
  gh_helper() { git config --get-urlmatch credential.helper https://github.com 2>/dev/null | grep -q "gh auth git-credential"; } # any layout: url-scoped, plain, or [include]d
  if ! gh_helper && [ "$FIX" = 1 ]; then gh auth setup-git >/dev/null 2>&1; fi
  if gh_helper; then ok "git uses gh login" "credential helper for github.com"; else miss "git uses gh login" 1 "run: gh auth setup-git"; fi
fi
tool python3 python 1 "the ops scripts and code-review-loop's state.py"
tool npx node 1 "the MCP servers that run through npx"
tool uv uv 1 "this repo's Python tests"
tool pnpm pnpm 1 "a pnpm repo's gates"

if has claude; then
  v="$(claude --version 2>/dev/null | awk '{print $1}')"
  if newer_or_equal "$v" "$MIN_CLAUDE"; then ok "claude $v" ">= $MIN_CLAUDE"; else miss "claude $v" 1 "update Claude Code to $MIN_CLAUDE or later"; fi
else
  miss "claude" 1 "install Claude Code"
fi

# The factory's sessions run in bypass mode: spawn.sh passes the flag itself, and these two settings make a session started any other way land there too, with no prompt to stop on (a session in another mode holds every cross-session message for approval).
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
if grep -Eq '"defaultMode"[[:space:]]*:[[:space:]]*"bypassPermissions"' "$SETTINGS" 2>/dev/null &&
  grep -Eq '"skipDangerousModePermissionPrompt"[[:space:]]*:[[:space:]]*true' "$SETTINGS" 2>/dev/null; then
  ok "bypass mode" "factory sessions start in it ($SETTINGS)"
else
  miss "bypass mode" 0 "in $SETTINGS set \"permissions\": { \"defaultMode\": \"bypassPermissions\" } and \"skipDangerousModePermissionPrompt\": true (factory sessions)"
fi

# Skills: the home set link-skills.sh installs at user scope, ws-home@ws, which a session
# started by hand loads (spawn.sh hands each factory session its own); --fix runs link-skills.sh.
home_set() { claude plugin list 2>/dev/null | grep -q "ws-home@ws"; }
if ! home_set && [ "$FIX" = 1 ]; then bash "$REPO/scripts/link-skills.sh" >/dev/null 2>&1 || true; fi
if home_set; then
  ok "skills" "the home set, ws-home@ws"
else
  miss "skills" 1 "run check.sh --fix (scripts/link-skills.sh installs the home set, ws-home@ws)"
fi


# Each extension checks its own needs with its scripts/setup/check.sh, run with the same --fix and the checkout as PLAYGROUND_REPO.
DATA="${PLAYGROUND_DATA_DIR:-$HOME/.playground}"
for ext in "$DATA"/extensions/*/scripts/setup/check.sh; do
  [ -f "$ext" ] && [ "$ext" != "$DATA/extensions/core/scripts/setup/check.sh" ] || continue
  if [ "$FIX" = 1 ]; then PLAYGROUND_REPO="$REPO" bash "$ext" --fix; else PLAYGROUND_REPO="$REPO" bash "$ext"; fi || missing=1
done

exit "$missing"
