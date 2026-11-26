import {
  db,
  deleteProjectQuery,
  ForbiddenError,
  NotFoundError,
  type ProjectQuery,
  updateProjectQuery,
  ValidationError,
} from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

const updateQuerySchema = z
  .object({
    title: z.string().trim().min(1, "Title cannot be empty").max(120).optional(),
    sql: z.string().trim().min(1, "SQL cannot be empty").optional(),
    description: z.string().trim().max(500).nullable().optional(),
    isFavorite: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.sql !== undefined ||
      data.description !== undefined ||
      data.isFavorite !== undefined,
    { message: "At least one field must be provided for update" }
  );

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; queryId: string }> }
) {
  const { id: projectId, queryId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId) || !isValidUuid(queryId)) {
    return NextResponse.json({ error: "Invalid UUID parameter" }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateQuerySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query update payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const updated = await updateProjectQuery(db, {
      projectId,
      queryId,
      userId: user.id,
      ...parsed.data,
    });

    return NextResponse.json({ query: serializeQuery(updated) });
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
    return NextResponse.json({ error: "Failed to update project query", message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; queryId: string }> }
) {
  const { id: projectId, queryId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId) || !isValidUuid(queryId)) {
    return NextResponse.json({ error: "Invalid UUID parameter" }, { status: 400 });
  }

  try {
    const result = await deleteProjectQuery(db, {
      projectId,
      queryId,
      userId: user.id,
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Failed to delete project query", message }, { status: 500 });
  }
}
