import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import * as InstanceState from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { markInstanceForDisposal } from "../lifecycle"

export const configHandlers = HttpApiBuilder.group(InstanceHttpApi, "config", (handlers) =>
  Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    const configSvc = yield* Config.Service

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return yield* configSvc.get()
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* (ctx) {
      yield* configSvc.update(ctx.payload)
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return ctx.payload
    })

    const getClientData = Effect.fn("ConfigHttpApi.getClientData")(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const key = new URL(request.url, "http://localhost").searchParams.get("key")
      const all = yield* configSvc.readClientData()
      if (key) return { [key]: all[key] ?? "" }
      return all
    })

    const updateClientData = Effect.fn("ConfigHttpApi.updateClientData")(function* (ctx) {
      const request = yield* HttpServerRequest.HttpServerRequest
      const key = new URL(request.url, "http://localhost").searchParams.get("key")
      if (key) {
        // Merge single entry
        const all = yield* configSvc.readClientData()
        const data = { ...all, [key]: ctx.payload[key] ?? "" }
        yield* configSvc.writeClientData(data)
        return { [key]: data[key] }
      }
      // Full replace
      yield* configSvc.writeClientData(ctx.payload)
      return ctx.payload
    })

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const providers = yield* providerSvc.list()
      return {
        providers: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
      }
    })

    return handlers
      .handle("get", get)
      .handle("update", update)
      .handle("getClientData", getClientData)
      .handle("updateClientData", updateClientData)
      .handle("providers", providers)
  }),
)
