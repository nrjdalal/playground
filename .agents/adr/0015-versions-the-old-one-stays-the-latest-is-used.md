# Versions: the old one stays, the latest is used, pins are explicit

Contracts and content changed in place: a route's shape, a setting's key, an extension's item, the export's layout. A change in place breaks every reader that still expects the old one, and leaves no way back but a revert. The owner decided, while the factory was replanned for the public repository, that every update keeps the last version and the newest is used unless something says otherwise.

## Decision

A change to a contract or a piece of content takes the next version beside the old one, never an edit in place; every consumer uses the latest unless it pins one; retiring an old version is its own step, a PR or a command, never a side effect.

| Kind | Its next version | Latest by default | Retiring |
| --- | --- | --- | --- |
| API routes | `/api/v2/<name>` beside `/api/v1/<name>` when the contract breaks (a field removed, renamed or retyped, or a meaning changed); an added optional field keeps the version | the RPC client's highest version per route | a PR, once no caller has used it for 7 days |
| Extension items | a commit in its scope's folder: the revision is the commit's sha | the accepted copy, unless a pin names a sha | a commit that removes it; history keeps it |
| Settings keys | a renamed or retyped key is a new key, the old one read through as an alias | the newest key when both are set | a PR removes the alias |
| The export | each scope's git history travels with it | export writes the latest; import reads every version it knows | a PR drops a reader, never in the change that adds a writer |
| CLI commands and flags | a changed behaviour gets a new name; the old one stays an alias that prints the new one | the checkout's code | a PR removes the alias |
| DB migrations | expand, then contract: add the new column or table, backfill, move readers, then drop the old | readers move in the expand PR | the drop is a breaking change and waits for the owner's go (`db-migration` skill) |

Repo code, rules and docs keep their versions in git and its tags, never as `name.v2.md` beside `name.md`, since that puts one meaning in two places; a checkout runs one, and pinning it means checking out a tag.

A pin is a setting, `pin.<kind>.<name> = <version>`, with the reason and history every setting has, its narrowest scope winning; once pins land, `playground doctor` lists each one behind its latest.
Guards, their lists, the merge gates and the model choice take no pin: an old guard beside a new one is a hole, so they always run the latest, and the model stays an explicit setting, since a latest by default would change cost and behaviour unannounced.

## Consequences

- A reader written against an old version keeps working until a PR retires that version on purpose, so an upgrade never breaks a session mid-task.
- Every retirement is reviewable: it is a PR or a command, with its own diff and reason.
- A pin behind its latest shows in `playground doctor`, so it never outlives its reason unseen.
