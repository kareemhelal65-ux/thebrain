const crypto = require('crypto');

/**
 * Encryption Utility — AES-256-GCM
 * 
 * Used for encrypting and decrypting sensitive credentials (API keys, secrets).
 * Relies on MASTER_ENCRYPTION_KEY from environment variables.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // For AES-GCM, 12-16 bytes is recommended
const AUTH_TAG_LENGTH = 16;

const getMasterKey = () => {
  const key = process.env.MASTER_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('MASTER_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).');
  }
  return Buffer.from(key, 'hex');
};

/**
 * Encrypt a string using AES-256-GCM
 * @param {string} text - The plaintext to encrypt
 * @returns {Object} { ciphertext, iv, tag } as hex strings
 */
function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getMasterKey(), iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex')
  };
}

/**
 * Decrypt a string using AES-256-GCM
 * @param {string} ciphertext - The hex encrypted text
 * @param {string} iv - The hex initialization vector
 * @param {string} tag - The hex authentication tag
 * @returns {string} The decrypted plaintext
 */
function decrypt(ciphertext, iv, tag) {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getMasterKey(),
    Buffer.from(iv, 'hex')
  );

  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = {
  encrypt,
  decrypt
};
