import { Effect } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const queryImageHandlers = HttpApiBuilder.group(InstanceHttpApi, "query-image", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle("query", () =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          { error: { message: "This endpoint has been deprecated. Image analysis is now handled automatically via the server subtask mechanism." } },
          { status: 410 },
        ),
      ),
    )
  }),
)
