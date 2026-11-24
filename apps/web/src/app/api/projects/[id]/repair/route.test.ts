import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted database mocks
const { mockSelect, mockDb, mockGetDecryptedApiKey } = vi.hoisted(() => {
  const mockSelect = vi.fn();
  const mockDb = {
    select: mockSelect,
  };
  const mockGetDecryptedApiKey = vi.fn();

  return {
    mockSelect,
    mockDb,
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
  };
});

import { getCurrentUser } from "@/lib/auth";
import { POST } from "./route";

describe("POST /api/projects/[id]/repair", () => {
  const mockUser = {
    id: "user-123",
    email: "creator@example.com",
    name: "Creator",
  };

  const mockProject = {
    id: "proj-123",
    userId: "user-123",
    name: "Canvas App",
  };

  const mockMessage = {
    id: "msg-123",
    role: "assistant",
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
  });

  // covers: AC-3
  it("returns 401 Unauthorized if user is not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/repair", {
      method: "POST",
      body: JSON.stringify({
        messageId: "msg-123",
        error: { message: "Error" },
        failingFile: { path: "src/App.tsx", content: "code" },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });
    expect(res.status).toBe(401);
  });

  // covers: AC-3
  it("returns 400 Bad Request if request body is invalid", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/repair", {
      method: "POST",
      body: JSON.stringify({}), // Missing messageId and failingFile
    });

    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });
    expect(res.status).toBe(400);
  });

  // covers: AC-3
  it("returns 404 Not Found if project does not belong to session user", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);

    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]), // No project
        }),
      }),
    });

    const req = new NextRequest("http://localhost:3000/api/projects/other-proj/repair", {
      method: "POST",
      body: JSON.stringify({
        messageId: "msg-123",
        error: { message: "Compilation error" },
        failingFile: { path: "src/App.tsx", content: "code" },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "other-proj" }) });
    expect(res.status).toBe(404);
  });

  // covers: AC-3
  it("streams targeted repair patches for import error without re-planning full prompt", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);

    // Mock project select then message select
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockProject]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockMessage]),
          }),
        }),
      });

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/repair", {
      method: "POST",
      body: JSON.stringify({
        messageId: "msg-123",
        error: {
          category: "import",
          message: 'Failed to resolve import "lucide-react/icons/missing" from "src/App.tsx"',
          filename: "src/App.tsx",
        },
        failingFile: {
          path: "src/App.tsx",
          content:
            'import { missing } from "lucide-react/icons/missing";\nexport default function App() { return <div>App</div>; }',
        },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    let streamOutput = "";
    const decoder = new TextDecoder();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      streamOutput += decoder.decode(value);
    }

    expect(streamOutput).toContain("event: healing_status");
    expect(streamOutput).toContain("event: file_op");
    expect(streamOutput).toContain("src/App.tsx");
    expect(streamOutput).toContain("event: finish");
  });

  // covers: AC-3, AC-4
  it("patches sibling export file when import cascade error references missing export", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);

    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockProject]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockMessage]),
          }),
        }),
      });

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/repair", {
      method: "POST",
      body: JSON.stringify({
        messageId: "msg-123",
        error: {
          category: "import",
          message:
            "The requested module './Button' does not provide an export named 'CustomButton'",
          filename: "src/App.tsx",
        },
        failingFile: {
          path: "src/App.tsx",
          content:
            'import { CustomButton } from "./Button";\nexport default function App() { return <CustomButton />; }',
        },
        importedSiblingFiles: [
          {
            path: "src/Button.tsx",
            content: "export const Button = () => <button>Click</button>;",
          },
        ],
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });
    expect(res.status).toBe(200);

    const reader = res.body?.getReader();
    let streamOutput = "";
    const decoder = new TextDecoder();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      streamOutput += decoder.decode(value);
    }

    expect(streamOutput).toContain("src/Button.tsx");
    expect(streamOutput).toContain("CustomButton");
  });
});
