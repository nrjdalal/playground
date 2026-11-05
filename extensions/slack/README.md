# Slack

A bundled extension: it ships in this checkout beside core, and only an owner who turns it on loads it.
It holds what Playground does in Slack, your DM with the factory: sessions post their replies there and read yours back.
Its skills go in `skills/<name>/SKILL.md` here: `slack` holds Slack mode and, in its `scripts/`, the code `playground dm send`, `playground dm upload` and ops-dm-watch run.
Those scripts read your Slack token from the Keychain item `slack`, which you save through the Inbox's secret ask.

## Turning it on

Open Settings, then Extensions, and turn on **Slack** under **Bundled with Playground**.
The switch adds `slack` to `ext.bundled` at your login's scope; `playground settings set ext.bundled '["slack"]' --reason "<why>"` does the same from a terminal.
Sessions started after that read its skills after your own extensions and before core, so a skill one of your extensions names stays yours.
While it is off, no session loads any of its skills.
