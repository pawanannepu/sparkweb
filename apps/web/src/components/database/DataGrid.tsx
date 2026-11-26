"use client";

import type { DbColumnMetadata, DbTableMetadata } from "@spark/shared";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AddRecordSheet } from "./AddRecordSheet";
import { DeleteRowDialog } from "./DeleteRowDialog";
import {
  extractPrimaryKeyWhere,
  isBooleanType,
  parseAndValidateCellValue,
  valueToInputString,
} from "./value-utils";

export interface DataGridProps {
  table: DbTableMetadata;
  rows: Record<string, unknown>[];
  totalCount: number;
  page: number;
  pageSize: number;
  sortColumn?: string;
  sortDirection: "asc" | "desc";
  searchQuery: string;
  isLoading: boolean;
  error: string | null;
  isStreamingLocked: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onSortChange: (colName: string) => void;
  onSearchChange: (search: string) => void;
  onRefresh: () => void;
  onInsertRow: (record: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  onUpdateCell: (
    where: Record<string, unknown>,
    column: string,
    value: unknown
  ) => Promise<{ success: boolean; error?: string }>;
  onDeleteRow: (where: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
}

interface EditingTarget {
  rowIndex: number;
  columnName: string;
}

interface InlineCellEditorProps {
  column: DbColumnMetadata;
  tableColumns: DbColumnMetadata[];
  row: Record<string, unknown>;
  initialValue: unknown;
  onUpdateCell: (
    where: Record<string, unknown>,
    column: string,
    value: unknown
  ) => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
}

/**
 * Self-contained inline cell editor so keystrokes update local draft state without
 * recreating TanStack Table column definitions or remounting the focused input.
 */
function InlineCellEditor({
  column,
  tableColumns,
  row,
  initialValue,
  onUpdateCell,
  onClose,
}: InlineCellEditorProps) {
  const [draftValue, setDraftValue] = useState(() => valueToInputString(initialValue));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    } else if (selectRef.current) {
      selectRef.current.focus();
    }
  }, []);

  const commitEdit = async () => {
    const parsed = parseAndValidateCellValue(draftValue, column, true);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    const where = extractPrimaryKeyWhere(row, tableColumns);
    if (Object.keys(where).length === 0) {
      onClose();
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const res = await onUpdateCell(where, column.name, parsed.value);
      if (res.success) {
        onClose();
      } else {
        setIsSaving(false);
        setError(res.error || "Update failed");
      }
    } catch (err: unknown) {
      setIsSaving(false);
      setError(err instanceof Error ? err.message : "Update failed");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitEdit();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="min-w-[140px] space-y-1">
      <div className="flex items-center gap-1">
        {column.enumValues && column.enumValues.length > 0 ? (
          <select
            ref={selectRef}
            value={draftValue}
            disabled={isSaving}
            onChange={(e) => {
              setDraftValue(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            aria-label={`Edit ${column.name}`}
            className="h-7 flex-1 rounded border border-ring bg-background px-1.5 font-mono text-xs focus:outline-none"
          >
            {column.nullable && <option value="">NULL</option>}
            {column.enumValues.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ) : isBooleanType(column.type) ? (
          <select
            ref={selectRef}
            value={draftValue}
            disabled={isSaving}
            onChange={(e) => {
              setDraftValue(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            aria-label={`Edit ${column.name}`}
            className="h-7 flex-1 rounded border border-ring bg-background px-1.5 font-mono text-xs focus:outline-none"
          >
            {column.nullable && <option value="">NULL</option>}
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : (
          <Input
            ref={inputRef}
            value={draftValue}
            disabled={isSaving}
            error={Boolean(error)}
            onChange={(e) => {
              setDraftValue(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            className="h-7 px-2 font-mono text-xs"
            aria-label={`Edit ${column.name}`}
          />
        )}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0 text-emerald-500 hover:text-emerald-400"
          disabled={isSaving}
          onClick={() => void commitEdit()}
          aria-label="Save cell edit"
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          disabled={isSaving}
          onClick={onClose}
          aria-label="Cancel cell edit"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[10px] font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function DataGrid({
  table,
  rows,
  totalCount,
  page,
  pageSize,
  sortColumn,
  sortDirection,
  searchQuery,
  isLoading,
  error,
  isStreamingLocked,
  onPageChange,
  onPageSizeChange,
  onSortChange,
  onSearchChange,
  onRefresh,
  onInsertRow,
  onUpdateCell,
  onDeleteRow,
}: DataGridProps) {
  const [searchDraft, setSearchDraft] = useState(searchQuery);
  const [editingTarget, setEditingTarget] = useState<EditingTarget | null>(null);
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const [rowPendingDelete, setRowPendingDelete] = useState<Record<string, unknown> | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const isReadOnly = table.isReadOnly || isStreamingLocked;

  useEffect(() => {
    setSearchDraft(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (isReadOnly) {
      setEditingTarget(null);
    }
  }, [isReadOnly]);

  // Debounce search query updates
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchDraft !== searchQuery) {
        onSearchChange(searchDraft);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [searchDraft, searchQuery, onSearchChange]);

  // Clear inline edit when rows refresh
  const handlePageNav = (nextPage: number) => {
    setEditingTarget(null);
    setMutationError(null);
    onPageChange(nextPage);
  };

  const handleSortCol = useCallback(
    (colName: string) => {
      setEditingTarget(null);
      setMutationError(null);
      onSortChange(colName);
    },
    [onSortChange]
  );

  const startEditing = useCallback(
    (rowIndex: number, col: DbColumnMetadata) => {
      if (isReadOnly) return;
      setMutationError(null);
      setEditingTarget({
        rowIndex,
        columnName: col.name,
      });
    },
    [isReadOnly]
  );

  const closeEditing = useCallback(() => {
    setEditingTarget(null);
  }, []);

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    const dataCols: ColumnDef<Record<string, unknown>>[] = table.columns.map((col) => ({
      id: col.name,
      accessorFn: (row) => row[col.name],
      header: () => {
        const isSorted = sortColumn === col.name;
        return (
          <button
            type="button"
            onClick={() => handleSortCol(col.name)}
            className="flex w-full items-center justify-between gap-1.5 text-left text-xs font-medium text-foreground hover:text-indigo-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="flex items-center gap-1 truncate">
              {col.isPrimaryKey && (
                <KeyRound className="h-3 w-3 shrink-0 text-amber-500" aria-label="Primary key" />
              )}
              <span className="truncate font-mono">{col.name}</span>
              <span className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] font-normal text-muted-foreground">
                {col.type}
              </span>
            </span>
            {isSorted ? (
              sortDirection === "asc" ? (
                <ArrowUp className="h-3 w-3 shrink-0 text-indigo-500" aria-hidden="true" />
              ) : (
                <ArrowDown className="h-3 w-3 shrink-0 text-indigo-500" aria-hidden="true" />
              )
            ) : (
              <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" aria-hidden="true" />
            )}
          </button>
        );
      },
      cell: ({ row }) => {
        const rowIdx = row.index;
        const val = row.original[col.name];
        const isEditing =
          editingTarget?.rowIndex === rowIdx && editingTarget?.columnName === col.name;

        if (isEditing) {
          return (
            <InlineCellEditor
              key={`${rowIdx}:${col.name}`}
              column={col}
              tableColumns={table.columns}
              row={row.original}
              initialValue={val}
              onUpdateCell={onUpdateCell}
              onClose={closeEditing}
            />
          );
        }

        const displayContent =
          val === null || val === undefined ? (
            <span className="italic text-muted-foreground/70">NULL</span>
          ) : typeof val === "boolean" ? (
            <Badge variant={val ? "success" : "secondary"} className="h-5 font-mono text-[10px]">
              {String(val)}
            </Badge>
          ) : typeof val === "object" ? (
            <span className="block max-w-[260px] truncate font-mono text-xs">
              {JSON.stringify(val)}
            </span>
          ) : (
            <span className="block max-w-[260px] truncate font-mono text-xs">{String(val)}</span>
          );

        if (isReadOnly) {
          return <div className="px-1 py-0.5">{displayContent}</div>;
        }

        return (
          <button
            type="button"
            onClick={() => startEditing(rowIdx, col)}
            title="Click to edit cell"
            className="w-full rounded px-1 py-0.5 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {displayContent}
          </button>
        );
      },
    }));

    const actionCol: ColumnDef<Record<string, unknown>> = {
      id: "__actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={isReadOnly}
          onClick={() => setRowPendingDelete(row.original)}
          aria-label="Delete row"
          title={
            table.isReadOnly
              ? "Table has no primary key (read only)"
              : isStreamingLocked
                ? "Disabled while AI generation is streaming"
                : "Delete row"
          }
          className="h-7 w-7 text-muted-foreground hover:text-destructive disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      ),
    };

    return [...dataCols, actionCol];
  }, [
    table.columns,
    table.isReadOnly,
    sortColumn,
    sortDirection,
    handleSortCol,
    editingTarget,
    isReadOnly,
    isStreamingLocked,
    startEditing,
    closeEditing,
    onUpdateCell,
  ]);

  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));

  const reactTable = useReactTable({
    data: rows,
    columns,
    pageCount,
    state: {
      pagination: {
        pageIndex: page - 1,
        pageSize,
      },
    },
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    getCoreRowModel: getCoreRowModel(),
  });

  const startRow = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRow = Math.min(totalCount, page * pageSize);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      {/* Grid Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-sm font-semibold text-foreground">{table.name}</h2>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {totalCount} {totalCount === 1 ? "row" : "rows"}
          </Badge>
          {table.isReadOnly && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-300"
            >
              <Lock className="h-2.5 w-2.5" aria-hidden="true" />
              Read Only (No PK)
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-48 sm:w-56">
            <Search
              className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search rows..."
              aria-label="Search table rows"
              className="h-7 pl-7 pr-7 text-xs"
            />
            {searchDraft && (
              <button
                type="button"
                onClick={() => {
                  setSearchDraft("");
                  onSearchChange("");
                }}
                aria-label="Clear search"
                className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            className="h-7 gap-1.5 px-2.5 text-xs"
            aria-label="Refresh table rows"
          >
            <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} aria-hidden="true" />
            <span>Refresh</span>
          </Button>

          <Button
            type="button"
            size="sm"
            disabled={isStreamingLocked || table.isReadOnly}
            onClick={() => setIsAddSheetOpen(true)}
            className="h-7 gap-1.5 bg-indigo-600 px-2.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Add Record</span>
          </Button>
        </div>
      </div>

      {/* Error Feedback */}
      {(error || mutationError) && (
        <div
          role="alert"
          className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive"
        >
          {error || mutationError}
        </div>
      )}

      {/* Table Viewport */}
      <div className="flex-1 overflow-auto">
        {isLoading && rows.length === 0 ? (
          <div className="space-y-2 p-4" role="status" aria-label="Loading table rows">
            {["s1", "s2", "s3", "s4", "s5", "s6"].map((skelId) => (
              <div key={skelId} className="h-9 w-full animate-pulse rounded-md bg-muted/60" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full min-h-[220px] flex-col items-center justify-center p-6 text-center">
            <p className="text-sm font-medium text-foreground">
              {searchQuery ? "No matching records found" : `No records in ${table.name}`}
            </p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              {searchQuery
                ? "Try clearing or adjusting your search filter."
                : "Insert your first record directly or interact with your app preview."}
            </p>
            {!searchQuery && !isStreamingLocked && !table.isReadOnly && (
              <Button
                type="button"
                size="sm"
                onClick={() => setIsAddSheetOpen(true)}
                className="mt-4 gap-1.5 bg-indigo-600 text-xs text-white hover:bg-indigo-500"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add First Record</span>
              </Button>
            )}
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-border bg-muted/80 backdrop-blur">
              {reactTable.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      scope="col"
                      className="whitespace-nowrap border-r border-border/60 px-3 py-2 font-medium last:border-r-0"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border">
              {reactTable.getRowModel().rows.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-muted/30">
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="whitespace-nowrap border-r border-border/40 px-2.5 py-1.5 align-middle last:border-r-0"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Footer */}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card/40 px-4 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>
            Showing <strong className="font-mono text-foreground">{startRow}</strong>–
            <strong className="font-mono text-foreground">{endRow}</strong> of{" "}
            <strong className="font-mono text-foreground">{totalCount}</strong>
          </span>
          <label className="flex items-center gap-1.5">
            <span>Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1);
              }}
              aria-label="Rows per page"
              className="h-6 rounded border border-border bg-background px-1.5 font-mono text-xs text-foreground"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="mr-1 font-mono">
            Page {page} of {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={page <= 1 || isLoading}
            onClick={() => handlePageNav(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={page >= pageCount || isLoading}
            onClick={() => handlePageNav(page + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </footer>

      {/* Add Record Slide-over Sheet */}
      <AddRecordSheet
        isOpen={isAddSheetOpen}
        onClose={() => setIsAddSheetOpen(false)}
        table={table}
        onInsert={onInsertRow}
      />

      {/* Delete Row Confirmation Modal */}
      <DeleteRowDialog
        isOpen={Boolean(rowPendingDelete)}
        onClose={() => setRowPendingDelete(null)}
        tableName={table.name}
        primaryKeyValues={
          rowPendingDelete ? extractPrimaryKeyWhere(rowPendingDelete, table.columns) : null
        }
        onConfirm={async () => {
          if (!rowPendingDelete) return { success: false, error: "No row selected" };
          const where = extractPrimaryKeyWhere(rowPendingDelete, table.columns);
          const res = await onDeleteRow(where);
          if (!res.success && res.error) {
            setMutationError(res.error);
          }
          return res;
        }}
      />
    </div>
  );
}
