// What lays out a textarea's text, copied onto a hidden mirror so a character's place in it can be measured.
const LAYOUT = [
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRightWidth",
  "borderTopWidth",
  "boxSizing",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "tabSize",
  "textIndent",
  "textTransform",
  "width",
  "wordSpacing",
] as const

// Where the character at `index` sits in the textarea, in pixels from the box's top left as it is scrolled: a hidden copy of the box lays out the text before it, and a marker after that text takes the character's place.
export function caretPoint(box: HTMLTextAreaElement, index: number): { left: number; top: number } {
  const style = getComputedStyle(box)
  const mirror = document.createElement("div")
  for (const name of LAYOUT) mirror.style[name] = style[name]
  Object.assign(mirror.style, {
    left: "-9999px",
    overflowWrap: "break-word",
    position: "absolute",
    top: "0",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
  })
  mirror.textContent = box.value.slice(0, index)
  const marker = document.createElement("span")
  marker.textContent = box.value.slice(index) || "."
  mirror.append(marker)
  document.body.append(mirror)
  const point = { left: marker.offsetLeft - box.scrollLeft, top: marker.offsetTop - box.scrollTop }
  mirror.remove()
  return point
}
