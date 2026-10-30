import { describe, expect, it } from 'vitest';
import { findPotentialSecrets } from '../src/sensitive-text';

describe('local credential warning', () => {
  it('flags a few common credential shapes without returning the matching values', () => {
    const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----';
    const github = `ghp_${'a'.repeat(36)}`;
    const aws = `AKIA${'A'.repeat(16)}`;
    const result = findPotentialSecrets(privateKey, github, aws, 'api_key = "my-long-example-secret"', 'Authorization: Bearer abcdefghijklmnop');
    expect(result).toEqual(['private key marker', 'GitHub token pattern', 'AWS access key pattern', 'credential assignment', 'authorization token']);
    expect(JSON.stringify(result)).not.toContain(github);
    expect(JSON.stringify(result)).not.toContain('my-long-example-secret');
  });
  it('returns no claim of safety for ordinary or unknown content and avoids duplicate labels', () => {
    expect(findPotentialSecrets('A normal instruction', 'const answer = 42')).toEqual([]);
    expect(findPotentialSecrets('password=abcdefgh', 'password=othersecret')).toEqual(['credential assignment']);
    // Unknown secret formats intentionally demonstrate the heuristic is incomplete.
    expect(findPotentialSecrets('some-new-provider-token-unknown-format')).toEqual([]);
  });
});
