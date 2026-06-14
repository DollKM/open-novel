import { ProviderV2 } from "@opencode-ai/core/provider"
import { Location } from "@opencode-ai/core/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ProviderNotFoundError, ServiceUnavailableError } from "../errors"
import { LocationQuery, locationQueryOpenApi, LocationMiddleware } from "./location"

export const ProxyPayload = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  system: Schema.optional(Schema.String),
  messages: Schema.Array(Schema.Unknown),
  tools: Schema.optional(Schema.Array(Schema.Unknown)),
  toolChoice: Schema.optional(Schema.String),
  temperature: Schema.optional(Schema.Number),
  maxTokens: Schema.optional(Schema.Number),
  topP: Schema.optional(Schema.Number),
  topK: Schema.optional(Schema.Number),
  providerOptions: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}).annotate({ identifier: "ProviderProxyPayload" })

export const ProviderGroup = HttpApiGroup.make("server.provider")
  .add(
    HttpApiEndpoint.get("provider.list", "/api/provider", {
      query: LocationQuery,
      success: Location.response(Schema.Array(ProviderV2.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.provider.list",
          summary: "List providers",
          description: "Retrieve active AI providers so clients can show provider availability and configuration.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("provider.get", "/api/provider/:providerID", {
      params: { providerID: ProviderV2.ID },
      query: LocationQuery,
      success: Location.response(ProviderV2.Info),
      error: [ProviderNotFoundError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.provider.get",
          summary: "Get provider",
          description: "Retrieve a single AI provider so clients can inspect its availability and endpoint settings.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("provider.proxy", "/api/provider/proxy", {
      payload: ProxyPayload,
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
      error: [ProviderNotFoundError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.provider.proxy",
        summary: "Proxy LLM request",
        description:
          "Forward a chat completion request to an AI provider using its configured credentials. The provider API key is injected server-side; the caller controls messages, model, and generation parameters.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "providers",
      description: "Experimental provider routes.",
    }),
  )
  .middleware(LocationMiddleware)
