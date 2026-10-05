import { createWriteStream } from "node:fs";
import { mkdir, readFile, link, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { currentUserId } from "./postgres";

const root = process.env.ATTACHMENTS_DIR || path.resolve("data/attachments");
async function filePath(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw Error("Invalid attachment ID");
  const userId = await currentUserId();
  return path.join(root, userId, id);
}
export class FileTooLarge extends Error {}

/** Retry an identical publication after a rollback/uncertain commit, never replace different bytes. */
async function publish(source: string, destination: string) {
  try { await link(source, destination); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const [staged, existing] = await Promise.all([readFile(source), readFile(destination)]);
    if (!staged.equals(existing)) throw error;
  }
}

export const localFiles = {
  /** Streams to a temporary file, counting bytes, then links without replacement. */
  async put(id: string, stream: ReadableStream<Uint8Array>, maxBytes = 15 * 1024 * 1024) {
    const destination = await filePath(id), temp = await filePath(randomUUID());
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    let bytes = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, done) { bytes += chunk.length; done(bytes > maxBytes ? new FileTooLarge() : null, chunk); } });
    try {
      await pipeline(Readable.fromWeb(stream as import("node:stream/web").ReadableStream), limit, createWriteStream(temp, { mode: 0o600, flags: "wx" }));
      // Atomic no-clobber publication: concurrent writers can never replace bytes.
      await publish(temp, destination);
      return bytes;
    } finally { await unlink(temp).catch(() => {}); }
  },
  async get(id: string) {
    try { return { body: new Uint8Array(await readFile(await filePath(id))) }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  },
  async publish(stagedId: string, id: string) { await publish(await filePath(stagedId), await filePath(id)); },
  async delete(id: string) { await unlink(await filePath(id)).catch(error => { if (error.code !== "ENOENT") throw error; }); },
};
