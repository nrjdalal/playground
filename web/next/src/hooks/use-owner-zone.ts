import { useQuery } from "@tanstack/react-query"

import { apiClient, unwrap } from "@/lib/api/client"

const readOwnerZone = async (): Promise<string> => {
  const { data, error } = await unwrap(
    apiClient.v1.settings[":key"].$get({ param: { key: "clock.ownerZone" }, query: {} }),
  )
  if (error) throw new Error(error.message)
  return String(data.value)
}

// The owner's zone, the clock.ownerZone setting, which every time shown to the owner reads in; undefined until read, and UTC, the setting's default, when the read is refused (no extensions login yet, as on a fixture stack).
export function useOwnerZone(): string | undefined {
  const { data, isError } = useQuery({
    queryKey: ["setting", "clock.ownerZone"],
    queryFn: readOwnerZone,
    retry: false,
  })
  return isError ? "UTC" : data
}
