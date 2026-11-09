import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ConfirmButton } from "@/components/confirm-button";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { deleteProduct } from "../../actions";
import { ProductForm } from "./product-form";

export const instant = false;
export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({ params }: PageProps<"/voice/products/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [product] = await db.select().from(schema.products).where(eq(schema.products.id, id));
  if (!product) notFound();
  const canDelete = user.role === "admin" || product.createdByUserId === user.id;
  return (
    <div className="max-w-3xl">
      <Link href="/voice" className="text-sm text-muted hover:text-ink">← Voice</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-semibold">{product.name}</h1>
        {canDelete && (
          <form action={deleteProduct}>
            <input type="hidden" name="id" value={product.id} />
            <ConfirmButton message={`Delete "${product.name}"?`} className="btn btn-danger">Delete</ConfirmButton>
          </form>
        )}
      </div>
      <p className="mb-6 mt-1 text-sm text-muted">Fields marked * are needed before messages can be drafted.</p>
      <ProductForm product={product} />
    </div>
  );
}
