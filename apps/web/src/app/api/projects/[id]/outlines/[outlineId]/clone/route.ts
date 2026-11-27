import { cloneDesignOutline, db } from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  handleMultimodalRouteError,
  serializeDesignOutline,
  serializePromptMessage,
} from "@/lib/multimodal/serializers";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(
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

  try {
    const cloned = await cloneDesignOutline(db, {
      projectId,
      outlineId,
      userId: user.id,
    });

    return NextResponse.json(
      {
        outline: serializeDesignOutline(cloned.outline),
        outlineMessage: serializePromptMessage(cloned.outlineMessage),
      },
      { status: 201 }
    );
  } catch (err) {
    return handleMultimodalRouteError(err, "Failed to clone design outline");
  }
}
