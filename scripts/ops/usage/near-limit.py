#!/usr/bin/env python3
"""Prints one line per usage mark newly crossed on this month's accounts, once per window reset; silent otherwise (dispatcher, 16 Oct).

Marks: the 5-hour window at 70, 80 and 90%, the week at 15, 80 and 90% (dispatcher: "alert me when the 5h window passes 70% and when the week passes 15%").
Reads usage.json in the data folder for the stored login, and login-flip.json's token readings for the other accounts: one of those
older than 14 minutes is read again here with one 1-token Haiku call (dispatcher, 16 Oct, "Pick (a)"), and a limited account is not read
again until its reset. Remembers what it printed in near-limit.json in the state folder, ~/.playground/ops/usage.
"""
import json, os, subprocess, sys, time, urllib.request

HERE = os.path.expanduser("~/.playground/ops/usage")  # the state folder by name, so a run by its repo path still reads the live state
sys.path.insert(0, os.path.dirname(HERE))
from beat import OPS, setting  # noqa: E402

ROOT = os.path.dirname(OPS)

# the accounts usage.accounts marks nearLimit
ACCOUNTS = {a["email"] for a in setting("usage.accounts") if a.get("provider", "claude") == "claude" and a.get("nearLimit")}
PROBE_MODEL, SERVICE = setting("models.probe"), setting("usage.keychainService")
MARKS = {"five_hour": (70, 80, 90), "seven_day": (15, 80, 90)}
NAMES = {"five_hour": "5-hour window", "seven_day": "week"}
STATE = os.path.join(HERE, "near-limit.json")
FLIP = os.path.join(HERE, "login-flip.json")
PROBE_EVERY, FRESH_FOR = 840, 1800


def probe(email):
    """login-flip.py's probe: one 1-token call to models.probe as that account's token; the token goes into the request header and nowhere else."""
    r = subprocess.run(["security", "find-generic-password", "-s", SERVICE, "-a", email, "-w"], capture_output=True, text=True, timeout=15)
    if r.returncode:
        return None
    body = json.dumps({"model": PROBE_MODEL, "max_tokens": 1, "system": "You are Claude Code, Anthropic's official CLI for Claude.",
                       "messages": [{"role": "user", "content": "hi"}]}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, headers={
        "Authorization": "Bearer " + r.stdout.strip(), "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20,claude-code-20250219", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            h = resp.headers
    except Exception as e:
        h = getattr(e, "headers", None)
    if not h or h.get("anthropic-ratelimit-unified-7d-utilization") is None:
        return None
    f = lambda k: float(h.get(f"anthropic-ratelimit-unified-{k}") or 0)
    got = {"five": round(f("5h-utilization") * 100), "fiveReset": f("5h-reset"), "week": round(f("7d-utilization") * 100), "weekReset": f("7d-reset")}
    if h.get("anthropic-ratelimit-unified-status") == "rejected":
        got["limitedUntil"] = got["weekReset"] if got["week"] >= 100 or got["five"] < 100 else got["fiveReset"]
    return got


u = json.load(open(os.path.join(ROOT, "usage.json")))
readings = []
if u.get("account") in ACCOUNTS:
    readings.append((u["account"], u.get("rate_limits") or {}, f"usage.json {u.get('writtenAt')}"))
now = time.time()
try:
    flip = json.load(open(FLIP))
except (OSError, ValueError):
    flip = {}
for a in sorted(ACCOUNTS - {u.get("account")}):
    s = (flip.get("seen") or {}).get(a) or {}
    if now - s.get("at", 0) >= PROBE_EVERY and now >= s.get("limitedUntil", 0):
        got = probe(a)
        if got:
            s = dict(got, at=now, via="token")
            try:
                flip = json.load(open(FLIP))  # login-flip.py may have written since; set only this reading
            except (OSError, ValueError):
                flip = {}
            flip.setdefault("seen", {})[a] = s
            tmp = f"{FLIP}.{os.getpid()}"
            json.dump(flip, open(tmp, "w"))
            os.replace(tmp, FLIP)
    if s.get("week") is None or now - s.get("at", 0) >= FRESH_FOR and now >= s.get("limitedUntil", 0):
        continue
    limits = {"five_hour": {"used_percentage": s.get("five"), "resets_at": s.get("fiveReset")}, "seven_day": {"used_percentage": s["week"], "resets_at": s.get("weekReset")}}
    readings.append((a, limits, "token probe " + time.strftime("%H:%MZ", time.gmtime(s["at"]))))
# Z.ai's GLM plan (dispatcher, 16 Oct: "alert at 5h past 70% and week past 50%"): its quota endpoint, no model call; the key goes into
# the request header and nowhere else. unit 3 is the 5-hour window, unit 6 the week.
ZAI_MARKS = {"five_hour": (70, 80, 90), "seven_day": (50, 80, 90)}
GLM_LABEL = next((a["label"] for a in setting("usage.accounts") if a.get("provider") == "glm"), None)  # the first GLM row's key, the one spawn.sh runs on by default
try:
    r = subprocess.run(["security", "find-generic-password", "-s", setting("models.glmKeychainService"), "-a", GLM_LABEL, "-w"], capture_output=True, text=True, timeout=15) if GLM_LABEL else None
    if r and not r.returncode:
        req = urllib.request.Request("https://api.z.ai/api/monitor/usage/quota/limit", headers={"Authorization": r.stdout.strip(), "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            limits = (json.load(resp).get("data") or {}).get("limits") or []
        zl = {}
        for l in limits:
            key = {3: "five_hour", 6: "seven_day"}.get(l.get("unit"))
            if key and l.get("type") == "CREDIT_LIMIT":
                zl[key] = {"used_percentage": l.get("percentage"), "resets_at": (l["nextResetTime"] / 1000) if l.get("nextResetTime") else None}
        if zl:
            readings.append(("Z.ai GLM plan", zl, "quota " + time.strftime("%H:%MZ", time.gmtime(now))))
except Exception:
    pass
try:
    seen = json.load(open(STATE))
except (OSError, ValueError):
    seen = {}
out = []
for account, rl, src in readings:
  for key, marks in (ZAI_MARKS if account == "Z.ai GLM plan" else MARKS).items():
    w = rl.get(key) or {}
    used, reset = w.get("used_percentage"), w.get("resets_at")
    if not isinstance(used, (int, float)):
        continue
    crossed = [m for m in marks if used >= m]
    if not crossed:
        continue
    # by the hour: a token reading's reset drifts by seconds between reads, which must not repeat the line
    tag = f"{account}:{key}:{round(reset / 3600) if reset else None}:{crossed[-1]}"
    if tag in seen:
        continue
    seen[tag] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
    at = time.strftime("%a %H:%MZ", time.gmtime(reset)) if reset else "?"
    out.append(f"{account} {NAMES[key]} at {used:g}%, past {crossed[-1]}% (measured, {src}); resets {at}")
if out:
    tmp = STATE + ".tmp"
    json.dump(seen, open(tmp, "w"), indent=1)
    os.replace(tmp, STATE)
    print("\n".join(out))
