#!/usr/bin/env bash
set -euo pipefail

# Skills reach a session as one merged plugin, never as links in
# ~/.claude/skills, since a personal skill there takes a bare name over every
# plugin's: spawn.sh hands each factory session its own set (playground orgs
# resolve), and the home set, installed at the end at user scope (playground orgs
# home), serves a session started by hand; that step also removes each personal
# link at a name the set ships. Links into this repo's skills/ or extensions/
# from an older run go here; other tools' links stay.

REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
DEST="$HOME/.claude/skills"
BUN=$(command -v bun || echo "$HOME/.bun/bin/bun")

if [ -L "$DEST" ]; then
  case "$(readlink -f "$DEST")" in
    "$REPO"|"$REPO"/*)
      echo "error: $DEST is a symlink into this repo; remove it and re-run." >&2
      exit 1
      ;;
  esac
fi

status=0
for link in "$DEST"/*; do
  [ -L "$link" ] || continue
  case "$(readlink "$link")" in
    "$REPO/skills/"*|"$REPO/extensions/"*) rm "$link"; echo "removed stale link $(basename "$link")" ;;
  esac
done

# Links the factory's settings, which every factory session is spawned with
# (--settings), so a pull updates its hooks too. A real file there is left alone.
SETTINGS="$HOME/.playground/factory-settings.json"
mkdir -p "$(dirname "$SETTINGS")"
if [ -e "$SETTINGS" ] && [ ! -L "$SETTINGS" ]; then
  echo "skipped factory settings: $SETTINGS is a real file, move it aside first" >&2
  status=1
else
  ln -sfn "$REPO/scripts/factory-settings.json" "$SETTINGS"
  echo "linked factory settings -> $REPO/scripts/factory-settings.json"
fi

# Links the brief templates and the `playground` command (into ~/.bun/bin, on a login shell's PATH), leaving a real file alone
link_file() {
  local src="$1" target="$2"
  mkdir -p "$(dirname "$target")"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "skipped $target: a real file, move it aside first" >&2
    status=1
  else
    ln -sfn "$src" "$target"
    echo "linked $target -> $src"
  fi
}
for brief in new-reviewer new-tester new-worker; do
  link_file "$REPO/scripts/briefs/$brief.md" "$HOME/.playground/handoffs/$brief.md"
done
# brief-rush.md sits beside the state files, not in handoffs/; a copy from before it was versioned moves aside like beat.py's
RUSH="$HOME/.playground/brief-rush.md"
if [ -f "$RUSH" ] && [ ! -L "$RUSH" ]; then
  mv "$RUSH" "$RUSH.replaced-$(date -u +%Y%m%dT%H%M%SZ)"
  echo "moved aside $RUSH: a copy from before scripts/briefs/brief-rush.md held it"
fi
link_file "$REPO/scripts/briefs/brief-rush.md" "$RUSH"
link_file "$REPO/packages/scripts/src/playground/cli.ts" "$HOME/.bun/bin/playground"
# run-slot.sh keeps its state in the state folder (ops/run-slot*) beside the link, so every heavy run follows the checkout's copy
link_file "$REPO/scripts/ops/run-slot.sh" "$HOME/.playground/ops/run-slot.sh"
BEAT="$HOME/.playground/ops/beat.py"
if [ -f "$BEAT" ] && [ ! -L "$BEAT" ]; then
  mv "$BEAT" "$BEAT.replaced-$(date -u +%Y%m%dT%H%M%SZ)"
  echo "moved aside $BEAT: a copy the scripts' checkout() lookup lacks"
fi
# The merge train's and usage's scripts name their state folders by path, so their state stays there whichever path runs them; beat.py is the module they import for the heartbeat and the checkout, and notify.sh the line the merge train queues its alerts through
for script in beat.py merge-train/run.py notify.sh usage/account-watch.py usage/glm-credits.py usage/login-flip.py usage/near-limit.py usage/run.py usage/week-marks.py; do
  link_file "$REPO/scripts/ops/$script" "$HOME/.playground/ops/$script"
done
# The home skill set, written from this checkout and the extensions and installed at user scope as ws-home@ws (playground orgs home), so a pull's skills reach the next session started by hand
"$BUN" --no-env-file "$REPO/packages/scripts/src/playground/orgs.ts" home || status=1
# Every worktree shares .git/rr-cache, so rerere would replay one worktree's merge resolution in another's merge
git -C "$REPO" config rerere.enabled false || status=1
exit $status
