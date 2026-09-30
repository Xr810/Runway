import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";

const root = process.env.ATTACHMENTS_DIR || path.resolve("data/attachments");
function filePath(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw Error("Invalid attachment ID");
  return path.join(root, id);
}
export class FileTooLarge extends Error {}

export const localFiles = {
  /** Streams to a temporary file, counting bytes, then renames into place. */
  async put(id: string, stream: ReadableStream<Uint8Array>, maxBytes = 15 * 1024 * 1024) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const destination = filePath(id), temp = filePath(randomUUID());
    let bytes = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, done) { bytes += chunk.length; done(bytes > maxBytes ? new FileTooLarge() : null, chunk); } });
    try {
      await pipeline(Readable.fromWeb(stream as import("node:stream/web").ReadableStream), limit, createWriteStream(temp, { mode: 0o600, flags: "wx" }));
      await rename(temp, destination);
      return bytes;
    } finally { await unlink(temp).catch(() => {}); }
  },
  async get(id: string) {
    try { return { body: new Uint8Array(await readFile(filePath(id))) }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  },
  async delete(id: string) { await unlink(filePath(id)).catch(error => { if (error.code !== "ENOENT") throw error; }); },
};
