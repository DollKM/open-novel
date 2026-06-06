import { Provider } from "@/provider/provider"
import { LLMClient } from "@opencode-ai/llm/route"
import { LLMNativeRuntime } from "@/session/llm/native-runtime"
import type { LLMEvent } from "@opencode-ai/llm"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { InstanceHttpApi } from "../api"
import type { ModelMessage } from "ai"

// ── OpenAI SSE event helpers ──────────────────────────────────────────────

let chatIdCounter = 0
const chatId = () => {
  chatIdCounter++
  return `chatcmpl-${chatIdCounter.toString(36)}`
}

/** SSE event for a text/reasoning delta chunk. */
function sseChunk(
  id: string,
  delta: Record<string, unknown>,
  index = 0,
  finishReason: string | null = null,
): Sse.Event {
  const choice: Record<string, unknown> = { delta, index }
  if (finishReason) choice.finish_reason = finishReason
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify({ id, object: "chat.completion.chunk", choices: [choice] }),
  }
}

/** SSE event for the usage-annotated final chunk. */
function sseChunkWithUsage(
  id: string,
  finishReason: string,
  usage: { prompt_tokens?: number; completion_tokens?: number },
): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify({
      id,
      object: "chat.completion.chunk",
      choices: [{ delta: {}, index: 0, finish_reason: finishReason }],
      usage,
    }),
  }
}

const sseDone: Sse.Event = {
  _tag: "Event",
  event: "message",
  id: undefined,
  data: "[DONE]",
}

/** OpenAI-format JSON error response (returns plain response, not Effect). */
function chatError(message: string, type: string, status: number) {
  return HttpServerResponse.jsonUnsafe(
    { error: { message, type } },
    { status: status as 400 | 502 | 504 },
  )
}

// ── Message format conversion ─────────────────────────────────────────────

function convertMessage(msg: Record<string, unknown>): ModelMessage {
  const role = msg.role as string
  const content = msg.content

  if (typeof content === "string") {
    return { role, content } as ModelMessage
  }

  if (Array.isArray(content)) {
    const parts = content.map((part: Record<string, unknown>) => {
      if (part.type === "image_url") {
        return { type: "image" as const, image: ((part.image_url as Record<string, unknown>)?.url ?? "") as string }
      }
      return { type: "text" as const, text: String(part.text ?? "") }
    })
    return { role, content: parts } as ModelMessage
  }

  return { role, content: "" } as ModelMessage
}

// ── Handler ───────────────────────────────────────────────────────────────

type ResolveResult = { _tag: "ok"; model: import("@/provider/provider").Provider.Model; providerInfo: import("@/provider/provider").Provider.Info }
  | { _tag: "error"; response: HttpServerResponse.HttpServerResponse }

function loadContext(body: Record<string, unknown>, provider: import("@/provider/provider").Provider.Interface): Effect.Effect<ResolveResult> {
  const modelName = body.model
  if (typeof modelName !== "string") {
    return Effect.succeed({ _tag: "error" as const, response: chatError("model is required and must be a string", "invalid_request_error", 400) })
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Effect.succeed({ _tag: "error" as const, response: chatError("messages is required and must be a non-empty array", "invalid_request_error", 400) })
  }
  if (body.stream !== true) {
    return Effect.succeed({ _tag: "error" as const, response: chatError("stream must be true", "invalid_request_error", 400) })
  }

  const parts = (modelName as string).split("/")
  if (parts.length < 2) {
    return Effect.succeed({ _tag: "error" as const, response: chatError(`model must be in "providerID/modelID" format`, "invalid_request_error", 400) })
  }

  const pid = ProviderV2.ID.make(parts[0])
  const mid = ModelV2.ID.make(parts.slice(1).join("/"))

  return Effect.zip(
    provider.getModel(pid, mid).pipe(
      Effect.catch(() => Effect.succeed(null as unknown as import("@/provider/provider").Provider.Model)),
    ),
    provider.getProvider(pid).pipe(
      Effect.catch(() => Effect.succeed(null as unknown as import("@/provider/provider").Provider.Info)),
    ),
  ).pipe(
    Effect.map(([model, info]) => {
      if (!model || !info) {
        return { _tag: "error" as const, response: chatError(`Model not found: ${parts[0]}/${parts.slice(1).join("/")}`, "invalid_request_error", 400) }
      }
      return { _tag: "ok" as const, model, providerInfo: info }
    }),
  )
}

/**
 * Handle POST /chat — OpenAI-compatible streaming chat completion.
 * Does NOT inject opencode context, skills, or tools.
 */
const complete = (ctx: { request: HttpServerRequest.HttpServerRequest }) =>
  Effect.flatMap(ctx.request.text, (raw) =>
    Effect.flatMap(
      Effect.try({
        try: () => JSON.parse(raw) as Record<string, unknown>,
        catch: () => new Error("Invalid JSON body"),
      }),
      (body) =>
        Effect.flatMap(Provider.Service, (provider) =>
          Effect.flatMap(loadContext(body, provider), (resolved) => {
            if (resolved._tag === "error") return Effect.succeed(resolved.response)

            const { model, providerInfo } = resolved

            return Effect.flatMap(LLMClient.Service, (llmClient) => {
              const messages = (body.messages as Array<Record<string, unknown>>).map(convertMessage)
              const abort = new AbortController()

              const result = LLMNativeRuntime.stream({
                model,
                provider: providerInfo,
                auth: undefined,
                llmClient,
                messages,
                tools: {},
                temperature: typeof body.temperature === "number" ? body.temperature : undefined,
                topP: typeof body.top_p === "number" ? body.top_p : undefined,
                maxOutputTokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
                headers: {},
                abort: abort.signal,
              })

              if (result.type === "unsupported") {
                return Effect.succeed(chatError(result.reason, "upstream_error", 502))
              }

              const id = chatId()
              let currentFinishReason = "stop"

              const sseStream = result.stream.pipe(
                Stream.flatMap((event: LLMEvent) => {
                  switch (event.type) {
                    case "text-delta":
                      return Stream.make(sseChunk(id, { content: event.text }))
                    case "reasoning-delta":
                      return Stream.make(sseChunk(id, { reasoning_content: event.text }))
                    case "finish": {
                      currentFinishReason = event.reason ?? "stop"
                      const usage = event.usage
                      if (usage) {
                        const u: { prompt_tokens?: number; completion_tokens?: number } = {}
                        if (usage.inputTokens !== undefined) u.prompt_tokens = usage.inputTokens
                        if (usage.outputTokens !== undefined) u.completion_tokens = usage.outputTokens
                        return Stream.make(sseChunkWithUsage(id, currentFinishReason, u))
                      }
                      return Stream.empty
                    }
                    case "provider-error":
                      return Stream.make(sseChunk(id, {}, 0, "error"))
                    default:
                      return Stream.empty
                  }
                }),
                Stream.concat(Stream.sync(() => sseDone)),
              )

              return Effect.succeed(
                HttpServerResponse.stream(
                  sseStream.pipe(
                    Stream.pipeThroughChannel(Sse.encode()),
                    Stream.encodeText,
                  ),
                  {
                    contentType: "text/event-stream",
                    headers: {
                      "Cache-Control": "no-cache",
                      Connection: "keep-alive",
                    },
                  },
                ),
              )
            })
          }),
        ),
    ),
  )

export const chatHandlers = HttpApiBuilder.group(InstanceHttpApi, "chat", (handlers) =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const llmClient = yield* LLMClient.Service

    const complete = (ctx: { request: HttpServerRequest.HttpServerRequest }) =>
      Effect.catch(
        Effect.gen(function* () {
          // Read body
          const raw = yield* ctx.request.text

          // Parse JSON
          const body: Record<string, unknown> = yield* Effect.try({
            try: () => JSON.parse(raw) as Record<string, unknown>,
            catch: () => new Error("Invalid JSON body"),
          })

          // Resolve model and provider context
          const resolved = yield* loadContext(body, provider)
          if (resolved._tag === "error") return resolved.response

          const { model, providerInfo } = resolved
          const messages = (body.messages as Array<Record<string, unknown>>).map(convertMessage)
          const abort = new AbortController()

          const result = LLMNativeRuntime.stream({
            model,
            provider: providerInfo,
            auth: undefined,
            llmClient,
            messages,
            tools: {},
            temperature: typeof body.temperature === "number" ? body.temperature : undefined,
            topP: typeof body.top_p === "number" ? body.top_p : undefined,
            maxOutputTokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
            headers: {},
            abort: abort.signal,
          })

          if (result.type === "unsupported") {
            return chatError(result.reason, "upstream_error", 502)
          }

          const id = chatId()
          let currentFinishReason = "stop"

          const sseStream = result.stream.pipe(
            Stream.flatMap((event: LLMEvent) => {
              switch (event.type) {
                case "text-delta":
                  return Stream.make(sseChunk(id, { content: event.text }))
                case "reasoning-delta":
                  return Stream.make(sseChunk(id, { reasoning_content: event.text }))
                case "finish": {
                  currentFinishReason = event.reason ?? "stop"
                  const usage = event.usage
                  if (usage) {
                    const u: { prompt_tokens?: number; completion_tokens?: number } = {}
                    if (usage.inputTokens !== undefined) u.prompt_tokens = usage.inputTokens
                    if (usage.outputTokens !== undefined) u.completion_tokens = usage.outputTokens
                    return Stream.make(sseChunkWithUsage(id, currentFinishReason, u))
                  }
                  return Stream.empty
                }
                case "provider-error":
                  return Stream.make(sseChunk(id, {}, 0, "error"))
                default:
                  return Stream.empty
              }
            }),
            Stream.concat(Stream.sync(() => sseDone)),
          )

          return HttpServerResponse.stream(
            sseStream.pipe(
              Stream.pipeThroughChannel(Sse.encode()),
              Stream.encodeText,
            ),
            {
              contentType: "text/event-stream",
              headers: {
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
              },
            },
          )
        }),
        () => Effect.succeed(chatError("Internal server error", "server_error", 500)),
      )

    return handlers.handleRaw("complete", complete)
  }),
)
