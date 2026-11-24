import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockUpdate, mockDb, mockSaveSnapshot } = vi.hoisted(() => {
  const mockSelect = vi.fn();
  const mockUpdate = vi.fn();
  const mockDb = {
    select: mockSelect,
    update: mockUpdate,
  };
  const mockSaveSnapshot = vi.fn().mockResolvedValue({
    id: "snapshot-test-uuid",
    treeHash: "sha256-tree-hash",
    createdAt: new Date().toISOString(),
  });

  return {
    mockSelect,
    mockUpdate,
    mockDb,
    mockSaveSnapshot,
  };
});

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: mockDb,
    saveSnapshot: mockSaveSnapshot,
  };
});

import { getCurrentUser } from "@/lib/auth";
import { POST } from "./route";

describe("POST /api/projects/[id]/snapshots", () => {
  const mockUser = {
    id: "user-123",
    email: "creator@example.com",
    name: "Creator",
  };

  const mockProject = {
    id: "proj-123",
    userId: "user-123",
    name: "Canvas App",
    currentSnapshotId: "parent-snap-001",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockProject]),
        }),
      }),
    });

    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({}),
      }),
    });
  });

  it("returns 401 Unauthorized if user is not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/snapshots", {
      method: "POST",
      body: JSON.stringify({ files: {} }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 Bad Request on invalid payload or invalid JSON", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/snapshots", {
      method: "POST",
      body: "invalid-json",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 Not Found if project does not belong to user", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const req = new NextRequest("http://localhost:3000/api/projects/other-proj/snapshots", {
      method: "POST",
      body: JSON.stringify({
        files: { "src/App.tsx": { content: "export default function App() {}" } },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "other-proj" }) });
    expect(res.status).toBe(404);
  });

  it("persists snapshot and returns snapshot metadata linking parentId (AC-8)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/snapshots", {
      method: "POST",
      body: JSON.stringify({
        files: {
          "src/App.tsx": { content: "export default function App() { return <div>Styled</div>; }" },
          "package.json": { content: "{}" },
        },
        message: "Visual padding update",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe("snapshot-test-uuid");
    expect(body.treeHash).toBe("sha256-tree-hash");
    expect(mockSaveSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-123",
        userId: "user-123",
        parentId: "parent-snap-001",
        message: "Visual padding update",
      })
    );
  });

  // covers: AC-8
  it("filters out node_modules and transient files before persisting snapshot", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/snapshots", {
      method: "POST",
      body: JSON.stringify({
        files: {
          "src/App.tsx": { content: "export default function App() {}" },
          "node_modules/pkg/index.js": { content: "console.log('third-party');" },
          "dist/bundle.js": { content: "compiled" },
        },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });
    expect(res.status).toBe(200);

    expect(mockSaveSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        files: {
          "src/App.tsx": { content: "export default function App() {}" },
        },
      })
    );
  });

  // covers: AC-8
  it("returns 500 when saveSnapshot throws an unexpected database error", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockSaveSnapshot.mockRejectedValueOnce(new Error("Database connection pool exhausted"));

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/snapshots", {
      method: "POST",
      body: JSON.stringify({
        files: { "src/App.tsx": { content: "export default function App() {}" } },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to persist snapshot");
    expect(body.message).toContain("Database connection pool exhausted");
  });

  // covers: AC-7
  it("updates promptMessages with healingTelemetry when messageId is provided", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);

    const telemetry = {
      status: "healed" as const,
      totalRepairs: 1,
      attempts: [
        {
          attemptIndex: 1,
          errorFingerprint: "fp-123",
          category: "import" as const,
          message: "Failed to resolve import",
          patchFiles: ["src/App.tsx"],
          status: "resolved" as const,
          timestamp: Date.now(),
        },
      ],
    };

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/snapshots", {
      method: "POST",
      body: JSON.stringify({
        files: { "src/App.tsx": { content: "export default function App() {}" } },
        messageId: "msg-123",
        healingTelemetry: telemetry,
        status: "healed",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });
    expect(res.status).toBe(200);

    expect(mockUpdate).toHaveBeenCalled();
  });

  // covers: AC-7
  it("prepends unverified warning to snapshot message when status is exhausted", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/snapshots", {
      method: "POST",
      body: JSON.stringify({
        files: { "src/App.tsx": { content: "export default function App() {}" } },
        message: "Attempted todo app generation",
        status: "exhausted",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });
    expect(res.status).toBe(200);

    expect(mockSaveSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        message: expect.stringContaining("[Unverified - healing exhausted]"),
      })
    );
  });
});
