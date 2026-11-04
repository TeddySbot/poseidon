const $ = s => document.querySelector(s);
const RAR = { N: "Commune", R: "Rare", SR: "Épique", SSR: "Légendaire", UR: "Mythique", SEC: "Secrète" };

async function load() { return chrome.storage.local.get({ watches: [], intervalSec: 5, alerts: {}, status: {} }); }

async function render() {
  const { watches, intervalSec, alerts, status } = await load();
  $("#interval").value = String(intervalSec);
  const ul = $("#list");
  ul.innerHTML = "";
  if (!watches.length) ul.innerHTML = '<li class="empty">Aucune carte surveillée pour l’instant.</li>';
  for (const w of watches) {
    const live = Object.keys(alerts[w.id]?.listings || {}).length;
    const li = document.createElement("li");
    const crit = [w.exact ? "nom exact" : "contient", w.rarity ? RAR[w.rarity] : null, w.maxPrice ? `≤ ${w.maxPrice} perles` : null].filter(Boolean).join(" · ");
    li.innerHTML = `<span class="dot ${live ? "on" : ""}" title="${live ? live + " en vente" : "pas en vente"}"></span>
      <div class="name"><b></b><small></small></div><button class="x" title="Retirer">×</button>`;
    li.querySelector("b").textContent = w.name + (live ? `  (${live} en vente)` : "");
    li.querySelector("small").textContent = crit;
    li.querySelector(".x").onclick = async () => {
      const s = await load();
      await chrome.storage.local.set({ watches: s.watches.filter(x => x.id !== w.id) });
      chrome.notifications.clear("w:" + w.id);
      render();
    };
    ul.appendChild(li);
  }
  const st = $("#status");
  st.className = "";
  if (status.error === "AUTH") {
    st.className = "err";
    st.innerHTML = 'Non connecté. <a href="https://poseidon-scans.net/jeu/marche" target="_blank">Se connecter</a>';
  } else if (status.error) {
    st.className = "err"; st.textContent = status.error;
  } else if (status.lastCheck) {
    st.textContent = "Vérifié à " + new Date(status.lastCheck).toLocaleTimeString("fr-FR");
  } else st.textContent = "Pas encore vérifié";
}

// Ajout
$("#add").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("#name").value.trim();
  if (!name) return;
  const s = await load();
  s.watches.push({
    id: crypto.randomUUID(),
    name,
    exact: $("#exact").checked,
    maxPrice: $("#max").value ? Number($("#max").value) : null,
    rarity: $("#rar").value || null
  });
  await chrome.storage.local.set({ watches: s.watches });
  $("#name").value = ""; $("#max").value = "";
  render();
  chrome.runtime.sendMessage({ type: "checkNow" }).then(render);
});

// Suggestions de noms depuis le marché
let t;
$("#name").addEventListener("input", () => {
  clearTimeout(t);
  const q = $("#name").value.trim();
  if (q.length < 2) return;
  t = setTimeout(async () => {
    try {
      const r = await fetch(`https://poseidon-scans.net/api-game/v1/market/listings?sort=new&q=${encodeURIComponent(q)}`, { credentials: "include" });
      if (!r.ok) return;
      const names = [...new Set(((await r.json()).listings || []).map(l => l.card?.name).filter(Boolean))].slice(0, 15);
      $("#sugg").innerHTML = names.map(n => `<option value="${n.replace(/"/g, "&quot;")}">`).join("");
    } catch {}
  }, 350);
});

$("#interval").addEventListener("change", async e => {
  await chrome.storage.local.set({ intervalSec: Number(e.target.value) });
  chrome.runtime.sendMessage({ type: "reschedule" });
});

$("#now").addEventListener("click", async () => {
  $("#status").textContent = "Vérification…";
  await chrome.runtime.sendMessage({ type: "checkNow" });
  render();
});

chrome.storage.onChanged.addListener(render);
render();
