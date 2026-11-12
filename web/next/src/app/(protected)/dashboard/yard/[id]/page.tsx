import { ChannelView } from "@/components/yard/channel-view"

// A Yard channel or DM in the dashboard's chat pane, beside the sessions, which the owner rung alone reaches: read through the local Yard routes, or on the hosted build from the hosted API.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ChannelView id={(await params).id} role="owner" shell="dashboard" />
}
