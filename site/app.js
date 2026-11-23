(() => {
  const CAT_ORDER = ["סלטים", "מרקים", "עיקרי", "תוספות", "קינוחים"];
  const KASH_ORDER = ["בשרי", "חלבי", "פרווה"];
  const ALL = "";

  const $ = (id) => document.getElementById(id);
  const grid = $("grid"), count = $("count"), empty = $("empty"), q = $("q");
  const dlg = $("recipe");

  let recipes = [];
  // cats: selected dish types (empty = all).
  // kash: Map of kashrut -> "in" | "out" (first press includes it, the second excludes it, the third clears it).
  const state = { q: "", cats: new Set(), kash: new Map() };

  // Normalise Hebrew text for search: drop niqqud/punctuation, unify final letters and quotes.
  const FINALS = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
  function norm(s) {
    return (s || "")
      .toLowerCase()
      .replace(/[֑-ׇ]/g, "")
      .replace(/[ךםןףץ]/g, (c) => FINALS[c])
      .replace(/[׳'’`"״”“]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sortBy = (order) => (a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, "he");
  };

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const list = (key) => (p.get(key) || "").split(",").map((s) => s.trim()).filter(Boolean);
    state.q = p.get("q") || "";
    state.cats = new Set(list("cat"));
    state.kash = new Map(list("k").map((v) => (v.startsWith("!") ? [v.slice(1), "out"] : [v, "in"])));
    return p.get("r");
  }
  function writeHash(recipeId) {
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.cats.size) p.set("cat", [...state.cats].join(","));
    if (state.kash.size) p.set("k", [...state.kash].map(([v, m]) => (m === "out" ? "!" : "") + v).join(","));
    if (recipeId) p.set("r", recipeId);
    const h = p.toString();
    history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }

  function matches(r, { ignoreCat = false, ignoreKash = false } = {}) {
    if (!ignoreCat && state.cats.size && !state.cats.has(r.category)) return false;
    if (!ignoreKash && state.kash.size) {
      const mode = state.kash.get(r.kashrut);
      if (mode === "out") return false;
      const anyIn = [...state.kash.values()].includes("in");
      if (anyIn && mode !== "in") return false;
    }
    if (state.q) {
      const words = norm(state.q).split(" ").filter(Boolean);
      return words.every((w) => r._title.includes(w)) || words.every((w) => r._all.includes(w));
    }
    return true;
  }

  function countBy(key, ignore) {
    const counts = {};
    recipes.filter((r) => matches(r, ignore)).forEach((r) => { counts[r[key]] = (counts[r[key]] || 0) + 1; });
    return counts;
  }
  const chip = (v, label, n, attrs, cls = "") =>
    `<button class="chip ${cls}" data-v="${esc(v)}" ${attrs}>${esc(label)}${n === null ? "" : `<span class="n">${n}</span>`}</button>`;

  // Dish type: several can be on at once; "כל המנות" clears the selection.
  function catChips(el, values) {
    const counts = countBy("category", { ignoreCat: true });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    el.innerHTML =
      chip(ALL, "כל המנות", total, `role="checkbox" aria-checked="${state.cats.size === 0}"`) +
      values.map((v) => chip(v, v, counts[v] || 0, `role="checkbox" aria-checked="${state.cats.has(v)}"`)).join("");
    el.onclick = (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      const v = b.dataset.v;
      if (v === ALL) state.cats.clear();
      else if (state.cats.has(v)) state.cats.delete(v);
      else state.cats.add(v);
      render();
    };
  }

  // Kashrut: each press cycles off -> include -> exclude ("לא …", red) -> off; "הכל" clears.
  function kashChips(el, values) {
    const counts = countBy("kashrut", { ignoreKash: true });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    el.innerHTML =
      chip(ALL, "הכל", total, `aria-pressed="${state.kash.size === 0}"`) +
      values.map((v) => {
        const mode = state.kash.get(v);
        const label = mode === "out" ? `לא ${v}` : v;
        const title = mode === "out" ? "לחיצה נוספת תבטל" : mode === "in" ? "לחיצה נוספת: ללא " + v : "";
        return chip(v, label, mode === "out" ? null : counts[v] || 0,
          `aria-pressed="${mode ? "true" : "false"}" title="${esc(title)}"`, mode === "out" ? "not" : "");
      }).join("");
    el.onclick = (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      const v = b.dataset.v;
      if (v === ALL) state.kash.clear();
      else {
        const mode = state.kash.get(v);
        if (!mode) state.kash.set(v, "in");
        else if (mode === "in") state.kash.set(v, "out");
        else state.kash.delete(v);
      }
      render();
    };
  }

  const addBtn = (r) => {
    const on = menu.includes(r.id);
    return `<button class="add${on ? " on" : ""}" data-add="${esc(r.id)}" aria-pressed="${on}"
      title="${on ? "הסרה מהתפריט" : "הוספה לתפריט"}" aria-label="${on ? "הסרה מהתפריט" : "הוספה לתפריט"}: ${esc(r.title)}">${on ? "✓" : "＋"}</button>`;
  };
  function card(r) {
    const media = r.image
      ? `<img class="thumb" src="${esc(r.image)}" alt="" loading="lazy" decoding="async">`
      : `<div class="placeholder" aria-hidden="true">${esc([...r.title][0] || "?")}</div>`;
    return `<div class="card${menu.includes(r.id) ? " in-menu" : ""}">
      <button class="card-open" data-id="${esc(r.id)}">
        ${media}
        <div class="card-body">
          <h3>${esc(r.title)}</h3>
          <div class="badges">${badges(r)}</div>
        </div>
      </button>
      ${addBtn(r)}
    </div>`;
  }
  const badges = (r) =>
    (r.category ? `<span class="badge">${esc(r.category)}</span>` : "") +
    (r.kashrut ? `<span class="badge k-${esc(r.kashrut)}">${esc(r.kashrut)}</span>` : "");

  function render() {
    const cats = [...new Set(recipes.map((r) => r.category).filter(Boolean))].sort(sortBy(CAT_ORDER));
    const kashes = [...new Set(recipes.map((r) => r.kashrut).filter(Boolean))].sort(sortBy(KASH_ORDER));
    catChips($("cat-chips"), cats);
    kashChips($("kash-chips"), kashes);

    const list = recipes.filter((r) => matches(r));
    grid.innerHTML = list.map(card).join("");
    count.textContent = list.length === recipes.length ? `${recipes.length} מתכונים` : `${list.length} מתוך ${recipes.length} מתכונים`;
    empty.hidden = list.length > 0;
    writeHash(dlg.open ? dlg.dataset.id : null);
  }

  function groupsHtml(groups, ordered) {
    const tag = ordered ? "ol" : "ul";
    let n = 1;
    return groups.map((g) => {
      const start = ordered ? ` start="${n}"` : "";
      n += g.items.length;
      return (g.heading ? `<h4>${esc(g.heading)}</h4>` : "") +
        `<${tag}${start}>${g.items.map((i) => `<li>${esc(i)}</li>`).join("")}</${tag}>`;
    }).join("");
  }

  function openRecipe(id) {
    const r = recipes.find((x) => x.id === id);
    if (!r) return;
    dlg.dataset.id = id;
    $("r-photo").innerHTML = r.imageFull ? `<img src="${esc(r.imageFull)}" alt="${esc(r.title)}">` : "";
    $("r-badges").innerHTML = badges(r);
    $("r-title").textContent = r.title;
    let html = "";
    if (r.ingredients.length) html += `<h3>מצרכים</h3>${groupsHtml(r.ingredients, false)}`;
    if (r.substitutions.length) html += `<h4>החלפות</h4><ul class="subs">${r.substitutions.map((s) => `<li>${esc(s.replace(/\s*->\s*/g, " ← "))}</li>`).join("")}</ul>`;
    if (r.steps.length) html += `<h3>אופן הכנה</h3>${groupsHtml(r.steps, true)}`;
    if (r.notes && r.notes.length) html += `<h3>הערות</h3><ul>${r.notes.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`;
    $("r-content").innerHTML = html;
    $("r-links").innerHTML =
      `<button type="button" class="r-add${menu.includes(id) ? " on" : ""}" data-add="${esc(id)}">${menu.includes(id) ? "✓ בתפריט (הסרה)" : "＋ הוספה לתפריט"}</button>` +
      (r.sourceUrl ? `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">🔗 מקור המתכון</a>` : "") +
      `<a href="${esc(r.driveUrl)}" target="_blank" rel="noopener">📄 פתיחה ב-Drive</a>`;
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    writeHash(id);
  }

  grid.addEventListener("click", (e) => {
    const a = e.target.closest("[data-add]");
    if (a) return toggleMenu(a.dataset.add);
    const c = e.target.closest(".card-open");
    if (c) openRecipe(c.dataset.id);
  });
  $("r-links").addEventListener("click", (e) => {
    const a = e.target.closest("[data-add]");
    if (a) { toggleMenu(a.dataset.add); openRecipe(a.dataset.add); }
  });

  // ---------- Menu + groceries list ----------
  // Kept in this browser only (localStorage); a share link carries it to someone else.
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const MENU_KEY = "reciplease.menu", CHECK_KEY = "reciplease.checked", VIEW_KEY = "reciplease.view";
  let menu = store.get(MENU_KEY, []);
  let checked = new Set(store.get(CHECK_KEY, []));
  let view = store.get(VIEW_KEY, "merged");
  const mdlg = $("menu");

  function saveMenu() {
    store.set(MENU_KEY, menu);
    const n = $("menu-n");
    n.textContent = menu.length;
    n.hidden = menu.length === 0;
  }
  function toggleMenu(id) {
    menu = menu.includes(id) ? menu.filter((x) => x !== id) : [...menu, id];
    saveMenu();
    render();
    if (mdlg.open) renderMenu();
  }

  // Turn "2 כפות שמן זית (לא חובה)" into the item to buy: "שמן זית".
  const UNITS = new Set(("כוס כוסות כפית כפיות כף כפות גרם גר ג קג קילו קילוגרם מל ליטר ליטרים " +
    "חבילה חבילות חבילת יחידה יחידות קופסה קופסת קופסא קופסאות שקית שקיות פחית פחיות צרור צרורות " +
    "קורט שן שיני ענף ענפי ענפים חופן חופני מעט קצת חצי רבע שליש בערך כ גביע גביעי גביעים " +
    "חתיכה חתיכות פרוסה פרוסות מארז מגש ראש ראשי עלי בינוני בינונית בינוניים בינוניות גדול גדולה " +
    "גדולים גדולות קטן קטנה קטנים קטנות של").split(" "));
  const QTY = /^[\d½⅓⅔¼¾⅛⅜⅝⅞.,/\-–+]+$/;
  const TAIL = /\s+(לפי (ה)?טעם|בטמפרטורת החדר|לקישוט|להגשה|לטיגון|לציפוי|ל?פי הצורך)$/;
  const PANTRY = new Set(["מלח", "פלפל", "פלפל שחור", "פלפל שחור גרוס", "שמן", "שמן זית", "שמן קנולה",
    "שמן צמחי", "שמן לטיגון", "מים", "סוכר", "תבלינים", "מלח ופלפל", "מלח גס", "קמח"].map(norm));

  function itemName(line) {
    let s = line.replace(/\([^)]*\)/g, " ").split(/,| - | – /)[0];
    let words = s.trim().split(/\s+/);
    while (words.length > 1 && (QTY.test(words[0]) || UNITS.has(words[0].replace(/["'׳״]/g, "")))) words.shift();
    s = words.join(" ");
    let prev;
    do { prev = s; s = s.replace(TAIL, ""); } while (s !== prev);
    return s.trim() || line.trim();
  }

  function groceries() {
    const dishes = menu.map((id) => recipes.find((r) => r.id === id)).filter(Boolean);
    const merged = new Map();
    for (const r of dishes) {
      for (const g of r.ingredients) for (const line of g.items) {
        const name = itemName(line), key = norm(name);
        if (!key) continue;
        if (!merged.has(key)) merged.set(key, { key, name, uses: [] });
        merged.get(key).uses.push({ line, dish: r.title });
      }
    }
    const items = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, "he"));
    return { dishes, buy: items.filter((i) => !PANTRY.has(i.key)), pantry: items.filter((i) => PANTRY.has(i.key)) };
  }

  const checkItem = (key, label, detail) =>
    `<li><label class="${checked.has(key) ? "done" : ""}"><input type="checkbox" data-key="${esc(key)}"${checked.has(key) ? " checked" : ""}>
      <span>${esc(label)}${detail ? `<small>${detail}</small>` : ""}</span></label></li>`;
  // "חבילת גזר (גזר ביוגורט, גזר בתנור) · 2 גזרים (מרק)" — same line from several dishes is shown once.
  const mergedDetail = (i) => {
    const byLine = new Map();
    i.uses.forEach((u) => {
      const k = norm(u.line) === i.key ? "" : u.line;
      if (!byLine.has(k)) byLine.set(k, new Set());
      byLine.get(k).add(u.dish);
    });
    const many = menu.length > 1;
    return [...byLine].map(([line, ds]) => {
      const who = many ? [...ds].map(esc).join(", ") : "";
      return line ? esc(line) + (who ? ` (${who})` : "") : who;
    }).filter(Boolean).join(" · ");
  };

  function renderMenu() {
    const { dishes, buy, pantry } = groceries();
    $("m-empty").hidden = dishes.length > 0;
    $("m-groceries").hidden = dishes.length === 0;
    $("m-dishes").innerHTML = dishes.map((r) => `<li>
      ${r.image ? `<img src="${esc(r.image)}" alt="">` : `<span class="m-ph">${esc([...r.title][0] || "?")}</span>`}
      <button type="button" class="m-open" data-id="${esc(r.id)}">${esc(r.title)}</button>
      <button type="button" class="m-remove" data-add="${esc(r.id)}" aria-label="הסרה מהתפריט: ${esc(r.title)}" title="הסרה מהתפריט">✕</button>
    </li>`).join("");
    mdlg.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === view));
    let html = "";
    if (view === "dish") {
      html = dishes.map((r) => `<h4>${esc(r.title)}</h4><ul class="check">${
        r.ingredients.flatMap((g) => g.items).map((line) => checkItem(r.id + "|" + line, line)).join("")}</ul>`).join("");
    } else {
      html = `<ul class="check">${buy.map((i) => checkItem(i.key, i.name, mergedDetail(i))).join("")}</ul>`;
      if (pantry.length) html += `<h4>בדרך כלל יש בבית – כדאי לבדוק</h4><ul class="check">${
        pantry.map((i) => checkItem(i.key, i.name, mergedDetail(i))).join("")}</ul>`;
    }
    $("m-list").innerHTML = html;
    $("m-wa").href = "https://wa.me/?text=" + encodeURIComponent(listText());
    $("m-status").textContent = "";
  }

  function listText() {
    const { dishes, buy, pantry } = groceries();
    const box = (k) => (checked.has(k) ? "✅" : "⬜");
    let out = `🛒 רשימת קניות\nתפריט: ${dishes.map((r) => r.title).join(", ")}\n\n`;
    if (view === "dish") {
      out += dishes.map((r) => `*${r.title}*\n` + r.ingredients.flatMap((g) => g.items)
        .map((l) => `${box(r.id + "|" + l)} ${l}`).join("\n")).join("\n\n");
    } else {
      const line = (i) => {
        const q = [...new Set(i.uses.filter((u) => norm(u.line) !== i.key).map((u) => u.line))];
        return `${box(i.key)} ${i.name}${q.length ? ` – ${q.join(" + ")}` : ""}`;
      };
      out += buy.map(line).join("\n");
      if (pantry.length) out += `\n\nלבדוק שיש בבית:\n` + pantry.map(line).join("\n");
    }
    return out;
  }

  function shareUrl() {
    return location.origin + location.pathname + "#menu=" + menu.join(",");
  }
  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); $("m-status").textContent = msg; }
    catch { window.prompt("העתיקו:", text); }
  }

  $("menu-btn").onclick = () => { renderMenu(); mdlg.showModal(); mdlg.scrollTop = 0; };
  $("m-close").onclick = () => mdlg.close();
  mdlg.addEventListener("click", (e) => {
    if (e.target === mdlg) return mdlg.close();
    const rm = e.target.closest(".m-remove");
    if (rm) return toggleMenu(rm.dataset.add);
    const op = e.target.closest(".m-open");
    if (op) { mdlg.close(); openRecipe(op.dataset.id); return; }
    const v = e.target.closest(".seg button");
    if (v) { view = v.dataset.view; store.set(VIEW_KEY, view); renderMenu(); }
  });
  $("m-list").addEventListener("change", (e) => {
    const k = e.target.dataset.key;
    if (!k) return;
    e.target.checked ? checked.add(k) : checked.delete(k);
    e.target.closest("label").classList.toggle("done", e.target.checked);
    store.set(CHECK_KEY, [...checked]);
    $("m-wa").href = "https://wa.me/?text=" + encodeURIComponent(listText());
  });
  $("m-copy").onclick = () => copy(listText(), "הרשימה הועתקה ✓");
  $("m-share").onclick = () => {
    const url = shareUrl();
    if (navigator.share) navigator.share({ title: "התפריט שלי", url }).catch(() => {});
    else copy(url, "הקישור הועתק ✓ – מי שיפתח אותו יקבל את המנות לתפריט שלו");
  };
  $("m-uncheck").onclick = () => { checked.clear(); store.set(CHECK_KEY, []); renderMenu(); };
  $("m-clear").onclick = () => {
    if (!confirm("לרוקן את התפריט?")) return;
    menu = []; checked.clear(); store.set(CHECK_KEY, []); saveMenu(); render(); renderMenu();
  };

  // A shared link "#menu=id1,id2" adds those dishes to this browser's menu and opens it.
  function importMenuFromHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (!p.has("menu")) return false;
    const ids = p.get("menu").split(",").filter((id) => recipes.some((r) => r.id === id));
    menu = [...new Set([...menu, ...ids])];
    saveMenu();
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }
  $("close").onclick = () => dlg.close();
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => { delete dlg.dataset.id; writeHash(null); });

  let t;
  q.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = q.value.trim(); render(); }, 120);
  });

  window.addEventListener("hashchange", () => {
    if (importMenuFromHash()) { render(); renderMenu(); if (!mdlg.open) mdlg.showModal(); return; }
    const rid = readHash();
    q.value = state.q;
    render();
    if (rid) openRecipe(rid); else if (dlg.open) dlg.close();
  });

  fetch("data/recipes.json", { cache: "no-cache" })
    .then((res) => { if (!res.ok) throw new Error(res.status); return res.json(); })
    .then((data) => {
      recipes = data.recipes.map((r) => {
        const flat = (gs) => gs.flatMap((g) => [g.heading, ...g.items]).join(" ");
        return {
          ...r,
          _title: norm(r.title),
          _all: norm([r.title, r.category, r.kashrut, flat(r.ingredients), flat(r.steps), r.substitutions.join(" ")].join(" ")),
        };
      });
      const shared = importMenuFromHash();
      menu = menu.filter((id) => recipes.some((r) => r.id === id)); // drop recipes removed from Drive
      saveMenu();
      const rid = readHash();
      q.value = state.q;
      render();
      if (rid) openRecipe(rid);
      if (shared) $("menu-btn").click();
      if (data.updated) {
        const d = new Date(data.updated);
        $("foot").textContent = `עודכן מ-Google Drive: ${d.toLocaleString("he-IL", { dateStyle: "medium", timeStyle: "short" })}`;
      }
    })
    .catch(() => { count.textContent = "לא הצלחנו לטעון את המתכונים. נסו לרענן את הדף."; });
})();
