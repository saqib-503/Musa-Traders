"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {useRouter} from "next/navigation";
import { sb } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";
import AdminGate from "./AdminGate";
import {ButtonContent, LoadingBlock} from "./Loading";
type Kind = "categories" | "brands" | "coupons";
type Row = { description?:string; image_url?:string; logo_url?:string; id?: string; parent_id?:string|null; name?: string; slug?: string; code?: string; percent?: number; active?: boolean; status?: string; sort_order?: number; show_in_menu?: boolean; show_on_homepage?: boolean };
const initial = { description:"", image_url:"", name: "", slug: "", code: "", percent: "10", enabled: true, sort: "0", menu: true, home: true, parentId:"" };
export default function CatalogManager({ kind }: { kind: Kind }) { return <AdminGate><Manager kind={kind}/></AdminGate>; }
function Manager({ kind }: { kind: Kind }) {
  const router=useRouter();
  const [file,setFile]=useState<File|null>(null);
  const [preview,setPreview]=useState("");
  const fileInput=useRef<HTMLInputElement>(null);
  const uploadAttempt=useRef<{file:File;path:string;url?:string}|null>(null);
  const imageTypes:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif","image/avif":"avif"};
  const [rows, setRows] = useState<Row[]>([]); const [fields, setFields] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [message, setMessage] = useState("");
  const locked = useRef(false);
  const title = kind[0].toUpperCase() + kind.slice(1);
  useEffect(()=>{if(!file){setPreview("");return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
  function clearFile(){setFile(null);uploadAttempt.current=null;if(fileInput.current)fileInput.current.value="";}
  function reset(){clearFile();setFields(initial);setEditing(null);}
  function chooseFile(selected:File|null){
    if(!selected)return;
    if(!imageTypes[selected.type]||selected.size>5242880||selected.size===0){setMessage("Choose a JPG, PNG, WebP, GIF or AVIF image up to 5 MB.");if(fileInput.current)fileInput.current.value="";return;}
    setMessage("");setFile(selected);uploadAttempt.current=null;
  }
  async function load() {
    setLoading(true);
    const columns = kind === "categories" ? "id,parent_id,name,slug,description,image_url,status,sort_order,show_in_menu,show_on_homepage" : kind === "brands" ? "id,name,slug,logo_url" : "code,percent,active";
    const { data, error } = await sb.from(kind).select(columns).order(kind === "coupons" ? "code" : "name");
    if (error) { setLoading(false); throw error; } setRows((data || []) as unknown as Row[]); setLoading(false);
  }
  useEffect(() => { load().catch(error => setMessage(errorMessage(error))); }, [kind]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (locked.current) return; locked.current = true; setBusy(true);setMessage("Saving...");
    try {
      const slug = fields.slug.trim().toLowerCase();
      if (kind !== "coupons" && (!fields.name.trim() || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))) throw new Error("Enter a name and a slug using lowercase letters, numbers and hyphens.");
      if (kind === "coupons" && !/^[A-Z0-9_-]+$/.test(fields.code.trim().toUpperCase())) throw new Error("Enter a coupon code using letters, numbers, hyphens or underscores.");
      if(fields.image_url&&!/^https?:\/\//i.test(fields.image_url))throw new Error("Enter an HTTP or HTTPS image URL.");
      let imageUrl=fields.image_url;
      if(kind==="categories"&&file){
        if(!imageTypes[file.type]||file.size>5242880||file.size===0)throw new Error("Choose a supported image up to 5 MB.");
        if(uploadAttempt.current?.file!==file)uploadAttempt.current={file,path:`categories/${crypto.randomUUID()}.${imageTypes[file.type]}`};
        const attempt=uploadAttempt.current;
        if(!attempt.url){
          setMessage("Uploading category image...");
          const {error}=await sb.storage.from("media").upload(attempt.path,file,{contentType:file.type});
          if(error&&!("statusCode" in error&&String(error.statusCode)==="409")&&!/already exists|duplicate/i.test(error.message))throw error;
          attempt.url=sb.storage.from("media").getPublicUrl(attempt.path).data.publicUrl;
        }
        imageUrl=attempt.url;
      }
      const payload: Record<string, string | number | boolean | null> = kind === "coupons" ? { code: fields.code.trim().toUpperCase(), percent: +fields.percent, active: fields.enabled }
        : { name: fields.name.trim(), slug, ...(kind === "categories" ? { parent_id:fields.parentId||null,description:fields.description.trim(),image_url:imageUrl||null,status: fields.enabled ? "active" : "draft", sort_order: +fields.sort, show_in_menu: fields.menu, show_on_homepage: fields.home } : {logo_url:fields.image_url||null}) };
      const result = editing ? await sb.from(kind).update(payload).eq(kind === "coupons" ? "code" : "id", editing).select().single() : await sb.from(kind).insert(payload).select().single();
      if (result.error) throw result.error;
      setMessage("Saved."); window.dispatchEvent(new Event("nestling:catalog")); reset(); router.refresh(); await load();
    } catch (error) { setMessage(errorMessage(error)); } finally { locked.current = false; setBusy(false); }
  }
  function edit(row: Row) { clearFile(); setMessage(""); setEditing(row.id || row.code!); setFields({ description:row.description||"",image_url:row.image_url||row.logo_url||"", name: row.name || "", slug: row.slug || "", code: row.code || "", percent: String(row.percent || 10), enabled: kind === "coupons" ? !!row.active : row.status !== "draft", sort: String(row.sort_order || 0), menu: row.show_in_menu ?? true, home: row.show_on_homepage ?? true, parentId:row.parent_id||"" }); }
  async function remove(row:Row){if(locked.current||!window.confirm(`Delete ${row.name||row.code}? Category assignments will be removed; products will remain.`))return;locked.current=true;setBusy(true);setMessage("Deleting...");try{const {error}=await sb.from(kind).delete().eq(kind==="coupons"?"code":"id",row.id||row.code!).select().single();if(error)throw error;if(editing===(row.id||row.code)){reset();}await load();window.dispatchEvent(new Event("nestling:catalog"));setMessage("Deleted.");}catch(e){setMessage(errorMessage(e));}finally{locked.current=false;setBusy(false);}}
  return <><h1>{title}</h1><form className="admin-form" onSubmit={save}><fieldset disabled={busy}><legend>{editing ? "Edit" : "Add"} {kind === "categories" ? "category" : kind === "brands" ? "brand" : "coupon"}</legend>
    {kind === "coupons" ? <><label>Code<input required readOnly={!!editing} value={fields.code} onChange={e => setFields({ ...fields, code: e.target.value })}/></label><label>Discount percent<input type="number" required min={1} max={90} value={fields.percent} onChange={e => setFields({ ...fields, percent: e.target.value })}/></label></> : <><label>Name<input required value={fields.name} onChange={e => setFields({ ...fields, name: e.target.value, slug: editing ? fields.slug : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") })}/></label><label>Slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={fields.slug} onChange={e => setFields({ ...fields, slug: e.target.value })}/></label></>}
    {kind === "brands" && <label>Image URL (optional)<input type="url" value={fields.image_url} onChange={e=>setFields({...fields,image_url:e.target.value})}/></label>}
    {kind === "categories" && <div className="category-image-upload"><label>Category image (optional)<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" onChange={e=>chooseFile(e.target.files?.[0]||null)}/></label><p>Choose an image from your device. JPG, PNG, WebP, GIF or AVIF, up to 5 MB.</p>{(preview||fields.image_url)&&<div><img src={preview||fields.image_url} alt="Category image preview" style={{display:"block",width:160,height:160,objectFit:"cover",borderRadius:16,marginBottom:12}}/><button type="button" className="text-button" onClick={()=>{clearFile();setFields({...fields,image_url:""});}}>Remove image</button>{file&&fields.image_url&&<button type="button" className="text-button" onClick={clearFile}>Keep current image</button>}</div>}<p>The image is saved when you save the category.</p></div>}
    {kind === "categories" && <><label>Parent category<select value={fields.parentId} onChange={e=>setFields({...fields,parentId:e.target.value})}><option value="">None — main category</option>{rows.filter(row=>row.id!==editing).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label><p className="form-hint">Choose a parent to make this a subcategory. Leave as None for a main navigation category.</p><label>Description<textarea maxLength={500} value={fields.description} onChange={e=>setFields({...fields,description:e.target.value})}/></label></>}
    {kind !== "brands" && <label className="check-label"><input type="checkbox" checked={fields.enabled} onChange={e => setFields({ ...fields, enabled: e.target.checked })}/>Active</label>}
    {kind === "categories" && <><label>Display order<input type="number" value={fields.sort} onChange={e => setFields({ ...fields, sort: e.target.value })}/></label><label className="check-label"><input type="checkbox" checked={fields.menu} onChange={e => setFields({ ...fields, menu: e.target.checked })}/>Show in navigation</label><label className="check-label"><input type="checkbox" checked={fields.home} onChange={e => setFields({ ...fields, home: e.target.checked })}/>Show on homepage</label></>}
    <button className="btn" disabled={busy}><ButtonContent busy={busy} busyLabel={message.startsWith("Uploading")?"Uploading...":message.startsWith("Deleting")?"Deleting...":"Saving..."}>Save {kind === "categories" ? "category" : kind === "brands" ? "brand" : "coupon"}</ButtonContent></button>{editing && <button type="button" className="text-button" onClick={reset}>Cancel edit</button>}
  </fieldset></form><p role="status">{message}</p>{loading?<LoadingBlock compact label={`Loading ${title.toLowerCase()}...`}/>:<div className="table-scroll"><table><thead><tr><th>Name / code</th><th>Details</th><th>Manage</th></tr></thead><tbody>{rows.map(row => <tr key={row.id || row.code}><td>{kind==="categories"&&row.image_url&&<img src={row.image_url} alt="" width={48} height={48} style={{objectFit:"cover",borderRadius:8,display:"block",marginBottom:8}}/>}{row.name || row.code}</td><td>{kind === "coupons" ? `${row.percent}% · ${row.active ? "Active" : "Inactive"}` : `${row.slug}${row.status ? ` · ${row.status}` : ""}`}</td><td><button disabled={busy} className="text-button" onClick={() => edit(row)}>Edit</button> <button disabled={busy} className="text-button" onClick={()=>remove(row)}>{busy&&message.startsWith("Deleting")?"Deleting...":"Delete"}</button></td></tr>)}</tbody></table></div>}</>;
}
