import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ProxyPayload } from "../../../server/src/groups/provider"

describe("provider proxy schema validation", () => {
  test("accepts valid minimal payload", () => {
    const decode = Schema.decodeUnknownSync(ProxyPayload)
    const result = decode({
      providerID: "openai",
      modelID: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    })
    expect(result.providerID).toBe("openai")
    expect(result.modelID).toBe("gpt-4o")
    expect(result.messages).toHaveLength(1)
  })

  test("rejects missing providerID", () => {
    const decode = Schema.decodeUnknownSync(ProxyPayload)
    expect(() =>
      decode({
        modelID: "gpt-4o",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).toThrow()
  })

  test("rejects missing modelID", () => {
    const decode = Schema.decodeUnknownSync(ProxyPayload)
    expect(() =>
      decode({
        providerID: "openai",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).toThrow()
  })

  test("rejects missing messages", () => {
    const decode = Schema.decodeUnknownSync(ProxyPayload)
    expect(() =>
      decode({
        providerID: "openai",
        modelID: "gpt-4o",
      }),
    ).toThrow()
  })

  test("accepts payload with all optional fields", () => {
    const decode = Schema.decodeUnknownSync(ProxyPayload)
    const result = decode({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-5",
      system: "Be concise",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "get_weather", description: "Get weather", inputSchema: { type: "object", properties: { city: { type: "string" } } } }],
      toolChoice: "auto",
      temperature: 0.7,
      maxTokens: 4096,
      topP: 1,
      topK: undefined,
      providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: 16000 } } },
      headers: { "x-custom": "test" },
    })
    expect(result.providerID).toBe("anthropic")
    expect(result.temperature).toBe(0.7)
    expect(result.maxTokens).toBe(4096)
    expect(result.tools).toHaveLength(1)
    expect(result.providerOptions).toBeDefined()
  })
})

describe("provider proxy error response shape", () => {
  test("includes stack for Error-type Fail causes", () => {
    const error = new Error("test error message")
    error.stack = "Error: test error message\n    at Test.fn (test.ts:1:1)"

    const res = JSON.parse(
      JSON.stringify({
        _tag: "ServiceUnavailableError",
        message: error.message,
        stack: error.stack,
      }),
    )
    expect(res._tag).toBe("ServiceUnavailableError")
    expect(res.message).toBe("test error message")
    expect(res.stack).toContain("Error: test error message")
  })

  test("includes ref and stack for defect (Die cause) responses", () => {
    const body = {
      _tag: "ServiceUnavailableError",
      message: "Internal error",
      ref: "err_abc12345",
      stack: "Error: something broke\n    at fn (file.ts:10:5)",
    }
    const res = JSON.parse(JSON.stringify(body))
    expect(res._tag).toBe("ServiceUnavailableError")
    expect(res.ref).toMatch(/^err_/)
    expect(res.stack).toContain("something broke")
  })

  test("omits stack when error has no stack trace", () => {
    const body = { _tag: "ServiceUnavailableError", message: "Some error", ref: "err_test" }
    const res = JSON.parse(JSON.stringify(body))
    expect(res._tag).toBe("ServiceUnavailableError")
    expect(res.ref).toBeDefined()
    expect(res.stack).toBeUndefined()
  })
})
