export * as Workflow from "."

import path from "path"
import { Schema } from "effect"
import { ConfigMarkdown } from "@opencode-ai/core/config/markdown"

export const Info = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  category: Schema.String,
  description: Schema.optional(Schema.String),
})
export type Info = Schema.Schema.Type<typeof Info>

export class Detail extends Schema.Class<Detail>("Workflow.Detail")({
  path: Schema.String,
  name: Schema.String,
  category: Schema.String,
  description: Schema.optional(Schema.String),
  content: Schema.String,
}) {}

const Frontmatter = Schema.Struct({
  name: Schema.String,
  category: Schema.String,
  description: Schema.optional(Schema.String),
})
const decodeFrontmatter = Schema.decodeUnknownOption(Frontmatter)

export function relativePath(root: string, filepath: string): string {
  let rel = path.relative(root, filepath)
  if (rel.endsWith(".md")) rel = rel.slice(0, -3)
  return rel.replace(/\\/g, "/")
}

export function isSubPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return !relative.startsWith("..") && !path.isAbsolute(relative)
}

export function parseWorkflow(root: string, filepath: string, content: string): Info | undefined {
  const parsed = ConfigMarkdown.parseOption(content)
  if (!parsed) return
  const frontmatter = decodeFrontmatter(parsed.data).valueOrUndefined
  if (!frontmatter) return
  return {
    path: relativePath(root, filepath),
    name: frontmatter.name,
    category: frontmatter.category,
    description: frontmatter.description,
  }
}

export function parseWorkflowDetail(root: string, filepath: string, content: string): Detail | undefined {
  const parsed = ConfigMarkdown.parseOption(content)
  if (!parsed) return
  const frontmatter = decodeFrontmatter(parsed.data).valueOrUndefined
  if (!frontmatter) return
  return new Detail({
    path: relativePath(root, filepath),
    name: frontmatter.name,
    category: frontmatter.category,
    description: frontmatter.description,
    content: parsed.content,
  })
}
