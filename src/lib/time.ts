/** The instant `hours` ago. Kept out of components, which must render without reading the clock. */
export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3600 * 1000);
}
