import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted database mocks
const { mockSelect, mockInsert, mockDb, mockGetDecryptedApiKey } = vi.hoisted(() => {
  const mockSelect = vi.fn();
  const mockInsert = vi.fn();
  const mockDb = {
    select: mockSelect,
    insert: mockInsert,
  };
  const mockGetDecryptedApiKey = vi.fn();

  return {
    mockSelect,
    mockInsert,
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
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockMessage]),
          }),
        }),
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockProject]),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: "thread-123" }]),
          }),
        }),
      }),
    });

    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "repair-msg-uuid-1" }]),
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockMessage]),
            }),
          }),
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
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockMessage]),
            }),
          }),
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

  // covers: AC-3
  it("returns 404 Not Found if messageId does not belong to target project", async () => {
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
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockMessage]),
          }),
        }),
      });

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/repair", {
      method: "POST",
      body: JSON.stringify({
        messageId: "foreign-msg-999",
        error: { message: "Syntax error" },
        failingFile: { path: "src/App.tsx", content: "code" },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });
    expect(res.status).toBe(404);
  });

  // covers: AC-8
  it("creates a new assistant message when messageId is omitted for manual repair", async () => {
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
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: "thread-123" }]),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ seq: 4 }]),
            }),
          }),
        }),
      });

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/repair", {
      method: "POST",
      body: JSON.stringify({
        error: {
          category: "syntax",
          message: "Unexpected token",
          filename: "src/App.tsx",
        },
        failingFile: {
          path: "src/App.tsx",
          content: "export default function App() { return <div>Hi</div>; }",
        },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalled();

    const reader = res.body?.getReader();
    let streamOutput = "";
    const decoder = new TextDecoder();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      streamOutput += decoder.decode(value);
    }

    expect(streamOutput).toContain("repair-msg-uuid-1");
  });

  // covers: AC-3
  it("returns 400 Bad Request when request body is invalid JSON", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/repair", {
      method: "POST",
      body: "{not-json",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  // covers: AC-3
  it("returns 400 PROVIDER_KEY_MISSING when no provider key exists outside mock or test mode", async () => {
    vi.stubEnv("MOCK_AI", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockGetDecryptedApiKey.mockRejectedValueOnce(new Error("Missing key"));

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
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockMessage]),
            }),
          }),
        }),
      });

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/repair", {
      method: "POST",
      body: JSON.stringify({
        messageId: "msg-123",
        error: { message: "Syntax error" },
        failingFile: { path: "src/App.tsx", content: "code" },
        model: "claude-3-7-sonnet",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "proj-123" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("PROVIDER_KEY_MISSING");
    expect(body.provider).toBe("anthropic");
  });

  // covers: AC-3
  it("repairs syntax error by removing broken trailing tag and supplying default export", async () => {
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
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockMessage]),
            }),
          }),
        }),
      });

    const req = new NextRequest("http://localhost:3000/api/projects/proj-123/repair", {
      method: "POST",
      body: JSON.stringify({
        messageId: "msg-123",
        error: {
          category: "syntax",
          message: "Unexpected token",
          filename: "src/App.tsx",
        },
        failingFile: {
          path: "src/App.tsx",
          content: "const view = <div>Hello</broken>",
        },
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

    expect(streamOutput).toContain("event: file_op");
    expect(streamOutput).toContain("export default function App");
    expect(streamOutput).toContain("event: finish");
  });

  // covers: AC-3 (Key Invariant: max 10 repair requests per minute per project)
  it("returns 429 Too Many Requests after 10 repair calls within a minute for one project", async () => {
    const rateLimitedProjectId = "proj-ratelimit-test";

    for (let i = 0; i < 10; i++) {
      vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
      const req = new NextRequest(
        `http://localhost:3000/api/projects/${rateLimitedProjectId}/repair`,
        {
          method: "POST",
          body: JSON.stringify({
            messageId: "msg-123",
            error: { message: "Syntax error" },
            failingFile: { path: "src/App.tsx", content: "export default () => null;" },
          }),
        }
      );
      const res = await POST(req, { params: Promise.resolve({ id: rateLimitedProjectId }) });
      expect(res.status).toBe(200);
    }

    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    const blockedReq = new NextRequest(
      `http://localhost:3000/api/projects/${rateLimitedProjectId}/repair`,
      {
        method: "POST",
        body: JSON.stringify({
          messageId: "msg-123",
          error: { message: "Syntax error" },
          failingFile: { path: "src/App.tsx", content: "export default () => null;" },
        }),
      }
    );
    const blockedRes = await POST(blockedReq, {
      params: Promise.resolve({ id: rateLimitedProjectId }),
    });
    expect(blockedRes.status).toBe(429);
  });
});
