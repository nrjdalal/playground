// Brand identity for this app: the single source a fork edits to rebrand. web reads it via lib/config.ts.
export const site = {
  name: "Playground",
  description: "Every Claude Code session Playground runs, live from cmux.",
  tagline: "Run a team of Claude agents",
  social: {
    discord: "",
    github: "",
    x: "",
  },
  // The owner onboarding makes (api/hono onboard router), named by the organisation's owner name; the address is made up and never mailed.
  owner: {
    email: "owner@local.host",
  },
  // Local-only dev agent identity (api/hono agents router).
  agent: {
    name: "LocalAgent",
    email: "agent@local.host",
  },
  // Injectable long-form text blocks. A product sets its own, or leaves them empty.
  apiReferenceDescription: "",
  llmsFullPreamble: "",
} as const

export type Site = typeof site

// Optional surfaces a fork enables or disables. Typed boolean (not `as const`) so a fork can flip them and the runtime gates are not dead code. Off means the routes 404 and the links, nav, sitemap, llms, and search drop the surface. The home always opens the dashboard.
export const features = {
  allowlist: false,
  apiDocs: true,
  blog: false,
  // A plugin's default (api/hono/src/plugins/switch.ts), which its env override (CHANGELOG_ENABLED) replaces when set.
  changelog: true,
  docs: true,
  internalDocs: true,
  waitlist: false,
}

export type Feature = keyof typeof features
