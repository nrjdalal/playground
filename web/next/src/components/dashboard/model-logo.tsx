import type { RemixiconComponentType } from "@remixicon/react"
import { useId } from "react"

// A maker's icon as a data URI (useMakerIcon): an SVG logo as a mask over the text colour, so it stays muted as Remix's marks do, a multi-colour one flattened to it; a full-colour image, such as a Hugging Face avatar, whole with its corners rounded.
export const logoOf = ({ data, mono }: { data: string; mono: boolean }): RemixiconComponentType =>
  function ModelLogo({ color = "currentColor", size = 24, ...props }) {
    const id = useId()
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        color={color}
        {...props}
      >
        <defs>
          {mono ? (
            <mask id={id} style={{ maskType: "alpha" }}>
              <image href={data} width="24" height="24" />
            </mask>
          ) : (
            <clipPath id={id}>
              <rect width="24" height="24" rx="5" />
            </clipPath>
          )}
        </defs>
        {mono ? (
          <rect width="24" height="24" fill="currentColor" mask={`url(#${id})`} />
        ) : (
          <image href={data} width="24" height="24" clipPath={`url(#${id})`} />
        )}
      </svg>
    )
  }
