import {
  createProjectQuery,
  db,
  ForbiddenError,
  listProjectQueries,
  NotFoundError,
  type ProjectQuery,
  ValidationError,
} from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

const createQuerySchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(120, "Title must be 120 characters or fewer"),
  sql: z.string().trim().min(1, "SQL query is required"),
  description: z.string().trim().max(500).optional().nullable(),
  isFavorite: z.boolean().optional(),
});

function serializeQuery(q: ProjectQuery) {
  return {
    id: q.id,
    projectId: q.projectId,
    title: q.title,
    sql: q.sql,
    description: q.description,
    isFavorite: q.isFavorite,
    createdAt: q.createdAt instanceof Date ? q.createdAt.toISOString() : String(q.createdAt),
    updatedAt: q.updatedAt instanceof Date ? q.updatedAt.toISOString() : String(q.updatedAt),
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId)) {
    return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const favParam = searchParams.get("favorite");
  let favorite: boolean | undefined;
  if (favParam === "true") favorite = true;
  else if (favParam === "false") favorite = false;
  else if (favParam !== null) {
    return NextResponse.json({ error: "Invalid favorite filter value" }, { status: 400 });
  }

  try {
    const queries = await listProjectQueries(db, {
      projectId,
      userId: user.id,
      favorite,
    });
    return NextResponse.json({ queries: queries.map(serializeQuery) });
  } catch (err: unknown) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Failed to list project queries", message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId)) {
    return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createQuerySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const created = await createProjectQuery(db, {
      projectId,
      userId: user.id,
      title: parsed.data.title,
      sql: parsed.data.sql,
      description: parsed.data.description ?? null,
      isFavorite: parsed.data.isFavorite,
    });

    return NextResponse.json({ query: serializeQuery(created) }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Failed to create project query", message }, { status: 500 });
  }
}
