// The guard list that holds the owner's own apps, which no-desktop-owner-app keeps agent-desktop away from; apart from inbox.ts, since first run's checks reach it through store/extensions.ts and may load no database code.
export const OWNER_APPS = "desktop-owner-apps"
