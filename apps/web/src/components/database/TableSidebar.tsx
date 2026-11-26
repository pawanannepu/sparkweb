"use client";

import type { DbTableMetadata } from "@spark/shared";
import { KeyRound, Lock, Search, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface TableSidebarProps {
  tables: DbTableMetadata[];
  selectedTableName: string | null;
  onSelectTable: (tableName: string) => void;
}

export function TableSidebar({ tables, selectedTableName, onSelectTable }: TableSidebarProps) {
  const [filterText, setFilterText] = useState("");

  const filteredTables = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(q));
  }, [tables, filterText]);

  const activeTable = useMemo(
    () => tables.find((t) => t.name === selectedTableName) ?? null,
    [tables, selectedTableName]
  );

  return (
    <aside
      aria-label="Database tables"
      className="flex w-full shrink-0 flex-col border-b border-border bg-card/40 md:w-60 md:border-b-0 md:border-r"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Tables
        </span>
        <Badge variant="secondary" className="h-5 px-1.5 font-mono text-[10px]">
          {tables.length}
        </Badge>
      </div>

      {tables.length > 5 && (
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter tables..."
              aria-label="Filter tables"
              className="h-7 pl-7 text-xs"
            />
          </div>
        </div>
      )}

      <ScrollArea className="max-h-48 md:max-h-none md:flex-1">
        <nav aria-label="Database table list">
          <ul className="space-y-0.5 p-2">
            {filteredTables.map((table) => {
              const isSelected = table.name === selectedTableName;
              return (
                <li key={table.name}>
                  <button
                    type="button"
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() => onSelectTable(table.name)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Table2
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          isSelected ? "text-indigo-500" : "text-muted-foreground"
                        )}
                        aria-hidden="true"
                      />
                      <span className="truncate font-mono">{table.name}</span>
                    </span>

                    <span className="flex shrink-0 items-center gap-1">
                      {table.isReadOnly && (
                        <span title="No primary key (read only)">
                          <Lock className="h-3 w-3 text-amber-500" aria-label="Read only table" />
                        </span>
                      )}
                      <Badge
                        variant="outline"
                        className="h-4 px-1.5 font-mono text-[10px] font-normal"
                      >
                        {table.rowCount}
                      </Badge>
                    </span>
                  </button>
                </li>
              );
            })}
            {filteredTables.length === 0 && (
              <li className="px-2 py-4 text-center text-xs text-muted-foreground">
                No matching tables
              </li>
            )}
          </ul>
        </nav>

        {/* Selected Table Column Schema Summary */}
        {activeTable && (
          <div className="border-t border-border px-3 py-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Columns ({activeTable.columns.length})
              </span>
            </div>
            <ul className="space-y-1.5">
              {activeTable.columns.map((col) => (
                <li
                  key={col.name}
                  className="flex items-center justify-between gap-1.5 text-[11px]"
                >
                  <span className="flex min-w-0 items-center gap-1 font-mono text-foreground">
                    {col.isPrimaryKey && (
                      <KeyRound
                        className="h-3 w-3 shrink-0 text-amber-500"
                        aria-label="Primary key"
                      />
                    )}
                    <span className="truncate">{col.name}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {col.type}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}
