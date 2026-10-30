import type { Gql } from "../linear-gql"

// linear-read: the Linear reads claim makes when its fork has no Linear tool, each one query and never a mutation.
const PERSON = "{ name email }"
const BRIEF = `identifier title url state { name type } assignee ${PERSON}`

const QUERIES = {
  issue: `query ($q: String!) { issue(id: $q) {
    ${BRIEF} description createdAt
    creator ${PERSON} team { key name } project { id name }
    parent { ${BRIEF} children(first: 50) { nodes { ${BRIEF} } } }
    children(first: 50) { nodes { ${BRIEF} } }
    relations(first: 50) { nodes { type relatedIssue { ${BRIEF} } } }
    inverseRelations(first: 50) { nodes { type issue { ${BRIEF} } } }
    comments(first: 100) { pageInfo { hasNextPage } nodes { id createdAt body url parent { id } user ${PERSON} } }
  } }`,
  project: `query ($q: String!) { project(id: $q) {
    id name url description content status { name } lead ${PERSON}
    issues(first: 250, filter: { updatedAt: { gte: "-P30D" } }) { pageInfo { hasNextPage } nodes { ${BRIEF} updatedAt } }
  } }`,
  projects: `query ($q: String!) { projects(first: 50, filter: { name: { containsIgnoreCase: $q } }) {
    nodes { id name url status { name } lead ${PERSON} }
  } }`,
  search: `query ($q: String!) { searchIssues(term: $q, first: 50, filter: { state: { type: { in: ["backlog", "unstarted", "started"] } } }) {
    nodes { ${BRIEF} description team { key name } }
  } }`,
  user: `query ($q: String!) { users(filter: { or: [{ name: { eqIgnoreCase: $q } }, { displayName: { eqIgnoreCase: $q } }, { email: { eqIgnoreCase: $q } }] }) {
    nodes { name displayName email active }
  } }`,
}

export const USAGE = `usage: linear-read <command> <arg>
  issue <ID>          a ticket with its description, people, parent, children, relations and comments
  project <id>        a project with its lead, description and the issues updated in the last 30 days
  projects <word>     the projects whose name holds the word
  search <words>      open tickets (backlog, to do, started) matching the words
  user <name|email>   a Linear user with their email`

export const read = async (gql: Gql, command: string, arg: string): Promise<unknown> => {
  if (!Object.hasOwn(QUERIES, command)) throw new Error(`unknown command ${command}`)
  return gql(QUERIES[command as keyof typeof QUERIES], { q: arg })
}
