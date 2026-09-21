import { knowledge } from "@/lib/storage/knowledge";
import { privateRoute } from "@/lib/http";
import { ok } from "@/lib/api";
export const runtime="nodejs";
export const GET=privateRoute(async()=>{
 const folders=(await knowledge().folders()).filter(f=>f.path);
 const commands=folders.flatMap(f=>[f.path,...f.aliases.filter(a=>a!==f.path)].map(path=>({command:"/"+path,label:f.name,description:"Generate and save in "+f.path,folderId:f.id,topic:f.name,alias:path!==f.path})));
 return ok({commands,count:commands.length});
});
