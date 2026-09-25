import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { decrypt, encrypt } from "../lib/crypto";

/**
 * Private storage for resumes (PRD §65) on a Docker volume. Content is always encrypted with
 * AES-256-GCM before it reaches disk, is never served statically, and downloads go through
 * short-lived signed links.
 */
export interface ObjectStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const safeKey = (key: string) => {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  return key;
};

class LocalStorage implements ObjectStorage {
  private root = path.resolve(env.STORAGE_LOCAL_DIR);
  async put(key: string, data: Buffer) {
    const file = path.join(this.root, safeKey(key));
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, encrypt(data), { mode: 0o600 });
  }
  async get(key: string) {
    return decrypt(await readFile(path.join(this.root, safeKey(key))));
  }
  async delete(key: string) {
    await rm(path.join(this.root, safeKey(key)), { force: true });
  }
}

let instance: ObjectStorage | null = null;
export function storage(): ObjectStorage {
  instance ??= new LocalStorage();
  return instance;
}
