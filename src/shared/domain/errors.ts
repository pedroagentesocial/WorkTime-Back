export type ErrorKind =
  'validation' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'too_many_requests';

export abstract class AppError extends Error {
  abstract readonly kind: ErrorKind;

  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  readonly kind = 'validation';
}

export class UnauthorizedError extends AppError {
  readonly kind = 'unauthorized';
}

export class ForbiddenError extends AppError {
  readonly kind = 'forbidden';
}

export class NotFoundError extends AppError {
  readonly kind = 'not_found';
}

export class ConflictError extends AppError {
  readonly kind = 'conflict';
}

export class TooManyRequestsError extends AppError {
  readonly kind = 'too_many_requests';
}
