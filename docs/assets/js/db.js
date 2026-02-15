// Minimal IndexedDB wrapper
const DB_NAME = 'closing_trade_pwa';
const DB_VER = 1;

export function openDb(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = ()=>{
      const db = req.result;
      if(!db.objectStoreNames.contains('candidates')){
        const s = db.createObjectStore('candidates', { keyPath: 'id' });
        s.createIndex('byDate', 'date');
      }
      if(!db.objectStoreNames.contains('trades')){
        const s = db.createObjectStore('trades', { keyPath: 'id' });
        s.createIndex('byDate', 'date');
        s.createIndex('bySymbol', 'symbol');
      }
      if(!db.objectStoreNames.contains('settings')){
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

function txp(db, store, mode='readonly'){
  const tx = db.transaction(store, mode);
  return [tx.objectStore(store), tx];
}

export async function put(db, store, value){
  return new Promise((resolve,reject)=>{
    const [s] = txp(db, store, 'readwrite');
    const r = s.put(value);
    r.onsuccess=()=>resolve(true);
    r.onerror=()=>reject(r.error);
  });
}

export async function del(db, store, key){
  return new Promise((resolve,reject)=>{
    const [s] = txp(db, store, 'readwrite');
    const r = s.delete(key);
    r.onsuccess=()=>resolve(true);
    r.onerror=()=>reject(r.error);
  });
}

export async function get(db, store, key){
  return new Promise((resolve,reject)=>{
    const [s] = txp(db, store);
    const r = s.get(key);
    r.onsuccess=()=>resolve(r.result ?? null);
    r.onerror=()=>reject(r.error);
  });
}

export async function listByIndex(db, store, indexName, indexValue){
  return new Promise((resolve,reject)=>{
    const [s] = txp(db, store);
    const idx = s.index(indexName);
    const r = idx.getAll(IDBKeyRange.only(indexValue));
    r.onsuccess=()=>resolve(r.result ?? []);
    r.onerror=()=>reject(r.error);
  });
}

export async function listAll(db, store){
  return new Promise((resolve,reject)=>{
    const [s] = txp(db, store);
    const r = s.getAll();
    r.onsuccess=()=>resolve(r.result ?? []);
    r.onerror=()=>reject(r.error);
  });
}

export async function clearAll(db){
  for (const store of ['candidates','trades','settings']){
    await new Promise((resolve,reject)=>{
      const [s] = txp(db, store, 'readwrite');
      const r = s.clear();
      r.onsuccess=()=>resolve(true);
      r.onerror=()=>reject(r.error);
    });
  }
}
