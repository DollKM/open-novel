import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"
import { testEffect } from "../lib/effect"

const it = testEffect(httpApiLayer)

describe("POST /chat - opencode-go", () => {
  it.live("returns 400 for missing model", () =>
    Effect.gen(function* () {
      const response = yield* requestInDirectory("/chat", process.cwd(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
          stream: true,
        }),
      })

      expect(response.status).toBe(400)
    }),
  )
})
