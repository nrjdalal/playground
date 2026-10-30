// A message an HTML page in the viewer sends its parent, as VIEWER_KEYS below writes them: Left or Right it left alone, Escape pressed in it, a link clicked in it, or its own load done.
export type ViewerFrameMessage =
  | { viewer: "edge"; direction: -1 | 1 }
  | { viewer: "escape" }
  | { viewer: "link"; href: string }
  | { viewer: "ready" }

// A link the viewer opens in a tab of its own: http or https alone, never javascript:, data: or blob:.
const webLink = (href: unknown): string | null => {
  if (typeof href !== "string") return null
  try {
    const url = new URL(href)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null
  } catch {
    return null
  }
}

// The message, or null for anything else the page might post.
export function viewerFrameMessage(data: unknown): ViewerFrameMessage | null {
  if (typeof data !== "object" || data === null || !("viewer" in data)) return null
  if (data.viewer === "escape") return { viewer: "escape" }
  if (data.viewer === "ready") return { viewer: "ready" }
  if (data.viewer === "link") {
    const href = webLink("href" in data ? data.href : null)
    return href ? { viewer: "link", href } : null
  }
  if (data.viewer !== "edge" || !("direction" in data)) return null
  return data.direction === -1 || data.direction === 1
    ? { viewer: "edge", direction: data.direction }
    : null
}

// A source file as one fenced block, its extension naming its language, so it draws as chat's code blocks do; the fence is longer than any run of backticks in the file, so none closes it early.
export const fenced = (name: string, text: string): string => {
  const language = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = "`".repeat(Math.max(3, longest + 1))
  return `${fence}${language}\n${text}\n${fence}`
}

// The script put after an HTML page's own, which sends the viewer Escape, a Left or Right the page left alone (one it did not take, typed in no field, with no sideways scroll left that way, and that changed nothing on the page by two frames on, so a deck that moves its slides without taking the key keeps it), and each link clicked that the page did not take itself, which would otherwise take the frame off the page, an SVG link's included (a link to a place on the page it scrolls to itself, since on a srcdoc page the browser would load the page again); and its own load done, which a page it was sent off to never says.
const VIEWER_KEYS = `(function(){
var send=function(m){parent.postMessage(m,"*")},changes=0,seen=0;
new MutationObserver(function(){changes++}).observe(document,{attributes:true,characterData:true,childList:true,subtree:true});
addEventListener("keydown",function(e){seen=changes;if(e.key==="Escape")send({viewer:"escape"})},true);
addEventListener("keydown",function(e){
var d=e.key==="ArrowLeft"?-1:e.key==="ArrowRight"?1:0,t=e.target,before=seen;
if(!d||e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;
if(t&&(t.isContentEditable||/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)))return;
var s=document.scrollingElement||document.documentElement;
if(d<0?s.scrollLeft>0:s.scrollLeft+s.clientWidth<s.scrollWidth)return;
requestAnimationFrame(function(){requestAnimationFrame(function(){if(changes===before)send({viewer:"edge",direction:d})})})});
addEventListener("click",function(e){
var a=e.target&&e.target.closest&&e.target.closest("a[href]"),h=a&&a.href,w=a&&a.getAttribute("href");
if(!a||e.defaultPrevented)return;
e.preventDefault();
if(w.charAt(0)==="#"){var id=w.slice(1);try{id=decodeURIComponent(id)}catch(x){}var t=id?document.getElementById(id)||document.getElementsByName(id)[0]:null;
if(t)t.scrollIntoView();else if(!id)scrollTo(0,0);return}
send({viewer:"link",href:typeof h==="string"?h:new URL(h.baseVal,document.baseURI).href})});
addEventListener("load",function(){send({viewer:"ready"})});
})()`

// What the viewer does as its frame loads a document: keeps the page that said it was ready, puts the page back once when another took its place (a script or a refresh sent it off), and stops on the second, rather than put it back on every pass.
export type FrameLoad = "keep" | "restore" | "stop"

export const frameLoad = (ready: boolean, restored: boolean): FrameLoad =>
  ready ? "keep" : restored ? "stop" : "restore"

// What an HTML page may load: its own inline script and styles, and data: images and fonts, so it fetches nothing and cannot reach the Dashboard's API. A navigation is outside a policy's reach: the viewer opens links in a tab of their own and judges each load with frameLoad. A srcdoc page gets no response header, so it carries this as a meta element ahead of its markup.
const PAGE_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"

// The page as the viewer's frame takes it: its doctype first when it opens with one, so it keeps its standards mode, then the policy, its own markup, and the keys script.
export const asViewerPage = (html: string): string => {
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? ""
  return `${doctype}<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">${html.slice(doctype.length)}\n<script>${VIEWER_KEYS}</script>`
}
