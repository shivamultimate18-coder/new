/** Helpers for LinkedIn URLs and turning search results or CSV rows into lead rows. */

export type LeadInput = {
  dedupeKey: string;
  linkedinId: string | null;
  publicIdentifier: string | null;
  profileUrl: string | null;
  firstName: string;
  lastName: string;
  headline: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  industry: string | null;
  email: string | null;
  raw: Record<string, unknown>;
};

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};

/** Accepts a Sales Navigator people search URL. Returns an error message or null. */
export function checkSalesNavUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return "That is not a valid web address.";
  }
  if (!/(^|\.)linkedin\.com$/.test(u.hostname)) return "The address must be on linkedin.com.";
  // Unipile accepts people searches and saved lead lists.
  if (!u.pathname.startsWith("/sales/search/people") && !u.pathname.startsWith("/sales/lists/people")) {
    return "Paste the address of a Sales Navigator people search or lead list (it contains /sales/search/people or /sales/lists/people).";
  }
  return null;
}

/** Pulls identifiers out of a profile URL: /in/<slug> or a Sales Navigator /sales/lead/<id>. */
export function parseProfileUrl(input: string | null): {
  publicIdentifier: string | null;
  linkedinId: string | null;
  profileUrl: string | null;
} {
  const none = { publicIdentifier: null, linkedinId: null, profileUrl: null };
  if (!input) return none;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return none;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return none;
  const inMatch = u.pathname.match(/^\/in\/([^/]+)/i);
  if (inMatch) {
    const slug = decodeURIComponent(inMatch[1]).toLowerCase();
    return {
      publicIdentifier: slug,
      linkedinId: null,
      profileUrl: `https://www.linkedin.com/in/${encodeURIComponent(slug)}`,
    };
  }
  const leadMatch = u.pathname.match(/^\/sales\/(?:lead|people)\/([^,/]+)/i);
  if (leadMatch) {
    return { publicIdentifier: null, linkedinId: leadMatch[1], profileUrl: u.toString() };
  }
  return none;
}

function dedupeKey(l: {
  linkedinId: string | null;
  publicIdentifier: string | null;
  firstName: string;
  lastName: string;
  company: string | null;
}): string {
  if (l.linkedinId) return `id:${l.linkedinId}`;
  if (l.publicIdentifier) return `in:${l.publicIdentifier}`;
  return `name:${[l.firstName, l.lastName, l.company ?? ""].join("|").toLowerCase()}`;
}

/** Converts one Unipile people search result. Fields differ between classic and Sales Navigator. */
export function leadFromSearchItem(item: Record<string, unknown>): LeadInput | null {
  const positions = Array.isArray(item.current_positions)
    ? (item.current_positions as Record<string, unknown>[])
    : [];
  const pos = positions[0] ?? {};
  let firstName = clean(item.first_name) ?? "";
  let lastName = clean(item.last_name) ?? "";
  const name = clean(item.name);
  if (!firstName && name) {
    const [first, ...rest] = name.split(/\s+/);
    firstName = first;
    lastName = rest.join(" ");
  }
  // Sales Navigator results carry public_identifier; classic results only have it inside
  // profile_url (https://www.linkedin.com/in/<slug>?miniProfileUrn=...).
  const publicIdentifier =
    clean(item.public_identifier)?.toLowerCase() ??
    parseProfileUrl(clean(item.public_profile_url) ?? clean(item.profile_url)).publicIdentifier;
  const linkedinId = clean(item.id);
  if (!linkedinId && !publicIdentifier) return null;
  const lead = {
    linkedinId,
    publicIdentifier,
    profileUrl:
      clean(item.public_profile_url) ??
      (publicIdentifier ? `https://www.linkedin.com/in/${encodeURIComponent(publicIdentifier)}` : null) ??
      clean(item.profile_url),
    firstName,
    lastName,
    headline: clean(item.headline),
    title: clean(pos.role) ?? clean(item.title),
    company: clean(pos.company) ?? clean(item.company),
    location: clean(item.location),
    industry: clean(item.industry),
    email: null,
    raw: item,
  };
  return { ...lead, dedupeKey: dedupeKey(lead) };
}

// CSV header aliases, compared after lower-casing and removing spaces, dashes and underscores.
const ALIASES: Record<string, string[]> = {
  profileUrl: ["linkedinurl", "linkedin", "linkedinprofile", "linkedinprofileurl", "profileurl", "url", "profile", "personlinkedinurl"],
  firstName: ["firstname", "first", "givenname"],
  lastName: ["lastname", "last", "surname", "familyname"],
  fullName: ["name", "fullname"],
  title: ["title", "jobtitle", "position", "role", "currenttitle"],
  company: ["company", "companyname", "organization", "organisation", "account", "accountname", "currentcompany"],
  headline: ["headline"],
  location: ["location", "city", "geography", "region"],
  industry: ["industry"],
  email: ["email", "emailaddress", "workemail"],
};

export type CsvMapping = Partial<Record<keyof typeof ALIASES, string>>;

export function mapCsvHeaders(headers: string[]): CsvMapping {
  const norm = (h: string) => h.toLowerCase().replace(/[\s_\-.]/g, "");
  const mapping: CsvMapping = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const hit = headers.find((h) => aliases.includes(norm(h)));
    if (hit) mapping[field as keyof CsvMapping] = hit;
  }
  return mapping;
}

/** Returns null when the row has neither a LinkedIn URL nor a name plus company. */
export function leadFromCsvRow(row: Record<string, string>, m: CsvMapping): LeadInput | null {
  const get = (f: keyof CsvMapping) => (m[f] ? clean(row[m[f]!]) : null);
  const ids = parseProfileUrl(get("profileUrl"));
  let firstName = get("firstName") ?? "";
  let lastName = get("lastName") ?? "";
  const full = get("fullName");
  if (!firstName && full) {
    const [first, ...rest] = full.split(/\s+/);
    firstName = first;
    lastName = rest.join(" ");
  }
  const company = get("company");
  if (!ids.publicIdentifier && !ids.linkedinId && !(firstName && company)) return null;
  const lead = {
    ...ids,
    firstName,
    lastName,
    headline: get("headline"),
    title: get("title"),
    company,
    location: get("location"),
    industry: get("industry"),
    email: get("email"),
    raw: row,
  };
  return { ...lead, dedupeKey: dedupeKey(lead) };
}
