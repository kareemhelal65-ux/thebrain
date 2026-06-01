/**
 * Tests for Encryption Utility — AES-256-GCM
 *
 * Covers:
 * - encrypt returns ciphertext, iv, tag
 * - decrypt returns original plaintext
 * - decrypt with tampered ciphertext throws
 * - encrypt fails without MASTER_ENCRYPTION_KEY
 * - Round-trip encryption/decryption with various inputs
 */

const crypto = require('crypto');

// Generate a valid 64-char hex key for tests
const TEST_KEY = crypto.randomBytes(32).toString('hex');

describe('encryption', () => {
  let encrypt, decrypt;

  beforeAll(() => {
    process.env.MASTER_ENCRYPTION_KEY = TEST_KEY;
    const mod = require('../../security/encryption');
    encrypt = mod.encrypt;
    decrypt = mod.decrypt;
  });

  afterAll(() => {
    delete process.env.MASTER_ENCRYPTION_KEY;
  });

  beforeEach(() => {
    jest.resetModules();
    process.env.MASTER_ENCRYPTION_KEY = TEST_KEY;
    const mod = require('../../security/encryption');
    encrypt = mod.encrypt;
    decrypt = mod.decrypt;
  });

  describe('encrypt', () => {
    test('returns ciphertext, iv, and tag as hex strings', () => {
      const result = encrypt('Hello World');
      expect(result).toHaveProperty('ciphertext');
      expect(result).toHaveProperty('iv');
      expect(result).toHaveProperty('tag');
      expect(typeof result.ciphertext).toBe('string');
      expect(typeof result.iv).toBe('string');
      expect(typeof result.tag).toBe('string');
      expect(result.ciphertext.length).toBeGreaterThan(0);
      expect(result.iv.length).toBeGreaterThan(0);
      expect(result.tag.length).toBeGreaterThan(0);
    });

    test('produces different ciphertext for same input (different IV)', () => {
      const result1 = encrypt('Same text');
      const result2 = encrypt('Same text');
      expect(result1.ciphertext).not.toBe(result2.ciphertext);
      expect(result1.iv).not.toBe(result2.iv);
    });
  });

  describe('decrypt', () => {
    test('returns original plaintext', () => {
      const original = 'Sensitive API Key: sk-1234567890abcdef';
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted.ciphertext, encrypted.iv, encrypted.tag);
      expect(decrypted).toBe(original);
    });

    test('handles empty string', () => {
      const encrypted = encrypt('');
      const decrypted = decrypt(encrypted.ciphertext, encrypted.iv, encrypted.tag);
      expect(decrypted).toBe('');
    });

    test('handles special characters and Unicode', () => {
      const original = 'Hello 世界! \n\t\r\u00a9';
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted.ciphertext, encrypted.iv, encrypted.tag);
      expect(decrypted).toBe(original);
    });

    test('handles long text', () => {
      const original = 'A'.repeat(10000);
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted.ciphertext, encrypted.iv, encrypted.tag);
      expect(decrypted).toBe(original);
    });
  });

  describe('error handling', () => {
    test('fails to decrypt with tampered ciphertext', () => {
      const encrypted = encrypt('test data');
      const tamperedCiphertext = encrypted.ciphertext.slice(0, -2) + 'ff';
      expect(() => {
        decrypt(tamperedCiphertext, encrypted.iv, encrypted.tag);
      }).toThrow();
    });

    test('fails to decrypt with wrong iv', () => {
      const encrypted = encrypt('test data');
      expect(() => {
        decrypt(encrypted.ciphertext, '00'.repeat(16), encrypted.tag);
      }).toThrow();
    });

    test('fails to decrypt with wrong tag', () => {
      const encrypted = encrypt('test data');
      expect(() => {
        decrypt(encrypted.ciphertext, encrypted.iv, '00'.repeat(16));
      }).toThrow();
    });
  });

  describe('key validation', () => {
    test('throws when MASTER_ENCRYPTION_KEY is missing', () => {
      delete process.env.MASTER_ENCRYPTION_KEY;
      expect(() => encrypt('test')).toThrow();
    });

    test('throws when MASTER_ENCRYPTION_KEY is wrong length', () => {
      process.env.MASTER_ENCRYPTION_KEY = 'tooshort';
      expect(() => encrypt('test')).toThrow();
    });
  });
});
