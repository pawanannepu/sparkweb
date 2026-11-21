import { describe, expect, it } from "vitest";
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  SnapshotInActiveDeploymentError,
  ValidationError,
} from "./errors";

describe("domain error classes", () => {
  it("sets 404 status and NOT_FOUND code on NotFoundError", () => {
    const error = new NotFoundError("Resource not found");
    expect(error).toBeInstanceOf(DomainError);
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Resource not found");
    expect(error.name).toBe("NotFoundError");
  });

  it("sets 403 status and FORBIDDEN code on ForbiddenError", () => {
    const error = new ForbiddenError("Access denied");
    expect(error).toBeInstanceOf(DomainError);
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe("FORBIDDEN");
    expect(error.message).toBe("Access denied");
    expect(error.name).toBe("ForbiddenError");
  });

  it("sets 409 status and CONFLICT code on ConflictError", () => {
    const error = new ConflictError("Subdomain already taken");
    expect(error).toBeInstanceOf(DomainError);
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe("Subdomain already taken");
  });

  it("sets 422 status and VALIDATION_ERROR code on ValidationError", () => {
    const error = new ValidationError("Missing required field");
    expect(error).toBeInstanceOf(DomainError);
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("formats snapshot deployment conflict message on SnapshotInActiveDeploymentError (AC-4)", () => {
    const error = new SnapshotInActiveDeploymentError("snap-12345");
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe("SNAPSHOT_IN_ACTIVE_DEPLOYMENT");
    expect(error.message).toContain("snap-12345");
    expect(error.message).toContain("cannot be deleted because it backs an active deployment");
  });
});
