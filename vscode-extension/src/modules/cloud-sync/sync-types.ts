import type { BackupPayload } from "../../services/workspace-data";

export interface CloudSyncConfig {
  repoUrl: string;
  branch: string;
  remotePath: string;
  autoSync: boolean;
}

export interface EncryptedBackupEnvelope {
  version: 1;
  createdAt: string;
  crypto: {
    algorithm: "aes-256-gcm";
    kdf: "scrypt";
    salt: string;
    iv: string;
    authTag: string;
    compression: "gzip";
  };
  ciphertext: string;
}

export interface ChunkManifest {
  version: 1;
  kind: "reasonix-cloud-sync-chunked";
  createdAt: string;
  projectHash: string;
  payloadFileCount: number;
  payloadStateCount: number;
  payloadSecretCount: number;
  chunks: Array<{
    path: string;
    sha256: string;
    size: number;
  }>;
}

export interface RestorePreview {
  payload: BackupPayload;
  globalFiles: number;
  workspaceFiles: number;
  extensionState: number;
  secrets: number;
  conflicts?: Array<{ scope: string; relativePath: string }>;
}
