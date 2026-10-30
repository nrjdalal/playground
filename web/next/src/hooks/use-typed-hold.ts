import { useEffect, useState } from "react"

import { typedHeld, TYPED_HOLD_MS } from "@/lib/outbox"

// A typed state under the hold keeps its Dismiss back, so a state the send passes through in a moment never flashes its button. The hold is read in render, so a new typedAt holds at once (an effect would flash the button for a frame first); the effect lifts it when the bound passes, since useNow ticks 30s, too slow for a second. The lift is state naming the typedAt it lifted, since the React Compiler keeps a value read in render while its inputs stand and the clock is none of them: a re-render alone kept the hold forever, and Dismiss never came. The lift re-arms its timer while the bound is still ahead, since a fire a moment early would otherwise leave Dismiss hidden until an unrelated render.
export function useTypedHold(typedAt: string | null): boolean {
  const [lifted, setLifted] = useState<string | null>(null)
  const held = lifted === typedAt || typedHeld(typedAt, Date.now())
  useEffect(() => {
    if (held) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const rest = () => TYPED_HOLD_MS - (Date.now() - Date.parse(typedAt ?? ""))
    const arm = () => {
      timer = setTimeout(() => (rest() > 0 ? arm() : setLifted(typedAt)), Math.max(0, rest()))
    }
    arm()
    return () => clearTimeout(timer)
  }, [held, typedAt])
  return held
}
