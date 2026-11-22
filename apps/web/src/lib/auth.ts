import type { DatabaseClient } from "@spark/db";
import { db, eq, projects, users } from "@spark/db";

export interface UserSession {
  id: string;
  email: string;
  name?: string | null;
}

export const DEMO_USER: UserSession = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "creator@sparkweb.local",
  name: "Sparkweb Creator",
};

export const DEMO_PROJECT_ID = "00000000-0000-0000-0000-000000000001";

export async function ensureDemoUser(database: DatabaseClient = db): Promise<UserSession> {
  const existing = await database
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, DEMO_USER.id))
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    return existing[0];
  }

  try {
    const inserted = await database
      .insert(users)
      .values({
        id: DEMO_USER.id,
        email: DEMO_USER.email,
        name: DEMO_USER.name,
      })
      .returning();

    if (inserted[0]) {
      return inserted[0];
    }
  } catch {
    const fallback = await database
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, DEMO_USER.id))
      .limit(1);
    if (fallback[0]) return fallback[0];
  }

  return DEMO_USER;
}

export async function ensureDemoProject(
  userId: string = DEMO_USER.id,
  database: DatabaseClient = db
) {
  const existing = await database
    .select()
    .from(projects)
    .where(eq(projects.id, DEMO_PROJECT_ID))
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    return existing[0];
  }

  try {
    const created = await database
      .insert(projects)
      .values({
        id: DEMO_PROJECT_ID,
        userId,
        name: "Demo Application",
        slug: "demo-application",
      })
      .returning();

    if (created[0]) return created[0];
  } catch {
    const fallback = await database
      .select()
      .from(projects)
      .where(eq(projects.id, DEMO_PROJECT_ID))
      .limit(1);
    if (fallback[0]) return fallback[0];
  }

  return {
    id: DEMO_PROJECT_ID,
    userId,
    name: "Demo Application",
    slug: "demo-application",
  };
}

export async function getCurrentUser(
  req?: Request,
  database: DatabaseClient = db
): Promise<UserSession | null> {
  if (req) {
    const headerUserId = req.headers.get("x-user-id");
    if (headerUserId) {
      const found = await database
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, headerUserId))
        .limit(1);
      if (found.length > 0 && found[0]) {
        return found[0];
      }
    }
  }

  const user = await ensureDemoUser(database);
  return user;
}
