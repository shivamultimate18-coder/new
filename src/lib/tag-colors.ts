/** Tag colours. Full class names are written out so Tailwind includes them. */
export const TAG_COLORS = {
  slate: "bg-slate-100 text-slate-800",
  red: "bg-red-100 text-red-800",
  orange: "bg-orange-100 text-orange-800",
  amber: "bg-amber-100 text-amber-900",
  green: "bg-green-100 text-green-800",
  teal: "bg-teal-100 text-teal-800",
  blue: "bg-blue-100 text-blue-800",
  violet: "bg-violet-100 text-violet-800",
  pink: "bg-pink-100 text-pink-800",
} as const;
export type TagColor = keyof typeof TAG_COLORS;
export const tagClass = (c: string) => TAG_COLORS[c as TagColor] ?? TAG_COLORS.slate;
