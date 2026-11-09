/** Time helpers for campaign sending windows. Pure functions, no database. */

type Local = { weekday: number; minutes: number; secondsIntoDay: number };

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localTime(timeZone: string, at: Date): Local {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const h = Number(get("hour"));
  const m = Number(get("minute"));
  const s = Number(get("second"));
  return { weekday: WEEKDAYS[get("weekday")] ?? 0, minutes: h * 60 + m, secondsIntoDay: h * 3600 + m * 60 + s };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** True when `at` falls on an active day, between activeFrom (inclusive) and activeTo (exclusive), in the campaign's timezone. */
export function inWindow(c: { timezone: string; activeDays: number[]; activeFrom: string; activeTo: string }, at: Date): boolean {
  const l = localTime(c.timezone, at);
  return c.activeDays.includes(l.weekday) && l.minutes >= toMinutes(c.activeFrom) && l.minutes < toMinutes(c.activeTo);
}

/** Start of the current calendar day in the timezone, as an instant (approximate on DST change days). */
export function startOfLocalDay(timeZone: string, at: Date): Date {
  const l = localTime(timeZone, at);
  return new Date(at.getTime() - l.secondsIntoDay * 1000 - at.getMilliseconds());
}

export const DAY_MS = 24 * 3600 * 1000;
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);

/** Uniform random between min and max. */
export const between = (min: number, max: number) => min + Math.random() * (max - min);
