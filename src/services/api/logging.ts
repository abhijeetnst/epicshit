// API request logging used to feed analytics/OTel; both are gone, so only the
// shared usage types remain here.
import type { NonNullableUsage } from '../../entrypoints/sdk/sdkUtilityTypes.js'
import { EMPTY_USAGE } from './emptyUsage.js'

export type { NonNullableUsage }
export { EMPTY_USAGE }
