import { notFound,redirect } from "next/navigation";
import { knowledge } from "@/lib/storage/knowledge";
import { withPageOwner } from "@/lib/auth/page";
export default async function KnowledgeAliasPage({params}:{params:Promise<{path:string[]}>}){
 const p=(await params).path.join("/");
 const note=await withPageOwner(()=>knowledge().get(p));
 if(!note)notFound();
 redirect("/notes/"+note.id);
}
