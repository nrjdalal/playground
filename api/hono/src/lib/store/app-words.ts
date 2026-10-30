// The settings package and `playground ext` word their refusals for the terminal, where `playground` is the way in; the app runs every step for the person, so each one it returns names the app's own step instead, with one phrasing for settings not set up yet.
export const NOT_SET_UP = "not set up yet: click Set up settings"
const WORDS: [RegExp, string][] = [
  [/, which need a login: run playground ext init$/, `, which are ${NOT_SET_UP}`],
  [
    /: move them aside, then run playground ext init$/,
    ": move them aside, then click Set up settings again",
  ],
  [
    /^no login for the extensions in .+: run playground ext init$/,
    `Your settings are ${NOT_SET_UP}`,
  ],
  [
    /\(gitleaks git <folder> --redact names it\)/,
    "(a secret scan found it; remove it from the history, then sync again)",
  ],
  [
    /^(.+) is your login's extension: playground ext init sets it up$/,
    "$1 is your login's extension: Set up settings sets it up",
  ],
  [
    /^(no extension .+?): playground ext list names them, and playground ext add adds one$/,
    "$1: the Settings page's Extensions section lists them, and Add extension adds one",
  ],
  [/^(no setting .+?); playground settings list names them$/, "$1; the Settings page lists them"],
]

// Pure: a refusal in the app's words; one that names no command comes back as it is.
export const appWords = (message: string): string =>
  WORDS.reduce((said, [shape, words]) => said.replace(shape, words), message)
