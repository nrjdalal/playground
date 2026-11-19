# WhatsApp

A bundled extension: it ships in this checkout beside core, and only an owner who turns it on loads it.
It holds what Playground does on WhatsApp, your chat with the factory through a spare number linked to this Mac as a device: you text, the dispatcher answers.
Its skills go in `skills/<name>/SKILL.md` here: `whatsapp` holds WhatsApp mode, which tells a session how to answer through `playground wa send`.
The link itself is ops-wa, an ops job in `packages/scripts/src/ops-wa/` ([ADR 0023](../../.agents/adr/0023-the-owners-whatsapp-chat-is-the-owners-words.md)).

## Turning it on

Open Settings, then Extensions, and turn on **WhatsApp** under **Bundled with Playground**.
The switch adds `whatsapp` to `ext.bundled` at your login's scope (`playground settings set ext.bundled '["slack","whatsapp"]' --reason "<why>"` does the same from a terminal, keeping Slack on beside it), and that is WhatsApp mode: ops-wa hands your messages to the dispatcher only while it is on, and answers once an hour that it is off otherwise.
Sessions started after that read its skills after your own extensions and before core.

ops-wa also needs its two numbers and its job turned on: type them into the WhatsApp card's **Device number** (`wa.device`, the spare number) and **Your number** (`wa.owner`, the one it answers), each `+` and 8 to 15 digits, and Save.
A saved number shows by its last 4 digits alone, and an empty field keeps it; the spare phone then links by the pairing card the Inbox shows.

## Reactions and pace

Each message of yours the dispatcher gets shows 👀, seen with a reply coming, and turns to ✅ when it needs no reply ([ADR 0031](../../.agents/adr/0031-ops-wa-reacts-and-types-at-a-human-pace.md)).
A reply arrives after the time it takes to type it, 3 characters a second, so a long one takes up to a minute per part.

## Photos and voice notes

A photo or voice note you send is kept on this Mac in `<data>/wa/media/`, mode 600, and its path goes to the dispatcher with the photo's caption or the note's words; it stays out of the attachments folder.
Voice notes are read as text on this machine by whisper.cpp: `brew install whisper-cpp ffmpeg` (on Linux, build [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and install your distro's `ffmpeg`), then put a ggml model at `<data>/wa/whisper-model.bin` (`playground doctor` lists `whisper-cli` as optional).
Without them a voice note reaches the dispatcher as not transcribed, with its path.

The dispatcher can send you a photo, a video, a document or a voice note too: it puts the file in `<data>/wa/outbox/` and sends it with `playground wa send --file <path>`, its reply as the caption ([ADR 0036](../../.agents/adr/0036-wa-send-carries-a-file-from-the-outbox.md)); no file outside that folder goes.
It can also send a location, quote your message in its reply, and fix or take back a message it sent ([ADR 0037](../../.agents/adr/0037-wa-send-sends-a-location-a-quote-an-edit-and-a-delete.md)); for the quote, ops-wa keeps your words and the alert number's on this Mac, and a message 24 hours old is quoted no more; its words leave once the next message comes in.

## Inbox cards on WhatsApp

While WhatsApp mode is on and you have written in the last 24 hours, ops-wa sends you each open `ask` decision and update its poster scoped to the factory (`scope: "factory"`) from the Inbox once, with its choices numbered: reply `1 #i12` to pick choice 1 on #i12, and ops-wa answers it as the card's own button would, recorded as from WhatsApp ([ADR 0024](../../.agents/adr/0024-the-owners-whatsapp-answers-an-inbox-card.md)).
A card with choices also comes as a poll: tap a choice, and your vote answers the card as typing its number would; a changed vote finds the card answered already ([ADR 0029](../../.agents/adr/0029-the-owners-poll-vote-answers-an-inbox-card.md)).
Every other card stays in the Inbox, named by its title alone as `📥 <title>`, at most 5 then `📥 +N more in the Inbox`, and a title holding a term the Inbox keeps back only in that count: a card with no scope or another scope than the factory's, a secret, a delete, a budget, a ship, a schema, a ticket, a Slack message and a draft. A card is named only while it still asks, the Inbox tab's test: open, not replied, and awake.
A card that goes reads `[hidden]` for every name, handle, company term, Slack id, Linear key, email and token, and its files stay in the Inbox.

## Alerts to a second number

Set `wa.alert` to a second number, `+` and 8 to 15 digits, by approving the guard card the dispatcher posts (or `playground settings set wa.alert <number> --reason "<why>"` in your own terminal), and each urgent alert (`playground wa alert <file>`, one you must act on now) goes to you first and to it after `wa.alertDelayMinutes`, unless you react on it or its source reads handled ([ADR 0034](../../.agents/adr/0034-an-urgent-alert-reaches-the-owner-first.md)), while every other message goes by `wa send` to you alone; empty, alerts go to you alone ([ADR 0028](../../.agents/adr/0028-a-second-whatsapp-number-gets-alerts-and-is-data.md)).
You can also set it by asking for it in your own WhatsApp message that holds that number alone ([ADR 0032](../../.agents/adr/0032-the-owners-own-whatsapp-message-sets-the-second-number.md)).
An alert reaches a number once it has ever written to the spare number, since ops-wa never starts a chat; your Approve of the guard card, or your own message that sets it, counts as that number's first message, and lets the dispatcher's replies reach it at any time ([ADR 0034](../../.agents/adr/0034-an-urgent-alert-reaches-the-owner-first.md)). `playground wa status` shows whether each has written or been approved, and whether a reply can go to it now.
That number's messages reach the dispatcher as data, never as yours: they answer no card and give no order.
Its holder is a guest ([ADR 0030](../../.agents/adr/0030-the-second-whatsapp-number-is-a-guest-and-the-policy-lines-are-settings.md)): the dispatcher replies with `playground wa send --to alert <file>`, chats, gives factory status and passes a feature request on to you as an Inbox card.
What the dispatcher may answer each chat with is a policy line you set on this Mac, `wa.replyPolicy` for yours and `wa.guestPolicy` for the guest's, each a guard key whose default is factory status with no secrets or customer personal data.
