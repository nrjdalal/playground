import { cn } from "cn"

import { iconTone, statusIcon, taskIcon, type ShownState } from "@/lib/status-icons"

// A state's one icon from the one map (statusIcon), at the size-4 the sidebar's rows take, in its state's colour (iconTone). While it works or fixes, a kind with a task draws that task's icon in place of the spinner (taskIcon), as ZeroSDK's rows do. A spinner stops while the live feed is lost (still), so nothing claims work it cannot see. The state is always written beside it or in its row's hover, so the icon itself stays out of the accessibility tree.
export function StatusIcon({
  kind,
  state,
  still = false,
}: {
  kind?: string | null
  state: ShownState
  still?: boolean
}) {
  const spec = statusIcon(state)
  const Task = taskIcon(kind, state)
  const Icon = Task ?? spec.Icon
  return (
    <Icon
      aria-hidden
      className={cn(
        "size-4 shrink-0",
        iconTone(state),
        !Task && spec.spins && !still && "animate-spin",
      )}
    />
  )
}
