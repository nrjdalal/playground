Ops ships `canary` to `main` on the owner's standing yes through the `release` skill, once {release.merges} user-facing merges have landed or {release.hours} hours of merging have passed, then brings the main checkout up to it.
A ship on a steady beat keeps every installed skill close to `canary` without an Inbox decision per SHA.
A ship waits while the merge lock is held or the stamp on `canary`'s tip is red, pins the SHA it ships and stops when `canary` moves.
Ops tells the dispatcher one line before the ship and one after.
Done when the `release` skill's step 5 is done.
