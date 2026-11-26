"use client";

import type { DbColumnMetadata, DbTableMetadata } from "@spark/shared";
import { Plus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { isBooleanType, isJsonType, isNumericType, parseAndValidateCellValue } from "./value-utils";

export interface AddRecordSheetProps {
  isOpen: boolean;
  onClose: () => void;
  table: DbTableMetadata | null;
  onInsert: (record: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
}

export function AddRecordSheet({ isOpen, onClose, table, onInsert }: AddRecordSheetProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [setNullMap, setSetNullMap] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && table) {
      const initialValues: Record<string, string> = {};
      const initialNulls: Record<string, boolean> = {};
      for (const col of table.columns) {
        initialValues[col.name] = "";
        initialNulls[col.name] = false;
      }
      setValues(initialValues);
      setSetNullMap(initialNulls);
      setFieldErrors({});
      setSubmitError(null);
    }
  }, [isOpen, table]);

  if (!table) return null;

  const isFieldOptionalOrAuto = (col: DbColumnMetadata) =>
    col.isIdentity || col.defaultValue !== null || col.nullable;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    const record: Record<string, unknown> = {};

    for (const col of table.columns) {
      const isNullExplicit = Boolean(setNullMap[col.name]);
      const rawVal = values[col.name] ?? "";

      if (isNullExplicit && col.nullable) {
        record[col.name] = null;
        continue;
      }

      // Omit identity / defaulted fields when left blank so PostgreSQL generates them
      if (rawVal === "" && (col.isIdentity || col.defaultValue !== null)) {
        continue;
      }

      if (rawVal === "" && col.nullable) {
        record[col.name] = null;
        continue;
      }

      if (rawVal === "" && !col.nullable) {
        errors[col.name] = "This field is required";
        continue;
      }

      const parsed = parseAndValidateCellValue(rawVal, col, false);
      if (!parsed.ok) {
        errors[col.name] = parsed.error;
      } else {
        record[col.name] = parsed.value;
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const result = await onInsert(record);
      if (result.success) {
        onClose();
      } else {
        setSubmitError(result.error || "Failed to insert record");
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Failed to insert record");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-indigo-500" aria-hidden="true" />
              <span>Add Record to {table.name}</span>
            </SheetTitle>
            <SheetDescription>
              Identity and defaulted columns are generated automatically if left blank.
            </SheetDescription>
          </SheetHeader>

          {submitError && (
            <div
              role="alert"
              className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {submitError}
            </div>
          )}

          <ScrollArea className="my-4 flex-1 pr-3">
            <div className="space-y-4">
              {table.columns.map((col) => {
                const inputId = `add-record-${col.name}`;
                const errMsg = fieldErrors[col.name];
                const isExplicitNull = Boolean(setNullMap[col.name]);
                const val = values[col.name] ?? "";

                return (
                  <div key={col.name} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor={inputId}
                        className="flex items-center gap-1.5 text-xs font-medium text-foreground"
                      >
                        <span className="font-mono">{col.name}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {col.type}
                        </span>
                        {!isFieldOptionalOrAuto(col) && (
                          <>
                            <span className="text-destructive" aria-hidden="true">
                              *
                            </span>
                            <span className="sr-only"> (required)</span>
                          </>
                        )}
                      </label>

                      {col.nullable && (
                        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={isExplicitNull}
                            onChange={(e) =>
                              setSetNullMap((prev) => ({
                                ...prev,
                                [col.name]: e.target.checked,
                              }))
                            }
                            className="h-3.5 w-3.5 rounded border-border"
                          />
                          <span>NULL</span>
                        </label>
                      )}
                    </div>

                    {col.enumValues && col.enumValues.length > 0 ? (
                      <select
                        id={inputId}
                        value={val}
                        disabled={isExplicitNull}
                        onChange={(e) => {
                          setValues((prev) => ({ ...prev, [col.name]: e.target.value }));
                          setFieldErrors((prev) => ({ ...prev, [col.name]: "" }));
                        }}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                      >
                        <option value="">
                          {col.defaultValue ? `Default (${col.defaultValue})` : "Select value..."}
                        </option>
                        {col.enumValues.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : isBooleanType(col.type) ? (
                      <select
                        id={inputId}
                        value={val}
                        disabled={isExplicitNull}
                        onChange={(e) => {
                          setValues((prev) => ({ ...prev, [col.name]: e.target.value }));
                          setFieldErrors((prev) => ({ ...prev, [col.name]: "" }));
                        }}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                      >
                        <option value="">
                          {col.defaultValue ? `Default (${col.defaultValue})` : "Select boolean..."}
                        </option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : isJsonType(col.type) ? (
                      <Textarea
                        id={inputId}
                        value={val}
                        disabled={isExplicitNull}
                        error={Boolean(errMsg)}
                        placeholder={
                          col.defaultValue ? `Default: ${col.defaultValue}` : '{"key": "value"}'
                        }
                        rows={3}
                        className="font-mono text-xs"
                        onChange={(e) => {
                          setValues((prev) => ({ ...prev, [col.name]: e.target.value }));
                          setFieldErrors((prev) => ({ ...prev, [col.name]: "" }));
                        }}
                      />
                    ) : (
                      <Input
                        id={inputId}
                        type={isNumericType(col.type) ? "number" : "text"}
                        step={col.type.includes("int") ? "1" : "any"}
                        value={val}
                        disabled={isExplicitNull}
                        error={Boolean(errMsg)}
                        placeholder={
                          col.isIdentity
                            ? "Auto-generated identity"
                            : col.defaultValue
                              ? `Default: ${col.defaultValue}`
                              : col.nullable
                                ? "Optional (NULL)"
                                : `Enter ${col.type}...`
                        }
                        className="font-mono text-xs"
                        onChange={(e) => {
                          setValues((prev) => ({ ...prev, [col.name]: e.target.value }));
                          setFieldErrors((prev) => ({ ...prev, [col.name]: "" }));
                        }}
                      />
                    )}

                    {errMsg && (
                      <p role="alert" className="text-[11px] font-medium text-destructive">
                        {errMsg}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          <SheetFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting} disabled={isSubmitting}>
              Insert Record
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
