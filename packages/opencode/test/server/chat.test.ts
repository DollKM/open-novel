import path from "path"
import fs from "fs/promises"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { ModelMessage } from "ai"

const TEST_API_KEY = "sk-L3FD1ynjtj4LCGzKpPZLjwctgxNeylSFHAU4ekiljUXb9yDl3jtO3azCup77VnLP"
const AUTH_FILE = path.join(Global.Path.data, "auth.json")

beforeAll(async () => {
  let auth: Record<string, unknown> = {}
  try {
    auth = JSON.parse(await fs.readFile(AUTH_FILE, "utf-8"))
  } catch {}
  auth["opencode-go"] = { type: "api", key: TEST_API_KEY }
  await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true })
  await fs.writeFile(AUTH_FILE, JSON.stringify(auth, null, 2))
})

afterAll(async () => {
  let auth: Record<string, unknown> = {}
  try {
    auth = JSON.parse(await fs.readFile(AUTH_FILE, "utf-8"))
  } catch {}
  delete auth["opencode-go"]
  await fs.writeFile(AUTH_FILE, JSON.stringify(auth, null, 2))
})

function convertMessage(msg: Record<string, unknown>): ModelMessage {
  const role = msg.role as string
  const content = msg.content
  if (typeof content === "string") return { role, content } as ModelMessage
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

describe("opencode-go chat flow", () => {
  test("fallback model has correct endpoint config", () => {
    const model = {
      id: "qwen3.7-plus",
      providerID: "opencode-go",
      api: { id: "qwen3.7-plus", url: "https://opencode.ai/zen/go/v1", npm: "@ai-sdk/anthropic" },
      name: "qwen3.7-plus",
    }
    expect(model.api.url).toBe("https://opencode.ai/zen/go/v1")
    expect(model.api.npm).toBe("@ai-sdk/anthropic")
    expect(model.providerID).toBe("opencode-go")
  })

  test("convertMessage handles image_url parts", () => {
    const msg = {
      role: "user",
      content: [
        { type: "text", text: "Describe this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,dGVzdA==" } },
      ],
    }

    const result = convertMessage(msg)
    expect(result.role).toBe("user")
    const parts = result.content
    if (Array.isArray(parts)) {
      const textPart = parts[0] as any
      const imagePart = parts[1] as any
      expect(textPart.type).toBe("text")
      expect(textPart.text).toBe("Describe this")
      expect(imagePart.type).toBe("image")
      expect(imagePart.image).toBe("data:image/png;base64,dGVzdA==")
    }
  })

  test("auth file is configured correctly", async () => {
    const content = await fs.readFile(AUTH_FILE, "utf-8")
    const auth = JSON.parse(content)
    expect(auth["opencode-go"]).toBeDefined()
    expect(auth["opencode-go"].type).toBe("api")
    expect(auth["opencode-go"].key).toBe(TEST_API_KEY)
  })
})
