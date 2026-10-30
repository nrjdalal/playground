// The / menu in the composer: typing / at the start, or after a space or a new line, offers the session's skills by name, filtered as he types. Picking one puts it first in the message, since Claude Code runs a skill only when the message starts with it, and one message runs one skill.

export type SlashToken = { end: number; query: string; start: number }

// A / that starts the text or follows a space or a new line, then what is typed of a name up to the caret.
const TOKEN = /(?:^|\s)\/([a-z0-9-]*)$/
// A skill's command at the start, as deliver.ts's SKILL_COMMAND reads it (a test holds the two together), with the space or new line after it: Claude Code runs a skill only there.
export const LEADING_SKILL = /^\/[a-z0-9][a-z0-9-]*(?:[ \n]|$)/

// Pure: the command leading the text, with the space or new line after it, when it names one of the session's skills; "" for anything else, a path or a built-in such as /clear being his words.
export function leadingSkill(text: string, skills: readonly string[]): string {
  const command = LEADING_SKILL.exec(text)?.[0] ?? ""
  return skills.includes(command.trimEnd().slice(1)) ? command : ""
}

// Pure: the / being typed at the caret, or null when the caret is not at the end of one.
export function slashToken(text: string, caret: number): SlashToken | null {
  if (/^\S/.test(text.slice(caret))) return null
  const query = TOKEN.exec(text.slice(0, caret))?.[1]
  return query === undefined ? null : { end: caret, query, start: caret - query.length - 1 }
}

// Pure: the skills whose names hold what is typed, those it starts first, A to Z.
export const matchSkills = (skills: readonly string[], query: string): string[] =>
  skills
    .filter((name) => name.includes(query))
    .sort(
      (a, b) => Number(!a.startsWith(query)) - Number(!b.startsWith(query)) || a.localeCompare(b),
    )

// Pure: the text with the picked skill first and the / being typed taken out, one of the session's skills already leading it replaced; the caret stays where the / was.
export function pickSkill(
  text: string,
  token: SlashToken,
  name: string,
  skills: readonly string[],
): { caret: number; text: string } {
  const typed = text.slice(0, token.start).trimStart()
  const before = typed.slice(leadingSkill(typed, skills).length)
  // what came before the / ends in a space or a new line, so one space after it goes with the /
  const after = text.slice(token.end).replace(/^ /, "")
  const head = `/${name} `
  return before.trim()
    ? { caret: head.length + before.length, text: head + before + after }
    : { caret: head.length, text: head + after.slice(leadingSkill(after, skills).length) }
}

// A hosted session's send refuses every / until a later change reads its skills from its own system/init, so its composer offers none until then.
export const offersSkills = (worker: { hosted?: true }): boolean => !worker.hosted
