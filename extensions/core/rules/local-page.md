A page for the owner (a report, a comparison, a mock, a diagram) is a local HTML file in your scratchpad, versioned in its header and kept with `playground page`, never a claude.ai artifact or a deploy.
An artifact publishes under whichever account the session signed in with, which the owner may not reach, so the factory's settings deny the `Artifact` tool to every session.
`playground page` keeps a copy and records who made it and for whom, so it stays on both sessions' Pages tabs after the browser tab closes; your brief names the session you report to.
Every page shows its version in its header ("Version N · <date> · <kind>"), N counting its publishes from 1, and a copy made to share outside drops the label.
A page draws with inline SVG and CSS alone, a scripted diagram rendered to inline SVG first, since the Previews app's sandbox shows only those.
`playground page`'s usage line and the CLI docs page hold its flags, and `tests/scripts/factory-settings.test.ts` holds the deny.
