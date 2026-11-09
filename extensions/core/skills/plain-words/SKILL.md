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

## Owner style: answer first

A message to the owner, an Inbox item or a reply in chat, Slack or Yard, opens with its answer line: the result or the answer, in one sentence.
The cause, the damage, the fix and the undo follow, each in short sentences by rule 1, and a picture comes after the answer line ([to-inbox](../to-inbox/SKILL.md) picks it).
Done when the message's first line is its answer, in one sentence.

A made-up fix, written answer first for an Inbox card:

```markdown
The export now returns every row: 100 before, 2,400 after, on one test file.

Cause: the export stopped at a fixed limit of 100 rows.
Damage: no row was lost, but the file left out each row past the 100th.
Fix: the limit now reads the row count.
Undo: one commit reverts the fix.
```
