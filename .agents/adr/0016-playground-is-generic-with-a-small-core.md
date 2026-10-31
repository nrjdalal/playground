# Playground is generic, with a small core

Core grew items only one org or one person uses, and a relay tool was the latest: only one org used it, yet it lived here, where every owner who runs Playground carries it. The owner decided, while that tool moved out to its org's extension, that Playground is generic, with a small core.

## Decision

Each item lives in the narrowest scope whose users need it, and its work is tracked where it lives.

| Scope | Holds | Its work is tracked in |
| --- | --- | --- |
| Core (this repo) | only what any owner needs | this repo's issues, the factory's own work alone |
| An org's extension | that org's skills with their scripts, rules, jobs and issues | that org's extension repo |
| A login extension | one person's own tools | that login extension |

An item moves down to the narrower scope as soon as only that scope uses it, as the relay tool did.

## Consequences

- An owner who installs Playground gets a core with no other org's or person's items in it, so core's rules and skills read true for that owner.
- A finding about an org's skill or a person's tool is filed in that extension's repo, so this repo's issues stay the factory's own and every `PG-<n>` is factory work.
- Core's items that serve one owner or one org today move out as their own lane, once an audit of core names each one.
