import { ChannelView } from "@/components/yard/channel-view"

// A Yard channel or DM in the dashboard's chat pane, read through the local Yard routes, which the owner rung alone reaches.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ChannelView id={(await params).id} role="owner" />
}
