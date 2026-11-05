---
name: to-inbox
description: "Write every message the owner reads at a glance, an Inbox item or a reply in chat, Slack or Yard: a picture of the point (diff, ASCII, before and after shots, an HTML demo), emoji bullets in ASD-STE100 plain English, one callout, times in the owner's zone. Use before every `bun run ask new` and every message to the owner: an ask, a draft, an update, a work status, a relay in chat or a demo."
license: Complete terms in the repository's NOTICE
---

# to-inbox

Every message to the owner is read in seconds, an Inbox card in the aside's narrow column most of all, and the **talk** rule gives each one this skill's shape. This skill makes each message **glanceable**: the owner sees the point first, then the facts, then what Approve does. The item's shape (its picture, its bullets and its two choices, in that order), its width rule and the `bun run ask` commands live in asks.md's "The ask's shape" ([.agents/dashboard/asks.md](../../../../.agents/dashboard/asks.md)); this skill picks the picture and writes the words.

An `ask` decision renders its text as markdown, with its attachments under it: every step applies. The read-only card, an update carrying an ask's `text` and `attachments`, renders the same with no Approve or Deny: post it for something the owner only looks at (a table, a preview), and it takes every step but 6 and 9. Every other kind shows plain text, exactly as it goes out, so it takes fewer steps, step 1 always first:

- An update with no `text`, or a `ship` or `schema` decision, carries only its fields, which the card lays out itself: its title takes step 4, then steps 7 and 8.
- An `accept`, `apps`, `budget`, `delete` or `grant` decision's `why` is free text, shown as written: it takes steps 3 and 4 as plain lines, one fact each, then steps 7 and 8.
- A draft, a `slack` decision or a `ticket` decision is the message or ticket itself, so it keeps that text's own shape and takes steps 4, 7 and 8. A draft or a `slack` decision may carry `attachments`, such as an issue's before and after shots, which its card shows under the words and Send leaves out of Slack.
- A `secret` ask carries only its key and sink, which the card words itself: its title takes step 4, then step 8; the value itself is the owner's to type into the card, so it appears nowhere in the item.

Every decision and draft then takes step 9 once the owner answers; an update gets no answer, so it ends at step 8.

A message outside the Inbox, a dispatcher's reply in chat or a Slack or Yard DM, takes steps 2 to 5 and 7, since Choices and Post belong to a card alone; a relay in chat, the dispatcher passing a session's message on to the owner, is one such message, its picture and bullets the session's point in the owner's words.
In chat, step 2's picture is a fenced block (an ASCII flow or a diff; a work status block lives in its card, which chat names by its `#iN`), since no-chat-question sends a table, or three or more numbered steps, to one Inbox card instead (`scripts/hooks/README.md`).

Pick the kind by how its card closes (asks.md's `settle` and `resolve` lines): you settle a decision or a draft you decided another way, and you resolve an alert update that has fixed itself.
Every other update stays editable until the owner presses Done or Dismiss, as an ask stays editable, answered or not, until it closes, so a card you will replace (a mock's first version) or a progress you carry takes `bun run ask edit` before that.

Beside its choices, every card offers the owner five verbs (asks.md's footer line): ✓ Seen, Snooze and Archive change only his view, so your item keeps waiting and nothing is typed to you; ✓✓ Done sends an update or an answered card to Done; and Dismiss sends any card to Done, typing you `set-aside` while it still waits, so you hold only its new step, and `dismiss`, drop it, once answered.
On an update, Done types you `done` and Dismiss `dismiss`: post a new card for more, since `ask edit` refuses this one.

## Steps

1. **Already open?** Run `bun run ask open` before you write anything (asks.md). Done when no open item asks the same thing, or you have named that item's `#iN` in chat and stopped here.
2. **Picture.** Pick the one picture asks.md's shape leads with, each line within the card's width ([Fit the card](#fit-the-card)), which a `diff` block is free of, since the card wraps it. Attachments always show under the text, so an item with one keeps its text to the bullets. Done when the text's first block is that picture, or the item's first attachment is.

   Beside asks.md's diff, ASCII flow and before and after pair, two more fit:

   | The item is about                                    | Its picture                                                                               |
   | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
   | A number or a short comparison                       | a markdown table of three columns or fewer                                                |
   | A UI not yet built, or a demo                        | an ASCII sketch of the page; one `html` attachment built by [HTML.md](references/HTML.md) |
   | A code change past a few lines                       | its patch as a file, `git diff > x.diff`, which the viewer draws as a patch view          |
   | A job of several steps (a plan, a lane, a PR series) | the **work status** block, built by [PROGRESS.md](references/PROGRESS.md)                 |

   Mermaid is to render once the Inbox takes it; until then, draw the flow in ASCII.

3. **Bullets.** Write three to five of asks.md's bullets, one fact each, each led by one emoji: the legend's when one fits, else any emoji that names the fact, as asks.md's worked examples do (🧪, 🖼️). Done when no bullet holds two facts.

   | Emoji | Marks                             |
   | ----- | --------------------------------- |
   | 🐛    | the problem                       |
   | ✅    | what is done or tested            |
   | ⚠️    | a risk                            |
   | ↩️    | how to undo it                    |
   | 📨    | who asks, or where it goes        |
   | 🕐    | a clock time, in the owner's zone |
   | ⏱️    | how long it takes                 |
   | 💰    | a cost or a usage figure          |

   A decision that needs more than one answer asks them as numbered questions, the most important first, one idea each, with a one-line why only where a question could be misread.

4. **Plain words.** Write every sentence in ASD-STE100 Simplified Technical English, in the words of `GLOSSARY.md`. Done when each sentence passes all six:
   - It is 20 words or fewer.
   - It says one thing.
   - Its verb is active: "I merge the PR", never "the PR is merged".
   - It speaks in the first person singular, "I", never "we" or the session's name: the poster's "I" in an ask, the owner's in a draft or a `slack` decision, which goes out in his voice (asks.md).
   - Each word keeps one meaning across the item.
   - A time reads in the owner's zone (`clock.ownerZone`, which `playground rules clock` prints), am/pm, named by that zone ("9:30 pm UTC"); a now-time is `{now}`, which `bun run ask` fills with the time it posts at.

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

9. **Answer.** The owner's answer comes back as one line, `[inbox-answer] {json}` (asks.md): do what its `next` says, the way its `verb` names, then run its `close`. The line names its item by `ref` and carries none of its text, so when you no longer hold what you asked, as after a compaction, read the item with `bun run ask get <ref>` first. A `send` sends the message (its `text` when he changed it), a `draft` saves it with `slack_send_message_draft` and leaves it unsent, and a `pick` carrying `opened` rechecks the grant; a step the dashboard ran (`accepted`, `listed`, `opened`) whose `exitCode` is not 0 takes the follow-up asks.md names for it before the close. A reply in his own words (`re #iN`) asks for changes to the item. Done when `bun run ask get <id>` shows the item closed, or edited for his reply.

## Fit the card

Draw each code or ASCII line up to `ASK_CODE_COLUMNS` (`packages/config/src/inbox.ts`), 37 columns, an emoji counted as two.
The card shows a drawing at its 12px code size, and shrinks a wider one's font to fit, down to 10px, before it scrolls sideways, so a line of that width shows whole at 12px on the narrowest card.
A picture that runs past it becomes a table of three columns or fewer, or bullets.

## Example

An `ask` decision's text, as its card shows it to an owner whose `clock.ownerZone` is UTC, the setting's default:

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
- 🕐 I start at 10:00 pm UTC.

> [!IMPORTANT]
> I need your yes before 10:00 pm UTC.
````

Approve: `Ship canary to main at 10:00 pm UTC`; Deny: `Hold the ship until tomorrow`.

## Keep the skills learning

When an item reads badly despite these steps, or you find a format the card renders that this skill does not name, tell the `dispatcher` session: `SendMessage` to `dispatcher` with what happened, what worked, and which step it belongs in, in a few plain lines. That session turns findings into a reviewed change to the factory's repo. When `ListAgents` lists no `dispatcher` session, end your report with the finding instead, so the owner can pass it on. A finding never carries prod data, secrets or customer details.
