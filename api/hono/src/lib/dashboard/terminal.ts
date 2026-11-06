import { isHerdrSurface, readScreen as herdrScreen } from "@/lib/dashboard/herdr"

// One session's screen, the newest `lines` rows, from its herdr pane (herdr:<server>:<pane id>) through herdr.ts; any other surface is refused.
export const readScreen = (surface: string, lines: number): Promise<string> =>
  isHerdrSurface(surface)
    ? herdrScreen(surface, lines)
    : Promise.reject(
        new Error(`${surface} is no herdr pane, and herdr is the one terminal the dashboard reads`),
      )
