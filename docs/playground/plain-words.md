## What it does

`plain-words` holds the two rules every text a person reads passes, ASD-STE100 and ELI5, and the owner style a message to the owner takes on top of them.
The defining constraint is its size: two rules and one style, and nothing more, so it stays the one copy that to-inbox, the pr skill, the briefs and the **talk** rule point to.

## When to reach for it

Agent-fired: a session loads it before it writes anything a person reads, and the owner can name it too.

| You are writing                                           | What it takes                                    |
| --------------------------------------------------------- | ------------------------------------------------ |
| An Inbox item, or a message to you in chat, Slack or Yard | the two rules, and the owner style, answer first |
| An issue, a PR body, a comment or a review                | the two rules, inside that text's own template   |

## The two rules and the owner style

```
rule 1    ASD-STE100: 20 words or fewer, one thing,
          an active verb, one meaning for each word
rule 2    ELI5: a newcomer can say what changed
          and what comes next, from the text alone
owner     answer first: the result in one sentence,
          then the cause, the damage, the fix, the undo
```

The owner style sits in a section of its own, so a new style pick changes that section alone and leaves the two rules as they are.

## Common questions

**Why ELI5 and not a child's voice?**
ELI5 here means a reader new to the topic, written to in an adult's voice: each technical word gets everyday words the first time it appears, and an everyday comparison sits beside a fact without replacing it.

**Where did first person and time zones go?**
They stay in [to-inbox](./to-inbox.md), as house rules for a message to you: the poster's "I", and a time in your own zone.

## It's working if

- You can say what a card or a reply is about from its first line.
- An issue comment or a review reads as clearly as a card does.
- A newcomer to a topic can follow a PR's TL;DR with no other context.

## Where it fits

The **talk** rule ([playbook](./playbook.md)) sends every session here before it writes for a person.
[to-inbox](./to-inbox.md) builds on it with the card's own shape, its picture, bullets, links, callout and choices, and [pr](./pr.md)'s TL;DR is written by its two rules.
