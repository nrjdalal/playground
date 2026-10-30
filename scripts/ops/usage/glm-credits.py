#!/usr/bin/env python3
# Z.ai GLM plan credits from the quota endpoint (notes/zai-usage-endpoint.md): one line per window, used of cap, or "can't read" with why. The key stays in the Keychain read and the request header, never printed.
import datetime
import json
import os
import subprocess
import sys
import urllib.request

sys.path.insert(0, os.path.expanduser("~/.playground/ops"))  # beat.py beside it in the state folder by name, as account-watch.py reaches it
from beat import setting  # noqa: E402

URL = "https://api.z.ai/api/monitor/usage/quota/limit"
WINDOWS = {(3, 5): "5h", (6, 1): "week"}


def fail(why):
    print(f"glm credits: can't read ({why})")
    sys.exit(1)


# the first GLM row of usage.accounts, by its label: the key spawn.sh's GLM backend runs on by default
LABEL = next((a["label"] for a in setting("usage.accounts") if a.get("provider") == "glm"), None)
if not LABEL:
    fail("usage.accounts lists no GLM key")
key = subprocess.run(
    ["security", "find-generic-password", "-s", setting("models.glmKeychainService"), "-a", LABEL, "-w"],
    capture_output=True,
    text=True,
).stdout.strip()
if not key:
    fail(f"the Keychain holds no {LABEL} item under models.glmKeychainService")
try:
    req = urllib.request.Request(URL, headers={"Authorization": f"Bearer {key}"})
    body = json.load(urllib.request.urlopen(req, timeout=15))
except Exception as e:
    fail(type(e).__name__)
if not isinstance(body, dict) or body.get("code") != 200 or body.get("success") is not True:
    fail(f"code {body.get('code') if isinstance(body, dict) else '?'}")
data = body.get("data") or {}
out = []
for lim in data.get("limits") or []:
    if not isinstance(lim, dict) or lim.get("type") != "CREDIT_LIMIT":
        continue
    name = WINDOWS.get((lim.get("unit"), lim.get("number")))
    used, cap, reset = lim.get("currentValue"), lim.get("usage"), lim.get("nextResetTime")
    if not name or not isinstance(used, (int, float)) or not isinstance(cap, (int, float)) or cap <= 0:
        continue
    at = (
        datetime.datetime.fromtimestamp(reset / 1000, datetime.timezone.utc).strftime("%H:%MZ %d %b")
        if isinstance(reset, (int, float))
        else "unknown"
    )
    out.append(f"{name} {used:,.0f}/{cap:,.0f} credits ({used / cap:.0%}), resets {at}")
if not out:
    fail("no credit window in the answer")
print(f"glm credits ({data.get('level', '?')}): " + "; ".join(out))
