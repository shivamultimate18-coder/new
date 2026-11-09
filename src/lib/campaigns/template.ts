/** Template variables for invite notes and fixed messages. */

export const VARIABLES = {
  first_name: "First name",
  last_name: "Last name",
  company: "Company",
  title: "Job title",
} as const;
export type VariableName = keyof typeof VARIABLES;

const VAR_RE = /\{([a-z_]+)\}/g;

export function usedVariables(template: string): string[] {
  return [...new Set([...template.matchAll(VAR_RE)].map((m) => m[1]))];
}

export function unknownVariables(template: string): string[] {
  return usedVariables(template).filter((v) => !(v in VARIABLES));
}

/**
 * Fills a template. If any variable it uses is empty for this lead, the fallback text is sent
 * instead (also filled, and it may only use variables that are present). Returns null when
 * neither can be sent.
 */
export function renderTemplate(
  template: string,
  fallback: string,
  values: Partial<Record<VariableName, string | null | undefined>>,
): string | null {
  const fill = (t: string) => {
    let missing = false;
    const out = t.replace(VAR_RE, (_, name: string) => {
      const v = values[name as VariableName]?.trim();
      if (!v) missing = true;
      return v ?? "";
    });
    return missing ? null : out.trim();
  };
  return fill(template) ?? (fallback.trim() ? fill(fallback) : null);
}

/** LinkedIn's limit for connection request notes. */
export const INVITE_NOTE_MAX = 300;
