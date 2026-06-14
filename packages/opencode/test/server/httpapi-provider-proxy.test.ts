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
