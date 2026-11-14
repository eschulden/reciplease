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

  function card(r) {
    const media = r.image
      ? `<img class="thumb" src="${esc(r.image)}" alt="" loading="lazy" decoding="async">`
      : `<div class="placeholder" aria-hidden="true">${esc([...r.title][0] || "?")}</div>`;
    return `<button class="card" data-id="${esc(r.id)}">
      ${media}
      <div class="card-body">
        <h3>${esc(r.title)}</h3>
        <div class="badges">${badges(r)}</div>
      </div>
    </button>`;
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
      (r.sourceUrl ? `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">🔗 מקור המתכון</a>` : "") +
      `<a href="${esc(r.driveUrl)}" target="_blank" rel="noopener">📄 פתיחה ב-Drive</a>`;
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    writeHash(id);
  }

  grid.addEventListener("click", (e) => {
    const c = e.target.closest(".card");
    if (c) openRecipe(c.dataset.id);
  });
  $("close").onclick = () => dlg.close();
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => { delete dlg.dataset.id; writeHash(null); });

  let t;
  q.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = q.value.trim(); render(); }, 120);
  });

  window.addEventListener("hashchange", () => {
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
      const rid = readHash();
      q.value = state.q;
      render();
      if (rid) openRecipe(rid);
      if (data.updated) {
        const d = new Date(data.updated);
        $("foot").textContent = `עודכן מ-Google Drive: ${d.toLocaleString("he-IL", { dateStyle: "medium", timeStyle: "short" })}`;
      }
    })
    .catch(() => { count.textContent = "לא הצלחנו לטעון את המתכונים. נסו לרענן את הדף."; });
})();
