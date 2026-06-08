import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/api/query-image"

export const QueryImageApi = HttpApi.make("query-image")
  .add(
    HttpApiGroup.make("query-image")
      .add(
        HttpApiEndpoint.post("query", root, {
          success: described(Schema.String, "LLM event SSE stream"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "queryImage.query",
            summary: "Send an image to a model for analysis",
            description:
              "Sends an image directly to a vision-capable model for analysis. The model response is streamed back as SSE events without injecting opencode context, skills, or tools.",
          }),
        ),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware),
  )
