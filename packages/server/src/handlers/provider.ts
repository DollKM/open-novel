import { Catalog } from "@opencode-ai/core/catalog"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { ModelV2 } from "@opencode-ai/core/model"
import { LLM, LLMClient, Message, SystemPart, ToolDefinition } from "@opencode-ai/llm"
import { Auth } from "@opencode-ai/llm/route"
import * as AnthropicMessages from "@opencode-ai/llm/protocols/anthropic-messages"
import * as OpenAICompatibleChat from "@opencode-ai/llm/protocols/openai-compatible-chat"
import * as OpenAIResponses from "@opencode-ai/llm/protocols/openai-responses"
import { Cause, Effect, Stream } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { Api } from "../api"
import { ProviderNotFoundError, ServiceUnavailableError } from "../errors"
import { response } from "../groups/location"

const catalogUnavailable = new ServiceUnavailableError({
  message: "Provider catalog is unavailable",
  service: "catalog",
})

function sseEvent(data: unknown): Sse.Event {
  return { _tag: "Event", event: "message", id: undefined, data: JSON.stringify(data) }
}

function buildModel(provider: ProviderV2.Info, model: ModelV2.Info, apiKey: string | undefined) {
  if (model.api.type !== "aisdk") throw new Error(`Model ${model.id} does not use AI SDK routing`)

  const pkg = model.api.package
  const baseURL = model.api.url

  if (pkg === "@ai-sdk/openai") {
    return OpenAIResponses.route
      .with({
        auth: apiKey ? Auth.bearer(apiKey) : Auth.none,
        endpoint: baseURL ? { baseURL } : undefined,
      })
      .model({ id: model.id, provider: provider.id })
  }
  if (pkg === "@ai-sdk/anthropic") {
    return AnthropicMessages.route
      .with({
        auth: apiKey ? Auth.header("x-api-key", apiKey) : Auth.none,
        endpoint: baseURL ? { baseURL } : undefined,
      })
      .model({ id: model.id, provider: provider.id })
  }
  if (pkg === "@ai-sdk/openai-compatible") {
    if (!baseURL) throw new Error(`Model ${model.id} requires a base URL for OpenAI-compatible routing`)
    return OpenAICompatibleChat.route
      .with({
        auth: apiKey ? Auth.bearer(apiKey) : Auth.none,
        endpoint: { baseURL },
      })
      .model({ id: model.id, provider: provider.id })
  }

  throw new Error(`Unsupported model package: ${pkg}`)
}

export const ProviderHandler = HttpApiBuilder.group(Api, "server.provider", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "provider.list",
        Effect.fn(function* () {
          const catalog = yield* Catalog.Service
          const pluginBoot = yield* PluginBoot.Service
          yield* pluginBoot.wait().pipe(Effect.catchDefect(() => Effect.fail(catalogUnavailable)))
          return yield* response(catalog.provider.available())
        }),
      )
      .handle(
        "provider.get",
        Effect.fn(function* (ctx) {
          const catalog = yield* Catalog.Service
          const pluginBoot = yield* PluginBoot.Service
          yield* pluginBoot.wait().pipe(Effect.catchDefect(() => Effect.fail(catalogUnavailable)))
          return yield* response(catalog.provider.get(ctx.params.providerID)).pipe(
            Effect.catchTag("CatalogV2.ProviderNotFound", (error) =>
              Effect.fail(
                new ProviderNotFoundError({
                  providerID: error.providerID,
                  message: `Provider not found: ${error.providerID}`,
                }),
              ),
            ),
          )
        }),
      )
      .handleRaw("provider.proxy", (ctx) => handleProviderProxy(ctx.request))
  }),
)

export function handleProviderProxy(
  request: HttpServerRequest.HttpServerRequest,
) {
  return Effect.gen(function* () {
    const raw = yield* Effect.orDie(request.text)
    const body = yield* Effect.sync(() => {
      try {
        return JSON.parse(raw) as Record<string, unknown>
      } catch { return undefined }
    })
    if (!body || typeof body.providerID !== "string" || typeof body.modelID !== "string" || !Array.isArray(body.messages))
      return yield* new ServiceUnavailableError({ message: "Invalid proxy request body" })

    const catalog = yield* Catalog.Service
    const pluginBoot = yield* PluginBoot.Service
    yield* pluginBoot.wait().pipe(Effect.catchDefect(() => Effect.void))

    const provider = yield* catalog.provider.get(body.providerID as ProviderV2.ID).pipe(
      Effect.catchTag("CatalogV2.ProviderNotFound", () =>
        Effect.fail(new ProviderNotFoundError({ providerID: body.providerID as ProviderV2.ID, message: `Provider not found: ${body.providerID}` })),
      ),
    )

    let apiKey: string | undefined
    const enabled = provider.enabled
    if (typeof enabled !== "boolean" && enabled.via === "env") {
      apiKey = process.env[enabled.name]
    }

    const modelInfo = yield* catalog.model.get(body.providerID as ProviderV2.ID, body.modelID as ModelV2.ID).pipe(
      Effect.catchTag("CatalogV2.ModelNotFound", () =>
        Effect.fail(new ServiceUnavailableError({ message: `Model ${body.modelID} not found for provider ${body.providerID}` })),
      ),
    )

    const model = yield* Effect.try({
      try: () => buildModel(provider, modelInfo, apiKey),
      catch: (error) => new ServiceUnavailableError({ message: error instanceof Error ? error.message : "Failed to build model" }),
    })

    const system = typeof body.system === "string" ? [SystemPart.make(body.system)] : []
    const messages = body.messages.map((msg: unknown) => Message.make(msg as any))

    const llmRequest = LLM.request({
      model,
      system,
      messages,
    })

    return HttpServerResponse.stream(
      LLMClient.stream(llmRequest).pipe(
        Stream.map(sseEvent),
        Stream.pipeThroughChannel(Sse.encode()),
        Stream.encodeText,
      ),
      {
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        },
      },
    )
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        const ref = `err_${crypto.randomUUID().slice(0, 8)}`
        const squashd = Cause.squash(cause)

        if (Cause.hasFails(cause) && squashd) {
          const status = squashd instanceof ProviderNotFoundError ? 404 : 503
          const tag = squashd instanceof ProviderNotFoundError ? "ProviderNotFoundError" : "ServiceUnavailableError"
          const msg = typeof squashd === "object" && squashd !== null
            ? ((squashd as any).message ?? String(squashd))
            : String(squashd)
          const body: Record<string, unknown> = { _tag: tag, message: msg }
          if (typeof squashd === "object" && squashd !== null && (squashd as any).stack) body.stack = (squashd as any).stack
          yield* Effect.logError("provider proxy fail", { ref, tag, message: msg })
          return HttpServerResponse.text(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
        }

        const message = typeof squashd === "object" && squashd !== null
          ? ((squashd as any).message ?? String(squashd))
          : typeof squashd === "string"
            ? squashd
            : "Internal error"
        const stack = typeof squashd === "object" && squashd !== null
          ? (squashd as any).stack
          : undefined
        const body: Record<string, unknown> = { _tag: "ServiceUnavailableError", message, ref }
        if (stack) body.stack = stack
        yield* Effect.logError("provider proxy defect", { ref, cause: Cause.pretty(cause) })
        return HttpServerResponse.text(JSON.stringify(body), {
          status: 503,
          headers: { "content-type": "application/json" },
        })
      }),
    ),
  )
}
