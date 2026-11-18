import { existsSync } from "node:fs";
import path from "node:path";

const file=path.resolve(import.meta.dirname,"../.env");
if(existsSync(file))process.loadEnvFile(file);
// Read-only provider probes. Do not log URLs, headers, responses, or credentials.
async function probe(url,authorization) {
  try {
    const response=await fetch(url,{headers:authorization?{Authorization:authorization}:{},signal:AbortSignal.timeout(12000)});
    let body={};try{body=await response.json();}catch{}
    return {status:response.status,body};
  }catch{return {status:0,body:{}};}
}
const env=process.env;
const aiConfigured=["GEMINI_API_KEY",...Array.from({length:7},(_,i)=>`GEMINI_API_KEY_${i+2}`)].some(key=>Boolean(env[key]?.trim()));
console.log(`Gemini runtime credentials: ${aiConfigured?"available":"missing or empty"}`);
if(process.argv.includes("--ai-only"))process.exit(aiConfigured?0:1);
if(env.CLERK_PUBLISHABLE_KEY&&env.CLERK_SECRET_KEY) {
  const matching=env.CLERK_PUBLISHABLE_KEY===env.VITE_CLERK_PUBLISHABLE_KEY;
  const backend=await probe("https://api.clerk.com/v1/jwks",`Bearer ${env.CLERK_SECRET_KEY}`);
  const host=Buffer.from(env.CLERK_PUBLISHABLE_KEY.replace(/^pk_(?:test|live)_/,""),"base64").toString().replace(/\$$/,"");
  const frontend=/^[a-z0-9.-]+$/i.test(host)?await probe(`https://${host}/.well-known/jwks.json`):{status:0,body:{}};
  const kids=new Set((backend.body.keys??[]).map(k=>k.kid));
  const sameInstance=frontend.status===200&&(frontend.body.keys??[]).some(k=>kids.has(k.kid));
  console.log(`Clerk: backend HTTP ${backend.status}; matching frontend key: ${matching}; same instance: ${sameInstance}`);
}else console.log("Clerk: credentials missing");
if(env.ONESIGNAL_APP_ID&&env.ONESIGNAL_REST_API_KEY) {
  const result=await probe(`https://api.onesignal.com/apps/${encodeURIComponent(env.ONESIGNAL_APP_ID)}`,`Key ${env.ONESIGNAL_REST_API_KEY}`);
  console.log(`OneSignal: HTTP ${result.status}; matching app: ${result.status===200&&result.body.id===env.ONESIGNAL_APP_ID}; matching browser App ID: ${env.ONESIGNAL_APP_ID===env.VITE_ONESIGNAL_APP_ID}`);
}else console.log("OneSignal: credentials missing");
if(env.RESEND_API_KEY) {
  const result=await probe("https://api.resend.com/domains",`Bearer ${env.RESEND_API_KEY}`);
  console.log(`Resend domain inspection: HTTP ${result.status}${result.status===403?" (key may be send-only; delivery not tested)":""}`);
  console.log(`Resend sender: ${env.RESEND_FROM_EMAIL?.endsWith("@resend.dev")?"restricted test sender; own verified domain needed for general delivery":env.RESEND_FROM_EMAIL?"configured; actual delivery not tested":"missing"}`);
}else console.log("Resend: credentials missing");
console.log(`Google Calendar OAuth credentials: ${Boolean(env.GOOGLE_OAUTH_CLIENT_ID&&env.GOOGLE_OAUTH_CLIENT_SECRET&&env.GOOGLE_OAUTH_REDIRECT_URI)?"configured; each user must still authorize Google access":"incomplete"}`);
console.log("No notifications were sent and no calendars were modified.");
