import { Provider } from "@/provider/provider"
import { LLMClient } from "@opencode-ai/llm/route"
import { LLMNativeRuntime } from "@/session/llm/native-runtime"
import type { LLMEvent } from "@opencode-ai/llm"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { InstanceHttpApi } from "../api"
import type { ModelMessage } from "ai"

function errorJson(message: string, status: 400 | 500 | 502) {
  return HttpServerResponse.jsonUnsafe({ error: { message } }, { status })
}

export const queryImageHandlers = HttpApiBuilder.group(InstanceHttpApi, "query-image", (handlers) =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const llmClient = yield* LLMClient.Service

    const query = (ctx: { request: HttpServerRequest.HttpServerRequest }) =>
      Effect.catch(
        Effect.gen(function* () {
          const raw = yield* ctx.request.text
          const body: Record<string, unknown> = yield* Effect.try({
            try: () => JSON.parse(raw) as Record<string, unknown>,
            catch: () => new Error("Invalid JSON body"),
          })

          if (typeof body.image_data !== "string" || !body.image_data) {
            return errorJson("image_data is required", 400)
          }
          if (typeof body.provider !== "string" || !body.provider) {
            return errorJson("provider is required", 400)
          }
          if (typeof body.model !== "string" || !body.model) {
            return errorJson("model is required", 400)
          }

          const pid = ProviderV2.ID.make(body.provider)
          const mid = ModelV2.ID.make(body.model)
          const prompt = typeof body.prompt === "string" ? body.prompt : "Describe this image."

          const model = yield* provider.getModel(pid, mid).pipe(
            Effect.catch(() => Effect.succeed(null as unknown as Provider.Model)),
          )
          const info = yield* provider.getProvider(pid).pipe(
            Effect.catch(() => Effect.succeed(null as unknown as Provider.Info)),
          )
          if (!model || !info) {
            return errorJson(`Model not found: ${body.provider}/${body.model}`, 400)
          }

          const messages: ModelMessage[] = [{
            role: "user",
            content: [
              { type: "text" as const, text: prompt },
              { type: "image" as const, image: body.image_data },
            ],
          }]

          const abort = new AbortController()
          const result = LLMNativeRuntime.stream({
            model,
            provider: info,
            auth: undefined,
            llmClient,
            messages,
            tools: {},
            headers: {},
            abort: abort.signal,
          })
          if (result.type === "unsupported") {
            return errorJson(result.reason, 502)
          }

          const sseStream = result.stream.pipe(
            Stream.flatMap((event: LLMEvent) => {
              switch (event.type) {
                case "text-delta":
                case "reasoning-delta":
                case "finish":
                case "provider-error":
                  return Stream.make(`data: ${JSON.stringify(event)}\n\n`)
                default:
                  return Stream.empty
              }
            }),
            Stream.concat(Stream.sync(() => "data: [DONE]\n\n")),
          )

          return HttpServerResponse.stream(
            sseStream.pipe(Stream.encodeText),
            {
              contentType: "text/event-stream",
              headers: { "Cache-Control": "no-cache", Connection: "keep-alive" },
            },
          )
        }),
        () => Effect.succeed(errorJson("Internal server error", 500)),
      )

    return handlers.handleRaw("query", query)
  }),
)
