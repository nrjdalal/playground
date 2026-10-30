"""Which outside authors' PRs Checks runs: one whose author checks.outsideAuthors names runs only at a head the Builder (`builder` today, or an <id>-builder) gave a go for in gos.jsonl: an outside author's PR merges on its own branch, through pr:merge --outside-author, which needs a Checks PASS at its head. Every other author but the owner is refused, as before."""
import json, os, re

# checks.outsideAuthors, read once a process
OUTSIDE = None
# the data folder as dataDir() resolves it: PLAYGROUND_DATA_DIR, else ~/.playground
GOS = os.path.join(os.path.abspath(os.environ.get("PLAYGROUND_DATA_DIR") or os.path.expanduser("~/.playground")), "ops", "gos.jsonl")
# the builder gives the go: today's `builder`, or an <id>-builder
BUILDER = re.compile(r"builder|[23456789bcdfghjkmnpqrstvwxyz]{6}-builder")


def has_go(n, sha, path=GOS):
    try:
        with open(path) as f:
            lines = f.read().splitlines()
    except OSError:
        return False
    for line in lines:
        try:
            g = json.loads(line)
        except ValueError:
            continue
        if BUILDER.fullmatch(str(g.get("by"))) and g.get("pr") == n and g.get("sha") == sha:
            return True
    return False


def authors():
    global OUTSIDE
    if OUTSIDE is None:
        from checks import setting

        OUTSIDE = set(setting("checks.outsideAuthors"))
    return OUTSIDE


def runs(author, owner, n, sha, path=GOS):
    return author == owner or (author in authors() and bool(sha) and has_go(n, sha, path))
