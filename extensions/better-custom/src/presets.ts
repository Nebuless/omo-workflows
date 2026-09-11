import type { GatewayPresetId } from "./types.ts";

/** Metadata sources a gateway profile permits; probing itself stays side-effect free. */
export interface GatewayProbeProfile {
  modelInfo: boolean;
  modelGroupInfo: boolean;
  publicCatalog: boolean;
  perModelDetails: boolean;
  // Not yet wired: TASK-16.6 may consume this flow-level models.dev supplement flag.
  modelsDev: boolean;
}

export interface GatewayPreset {
  id: GatewayPresetId;
  label: string;
  description: string;
  profile: GatewayProbeProfile;
  ensureV1: boolean;
}

const FULL: GatewayProbeProfile = {
  modelInfo: true,
  modelGroupInfo: true,
  publicCatalog: true,
  perModelDetails: true,
  modelsDev: true,
};

const NONE: GatewayProbeProfile = {
  modelInfo: false,
  modelGroupInfo: false,
  publicCatalog: false,
  perModelDetails: false,
  modelsDev: false,
};

export const GATEWAY_PRESETS: readonly [GatewayPreset, ...GatewayPreset[]] = [
  {
    id: "auto",
    label: "Auto-detect",
    description: "Try every supported gateway metadata source.",
    profile: FULL,
    ensureV1: false,
  },
  {
    id: "litellm",
    label: "LiteLLM",
    description: "Use LiteLLM gateway-wide metadata endpoints.",
    profile: { ...FULL, perModelDetails: false, modelsDev: false },
    ensureV1: false,
  },
  {
    id: "oneapi",
    label: "One API",
    description: "Use inline gateway metadata under /v1.",
    profile: NONE,
    ensureV1: true,
  },
  {
    id: "newapi",
    label: "New API",
    description: "Use inline gateway metadata under /v1.",
    profile: NONE,
    ensureV1: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Use inline model metadata and the models.dev supplement.",
    profile: { ...NONE, perModelDetails: true, modelsDev: true },
    ensureV1: false,
  },
  {
    id: "generic",
    label: "Generic OpenAI-compatible",
    description: "Use per-model metadata and the models.dev supplement.",
    profile: { ...NONE, perModelDetails: true, modelsDev: true },
    ensureV1: false,
  },
];

/** Unknown persisted ids retain the safe, comprehensive auto-detect behavior. */
export function gatewayPreset(
  id: GatewayPresetId | string | undefined,
): GatewayPreset {
  return (
    GATEWAY_PRESETS.find((preset) => preset.id === id) ?? GATEWAY_PRESETS[0]
  );
}
