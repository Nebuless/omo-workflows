import { Type } from "typebox";
import { ComposedIdentitySchema } from "../execution/composed.ts";

export const LAUNCH_ENTRY_TYPE = "omo-workflow-graph:staged-launch";
export const LaunchSchema = Type.Object(
  {
    key: Type.String(),
    instance: Type.String(),
    version: Type.Integer({ minimum: 1 }),
    inputs: Type.Unknown(),
    artifactRoot: Type.String(),
    transferAttempt: Type.Optional(Type.String({ minLength: 1 })),
    revision: Type.Optional(Type.Integer({ minimum: 0 })),
    digest: Type.Optional(Type.String()),
    compositionIdentity: Type.Optional(ComposedIdentitySchema),
  },
  { additionalProperties: false },
);
