import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockListProjectQueries, mockCreateProjectQuery } = vi.hoisted(() => ({
  mockListProjectQueries: vi.fn(),
  mockCreateProjectQuery: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: {},
    listProjectQueries: mockListProjectQueries,
    createProjectQuery: mockCreateProjectQuery,
  };
});

import { ForbiddenError, NotFoundError, ValidationError } from "@spark/db";
import { getCurrentUser } from "@/lib/auth";
import { GET, POST } from "./route";

const VALID_PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const MOCK_USER = {
  id: "user-123",
  email: "creator@example.com",
  name: "Creator",
};

const SAMPLE_QUERY = {
  id: "11111111-1111-1111-1111-111111111111",
  projectId: VALID_PROJECT_ID,
  title: "All users",
  sql: "SELECT * FROM users;",
  description: "Fetch every user",
  isFavorite: true,
  createdAt: new Date("2026-11-25T10:00:00.000Z"),
  updatedAt: new Date("2026-11-25T10:00:00.000Z"),
};

describe("GET /api/projects/[id]/queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // covers: AC-2
  it("returns 401 when user is not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const req = new NextRequest(`http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries`);

    const res = await GET(req, { params: Promise.resolve({ id: VALID_PROJECT_ID }) });

    expect(res.status).toBe(401);
  });

  // covers: AC-2
  it("returns 400 when projectId is not a valid UUID", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(MOCK_USER);
    const req = new NextRequest("http://localhost:3000/api/projects/not-a-uuid/queries");

    const res = await GET(req, { params: Promise.resolve({ id: "not-a-uuid" }) });

    expect(res.status).toBe(400);
    expect(mockListProjectQueries).not.toHaveBeenCalled();
  });

  // covers: AC-2
  it("returns 400 when favorite filter parameter is invalid", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(MOCK_USER);
    const req = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries?favorite=maybe`
    );

    const res = await GET(req, { params: Promise.resolve({ id: VALID_PROJECT_ID }) });

    expect(res.status).toBe(400);
    expect(mockListProjectQueries).not.toHaveBeenCalled();
  });

  // covers: AC-2
  it("lists serialized queries and passes favorite boolean filter", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(MOCK_USER);
    mockListProjectQueries.mockResolvedValueOnce([SAMPLE_QUERY]);
    const req = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries?favorite=true`
    );

    const res = await GET(req, { params: Promise.resolve({ id: VALID_PROJECT_ID }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockListProjectQueries).toHaveBeenCalledWith(expect.anything(), {
      projectId: VALID_PROJECT_ID,
      userId: MOCK_USER.id,
      favorite: true,
    });
    expect(data.queries).toEqual([
      {
        ...SAMPLE_QUERY,
        createdAt: "2026-11-25T10:00:00.000Z",
        updatedAt: "2026-11-25T10:00:00.000Z",
      },
    ]);
  });

  // covers: AC-2
  it("maps ForbiddenError to 403 and NotFoundError to 404", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MOCK_USER);
    mockListProjectQueries.mockRejectedValueOnce(new ForbiddenError("Forbidden"));
    const forbiddenReq = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries`
    );
    const forbiddenRes = await GET(forbiddenReq, {
      params: Promise.resolve({ id: VALID_PROJECT_ID }),
    });
    expect(forbiddenRes.status).toBe(403);

    mockListProjectQueries.mockRejectedValueOnce(new NotFoundError("Missing"));
    const notFoundReq = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries`
    );
    const notFoundRes = await GET(notFoundReq, {
      params: Promise.resolve({ id: VALID_PROJECT_ID }),
    });
    expect(notFoundRes.status).toBe(404);
  });
});

describe("POST /api/projects/[id]/queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // covers: AC-2
  it("returns 401 when user is not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const req = new NextRequest(`http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries`, {
      method: "POST",
      body: JSON.stringify({ title: "Q", sql: "SELECT 1;" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: VALID_PROJECT_ID }) });

    expect(res.status).toBe(401);
  });

  // covers: AC-2
  it("returns 400 on invalid JSON or Zod validation errors", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MOCK_USER);

    const badJsonReq = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries`,
      {
        method: "POST",
        body: "{bad-json",
      }
    );
    const badJsonRes = await POST(badJsonReq, {
      params: Promise.resolve({ id: VALID_PROJECT_ID }),
    });
    expect(badJsonRes.status).toBe(400);

    const emptyFieldsReq = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries`,
      {
        method: "POST",
        body: JSON.stringify({ title: "   ", sql: "" }),
      }
    );
    const emptyFieldsRes = await POST(emptyFieldsReq, {
      params: Promise.resolve({ id: VALID_PROJECT_ID }),
    });
    expect(emptyFieldsRes.status).toBe(400);

    const longTitleReq = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries`,
      {
        method: "POST",
        body: JSON.stringify({ title: "a".repeat(121), sql: "SELECT 1;" }),
      }
    );
    const longTitleRes = await POST(longTitleReq, {
      params: Promise.resolve({ id: VALID_PROJECT_ID }),
    });
    expect(longTitleRes.status).toBe(400);
  });

  // covers: AC-2
  it("creates a query snippet and returns 201 with serialized dates", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(MOCK_USER);
    mockCreateProjectQuery.mockResolvedValueOnce(SAMPLE_QUERY);

    const req = new NextRequest(`http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries`, {
      method: "POST",
      body: JSON.stringify({
        title: " All users ",
        sql: " SELECT * FROM users; ",
        description: "Fetch every user",
        isFavorite: true,
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: VALID_PROJECT_ID }) });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(mockCreateProjectQuery).toHaveBeenCalledWith(expect.anything(), {
      projectId: VALID_PROJECT_ID,
      userId: MOCK_USER.id,
      title: "All users",
      sql: "SELECT * FROM users;",
      description: "Fetch every user",
      isFavorite: true,
    });
    expect(data.query.id).toBe(SAMPLE_QUERY.id);
    expect(data.query.createdAt).toBe("2026-11-25T10:00:00.000Z");
  });

  // covers: AC-2
  it("maps domain errors from createProjectQuery to HTTP statuses", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MOCK_USER);
    const makeReq = () =>
      new NextRequest(`http://localhost:3000/api/projects/${VALID_PROJECT_ID}/queries`, {
        method: "POST",
        body: JSON.stringify({ title: "Q", sql: "SELECT 1;" }),
      });

    mockCreateProjectQuery.mockRejectedValueOnce(new ValidationError("Bad SQL"));
    expect(
      (await POST(makeReq(), { params: Promise.resolve({ id: VALID_PROJECT_ID }) })).status
    ).toBe(400);

    mockCreateProjectQuery.mockRejectedValueOnce(new NotFoundError("No project"));
    expect(
      (await POST(makeReq(), { params: Promise.resolve({ id: VALID_PROJECT_ID }) })).status
    ).toBe(404);

    mockCreateProjectQuery.mockRejectedValueOnce(new ForbiddenError("Not owner"));
    expect(
      (await POST(makeReq(), { params: Promise.resolve({ id: VALID_PROJECT_ID }) })).status
    ).toBe(403);
  });
});
