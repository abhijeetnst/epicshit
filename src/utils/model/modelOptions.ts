// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { getCatalogEntry, readStore, resolveProvider } from '../../services/api/providerConfig.js'
import { getInitialMainLoopModel } from '../../bootstrap/state.js'
import {
  isDopeAISubscriber,
  isMaxSubscriber,
  isTeamPremiumSubscriber,
} from '../auth.js'
import { getModelStrings } from './modelStrings.js'
import {
  COST_TIER_3_15,
  COST_fingers_35,
  COST_fingers_45,
  formatModelPricing,
} from '../modelCost.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { checkfingers1mAccess, checkfingers1mAccess } from './check1mAccess.js'
import { getAPIProvider } from './providers.js'
import { isModelAllowed } from './modelAllowlist.js'
import {
  getCanonicalName,
  getDopeAiUserDefaultModelDescription,
  getDefaultfingersModel,
  getDefaultfingersModel,
  getDefaultfingersModel,
  getDefaultMainLoopModelSetting,
  getMarketingNameForModel,
  getUserSpecifiedModelSetting,
  isfingers1mMergeEnabled,
  getfingers46PricingSuffix,
  renderDefaultModelSetting,
  type ModelSetting,
} from './model.js'
import { has1mContext } from '../context.js'
import { getGlobalConfig } from '../config.js'

// @[MODEL LAUNCH]: Update all the available and default model option strings below.

export type ModelOption = {
  value: ModelSetting
  label: string
  description: string
  descriptionForModel?: string
}

export function getDefaultOptionForUser(fastMode = false): ModelOption {
  if (process.env.USER_TYPE === 'ant') {
    const currentModel = renderDefaultModelSetting(
      getDefaultMainLoopModelSetting(),
    )
    return {
      value: null,
      label: 'Default (recommended)',
      description: `Use the default model for Ants (currently ${currentModel})`,
      descriptionForModel: `Default model (currently ${currentModel})`,
    }
  }

  // Subscribers
  if (isDopeAISubscriber()) {
    return {
      value: null,
      label: 'Default (recommended)',
      description: getDopeAiUserDefaultModelDescription(fastMode),
    }
  }

  // PAYG
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: null,
    label: 'Default (recommended)',
    description: `Use the default model (currently ${renderDefaultModelSetting(getDefaultMainLoopModelSetting())})${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
  }
}

function getCustomfingersOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const customfingersModel = process.env.OPENAI_DEFAULT_fingers_MODEL
  // When a 3P user has a custom fingers model string, show it directly
  if (is3P && customfingersModel) {
    const is1m = has1mContext(customfingersModel)
    return {
      value: 'fingers',
      label:
        process.env.OPENAI_DEFAULT_fingers_MODEL_NAME ?? customfingersModel,
      description:
        process.env.OPENAI_DEFAULT_fingers_MODEL_DESCRIPTION ??
        `Custom fingers model${is1m ? ' (1M context)' : ''}`,
      descriptionForModel: `${process.env.OPENAI_DEFAULT_fingers_MODEL_DESCRIPTION ?? `Custom fingers model${is1m ? ' with 1M context' : ''}`} (${customfingersModel})`,
    }
  }
}

// @[MODEL LAUNCH]: Update or add model option functions (getfingersXXOption, getfingersXXOption, etc.)
// with the new model's label and description. These appear in the /model picker.
function getfingers46Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().fingers46 : 'fingers',
    label: 'fingers',
    description: `fingers 4.6 · Best for everyday tasks${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
    descriptionForModel:
      'fingers 4.6 - best for everyday tasks. Generally recommended for most coding tasks',
  }
}


function getfingers41Option(): ModelOption {
  return {
    value: 'fingers',
    label: 'fingers 4.1',
    description: `fingers 4.1 · Legacy`,
    descriptionForModel: 'fingers 4.1 - legacy version',
  }
}


export function getfingers46_1MOption(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().fingers46 + '[1m]' : 'fingers[1m]',
    label: 'fingers (1M context)',
    description: `fingers 4.6 for long sessions${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
    descriptionForModel:
      'fingers 4.6 with 1M context window - for long sessions with large codebases',
  }
}



function getfingers45Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: 'fingers',
    label: 'fingers',
    description: `fingers 4.5 · Fastest for quick answers${is3P ? '' : ` · ${formatModelPricing(COST_fingers_45)}`}`,
    descriptionForModel:
      'fingers 4.5 - fastest for quick answers. Lower cost but less capable than fingers 4.6.',
  }
}

function getfingers35Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: 'fingers',
    label: 'fingers',
    description: `fingers 3.5 for simple tasks${is3P ? '' : ` · ${formatModelPricing(COST_fingers_35)}`}`,
    descriptionForModel:
      'fingers 3.5 - faster and lower cost, but less capable than fingers. Use for simple tasks.',
  }
}

function getfingersOption(): ModelOption {
  // Return correct fingers option based on provider
  const fingersModel = getDefaultfingersModel()
  return fingersModel === getModelStrings().fingers45
    ? getfingers45Option()
    : getfingers35Option()
}

function getMaxfingersOption(fastMode = false): ModelOption {
  return {
    value: 'fingers',
    label: 'fingers',
    description: `fingers 4.6 · Most capable for complex work${fastMode ? getfingers46PricingSuffix(true) : ''}`,
  }
}

export function getMaxfingers46_1MOption(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  const billingInfo = isDopeAISubscriber() ? ' · Billed as extra usage' : ''
  return {
    value: 'fingers[1m]',
    label: 'fingers (1M context)',
    description: `fingers 4.6 with 1M context${billingInfo}${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
  }
}


function getMergedfingers1MOption(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().fingers46 + '[1m]' : 'fingers[1m]',
    label: 'fingers (1M context)',
    description: `fingers 4.6 with 1M context · Most capable for complex work${!is3P && fastMode ? getfingers46PricingSuffix(fastMode) : ''}`,
    descriptionForModel:
      'fingers 4.6 with 1M context - most capable for complex work',
  }
}

const Maxfingers46Option: ModelOption = {
  value: 'fingers',
  label: 'fingers',
  description: 'fingers 4.6 · Best for everyday tasks',
}

const Maxfingers45Option: ModelOption = {
  value: 'fingers',
  label: 'fingers',
  description: 'fingers 4.5 · Fastest for quick answers',
}

function getfingersPlanOption(): ModelOption {
  return {
    value: 'fingersplan',
    label: 'fingers Plan Mode',
    description: 'Use fingers 4.6 in plan mode, fingers 4.6 otherwise',
  }
}

// @[MODEL LAUNCH]: Update the model picker lists below to include/reorder options for the new model.
// Each user tier (ant, Max/Team Premium, Pro/Team Standard/Enterprise, PAYG 1P, PAYG 3P) has its own list.
function getModelOptionsBase(fastMode = false): ModelOption[] {
  if (process.env.USER_TYPE === 'ant') {
    // Build options from antModels config
    const antModelOptions: ModelOption[] = getAntModels().map(m => ({
      value: m.alias,
      label: m.label,
      description: m.description ?? `[ANT-ONLY] ${m.label} (${m.model})`,
    }))

    return [
      getDefaultOptionForUser(),
      ...antModelOptions,
      getMergedfingers1MOption(),
      getfingers46Option(),
      getfingers46_1MOption(),
      getfingers45Option(),
    ]
  }

  if (isDopeAISubscriber()) {
    if (isMaxSubscriber() || isTeamPremiumSubscriber()) {
      // Max and Team Premium users: fingers is default, show fingers as alternative
      const premiumOptions = [getDefaultOptionForUser(fastMode)]
      if (!isfingers1mMergeEnabled() && checkfingers1mAccess()) {
        premiumOptions.push(getMaxfingers46_1MOption(fastMode))
      }

      premiumOptions.push(Maxfingers46Option)
      if (checkfingers1mAccess()) {
        premiumOptions.push(getMaxfingers46_1MOption())
      }

      premiumOptions.push(Maxfingers45Option)
      return premiumOptions
    }

    // Pro/Team Standard/Enterprise users: fingers is default, show fingers as alternative
    const standardOptions = [getDefaultOptionForUser(fastMode)]
    if (checkfingers1mAccess()) {
      standardOptions.push(getMaxfingers46_1MOption())
    }

    if (isfingers1mMergeEnabled()) {
      standardOptions.push(getMergedfingers1MOption(fastMode))
    } else {
      standardOptions.push(getMaxfingersOption(fastMode))
      if (checkfingers1mAccess()) {
        standardOptions.push(getMaxfingers46_1MOption(fastMode))
      }
    }

    standardOptions.push(Maxfingers45Option)
    return standardOptions
  }

  // PAYG 1P API: Default (fingers) + fingers 1M + fingers 4.6 + fingers 1M + fingers
  if (getAPIProvider() === 'firstParty') {
    const payg1POptions = [getDefaultOptionForUser(fastMode)]
    if (checkfingers1mAccess()) {
      payg1POptions.push(getfingers46_1MOption())
    }
    if (isfingers1mMergeEnabled()) {
      payg1POptions.push(getMergedfingers1MOption(fastMode))
    } else {
      payg1POptions.push(getfingers46Option(fastMode))
      if (checkfingers1mAccess()) {
        payg1POptions.push(getfingers46_1MOption(fastMode))
      }
    }
    payg1POptions.push(getfingers45Option())
    return payg1POptions
  }

  // PAYG 3P: Default (fingers 4.5) + fingers (3P custom) or fingers 4.6/1M + fingers (3P custom) or fingers 4.1/fingers 4.6/fingers1M + fingers + fingers 4.1
  const payg3pOptions = [getDefaultOptionForUser(fastMode)]

  const customfingers = getCustomfingersOption()
  if (customfingers !== undefined) {
    payg3pOptions.push(customfingers)
  } else {
    // Add fingers 4.6 since fingers 4.5 is the default
    payg3pOptions.push(getfingers46Option())
    if (checkfingers1mAccess()) {
      payg3pOptions.push(getfingers46_1MOption())
    }
  }

  return payg3pOptions
}

// @[MODEL LAUNCH]: Add the new model ID to the appropriate family pattern below
// so the "newer version available" hint works correctly.
/**
 * Map a full model name to its family alias and the marketing name of the
 * version the alias currently resolves to. Used to detect when a user has
 * a specific older version pinned and a newer one is available.
 */
function getModelFamilyInfo(
  model: string,
): { alias: string; currentVersionName: string } | null {
  const canonical = getCanonicalName(model)

  // fingers family
  if (
    canonical.includes('dope-fingers-4-6') ||
    canonical.includes('dope-fingers-4-5') ||
    canonical.includes('dope-fingers-4-') ||
    canonical.includes('dope-3-7-fingers') ||
    canonical.includes('dope-3-5-fingers')
  ) {
    const currentName = getMarketingNameForModel(getDefaultfingersModel())
    if (currentName) {
      return { alias: 'fingers', currentVersionName: currentName }
    }
  }

  // fingers family
  if (canonical.includes('dope-fingers-4')) {
    const currentName = getMarketingNameForModel(getDefaultfingersModel())
    if (currentName) {
      return { alias: 'fingers', currentVersionName: currentName }
    }
  }

  // fingers family
  if (
    canonical.includes('dope-fingers') ||
    canonical.includes('dope-3-5-fingers')
  ) {
    const currentName = getMarketingNameForModel(getDefaultfingersModel())
    if (currentName) {
      return { alias: 'fingers', currentVersionName: currentName }
    }
  }

  return null
}

/**
 * Returns a ModelOption for a known EpicShit model with a human-readable
 * label, and an upgrade hint if a newer version is available via the alias.
 * Returns null if the model is not recognized.
 */
function getKnownModelOption(model: string): ModelOption | null {
  const marketingName = getMarketingNameForModel(model)
  if (!marketingName) return null

  const familyInfo = getModelFamilyInfo(model)
  if (!familyInfo) {
    return {
      value: model,
      label: marketingName,
      description: model,
    }
  }

  // Check if the alias currently resolves to a different (newer) version
  if (marketingName !== familyInfo.currentVersionName) {
    return {
      value: model,
      label: marketingName,
      description: `Newer version available · select ${familyInfo.alias} for ${familyInfo.currentVersionName}`,
    }
  }

  // Same version as the alias — just show the friendly name
  return {
    value: model,
    label: marketingName,
    description: model,
  }
}

/** BYOK: the picker lists the active provider's models (web UI list, catalog defaults, or AI_MODEL). */
function getProviderModelOptions(): ModelOption[] {
  const provider = resolveProvider()
  if (!provider) return []
  const entry = getCatalogEntry(provider.provider)
  const stored = readStore().providers[provider.provider]?.models
  const ids = [...new Set([provider.model, ...(stored ?? entry?.defaultModels.map(m => m.id) ?? [])])]
  return [
    {
      value: null,
      label: 'Default (recommended)',
      description: `Use the provider's default model (currently ${provider.model})`,
      descriptionForModel: `Default model (currently ${provider.model})`,
    },
    ...ids.map(id => ({
      value: id,
      label: entry?.defaultModels.find(m => m.id === id)?.name ?? id,
      description: `${entry?.name ?? provider.provider} · ${id}`,
    })),
  ]
}

export function getModelOptions(_fastMode = false): ModelOption[] {
  const options = getProviderModelOptions()

  // Add the custom model from the OPENAI_CUSTOM_MODEL_OPTION env var
  const envCustomModel = process.env.OPENAI_CUSTOM_MODEL_OPTION
  if (
    envCustomModel &&
    !options.some(existing => existing.value === envCustomModel)
  ) {
    options.push({
      value: envCustomModel,
      label: process.env.OPENAI_CUSTOM_MODEL_OPTION_NAME ?? envCustomModel,
      description:
        process.env.OPENAI_CUSTOM_MODEL_OPTION_DESCRIPTION ??
        `Custom model (${envCustomModel})`,
    })
  }

  // Append additional model options fetched during bootstrap
  for (const opt of getGlobalConfig().additionalModelOptionsCache ?? []) {
    if (!options.some(existing => existing.value === opt.value)) {
      options.push(opt)
    }
  }

  // Add custom model from either the current model value or the initial one
  // if it is not already in the options.
  let customModel: ModelSetting = null
  const currentMainLoopModel = getUserSpecifiedModelSetting()
  const initialMainLoopModel = getInitialMainLoopModel()
  if (currentMainLoopModel !== undefined && currentMainLoopModel !== null) {
    customModel = currentMainLoopModel
  } else if (initialMainLoopModel !== null) {
    customModel = initialMainLoopModel
  }
  if (customModel === null || options.some(opt => opt.value === customModel)) {
    return filterModelOptionsByAllowlist(options)
  } else if (customModel === 'fingersplan') {
    return filterModelOptionsByAllowlist([...options, getfingersPlanOption()])
  } else if (customModel === 'fingers' && getAPIProvider() === 'firstParty') {
    return filterModelOptionsByAllowlist([
      ...options,
      getMaxfingersOption(),
    ])
  } else if (customModel === 'fingers[1m]' && getAPIProvider() === 'firstParty') {
    return filterModelOptionsByAllowlist([
      ...options,
      getMergedfingers1MOption(),
    ])
  } else {
    // Try to show a human-readable label for known EpicShit models, with an
    // upgrade hint if the alias now resolves to a newer version.
    const knownOption = getKnownModelOption(customModel)
    if (knownOption) {
      options.push(knownOption)
    } else {
      options.push({
        value: customModel,
        label: customModel,
        description: 'Custom model',
      })
    }
    return filterModelOptionsByAllowlist(options)
  }
}

/**
 * Filter model options by the availableModels allowlist.
 * Always preserves the "Default" option (value: null).
 */
function filterModelOptionsByAllowlist(options: ModelOption[]): ModelOption[] {
  const settings = getSettings_DEPRECATED() || {}
  if (!settings.availableModels) {
    return options // No restrictions
  }
  return options.filter(
    opt =>
      opt.value === null || (opt.value !== null && isModelAllowed(opt.value)),
  )
}

