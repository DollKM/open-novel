import { Credential } from "@opencode-ai/core/credential"
import { Catalog } from "@opencode-ai/core/catalog"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import { LLM, LLMClient, Message, SystemPart, ToolDefinition } from "@opencode-ai/llm"
import { Auth } from "@opencode-ai/llm/route"
import * as AnthropicMessages from "@opencode-ai/llm/protocols/anthropic-messages"
import * as OpenAICompatibleChat from "@opencode-ai/llm/protocols/openai-compatible-chat"
import * as OpenAIResponses from "@opencode-ai/llm/protocols/openai-responses"
import { Effect, Stream, Schema } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { Api } from "../api"
import { ProxyPayload } from "../groups/provider"
import { ProviderNotFoundError, ServiceUnavailableError } from "../errors"
import { response } from "../groups/location"

const catalogUnavailable = new ServiceUnavailableError({
  message: "Provider catalog is unavailable",
  service: "catalog",
})

function sseEvent(data: unknown): Sse.Event {
  return { _tag: "Event", event: "message", id: undefined, data: JSON.stringify(data) }
}

function buildModel(provider: ProviderV2.Info, apiKey: string | undefined, modelID: string) {
  const pkg = provider.api.type === "aisdk" ? provider.api.package : undefined
  const baseURL = provider.api.type === "aisdk" ? provider.api.url : undefined

  if (pkg === "@ai-sdk/openai") {
    return OpenAIResponses.route
      .with({
        auth: apiKey ? Auth.bearer(apiKey) : Auth.none,
        endpoint: baseURL ? { baseURL } : undefined,
      })
      .model({ id: modelID, provider: provider.id })
  }
  if (pkg === "@ai-sdk/anthropic") {
    return AnthropicMessages.route
      .with({
        auth: apiKey ? Auth.header("x-api-key", apiKey) : Auth.none,
        endpoint: baseURL ? { baseURL } : undefined,
      })
      .model({ id: modelID, provider: provider.id })
  }
  if (pkg === "@ai-sdk/openai-compatible") {
    if (!baseURL) throw new Error(`Provider ${provider.id} requires a base URL for OpenAI-compatible routing`)
    return OpenAICompatibleChat.route
      .with({
        auth: apiKey ? Auth.bearer(apiKey) : Auth.none,
        endpoint: { baseURL },
      })
      .model({ id: modelID, provider: provider.id })
  }

  throw new Error(`Unsupported provider package: ${pkg ?? provider.api.type}`)
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
      .handleRaw("provider.proxy", (ctx) =>
        Effect.gen(function* () {
          const raw = yield* Effect.tryPromise({
            try: () => (ctx.request.source as Request).json(),
            catch: () => new ServiceUnavailableError({ message: "Invalid proxy request body" }),
          })
          const body = yield* Schema.decodeUnknownEffect(ProxyPayload)(raw).pipe(
            Effect.catchTag("SchemaError", () =>
              Effect.fail(new ServiceUnavailableError({ message: "Invalid proxy request body" })),
            ),
          )

          const catalog = yield* Catalog.Service
          const pluginBoot = yield* PluginBoot.Service
          yield* pluginBoot.wait().pipe(Effect.catchDefect(() => Effect.fail(catalogUnavailable)))

          const provider = yield* catalog.provider.get(body.providerID as ProviderV2.ID).pipe(
            Effect.catchTag("CatalogV2.ProviderNotFound", (error) =>
              Effect.fail(
                new ProviderNotFoundError({
                  providerID: error.providerID,
                  message: `Provider not found: ${error.providerID}`,
                }),
              ),
            ),
          )

          const enabled = provider.enabled
          let apiKey: string | undefined
          if (typeof enabled !== "boolean") {
            if (enabled.via === "env") {
              apiKey = process.env[enabled.name]
            } else if (enabled.via === "credential") {
              const credService = yield* Credential.Service
              const all = yield* credService.all()
              const stored = all.find((c) => c.id === enabled.credentialID)
              if (stored?.value.type === "key") {
                apiKey = stored.value.key
              }
            }
          }

          const model = yield* Effect.try({
            try: () => buildModel(provider, apiKey, body.modelID),
            catch: (error) =>
              new ServiceUnavailableError({
                message: error instanceof Error ? error.message : "Failed to build model",
              }),
          })

          const request = LLM.request({
            model,
            system: body.system ? [SystemPart.make(body.system)] : [],
            messages: body.messages.map((msg: unknown) => Message.make(msg as any)),
            tools: body.tools?.map((tool: unknown) => ToolDefinition.make(tool as any)),
            toolChoice: body.toolChoice as any,
            generation: {
              temperature: body.temperature,
              maxTokens: body.maxTokens,
              topP: body.topP,
              topK: body.topK,
            },
            providerOptions: body.providerOptions as any,
          })

          return HttpServerResponse.stream(
            LLMClient.stream(request).pipe(
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
        }),
      )
  }),
)
