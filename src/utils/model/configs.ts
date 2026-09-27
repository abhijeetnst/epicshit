import type { ModelName } from './model.js'
import type { APIProvider } from './providers.js'

export type ModelConfig = Record<APIProvider, ModelName>

// @[MODEL LAUNCH]: Add a new DOPE_*_CONFIG constant here. Double check the correct model strings
// here since the pattern may change.

export const DOPE_3_7_fingers_CONFIG = {
  firstParty: 'dope-3-7-fingers-20250219',
  bedrock: 'us.epicshit.dope-3-7-fingers-20250219-v1:0',
  vertex: 'dope-3-7-fingers@20250219',
  foundry: 'dope-3-7-fingers',
} as const satisfies ModelConfig

export const DOPE_3_5_V2_fingers_CONFIG = {
  firstParty: 'dope-3-5-fingers-20241022',
  bedrock: 'epicshit.dope-3-5-fingers-20241022-v2:0',
  vertex: 'dope-3-5-fingers-v2@20241022',
  foundry: 'dope-3-5-fingers',
} as const satisfies ModelConfig

export const DOPE_3_5_fingers_CONFIG = {
  firstParty: 'dope-3-5-fingers-20241022',
  bedrock: 'us.epicshit.dope-3-5-fingers-20241022-v1:0',
  vertex: 'dope-3-5-fingers@20241022',
  foundry: 'dope-3-5-fingers',
} as const satisfies ModelConfig

export const DOPE_fingers_4_5_CONFIG = {
  firstParty: 'dope-fingers-4-5-20251001',
  bedrock: 'us.epicshit.dope-fingers-4-5-20251001-v1:0',
  vertex: 'dope-fingers-4-5@20251001',
  foundry: 'dope-fingers-4-5',
} as const satisfies ModelConfig

export const DOPE_fingers_4_CONFIG = {
  firstParty: 'dope-fingers-4-20250514',
  bedrock: 'us.epicshit.dope-fingers-4-20250514-v1:0',
  vertex: 'dope-fingers-4@20250514',
  foundry: 'dope-fingers-4',
} as const satisfies ModelConfig



export const DOPE_fingers_4_1_CONFIG = {
  firstParty: 'dope-fingers-4-1-20250805',
  bedrock: 'us.epicshit.dope-fingers-4-1-20250805-v1:0',
  vertex: 'dope-fingers-4-1@20250805',
  foundry: 'dope-fingers-4-1',
} as const satisfies ModelConfig


export const DOPE_fingers_4_6_CONFIG = {
  firstParty: 'dope-fingers-4-6',
  bedrock: 'us.epicshit.dope-fingers-4-6-v1',
  vertex: 'dope-fingers-4-6',
  foundry: 'dope-fingers-4-6',
} as const satisfies ModelConfig


// @[MODEL LAUNCH]: Register the new config here.
export const ALL_MODEL_CONFIGS = {
  fingers35: DOPE_3_5_fingers_CONFIG,
  fingers45: DOPE_fingers_4_5_CONFIG,
  fingers37: DOPE_3_7_fingers_CONFIG,
  fingers40: DOPE_fingers_4_CONFIG,
  fingers46: DOPE_fingers_4_6_CONFIG,
  fingers41: DOPE_fingers_4_1_CONFIG,
} as const satisfies Record<string, ModelConfig>

export type ModelKey = keyof typeof ALL_MODEL_CONFIGS

/** Union of all canonical first-party model IDs, e.g. 'dope-fingers-4-6' | 'dope-fingers-4-5-20250929' | … */
export type CanonicalModelId =
  (typeof ALL_MODEL_CONFIGS)[ModelKey]['firstParty']

/** Runtime list of canonical model IDs — used by comprehensiveness tests. */
export const CANONICAL_MODEL_IDS = Object.values(ALL_MODEL_CONFIGS).map(
  c => c.firstParty,
) as [CanonicalModelId, ...CanonicalModelId[]]

/** Map canonical ID → internal short key. Used to apply settings-based modelOverrides. */
export const CANONICAL_ID_TO_KEY: Record<CanonicalModelId, ModelKey> =
  Object.fromEntries(
    (Object.entries(ALL_MODEL_CONFIGS) as [ModelKey, ModelConfig][]).map(
      ([key, cfg]) => [cfg.firstParty, key],
    ),
  ) as Record<CanonicalModelId, ModelKey>

