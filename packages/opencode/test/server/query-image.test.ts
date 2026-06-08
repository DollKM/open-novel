import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { Context } from "effect"
import * as path from "node:path"
import { tmpdir } from "../fixture/fixture"
import * as http from "node:http"
import * as Log from "@opencode-ai/core/util/log"

void Log.init({ print: false })

const fixturePath = path.join(import.meta.dir, "chat.test.json")
const handlerContext = Context.empty() as Context.Context<unknown>

function webHandler(path: string, init?: RequestInit) {
  return HttpApiApp.webHandler().handler(new Request(`http://localhost${path}`, init), handlerContext)
}

function startMockLLM(text: string): Promise<{ url: string; stop: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
        res.write(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", choices: [{ delta: { role: "assistant" }, index: 0 }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", choices: [{ delta: { content: text }, index: 0 }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", choices: [{ delta: {}, index: 0, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`)
        res.write("data: [DONE]\n\n")
        res.end()
      })
    })
    server.listen(0, () => {
      const addr = server.address()
      const port = addr && typeof addr === "object" ? addr.port : 0
      resolve({ url: `http://127.0.0.1:${port}`, stop: () => server.close() })
    })
  })
}

describe("POST /api/query-image", () => {
  test("streams image analysis from a mock LLM", async () => {
    const mock = await startMockLLM("画面に猫がいます")

    const testConfig = {
      formatter: false,
      lsp: false,
      provider: {
        openai: {
          name: "Test",
          id: "openai",
          env: [],
          npm: "@ai-sdk/openai-compatible",
          models: {
            "test-model": {
              id: "test-model",
              name: "Test Model",
              attachment: false,
              reasoning: false,
              temperature: false,
              tool_call: true,
              release_date: "2025-01-01",
              limit: { context: 100_000, output: 10_000 },
              cost: { input: 0, output: 0 },
              options: {},
            },
          },
          options: { apiKey: "test-key", baseURL: mock.url },
        },
      },
    }
    await using tmp = await tmpdir({ git: true, config: testConfig })

    const fixtureText = await Bun.file(fixturePath).text()
    const fixture = JSON.parse(fixtureText)
    const userContent = fixture.messages[1].content as Array<Record<string, unknown>>
    const imageUrl = (userContent.find((p: Record<string, unknown>) => p.type === "image_url")?.image_url as Record<string, unknown>).url as string
    const prompt = userContent.find((p: Record<string, unknown>) => p.type === "text")?.text as string

    const response = await webHandler("/api/query-image", {
      method: "POST",
      headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
      body: JSON.stringify({
        image_data: imageUrl,
        provider: "openai",
        model: "test-model",
        prompt,
      }),
    })

    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain("猫")

    mock.stop()
  })

  test("returns 400 when image_data is missing", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await webHandler("/api/query-image", {
      method: "POST",
      headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
      body: JSON.stringify({ provider: "test", model: "test-model" }),
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toHaveProperty("error")
  })

  test("returns 400 when provider is missing", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await webHandler("/api/query-image", {
      method: "POST",
      headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
      body: JSON.stringify({ image_data: "data:image/png;base64,fake", model: "test-model" }),
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toHaveProperty("error")
  })
})
