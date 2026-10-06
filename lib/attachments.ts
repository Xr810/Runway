import { tx } from "./postgres";
import { localFiles } from "./files";

/** Standalone uploads do not retry; inside atomicAgentWrite this joins its transaction.
 * Each attempt opens a fresh stream. Published bytes are immutable and retained
 * after rollback/uncertain commit so a retry can safely reuse them. */
export async function uploadAttachment(
  fileId: string,
  entryId: string,
  file: File,
  created: string,
) {
  return tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "attachment:" + fileId,
    ]);
    if (
      !(await client.query("SELECT 1 FROM entries WHERE id=$1 AND deleted_at IS NULL", [entryId]))
        .rowCount
    )
      throw Error("请先保存记录");
    const old = (
      await client.query<{ entry_id: string }>("SELECT entry_id FROM files WHERE id=$1", [fileId])
    ).rows[0];
    if (old) {
      if (old.entry_id !== entryId) throw Error("附件 ID 冲突");
      return { id: fileId };
    }
    await localFiles.put(fileId, file.stream());
    // COMMIT may have succeeded even when the connection fails. Never delete here.
    await client.query(
      "INSERT INTO files(id,entry_id,name,type,size,created) VALUES($1,$2,$3,$4,$5,$6)",
      [fileId, entryId, file.name.slice(0, 300), file.type, file.size, created],
    );
    return { id: fileId };
  });
}
