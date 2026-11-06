import { useQuery } from "@tanstack/react-query"

import { config } from "@/lib/config"
import { type YardWrites, yardWrites } from "@/lib/relay"
import { BROWSER_KEY, readBrowserKey } from "@/lib/remote-key"

// The writes this page offers (yardWrites), and ready once the hosted build has read whether this browser keeps a paired key; a key it cannot read counts as none.
export function useYardWrites(): YardWrites & { ready: boolean } {
  const { data, isPending } = useQuery({
    enabled: config.hosted,
    queryFn: readBrowserKey,
    queryKey: BROWSER_KEY,
    retry: false,
  })
  return {
    ...yardWrites({ hosted: config.hosted, paired: Boolean(data) }),
    ready: !config.hosted || !isPending,
  }
}
