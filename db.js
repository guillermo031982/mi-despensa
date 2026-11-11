/* Almacenamiento local en IndexedDB. Nada sale del móvil salvo las consultas a Open Food Facts. */
const DB=(()=>{
  let dbp;
  function open(){
    if(dbp)return dbp;
    dbp=new Promise((res,rej)=>{
      const r=indexedDB.open('mi-despensa',1);
      r.onupgradeneeded=()=>{const d=r.result;
        if(!d.objectStoreNames.contains('cats'))d.createObjectStore('cats',{keyPath:'id'});
        if(!d.objectStoreNames.contains('prods')){const s=d.createObjectStore('prods',{keyPath:'id'});s.createIndex('cat','cat');s.createIndex('code','code')}
      };
      r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
    });
    return dbp;
  }
  async function tx(store,mode,fn){const d=await open();return new Promise((res,rej)=>{const t=d.transaction(store,mode);const s=t.objectStore(store);let out;Promise.resolve(fn(s)).then(v=>out=v);t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error)})}
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
  return {
    all:(store)=>tx(store,'readonly',s=>req(s.getAll())),
    get:(store,id)=>tx(store,'readonly',s=>req(s.get(id))),
    put:(store,obj)=>tx(store,'readwrite',s=>req(s.put(obj))),
    del:(store,id)=>tx(store,'readwrite',s=>req(s.delete(id))),
    clear:(store)=>tx(store,'readwrite',s=>req(s.clear())),
    async bulkPut(store,arr){return tx(store,'readwrite',s=>{arr.forEach(o=>s.put(o))})}
  };
})();
