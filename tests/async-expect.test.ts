import { expect, test } from "bun:test"
import { join } from "node:path"

import { Glob } from "bun"
import { Node, Project, SyntaxKind } from "ts-morph"

const TESTS = import.meta.dir

// The whole expression a node starts: up its property accesses, calls and parentheses.
const chainOf = (node: Node): Node => {
  for (;;) {
    const parent = node.getParentOrThrow()
    const continues =
      ((Node.isPropertyAccessExpression(parent) || Node.isCallExpression(parent)) &&
        parent.getExpression() === node) ||
      Node.isParenthesizedExpression(parent)
    if (!continues) return node
    node = parent
  }
}

// Whether a promise-valued expression is awaited or returned: directly, as an arrow's body that is not bound to a name (returned to its caller, as a test callback is), or as the body of an arrow bound to a const whose every call is itself awaited or returned.
const settled = (node: Node): boolean => {
  const chain = chainOf(node)
  const parent = chain.getParentOrThrow()
  if (Node.isAwaitExpression(parent) || Node.isReturnStatement(parent)) return true
  if (!Node.isArrowFunction(parent) || parent.getBody() !== chain) return false
  const binding = parent.getParentOrThrow()
  const name = Node.isVariableDeclaration(binding) ? binding.getNameNode() : undefined
  if (!Node.isIdentifier(name)) return true
  return name.findReferencesAsNodes().every((ref) => {
    const call = ref.getParentOrThrow()
    return !Node.isCallExpression(call) || call.getExpression() !== ref || settled(call)
  })
}

// In bun:test an `expect(...).rejects` or `.resolves` that is neither awaited nor returned passes while checking nothing. oxlint's jest/valid-expect catches it only for a global expect, never one imported from bun:test, so this reads every test file's syntax instead.
const unawaited = (file: string, source: string): string[] => {
  const project = new Project({ useInMemoryFileSystem: true })
  return project
    .createSourceFile(file, source)
    .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
    .filter((access) => ["rejects", "resolves"].includes(access.getName()))
    .filter((access) => {
      const subject = access.getExpression()
      return Node.isCallExpression(subject) && subject.getExpression().getText() === "expect"
    })
    .filter((access) => !settled(access))
    .map((access) => `${file}:${access.getStartLineNumber()}`)
}

test("an un-awaited .rejects or .resolves is caught, a helper's included where one call drops its await, and an awaited or returned one is not", () => {
  const source = [
    'test("x", async () => {',
    '  expect(fail()).rejects.toThrow("a")',
    "  expect(ok()).resolves.toBe(1)",
    '  await expect(fail()).rejects.toThrow("a")',
    "  await expect(\n    ok(),\n  ).resolves.not.toBeNull()",
    "  const refused = () => expect(fail()).rejects.toThrow()",
    "  await refused()",
    "  const dropped = () => expect(fail()).rejects.toThrow()",
    "  dropped()",
    "  return expect(ok()).resolves.toBe(1)",
    "})",
  ].join("\n")
  expect(unawaited("sample.test.ts", source)).toEqual([
    "sample.test.ts:2",
    "sample.test.ts:3",
    "sample.test.ts:10",
  ])
})

test("every .rejects and .resolves under tests/ is awaited or returned", async () => {
  const found: string[] = []
  for await (const file of new Glob("**/*.{ts,tsx}").scan(TESTS)) {
    found.push(...unawaited(file, await Bun.file(join(TESTS, file)).text()))
  }
  expect(found).toEqual([])
}, 60_000)
