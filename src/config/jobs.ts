export const JOBS = Object.freeze({
  closeEntriesOverLimitMs: 15_000,
  closeEntriesOfInactiveEmployeesMs: 60_000,
  purgeOldDataMs: 3_600_000,
} as const);
