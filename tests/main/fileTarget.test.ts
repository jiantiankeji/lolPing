import { describe, expect, it } from 'vitest';
import { hostFromPeerKey } from '../../src/main/fileTcp';

describe('hostFromPeerKey', () => {
  it('takes the host out of a LAN peer key, which carries a kind prefix', () => {
    // Splitting on the last colon alone would hand DNS "lan:192.168.1.5", which fails at once: that is why a file could
    // not be sent at all rather than slowly.
    expect(hostFromPeerKey('lan:192.168.1.5:47474')).toBe('192.168.1.5');
    expect(hostFromPeerKey('lan:10.0.0.7:51000')).toBe('10.0.0.7');
  });

  it('unbrackets an IPv6 host', () => {
    expect(hostFromPeerKey('lan:[fe80::1]:47474')).toBe('fe80::1');
  });

  it('refuses a key that is not a LAN address', () => {
    expect(hostFromPeerKey('internet:abc')).toBeNull();
    expect(hostFromPeerKey('lan::47474')).toBeNull();
    expect(hostFromPeerKey('')).toBeNull();
  });
});
