import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks
const { mockSelect, mockInsert, mockUpdate, mockDb, mockSaveSnapshot, mockGetDecryptedApiKey } =
  vi.hoisted(() => {
    const mockSelect = vi.fn();
    const mockInsert = vi.fn();
    const mockUpdate = vi.fn();
    const mockDb = {
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
    };
    const mockSaveSnapshot = vi.fn().mockResolvedValue({
      id: "mock-snapshot-uuid",
      treeHash: "mock-tree-hash-sha256",
    });
    const mockGetDecryptedApiKey = vi.fn();

    return {
      mockSelect,
      mockInsert,
      mockUpdate,
      mockDb,
      mockSaveSnapshot,
      mockGetDecryptedApiKey,
    };
  });

// Mock auth module
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: mockDb,
    getDecryptedApiKey: mockGetDecryptedApiKey,
    saveSnapshot: mockSaveSnapshot,
  };
});

import { getDecryptedApiKey } from "@spark/db";
import { getCurrentUser } from "@/lib/auth";
import { POST } from "./route";

describe("POST /api/projects/[id]/generate", () => {
  const mockUser = {
    id: "user-123",
    email: "test@example.com",
    name: "Test User",
  };

  const mockProject = {
    id: "proj-123",
    userId: "user-123",
    name: "Test Project",
    slug: "test-project",
    currentSnapshotId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default select chain
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockProject]),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: "thread-123" }]),
          }),
        }),
      }),
    });

    // Default insert chain
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "msg-123" }]),
      }),
    });

    // Default update chain
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({}),
      }),
    });
  });

  // covers: AC-1
  it("returns 401 Unauthorized if user is not authenticated", async () => {
    // Arrange
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "Create a todo app" }),
    });

    // Act
    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });

    // Assert
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  // covers: AC-1
  it("returns 400 Bad Request if prompt is missing or empty", async () => {
    // Arrange
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "   " }),
    });

    // Act
    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });

    // Assert
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Prompt is required");
  });

  // covers: AC-1
  it("returns 400 Bad Request if JSON body is invalid", async () => {
    // Arrange
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/generate", {
      method: "POST",
      body: "not-json",
    });

    // Act
    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });

    // Assert
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  // covers: AC-1
  it("returns 404 Not Found if project does not exist for session user", async () => {
    // Arrange
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]), // No project found
        }),
      }),
    });

    const req = new NextRequest("http://localhost:3000/api/projects/other-proj/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "Create a todo app" }),
    });

    // Act
    const res = await POST(req, { params: Promise.resolve({ id: "other-proj" }) });

    // Assert
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Project not found");
  });

  // covers: AC-1
  it("returns 400 Bad Request with PROVIDER_KEY_MISSING when provider key is missing", async () => {
    // Arrange
    vi.stubEnv("MOCK_AI", "");
    vi.stubEnv("NODE_ENV", "development");

    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    vi.mocked(getDecryptedApiKey).mockRejectedValueOnce(new Error("No key found"));

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "Create a counter", model: "claude-3-7-sonnet" }),
    });

    // Act
    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });

    // Assert
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("PROVIDER_KEY_MISSING");
    expect(body.provider).toBe("anthropic");

    // Cleanup
    vi.unstubAllEnvs();
  });

  it("resolves OpenRouter models and returns openrouter in PROVIDER_KEY_MISSING", async () => {
    vi.stubEnv("MOCK_AI", "");
    vi.stubEnv("NODE_ENV", "development");

    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    vi.mocked(getDecryptedApiKey).mockRejectedValueOnce(new Error("No key found"));

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/generate", {
      method: "POST",
      body: JSON.stringify({
        prompt: "Create a counter",
        model: "deepseek/deepseek-chat-v3-0324:free",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("PROVIDER_KEY_MISSING");
    expect(body.provider).toBe("openrouter");

    vi.unstubAllEnvs();
  });

  // covers: AC-1, AC-2, AC-9
  it("returns 200 OK with text/event-stream in mock or test mode", async () => {
    // Arrange
    process.env.MOCK_AI = "true";
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "Build a task tracker app" }),
    });

    // Act
    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    // Read full stream
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    let streamData = "";
    const decoder = new TextDecoder();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      streamData += decoder.decode(value);
    }

    expect(streamData).toContain("event: plan");
    expect(streamData).toContain("event: file_op");
    expect(streamData).toContain("event: finish");
    expect(streamData).toContain("msg-123");
  });
});
