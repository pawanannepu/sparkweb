import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUserApiKeys, mockSaveUserApiKey, mockDeleteUserApiKey } = vi.hoisted(() => ({
  mockGetUserApiKeys: vi.fn(),
  mockSaveUserApiKey: vi.fn(),
  mockDeleteUserApiKey: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: {},
    getUserApiKeys: mockGetUserApiKeys,
    saveUserApiKey: mockSaveUserApiKey,
    deleteUserApiKey: mockDeleteUserApiKey,
  };
});

import { getCurrentUser } from "@/lib/auth";
import { DELETE, GET, POST } from "./route";

describe("/api/keys route", () => {
  const mockUser = { id: "user-1", email: "user@example.com", name: "User" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const res = await GET(new NextRequest("http://localhost:3000/api/keys"));
    expect(res.status).toBe(401);
  });

  it("lists configured keys for current user", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockGetUserApiKeys.mockResolvedValueOnce([
      {
        provider: "openrouter",
        keyHint: "sk-or-...9999",
        updatedAt: new Date("2026-11-26T00:00:00.000Z"),
      },
    ]);

    const res = await GET(new NextRequest("http://localhost:3000/api/keys"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys).toEqual([
      {
        provider: "openrouter",
        keyHint: "sk-or-...9999",
        updatedAt: "2026-11-26T00:00:00.000Z",
      },
    ]);
  });

  it("saves an OpenRouter API key", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockSaveUserApiKey.mockResolvedValueOnce({
      provider: "openrouter",
      keyHint: "sk-or-...1234",
    });

    const req = new NextRequest("http://localhost:3000/api/keys", {
      method: "POST",
      body: JSON.stringify({
        provider: "openrouter",
        apiKey: "sk-or-v1-test-key-1234",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("openrouter");
    expect(body.keyHint).toBe("sk-or-...1234");
    expect(mockSaveUserApiKey).toHaveBeenCalled();
  });

  it("deletes a saved provider key", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockDeleteUserApiKey.mockResolvedValueOnce(true);

    const req = new NextRequest("http://localhost:3000/api/keys?provider=openrouter", {
      method: "DELETE",
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: true, provider: "openrouter" });
  });
});
