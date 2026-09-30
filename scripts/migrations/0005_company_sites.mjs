// Moves the company websites that used to be hard-coded in lib/company-sites.ts
// into the company directory, for companies that have job records.
const sites = {"morgan stanley":"https://www.morganstanley.com","goldman sachs":"https://www.goldmansachs.com","hsbc":"https://www.hsbc.com","worldquant":"https://www.worldquant.com","imc trading":"https://www.imc.com","m-labs":"https://m-labs.hk","oliver wyman":"https://www.oliverwyman.com","小鹏汽车":"https://www.xiaopeng.com","联想":"https://www.lenovo.com","lenovo":"https://www.lenovo.com"};
const key = "company-channel-directory-v1";
const identity = name => name.trim().replace(/\s+/g, " ").toLocaleLowerCase();

export default async function migrate(client) {
  const row = (await client.query("SELECT value FROM meta WHERE key=$1 FOR UPDATE", [key])).rows[0];
  const directory = row ? JSON.parse(row.value) : { revision: 0, channels: [], companies: [] };
  directory.companies ??= []; directory.channels ??= [];
  const names = (await client.query("SELECT DISTINCT data->>'organization' AS name FROM entries WHERE data->>'kind'='job'")).rows.map(r => r.name).filter(Boolean);
  let changed = false;
  for (const name of names) {
    const website = sites[identity(name)];
    if (!website) continue;
    const saved = directory.companies.find(c => identity(c.name) === identity(name));
    if (saved) { if (!saved.website) { saved.website = website; changed = true; } }
    else { directory.companies.push({ name, website, logoUrl: "" }); changed = true; }
  }
  if (!changed) return;
  directory.revision = (directory.revision || 0) + 1;
  await client.query("INSERT INTO meta(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [key, JSON.stringify(directory)]);
}
