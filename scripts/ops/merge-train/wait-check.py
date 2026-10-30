#!/usr/bin/env python3
"""wait-check.py: builder, 12 Oct: "If the train ever waits more than 15 minutes for a slot, tell me." Reads the train's heartbeat detail;
while it reads "waiting for the run slot", keeps when that began (wait-since.json), and prints `ALERT train ...` once per wait when it has
lasted 15 minutes. Prints nothing otherwise. Reads only."""
import json, os, time

HERE = os.path.expanduser("~/.playground/ops/merge-train")  # the state folder by name, so a run by its repo path still reads the live state
OPS = os.path.dirname(HERE)
STATE = os.path.join(HERE, "wait-since.json")
detail = json.load(open(os.path.join(OPS, "ops-merge-train.json"))).get("detail", "")
try:
    state = json.load(open(STATE))
except (OSError, ValueError):
    state = {}
now = time.time()
if "waiting for the run slot" in detail:
    state.setdefault("since", now)
    if now - state["since"] >= 900 and not state.get("told"):
        state["told"] = True
        print(f"ALERT train has waited {int((now - state['since']) / 60)} minutes for a run slot: {detail[:120]}")
else:
    state = {}
tmp = STATE + ".tmp"
json.dump(state, open(tmp, "w"))
os.replace(tmp, STATE)
