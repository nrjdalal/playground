---
decisions: [i439, i542]
---

No battery level holds or cuts work; ops-awake's battery check alone tells the owner, an orange Inbox ask at {battery.ask}% and a red alert at {battery.alert}%.
A session carries on at any battery level as it would on mains power, since the owner keeps the Mac charged and the battery is never a reason to hold work, cut load or send a message.
The battery check reads the battery each minute while the Mac discharges, posts each item at most once a discharge, and closes both again on mains power.
Nothing a session does, sends or posts turns on the battery level but those two items.
`packages/scripts/src/ops-awake/battery.ts` holds the check.
