"use client"

import { parsePatchFiles } from "@pierre/diffs"
import { FileDiff } from "@pierre/diffs/react"
import { Component, type CSSProperties, type ReactNode, useMemo } from "react"

import { useIsMobile } from "@/hooks/use-mobile"

// Each file a patch changes, or none when the text is no patch the parser can read.
export function patchFiles(text: string) {
  try {
    return parsePatchFiles(text, undefined, true).flatMap((patch) => patch.files)
  } catch {
    return []
  }
}

// A render the package throws on shows the fallback in its place.
class Fallback extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

// A git patch as @pierre/diffs draws it: unified on a phone and split wider, its lines wrapping, in the app's mono font and dark, since the viewer is dark in either theme (viewer.tsx), as its text view is. The package draws inside its own shadow root, so the app's font reaches it through its CSS variables alone.
export default function PatchView({ fallback, text }: { fallback: ReactNode; text: string }) {
  const files = useMemo(() => patchFiles(text), [text])
  const phone = useIsMobile()
  if (files.length === 0) return fallback
  return (
    <Fallback fallback={fallback}>
      <div
        className="flex flex-col gap-4"
        data-slot="patch-view"
        style={{ "--diffs-font-family": "var(--font-mono)" } as CSSProperties}
      >
        {files.map((file, index) => (
          <FileDiff
            fileDiff={file}
            key={index}
            options={{
              diffStyle: phone ? "unified" : "split",
              overflow: "wrap",
              theme: "github-dark",
            }}
          />
        ))}
      </div>
    </Fallback>
  )
}
