import { yardRole } from "@/app/(yard)/yard/(app)/role"
import { ChannelView } from "@/components/yard/channel-view"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, role] = await Promise.all([params, yardRole()])
  return <ChannelView id={id} role={role} />
}
