#!/usr/bin/env python3
"""week-marks.py: the week's marks per account, and the day's spend, across the factory's accounts (13 Oct: no daily cap,
"work if machine allows"). Reads ops-usage's usage.json, which names the account the Claude login holds and, in `accounts`,
each other account's week, keeps its own samples per account, and prints one status line plus:
  ALERT <90|97|98> <account> ...   once per account and week reset, when that account's week passes the mark: the logged-in
                                   account's, and each account in `accounts` that usage.accounts lists
  ALERT 5h ...                     once per 5-hour window of the logged-in account, when it passes 85%
Each other account in usage.json's `accounts` is sampled into account-samples.jsonl, and the status line adds their combined %/h. It sends nothing:
Ops' tick relays the alerts."""
import calendar, json, os, sys, time

HERE = os.path.expanduser("~/.playground/ops/usage")  # the state folder by name, so a run by its repo path still reads the live state
sys.path.insert(0, os.path.dirname(HERE))
from beat import OPS, setting  # noqa: E402

DAY_CAP = 40.0
u = json.load(open(os.path.join(os.path.dirname(OPS), "usage.json")))
account = u.get("account") or "?"
# the factory's accounts, from usage.accounts; each week resets on its own day.
# usage.json's resets_at is the authority (it is the account's own); an account's weekReset guards a reading with no reset.
# Nothing parks: at 100% Bravo switches the factory to the next account (#i823).
ACCOUNTS = {a["email"]: a.get("weekReset") for a in setting("usage.accounts") if a.get("provider", "claude") == "claude"}
FACTORY = tuple(ACCOUNTS)
# a logged-in account usage.accounts does not list is not counted, while each listed spare still is
counted = account in FACTORY
# an unlisted login's reading may hold a 5-hour window alone (run.py's stored_login), and it counts nothing
week = u["rate_limits"]["seven_day"] if counted else u["rate_limits"].get("seven_day") or {"used_percentage": 0}
now, used, reset = time.time(), week["used_percentage"], week.get("resets_at")
if not reset and ACCOUNTS.get(account):
    # no reset in the reading: the next one from the account's own day and hour
    a = ACCOUNTS[account]
    t = time.gmtime(now)
    days = (a["weekday"] - t.tm_wday) % 7
    reset = now - (t.tm_hour * 3600 + t.tm_min * 60 + t.tm_sec) + days * 86400 + a["hour"] * 3600
    if reset <= now:
        reset += 7 * 86400
# the other accounts' rows go to their own file, since optimizer/window.py pairs week-samples.jsonl's rows by time alone
samples, others_samples = os.path.join(HERE, "week-samples.jsonl"), os.path.join(HERE, "account-samples.jsonl")


def sample(path, t, account, used, reset):
    """Append this reading, and return the account's samples in this week with its %/h over the last hour, or None."""
    with open(path, "a") as f:
        f.write(json.dumps({"t": t, "week": used, "reset": reset, "account": account}) + "\n")
    rows = [r for r in (json.loads(l) for l in open(path) if l.strip()) if r.get("account", account) == account and abs(r["reset"] - reset) < 300]
    hour = [r for r in rows if r["t"] >= now - 3600]
    return rows, (hour[-1]["week"] - hour[0]["week"]) / (hour[-1]["t"] - hour[0]["t"]) * 3600 if len(hour) >= 2 and hour[-1]["t"] - hour[0]["t"] >= 900 else None


rows, rate = sample(samples, now, account, used, reset) if counted else ([], None)
# the pace across every account ops-usage reads (login-flip.json's `accounts`), since the spares' budget is one %/h for all of them
spares = {a: r for a, r in (u.get("accounts") or {}).items() if a != account}
others = {a: sample(others_samples, calendar.timegm(time.strptime(r["readAt"], "%Y-%m-%dT%H:%M:%SZ")), a, r["week"], r["weekReset"])[1] for a, r in spares.items()}
pace = [rate, *others.values()]
combined = f"; combined {'?' if None in pace else f'{sum(pace):.1f}'}%/h across {len(pace)} accounts" if others else ""
# the IST day: 18:30Z to 18:30Z
day_start = now - ((now - 18.5 * 3600) % 86400)
today = [r for r in rows if r["t"] >= day_start]
spent = used - today[0]["week"] if today else 0.0
projected = spent + (rate or 0) * (day_start + 86400 - now) / 3600
sent_path = os.path.join(HERE, "marks-sent.json")
try:
    sent = json.load(open(sent_path))
except (OSError, ValueError):
    sent = {}
eta = lambda mark, used=used, rate=rate: "" if not rate or rate <= 0 or used >= mark else f", {mark}% in ~{(mark - used) / rate:.1f}h"
if not counted:
    print(f"{account}: not a factory account; nothing counted (the factory runs on {', '.join(FACTORY)})")
else:
    print(f"{account}: week {used:g}% (resets {time.strftime('%a %H:%MZ', time.gmtime(reset))}), rate {'?' if rate is None else f'{rate:.1f}'}%/h{eta(90)}{eta(98)}; today {spent:g}% spent, on pace for {projected:.0f}% (no daily cap){combined}")
drain_tail = "; nothing parks: at 100% Bravo switches the factory to the next account (#i823)"
# the logged-in account first, then each spare usage.accounts lists, each keyed by its own week reset
for who, week_used, week_reset, pct_h in [*([(account, used, reset, rate)] if counted else []), *((a, r["week"], r["weekReset"], others[a]) for a, r in spares.items() if a in FACTORY)]:
    key = f"{who}:{round(week_reset / 3600)}"
    for mark in (90, 97, 98):
        if week_used >= mark and mark not in sent.get(key, []):
            sent.setdefault(key, []).append(mark)
            print(f"ALERT {mark} {who}: week at {week_used:g}%, past {mark}%, burning {'?' if pct_h is None else f'{pct_h:.1f}'}%/h over the last hour" + {90: eta(98, week_used, pct_h), 97: eta(98, week_used, pct_h) + drain_tail, 98: drain_tail}[mark])
# no ALERT day: the owner lifted the daily cap (relayed by builder, 13 Oct 04:35Z: two memberships, and the machine allows the work); the line above still shows today's spend
five = u["rate_limits"].get("five_hour") or {}
fkey = f"5h:{account}:{round((five.get('resets_at') or 0) / 3600)}"
if counted and (five.get("used_percentage") or 0) >= 85 and fkey not in sent:
    sent[fkey] = [85]
    print(f"ALERT 5h {account}: 5-hour window at {five['used_percentage']:g}%, past 85%, resets {time.strftime('%H:%MZ', time.gmtime(five['resets_at']))}")
json.dump(sent, open(sent_path, "w"))
