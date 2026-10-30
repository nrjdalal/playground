// An OTLP export shaped as Claude Code sends one, shared by the relay's tests; every value is made up.

// The login the relay sends every record under in these tests.
export const LOGIN = "dev@example.com"
export const s = (key: string, stringValue: string) => ({ key, value: { stringValue } })
export const identity = [
  s("user.email", LOGIN),
  s("user.account_uuid", "acct-1"),
  s("organization.id", "org-1"),
]
const noise = [
  s("session.id", "sess-1"),
  s("terminal.type", "cmux"),
  s("user.id", "device-1"),
  s("app.version", "2.1.300"),
]
export const point = (asDouble: number, ...attributes: ReturnType<typeof s>[]) => ({
  asDouble,
  attributes,
  startTimeUnixNano: "1791800000000000000",
  timeUnixNano: "1791800060000000000",
})
export const sum = (name: string, ...dataPoints: ReturnType<typeof point>[]) => ({
  description: "made up",
  name,
  sum: { aggregationTemporality: 1, dataPoints, isMonotonic: true },
  unit: "count",
})

// An export shaped as Claude Code sends one, with every name it can carry, plus a metric and attributes a later version might add.
export const exportBody = {
  resourceMetrics: [
    {
      resource: {
        attributes: [...identity, s("service.name", "claude-code"), s("host.name", "mac")],
      },
      scopeMetrics: [
        {
          metrics: [
            sum(
              "claude_code.cost.usage",
              point(
                0.42,
                ...identity,
                ...noise,
                s("model", "claude-opus-5-5"),
                s("skill.name", "secret-skill"),
                s("agent.name", "secret-agent"),
                s("future.name", "secret-future"),
              ),
            ),
            sum(
              "claude_code.token.usage",
              point(1200, ...identity, s("model", "claude-opus-5-5"), s("type", "input")),
              point(300, ...identity, s("model", "claude-opus-5-5"), s("type", "secret-type")),
            ),
            sum("claude_code.session.count", point(1, ...identity, ...noise)),
            sum("claude_code.tool.decision", point(1, s("tool_name", "secret-tool"))),
            sum("claude_code.future.metric", point(5, s("subagent.name", "secret-subagent"))),
            {
              gauge: { dataPoints: [point(1, s("tool_name", "secret-tool"))] },
              name: "claude_code.token.usage",
            },
          ],
          scope: { name: "com.anthropic.claude_code", version: "2.1.300" },
        },
      ],
    },
  ],
}
