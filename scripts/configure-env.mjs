import { readFile, writeFile, chmod } from "node:fs/promises";
import path from "node:path";

// Run locally or after securely configuring the process environment.
// Never accepts secrets as command arguments and never prints their values.
const root=path.resolve(import.meta.dirname,"..");
const filename=path.join(root,".env");
const template=await readFile(path.join(root,".env.example"),"utf8");
let text;
try{text=await readFile(filename,"utf8");}
catch(error){if(error.code!=="ENOENT")throw error;text=template;}
const keys=[...template.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(m=>m[1]);
const updated=[];
for(const key of keys) {
  const value=process.env[key];
  if(!value || /^(?:PORT|API_PORT|WEB_PORT|TRUST_PROXY_HOPS|WEB_BASE_PATH)$/.test(key))continue;
  const line=`${key}=${JSON.stringify(value)}`;
  const pattern=new RegExp(`^${key}=.*$`,"m");
  text=pattern.test(text)?text.replace(pattern,()=>line):`${text.trimEnd()}\n${line}\n`;
  updated.push(key);
}
await writeFile(filename,text,{mode:0o600});
await chmod(filename,0o600);
console.log(`Updated ignored .env using ${updated.length} configured environment entries. No values were printed. Review local origin/ports before running outside this workspace.`);
