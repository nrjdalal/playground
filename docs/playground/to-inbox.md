## What it does

`to-inbox` is how a factory session writes an Inbox item so the owner reads it at a glance: a picture of the point first, then a few bullets of plain words, then what Approve does.
It holds the words and pictures alone; the item's shape, its kinds and the `playground ask` commands stay in [.agents/dashboard/asks.md](../../.agents/dashboard/asks.md), which it points at rather than copies.

The defining constraint is the card itself: it sits in the aside's narrow column and is read in seconds, so every drawing keeps within the card's width (`ASK_CODE_COLUMNS`), every sentence says one thing in ASD-STE100 Simplified Technical English, and a UI to be built goes in as a sketch, or as a page to click, never a paragraph about it.

## When to reach for it

Agent-fired: a session loads it before every `playground ask new`, and the owner can name it too.

| You are posting                              | What it leads with                             |
| -------------------------------------------- | ---------------------------------------------- |
| A decision about a code change               | a `diff` block of the lines that change        |
| A decision about a flow or a plan            | an ASCII drawing                               |
| A UI change                                  | before and after shots in one group            |
| A UI not yet built, or a demo                | an HTML page                                   |
| Something to look at, with no answer         | an update with text and files, read-only       |
| A plain update, or a ship or schema decision | its fields alone, under a plain title          |
| A delete or budget decision                  | its why as plain lines, one fact each          |
| A draft, or a Slack or ticket decision       | the message or ticket itself, in its own shape |

## The card it writes for

```
picture   diff, ASCII, shots, page
bullets   🐛 ✅ ⚠️ ↩️ 📨 🕐 ⏱️ 💰, one fact each
callout   one, only for what must not be missed
choices   Approve: <verb ...>  Deny: <verb ...>
```

Mermaid is to join the pictures; until then a flow is drawn in ASCII.

## It's working if

- You can say what an item asks, and what Approve does, before you read its second line.
- No drawing on a card shrinks or scrolls sideways.
- An item from any session reads like one from any other.

## Where it fits

Every factory session uses it under [playbook](./playbook.md)'s **ask** rule, which decides when an item goes to the owner; `to-inbox` decides how it reads.
`playground ask new` checks the shape and prints a hint when the text runs long with no list, code block or attachment, or when a drawing runs past the card's width (`ASK_CODE_COLUMNS`).
