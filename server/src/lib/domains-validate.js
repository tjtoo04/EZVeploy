/**
 * Strict domain normalization + validation (SPEC: Add-domain flow step 1).
 * Wildcard (`*.example.com`), uppercase folded, scheme/path/trailing-dot
 * cleaned if pasted in. Nothing else is accepted.
 */
export const DOMAIN_RE =
 /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeDomain(raw) {
 if (typeof raw !== "string") return "";
 let d = raw.trim().toLowerCase();
 d = d.replace(/^https?:\/\//, "").replace(/^www\./, "");
 const slash = d.indexOf("/");
 if (slash >= 0) d = d.slice(0, slash);
 d = d.replace(/\.+$/, "");
 return d;
}

/** @returns {'' | 'invalid'} empty string when valid, reason otherwise. */
export function validateDomain(raw) {
 const d = normalizeDomain(raw);
 if (!d) return "domain is required";
 if (d.length > 253) return "domain is too long";
 if (!DOMAIN_RE.test(d))
  return "invalid domain — letters, digits, hyphens, dots, and a leading *. wildcard only";
 return "";
}
