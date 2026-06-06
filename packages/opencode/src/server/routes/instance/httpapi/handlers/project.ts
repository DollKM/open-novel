import { Git } from "@/git"
import * as InstanceState from "@/effect/instance-state"
import { Installation } from "@/installation"
import { Project } from "@/project/project"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import * as Log from "@opencode-ai/core/util/log"
import { Cause, Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProjectNotFoundError } from "../errors"
import { markInstanceForReload } from "../lifecycle"

const log = Log.create({ service: "server" })

export const projectHandlers = HttpApiBuilder.group(InstanceHttpApi, "project", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Project.Service
    const project = yield* ProjectV2.Service

    const list = Effect.fn("ProjectHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const current = Effect.fn("ProjectHttpApi.current")(function* () {
      return (yield* InstanceState.context).project
    })

    const initGit = Effect.fn("ProjectHttpApi.initGit")(function* () {
      const ctx = yield* InstanceState.context
      const next = yield* svc.initGit({ directory: ctx.directory, project: ctx.project })
      if (next.id === ctx.project.id && next.vcs === ctx.project.vcs && next.worktree === ctx.project.worktree)
        return next
      yield* markInstanceForReload(ctx, {
        directory: ctx.directory,
        worktree: ctx.directory,
        project: next,
      })
      return next
    })

    const update = Effect.fn("ProjectHttpApi.update")(function* (ctx: {
      params: { projectID: ProjectV2.ID }
      payload: Project.UpdatePayload
    }) {
      return yield* svc.update({ ...ctx.payload, projectID: ctx.params.projectID }).pipe(
        Effect.catchTag("Project.NotFoundError", (error) =>
          Effect.fail(
            new ProjectNotFoundError({
              projectID: error.projectID,
              message: `Project not found: ${error.projectID}`,
            }),
          ),
        ),
      )
    })

    const directories = Effect.fn("ProjectHttpApi.directories")((ctx: { params: { projectID: ProjectV2.ID } }) =>
      project.directories({ projectID: ctx.params.projectID }),
    )

    const remove = Effect.fn("ProjectHttpApi.remove")(function* () {
      // If the directory query param is a known project ID, delete directly
      const request = yield* HttpServerRequest.HttpServerRequest
      const rawID = new URL(request.url, "http://localhost").searchParams.get("directory")
      if (rawID) {
        const existing = yield* svc.get(ProjectV2.ID.make(rawID))
        if (existing) {
          return yield* svc.delete(existing.id).pipe(
            Effect.catchTag("Project.NotFoundError", (error) =>
              Effect.fail(
                new ProjectNotFoundError({
                  projectID: error.projectID,
                  message: `Project not found: ${error.projectID}`,
                }),
              ),
            ),
            Effect.as(true),
          )
        }
      }
      // Fallback: resolve project from instance context directory
      const ctx = yield* InstanceState.context
      const resolved = yield* project.resolve(AbsolutePath.make(ctx.directory))
      if (resolved.id === ProjectV2.ID.global)
        return yield* Effect.fail(
          new ProjectNotFoundError({ projectID: resolved.id, message: "Cannot delete the global project" }),
        )
      return yield* svc.delete(resolved.id).pipe(
        Effect.catchTag("Project.NotFoundError", (error) =>
          Effect.fail(
            new ProjectNotFoundError({
              projectID: error.projectID,
              message: `Project not found: ${error.projectID}`,
            }),
          ),
        ),
        Effect.as(true),
      )
    })

    const updateCheck = Effect.fn("ProjectHttpApi.updateCheck")(function* () {
      if (!Installation.isLocal()) {
        return { local: false, behind: 0, errorMsg: undefined }
      }

      const git = yield* Git.Service
      const ctx = yield* InstanceState.context

      const r = yield* git.run(["rev-list", "--count", "dev..upstream/dev"], { cwd: ctx.directory })

      if (r.exitCode !== 0) {
        const msg = r.stderr.toString("utf8").trim() || "git command failed"
        return { local: true, behind: 0, errorMsg: msg }
      }

      const behind = Number.parseInt(r.text().trim()) || 0
      return { local: true, behind, errorMsg: undefined }
    })

    // Wrap with catch-all so ANY unexpected defect becomes a graceful response
    // instead of a 500 UnknownError (see middleware/error.ts).
    const updateCheckSafe: typeof updateCheck = ((...args) =>
      updateCheck(...args).pipe(
        Effect.catchCause((cause) => {
          log.error("updateCheck failed", { cause: Cause.pretty(cause) })
          return Effect.succeed({ local: true, behind: 0, errorMsg: Cause.pretty(cause) })
        }),
      )) as typeof updateCheck

    return handlers
      .handle("list", list)
      .handle("current", current)
      .handle("initGit", initGit)
      .handle("updateCheck", updateCheckSafe)
      .handle("update", update)
      .handle("directories", directories)
      .handle("remove", remove)
  }),
)
