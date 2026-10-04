export interface DataRetentionRepository {
  deleteSessionsStartedBefore(startedBefore: Date, batchSize: number): Promise<number>;
  deleteSecurityEventsBefore(
    createdBefore: Date,
    keepTypes: readonly string[],
    batchSize: number,
  ): Promise<number>;
}
