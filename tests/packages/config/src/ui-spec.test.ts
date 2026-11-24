import { describe, expect, test } from "bun:test"

import { uiSpec } from "../../../../packages/config/src/ui-spec"

describe("uiSpec", () => {
  test("returns a good steps and progress spec, each its own shape", () => {
    const steps = uiSpec(
      '```ui\n{"type":"steps","steps":[{"label":"Write it","status":"done"}]}\n```',
    )
    expect(steps).toEqual({
      spec: { steps: [{ label: "Write it", status: "done" }], type: "steps" },
    })

    const progress = uiSpec(
      '```ui\n{"type":"progress","items":[{"name":"Sign-in","percent":40,"on":"Login","state":"active"}]}  \n```',
    )
    expect(progress).toEqual({
      spec: {
        items: [{ name: "Sign-in", on: "Login", percent: 40, state: "active" }],
        type: "progress",
      },
    })
  })

  test("names an unknown type, an unknown prop, a percent out of range, and a status", () => {
    const type = uiSpec('```ui\n{"type":"bogus"}\n```')
    expect(type).toEqual({
      reason: 'the ui block holds an unknown type "bogus", one of progress or steps',
    })

    const stepProp = uiSpec(
      '```ui\n{"type":"steps","steps":[{"label":"Write it","status":"done","bogus":true}]}\n```',
    )
    expect(stepProp).toEqual({ reason: 'step 1 has an unknown prop "bogus"' })

    const itemProp = uiSpec(
      '```ui\n{"type":"progress","items":[{"name":"Sign-in","percent":40,"on":"Login","bogus":true}]}\n```',
    )
    expect(itemProp).toEqual({ reason: 'line 1 has an unknown prop "bogus"' })

    const percent = uiSpec(
      '```ui\n{"type":"progress","items":[{"name":"Sign-in","percent":140,"on":"Login"}]}\n```',
    )
    expect(percent).toEqual({ reason: "line 1 has a percent outside 0 to 100" })

    const status = uiSpec(
      '```ui\n{"type":"steps","steps":[{"label":"Write it","status":"nope"}]}\n```',
    )
    expect(status).toEqual({
      reason:
        'step 1 has an unknown status "nope", one of approval, done, fixing, gated, parked, ready, waiting or working',
    })
  })

  test("returns a one-line reason for a block that does not parse, and for one with no ui block", () => {
    const badJson = uiSpec("```ui\n{ not json\n```")
    expect(badJson).toEqual({
      reason: "the ui block holds no JSON, one object with a type of progress or steps",
    })
    expect(uiSpec("just prose")).toEqual({
      reason: "the ui block holds no JSON, one object with a type of progress or steps",
    })
  })
})
