import { ChannelView } from "@/components/yard/channel-view"
import { auth } from "@/lib/auth"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, auth.api.getSession()])
  return <ChannelView id={id} role={session?.user.role} />
}
