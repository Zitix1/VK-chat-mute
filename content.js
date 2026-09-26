(() => {
  const STORAGE_KEYS = { enabled: true, hardHide: true, muted: {} };
  const PROCESSED = "data-vkcm";
  const BTN_ATTR = "data-vkcm-btn";

  let enabled = true;
  let hardHide = true;
  let muted = {};
  let scheduled = false;

  const toastEl = document.createElement("div");
  toastEl.className = "vkcm-toast";
  document.documentElement.appendChild(toastEl);
  let toastTimer = 0;

  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 1800);
  }

  function load() {
    chrome.storage.sync.get(STORAGE_KEYS, (data) => {
      enabled = data.enabled !== false;
      hardHide = data.hardHide !== false;
      muted = normalizeMuted(data.muted);
      const rawKeys = Object.keys(data.muted && typeof data.muted === "object" ? data.muted : {});
      if (rawKeys.sort().join("|") !== Object.keys(muted).sort().join("|")) {
        chrome.storage.sync.set({ muted });
      }
      scan(true);
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.enabled) enabled = changes.enabled.newValue !== false;
    if (changes.hardHide) hardHide = changes.hardHide.newValue !== false;
    if (changes.muted) muted = normalizeMuted(changes.muted.newValue || {});
    scan(true);
  });

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

  function cleanName(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isMuted(info) {
    if (!info) return false;
    const name = cleanName(info.name);
    return Object.values(muted).some((person) => {
      if (info.id && person.id && String(info.id) === String(person.id)) return true;
      if (info.nick && person.nick && String(info.nick).toLowerCase() === String(person.nick).toLowerCase()) return true;
      const theirs = cleanName(person.name);
      return name.length > 1 && theirs.length > 1 && name === theirs;
    });
  }

  function parseUserFromHref(href) {
    if (!href) return null;
    try {
      const url = new URL(href, location.origin);
      const path = decodeURIComponent(url.pathname || "");
      const id = path.match(/\/id(\d+)/i);
      if (id) return { id: id[1], nick: null };
      const club = path.match(/\/(?:club|public|event)(\d+)/i);
      if (club) return { id: `-${club[1]}`, nick: null };
      const write = url.searchParams.get("sel") || url.searchParams.get("z");
      if (write && /^-?\d+$/.test(write)) return { id: write, nick: null };
      const nick = path.replace(/^\//, "").split("/")[0];
      if (nick && !["im", "mail", "feed", "video", "music", "clips", "vkvideo"].includes(nick.toLowerCase())) {
        return { id: null, nick };
      }
    } catch (_) {}
    return null;
  }

  function extractFromDataset(el) {
    if (!el || !el.dataset) return {};
    const raw =
      el.dataset.from ||
      el.dataset.fromId ||
      el.dataset.peer ||
      el.dataset.userid ||
      el.dataset.userId ||
      el.dataset.authorId ||
      "";
    if (/^-?\d+$/.test(String(raw)) && raw !== "0") return { id: String(raw) };
    return {};
  }

  function findAuthorLink(root) {
    const links = [...root.querySelectorAll("a[href]")];
    const scored = [];
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      if (!href || href === "#" || href.startsWith("javascript:")) continue;
      const parsed = parseUserFromHref(href);
      if (!parsed) continue;
      const cls = `${a.className} ${a.parentElement?.className || ""}`;
      let score = 0;
      if (parsed.id) score += 8;
      if (parsed.nick) score += 3;
      if (/author|stack--lnk|im-mess-stack|Peer|profile|ConvoMessage/i.test(cls)) score += 4;
      if (a.closest(".im-mess-stack--lnks, .im-mess-stack--info, [class*='Author'], [class*='author']")) score += 4;
      scored.push({ a, parsed, score });
    }
    scored.sort((x, y) => y.score - x.score);
    return scored[0] || null;
  }

  function headerLink(root) {
    const all = [...root.querySelectorAll(
      "a[class*='authorLink'], a[class*='AuthorLink'], .im-mess-stack--lnk, [class*='ConvoMessageHeader'] a[href], [class*='MessageHeader'] a[href]"
    )];
    const link = all.find((a) => {
      if (!parseUserFromHref(a.getAttribute("href"))) return false;
      return !a.closest("[class*='Reply'], [class*='reply'], [class*='Forward'], [class*='forward'], [class*='Quote'], [class*='quote']");
    });
    return link || null;
  }

  function readHeader(root) {
    const link = headerLink(root);
    if (!link) return null;
    const parsed = parseUserFromHref(link.getAttribute("href")) || {};
    const name = (link.querySelector("[class*='PeerTitle__title']")?.textContent || link.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      id: parsed.id || authorIdFromData(root),
      nick: parsed.nick || null,
      name,
      link
    };
  }

  function authorIdFromData(root) {
    const nodes = root.querySelectorAll("[data-from], [data-from-id], [data-author-id], [data-userid]");
    for (const el of [root, ...nodes]) {
      const raw = el?.dataset?.from || el?.dataset?.fromId || el?.dataset?.authorId || el?.dataset?.userid || "";
      if (/^-?\d+$/.test(String(raw)) && raw !== "0" && Number(raw) < 2000000000) return String(raw);
    }
    return null;
  }

  function getMessageRoots() {
    const all = [...document.querySelectorAll(".im-mess-stack, .im-mess, [class*='ConvoHistory__messageBlock']")];
    return all.filter((n) => !all.some((c) => c !== n && n.contains(c)));
  }

  function isOwn(root) {
    const cls = String(root.className || "");
    if (/mess_out|ConvoMessage--out|--out\b|isOutgoing/i.test(cls)) return true;
    return !!root.querySelector("[class*='ConvoMessage--out'], .im-mess_out");
  }

  function authorLinks(root) {
    return [...root.querySelectorAll(
      "a[class*='authorLink'], a[class*='AuthorLink'], .im-mess-stack--lnk, [class*='ConvoMessageHeader'] a[href]"
    )].filter((a) => {
      if (!parseUserFromHref(a.getAttribute("href"))) return false;
      return !a.closest("[class*='Reply'], [class*='reply'], [class*='Forward'], [class*='forward'], [class*='Quote'], [class*='quote']");
    });
  }

  function placeholderFor(root, info) {
    let el = root.nextElementSibling;
    if (el && el.classList.contains("vkcm-placeholder")) return el;
    el = document.createElement("div");
    el.className = "vkcm-placeholder";
    el.innerHTML = `<span></span><button type="button">показать</button>`;
    el.querySelector("span").textContent = `${info.name || "Пользователь"}: сообщение скрыто`;
    el.querySelector("button").addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      unmute(info);
    });
    root.after(el);
    return el;
  }

  function clearEffects(root) {
    if (!root.classList.contains("vkcm-hidden") && !root.classList.contains("vkcm-collapsed") && !root.hasAttribute(PROCESSED)) {
      const next = root.nextElementSibling;
      if (!next || !next.classList.contains("vkcm-placeholder")) return;
    }
    root.classList.remove("vkcm-hidden", "vkcm-collapsed");
    root.removeAttribute(PROCESSED);
    const next = root.nextElementSibling;
    if (next && next.classList.contains("vkcm-placeholder")) next.remove();
  }

  function applyMute(root, info) {
    if (!enabled || !isMuted(info)) {
      clearEffects(root);
      return;
    }
    root.setAttribute(PROCESSED, "1");
    if (hardHide) {
      root.classList.add("vkcm-hidden");
      root.classList.remove("vkcm-collapsed");
      const next = root.nextElementSibling;
      if (next && next.classList.contains("vkcm-placeholder")) next.remove();
    } else {
      root.classList.remove("vkcm-hidden");
      root.classList.add("vkcm-collapsed");
      placeholderFor(root, info);
    }
  }

  function mute(info) {
    if (!info.id && !info.nick) {
      toast("Нет id или ника — мутить нечего");
      return;
    }
    const next = { ...muted };
    const existingKey = Object.keys(next).find((key) => samePerson(next[key], info));
    const current = existingKey ? next[existingKey] : {};
    if (existingKey) delete next[existingKey];
    const person = {
      id: info.id || current.id || null,
      nick: info.nick || current.nick || null,
      name: info.name || current.name || info.nick || info.id,
      addedAt: current.addedAt || Date.now()
    };
    next[personKey(person)] = person;
    muted = next;
    chrome.storage.sync.set({ muted: next });
    toast(`Замьютил: ${person.name}`);
  }

  function unmute(info) {
    const next = { ...muted };
    Object.keys(next).forEach((key) => {
      if (samePerson(next[key], info)) delete next[key];
    });
    muted = next;
    chrome.storage.sync.set({ muted: next });
    toast("Мут снят");
  }

  function ensureButton(info) {
    if (!info?.link) return;
    const parent = info.link.parentElement;
    if (!parent) return;
    parent.classList.add("vkcm-author-host");
    const existing = [...parent.querySelectorAll(".vkcm-mute-btn")];
    existing.slice(1).forEach((btn) => btn.remove());
    let btn = existing[0];
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vkcm-mute-btn";
      btn.setAttribute(BTN_ATTR, "1");
      btn.textContent = "🔇";
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const current = btn._vkcmInfo || info;
        if (isMuted(current)) unmute(current);
        else mute(current);
      });
      info.link.after(btn);
    }
    btn._vkcmInfo = info;
    btn.classList.toggle("is-muted", isMuted(info));
    btn.title = isMuted(info) ? "Снять мут" : "Скрыть сообщения этого человека";
  }

  function dedupeButtons() {
    const seen = new Set();
    document.querySelectorAll(".vkcm-mute-btn").forEach((btn) => {
      const host = btn.parentElement;
      if (!host || seen.has(host)) btn.remove();
      else seen.add(host);
    });
  }

  let scanning = false;
  let scrollPause = false;
  let scanTimer = 0;

  function scan(force) {
    if (scrollPause && !force) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => runScan(), force ? 0 : 200);
  }

  function runScan() {
    if (scanning) return;
    scanning = true;
    observer.disconnect();
    try {
      const roots = getMessageRoots();
      let carried = null;
      for (const root of roots) {
        if (isOwn(root)) {
          carried = null;
          clearEffects(root);
          continue;
        }
        const links = authorLinks(root);
        if (links.length > 1) {
          carried = null;
          clearEffects(root);
          continue;
        }
        const header = links.length === 1 ? readHeader(root) : null;
        if (header) {
          carried = header;
          ensureButton(header);
        }
        const info = header || carried;
        if (info) applyMute(root, info);
        else clearEffects(root);
      }
      dedupeButtons();
      if (!enabled) {
        document.querySelectorAll(".vkcm-placeholder").forEach((n) => n.remove());
        document.querySelectorAll(".vkcm-hidden, .vkcm-collapsed").forEach((n) => {
          n.classList.remove("vkcm-hidden", "vkcm-collapsed");
        });
      }
    } finally {
      scanning = false;
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (scanning || scrollPause) return;
    const foreign = mutations.some((m) => {
      const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!el || el.closest?.(".vkcm-mute-btn, .vkcm-placeholder, .vkcm-toast")) return false;
      return true;
    });
    if (foreign) scan(false);
  });

  window.addEventListener("scroll", () => {
    scrollPause = true;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scrollPause = false;
      scan(true);
    }, 350);
  }, true);

  load();
  scan(true);
})();
