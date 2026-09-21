import assert from "node:assert/strict";
import { test } from "node:test";
import { readStorageConfig } from "../src/lib/storage/config";
import { authConfig } from "../src/lib/auth/config";
import { UnavailableProvider } from "../src/lib/ai/unavailable";
import { KnowledgeService } from "../src/lib/storage/knowledge";
import { Pool } from "pg";
test("storage configuration validates dimensions and never prints credentials",()=>{
 assert.equal(readStorageConfig({DATABASE_URL:"postgresql://u:private-password@localhost/test"}).EMBEDDING_DIMENSIONS,1536);
 assert.throws(()=>readStorageConfig({DATABASE_URL:"private-secret",EMBEDDING_DIMENSIONS:"12"}),error=>error instanceof Error&&!error.message.includes("private-secret"));
});
test("HTTPS is required except on explicit loopback origins; secrets have no production fallback",()=>{
 const secret="b".repeat(48);
 assert.equal(authConfig({APP_URL:"https://brain.example.test",BETTER_AUTH_SECRET:secret}).secure,true);
 assert.equal(authConfig({APP_URL:"http://localhost:3300",BETTER_AUTH_SECRET:secret}).secure,false);
 for(const origin of ["http://brain.example.test","https://brain.example.test/path","https://user:pass@brain.example.test","ftp://localhost"])assert.throws(()=>authConfig({APP_URL:origin,BETTER_AUTH_SECRET:secret}));
 assert.throws(()=>authConfig({}));
});
test("unavailable AI cannot manufacture an answer",async()=>{
 const provider=new UnavailableProvider();
 assert.equal(await provider.isAvailable(),false);
 await assert.rejects(provider.chat(),/not configured/);
 await assert.rejects(provider.chatStructured(),/not configured/);
});
test("domain reads and writes reject callers outside owner or local maintenance scope",async()=>{
 const pool=new Pool({connectionString:"postgresql://unreachable.invalid/test"});
 const service=new KnowledgeService(pool);
 await assert.rejects(service.list(),/Sign in/);
 await assert.rejects(service.execute({action:"create",idempotencyKey:"unauthorized",title:"x",body:"private"}),/Sign in/);
 await pool.end();
});
