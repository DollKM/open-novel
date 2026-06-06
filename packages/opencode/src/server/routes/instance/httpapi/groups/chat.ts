import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

const root = "/chat"

export const ChatApi = HttpApi.make("chat")
  .add(
    HttpApiGroup.make("chat")
      .add(
        // Raw body endpoint — accepts the full OpenAI chat completion JSON
        // without a typed schema, so extra fields (stop, frequency_penalty, etc.)
        // are silently ignored rather than rejected.
        HttpApiEndpoint.post("complete", root, {
          success: described(Schema.String, "Chat completion SSE stream"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chat.complete",
            summary: "Send a chat completion request directly to a model",
            description:
              "Proxies an OpenAI-compatible chat completion request directly to the configured provider model, without injecting opencode context, skills, or tools. Supports text and image inputs with streaming SSE responses.",
          }),
        ),
      ),
  )
