# Playground is generic, with a small core

Core holds items that only one org or one person uses, and every owner who runs Playground carries each of them. The rule came up while the owner was moving a relay tool that only one org uses out of this repo and into that org's extension, and the owner decided that Playground is generic, with a small core.

## Decision

Each item lives in the narrowest scope whose users need it, and its work is tracked where it lives.

| Scope | Holds | Its work is tracked in |
| --- | --- | --- |
| Core (this repo) | only what any owner needs | this repo's issues, the factory's own work alone |
| An org's extension | that org's skills with their scripts, rules, jobs and issues | that org's extension repo |
| A login extension | one person's own tools | that login extension |

An item moves down to the narrower scope as soon as only that scope uses it.

## Consequences

- An owner who installs Playground gets a core with no other org's or person's items in it, so core's rules and skills read true for that owner.
- A finding about an org's skill or a person's tool is filed in that extension's repo, so this repo's issues stay the factory's own and every `PG-<n>` is factory work.
- Core's items that serve one owner or one org today move out as their own lane, once an audit of core, tracked as an issue of its own, names each one.
