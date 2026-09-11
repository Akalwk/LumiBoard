const $=q=>document.querySelector(q);
let tree=[],folders=[],items=[],active="home",search="",compact=false;

const api={
  tree:()=>new Promise(r=>chrome.bookmarks.getTree(r)),
  create:o=>new Promise((r,j)=>chrome.bookmarks.create(o,x=>chrome.runtime.lastError?j(chrome.runtime.lastError):r(x))),
  update:(id,o)=>new Promise((r,j)=>chrome.bookmarks.update(id,o,x=>chrome.runtime.lastError?j(chrome.runtime.lastError):r(x))),
  remove:(id,recursive=false)=>new Promise((r,j)=>{
    const fn=recursive?chrome.bookmarks.removeTree:chrome.bookmarks.remove;
    fn(id,()=>chrome.runtime.lastError?j(chrome.runtime.lastError):r());
  }),
  move:(id,o)=>new Promise((r,j)=>chrome.bookmarks.move(id,o,x=>chrome.runtime.lastError?j(chrome.runtime.lastError):r(x))),
  tabs:()=>new Promise(r=>chrome.tabs.query({active:true,currentWindow:true},r))
};
function esc(x){return String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function host(u){try{return new URL(u).hostname.replace(/^www\./,"")}catch{return u}}
function toast(t){const x=$("#toast");x.textContent=t;x.classList.add("show");setTimeout(()=>x.classList.remove("show"),1700)}
function walk(nodes,path=[]){
  for(const n of nodes||[]){
    if(n.url) items.push({id:n.id,title:n.title||n.url,url:n.url,parentId:n.parentId});
    else if(n.id!=="0"){
      folders.push({id:n.id,name:n.title||"Folder",parentId:n.parentId,path:[...path,n.title||"Folder"]});
      walk(n.children,[...path,n.title||"Folder"]);
    } else walk(n.children,path);
  }
}
async function refresh(){
  tree=await api.tree();folders=[];items=[];walk(tree);
  if(active!=="home"&&!folders.some(f=>f.id===active))active="home";
  render();
}
function directChildren(parentId){
  return folders.filter(f=>f.parentId===parentId);
}
function directBookmarks(parentId){
  return items.filter(i=>i.parentId===parentId);
}
function roots(){
  // User-created boards live in Bookmarks Bar (Chrome id "1").
  return folders.filter(f=>f.parentId==="1");
}
function allBookmarkCount(parentId){
  const childFolders=folders.filter(f=>f.parentId===parentId);
  return directBookmarks(parentId).length+childFolders.reduce((n,f)=>n+allBookmarkCount(f.id),0);
}
function renderBoards(){
  const nav=$("#boards");nav.innerHTML="";
  const home=document.createElement("button");home.textContent="Home";home.className=active==="home"?"active":"";home.onclick=()=>{active="home";render()};nav.append(home);
  roots().forEach(f=>{
    const b=document.createElement("button");b.textContent=f.name;b.className=active===f.id?"active":"";b.onclick=()=>{active=f.id;render()};nav.append(b)
  });
}
function cardForFolder(f){
  const e=document.createElement("article");e.className="group";
  const count=allBookmarkCount(f.id);
  e.innerHTML=`<div class="groupHead"><span class="folderIcon">📁</span><span class="groupTitle">${esc(f.name)}</span><span class="badge">${count}</span><button class="more">⋯</button></div><div class="bookmarks"></div>`;
  e.querySelector(".groupHead").onclick=x=>{if(x.target.closest(".more"))return;active=f.id;render()};
  e.querySelector(".more").onclick=x=>{x.stopPropagation();editFolder(f)};
  const box=e.querySelector(".bookmarks");
  directBookmarks(f.id).filter(i=>matches(i)).forEach(i=>box.append(bookmarkEl(i)));
  directChildren(f.id).forEach(ch=>{
    if(search){ // In search mode nested folders are represented as their own group.
      const nested=directBookmarks(ch.id).filter(i=>matches(i)); if(nested.length)box.append(...nested.map(bookmarkEl));
    }
  });
  const add=document.createElement("button");add.className="addInside";add.textContent="＋ Add bookmark";add.onclick=()=>openBookmark(null,f.id);box.append(add);
  return e;
}
function bookmarkEl(i){
  const e=document.createElement("div");e.className="bookmark";e.draggable=true;
  e.innerHTML=`<img class="favicon" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host(i.url))}&sz=64"><button class="bookmarkMenu">⋮</button><div class="bookmarkTitle">${esc(i.title)}</div><div class="domain">${esc(host(i.url))}</div>`;
  e.onclick=x=>{if(!x.target.closest(".bookmarkMenu"))chrome.tabs.create({url:i.url})};
  e.querySelector(".bookmarkMenu").onclick=x=>{x.stopPropagation();editBookmark(i)};
  e.addEventListener("dragstart",x=>x.dataTransfer.setData("text/plain",i.id));
  e.addEventListener("dragover",x=>x.preventDefault());
  e.addEventListener("drop",async x=>{x.preventDefault();const id=x.dataTransfer.getData("text/plain");if(id&&id!==i.id){try{await api.move(id,{parentId:i.parentId,index:i.index});await refresh();toast("Bookmark moved")}catch{toast("Could not move bookmark")}}});
  return e;
}
function matches(i){return !search||(i.title+" "+i.url).toLowerCase().includes(search.toLowerCase())}
function render(){
  renderBoards();
  $("#breadcrumb").textContent=active==="home"?"All boards":(folders.find(f=>f.id===active)?.path?.join(" / ")||"");
  const grid=$("#cards");grid.innerHTML="";
  let listFolders;
  if(active==="home") listFolders=roots();
  else listFolders=directChildren(active);
  if(search){
    const resultFolders=new Map();
    items.filter(matches).forEach(i=>{const f=folders.find(x=>x.id===i.parentId);if(f)resultFolders.set(f.id,f)});
    listFolders=[...resultFolders.values()];
  }
  listFolders.forEach(f=>grid.append(cardForFolder(f)));
  if(active!=="home"){
    const direct=directBookmarks(active).filter(matches);
    if(direct.length||!listFolders.length){
      const pseudo={id:active+"-direct",name:"Bookmarks",parentId:active};
      const e=cardForFolderData(pseudo,direct);grid.prepend(e);
    }
  }
  $("#empty").classList.toggle("hidden",grid.children.length>0);
}
function cardForFolderData(f,list){
  const e=document.createElement("article");e.className="group";
  e.innerHTML=`<div class="groupHead"><span class="folderIcon">🔖</span><span class="groupTitle">${esc(f.name)}</span><span class="badge">${list.length}</span></div><div class="bookmarks"></div>`;
  const box=e.querySelector(".bookmarks");list.forEach(i=>box.append(bookmarkEl(i)));
  const add=document.createElement("button");add.className="addInside";add.textContent="＋ Add bookmark";add.onclick=()=>openBookmark(null,active);box.append(add);
  return e;
}
function folderOptions(selected,excludeId=""){
  return folders.filter(f=>f.id!==excludeId).map(f=>`<option value="${f.id}" ${f.id===selected?"selected":""}>${esc(f.path.join(" / "))}</option>`).join("")
}
function openBookmark(x=null,parentId=active==="home"?(roots()[0]?.id||"1"):active){
  $("#bookmarkDialogTitle").textContent=x?"Edit Bookmark":"Add Bookmark";
  $("#bookmarkId").value=x?.id||"";
  $("#bookmarkTitle").value=x?.title||"";
  $("#bookmarkUrl").value=x?.url||"";
  $("#bookmarkFolder").innerHTML=folderOptions(x?.parentId||parentId);
  $("#deleteBookmark").classList.toggle("hidden",!x);
  $("#bookmarkDialog").showModal();
}
function editBookmark(x){openBookmark(x)}
function openFolder(x=null,parentId=active==="home"?"1":active){
  $("#folderDialogTitle").textContent=x?"Edit Folder":"Add Folder";
  $("#folderId").value=x?.id||"";$("#folderName").value=x?.name||"";
  $("#folderParent").innerHTML=folderOptions(x?.parentId||parentId,x?.id||"");
  $("#deleteFolder").classList.toggle("hidden",!x);
  $("#folderDialog").showModal();
}
function editFolder(x){openFolder(x)}
$("#topBookmark").onclick=()=>openBookmark();
$("#emptyBookmark").onclick=()=>openBookmark();
$("#emptyFolder").onclick=()=>openFolder();
$("#addFolder").onclick=()=>openFolder();
$("#addBoard").onclick=async()=>{const name=prompt("Board name:","New Board");if(!name?.trim())return;try{const f=await api.create({parentId:"1",title:name.trim()});active=f.id;await refresh();toast("Board created")}catch{toast("Could not create board")}};
$("#bookmarkForm").onsubmit=async e=>{
 e.preventDefault();const id=$("#bookmarkId").value,title=$("#bookmarkTitle").value.trim(),url=$("#bookmarkUrl").value.trim(),parentId=$("#bookmarkFolder").value;
 try{
  if(id){await api.update(id,{title,url});const old=items.find(i=>i.id===id);if(old&&old.parentId!==parentId)await api.move(id,{parentId})}
  else await api.create({parentId,title,url});
  $("#bookmarkDialog").close();await refresh();toast("Bookmark saved");
 }catch(err){toast("Could not save bookmark")}
};
$("#deleteBookmark").onclick=async()=>{
 const id=$("#bookmarkId").value;if(!id)return;
 if(!confirm("Delete this bookmark?"))return;
 try{await api.remove(id);$("#bookmarkDialog").close();await refresh();toast("Bookmark deleted")}catch{toast("Could not delete bookmark")}
};
$("#folderForm").onsubmit=async e=>{
 e.preventDefault();const id=$("#folderId").value,name=$("#folderName").value.trim(),parentId=$("#folderParent").value;
 try{
  if(id){await api.update(id,{title:name});const old=folders.find(f=>f.id===id);if(old&&old.parentId!==parentId)await api.move(id,{parentId})}
  else {const f=await api.create({parentId,title:name});active=f.id}
  $("#folderDialog").close();await refresh();toast("Folder saved");
 }catch{toast("Could not save folder")}
};
$("#deleteFolder").onclick=async()=>{
 const id=$("#folderId").value;if(!id)return;
 if(!confirm("Delete this folder and everything inside it?"))return;
 try{await api.remove(id,true);active="home";$("#folderDialog").close();await refresh();toast("Folder deleted")}catch{toast("Could not delete folder")}
};
$("#saveTab").onclick=async()=>{
 const ts=await api.tabs(),t=ts[0];if(!t?.url||/^(chrome|edge|about):/.test(t.url))return toast("This page cannot be saved");
 const parent=active==="home"?(roots()[0]?.id||"1"):active;
 try{await api.create({parentId:parent,title:t.title||host(t.url),url:t.url});await refresh();toast("Current tab saved")}catch{toast("Could not save tab")}
};
$("#searchButton").onclick=()=>{$("#searchBox").classList.toggle("hidden");$("#searchInput").focus()};
$("#closeSearch").onclick=()=>{$("#searchBox").classList.add("hidden");search="";$("#searchInput").value="";render()};
$("#searchInput").oninput=e=>{search=e.target.value.trim();render()};
$("#refreshButton").onclick=async()=>{await refresh();toast("Bookmarks refreshed")};
$("#layoutButton").onclick=()=>{compact=!compact;document.body.classList.toggle("compact",compact);toast(compact?"Compact layout":"Normal layout")};
$("#settingsButton").onclick=async()=>{
 const d=await chrome.storage.local.get(["lb_wallpaper","lb_overlay"]);
 $("#darkMode").checked=d.lb_overlay!==false;$("#wallpaperPreview").style.backgroundImage=d.lb_wallpaper?`url("${d.lb_wallpaper}")`:"";
 $("#settingsDialog").showModal()
};
$("#wallpaperButton").onclick=()=>$("#settingsButton").click();
$("#wallpaperFile").onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{$("#wallpaperPreview").style.backgroundImage=`url("${r.result}")`;$("#wallpaperPreview").dataset.pending=r.result};r.readAsDataURL(f)};
$("#removeWallpaper").onclick=async()=>{await chrome.storage.local.remove("lb_wallpaper");$("#wallpaperPreview").style.backgroundImage="";delete $("#wallpaperPreview").dataset.pending;document.body.style.backgroundImage="";toast("Wallpaper removed")};
$("#settingsForm").onsubmit=async e=>{
 e.preventDefault();const p=$("#wallpaperPreview").dataset.pending;
 if(p!==undefined)await chrome.storage.local.set({lb_wallpaper:p});
 await chrome.storage.local.set({lb_overlay:$("#darkMode").checked});
 const d=await chrome.storage.local.get(["lb_wallpaper","lb_overlay"]);document.body.style.backgroundImage=d.lb_wallpaper?`url("${d.lb_wallpaper}")`:"";document.body.classList.toggle("noOverlay",d.lb_overlay===false);
 $("#settingsDialog").close();toast("Settings applied")
};
$("#exportBookmarks").onclick=async()=>{
 const t=await api.tree(),out=["<!DOCTYPE NETSCAPE-Bookmark-file-1>","<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">","<TITLE>LumiBoard Bookmarks</TITLE>","<H1>LumiBoard Bookmarks</H1>","<DL><p>"];
 function rec(nodes){for(const n of nodes||[]){if(n.url)out.push(`<DT><A HREF="${esc(n.url)}">${esc(n.title)}</A>`);else{out.push(`<DT><H3>${esc(n.title||"Folder")}</H3><DL><p>`);rec(n.children);out.push("</DL><p>")}}}
 rec(t);out.push("</DL><p>");
 const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([out.join("\\n")],{type:"text/html"}));a.download="lumiboard-bookmarks.html";a.click()
};
$("#openChromeBookmarks").onclick=()=>chrome.tabs.create({url:"chrome://bookmarks/"});
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$("#"+b.dataset.close).close());
chrome.bookmarks.onCreated.addListener(()=>refresh());
chrome.bookmarks.onRemoved.addListener(()=>refresh());
chrome.bookmarks.onChanged.addListener(()=>refresh());
chrome.bookmarks.onMoved.addListener(()=>refresh());

(async()=>{
 const d=await chrome.storage.local.get(["lb_wallpaper","lb_overlay"]);
 document.body.style.backgroundImage=d.lb_wallpaper?`url("${d.lb_wallpaper}")`:"";
 document.body.classList.toggle("noOverlay",d.lb_overlay===false);
 await refresh();
})();