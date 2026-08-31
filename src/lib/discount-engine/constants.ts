export const CURRENCY_DECIMALS = 2

export const DEFAULT_TAX_TREATMENT = 'tax_before_discount' as const

export const DEFAULT_STACKING_MODE = 'allow' as const

/**
 * Wall-clock budget for the discount-engine perf test. This is a smoke test for
 * ~10x regressions, not a hard SLA, and it is sensitive to how loaded the host
 * is. CI runners are slower and noisier than a dev box, so CI overrides this via
 * DISCOUNT_PERF_BUDGET_MS; locally it stays tight at 150ms.
 */
export const PERFORMANCE_BENCHMARK_MS =
  Number(
    (typeof process !== "undefined" && process.env && process.env.DISCOUNT_PERF_BUDGET_MS) || "",
  ) || 150

export const PERFORMANCE_BENCHMARK_RULES = 2000

export const PERFORMANCE_BENCHMARK_ITEMS = 50
