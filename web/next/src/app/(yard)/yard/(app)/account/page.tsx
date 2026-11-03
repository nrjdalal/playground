import { yardRole } from "@/app/(yard)/yard/(app)/role"
import { Account } from "@/components/yard/account"

export default async function Page() {
  return <Account role={await yardRole()} />
}
