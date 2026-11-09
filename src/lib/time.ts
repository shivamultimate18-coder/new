/** The instant `hours` ago. Kept out of components, which must render without reading the clock. */
export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3600 * 1000);
}

/** True when the date is still ahead. Kept out of components for the same reason. */
export function isFuture(d: Date | null | undefined): d is Date {
  return !!d && d.getTime() > Date.now();
}
