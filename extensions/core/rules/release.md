Ops ships `canary` to `main` on the owner's standing yes through the `release` skill, once {release.merges} user-facing merges have landed or {release.hours} hours of merging have passed, then brings the main checkout up to it.
A ship on a steady beat keeps every installed skill close to `canary` without an Inbox decision per SHA.
A ship waits while the merge lock is held or `canary`'s tip has a red check, pins the SHA it ships and stops when `canary` moves.
Ops tells the dispatcher one line before the ship and one after.
When `playground update` prints `skills changed:`, Ops sends each lead those names, and the lead has each of its live checkers load them again, since a long-lived session runs the skill text it loaded.
Done when the `release` skill's step 5 is done and each changed skill's name has reached every lead.
