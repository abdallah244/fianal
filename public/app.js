const $ = (id) => document.getElementById(id);

window.addEventListener("error", (e) => {
  try {
    const msg = e?.error?.message || e?.message || "Unknown error";
    toast("UI Error", msg, "bad");
  } catch {}
});

window.addEventListener("unhandledrejection", (e) => {
  try {
    const reason = e?.reason?.message || String(e?.reason || "Unknown");
    toast("Promise Error", reason, "bad");
  } catch {}
});

const state = {
  token: localStorage.getItem("adminToken") || "",
  inbox: new Map(),
  replied: new Map(),
  selected: new Set(),
  socket: null,
  loadingTimer: null,
};

function setLoading(isLoading) {
  const el = $("loading");
  if (!el) return;

  if (isLoading) {
    el.style.display = "grid";
    if (state.loadingTimer) clearTimeout(state.loadingTimer);
    state.loadingTimer = setTimeout(() => {
      toast(
        "لسه بيحمّل",
        "لو فضلت كده: افتح /api/health وشوف رسالة الخطأ",
        "bad",
      );
    }, 12000);
  } else {
    el.style.display = "none";
    if (state.loadingTimer) clearTimeout(state.loadingTimer);
    state.loadingTimer = null;
  }
}

function toast(title, detail = "", kind = "good") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<div class="t"></div><div class="d"></div>`;
  el.querySelector(".t").textContent = title;
  el.querySelector(".d").textContent = detail;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function setStatus(connected) {
  $("statusDot").style.background = connected ? "var(--success)" : "#666";
  $("statusText").textContent = connected ? "متصل" : "غير متصل";
}

function authHeaders() {
  return state.token ? { "x-admin-token": state.token } : {};
}

function fmtTime(value) {
  try {
    const d = new Date(value);
    return d.toLocaleString("ar-EG");
  } catch {
    return "";
  }
}

function updateCounts() {
  $("inboxCount").textContent = String(state.inbox.size);
  $("repliedCount").textContent = String(state.replied.size);
  $("selectedCount").textContent = `${state.selected.size} محدد`;
}

function isSelected(id) {
  return state.selected.has(id);
}

function toggleSelected(id, checked) {
  if (checked) state.selected.add(id);
  else state.selected.delete(id);
  updateCounts();
}

function cardHtml(msg, { selectable }) {
  const checked = isSelected(msg._id || msg.id) ? "checked" : "";
  const id = msg._id || msg.id;
  const from = msg.from || "";
  const text = msg.text || "";
  const ts = msg.timestamp || msg.createdAt;

  const selectBox = selectable
    ? `<label class="meta"><input type="checkbox" data-id="${id}" class="sel" ${checked}/> تحديد</label>`
    : "";

  const replyLine = msg.replyText
    ? `<div class="meta">الرد: ${msg.replyText}</div>`
    : "";

  return `
    <div class="card" data-card-id="${id}">
      <div class="cardTop">
        <div>
          <div class="meta">من: ${from}</div>
          <div class="meta">وقت: ${fmtTime(ts)}</div>
        </div>
        <div>${selectBox}</div>
      </div>
      <div class="text">${escapeHtml(text)}</div>
      ${replyLine}
      <div class="actions">
        <button class="smallBtn danger del" data-id="${id}">حذف</button>
        <span class="muted">${msg.status === "replied" ? "تم الرد" : "وارد"}</span>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderLists() {
  $("inbox").innerHTML = Array.from(state.inbox.values())
    .sort(
      (a, b) =>
        new Date(b.timestamp || b.createdAt) -
        new Date(a.timestamp || a.createdAt),
    )
    .map((m) => cardHtml(m, { selectable: true }))
    .join("");

  $("replied").innerHTML = Array.from(state.replied.values())
    .sort(
      (a, b) =>
        new Date(b.repliedAt || b.updatedAt || b.createdAt) -
        new Date(a.repliedAt || a.updatedAt || a.createdAt),
    )
    .map((m) => cardHtml(m, { selectable: false }))
    .join("");

  updateCounts();
}

function upsertMessage(msg) {
  const id = msg._id || msg.id;
  if (!id) return;

  if (msg.status === "replied") {
    state.inbox.delete(id);
    state.selected.delete(id);
    state.replied.set(id, msg);
  } else {
    state.replied.delete(id);
    state.inbox.set(id, msg);
  }

  renderLists();
}

function deleteMessage(id) {
  state.inbox.delete(id);
  state.replied.delete(id);
  state.selected.delete(id);
  renderLists();
}

async function apiGet(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  const resp = await fetch(url, {
    headers: authHeaders(),
    signal: ctrl.signal,
  }).finally(() => clearTimeout(t));
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
  return data;
}

async function apiPost(url, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  }).finally(() => clearTimeout(t));
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
  return data;
}

async function apiDelete(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  const resp = await fetch(url, {
    method: "DELETE",
    headers: authHeaders(),
    signal: ctrl.signal,
  }).finally(() => clearTimeout(t));
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
  return data;
}

async function loadLists() {
  setLoading(true);
  try {
    const [inbox, replied] = await Promise.all([
      apiGet("/api/messages?status=new"),
      apiGet("/api/messages?status=replied"),
    ]);

    state.inbox.clear();
    state.replied.clear();

    for (const m of inbox.messages || []) state.inbox.set(String(m._id), m);
    for (const m of replied.messages || []) state.replied.set(String(m._id), m);

    renderLists();
    toast("تم التحديث", "اتسحب آخر الرسائل", "good");
  } catch (e) {
    toast("خطأ في تحميل القوائم", e.message, "bad");
  } finally {
    setLoading(false);
  }
}

async function checkHealth() {
  try {
    const health = await apiGet("/api/health");
    if (health.wantMongo && health.mode === "memory") {
      toast(
        "MongoDB مش متصل",
        health.mongoError || "شغال دلوقتي بدون تخزين (Memory mode)",
        "bad",
      );
    }
  } catch (e) {
    toast("Health check فشل", e.message, "bad");
  }
}

function connectSocket() {
  if (state.socket) {
    try {
      state.socket.disconnect();
    } catch {}
  }

  state.socket = io({
    transports: ["websocket", "polling"],
  });

  state.socket.on("connect", () => setStatus(true));
  state.socket.on("disconnect", () => setStatus(false));
  state.socket.on("connect_error", (err) => {
    setStatus(false);
    toast("Socket خطأ", err.message || "connect_error", "bad");
  });

  state.socket.on("message:new", (msg) => {
    upsertMessage(msg);
    toast("رسالة جديدة", `${msg.from}`, "good");
  });

  state.socket.on("message:updated", (msg) => {
    upsertMessage(msg);
  });

  state.socket.on("message:deleted", ({ id }) => {
    deleteMessage(id);
  });
}

function bindUi() {
  $("adminToken").value = state.token;

  $("saveToken").addEventListener("click", () => {
    state.token = $("adminToken").value.trim();
    localStorage.setItem("adminToken", state.token);
    toast(
      "تم حفظ التوكن",
      state.token ? "هيحمي عمليات الإرسال/الحذف" : "بدون توكن",
      "good",
    );
    connectSocket();
  });

  $("reload").addEventListener("click", loadLists);

  $("selectAll").addEventListener("click", () => {
    for (const id of state.inbox.keys()) state.selected.add(id);
    renderLists();
  });

  $("clearSelection").addEventListener("click", () => {
    state.selected.clear();
    renderLists();
  });

  $("sendReply").addEventListener("click", async () => {
    const text = $("replyText").value.trim();
    const messageIds = Array.from(state.selected);
    if (!text) {
      toast("اكتب رسالة", "لازم تكتب نص قبل الإرسال", "bad");
      return;
    }
    if (messageIds.length === 0) {
      toast("مفيش محدد", "حدد رسائل من الوارد الأول", "bad");
      return;
    }

    setLoading(true);
    try {
      const r = await apiPost("/api/reply", { messageIds, text });
      toast("تم الإرسال", `اتبعِت لـ ${r.count} رقم`, "good");
      $("replyText").value = "";
      state.selected.clear();
      await loadLists();
    } catch (e) {
      toast("فشل الإرسال", e.message, "bad");
    } finally {
      setLoading(false);
    }
  });

  document.body.addEventListener("change", (e) => {
    const target = e.target;
    if (target && target.classList.contains("sel")) {
      const id = target.getAttribute("data-id");
      toggleSelected(id, target.checked);
    }
  });

  document.body.addEventListener("click", async (e) => {
    const target = e.target;
    if (target && target.classList.contains("del")) {
      const id = target.getAttribute("data-id");
      if (!confirm("حذف الرسالة؟")) return;
      setLoading(true);
      try {
        await apiDelete(`/api/messages/${id}`);
        deleteMessage(id);
        toast("تم الحذف", "", "good");
      } catch (err) {
        toast("فشل الحذف", err.message, "bad");
      } finally {
        setLoading(false);
      }
    }
  });
}

bindUi();
connectSocket();
checkHealth();
loadLists();
