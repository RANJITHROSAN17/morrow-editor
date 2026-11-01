// This small, local heuristic catches only a few common credential shapes. It is
// not a security scanner: it may miss secrets or flag harmless sample content.
// It returns labels only, never the matched text.
const RULES: { label: string; pattern: RegExp }[] = [
  { label: 'private key marker', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/iu },
  { label: 'GitHub token pattern', pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u },
  { label: 'AWS access key pattern', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u },
  { label: 'OpenAI token pattern', pattern: /\bsk-[A-Za-z0-9_-]{10,}\b/u },
  { label: 'Slack token pattern', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u },
  { label: 'credential assignment', pattern: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|private[_-]?key)\b\s*[:=]\s*["']?[^\s"'#,;]{8,}/iu },
  { label: 'authorization token', pattern: /\bauthorization\s*:\s*(?:bearer|basic)\s+[A-Za-z0-9+/_=.\-]{12,}/iu },
];

function isPlaceholderValue(value: string): boolean {
  const v = value.trim().replace(/^["']|["']$/g, '');
  if (v === '') return true;
  if (/^YOUR_[A-Z0-9_]*$/i.test(v)) return true;
  if (/^<[^>]*>$/.test(v)) return true;
  if (/^changeme$/i.test(v)) return true;
  if (/^x{3,}$/i.test(v)) return true;
  if (/^\$[A-Z_][A-Z0-9_]*$/i.test(v)) return true;
  if (/^example/i.test(v)) return true;
  return false;
}

export function findPotentialSecrets(...fields: string[]): string[] {
  const labels: string[] = [];
  for (const { label, pattern } of RULES) {
    const matched = fields.some((field) => {
      if (!pattern.test(field)) return false;
      if (label === 'credential assignment') {
        const m = field.match(/\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|private[_-]?key)\b\s*[:=]\s*["']?([^\s"'#,;]+)/i);
        if (m && isPlaceholderValue(m[1])) return false;
      }
      return true;
    });
    if (matched) labels.push(label);
  }
  return labels;
}
