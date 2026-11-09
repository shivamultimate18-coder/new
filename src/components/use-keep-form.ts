"use client";

import { startTransition } from "react";
import type { FormEvent } from "react";

/**
 * React resets a <form action={...}> after every submit, which wipes what the person typed
 * when the server returns an error. Submitting through onSubmit keeps the fields as they are.
 */
export function keepFieldsOnSubmit(dispatch: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
}
