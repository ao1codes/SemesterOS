import test from "node:test";
import assert from "node:assert/strict";
import { saveSemesterState, deleteSemesterState } from "@workspace/api-client-react";
import type { SemesterState } from "@workspace/api-client-react";

test("semester save/delete use semester endpoint, not notification status",async()=>{
  const original=globalThis.fetch;
  const calls:{url:string;method:string}[]=[];
  globalThis.fetch=async (input,init)=>{
    calls.push({url:String(input),method:init?.method??"GET"});
    return init?.method==="DELETE"?new Response(null,{status:204}):Response.json({revision:"saved"});
  };
  try{
    await saveSemesterState({revision:"base"} as SemesterState);
    await deleteSemesterState();
    assert.deepEqual(calls,[{url:"/api/semester-state",method:"PUT"},{url:"/api/semester-state",method:"DELETE"}]);
  }finally{globalThis.fetch=original;}
});
test("stale-write conflicts remain visible to the client",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({error:"Changed elsewhere"},{status:409});
  try{await assert.rejects(saveSemesterState({} as SemesterState),(error:unknown)=>(error as {status:number}).status===409);}
  finally{globalThis.fetch=original;}
});
