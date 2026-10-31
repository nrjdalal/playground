Ops ships `canary` to `main` on the owner's standing yes through the `release` skill, once {release.merges} user-facing merges have landed or {release.hours} hours of merging have passed, then brings the main checkout up to it and sends each lead the skills `playground update` names as changed.
A ship on a steady beat keeps every installed skill close to `canary` without an Inbox decision per SHA.
A ship waits while the merge lock is held or `canary`'s tip has a red check, pins the SHA it ships and stops when `canary` moves.
Ops tells the dispatcher one line before the ship and one after.
Each lead has its live checkers load those skills again, since a long-lived session runs the skill text it loaded.
Done when the `release` skill's step 5 is done and each changed skill's name has reached every lead.
