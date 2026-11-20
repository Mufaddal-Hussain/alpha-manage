"use client";

import { useActionState, useEffect, useRef, startTransition, type FormEvent } from "react";
import type { ActionResult } from "@/lib/errors";

/**
 * Runs a server action from a form without React's automatic reset of every field after submit,
 * so a rejected entry keeps what the person typed and the field errors appear beside it.
 * `resetOnSuccess` clears the form after a successful save (for "add another" forms).
 */
export function useFormAction(
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>,
  { resetOnSuccess = false }: { resetOnSuccess?: boolean } = {},
) {
  const [result, run, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && result?.ok) formRef.current?.reset();
  }, [result, resetOnSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => run(formData));
  }

  return { result, pending, formRef, onSubmit };
}
