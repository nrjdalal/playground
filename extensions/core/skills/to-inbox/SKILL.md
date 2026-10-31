---
name: to-inbox
description: "Write an Inbox item the owner reads at a glance: a picture of the point (diff, ASCII, before and after shots, an HTML demo), emoji bullets in ASD-STE100 plain English, one callout, times in IST. Use before every `bun run ask new`: an ask, a draft, an update or a demo."
license: Complete terms in the repository's NOTICE
---

# to-inbox

An Inbox card is read in seconds, in the aside's narrow column. This skill makes each item **glanceable**: the owner sees the point first, then the facts, then what Approve does. The item's shape (its picture, its bullets and its two choices, in that order), its width rule and the `bun run ask` commands live in asks.md's "The ask's shape" ([.agents/dashboard/asks.md](../../../../.agents/dashboard/asks.md)); this skill picks the picture and writes the words.

An `ask` decision renders its text as markdown, with its attachments under it: every step applies. The read-only card, an update carrying an ask's `text` and `attachments`, renders the same with no Approve or Deny: post it for something the owner only looks at (a table, a preview), and it takes every step but 6. Every other kind shows plain text, exactly as it goes out, so it takes fewer steps, step 1 always first:

- An update with no `text`, or a `ship` or `schema` decision, carries only its fields, which the card lays out itself: its title takes step 4, then steps 7 and 8.
- A `delete` or `budget` decision's `why` is free text, shown as written: it takes steps 3 and 4 as plain lines, one fact each, then steps 7 and 8.
- A draft, a `slack` decision or a `ticket` decision is the message or ticket itself, so it keeps that text's own shape and takes steps 4, 7 and 8.
- A `secret` ask carries only its key and sink, which the card words itself: its title takes step 4, then step 8; the value itself is the owner's to type into the card, so it appears nowhere in the item.

## Steps

1. **Already open?** Run `bun run ask open` before you write anything (asks.md). Done when no open item asks the same thing, or you have named that item's `#iN` in chat and stopped here.
2. **Picture.** Pick the one picture asks.md's shape leads with, within its `ASK_CODE_COLUMNS` rule. Attachments always show under the text, so an item with one keeps its text to the bullets. Done when the text's first block is that picture, or the item's first attachment is.

   Beside asks.md's diff, ASCII flow and before and after pair, two more fit:

   | The item is about              | Its picture                                                                               |
   | ------------------------------ | ----------------------------------------------------------------------------------------- |
   | A number or a short comparison | a markdown table of three columns or fewer                                                |
   | A UI not yet built, or a demo  | an ASCII sketch of the page; one `html` attachment built by [HTML.md](references/HTML.md) |

   Mermaid is to render once the Inbox takes it; until then, draw the flow in ASCII.

3. **Bullets.** Write three to five of asks.md's bullets, one fact each, each led by one emoji: the legend's when one fits, else any emoji that names the fact, as asks.md's worked examples do (🧪, 🖼️). Done when no bullet holds two facts.

   | Emoji | Marks                      |
   | ----- | -------------------------- |
   | 🐛    | the problem                |
   | ✅    | what is done or tested     |
   | ⚠️    | a risk                     |
   | ↩️    | how to undo it             |
   | 📨    | who asks, or where it goes |
   | 🕐    | a clock time, in IST       |
   | ⏱️    | how long it takes          |
   | 💰    | a cost or a usage figure   |

   A decision that needs more than one answer asks them as numbered questions, the most important first, one idea each, with a one-line why only where a question could be misread.

4. **Plain words.** Write every sentence in ASD-STE100 Simplified Technical English, in the words of `GLOSSARY.md`. Done when each sentence passes all five:
   - It is 20 words or fewer.
   - It says one thing.
   - Its verb is active: "I merge the PR", never "the PR is merged".
   - It speaks in the first person singular, "I", never "we" or the session's name: the poster's "I" in an ask, the owner's in a draft or a `slack` decision, which goes out in his voice (asks.md).
   - Each word keeps one meaning across the item, and a time reads in IST, am/pm ("9:30 pm IST").

5. **Callout.** When one fact must not be missed, put it in one GitHub callout after the bullets. Done when the item holds one callout or none.

   | Callout          | For                                       |
   | ---------------- | ----------------------------------------- |
   | `> [!CAUTION]`   | a step that cannot be undone              |
   | `> [!WARNING]`   | a risk that can be undone                 |
   | `> [!IMPORTANT]` | the one thing the owner must do or decide |
   | `> [!NOTE]`      | context the choice depends on             |
   | `> [!TIP]`       | a faster way the owner may like           |

6. **Choices.** Write asks.md's `approve` and `deny` labels in the same plain words. Done when each label starts with a verb.

7. **Fake data.** Read the text and every attachment once more. Done when no part holds a token, a customer detail or a real database row, and a demo's or screenshot's names and rows are made up.

8. **Post.** Post it with `bun run ask new`, as asks.md says, and read stderr. Done when `bun run ask` prints the item's id and no shape hint; on a hint, the item has already posted, so fix what the hint names and replace it in place with `bun run ask edit <id> < item.json`, until edit prints no hint.

## Example

An `ask` decision's text, as its card shows it:

````markdown
```
canary ──▶ main
   │
   ▼
Ops ships 3 PRs
```

- ✅ Checks pass on all 3 PRs.
- ⚠️ One PR changes the spawn gate.
- ↩️ One revert undoes the ship.
- 🕐 I start at 10:00 pm IST.

> [!IMPORTANT]
> I need your yes before 10:00 pm IST.
````

Approve: `Ship canary to main at 10:00 pm IST`; Deny: `Hold the ship until tomorrow`.

## Keep the skills learning

When an item reads badly despite these steps, or you find a format the card renders that this skill does not name, tell the `dispatcher` session: `SendMessage` to `dispatcher` with what happened, what worked, and which step it belongs in, in a few plain lines. That session turns findings into a reviewed change to the factory's repo. When `ListAgents` lists no `dispatcher` session, end your report with the finding instead, so the owner can pass it on. A finding never carries prod data, secrets or customer details.
