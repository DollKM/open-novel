import { describe, expect, test } from "bun:test"
import { DateTime, Effect, Layer, Option, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { Policy } from "@opencode-ai/core/policy"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { LLMClient, RequestExecutor, WebSocketExecutor } from "@opencode-ai/llm/route"
import { LocationMiddleware } from "../../../server/src/groups/location"
import { ProviderGroup, ProxyPayload } from "../../../server/src/groups/provider"
import { handleProviderProxy } from "../../../server/src/handlers/provider"
import { TestLLMServer } from "../lib/llm-server"
import { testEffect } from "../lib/effect"
import { request } from "./httpapi-layer"

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
      decode({ modelID: "gpt-4o", messages: [{ role: "user", content: "hello" }] }),
    ).toThrow()
  })

  test("rejects missing modelID", () => {
    const decode = Schema.decodeUnknownSync(ProxyPayload)
    expect(() =>
      decode({ providerID: "openai", messages: [{ role: "user", content: "hello" }] }),
    ).toThrow()
  })

  test("rejects missing messages", () => {
    const decode = Schema.decodeUnknownSync(ProxyPayload)
    expect(() => decode({ providerID: "openai", modelID: "gpt-4o" })).toThrow()
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
  test("includes stack for Error-type causes", () => {
    const error = new Error("test error message")
    error.stack = "Error: test error message\n    at Test.fn (test.ts:1:1)"
    const res = JSON.parse(JSON.stringify({ _tag: "ServiceUnavailableError", message: error.message, stack: error.stack }))
    expect(res._tag).toBe("ServiceUnavailableError")
    expect(res.message).toBe("test error message")
    expect(res.stack).toContain("Error: test error message")
  })

  test("includes ref and stack for defect responses", () => {
    const res = JSON.parse(JSON.stringify({
      _tag: "ServiceUnavailableError",
      message: "Internal error",
      ref: "err_abc12345",
      stack: "Error: something broke\n    at fn (file.ts:10:5)",
    }))
    expect(res._tag).toBe("ServiceUnavailableError")
    expect(res.ref).toMatch(/^err_/)
    expect(res.stack).toContain("something broke")
  })

  test("omits stack when none available", () => {
    const res = JSON.parse(JSON.stringify({ _tag: "ServiceUnavailableError", message: "Some error", ref: "err_test" }))
    expect(res._tag).toBe("ServiceUnavailableError")
    expect(res.ref).toBeDefined()
    expect(res.stack).toBeUndefined()
  })
})

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of({
    directory: AbsolutePath.make("."),
    workspaceID: undefined,
    project: { id: "test", name: "Test", vcs: null },
  }),
)

const credentialLayer = Layer.succeed(
  Credential.Service,
  Credential.Service.of({ all: () => Effect.succeed([]) }),
)

const catalogDeps = Catalog.layer.pipe(
  Layer.provide(PluginV2.layer),
  Layer.provide(Policy.layer),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(locationLayer),
  Layer.provide(credentialLayer),
)

const pluginBootMock = Layer.succeed(
  PluginBoot.Service,
  PluginBoot.Service.of({ wait: () => Effect.void }),
)

const ProxyApi = HttpApi.make("test-proxy").add(ProviderGroup)

const testProxyHandler = HttpApiBuilder.group(ProxyApi, "server.provider", (handlers) =>
  Effect.gen(function* () {
    return handlers.handleRaw("provider.proxy", (ctx) => handleProviderProxy(ctx.request))
  }),
)

const testApiLayer = HttpApiBuilder.layer(ProxyApi).pipe(
  Layer.provideMerge(testProxyHandler),
  Layer.provide(Layer.succeed(LocationMiddleware, LocationMiddleware.of((effect) => effect))),
)

const testServedRoutes = HttpRouter.serve(testApiLayer, {
  disableListenLog: true,
  disableLogger: true,
})

const testHttpLayer = testServedRoutes.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(TestLLMServer.layer),
  Layer.provideMerge(catalogDeps),
  Layer.provideMerge(pluginBootMock),
  Layer.provideMerge(LLMClient.layer.pipe(
    Layer.provide(Layer.mergeAll(RequestExecutor.defaultLayer, WebSocketExecutor.layer)),
  )),
)

const it = testEffect(testHttpLayer)

function setEnvScoped(key: string, value: string) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const prev = process.env[key]
      process.env[key] = value
      return prev
    }),
    (prev) =>
      Effect.sync(() => {
        if (prev === undefined) delete process.env[key]
        else process.env[key] = prev
      }),
  )
}

describe("provider proxy integration", () => {
  it.live(
    "returns SSE stream when proxying to real provider",
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      const catalog = yield* Catalog.Service

      yield* setEnvScoped("TEST_PROXY_KEY", "sk-test")

      const apply = yield* catalog.transform()
      yield* apply((editor) => {
        editor.provider.update("test-provider", (p) => {
          p.id = "test-provider"
          p.name = "Test Provider"
          p.enabled = { via: "env", name: "TEST_PROXY_KEY" }
          p.api = { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm.url }
          p.request = { headers: {}, body: {} }
        })
        editor.model.update("test-provider", "test-model", (m) => {
          m.id = "test-model"
          m.providerID = "test-provider"
          m.name = "test-model"
          m.api = { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm.url, id: "test-model" }
          m.capabilities = { tools: true, input: ["text"], output: ["text"] }
          m.request = { headers: {}, body: {}, generation: {}, options: {} }
          m.time = { released: DateTime.makeUnsafe(0) }
          m.cost = []
          m.status = "active"
          m.enabled = true
          m.limit = { context: 100_000, output: 10_000 }
        })
      })

      yield* llm.text("Hello from test LLM", { usage: { input: 10, output: 5 } })

      const response = yield* request("/api/provider/proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "test-provider",
          modelID: "test-model",
          messages: [{ role: "user", content: "Hello" }],
        }),
      })

      expect(response.status).toBe(200)
      const body = yield* response.text
      expect(body).toContain("text-delta")
      expect(body).toContain("Hello from test LLM")
    }),
    30000,
  )

  it.live(
    "returns 404 for unknown provider",
    Effect.gen(function* () {
      const response = yield* request("/api/provider/proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "nonexistent",
          modelID: "test-model",
          messages: [{ role: "user", content: "Hello" }],
        }),
      })

      expect(response.status).toBe(404)
      const body = yield* response.json
      expect(body._tag).toBe("ProviderNotFoundError")
    }),
  )

  it.live(
    "returns 503 when model not found in catalog",
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service

      const apply = yield* catalog.transform()
      yield* apply((editor) => {
        editor.provider.update("partial", (p) => {
          p.id = "partial"
          p.name = "Partial"
          p.enabled = { via: "env", name: "TEST_PROXY_KEY" }
          p.api = { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "http://localhost:9999/v1" }
          p.request = { headers: {}, body: {} }
        })
      })

      const response = yield* request("/api/provider/proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "partial",
          modelID: "missing-model",
          messages: [{ role: "user", content: "Hello" }],
        }),
      })

      expect(response.status).toBe(503)
      const body = yield* response.json
      expect(body._tag).toBe("ServiceUnavailableError")
      expect(body.message).toContain("missing-model")
    }),
  )

  it.live(
    "returns 503 for unsupported model api type",
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service

      yield* setEnvScoped("TEST_PROXY_KEY", "sk-test")

      const apply = yield* catalog.transform()
      yield* apply((editor) => {
        editor.provider.update("native-only", (p) => {
          p.id = "native-only"
          p.name = "Native Only"
          p.enabled = { via: "env", name: "TEST_PROXY_KEY" }
          p.api = { type: "native", settings: {} }
          p.request = { headers: {}, body: {} }
        })
        editor.model.update("native-only", "native-model", (m) => {
          m.id = "native-model"
          m.providerID = "native-only"
          m.name = "native-model"
          m.api = { type: "native", settings: {}, id: "native-model" }
          m.capabilities = { tools: false, input: ["text"], output: ["text"] }
          m.request = { headers: {}, body: {}, generation: {}, options: {} }
          m.time = { released: DateTime.makeUnsafe(0) }
          m.cost = []
          m.status = "active"
          m.enabled = true
          m.limit = { context: 100_000, output: 10_000 }
        })
      })

      const response = yield* request("/api/provider/proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "native-only",
          modelID: "native-model",
          messages: [{ role: "user", content: "Hello" }],
        }),
      })

      expect(response.status).toBe(503)
      const body = yield* response.json
      expect(body._tag).toBe("ServiceUnavailableError")
      expect(body.message).toContain("does not use AI SDK routing")
    }),
  )

  it.live(
    "returns 503 for invalid request body",
    Effect.gen(function* () {
      const response = yield* request("/api/provider/proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerID: "test" }),
      })

      expect(response.status).toBe(503)
      const body = yield* response.json
      expect(body._tag).toBe("ServiceUnavailableError")
      expect(body.message).toContain("Invalid proxy request body")
    }),
  )
})
