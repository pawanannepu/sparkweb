import { db, updateDesignOutline } from "@spark/db";
import { DesignOutlinePayloadSchema } from "@spark/shared";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { handleMultimodalRouteError, serializeDesignOutline } from "@/lib/multimodal/serializers";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PatchOutlineSchema = z
  .object({
    editedOutline: DesignOutlinePayloadSchema.optional(),
    reset: z.boolean().optional(),
  })
  .refine((val) => val.reset === true || val.editedOutline !== undefined, {
    message: "Either editedOutline or reset: true must be provided.",
  });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; outlineId: string }> }
) {
  const { id: projectId, outlineId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId) || !isValidUuid(outlineId)) {
    return NextResponse.json({ error: "Invalid project or outline ID" }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PatchOutlineSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid outline update payload" },
      { status: 400 }
    );
  }

  try {
    const updated = await updateDesignOutline(db, {
      projectId,
      outlineId,
      userId: user.id,
      editedOutline: parsed.data.editedOutline,
      reset: parsed.data.reset,
    });

    return NextResponse.json({
      outline: serializeDesignOutline(updated),
    });
  } catch (err) {
    return handleMultimodalRouteError(err, "Failed to update design outline");
  }
}
