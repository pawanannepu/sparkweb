"use client";

import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { PostgreSQL, sql as sqlLang } from "@codemirror/lang-sql";
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  placeholder as cmPlaceholder,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { assessDestructiveSql } from "@spark/sandbox";
import type { DbQueryResponsePayload, DbTableMetadata, ProjectQuerySummary } from "@spark/shared";
import { Bookmark, Clock, Eraser, Lock, Pencil, Play, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { DestructiveSqlDialog } from "./DestructiveSqlDialog";
import { SaveQueryDialog } from "./SaveQueryDialog";

export interface SqlConsoleProps {
  tables: DbTableMetadata[];
  isStreamingLocked: boolean;
  savedQueries: ProjectQuerySummary[];
  isLoadingQueries: boolean;
  onExecuteSql: (rawSql: string) => Promise<DbQueryResponsePayload>;
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
  onAfterWriteSuccess?: () => void;
}

const DEFAULT_SQL =
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;";

export function SqlConsole({
  tables,
  isStreamingLocked,
  savedQueries,
  isLoadingQueries,
  onExecuteSql,
  onSaveSnippet,
  onUpdateSnippet,
  onDeleteSnippet,
  onAfterWriteSuccess,
}: SqlConsoleProps) {
  const { resolvedTheme } = useTheme();
  const [sqlText, setSqlText] = useState(() => {
    if (tables[0]) {
      return `SELECT * FROM "${tables[0].name}" LIMIT 50;`;
    }
    return DEFAULT_SQL;
  });
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<DbQueryResponsePayload | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<ProjectQuerySummary | null>(null);
  const [destructiveConfirm, setDestructiveConfirm] = useState<{
    sql: string;
    reasons: string[];
  } | null>(null);

  const editorHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartmentRef = useRef(new Compartment());
  const sqlCompartmentRef = useRef(new Compartment());
  const sqlTextRef = useRef(sqlText);
  sqlTextRef.current = sqlText;

  const schemaMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const tbl of tables) {
      map[tbl.name] = tbl.columns.map((c) => c.name);
    }
    return map;
  }, [tables]);

  const schemaMapRef = useRef<Record<string, string[]>>({});
  schemaMapRef.current = schemaMap;

  const resolvedThemeRef = useRef(resolvedTheme);
  resolvedThemeRef.current = resolvedTheme;

  const runSqlNow = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      setIsExecuting(true);
      try {
        const res = await onExecuteSql(trimmed);
        setResult(res);
        if (!res.error && !isStreamingLocked) {
          onAfterWriteSuccess?.();
        }
      } catch (err: unknown) {
        setResult({
          id: "err",
          rows: [],
          totalCount: 0,
          executionTimeMs: 0,
          error: err instanceof Error ? err.message : "Failed to execute SQL",
        });
      } finally {
        setIsExecuting(false);
      }
    },
    [isStreamingLocked, onAfterWriteSuccess, onExecuteSql]
  );

  const handleRunTrigger = useCallback(() => {
    const raw = viewRef.current ? viewRef.current.state.doc.toString() : sqlTextRef.current;
    const trimmed = raw.trim();
    if (!trimmed) return;

    if (!isStreamingLocked) {
      const assessment = assessDestructiveSql(trimmed);
      if (assessment.isDestructive) {
        setDestructiveConfirm({
          sql: trimmed,
          reasons: assessment.reasons,
        });
        return;
      }
    }

    runSqlNow(trimmed);
  }, [isStreamingLocked, runSqlNow]);

  const handleRunTriggerRef = useRef(handleRunTrigger);
  handleRunTriggerRef.current = handleRunTrigger;

  // Initialize CodeMirror 6 EditorView
  useEffect(() => {
    if (!editorHostRef.current) return;

    const baseTheme = EditorView.theme({
      "&": {
        fontSize: "13px",
        fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace",
        height: "100%",
        backgroundColor: "transparent",
      },
      ".cm-scroller": {
        overflow: "auto",
        minHeight: "150px",
        maxHeight: "260px",
      },
      ".cm-content": {
        padding: "10px 0",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        borderRight: "1px solid hsl(var(--border))",
        color: "hsl(var(--muted-foreground))",
      },
    });

    const state = EditorState.create({
      doc: sqlTextRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        bracketMatching(),
        autocompletion(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        cmPlaceholder("Write PostgreSQL query... (Cmd/Ctrl + Enter to run)"),
        sqlCompartmentRef.current.of(
          sqlLang({ dialect: PostgreSQL, schema: schemaMapRef.current, upperCaseKeywords: true })
        ),
        themeCompartmentRef.current.of(
          resolvedThemeRef.current === "dark" ? [oneDark, baseTheme] : [baseTheme]
        ),
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              handleRunTriggerRef.current();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setSqlText(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorHostRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Reconfigure SQL schema autocomplete when tables change
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: sqlCompartmentRef.current.reconfigure(
        sqlLang({ dialect: PostgreSQL, schema: schemaMap, upperCaseKeywords: true })
      ),
    });
  }, [schemaMap]);

  // Reconfigure theme when dark/light mode changes
  useEffect(() => {
    if (!viewRef.current) return;
    const baseTheme = EditorView.theme({
      "&": {
        fontSize: "13px",
        fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace",
        height: "100%",
        backgroundColor: "transparent",
      },
      ".cm-scroller": {
        overflow: "auto",
        minHeight: "150px",
        maxHeight: "260px",
      },
      ".cm-content": {
        padding: "10px 0",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        borderRight: "1px solid hsl(var(--border))",
        color: "hsl(var(--muted-foreground))",
      },
    });
    viewRef.current.dispatch({
      effects: themeCompartmentRef.current.reconfigure(
        resolvedTheme === "dark" ? [oneDark, baseTheme] : [baseTheme]
      ),
    });
  }, [resolvedTheme]);

  const replaceEditorText = (newSql: string) => {
    setSqlText(newSql);
    if (viewRef.current) {
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: newSql,
        },
      });
      viewRef.current.focus();
    }
  };

  const visibleSnippets = useMemo(() => {
    if (!showFavoritesOnly) return savedQueries;
    return savedQueries.filter((q) => q.isFavorite);
  }, [savedQueries, showFavoritesOnly]);

  const resultColumns = useMemo(() => {
    if (!result) return [];
    if (result.columns && result.columns.length > 0) return result.columns;
    if (result.rows[0]) return Object.keys(result.rows[0]);
    return [];
  }, [result]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      {/* Main Editor + Results Column */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Console Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/40 px-4 py-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleRunTrigger}
              isLoading={isExecuting}
              disabled={isExecuting || !sqlText.trim()}
              className="h-7 gap-1.5 bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-500"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isStreamingLocked ? "Run Read Only" : "Run Query"}</span>
            </Button>

            {isStreamingLocked && (
              <Badge
                variant="outline"
                className="gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-300"
              >
                <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                SET TRANSACTION READ ONLY
              </Badge>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingSnippet(null);
                setIsSaveDialogOpen(true);
              }}
              disabled={!sqlText.trim()}
              className="h-7 gap-1.5 px-2.5 text-xs"
            >
              <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Save Snippet</span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => replaceEditorText("")}
              disabled={!sqlText}
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
              aria-label="Clear SQL editor"
            >
              <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Clear</span>
            </Button>
          </div>

          {result && !result.error && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className="gap-1 font-mono text-[10px]">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {result.executionTimeMs} ms
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px]">
                {result.rows.length > 0
                  ? `${result.rows.length} rows`
                  : `${result.affectedRows ?? 0} affected`}
              </Badge>
            </div>
          )}
        </div>

        {/* CodeMirror 6 SQL Editor */}
        <section aria-label="SQL Query Editor" className="border-b border-border bg-background/80">
          <div ref={editorHostRef} />
        </section>

        {/* Execution Output Area */}
        <div className="flex-1 overflow-auto bg-background">
          {!result ? (
            <div className="flex h-full min-h-[160px] flex-col items-center justify-center p-6 text-center text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Ready to execute PostgreSQL queries</p>
              <p className="mt-1">
                Press{" "}
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                  Cmd/Ctrl + Enter
                </kbd>{" "}
                or click Run Query.
              </p>
            </div>
          ) : result.error ? (
            <div className="p-4">
              <div
                role="alert"
                className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 font-mono text-xs text-destructive"
              >
                {result.error}
              </div>
            </div>
          ) : result.rows.length === 0 ? (
            <div className="p-4">
              <div
                role="status"
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300"
              >
                Query completed in{" "}
                <strong className="font-mono">{result.executionTimeMs} ms</strong>
                {result.affectedRows !== undefined
                  ? ` (${result.affectedRows} rows affected)`
                  : " (0 rows returned)"}
                .
              </div>
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-border bg-muted/80 backdrop-blur">
                <tr>
                  {resultColumns.map((col) => (
                    <th
                      key={col}
                      scope="col"
                      className="whitespace-nowrap border-r border-border/60 px-3 py-2 font-mono font-medium text-foreground last:border-r-0"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.rows.map((row) => {
                  const rowKey = JSON.stringify(row);
                  return (
                    <tr key={rowKey} className="hover:bg-muted/30">
                      {resultColumns.map((col) => {
                        const val = row[col];
                        return (
                          <td
                            key={col}
                            className="max-w-[280px] truncate whitespace-nowrap border-r border-border/40 px-3 py-1.5 font-mono last:border-r-0"
                          >
                            {val === null || val === undefined ? (
                              <span className="italic text-muted-foreground/70">NULL</span>
                            ) : typeof val === "object" ? (
                              JSON.stringify(val)
                            ) : (
                              String(val)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Saved Query Snippets Drawer */}
      <aside
        aria-label="Saved SQL snippets"
        className="flex w-full shrink-0 flex-col border-t border-border bg-card/40 md:w-72 md:border-l md:border-t-0"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Saved Snippets
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant={!showFavoritesOnly ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowFavoritesOnly(false)}
              className="h-6 px-2 text-[11px]"
            >
              All
            </Button>
            <Button
              type="button"
              variant={showFavoritesOnly ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowFavoritesOnly(true)}
              className="h-6 gap-1 px-2 text-[11px]"
            >
              <Star className="h-3 w-3" aria-hidden="true" />
              <span>Pinned</span>
            </Button>
          </div>
        </div>

        <ScrollArea className="max-h-56 md:max-h-none md:flex-1">
          {isLoadingQueries && savedQueries.length === 0 ? (
            <div className="space-y-2 p-3">
              {["q1", "q2", "q3"].map((skelId) => (
                <div key={skelId} className="h-14 animate-pulse rounded-md bg-muted/60" />
              ))}
            </div>
          ) : visibleSnippets.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              {showFavoritesOnly
                ? "No pinned query snippets yet."
                : "Save frequent queries here to reuse them across sessions."}
            </div>
          ) : (
            <ul className="space-y-2 p-2.5">
              {visibleSnippets.map((snippet) => (
                <li
                  key={snippet.id}
                  className="group rounded-lg border border-border bg-background/70 p-2.5 transition-colors hover:border-indigo-500/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => replaceEditorText(snippet.sql)}
                      className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <p className="truncate text-xs font-semibold text-foreground">
                        {snippet.title}
                      </p>
                      {snippet.description && (
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                          {snippet.description}
                        </p>
                      )}
                      <pre className="mt-1.5 line-clamp-2 overflow-hidden rounded bg-muted/60 px-1.5 py-1 font-mono text-[10px] text-muted-foreground">
                        {snippet.sql}
                      </pre>
                    </button>

                    <div className="flex shrink-0 flex-col gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          onUpdateSnippet(snippet.id, { isFavorite: !snippet.isFavorite })
                        }
                        aria-label={
                          snippet.isFavorite ? "Unpin snippet" : "Pin snippet as favorite"
                        }
                        className="h-6 w-6"
                      >
                        <Star
                          className={cn(
                            "h-3.5 w-3.5",
                            snippet.isFavorite
                              ? "fill-amber-400 text-amber-400"
                              : "text-muted-foreground"
                          )}
                        />
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingSnippet(snippet);
                          setIsSaveDialogOpen(true);
                        }}
                        aria-label="Edit snippet"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onDeleteSnippet(snippet.id)}
                        aria-label="Delete snippet"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </aside>

      <SaveQueryDialog
        isOpen={isSaveDialogOpen}
        onClose={() => {
          setIsSaveDialogOpen(false);
          setEditingSnippet(null);
        }}
        mode={editingSnippet ? "edit" : "create"}
        initialTitle={editingSnippet?.title ?? ""}
        initialDescription={editingSnippet?.description ?? ""}
        initialIsFavorite={editingSnippet?.isFavorite ?? false}
        sqlPreview={editingSnippet ? editingSnippet.sql : sqlText}
        onSave={async ({ title, description, isFavorite }) => {
          if (editingSnippet) {
            await onUpdateSnippet(editingSnippet.id, {
              title,
              description: description || null,
              isFavorite,
            });
          } else {
            await onSaveSnippet({
              title,
              sql: sqlText,
              description: description || undefined,
              isFavorite,
            });
          }
        }}
      />

      <DestructiveSqlDialog
        isOpen={Boolean(destructiveConfirm)}
        onClose={() => setDestructiveConfirm(null)}
        reasons={destructiveConfirm?.reasons ?? []}
        sqlPreview={destructiveConfirm?.sql ?? ""}
        onConfirm={() => {
          if (destructiveConfirm) {
            runSqlNow(destructiveConfirm.sql);
          }
        }}
      />
    </div>
  );
}
