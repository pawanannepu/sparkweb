import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdateProjectQuery, mockDeleteProjectQuery } = vi.hoisted(() => ({
  mockUpdateProjectQuery: vi.fn(),
  mockDeleteProjectQuery: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: {},
    updateProjectQuery: mockUpdateProjectQuery,
    deleteProjectQuery: mockDeleteProjectQuery,
  };
});

import { ForbiddenError, NotFoundError } from "@spark/db";
import { getCurrentUser } from "@/lib/auth";
import { DELETE, PATCH } from "./route";

const VALID_PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const VALID_QUERY_ID = "11111111-1111-1111-1111-111111111111";
const MOCK_USER = {
  id: "user-123",
  email: "creator@example.com",
  name: "Creator",
};

const UPDATED_QUERY = {
  id: VALID_QUERY_ID,
  projectId: VALID_PROJECT_ID,
  title: "Pinned users",
  sql: "SELECT id FROM users;",
  description: null,
  isFavorite: true,
  createdAt: new Date("2026-11-25T10:00:00.000Z"),
  updatedAt: new Date("2026-11-25T11:00:00.000Z"),
};

describe("PATCH /api/projects/[id]/queries/[queryId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // covers: AC-2
  it("returns 401 when user is not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const req = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries/${VALID_QUERY_ID}`,
      { method: "PATCH", body: JSON.stringify({ isFavorite: true }) }
    );

    const res = await PATCH(req, {
      params: Promise.resolve({ id: VALID_PROJECT_ID, queryId: VALID_QUERY_ID }),
    });

    expect(res.status).toBe(401);
  });

  // covers: AC-2
  it("returns 400 when projectId or queryId is an invalid UUID", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MOCK_USER);

    const badProjectReq = new NextRequest(
      `http://localhost:3000/api/projects/bad/queries/${VALID_QUERY_ID}`,
      { method: "PATCH", body: JSON.stringify({ isFavorite: true }) }
    );
    expect(
      (
        await PATCH(badProjectReq, {
          params: Promise.resolve({ id: "bad", queryId: VALID_QUERY_ID }),
        })
      ).status
    ).toBe(400);

    const badQueryReq = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries/bad`,
      { method: "PATCH", body: JSON.stringify({ isFavorite: true }) }
    );
    expect(
      (
        await PATCH(badQueryReq, {
          params: Promise.resolve({ id: VALID_PROJECT_ID, queryId: "bad" }),
        })
      ).status
    ).toBe(400);
  });

  // covers: AC-2
  it("returns 400 when body is empty object or malformed JSON", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MOCK_USER);

    const badJsonReq = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries/${VALID_QUERY_ID}`,
      { method: "PATCH", body: "{invalid" }
    );
    expect(
      (
        await PATCH(badJsonReq, {
          params: Promise.resolve({ id: VALID_PROJECT_ID, queryId: VALID_QUERY_ID }),
        })
      ).status
    ).toBe(400);

    const emptyObjReq = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries/${VALID_QUERY_ID}`,
      { method: "PATCH", body: JSON.stringify({}) }
    );
    expect(
      (
        await PATCH(emptyObjReq, {
          params: Promise.resolve({ id: VALID_PROJECT_ID, queryId: VALID_QUERY_ID }),
        })
      ).status
    ).toBe(400);
  });

  // covers: AC-2
  it("updates allowed snippet fields and returns 200", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(MOCK_USER);
    mockUpdateProjectQuery.mockResolvedValueOnce(UPDATED_QUERY);

    const req = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries/${VALID_QUERY_ID}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          title: " Pinned users ",
          description: null,
          isFavorite: true,
        }),
      }
    );

    const res = await PATCH(req, {
      params: Promise.resolve({ id: VALID_PROJECT_ID, queryId: VALID_QUERY_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockUpdateProjectQuery).toHaveBeenCalledWith(expect.anything(), {
      projectId: VALID_PROJECT_ID,
      queryId: VALID_QUERY_ID,
      userId: MOCK_USER.id,
      title: "Pinned users",
      description: null,
      isFavorite: true,
    });
    expect(data.query.isFavorite).toBe(true);
    expect(data.query.updatedAt).toBe("2026-11-25T11:00:00.000Z");
  });

  // covers: AC-2
  it("returns 404 when query snippet does not exist and 403 for non-owner", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MOCK_USER);
    const makeReq = () =>
      new NextRequest(
        `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries/${VALID_QUERY_ID}`,
        { method: "PATCH", body: JSON.stringify({ isFavorite: false }) }
      );

    mockUpdateProjectQuery.mockRejectedValueOnce(new NotFoundError("Not found"));
    expect(
      (
        await PATCH(makeReq(), {
          params: Promise.resolve({ id: VALID_PROJECT_ID, queryId: VALID_QUERY_ID }),
        })
      ).status
    ).toBe(404);

    mockUpdateProjectQuery.mockRejectedValueOnce(new ForbiddenError("Forbidden"));
    expect(
      (
        await PATCH(makeReq(), {
          params: Promise.resolve({ id: VALID_PROJECT_ID, queryId: VALID_QUERY_ID }),
        })
      ).status
    ).toBe(403);
  });
});

describe("DELETE /api/projects/[id]/queries/[queryId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // covers: AC-2
  it("returns 401 when unauthenticated and 400 for invalid UUIDs", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const unauthReq = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries/${VALID_QUERY_ID}`,
      { method: "DELETE" }
    );
    expect(
      (
        await DELETE(unauthReq, {
          params: Promise.resolve({ id: VALID_PROJECT_ID, queryId: VALID_QUERY_ID }),
        })
      ).status
    ).toBe(401);

    vi.mocked(getCurrentUser).mockResolvedValueOnce(MOCK_USER);
    const invalidReq = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries/invalid`,
      { method: "DELETE" }
    );
    expect(
      (
        await DELETE(invalidReq, {
          params: Promise.resolve({ id: VALID_PROJECT_ID, queryId: "invalid" }),
        })
      ).status
    ).toBe(400);
  });

  // covers: AC-2
  it("deletes snippet for owner and returns 404 when missing", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MOCK_USER);
    mockDeleteProjectQuery.mockResolvedValueOnce({ success: true });

    const req = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries/${VALID_QUERY_ID}`,
      { method: "DELETE" }
    );
    const res = await DELETE(req, {
      params: Promise.resolve({ id: VALID_PROJECT_ID, queryId: VALID_QUERY_ID }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    mockDeleteProjectQuery.mockRejectedValueOnce(new NotFoundError("Missing"));
    const missingRes = await DELETE(req, {
      params: Promise.resolve({ id: VALID_PROJECT_ID, queryId: VALID_QUERY_ID }),
    });
    expect(missingRes.status).toBe(404);
  });
});
