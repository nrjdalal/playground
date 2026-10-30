import type { RemixiconComponentType } from "@remixicon/react"

// Z.ai's "Z" mark, drawn here since Remix does not carry it.
export const ZaiLogo: RemixiconComponentType = ({
  color = "currentColor",
  size = 24,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 40 40"
    width={size}
    height={size}
    color={color}
    {...props}
  >
    <path
      d="M20.1312 7.50002L17.4088 11.1913H5.81625L8.5375 7.50002H20.1325H20.1312ZM34.0675 28.81L31.3475 32.5H19.795L22.5125 28.81H34.0675ZM35 7.50002L16.58 32.5H5L23.42 7.50002H35Z"
      fill="currentColor"
    />
  </svg>
)
