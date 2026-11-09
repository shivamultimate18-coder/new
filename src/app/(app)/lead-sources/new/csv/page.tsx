import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { CsvForm } from "../forms";

export const instant = false;
export const metadata: Metadata = { title: "Upload a CSV" };

export default async function CsvPage() {
  await requireUser();
  return (
    <div className="max-w-2xl">
      <Link href="/lead-sources/new" className="text-sm text-muted hover:text-ink">← Back</Link>
      <h1 className="mt-2 text-xl font-semibold">Upload a CSV</h1>
      <p className="mt-1 text-sm text-muted">
        Rows with the same LinkedIn profile are imported once. Rows without a LinkedIn URL or a name and company are skipped.
      </p>
      <div className="mt-6">
        <CsvForm />
      </div>
    </div>
  );
}
