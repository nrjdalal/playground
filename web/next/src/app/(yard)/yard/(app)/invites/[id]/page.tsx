import { yardRole } from "@/app/(yard)/yard/(app)/role"
import { InviteRequest } from "@/components/yard/invite-request"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, role] = await Promise.all([params, yardRole()])
  return <InviteRequest id={id} role={role} />
}
