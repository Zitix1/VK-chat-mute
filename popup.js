const DEFAULTS = {
  enabled: true,
  hardHide: true,
  muted: {}
};

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function personKey(person) {
  if (person.id) return `uid:${person.id}`;
  if (person.nick) return `nick:${String(person.nick).toLowerCase()}`;
  return null;
}

function samePerson(a, b) {
  if (a.id && b.id) return String(a.id) === String(b.id);
  if (a.nick && b.nick) return String(a.nick).toLowerCase() === String(b.nick).toLowerCase();
  return false;
}

function normalizeMuted(raw) {
  const people = [];
  for (const [key, info] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
    const rec = info && typeof info === "object" ? { ...info } : {};
    if (key.startsWith("uid:")) rec.id = rec.id || key.slice(4);
    else if (key.startsWith("nick:")) rec.nick = rec.nick || key.slice(5);
    else if (/^-?\d+$/.test(key)) rec.id = rec.id || key;
    if (!rec.id && !rec.nick) continue;
    const hit = people.find((p) => samePerson(p, rec));
    if (hit) {
      hit.id = hit.id || rec.id || null;
      hit.nick = hit.nick || rec.nick || null;
      hit.name = hit.name || rec.name || null;
    } else {
      people.push({
        id: rec.id || null,
        nick: rec.nick || null,
        name: rec.name || rec.nick || rec.id,
        addedAt: rec.addedAt || Date.now()
      });
    }
  }
  const out = {};
  for (const person of people) {
    const key = personKey(person);
    if (key) out[key] = person;
  }
  return out;
}

async function loadState() {
  const data = await chrome.storage.sync.get(DEFAULTS);
  const muted = normalizeMuted(data.muted);
  const raw = data.muted && typeof data.muted === "object" ? data.muted : {};
  if (Object.keys(raw).sort().join("|") !== Object.keys(muted).sort().join("|")) {
    await chrome.storage.sync.set({ muted });
  }
  return {
    enabled: data.enabled !== false,
    hardHide: data.hardHide !== false,
    muted
  };
}

function subtitle(person) {
  if (person.nick) return `@${person.nick}`;
  if (person.id) return `id${person.id}`;
  return "";
}

function render(state) {
  document.getElementById("enabled").checked = state.enabled;
  document.getElementById("hardHide").checked = state.hardHide;

  const list = document.getElementById("list");
  const entries = Object.entries(state.muted);
  if (!entries.length) {
    list.innerHTML = '<li class="empty">Пока никого нет. Открой беседу и нажми 🔇 у имени.</li>';
    return;
  }

  list.innerHTML = "";
  for (const [key, info] of entries.sort((a, b) => String(a[1].name || a[0]).localeCompare(String(b[1].name || b[0]), "ru"))) {
    const li = document.createElement("li");
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `<div class="name"></div><div class="id"></div>`;
    meta.querySelector(".name").textContent = info.name || info.nick || "Пользователь";
    meta.querySelector(".id").textContent = subtitle(info);
    const btn = document.createElement("button");
    btn.className = "unmute";
    btn.type = "button";
    btn.textContent = "Снять";
    btn.addEventListener("click", async () => {
      const next = await loadState();
      delete next.muted[key];
      await chrome.storage.sync.set({ muted: next.muted });
      render(await loadState());
    });
    li.append(meta, btn);
    list.append(li);
  }
}

document.getElementById("enabled").addEventListener("change", async (e) => {
  await chrome.storage.sync.set({ enabled: e.target.checked });
});

document.getElementById("hardHide").addEventListener("change", async (e) => {
  await chrome.storage.sync.set({ hardHide: e.target.checked });
});

document.getElementById("clearAll").addEventListener("click", async () => {
  if (!confirm("Снять мут со всех?")) return;
  await chrome.storage.sync.set({ muted: {} });
  render(await loadState());
});

document.getElementById("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = document.getElementById("addInput").value.trim();
  if (!raw) return;
  const parsed = parseTarget(raw);
  if (!parsed) {
    alert("Не понял. Вставь ссылку vk.com/id..., числовой id или @username.");
    return;
  }
  const state = await loadState();
  const person = {
    id: parsed.id || null,
    nick: parsed.nick || null,
    name: parsed.name,
    addedAt: Date.now()
  };
  const existingKey = Object.keys(state.muted).find((key) => samePerson(state.muted[key], person));
  if (existingKey) delete state.muted[existingKey];
  state.muted[personKey(person)] = person;
  await chrome.storage.sync.set({ muted: state.muted });
  document.getElementById("addInput").value = "";
  render(await loadState());
});

function parseTarget(raw) {
  const text = raw.trim();
  if (/^-?\d+$/.test(text)) {
    return { id: text, nick: null, name: `id${text}` };
  }
  const hrefId = text.match(/\/id(\d+)/i);
  if (hrefId) return { id: hrefId[1], nick: null, name: `id${hrefId[1]}` };
  const club = text.match(/\/(?:club|public|event)(\d+)/i);
  if (club) return { id: `-${club[1]}`, nick: null, name: `club${club[1]}` };
  const nick = text.match(/^(?:https?:\/\/)?(?:m\.)?vk\.(?:com|ru)\/([a-zA-Z0-9._]+)\/?$/i) || text.match(/^@?([a-zA-Z0-9._]+)$/);
  if (nick) return { id: null, nick: nick[1], name: nick[1] };
  return null;
}

loadState().then(render);
document.getElementById("ver").textContent = chrome.runtime.getManifest().version;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.muted) loadState().then(render);
});
