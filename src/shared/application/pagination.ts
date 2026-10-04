export const PAGINATION_DEFAULTS = {
  page: 1,
  limit: 20,
  maxLimit: 100,
} as const;

export interface PageRequest {
  readonly page: number;
  readonly limit: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

export function toOffset({ page, limit }: PageRequest): { skip: number; take: number } {
  return { skip: (page - 1) * limit, take: limit };
}

export function totalPages({ total, limit }: Pick<Page<unknown>, 'total' | 'limit'>): number {
  return Math.ceil(total / limit);
}
