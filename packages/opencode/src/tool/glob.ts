import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Search } from "@opencode-ai/core/filesystem/search"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./glob.txt"
import * as Tool from "./tool"
import { Reference } from "@/reference/reference"

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "用于匹配文件的 glob 模式" }),
  path: Schema.optional(Schema.String).annotate({
    description: `要搜索的目录。如果未指定，将使用当前工作目录。重要提示：省略此字段以使用默认目录。不要输入 "undefined" 或 "null"——只需省略即可使用默认行为。如果提供，必须是有效的目录路径。`,
  }),
})

export const GlobTool = Tool.define(
  "glob",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const reference = yield* Reference.Service
    const searchSvc = yield* Search.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { pattern: string; path?: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          yield* ctx.ask({
            permission: "glob",
            patterns: [params.pattern],
            always: ["*"],
            metadata: {
              pattern: params.pattern,
              path: params.path,
            },
          })

          let search = params.path ?? ins.directory
          search = path.isAbsolute(search) ? search : path.resolve(ins.directory, search)
          yield* reference.ensure(search)
          const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (info?.type === "File") {
            throw new Error(`glob path must be a directory: ${search}`)
          }
          yield* assertExternalDirectoryEffect(ctx, search, {
            bypass: yield* reference.contains(search),
            kind: "directory",
          })

          const limit = 100
          const files = yield* searchSvc.glob({
            cwd: search,
            pattern: params.pattern,
            limit,
            signal: ctx.abort,
          })

          const output = []
          if (files.files.length === 0) output.push("No files found")
          if (files.files.length > 0) {
            output.push(...files.files)
            if (files.truncated) {
              output.push("")
              output.push(
                `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`,
              )
            }
          }

          return {
            title: path.relative(ins.worktree, search),
            metadata: {
              count: files.files.length,
              truncated: files.truncated,
            },
            output: output.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
