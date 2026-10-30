// Pure: whether a message is Claude Code's /login command. Typed into the app it would land on whatever prompt the session shows, so the composer keeps it and points at Add account.
export const isLoginCommand = (text: string): boolean => /^\s*\/login(\s|$)/i.test(text)

// The composer's words in its place: a login is added in the app, never typed into a session.
export const LOGIN_HINT =
  "/login is not sent. Use Add account above, then the session restarts on it."
