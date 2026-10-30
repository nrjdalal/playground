import type { Gql } from "../linear-gql"

// linear-write: the Linear write the ticket skill's hand-off comment needs, one command, idempotent by the first line: a rerun whose file's first line matches a comment already on the ticket skips.
export type Comment =
  | { firstLine: string; posted: false; url: string }
  | {
      comment: { id: string; url: string }
      firstLine: string
      posted: true
    }

export const USAGE = `usage: linear-write comment <ID> <file>  post the file's contents as ticket <ID>'s comment; a ticket comment whose first line matches skips`

const firstLine = (body: string) => body.trimStart().split("\n", 1)[0]?.trimEnd() ?? ""

export const comment = async (gql: Gql, id: string, file: string): Promise<Comment> => {
  const body = await Bun.file(file).text()
  if (!body.trim()) throw new Error("the file is empty")
  const first = firstLine(body)
  const found = (await gql(
    `query ($q: String!) { issue(id: $q) { id comments(first: 100) { pageInfo { hasNextPage } nodes { body url } } } }`,
    { q: id },
  )) as {
    issue: {
      comments: { pageInfo: { hasNextPage: boolean }; nodes: { body: string; url: string }[] }
      id: string
    }
  }
  if (found.issue.comments.pageInfo.hasNextPage)
    throw new Error(
      "the ticket holds more than 100 comments, so the dedupe read is cut short; check the ticket's comments and post by hand",
    )
  const matching = found.issue.comments.nodes.find((node) => firstLine(node.body) === first)
  if (matching) return { firstLine: first, posted: false, url: matching.url }
  const created = (await gql(
    `mutation ($input: CommentCreateInput!) { commentCreate(input: $input) { comment { id url } success } }`,
    { input: { body, issueId: found.issue.id } },
  )) as { commentCreate: { comment: { id: string; url: string }; success: boolean } }
  if (!created.commentCreate.success) throw new Error("Linear refused the comment")
  return { comment: created.commentCreate.comment, firstLine: first, posted: true }
}
