export abstract class DomainError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends DomainError {
  readonly statusCode = 404;
  readonly code: string = "NOT_FOUND";
}

export class ForbiddenError extends DomainError {
  readonly statusCode = 403;
  readonly code: string = "FORBIDDEN";
}

export class ConflictError extends DomainError {
  readonly statusCode = 409;
  readonly code: string = "CONFLICT";
}

export class ValidationError extends DomainError {
  readonly statusCode = 422;
  readonly code = "VALIDATION_ERROR";
}

export class SnapshotInActiveDeploymentError extends ConflictError {
  override readonly code: string = "SNAPSHOT_IN_ACTIVE_DEPLOYMENT";

  constructor(snapshotId: string) {
    super(`Snapshot ${snapshotId} cannot be deleted because it backs an active deployment`);
  }
}
