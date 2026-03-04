/**
 * SSH Key Management for Bernard's Fleet
 *
 * Handles generation, storage, distribution, and rotation of SSH keys
 * used for remote management of 25o1 instances.
 *
 * Key lifecycle:
 * 1. Generate: Creates Ed25519 keypair per instance
 * 2. Store: Bernard keeps private keys in ~/.openclaw/bernard/keys/
 * 3. Distribute: Public key deployed during client setup
 * 4. Rotate: Annual rotation, Bernard initiates, client confirms
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, access, readdir, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// =============================================================================
// Types
// =============================================================================

export interface KeyPair {
  instanceId: string;
  privateKeyPath: string;
  publicKeyPath: string;
  publicKey: string;
  createdAt: Date;
  expiresAt: Date;
  fingerprint: string;
}

export interface KeyInfo {
  instanceId: string;
  privateKeyPath: string;
  publicKeyPath: string;
  fingerprint: string;
  createdAt: Date;
  expiresAt: Date;
  daysUntilExpiry: number;
  needsRotation: boolean;
}

export interface KeyManagerConfig {
  /** Base directory for storing keys */
  keysDir: string;

  /** Key validity period in days (default 365) */
  keyValidityDays: number;

  /** Days before expiry to trigger rotation warning */
  rotationWarningDays: number;

  /** Logger */
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface KeyRotationResult {
  success: boolean;
  instanceId: string;
  oldFingerprint?: string;
  newFingerprint?: string;
  error?: string;
}

// =============================================================================
// Defaults
// =============================================================================

/**
 * Get the default keys directory within 25o1's data directory.
 * Uses XDG_DATA_HOME if set, otherwise ~/.local/share/25o1/keys
 */
export function getDefaultKeysDir(): string {
  const xdgData = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(xdgData, "25o1", "keys");
}

export const DEFAULT_KEY_CONFIG: Omit<KeyManagerConfig, "logger"> = {
  keysDir: getDefaultKeysDir(),
  keyValidityDays: 365,
  rotationWarningDays: 30,
};

// =============================================================================
// Key Manager
// =============================================================================

export class KeyManager {
  private config: KeyManagerConfig;
  private initialized = false;

  constructor(config: Partial<KeyManagerConfig> & { logger: KeyManagerConfig["logger"] }) {
    this.config = {
      ...DEFAULT_KEY_CONFIG,
      ...config,
    };
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure keys directory exists with proper permissions
    await mkdir(this.config.keysDir, { recursive: true, mode: 0o700 });
    this.initialized = true;
    this.config.logger.info(`Key manager initialized at ${this.config.keysDir}`);
  }

  // ---------------------------------------------------------------------------
  // Key Generation
  // ---------------------------------------------------------------------------

  /**
   * Generate a new SSH keypair for an instance.
   */
  async generateKeyPair(instanceId: string): Promise<KeyPair> {
    await this.initialize();

    const privateKeyPath = this.getPrivateKeyPath(instanceId);
    const publicKeyPath = this.getPublicKeyPath(instanceId);

    // Ensure parent directory exists
    await mkdir(dirname(privateKeyPath), { recursive: true, mode: 0o700 });

    // Check if key already exists
    try {
      await access(privateKeyPath);
      throw new Error(`Key already exists for instance ${instanceId}. Use rotateKey() instead.`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
      // Key doesn't exist, good to proceed
    }

    // Generate Ed25519 key (more secure, shorter than RSA)
    const comment = `25o1-${instanceId}@bernard`;
    await this.execCommand("ssh-keygen", [
      "-t", "ed25519",
      "-f", privateKeyPath,
      "-N", "", // No passphrase (keys protected by filesystem permissions)
      "-C", comment,
    ]);

    // Set restrictive permissions
    await this.execCommand("chmod", ["600", privateKeyPath]);
    await this.execCommand("chmod", ["644", publicKeyPath]);

    // Read public key and fingerprint
    const publicKey = await readFile(publicKeyPath, "utf-8");
    const fingerprint = await this.getKeyFingerprint(publicKeyPath);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.keyValidityDays * 24 * 60 * 60 * 1000);

    // Store metadata
    await this.saveKeyMetadata(instanceId, {
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      fingerprint,
    });

    this.config.logger.info(`Generated new keypair for ${instanceId}: ${fingerprint}`);

    return {
      instanceId,
      privateKeyPath,
      publicKeyPath,
      publicKey: publicKey.trim(),
      createdAt: now,
      expiresAt,
      fingerprint,
    };
  }

  // ---------------------------------------------------------------------------
  // Key Retrieval
  // ---------------------------------------------------------------------------

  /**
   * Get key info for an instance.
   */
  async getKeyInfo(instanceId: string): Promise<KeyInfo | null> {
    await this.initialize();

    const privateKeyPath = this.getPrivateKeyPath(instanceId);

    try {
      await access(privateKeyPath);
    } catch {
      return null;
    }

    const publicKeyPath = this.getPublicKeyPath(instanceId);
    const metadata = await this.loadKeyMetadata(instanceId);

    const createdAt = metadata?.createdAt ? new Date(metadata.createdAt) : new Date();
    const expiresAt = metadata?.expiresAt
      ? new Date(metadata.expiresAt)
      : new Date(createdAt.getTime() + this.config.keyValidityDays * 24 * 60 * 60 * 1000);

    const now = new Date();
    const daysUntilExpiry = Math.floor((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    const needsRotation = daysUntilExpiry <= this.config.rotationWarningDays;

    const fingerprint = metadata?.fingerprint || await this.getKeyFingerprint(publicKeyPath);

    return {
      instanceId,
      privateKeyPath,
      publicKeyPath,
      fingerprint,
      createdAt,
      expiresAt,
      daysUntilExpiry,
      needsRotation,
    };
  }

  /**
   * Get public key for distribution to an instance.
   */
  async getPublicKey(instanceId: string): Promise<string | null> {
    await this.initialize();

    const publicKeyPath = this.getPublicKeyPath(instanceId);

    try {
      const content = await readFile(publicKeyPath, "utf-8");
      return content.trim();
    } catch {
      return null;
    }
  }

  /**
   * List all managed keys.
   */
  async listKeys(): Promise<KeyInfo[]> {
    await this.initialize();

    try {
      const files = await readdir(this.config.keysDir);
      const privateKeyFiles = files.filter((f) => !f.endsWith(".pub") && !f.endsWith(".json"));

      const results: KeyInfo[] = [];
      for (const file of privateKeyFiles) {
        const instanceId = file;
        const info = await this.getKeyInfo(instanceId);
        if (info) {
          results.push(info);
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Get keys that need rotation.
   */
  async getKeysNeedingRotation(): Promise<KeyInfo[]> {
    const allKeys = await this.listKeys();
    return allKeys.filter((k) => k.needsRotation);
  }

  // ---------------------------------------------------------------------------
  // Key Rotation
  // ---------------------------------------------------------------------------

  /**
   * Rotate a key - generates new keypair, returns both for transition period.
   *
   * Rotation process:
   * 1. Generate new key with .new suffix
   * 2. Return new public key for deployment
   * 3. After confirmation, call confirmRotation() to finalize
   */
  async startKeyRotation(instanceId: string): Promise<{
    newPublicKey: string;
    newFingerprint: string;
    oldFingerprint: string;
  }> {
    await this.initialize();

    const currentInfo = await this.getKeyInfo(instanceId);
    if (!currentInfo) {
      throw new Error(`No existing key for instance ${instanceId}`);
    }

    // Generate new key with .new suffix
    const newPrivateKeyPath = `${this.getPrivateKeyPath(instanceId)}.new`;
    const newPublicKeyPath = `${newPrivateKeyPath}.pub`;
    const comment = `25o1-${instanceId}@bernard`;

    await this.execCommand("ssh-keygen", [
      "-t", "ed25519",
      "-f", newPrivateKeyPath,
      "-N", "",
      "-C", comment,
    ]);

    await this.execCommand("chmod", ["600", newPrivateKeyPath]);
    await this.execCommand("chmod", ["644", newPublicKeyPath]);

    const newPublicKey = await readFile(newPublicKeyPath, "utf-8");
    const newFingerprint = await this.getKeyFingerprint(newPublicKeyPath);

    this.config.logger.info(
      `Started key rotation for ${instanceId}: ${currentInfo.fingerprint} -> ${newFingerprint}`
    );

    return {
      newPublicKey: newPublicKey.trim(),
      newFingerprint,
      oldFingerprint: currentInfo.fingerprint,
    };
  }

  /**
   * Confirm key rotation after new key has been deployed.
   */
  async confirmRotation(instanceId: string): Promise<KeyRotationResult> {
    await this.initialize();

    const privateKeyPath = this.getPrivateKeyPath(instanceId);
    const publicKeyPath = this.getPublicKeyPath(instanceId);
    const newPrivateKeyPath = `${privateKeyPath}.new`;
    const newPublicKeyPath = `${newPrivateKeyPath}.pub`;

    try {
      await access(newPrivateKeyPath);
    } catch {
      return {
        success: false,
        instanceId,
        error: "No pending rotation found",
      };
    }

    const oldInfo = await this.getKeyInfo(instanceId);
    const oldFingerprint = oldInfo?.fingerprint;

    // Archive old key
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const archivePrivate = `${privateKeyPath}.old-${timestamp}`;
    const archivePublic = `${publicKeyPath}.old-${timestamp}`;

    await this.execCommand("mv", [privateKeyPath, archivePrivate]);
    await this.execCommand("mv", [publicKeyPath, archivePublic]);

    // Move new key to primary
    await this.execCommand("mv", [newPrivateKeyPath, privateKeyPath]);
    await this.execCommand("mv", [newPublicKeyPath, publicKeyPath]);

    const newFingerprint = await this.getKeyFingerprint(publicKeyPath);

    // Update metadata
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.keyValidityDays * 24 * 60 * 60 * 1000);
    await this.saveKeyMetadata(instanceId, {
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      fingerprint: newFingerprint,
      rotatedFrom: oldFingerprint,
      rotatedAt: now.toISOString(),
    });

    this.config.logger.info(`Completed key rotation for ${instanceId}: ${newFingerprint}`);

    return {
      success: true,
      instanceId,
      oldFingerprint,
      newFingerprint,
    };
  }

  /**
   * Cancel a pending key rotation.
   */
  async cancelRotation(instanceId: string): Promise<void> {
    const newPrivateKeyPath = `${this.getPrivateKeyPath(instanceId)}.new`;
    const newPublicKeyPath = `${newPrivateKeyPath}.pub`;

    try {
      await unlink(newPrivateKeyPath);
      await unlink(newPublicKeyPath);
      this.config.logger.info(`Cancelled key rotation for ${instanceId}`);
    } catch {
      // Files don't exist, nothing to cancel
    }
  }

  // ---------------------------------------------------------------------------
  // Key Deletion
  // ---------------------------------------------------------------------------

  /**
   * Remove keys for an instance (e.g., when unregistering).
   */
  async removeKeys(instanceId: string): Promise<void> {
    await this.initialize();

    const privateKeyPath = this.getPrivateKeyPath(instanceId);
    const publicKeyPath = this.getPublicKeyPath(instanceId);
    const metadataPath = this.getMetadataPath(instanceId);

    for (const path of [privateKeyPath, publicKeyPath, metadataPath]) {
      try {
        await unlink(path);
      } catch {
        // Ignore if doesn't exist
      }
    }

    this.config.logger.info(`Removed keys for ${instanceId}`);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getPrivateKeyPath(instanceId: string): string {
    return join(this.config.keysDir, instanceId);
  }

  private getPublicKeyPath(instanceId: string): string {
    return `${this.getPrivateKeyPath(instanceId)}.pub`;
  }

  private getMetadataPath(instanceId: string): string {
    return `${this.getPrivateKeyPath(instanceId)}.json`;
  }

  private async getKeyFingerprint(publicKeyPath: string): Promise<string> {
    const result = await this.execCommand("ssh-keygen", ["-lf", publicKeyPath]);
    // Output format: "256 SHA256:... comment (ED25519)"
    const match = result.match(/SHA256:[^\s]+/);
    return match ? match[0] : "unknown";
  }

  private async saveKeyMetadata(
    instanceId: string,
    metadata: Record<string, string | undefined>
  ): Promise<void> {
    const path = this.getMetadataPath(instanceId);
    await writeFile(path, JSON.stringify(metadata, null, 2));
  }

  private async loadKeyMetadata(
    instanceId: string
  ): Promise<Record<string, string> | null> {
    const path = this.getMetadataPath(instanceId);
    try {
      const content = await readFile(path, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private execCommand(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`${cmd} failed: ${stderr || stdout}`));
        }
      });

      proc.on("error", reject);
    });
  }
}

// =============================================================================
// Singleton
// =============================================================================

let keyManagerInstance: KeyManager | null = null;

export function getKeyManager(
  config?: Partial<KeyManagerConfig> & { logger: KeyManagerConfig["logger"] }
): KeyManager {
  if (!keyManagerInstance && config) {
    keyManagerInstance = new KeyManager(config);
  }

  if (!keyManagerInstance) {
    throw new Error("Key manager not initialized");
  }

  return keyManagerInstance;
}

export function initKeyManager(
  config: Partial<KeyManagerConfig> & { logger: KeyManagerConfig["logger"] }
): KeyManager {
  keyManagerInstance = new KeyManager(config);
  return keyManagerInstance;
}
