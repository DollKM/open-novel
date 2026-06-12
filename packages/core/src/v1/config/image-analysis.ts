export * as ConfigImageAnalysisV1 from "./image-analysis"

import { Schema } from "effect"

export const Model = Schema.Struct({
  provider: Schema.String,
  id: Schema.String,
}).annotate({ identifier: "ImageAnalysisModel" })

export const Info = Schema.Struct({
  model: Model,
}).annotate({ identifier: "ImageAnalysisConfig" })
export type Info = Schema.Schema.Type<typeof Info>
