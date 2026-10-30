The dispatcher fetches each meeting's transcript itself with `bun run wispr:latest`, and its words stay in the dispatcher's own session.
When the owner says a meeting is over, and on each new message from the owner, the dispatcher runs it with `--since` the end of the last meeting it read, so a meeting that ended unannounced is still picked up.
It routes the follow-ups it finds as any ask.
The transcript is private: no transcript words and no meeting title go into Slack, Linear, GitHub, Notion, a repo file or a message to another session, and a follow-up carries its task in plain words, naming a person only where the task needs one.
The script reads a clone of Wispr Flow's store and writes nothing there.
`bun run wispr:latest --help` holds the flags.
