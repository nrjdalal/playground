import { run } from "@/lib/dashboard/cmux"
import { isHerdrSurface, readScreen as herdrScreen } from "@/lib/dashboard/herdr"

// One session's screen, the newest `lines` rows, from whichever terminal holds it: a herdr pane (herdr:<server>:<pane id>) through herdr.ts, any other surface through cmux's read-screen.
export const readScreen = (surface: string, lines: number): Promise<string> =>
  isHerdrSurface(surface)
    ? herdrScreen(surface, lines)
    : run(["read-screen", "--surface", surface, "--lines", String(lines)])
