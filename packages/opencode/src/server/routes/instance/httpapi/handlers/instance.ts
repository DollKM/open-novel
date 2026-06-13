import path from "path"
import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import * as InstanceState from "@/effect/instance-state"
import { Format } from "@/format"
import { Global } from "@opencode-ai/core/global"
import { LSP } from "@/lsp/lsp"
import { Vcs } from "@/project/vcs"
import { Skill } from "@/skill"
import { Workflow } from "@/workflow"
import { Config } from "@/config/config"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ApiVcsApplyError } from "../groups/instance"
import { markInstanceForDisposal } from "../lifecycle"
import { ApiNotFoundError, ForbiddenError } from "../errors"

export const instanceHandlers = HttpApiBuilder.group(InstanceHttpApi, "instance", (handlers) =>
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const command = yield* Command.Service
    const format = yield* Format.Service
    const lsp = yield* LSP.Service
    const skill = yield* Skill.Service
    const vcs = yield* Vcs.Service

    const dispose = Effect.fn("InstanceHttpApi.dispose")(function* () {
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return true
    })

    const getPath = Effect.fn("InstanceHttpApi.path")(function* () {
      const ctx = yield* InstanceState.context
      return {
        home: Global.Path.home,
        state: Global.Path.state,
        config: Global.Path.config,
        worktree: ctx.worktree,
        directory: ctx.directory,
      }
    })

    const getVcs = Effect.fn("InstanceHttpApi.vcs")(function* () {
      const [branch, default_branch] = yield* Effect.all([vcs.branch(), vcs.defaultBranch()], {
        concurrency: "unbounded",
      })
      return { branch, default_branch }
    })

    const getVcsStatus = Effect.fn("InstanceHttpApi.vcsStatus")(function* () {
      return yield* vcs.status()
    })

    const getVcsDiff = Effect.fn("InstanceHttpApi.vcsDiff")(function* (ctx: {
      query: { mode: Vcs.Mode; context?: number }
    }) {
      return yield* vcs.diff(ctx.query.mode, { context: ctx.query.context })
    })

    const getVcsDiffRaw = Effect.fn("InstanceHttpApi.vcsDiffRaw")(function* () {
      return yield* vcs.diffRaw()
    })

    const applyVcs = Effect.fn("InstanceHttpApi.vcsApply")(function* (ctx: { payload: Vcs.ApplyInput }) {
      return yield* vcs.apply(ctx.payload).pipe(
        Effect.mapError(
          (error) =>
            new ApiVcsApplyError({
              name: "VcsApplyError",
              data: {
                message: error.message,
                reason: error.reason,
              },
            }),
        ),
      )
    })

    const getCommand = Effect.fn("InstanceHttpApi.command")(function* () {
      return yield* command.list()
    })

    const getAgent = Effect.fn("InstanceHttpApi.agent")(function* () {
      return yield* agent.list()
    })

    const getSkill = Effect.fn("InstanceHttpApi.skill")(function* () {
      return yield* skill.all()
    })

    const removeSkill = Effect.fn("InstanceHttpApi.deleteSkill")(function* (ctx: {
      params: { name: string }
    }) {
      return yield* skill.remove(ctx.params.name).pipe(
        Effect.mapError((error) => {
          if (error instanceof Skill.ForbiddenError)
            return new ForbiddenError({ message: error.reason === "Cannot remove a built-in skill" ? error.reason : `Cannot remove skill "${error.name}": ${error.reason}` })
          return new ApiNotFoundError({ name: "NotFoundError", data: { message: error.message } })
        }),
        Effect.as({ success: true }),
      )
    })

    const getLsp = Effect.fn("InstanceHttpApi.lsp")(function* () {
      return yield* lsp.status()
    })

    const getFormatter = Effect.fn("InstanceHttpApi.formatter")(function* () {
      return yield* format.status()
    })

    const getWorkflow = Effect.fn("InstanceHttpApi.workflow")(function* () {
      const config = yield* Config.Service
      const fs = yield* FSUtil.Service
      const dirs = yield* config.directories().pipe(Effect.catch(() => Effect.succeed([] as string[])))
      const workflows: Workflow.Info[] = []

      for (const configDir of dirs) {
        const root = path.join(configDir, "workflows")
        const exists = yield* fs.isDir(root).pipe(Effect.catch(() => Effect.succeed(false)))
        if (!exists) continue

        const files = yield* fs
          .glob("workflows/**/*.md", { cwd: configDir, absolute: true, include: "file", symlink: true })
          .pipe(Effect.catch(() => Effect.succeed([] as string[])))

        for (const filepath of files.toSorted()) {
          const content = yield* fs.readFileStringSafe(filepath).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          )
          if (!content) continue
          const info = Workflow.parseWorkflow(root, filepath, content)
          if (info) workflows.push(info)
        }
      }

      workflows.sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category)
        return a.name.localeCompare(b.name)
      })

      return workflows
    })

    const getWorkflowContent = Effect.fn("InstanceHttpApi.workflowContent")(function* (ctx: {
      query: { path: string }
    }) {
      const config = yield* Config.Service
      const fs = yield* FSUtil.Service
      const dirs = yield* config.directories().pipe(Effect.catch(() => Effect.succeed([] as string[])))

      for (const configDir of dirs) {
        const root = path.join(configDir, "workflows")
        const exists = yield* fs.isDir(root).pipe(Effect.catch(() => Effect.succeed(false)))
        if (!exists) continue

        const target = path.resolve(root, ctx.query.path + ".md")
        if (!Workflow.isSubPath(root, target)) continue

        const content = yield* fs.readFileStringSafe(target).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!content) continue

        const detail = Workflow.parseWorkflowDetail(root, target, content)
        if (detail) return detail
      }

      return yield* new ApiNotFoundError({
        name: "NotFoundError",
        data: { message: `Workflow "${ctx.query.path}" not found` },
      })
    })

    return handlers
      .handle("dispose", dispose)
      .handle("path", getPath)
      .handle("vcs", getVcs)
      .handle("vcsStatus", getVcsStatus)
      .handle("vcsDiff", getVcsDiff)
      .handle("vcsDiffRaw", getVcsDiffRaw)
      .handle("vcsApply", applyVcs)
      .handle("command", getCommand)
      .handle("agent", getAgent)
      .handle("skill", getSkill)
      .handle("skillDelete", removeSkill)
      .handle("lsp", getLsp)
      .handle("formatter", getFormatter)
      .handle("workflow", getWorkflow)
      .handle("workflowContent", getWorkflowContent)
  }),
)
