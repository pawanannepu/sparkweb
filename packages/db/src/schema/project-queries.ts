import { desc, relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";

export const projectQueries = pgTable(
  "project_queries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sql: text("sql").notNull(),
    description: text("description"),
    isFavorite: boolean("is_favorite").default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("project_queries_project_id_created_at_idx").on(table.projectId, desc(table.createdAt)),
    index("project_queries_project_id_is_favorite_idx").on(table.projectId, table.isFavorite),
  ]
);

export const projectQueriesRelations = relations(projectQueries, ({ one }) => ({
  project: one(projects, {
    fields: [projectQueries.projectId],
    references: [projects.id],
  }),
}));
