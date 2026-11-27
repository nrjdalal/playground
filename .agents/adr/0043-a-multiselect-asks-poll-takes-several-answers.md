# A multiSelect ask's poll takes several answers

[ADR 0029](0029-the-owners-poll-vote-answers-an-inbox-card.md) sent each card with choices as a poll of one choice, and counted a vote as the typed reply of that row's number.
The owner then asked for ask cards that take several ticked options at once (PG-3177), so a card such as "which of these gets a nudge" is one card, not one yes or no per name.
By [ADR 0015](0015-versions-the-old-one-stays-the-latest-is-used.md), this changed meaning stands beside 0029 and leaves it as written.

## Decision

- **A multiSelect ask's poll takes any number of answers.** An ask that sets `multiSelect` goes as a poll at `selectableCount` 0, WhatsApp's multiple-answers poll, and `cards.json` marks its card `multi`; every other card's poll still takes one.
- **Several numbers count as the same picks.** A reply of two or more numbers and the card's id, split by spaces or commas (`1 3 #i12`, `#i12 1, 3`), and a vote for several rows answer a multiSelect card with every one, through `bun run ask whatsapp` as one approve whose `options` name them.
  None of these stands alone: a vote or a reply that holds it beside a go row answers nothing, and one line back says so.
  A one-pick card takes one number, so several numbers answer nothing and get one line back.
- **Several numbers need the id.** A bare `1 2` stays the owner's own words to the dispatcher, as 0024 keeps a bare number while no card waits.

## Consequences

- The owner ticks the same rows in the poll as on the Inbox card, and either answers once.
- A vote that picks several rows on a one-pick card still answers nothing, as 0029 logs it.
