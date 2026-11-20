"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton, TextInput } from "@/components/ui/form";
import { formatNumber } from "@/lib/numbering";
import { saveNumberSeries } from "@/server/settings";
import type { SeriesStatus } from "@/server/settings-queries";

export function NumberingForm({ status }: { status: SeriesStatus }) {
  const [result, action] = useActionState(saveNumberSeries, null);
  const next = status.lastValue + 1;
  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <input type="hidden" name="series" value={status.series} />
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium">{status.label}</h2>
        <p className="text-sm text-muted">
          Financial year {status.financialYear}: next is{" "}
          <span className="font-mono text-foreground">{formatNumber(status.format, status.financialYear, next)}</span>
        </p>
      </div>
      <FormMessage result={result} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          name="format"
          label="Format"
          defaultValue={status.format}
          hint="{FY} = financial year, {N} = number, {N:4} = number padded to 4 digits"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          result={result}
        />
        <TextInput
          name="nextNumber"
          label="Next number"
          type="number"
          min={status.lastValue > 0 ? next : 1}
          defaultValue={next}
          hint={status.lastValue > 0 ? `${status.lastValue} already issued this year; it can only go up` : "Nothing issued yet; set the number your paper books are on"}
          result={result}
        />
      </div>
      <div>
        <SubmitButton>Save {status.label.toLowerCase()} numbering</SubmitButton>
      </div>
    </form>
  );
}
