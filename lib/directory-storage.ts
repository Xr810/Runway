import {pool} from "./postgres";
import {directorySchema,type Directory,identity} from "./journey";
const key="company-channel-directory-v1";
export async function getDirectory():Promise<Directory>{const result=await pool.query("SELECT value FROM meta WHERE key=$1",[key]);return directorySchema.parse(result.rowCount?JSON.parse(result.rows[0].value):{})}
export async function saveDirectory(directory:Directory){
 if(new Set(directory.channels.map(item=>identity(item.name))).size!==directory.channels.length||new Set(directory.companies.map(item=>identity(item.name))).size!==directory.companies.length)throw Error("名称重复，请编辑已有项目");
 const value={...directory,revision:directory.revision+1};
 const result=directory.revision===0?await pool.query("INSERT INTO meta(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING RETURNING key",[key,JSON.stringify(value)]):await pool.query("UPDATE meta SET value=$2 WHERE key=$1 AND (value::jsonb->>'revision')::int=$3 RETURNING key",[key,JSON.stringify(value),directory.revision]);
 if(!result.rowCount)throw Error("目录已在其他窗口更新，请刷新后重试");return value;
}
