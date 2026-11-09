---
name: plain-words
description: "Write every text a person reads by two rules, ASD-STE100 and ELI5, and a message to the owner in its owner style. Use before you write an Inbox item, a chat, Slack or Yard message, an issue, a PR body, a comment or a review."
license: Complete terms in the repository's NOTICE
---

# plain-words

Every text a person reads passes two rules, ASD-STE100 and ELI5, and a message to the owner also takes the owner style below.
The **talk** rule sends every session here before it writes for a person.
An issue or a PR body keeps its own template, the [pr](../pr/SKILL.md) skill's for a PR, and takes the two rules sentence by sentence.

## Rule 1: ASD-STE100

Write every sentence in ASD-STE100 Simplified Technical English, in the words of `GLOSSARY.md`.
Done when each sentence passes all four:

- It is 20 words or fewer.
- It says one thing.
- Its verb is active: "I merge the PR", never "the PR is merged".
- Each word keeps one meaning across the text.

## Rule 2: ELI5

Write for an adult who is new to the topic, in an adult's voice.
Name each technical word in everyday words the first time it appears.
An everyday comparison can sit beside a fact, and the fact stays.
Done when a reader with no context can say, from the text alone, what changed and what comes next.

## Owner style: picture first

A message to the owner that to-inbox shapes takes the style of `mattpocock/skills`' pr skill: an ask, a read-only card, or a reply in chat, Slack or Yard.
A draft, a `slack` or a `ticket` decision keeps its own text's shape (to-inbox).
The style:

- Open on the smallest picture that makes the point ([to-inbox](../to-inbox/SKILL.md) picks it), with a short note of one sentence on the line under it.
- Give the evidence as a before and an after.
- Say how to undo it and how far it reaches, in plain words: "one revert undoes it" or "this cannot be undone", then what it touches, in a word or two.
- Give a little context in simple technical English.
- Start at the point, with no preamble.

Done when the message opens on its picture with its note under it (on its note, when to-inbox shows the picture as an attachment under the text), and a message about a change names its before and after, its undo and its reach.

A made-up fix, in this style for an Inbox card:

````markdown
```diff
- const limit = 100
+ const limit = rows.length
```

The export now returns every row.

- ✅ Before: 100 rows. After: 2,400 rows, on one test file.
- 🐛 The old code stopped at a fixed limit of 100 rows.
- ↩️ One revert undoes it.
- 🎯 It touches the export alone.
````

## Keep the skills learning

When a text reads badly despite these rules, or a reader misreads a sentence that passed them, tell the `dispatcher` session: `SendMessage` to `dispatcher` with what happened, what worked, and which rule or section it belongs in, in a few plain lines. That session turns findings into a reviewed change to the factory's repo. When `ListAgents` lists no `dispatcher` session, end your report with the finding instead, so the owner can pass it on. A finding never carries prod data, secrets or customer details.
