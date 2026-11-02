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

describe('placeholder and provider-token detection', () => {
  it('ignores recognizable credential-assignment placeholders', () => {
    for (const value of ['YOUR_API_KEY', '<insert-key>', '<token>', 'changeme', 'xxxxxxxx', '$ENV_VAR', 'example', 'example-api-key', 'EXAMPLE_TOKEN']) {
      expect(findPotentialSecrets(`api_key = "${value}"`), value).toEqual([]);
    }
  });

  it('checks every assignment in a field, before or after placeholders', () => {
    for (const field of [
      'password = YOUR_PASSWORD_HERE\npassword = real-secret-123456',
      'password = <token>\npassword = real-secret-123456',
      'password = real-secret-123456\npassword = YOUR_PASSWORD_HERE',
      'password = YOUR_PASSWORD_HERE\npassword = changeme\npassword = real-secret-123456',
    ]) expect(findPotentialSecrets(field)).toEqual(['credential assignment']);
    expect(findPotentialSecrets('password = YOUR_PASSWORD_HERE', 'password = real-secret-123456')).toEqual(['credential assignment']);
  });

  it('does not treat arbitrary example-prefixed credentials as placeholders', () => {
    expect(findPotentialSecrets('password = exampleRealSecret123')).toEqual(['credential assignment']);
    expect(findPotentialSecrets('password = example-private-value-123')).toEqual(['credential assignment']);
  });

  it('detects OpenAI and Slack token prefixes and returns only labels', () => {
    const openai = `sk-${'a'.repeat(20)}`;
    const slack = `xoxb-${'b'.repeat(20)}`;
    const result = findPotentialSecrets(openai, slack);
    expect(result).toEqual(['OpenAI token pattern', 'Slack token pattern']);
    expect(JSON.stringify(result)).not.toContain(openai);
    expect(JSON.stringify(result)).not.toContain(slack);
    for (const type of ['b', 'a', 'p', 'r', 's']) {
      expect(findPotentialSecrets(`xox${type}-${'z'.repeat(20)}`)).toContain('Slack token pattern');
    }
    expect(findPotentialSecrets('sk-short', 'xoxb-short')).toEqual([]);
  });
});
