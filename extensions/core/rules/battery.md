---
decisions: [i439, i542, i553]
---

The battery holds no session; only at the red mark, {battery.alert}% or under while the charge falls on battery or on a charger losing to the load, do the heavy runs wait in run-slot until the charge rises, and ops-awake's battery check alone tells the owner: an orange Inbox ask at {battery.ask}% on battery and a red alert at the red mark.
A session carries on at any battery level as it would on mains power, since the owner keeps the Mac charged; the owner picked the one hold, the heavy runs at the red mark, so the last of the charge is not spent on a suite or a build.
The battery check reads pmset each minute: the charge falls while pmset says discharging, and on AC also while it reads lower than the last check's with no charging word, a level reading keeping the last trend, since pmset gives whole percents.
At the red mark it writes the ops switch `run-slot.battery` with a 10-minute expiry, pushed on at each check while the mark holds, so it lapses only once ops-awake stops; run-slot then holds every heavy run on this Mac, a focused session's included, while the quick slot's short runs, runner-host box runs and ops' upkeep go on.
The pause lifts on the first check that sees the charge rise, a higher reading or pmset's charging word; a charge that holds level after a fall stays paused, and one that holds at the red mark with no fall seen is no red mark, so it neither alerts nor pauses.
The check posts each item at most once a fall and closes both once the charge stops falling.
Nothing else a session does, sends or posts turns on the battery level.
`packages/scripts/src/ops-awake/battery.ts` holds the check, and `battery_holds` in `scripts/ops/run-slot.sh` the hold.
