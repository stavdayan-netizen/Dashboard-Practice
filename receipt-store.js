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
  const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif";

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

  // Returns an error message, or "" when the file is fine. With imagesOnly, PDFs are refused (photos).
  function checkFile(file, imagesOnly) {
    const mime = mimeOf(file);
    if (!mime || (imagesOnly && mime.indexOf("image/") !== 0)) {
      return "“" + file.name + "” isn't " + (imagesOnly ? "an image (PNG, JPEG, WebP or GIF)." : "a PDF or an image (PNG, JPEG, WebP or GIF).");
    }
    if (file.size === 0) return "“" + file.name + "” is empty.";
    if (file.size > MAX_BYTES) return "“" + file.name + "” is " + (file.size / 1048576).toFixed(1) + " MB. The demo keeps files up to " + (MAX_BYTES / 1048576) + " MB.";
    return "";
  }

  // Saves a file and returns its durable reference. The scope ("ticket" for ticket receipts,
  // "history" for equipment history attachments) is kept with the stored file only, so one
  // feature's reset can never delete the other feature's files.
  async function save(file, scope) {
    const mime = mimeOf(file);
    const ref = { id: uid(), filename: file.name, mime, size: file.size, added: new Date().toISOString() };
    await run("readwrite", (s) => s.put(Object.assign({ blob: new Blob([file], { type: mime }), scope: scope || "ticket" }, ref)));
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
  // Deletes every stored file of one scope (files saved before scopes existed count as "ticket").
  function clearScope(scope) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if ((cursor.value.scope || "ticket") === scope) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    })).catch(() => {});
  }
  const available = () => openDb().then(() => true, () => false);

  function formatSize(n) {
    return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  }

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

  // A reusable file editor for forms: a list of the current files (View, Download, Remove) and a
  // multi-file picker. Changes are only staged. The caller saves them with commit() when its own
  // form is saved, then deletes the files in `removed` once that has worked, or deletes `added`
  // if it has not. Used for the attachments on manually added equipment history events.
  function createEditor(opts) {
    const imagesOnly = !!opts.imagesOnly;
    const max = opts.max || MAX_PER_TICKET;
    const scope = opts.scope || "history";
    const staged = { kept: (opts.initial || []).map((r) => Object.assign({}, r)), adds: [], removed: [] };

    const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
    const linkBtn = (text, label, onClick) => {
      const b = make("button", "sys-link-btn", text);
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.addEventListener("click", onClick);
      return b;
    };

    const wrap = make("div", "form-field form-field-wide receipt-editor");
    wrap.appendChild(make("span", null, opts.title));
    const list = make("ul", "receipt-list");
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = imagesOnly ? IMAGE_ACCEPT : ACCEPT;
    input.setAttribute("aria-label", "Add to " + opts.title);
    const help = make("span", "receipt-help", "Up to " + max + " files, " + (MAX_BYTES / 1048576) + " MB each. Saved in this browser only (demo).");
    const status = make("p", "ticket-brief-status");
    status.setAttribute("role", "status");
    wrap.append(list, input, help, status);
    available().then((ok) => { if (!ok) { input.disabled = true; status.textContent = "This browser can't store files right now (for example a private window), so files can't be added."; } });

    const guard = (promise) => promise.then(() => { status.textContent = ""; }, (err) => { status.textContent = err.message; });
    const line = (name, size, buttons, note) => {
      const li = make("li", "receipt-line");
      li.appendChild(make("span", "receipt-name", name));
      li.appendChild(make("span", "receipt-size", formatSize(size || 0) + (note ? " · " + note : "")));
      const actions = make("span", "receipt-actions");
      buttons.forEach((b) => actions.appendChild(b));
      li.appendChild(actions);
      return li;
    };

    function draw() {
      while (list.firstChild) list.removeChild(list.firstChild);
      if (!staged.kept.length && !staged.adds.length) list.appendChild(make("li", "sys-empty", "Nothing added yet."));
      staged.kept.forEach((ref, i) => {
        list.appendChild(line(ref.filename, ref.size, [
          linkBtn("View", "View " + ref.filename, () => guard(window.ReceiptStore.view(ref))),
          linkBtn("Download", "Download " + ref.filename, () => guard(window.ReceiptStore.download(ref))),
          linkBtn("Remove", "Remove " + ref.filename, () => { staged.removed.push(staged.kept.splice(i, 1)[0]); draw(); })
        ]));
      });
      staged.adds.forEach((file, i) => {
        list.appendChild(line(file.name, file.size, [
          linkBtn("View", "View " + file.name, () => window.ReceiptStore.viewFile(file)),
          linkBtn("Download", "Download " + file.name, () => window.ReceiptStore.downloadFile(file)),
          linkBtn("Remove", "Remove " + file.name, () => { staged.adds.splice(i, 1); draw(); })
        ], "added, saved when you save"));
      });
    }
    input.addEventListener("change", () => {
      const problems = [];
      Array.prototype.forEach.call(input.files, (file) => {
        const bad = checkFile(file, imagesOnly);
        if (bad) { problems.push(bad); return; }
        if (staged.kept.length + staged.adds.length >= max) { problems.push("Up to " + max + " files can be added here."); return; }
        staged.adds.push(file);
      });
      input.value = "";
      status.textContent = problems.join(" ");
      draw();
    });
    draw();

    return {
      node: wrap,
      // Stores the newly added files. Resolves with the final list of references plus which files were
      // added and removed; if any file fails, the ones stored so far are undone and the error is thrown.
      async commit() {
        const added = [];
        try {
          for (const file of staged.adds) added.push(await save(file, scope));
        } catch (err) {
          await Promise.all(added.map((r) => remove(r).catch(() => {})));
          throw err;
        }
        return { refs: staged.kept.concat(added), added, removed: staged.removed.slice() };
      }
    };
  }

  window.ReceiptStore = {
    ACCEPT, IMAGE_ACCEPT, MAX_BYTES, MAX_PER_TICKET,
    checkFile, save, remove, clearScope, available, getBlob, createEditor,
    // Opens the original file in a new tab (works for PDFs and images).
    view: async (ref) => openBlob(await getBlob(ref)),
    download: async (ref) => downloadBlob(await getBlob(ref), ref.filename),
    // The same two actions for a file that was picked but not saved yet.
    viewFile: (file) => openBlob(file),
    downloadFile: (file) => downloadBlob(file, file.name),
    formatSize
  };
})();
