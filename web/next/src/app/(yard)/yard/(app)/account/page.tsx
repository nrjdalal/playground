import { Account } from "@/components/yard/account"
import { auth } from "@/lib/auth"

export default async function Page() {
  const session = await auth.api.getSession()
  return <Account role={session?.user.role} />
}
