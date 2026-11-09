function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/** Read lazily so `next build` works without runtime secrets. */
export const env = {
  get DATABASE_URL() {
    return required("DATABASE_URL");
  },
  get APP_URL() {
    return required("APP_URL").replace(/\/+$/, "");
  },
  get AUTH_SECRET() {
    const v = required("AUTH_SECRET");
    if (v.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
    return v;
  },
  get UNIPILE_MOCK() {
    return process.env.UNIPILE_MOCK === "1";
  },
  get UNIPILE_DSN() {
    return required("UNIPILE_DSN").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  },
  get UNIPILE_API_KEY() {
    return required("UNIPILE_API_KEY");
  },
  /** Timezone for daily charts and "today" on Home (IANA name). */
  get APP_TIMEZONE() {
    const tz = process.env.APP_TIMEZONE || "UTC";
    return tz === "UTC" || Intl.supportedValuesOf("timeZone").includes(tz) ? tz : "UTC";
  },
  /** AI_MOCK=1 returns canned drafts without calling Claude (local development). */
  get AI_MOCK() {
    return process.env.AI_MOCK === "1";
  },
  get ANTHROPIC_API_KEY() {
    return process.env.ANTHROPIC_API_KEY ?? "";
  },
  get UNIPILE_WEBHOOK_SECRET() {
    return required("UNIPILE_WEBHOOK_SECRET");
  },
};

export const APP_NAME = "Outreach"; // placeholder until the product has a name
