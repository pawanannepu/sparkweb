import type { DatabaseClient } from "@spark/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_PROJECT_ID,
  DEMO_USER,
  ensureDemoProject,
  ensureDemoUser,
  getCurrentUser,
} from "./auth";

describe("auth and demo session helpers", () => {
  const mockSelect = vi.fn();
  const mockInsert = vi.fn();

  const mockDb = {
    select: mockSelect,
    insert: mockInsert,
  } as unknown as DatabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // covers: AC-1
  it("creates and retrieves demo user when database does not have one", async () => {
    // Arrange: first query returns empty, insert returns DEMO_USER
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    mockInsert.mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([DEMO_USER]),
      }),
    });

    // Act
    const user = await ensureDemoUser(mockDb);

    // Assert
    expect(user.id).toBe(DEMO_USER.id);
    expect(user.email).toBe(DEMO_USER.email);
    expect(user.name).toBe(DEMO_USER.name);
  });

  // covers: AC-1
  it("returns existing demo user if already present in database", async () => {
    // Arrange: query returns existing demo user
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([DEMO_USER]),
        }),
      }),
    });

    // Act
    const user = await ensureDemoUser(mockDb);

    // Assert
    expect(user.id).toBe(DEMO_USER.id);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  // covers: AC-1
  it("creates demo project when missing in database", async () => {
    // Arrange: query returns empty, insert returns created project
    const createdProject = {
      id: DEMO_PROJECT_ID,
      userId: DEMO_USER.id,
      name: "Demo Application",
      slug: "demo-application",
    };

    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    mockInsert.mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([createdProject]),
      }),
    });

    // Act
    const project = await ensureDemoProject(DEMO_USER.id, mockDb);

    // Assert
    expect(project.id).toBe(DEMO_PROJECT_ID);
    expect(project.userId).toBe(DEMO_USER.id);
    expect(project.name).toBe("Demo Application");
  });

  // covers: AC-1
  it("getCurrentUser resolves demo user when no x-user-id header is provided", async () => {
    // Arrange
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([DEMO_USER]),
        }),
      }),
    });

    const req = new Request("http://localhost:3000/api/test");

    // Act
    const user = await getCurrentUser(req, mockDb);

    // Assert
    expect(user).not.toBeNull();
    expect(user?.id).toBe(DEMO_USER.id);
  });

  // covers: AC-1
  it("getCurrentUser finds user when valid x-user-id header is provided", async () => {
    // Arrange
    const customUser = {
      id: "custom-user-uuid",
      email: "custom@example.com",
      name: "Custom User",
    };

    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([customUser]),
        }),
      }),
    });

    const req = new Request("http://localhost:3000/api/test", {
      headers: { "x-user-id": "custom-user-uuid" },
    });

    // Act
    const user = await getCurrentUser(req, mockDb);

    // Assert
    expect(user).not.toBeNull();
    expect(user?.id).toBe("custom-user-uuid");
    expect(user?.email).toBe("custom@example.com");
  });
});
