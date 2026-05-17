import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { promisify } from "node:util";
import type { BackupPayload } from "../../services/workspace-data";
import type { EncryptedBackupEnvelope } from "./sync-types";

const scrypt = promisify(scryptCallback);

/**
 * Password-based encryption for cloud backups. The password and derived key are
 * kept only in memory for the current operation/session and are never saved.
 */
export class CryptoService {
  async encrypt(payload: BackupPayload, password: string): Promise<EncryptedBackupEnvelope> {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = (await scrypt(password, salt, 32)) as Buffer;

    // Gzip first to reduce GitHub payload size; AES-GCM then authenticates the compressed bytes.
    const plaintext = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      version: 1,
      createdAt: new Date().toISOString(),
      crypto: {
        algorithm: "aes-256-gcm",
        kdf: "scrypt",
        salt: salt.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
        compression: "gzip",
      },
      ciphertext: ciphertext.toString("base64"),
    };
  }

  async decrypt(envelope: EncryptedBackupEnvelope, password: string): Promise<BackupPayload> {
    if (envelope.version !== 1 || envelope.crypto.algorithm !== "aes-256-gcm") {
      throw new Error("Unsupported backup encryption format.");
    }

    const salt = Buffer.from(envelope.crypto.salt, "base64");
    const iv = Buffer.from(envelope.crypto.iv, "base64");
    const authTag = Buffer.from(envelope.crypto.authTag, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    const key = (await scrypt(password, salt, 32)) as Buffer;

    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);
      const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const plaintext = gunzipSync(compressed).toString("utf8");
      return JSON.parse(plaintext) as BackupPayload;
    } catch (err) {
      throw new Error(
        `无法解密备份。密码错误或备份文件已损坏。Reasonix 不保存加密密码，忘记密码将无法恢复该备份。${err instanceof Error ? ` (${err.message})` : ""}`,
      );
    }
  }
}
