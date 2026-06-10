export * as GrepTool from "./grep"

import { ToolFailure, toolText } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { FileSystem } from "../filesystem"
import { LocationSearch } from "../location-search"
import { Ripgrep } from "../ripgrep"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "grep"

export const Input = Schema.Struct({
  pattern: LocationSearch.GrepInput.fields.pattern.annotate({
    description: "Regex pattern to search for in file contents",
  }),
  path: LocationSearch.GrepInput.fields.path.annotate({
    description: "Relative file or directory to search. Defaults to the active Location.",
  }),
  reference: LocationSearch.GrepInput.fields.reference.annotate({
    description: "Named project reference to search instead of the active Location",
  }),
  include: LocationSearch.GrepInput.fields.include.annotate({
    description: 'File glob to include in the search (for example, "*.js" or "*.{ts,tsx}")',
  }),
  limit: LocationSearch.GrepInput.fields.limit.annotate({
    description: `Maximum matches to return (default: ${LocationSearch.DEFAULT_RESULT_LIMIT})`,
  }),
})

type Output = typeof LocationSearch.GrepResult.Encoded

/** Format raw Location search matches into the familiar concise model output. */
export const toModelOutput = (output: Output) => {
  const lines = output.items.length === 0 ? ["No files found"] : [`Found ${output.items.length} matches`]
  let current = ""
  for (const match of output.items) {
    if (current !== match.resource) {
      if (current) lines.push("")
      current = match.resource
      lines.push(`${match.resource}:`)
    }
    lines.push(`  Line ${match.line}: ${match.lines}${match.linePreviewTruncated ? "..." : ""}`)
  }
  if (output.truncated) {
    lines.push(
      "",
      `(Results are truncated: showing first ${output.items.length} matches. Consider using a more specific path or pattern.)`,
    )
  }
  if (output.partial) lines.push("", "(Some paths were inaccessible and skipped)")
  return lines.join("\n")
}

/**
 * Location-scoped grep leaf. FileSystem supplies canonical permission metadata;
 * LocationSearch resolves the current root and owns containment and ripgrep execution.
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
            "全文搜索工具。优先使用 codegraph_* 工具进行结构化代码搜索（更精准、更快）；仅当需要搜索字面文本（注释、字符串、日志）或 codegraph 无结果时使用此工具。在活动 Location、命名项目引用或绝对托管工具输出文件中按正则表达式搜索文件内容。使用路径缩小搜索范围，使用 include 按 glob 过滤文件，使用 limit 限制匹配数量。返回精简的文件资源、行号和有限的行预览。",
          input: Input,
          output: LocationSearch.GrepResult,
          toModelOutput: ({ output }) => [toolText({ type: "text", text: toModelOutput(output) })],
          execute: (input, context) =>
            Effect.gen(function* () {
              const root = yield* filesystem.resolveRoot(input)
              yield* permission.assert({
                action: name,
                resources: [input.pattern],
                save: ["*"],
                metadata: {
                  root: root.resource,
                  reference: input.reference,
                  path: input.path,
                  include: input.include,
                  limit: input.limit,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              return yield* search.grep(input)
            }).pipe(
              Effect.mapError((error) => {
                const message =
                  error instanceof Ripgrep.InvalidPatternError
                    ? `Invalid grep pattern ${JSON.stringify(input.pattern)}: ${error.message}`
                    : `Unable to grep for ${input.pattern}`
                return new ToolFailure({ message })
              }),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
