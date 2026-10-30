// This small, local heuristic catches only a few common credential shapes. It is
// not a security scanner: it may miss secrets or flag harmless sample content.
// It returns labels only, never the matched text.
const RULES: { label: string; pattern: RegExp }[] = [
  { label: 'private key marker', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/iu },
  { label: 'GitHub token pattern', pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u },
  { label: 'AWS access key pattern', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u },
  { label: 'credential assignment', pattern: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|private[_-]?key)\b\s*[:=]\s*["']?[^\s"'#,;]{8,}/iu },
  { label: 'authorization token', pattern: /\bauthorization\s*:\s*(?:bearer|basic)\s+[A-Za-z0-9+/_=.\-]{12,}/iu },
];

export function findPotentialSecrets(...fields: string[]): string[] {
  return RULES.filter(({ pattern }) => fields.some((field) => pattern.test(field))).map(({ label }) => label);
}
