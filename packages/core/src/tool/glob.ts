export * as GlobTool from "./glob"

import { ToolFailure, toolText } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { FileSystem } from "../filesystem"
import { LocationSearch } from "../location-search"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "glob"

export const Input = Schema.Struct({
  pattern: LocationSearch.FilesInput.fields.pattern.annotate({ description: "Glob pattern to match files against" }),
  path: LocationSearch.FilesInput.fields.path.annotate({
    description: "Relative directory to search. Defaults to the active Location.",
  }),
  reference: LocationSearch.FilesInput.fields.reference.annotate({
    description: "Named project reference to search instead of the active Location",
  }),
  limit: LocationSearch.FilesInput.fields.limit.annotate({
    description: `Maximum results to return (default: ${LocationSearch.DEFAULT_RESULT_LIMIT})`,
  }),
})

type ModelOutput = typeof LocationSearch.FilesResult.Encoded

/** Format raw Location search results into the concise line-oriented output models expect. */
export const toModelOutput = (output: ModelOutput) => {
  const lines = output.items.length === 0 ? ["No files found"] : output.items.map((item) => item.resource)
  if (output.truncated) {
    lines.push(
      "",
      `(Results are truncated: showing first ${output.items.length} results. Consider using a more specific path or pattern.)`,
    )
  }
  if (output.partial) lines.push("", "(Results may be incomplete because some discovered files could not be read.)")
  return lines.join("\n")
}

/**
 * Location-scoped glob leaf. FileSystem supplies canonical permission metadata;
 * LocationSearch resolves the current root and owns containment and traversal.
 *
 * TODO: Revisit root-specific search permission resources if named-reference policy needs independent allow/deny rules.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const filesystem = yield* FileSystem.Service
    const search = yield* LocationSearch.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "按名称模式匹配文件。优先使用 codegraph_files 浏览项目结构（基于 AST 索引，更快）；仅当需要按通配符匹配文件名时使用此工具。在活动 Location 或命名项目引用中按 glob 模式查找文件。返回精简的相对文件资源。使用相对路径缩小搜索范围，使用 limit 限制结果数量。",
          input: Input,
          output: LocationSearch.FilesResult,
          toModelOutput: ({ output }) => [toolText({ type: "text", text: toModelOutput(output) })],
          execute: (input, context) =>
            Effect.gen(function* () {
              const root = yield* filesystem.resolveRoot({ path: input.path, reference: input.reference })
              yield* permission.assert({
                action: name,
                resources: [input.pattern],
                save: ["*"],
                metadata: {
                  root: root.resource,
                  reference: input.reference,
                  path: input.path,
                  limit: input.limit,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              return yield* search.files(input)
            }).pipe(
              Effect.mapError(() => new ToolFailure({ message: `Unable to find files matching ${input.pattern}` })),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
