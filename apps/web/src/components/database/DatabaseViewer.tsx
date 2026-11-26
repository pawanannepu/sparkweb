"use client";

import type {
  DatabaseViewerMode,
  DbMutateAction,
  DbMutateResponsePayload,
  DbQueryResponsePayload,
  DbTableMetadata,
  ProjectQuerySummary,
} from "@spark/shared";
import {
  CheckCircle2,
  Database,
  Lock,
  RefreshCw,
  Save,
  Sparkles,
  Table2,
  Terminal,
  X,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DataGrid } from "./DataGrid";
import { SqlConsole } from "./SqlConsole";
import { TableSidebar } from "./TableSidebar";

export interface DatabaseViewerProps {
  viewerMode: DatabaseViewerMode;
  tables: DbTableMetadata[];
  selectedTable: DbTableMetadata | null;
  selectedTableName: string | null;
  isIntrospecting: boolean;
  introspectError: string | null;
  rows: Record<string, unknown>[];
  totalCount: number;
  page: number;
  pageSize: number;
  sortColumn?: string;
  sortDirection: "asc" | "desc";
  searchQuery: string;
  isLoadingRows: boolean;
  rowsError: string | null;
  savedQueries: ProjectQuerySummary[];
  isLoadingQueries: boolean;
  isExportingSeed: boolean;
  seedFeedback: { type: "success" | "error"; message: string } | null;
  onDismissSeedFeedback: () => void;
  onSelectTable: (tableName: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onSortChange: (colName: string) => void;
  onSearchChange: (search: string) => void;
  onRefreshAll: () => void;
  onExecuteMutation: (params: {
    action: DbMutateAction;
    table: string;
    record?: Record<string, unknown>;
    where?: Record<string, unknown>;
  }) => Promise<DbMutateResponsePayload>;
  onExecuteRawSql: (rawSql: string) => Promise<DbQueryResponsePayload>;
  onSaveSnippet: (input: {
    title: string;
    sql: string;
    description?: string;
    isFavorite?: boolean;
  }) => Promise<ProjectQuerySummary | null>;
  onUpdateSnippet: (
    queryId: string,
    patch: { title?: string; sql?: string; description?: string | null; isFavorite?: boolean }
  ) => Promise<ProjectQuerySummary | null>;
  onDeleteSnippet: (queryId: string) => Promise<void>;
  onSaveSeedData: () => Promise<void>;
  onAskSparkSchema: (prompt: string) => void;
}

const SCHEMA_PROMPT_SUGGESTIONS = [
  "Add a users table with id, email, name, and created_at",
  "Create a tasks table with title, status enum, and priority",
  "Add a products table with name, price_cents, and inventory_count",
];

export function DatabaseViewer({
  viewerMode,
  tables,
  selectedTable,
  selectedTableName,
  isIntrospecting,
  introspectError,
  rows,
  totalCount,
  page,
  pageSize,
  sortColumn,
  sortDirection,
  searchQuery,
  isLoadingRows,
  rowsError,
  savedQueries,
  isLoadingQueries,
  isExportingSeed,
  seedFeedback,
  onDismissSeedFeedback,
  onSelectTable,
  onPageChange,
  onPageSizeChange,
  onSortChange,
  onSearchChange,
  onRefreshAll,
  onExecuteMutation,
  onExecuteRawSql,
  onSaveSnippet,
  onUpdateSnippet,
  onDeleteSnippet,
  onSaveSeedData,
  onAskSparkSchema,
}: DatabaseViewerProps) {
  const [subView, setSubView] = useState<"table" | "sql">("table");
  const [schemaPrompt, setSchemaPrompt] = useState("");
  const isStreamingLocked = viewerMode === "STREAMING_LOCKED";

  const handleSchemaPromptSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = schemaPrompt.trim();
    if (!trimmed || isStreamingLocked) return;
    onAskSparkSchema(trimmed);
    setSchemaPrompt("");
  };

  return (
    <section
      aria-label="Managed Database Viewer"
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background"
    >
      {/* Top Database Toolbar */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/60 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg bg-muted p-0.5">
            <button
              type="button"
              onClick={() => setSubView("table")}
              aria-pressed={subView === "table"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                subView === "table"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Table Browser</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView("sql")}
              aria-pressed={subView === "sql"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                subView === "sql"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
              <span>SQL Console</span>
            </button>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefreshAll}
            disabled={isIntrospecting || viewerMode === "BOOTING"}
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Refresh database schema"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isIntrospecting && "animate-spin")}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">Sync Schema</span>
          </Button>
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          {/* Quick Conversational Schema Update Shortcut (AC-9) */}
          <form
            onSubmit={handleSchemaPromptSubmit}
            className="flex min-w-[200px] max-w-sm flex-1 items-center gap-1.5"
          >
            <div className="relative flex-1">
              <Sparkles
                className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-indigo-400"
                aria-hidden="true"
              />
              <Input
                value={schemaPrompt}
                onChange={(e) => setSchemaPrompt(e.target.value)}
                disabled={isStreamingLocked}
                placeholder="Ask spark to add a table or column..."
                aria-label="Ask spark to update database schema"
                className="h-7 pl-8 text-xs"
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={!schemaPrompt.trim() || isStreamingLocked}
              className="h-7 px-2.5 text-xs"
            >
              Ask
            </Button>
          </form>

          {/* Save As Seed Data (AC-8) */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSaveSeedData}
            isLoading={isExportingSeed}
            disabled={
              isExportingSeed ||
              isStreamingLocked ||
              viewerMode === "BOOTING" ||
              tables.length === 0
            }
            className="h-7 gap-1.5 px-2.5 text-xs"
          >
            <Save className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
            <span>Save As Seed Data</span>
          </Button>
        </div>
      </header>

      {/* Active Generation Read-Only Lock Banner (AC-9) */}
      {isStreamingLocked && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-200"
        >
          <div className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
            <span>
              <strong>Read Only Lock Active:</strong> AI generation or repair is streaming. Visual
              cell edits, inserts, deletes, and DDL queries are disabled under{" "}
              <code className="rounded bg-amber-500/20 px-1 py-0.5 font-mono text-[11px]">
                SET TRANSACTION READ ONLY
              </code>
              .
            </span>
          </div>
          <Badge variant="outline" className="border-amber-500/40 text-[10px]">
            Locked
          </Badge>
        </div>
      )}

      {/* Seed Snapshot Feedback Banner */}
      {seedFeedback && (
        <div
          role={seedFeedback.type === "error" ? "alert" : "status"}
          className={cn(
            "flex items-center justify-between gap-2 border-b px-4 py-2 text-xs",
            seedFeedback.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          )}
        >
          <span className="flex items-center gap-2">
            {seedFeedback.type === "success" && (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>{seedFeedback.message}</span>
          </span>
          <button
            type="button"
            onClick={onDismissSeedFeedback}
            aria-label="Dismiss notification"
            className="opacity-70 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Introspection Error Banner */}
      {introspectError && (
        <div
          role="alert"
          className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive"
        >
          {introspectError}
        </div>
      )}

      {/* Main Viewer Body */}
      {viewerMode === "BOOTING" ? (
        <div
          className="flex flex-1 overflow-hidden p-4"
          role="status"
          aria-label="Initializing PGlite database"
        >
          <div className="flex w-full gap-4">
            <div className="hidden w-56 space-y-2 md:block">
              <div className="h-6 w-24 animate-pulse rounded bg-muted" />
              <div className="h-9 w-full animate-pulse rounded bg-muted/70" />
              <div className="h-9 w-full animate-pulse rounded bg-muted/70" />
              <div className="h-9 w-full animate-pulse rounded bg-muted/70" />
            </div>
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Database className="h-4 w-4 animate-pulse text-indigo-500" aria-hidden="true" />
                <span>Waiting for in browser PGlite WebAssembly runtime to boot...</span>
              </div>
              <div className="h-10 w-full animate-pulse rounded-md bg-muted/80" />
              {["b1", "b2", "b3", "b4", "b5"].map((skelId) => (
                <div key={skelId} className="h-9 w-full animate-pulse rounded-md bg-muted/50" />
              ))}
            </div>
          </div>
        </div>
      ) : subView === "sql" ? (
        <SqlConsole
          tables={tables}
          isStreamingLocked={isStreamingLocked}
          savedQueries={savedQueries}
          isLoadingQueries={isLoadingQueries}
          onExecuteSql={onExecuteRawSql}
          onSaveSnippet={onSaveSnippet}
          onUpdateSnippet={onUpdateSnippet}
          onDeleteSnippet={onDeleteSnippet}
          onAfterWriteSuccess={onRefreshAll}
        />
      ) : viewerMode === "EMPTY" || tables.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-500 ring-1 ring-indigo-500/20">
            <Database className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-foreground">No tables created yet</h2>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
            Your in browser PGlite PostgreSQL database is ready. Ask spark to design tables in plain
            words, or open the SQL Console to run DDL statements directly.
          </p>

          <div className="mt-5 flex max-w-lg flex-wrap justify-center gap-2">
            {SCHEMA_PROMPT_SUGGESTIONS.map((suggestion) => (
              <Button
                key={suggestion}
                type="button"
                variant="outline"
                size="sm"
                disabled={isStreamingLocked}
                onClick={() => onAskSparkSchema(suggestion)}
                className="h-auto gap-1.5 px-3 py-1.5 text-left text-xs font-normal"
              >
                <Sparkles className="h-3 w-3 shrink-0 text-indigo-400" aria-hidden="true" />
                <span>{suggestion}</span>
              </Button>
            ))}
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setSubView("sql")}
            className="mt-5 gap-1.5 text-xs"
          >
            <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Open SQL Console</span>
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <TableSidebar
            tables={tables}
            selectedTableName={selectedTableName}
            onSelectTable={onSelectTable}
          />
          {selectedTable ? (
            <DataGrid
              key={selectedTable.name}
              table={selectedTable}
              rows={rows}
              totalCount={totalCount}
              page={page}
              pageSize={pageSize}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              searchQuery={searchQuery}
              isLoading={isLoadingRows}
              error={rowsError}
              isStreamingLocked={isStreamingLocked}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
              onSortChange={onSortChange}
              onSearchChange={onSearchChange}
              onRefresh={onRefreshAll}
              onInsertRow={(record) =>
                onExecuteMutation({
                  action: "insert",
                  table: selectedTable.name,
                  record,
                })
              }
              onUpdateCell={(where, column, value) =>
                onExecuteMutation({
                  action: "update",
                  table: selectedTable.name,
                  where,
                  record: { [column]: value },
                })
              }
              onDeleteRow={(where) =>
                onExecuteMutation({
                  action: "delete",
                  table: selectedTable.name,
                  where,
                })
              }
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-xs text-muted-foreground">
              Select a table from the sidebar to inspect records.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
