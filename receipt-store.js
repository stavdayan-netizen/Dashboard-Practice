// Demo-mode storage for repair receipts and invoices (PDF or images).
//
// Why IndexedDB: localStorage only holds about 5 MB of text for the whole site, and base64
// makes files a third bigger, so a few PDFs would fill it. IndexedDB is built into every
// browser, needs no server, stores real file data and keeps it across reloads. The ticket
// keeps only a small durable reference per receipt ({ id, filename, mime, size }); the file
// itself is looked up by that id, so equipment history never holds a copy of a file.
//
// Limits (also written in the docs): files stay in this browser only, are lost if the browser
// data is cleared (and may not persist in private windows), can't be seen from another device,
// and are capped at 5 MB each and 10 per ticket. In production the same references become
// Airtable attachment ids served through the backend with fresh links.
(function () {
  "use strict";

  if (!new URLSearchParams(location.search).has("demo")) return;

  const DB_NAME = "dashboardPractice.demoReceipts";
  const STORE = "files";
  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_PER_TICKET = 10;
  // SVG is left out on purpose: an SVG opened from this site can contain scripts.
  const TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
  const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,application/pdf,image/png,image/jpeg,image/webp,image/gif";

  let dbPromise = null;

  function openDb() {
    if (!("indexedDB" in window)) return Promise.reject(new Error("This browser can't store files (IndexedDB is not available)."));
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        let req;
        try { req = indexedDB.open(DB_NAME, 1); } catch (err) { reject(err); return; }
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("Could not open the browser's file storage."));
        req.onblocked = () => reject(new Error("The browser's file storage is blocked by another tab."));
      });
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  }

  // Runs one request inside a transaction and resolves with the request's result.
  function run(mode, makeRequest) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let req;
      try { req = makeRequest(tx.objectStore(STORE)); } catch (err) { reject(err); return; }
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error || new Error("The browser could not save the file."));
      tx.onabort = () => reject(tx.error || new Error("The browser could not save the file (storage may be full)."));
    }));
  }

  const uid = () => "rcpt-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function mimeOf(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (file.type && Object.values(TYPES).indexOf(file.type) !== -1) return file.type;
    return TYPES[ext] || "";
  }

  // Returns an error message, or "" when the file is fine.
  function checkFile(file) {
    if (!mimeOf(file)) return "“" + file.name + "” isn't a PDF or an image (PNG, JPEG, WebP or GIF).";
    if (file.size === 0) return "“" + file.name + "” is empty.";
    if (file.size > MAX_BYTES) return "“" + file.name + "” is " + (file.size / 1048576).toFixed(1) + " MB. The demo keeps files up to " + (MAX_BYTES / 1048576) + " MB.";
    return "";
  }

  // Saves a file and returns its durable reference.
  async function save(file) {
    const mime = mimeOf(file);
    const ref = { id: uid(), filename: file.name, mime, size: file.size, added: new Date().toISOString() };
    await run("readwrite", (s) => s.put(Object.assign({ blob: new Blob([file], { type: mime }) }, ref)));
    return ref;
  }

  async function getBlob(ref) {
    if (ref.path) {
      const res = await fetch(ref.path);
      if (!res.ok) throw new Error("The file " + ref.filename + " could not be found.");
      return res.blob();
    }
    const rec = await run("readonly", (s) => s.get(ref.id));
    if (!rec || !rec.blob) throw new Error("The file " + ref.filename + " is no longer in this browser (browser data may have been cleared).");
    return rec.blob;
  }

  // Seeded demo receipts are static files; only files added in the demo live in the browser.
  const remove = (ref) => (ref.path ? Promise.resolve() : run("readwrite", (s) => s.delete(ref.id)));
  const clearAll = () => openDb().then(() => run("readwrite", (s) => s.clear())).catch(() => {});
  const available = () => openDb().then(() => true, () => false);

  function openBlob(blob) {
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  window.ReceiptStore = {
    ACCEPT, MAX_BYTES, MAX_PER_TICKET,
    checkFile, save, remove, clearAll, available, getBlob,
    // Opens the original file in a new tab (works for PDFs and images).
    view: async (ref) => openBlob(await getBlob(ref)),
    download: async (ref) => downloadBlob(await getBlob(ref), ref.filename),
    // The same two actions for a file that was picked but not saved yet.
    viewFile: (file) => openBlob(file),
    downloadFile: (file) => downloadBlob(file, file.name),
    formatSize: (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB")
  };
})();
