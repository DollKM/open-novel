import { Config } from "@/config/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Provider } from "@/provider/provider"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { described } from "./metadata"

const ClientDataQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  key: Schema.optional(Schema.String),
}).annotate({ identifier: "ClientDataQuery" })

const root = "/config"

export const ConfigApi = HttpApi.make("config")
  .add(
    HttpApiGroup.make("config")
      .add(
        HttpApiEndpoint.get("get", root, {
          query: WorkspaceRoutingQuery,
          success: described(ConfigV1.Info, "Get config info"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.get",
            summary: "Get configuration",
            description: "Retrieve the current OpenCode configuration settings and preferences.",
          }),
        ),
        HttpApiEndpoint.patch("update", root, {
          query: WorkspaceRoutingQuery,
          payload: ConfigV1.Info,
          success: described(ConfigV1.Info, "Successfully updated config"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.update",
            summary: "Update configuration",
            description: "Update OpenCode configuration settings and preferences.",
          }),
        ),
        HttpApiEndpoint.get("providers", `${root}/providers`, {
          query: WorkspaceRoutingQuery,
          success: described(Provider.ConfigProvidersResult, "List of providers"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.providers",
            summary: "List config providers",
            description: "Get a list of all configured AI providers and their default models.",
          }),
        ),
        HttpApiEndpoint.get("getClientData", `${root}/client_data`, {
          query: ClientDataQuery,
          success: described(
            Schema.Record(Schema.String, Schema.String).annotate({ identifier: "ClientData" }),
            "Client data dictionary",
          ),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.getClientData",
            summary: "Get client data",
            description:
              "Retrieve client data. Without ?key returns the full dictionary; with ?key=<id> returns { <id>: <value> }.",
          }),
        ),
        HttpApiEndpoint.put("updateClientData", `${root}/client_data`, {
          query: WorkspaceRoutingQuery,
          payload: Schema.Record(Schema.String, Schema.String).annotate({ identifier: "ClientDataPayload" }),
          success: described(
            Schema.Record(Schema.String, Schema.String).annotate({ identifier: "ClientDataResponse" }),
            "Client data dictionary",
          ),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.updateClientData",
            summary: "Update client data",
            description:
              "Update client data. Without ?key replaces the entire dictionary; with ?key=<id> merges only that entry. Does not trigger instance reload.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "config",
          description: "Experimental HttpApi config routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
