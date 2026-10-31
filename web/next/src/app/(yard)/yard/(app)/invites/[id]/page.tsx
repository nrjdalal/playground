import { InviteRequest } from "@/components/yard/invite-request"
import { auth } from "@/lib/auth"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, auth.api.getSession()])
  return <InviteRequest id={id} role={session?.user.role} />
}
