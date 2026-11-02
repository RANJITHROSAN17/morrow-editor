// This small, local heuristic catches only a few common credential shapes. It is
// not a security scanner: it may miss secrets or flag harmless sample content.
// It returns labels only, never the matched text.
const RULES: { label: string; pattern: RegExp }[] = [
  { label: 'private key marker', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/iu },
  { label: 'GitHub token pattern', pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u },
  { label: 'AWS access key pattern', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u },
  { label: 'OpenAI token pattern', pattern: /\bsk-[A-Za-z0-9_-]{10,}\b/u },
  { label: 'Slack token pattern', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u },
  { label: 'authorization token', pattern: /\bauthorization\s*:\s*(?:bearer|basic)\s+[A-Za-z0-9+/_=.\-]{12,}/iu },
];

// Capture and inspect each candidate independently; a placeholder must not hide
// another credential assignment later in the same field.
const CREDENTIAL_ASSIGNMENT = /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|private[_-]?key)\b\s*[:=]\s*["']?([^\s"'#,;]{8,})/giu;

function isPlaceholderValue(value: string): boolean {
  if (/^YOUR_[A-Z0-9_]*$/i.test(value)) return true;
  if (/^<[^>]*>$/.test(value)) return true;
  if (/^changeme$/i.test(value)) return true;
  if (/^x{3,}$/i.test(value)) return true;
  if (/^\$[A-Z_][A-Z0-9_]*$/i.test(value)) return true;
  // Only recognizable example placeholders, not arbitrary passwords starting
  // with "example" (which may themselves be real credentials).
  if (/^example(?:[-_](?:api[-_]?key|access[-_]?token|auth[-_]?token|key|token|password|secret))?$/i.test(value)) return true;
  return false;
}

export function findPotentialSecrets(...fields: string[]): string[] {
  const labels = RULES.filter(({ pattern }) => fields.some((field) => pattern.test(field))).map(({ label }) => label);
  const hasCredential = fields.some((field) => {
    for (const match of field.matchAll(CREDENTIAL_ASSIGNMENT)) {
      if (!isPlaceholderValue(match[1])) return true;
    }
    return false;
  });
  // Preserve the established rule order: assignment warnings precede authorization.
  if (hasCredential) {
    const authorizationIndex = labels.indexOf('authorization token');
    labels.splice(authorizationIndex < 0 ? labels.length : authorizationIndex, 0, 'credential assignment');
  }
  return labels;
}
