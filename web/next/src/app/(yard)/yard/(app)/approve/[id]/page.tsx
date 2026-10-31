import { Approve } from "@/components/yard/approve"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Approve id={(await params).id} />
}
