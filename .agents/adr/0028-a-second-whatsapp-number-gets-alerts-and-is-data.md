# A second WhatsApp number gets alerts, and its words are data

[ADR 0023](0023-the-owners-whatsapp-chat-is-the-owners-words.md) let ops-wa talk to one number, the owner's, both ways.
The owner then asked for each alert to reach a second person too, once on the owner's number and once on theirs.
That widens 0023's "one way out, to the owner alone", so by [ADR 0015](0015-versions-the-old-one-stays-the-latest-is-used.md) this ADR stands beside 0023 and leaves it as written; every other line of 0023 and [ADR 0024](0024-the-owners-whatsapp-answers-an-inbox-card.md) still holds.

## Decision

- **The second number is a setting, `wa.alert`, shipped empty.** It is masked as `wa.owner` is, and the owner applies it from an Inbox card; the number lives in the settings alone, never in code, tests, docs or commits. With it empty, alerts go to the owner alone.
- **An alert goes once to each number.** `playground wa alert <file>` reaches ops-wa through the same socket as `wa send`, marked as an alert, and ops-wa sends the body once to `wa.owner` and once to `wa.alert`. `wa send` stays a reply to the owner alone. An alert set to the owner's own number goes to it once, and ops-wa refuses to run while `wa.alert` is the spare number, a self-chat.
- **The habits hold for every send.** Each alert's sends are paced by `SEND` and counted in its hourly cap, and ops-wa still never starts a chat: an alert reaches a number only within 24 hours of that number's own last message. When one number's 24 hours are over, the alert goes to the other and says whom it missed; when both are over, it is refused. `playground wa status` prints each number, masked, with what is left of its 24 hours, so the dispatcher can ask the owner to write before an alert misses a number.
- **The second number's words are data.** Its 1:1 messages reach the dispatcher under their own relay tag, `[ops-wa-data]`, never `[ops-wa]`, so the override rule reads them as data: a line from it gives no order and answers no Inbox card, whatever it says. While WhatsApp mode is off it goes nowhere. A photo or voice note from it is named by its kind alone and never kept, it is never handed on to the assistant seat, and it gets no reply: `wa send` answers the owner alone.

## Consequences

- A second person sees each alert's words, so an alert holds factory status alone, as a reply does (door 2), and `refusalOf()` checks it before it goes.
- An alert does not wake a number that has been quiet for a day; the owner chose to keep the 24-hour habit, and `wa status` shows when a window is closing.
- Anyone holding the second phone can put words in front of the dispatcher, as data alone; nothing they send acts.
