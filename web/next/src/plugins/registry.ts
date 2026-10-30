import { features } from "@packages/config/site"

import { useChangelogUnread } from "@/plugins/changelog/unread"
import { ChangelogView } from "@/plugins/changelog/view"

// Each plugin app's view, which the aside draws beside a page (#i787) as its route's page mounts it.
export const PLUGIN_VIEWS = { changelog: ChangelogView }

// Every web plugin's hook into core, so core imports this file and never a plugin's own: deleting a plugin's folder and its lines here removes it. Each app's count of what is new there for this viewer, which the aside's app squares show beside what waits on the owner.
export function useAppUnread(enabled: boolean, background = false): (appId: string) => number {
  const changelog = useChangelogUnread(enabled && features.changelog, background)
  return (appId) => (appId === "changelog" ? changelog : 0)
}
