## What it does

`plain-words` holds the two rules every text a person reads passes, ASD-STE100 and ELI5, and the owner style a message to the owner takes on top of them.
The defining constraint is its size: two rules and one style, and nothing more, so it stays the one copy that to-inbox, the pr skill, the briefs and the **talk** rule point to.

## When to reach for it

Agent-fired: a session loads it before it writes anything a person reads, and the owner can name it too.

| You are writing                                                      | What it takes                                     |
| -------------------------------------------------------------------- | ------------------------------------------------- |
| An ask, a read-only card, or a message to you in chat, Slack or Yard | the two rules, and the owner style, picture first |
| An issue, a PR body, a comment or a review                           | the two rules, inside that text's own template    |

## The two rules and the owner style

The rules themselves live in [the skill's file](../../extensions/core/skills/plain-words/SKILL.md) alone, so this page and every skill that names them stay right when a rule changes.
Rule 1 keeps each sentence short and single-minded, so you read it once.
Rule 2 keeps each text whole on its own, so a reader who arrives later needs no other context.
The owner style shapes what reaches you, so you see the point before the words.
It sits in a section of its own, so a new style pick changes that section alone and leaves the two rules as they are.

## Common questions

**Why ELI5 and not a child's voice?**
A child's voice talks down to its reader, and the ELI5 forum itself turns such answers away, so the skill keeps the plain words and drops the tone (rule 2 in [the skill's file](../../extensions/core/skills/plain-words/SKILL.md)).

## It's working if

- You can say what a card or a reply is about from its picture and note.
- An issue comment or a review reads as clearly as a card does.
- A newcomer to a topic can follow a PR's TL;DR with no other context.

## Where it fits

The **talk** rule ([playbook](./playbook.md)) sends every session here before it writes for a person.
[to-inbox](./to-inbox.md) builds on it with the card's own shape, its picture, bullets, links, callout and choices, and [pr](./pr.md)'s TL;DR is written by its two rules.
