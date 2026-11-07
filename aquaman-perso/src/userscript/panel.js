// Version téléphone (script) : réglages dans le menu « Plus » du site, à la place de la fenêtre de l'extension.
(() => {
  const ICON_GEAR =
    '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.21,107.21,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.71,107.71,0,0,0-26.25-10.87,8,8,0,0,0-7.06,1.49L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.21,107.21,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Z"/></svg>';

  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.append(...kids.filter((k) => k != null));
    return e;
  };

  async function openSettings() {
    document.querySelector('.aqm-settings')?.remove();
    const { settings } = await chrome.storage.local.get('settings');
    const close = () => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => e.key === 'Escape' && (e.stopPropagation(), close());
    const go = (hash) => {
      close();
      location.hash = hash;
    };
    const back = el('div', { class: 'aqm-root aqm-overlay aqm-settings' });
    back.innerHTML = `
      <div class="aqm-panel" role="dialog" aria-modal="true" aria-label="Réglages de Celestial">
        <div class="aqm-head">
          <div><h2 class="aqm-title">Réglages</h2><p class="aqm-sub">Celestial · script ${VERSION}</p></div>
          <button type="button" class="aqm-close" aria-label="Fermer">✕</button>
        </div>
        <div class="aqm-body">
          <label class="aqm-switch"><input type="checkbox" data-k="notifyUpdated" /> <span>Afficher les nouveautés après une mise à jour du script</span></label>
          <p class="aqm-label" style="margin-top:14px">Synchro entre appareils</p>
          <p class="aqm-note">Relie ce téléphone à ton PC et à ton serveur : garantie anti-malchance et séries favorites partagées par un Gist privé de ton compte GitHub. Colle le même jeton GitHub (accès « Gists ») que sur le PC.</p>
          <div style="display:flex;gap:8px;margin-top:8px">
            <input type="password" class="aqm-search aqm-sync-token" placeholder="Jeton GitHub (Gists)" autocomplete="off" style="flex:1" />
            <button type="button" class="aqm-tour-btn is-main aqm-sync-save">Relier</button>
          </div>
          <div class="aqm-note aqm-sync-info" style="margin-top:6px"></div>
          <div class="aqm-news-foot">
            <button type="button" class="aqm-tour-btn" data-go="#aqm-nouveautes">Nouveautés</button>
            <button type="button" class="aqm-tour-btn is-main" data-go="#aqm-visite">Visite guidée</button>
          </div>
          <p class="aqm-note">Le script cherche une nouvelle version toutes les 10 minutes et te la propose en bas de l’écran. Il ne contacte que poseidon-scans.net et GitHub. Les Alertes Marché et la Vente auto n’existent que dans l’extension pour PC.</p>
        </div>
      </div>`;
    const box = back.querySelector('[data-k=notifyUpdated]');
    box.checked = settings?.notifyUpdated !== false;
    box.addEventListener('change', async () => {
      const { settings: now } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...now, notifyUpdated: box.checked } });
    });

    const info = back.querySelector('.aqm-sync-info');
    const input = back.querySelector('.aqm-sync-token');
    const save = back.querySelector('.aqm-sync-save');
    async function renderSync(extra) {
      const r = await handle({ type: 'sync-info' }).catch(() => null);
      info.replaceChildren();
      if (extra) info.append(el('p', { style: 'color:#f87171;margin:0' }, extra));
      input.placeholder = r?.linked ? '•••••••• (vide = délier)' : 'Jeton GitHub (Gists)';
      save.textContent = r?.linked ? 'Changer' : 'Relier';
      info.append(el('p', { style: 'margin:0' }, r?.linked ? (r.state?.error ? `⚠️ ${r.state.error}` : '✅ Reliée') : 'Non reliée.'));
      if (r?.player) info.append(el('p', { style: 'margin:0' }, 'Ton identifiant joueur : ', el('code', {}, r.player)));
      const devs = r?.state?.devices ?? [];
      if (devs.length) info.append(el('p', { style: 'margin:0' }, 'Boosters comptés : ' + devs.map((d) => `${d.name} ${d.count}`).join(' · ')));
    }
    save.addEventListener('click', async () => {
      const token = input.value.trim();
      const { syncToken } = await chrome.storage.local.get('syncToken');
      if (!token && !syncToken) return;
      save.disabled = true;
      info.textContent = token ? 'Connexion à GitHub…' : 'Synchro coupée.';
      const res = await handle({ type: 'sync-setup', token }).catch((e) => ({ error: e.message }));
      input.value = '';
      save.disabled = false;
      renderSync(res?.error);
    });
    renderSync();

    back.querySelector('.aqm-close').addEventListener('click', close);
    back.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    back.addEventListener('click', (e) => e.target === back && close());
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
  }

  // Entrée « Réglages » à la fin du menu « Plus », à chaque ouverture.
  new MutationObserver(() => {
    const menu = document.querySelector('.aqm-menu');
    if (!menu || menu.querySelector('.aqm-menu-settings')) return;
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.className = 'aqm-menu-item aqm-menu-settings';
    item.innerHTML = `<span class="aqm-menu-ico">${ICON_GEAR}</span><span><strong>Réglages</strong><small>Synchro, nouveautés · script ${VERSION}</small></span>`;
    item.addEventListener('click', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      openSettings();
    });
    menu.appendChild(item);
  }).observe(document.body, { childList: true });
})();
