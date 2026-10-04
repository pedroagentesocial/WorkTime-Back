export const RETENTION = Object.freeze({
  refreshTokenGraceDays: 7,
  securityEventDays: 365,
  deleteBatchSize: 5_000,
  maxBatchesPerRun: 100,
} as const);
