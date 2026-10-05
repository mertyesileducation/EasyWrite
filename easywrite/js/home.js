/* EasyWrite — ana ekran (belge yöneticisi) */
(() => {
  'use strict';

  const { $, $$, escapeHtml, toast, storage } = EW;
  const TRASH_DAYS = 30;

  const state = {
    view: 'recent',
    sort: storage.get('easywrite:sort') || 'updated',
    layout: storage.get('easywrite:layout') || 'grid',
    query: '',
  };

  let docs = [];

  function templateThumb(html) {
    return `<div class="thumb"><div class="thumb-page"><div class="editor">${EW.sanitize(html)}</div></div></div>`;
  }

  function renderTemplates() {
    $('#templateRow').innerHTML = EWTemplates.map(t => `
      <button class="tpl-card" data-template="${t.id}" title="${escapeHtml(t.name)}">
        ${t.id === 'blank' ? '<div class="thumb blank"><span>＋</span></div>' : templateThumb(t.html())}
        <span class="tpl-name">${escapeHtml(t.name)}</span>
      </button>`).join('');
  }

  function stripHtml(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.textContent || '';
  }

  function visibleDocs() {
    let list = docs.filter(d => (state.view === 'trash' ? !!d.deleted : !d.deleted));
    if (state.view === 'starred') list = list.filter(d => d.starred);
    if (state.query) {
      const q = state.query.toLocaleLowerCase('tr-TR');
      list = list.filter(d => (d.title || '').toLocaleLowerCase('tr-TR').includes(q) ||
        stripHtml(d.html || '').toLocaleLowerCase('tr-TR').includes(q));
    }
    const by = {
      updated: (a, b) => b.updated - a.updated,
      created: (a, b) => b.created - a.created,
      title: (a, b) => (a.title || '').localeCompare(b.title || '', 'tr'),
      words: (a, b) => (b.words || 0) - (a.words || 0),
    }[state.sort];
    return list.sort((a, b) => (state.view !== 'trash' && b.starred - a.starred) || by(a, b));
  }

  function highlight(text) {
    const safe = escapeHtml(text);
    if (!state.query) return safe;
    const q = escapeHtml(state.query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(q, 'gi'), m => `<mark>${m}</mark>`);
  }

  function render() {
    const list = visibleDocs();
    const grid = $('#docGrid');
    grid.className = `doc-grid ${state.layout}`;
    $('#docsTitle').textContent = state.query ? `"${state.query}" için sonuçlar`
      : { recent: 'Son belgeler', starred: 'Yıldızlı belgeler', trash: 'Çöp kutusu' }[state.view];
    $('#newSection').hidden = state.view === 'trash' || !!state.query;
    $('#emptyTrash').hidden = state.view !== 'trash' || !list.length;
    $$('.hnav[data-home]').forEach(b => b.classList.toggle('active', b.dataset.home === state.view));
    $$('[data-layout]').forEach(b => b.classList.toggle('on', b.dataset.layout === state.layout));
    $('#homeSort').value = state.sort;

    const empty = $('#emptyState');
    empty.hidden = list.length > 0;
    if (!list.length) {
      empty.innerHTML = state.query ? '<div class="empty-icon">🔍</div><p>Eşleşen belge bulunamadı.</p>'
        : state.view === 'trash' ? `<div class="empty-icon">🗑</div><p>Çöp kutusu boş. Silinen belgeler ${TRASH_DAYS} gün burada saklanır.</p>`
          : state.view === 'starred' ? '<div class="empty-icon">★</div><p>Yıldızlı belge yok. Bir belgenin yıldızına tıklayarak buraya ekleyin.</p>'
            : '<div class="empty-icon">📄</div><p>Henüz belge yok. Yukarıdan bir şablon seçin ya da bir dosyayı buraya sürükleyin.</p>';
    }

    grid.innerHTML = list.map(d => {
      const trash = state.view === 'trash';
      const meta = trash
        ? `Silindi: ${EW.relTime(d.deleted)}`
        : `${EW.relTime(d.updated)} · ${(d.words || 0).toLocaleString('tr-TR')} sözcük`;
      return `
        <article class="doc-card" data-id="${d.id}" tabindex="0">
          ${templateThumb(d.html || '')}
          <div class="doc-info">
            <div class="doc-title-row">
              <span class="doc-icon">W</span>
              <span class="doc-name">${highlight(d.title || 'Adsız belge')}</span>
            </div>
            <div class="doc-meta">${meta}</div>
            ${state.layout === 'list' ? `<div class="doc-preview">${highlight((d.preview || '').slice(0, 160))}</div>` : ''}
          </div>
          <div class="doc-actions">
            ${trash
              ? '<button class="mini" data-card="restore" title="Geri yükle">↺</button><button class="mini danger" data-card="purge" title="Kalıcı olarak sil">✕</button>'
              : `<button class="mini star${d.starred ? ' on' : ''}" data-card="star" title="${d.starred ? 'Yıldızı kaldır' : 'Yıldızla'}">${d.starred ? '★' : '☆'}</button>
                 <button class="mini" data-card="menu" title="Diğer">⋮</button>`}
          </div>
        </article>`;
    }).join('');
  }

  async function refresh() {
    docs = await EWStore.all();
    // Süresi dolmuş çöp kutusu öğelerini temizle
    const limit = Date.now() - TRASH_DAYS * 86400000;
    for (const d of docs.filter(x => x.deleted && x.deleted < limit)) await EWStore.remove(d.id);
    docs = docs.filter(d => !(d.deleted && d.deleted < limit));
    render();
    updateStorageInfo();
  }

  async function updateStorageInfo() {
    const est = await EWStore.estimate();
    const count = docs.filter(d => !d.deleted).length;
    let html = `<div>${count} belge</div>`;
    if (est && est.quota) {
      const used = est.usage / 1048576;
      const pct = Math.min(100, est.usage / est.quota * 100);
      html += `<div class="meter"><span style="width:${Math.max(1, pct)}%"></span></div>
        <div>${used < 1 ? `${Math.round(est.usage / 1024)} KB` : `${used.toFixed(1)} MB`} kullanılıyor</div>`;
    }
    html += `<div class="muted">${EWStore.available ? 'Belgeler bu cihazda saklanır' : '⚠ Kalıcı depolama yok'}</div>`;
    $('#storageInfo').innerHTML = html;
  }

  const findDoc = id => docs.find(d => d.id === id);

  async function update(doc, changes) {
    Object.assign(doc, changes);
    await EWStore.put(doc);
    render();
  }

  async function rename(doc) {
    const name = await EW.promptDialog('Yeniden adlandır', 'Belge adı', doc.title);
    if (name === null) return;
    await update(doc, { title: name.trim() || 'Adsız belge', updated: Date.now() });
  }

  async function moveToTrash(doc) {
    await update(doc, { deleted: Date.now() });
    toast(`"${doc.title}" çöp kutusuna taşındı`);
    updateStorageInfo();
  }

  function closeMenu() {
    $('#cardMenu').hidden = true;
  }

  function openMenu(doc, anchor) {
    const menu = $('#cardMenu');
    menu.innerHTML = `
      <button data-m="open">📄 Aç</button>
      <button data-m="rename">✎ Yeniden adlandır</button>
      <button data-m="duplicate">⧉ Kopyasını oluştur</button>
      <button data-m="star">${doc.starred ? '☆ Yıldızı kaldır' : '★ Yıldızla'}</button>
      <hr>
      <button data-m="docx">W Word (.docx) olarak indir</button>
      <button data-m="ewrite">⬇ .ewrite olarak indir</button>
      <hr>
      <button data-m="trash" class="danger">🗑 Sil</button>`;
    menu.hidden = false;
    menu.dataset.id = doc.id;
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw))}px`;
    menu.style.top = `${r.bottom + mh + 8 > window.innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4}px`;
  }

  async function menuAction(action, doc) {
    closeMenu();
    switch (action) {
      case 'open': EW.openDoc(doc.id); break;
      case 'rename': await rename(doc); break;
      case 'duplicate': {
        const copy = await EW.duplicateDoc(doc);
        if (copy) { toast('Kopya oluşturuldu'); refresh(); }
        break;
      }
      case 'star': await update(doc, { starred: !doc.starred }); break;
      case 'docx': await EW.exportDocxFor(doc); break;
      case 'ewrite': await EW.exportEwriteFor(doc); break;
      case 'trash': await moveToTrash(doc); break;
    }
  }

  async function emptyTrash() {
    const trash = docs.filter(d => d.deleted);
    if (!trash.length) return;
    if (!await EW.confirmDialog('Çöp kutusunu boşalt', `${trash.length} belge kalıcı olarak silinecek. Bu işlem geri alınamaz.`, 'Kalıcı olarak sil')) return;
    for (const d of trash) await EWStore.remove(d.id);
    toast('Çöp kutusu boşaltıldı');
    refresh();
  }

  function bind() {
    renderTemplates();

    $('#templateRow').addEventListener('click', e => {
      const card = e.target.closest('[data-template]');
      if (card) EW.newFromTemplate(card.dataset.template);
    });

    $('#docGrid').addEventListener('click', async e => {
      const card = e.target.closest('.doc-card');
      if (!card) return;
      const doc = findDoc(card.dataset.id);
      if (!doc) return;
      const btn = e.target.closest('[data-card]');
      if (!btn) {
        if (doc.deleted) toast('Açmak için önce belgeyi geri yükleyin');
        else EW.openDoc(doc.id);
        return;
      }
      e.stopPropagation();
      switch (btn.dataset.card) {
        case 'star': await update(doc, { starred: !doc.starred }); break;
        case 'menu': openMenu(doc, btn); break;
        case 'restore': await update(doc, { deleted: null }); toast('Belge geri yüklendi'); updateStorageInfo(); break;
        case 'purge':
          if (await EW.confirmDialog('Kalıcı olarak sil', `"${doc.title}" kalıcı olarak silinecek.`, 'Sil')) {
            await EWStore.remove(doc.id);
            refresh();
          }
          break;
      }
    });

    $('#docGrid').addEventListener('keydown', e => {
      const card = e.target.closest('.doc-card');
      if (!card) return;
      const doc = findDoc(card.dataset.id);
      if (e.key === 'Enter' && doc && !doc.deleted) EW.openDoc(doc.id);
      if (e.key === 'Delete' && doc && !doc.deleted) moveToTrash(doc);
      if (e.key === 'F2' && doc) rename(doc);
    });

    $('#docGrid').addEventListener('contextmenu', e => {
      const card = e.target.closest('.doc-card');
      const doc = card && findDoc(card.dataset.id);
      if (!doc || doc.deleted) return;
      e.preventDefault();
      openMenu(doc, { getBoundingClientRect: () => ({ right: e.clientX + 200, bottom: e.clientY, top: e.clientY }) });
    });

    $('#cardMenu').addEventListener('click', e => {
      const b = e.target.closest('[data-m]');
      const doc = findDoc($('#cardMenu').dataset.id);
      if (b && doc) menuAction(b.dataset.m, doc);
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#cardMenu') && !e.target.closest('[data-card="menu"]')) closeMenu();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
    $('#homeMain').addEventListener('scroll', closeMenu, { passive: true });

    $$('.hnav[data-home]').forEach(b => b.addEventListener('click', () => {
      state.view = b.dataset.home;
      render();
    }));
    $$('[data-layout]').forEach(b => b.addEventListener('click', () => {
      state.layout = b.dataset.layout;
      storage.set('easywrite:layout', state.layout);
      render();
    }));
    $('#homeSort').addEventListener('change', e => {
      state.sort = e.target.value;
      storage.set('easywrite:sort', state.sort);
      render();
    });
    let searchTimer;
    $('#homeSearch').addEventListener('input', e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.query = e.target.value.trim(); render(); }, 150);
    });

    // Dosya sürükle-bırak ile içe aktarma
    const home = $('#homeView');
    let dragDepth = 0;
    home.addEventListener('dragenter', e => {
      if (!Array.from(e.dataTransfer.types).includes('Files')) return;
      dragDepth++;
      $('#dropHint').hidden = false;
    });
    home.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropHint').hidden = true; } });
    home.addEventListener('dragover', e => e.preventDefault());
    home.addEventListener('drop', e => {
      e.preventDefault();
      dragDepth = 0;
      $('#dropHint').hidden = true;
      EW.importFiles(e.dataTransfer.files);
    });

    EW.actions.emptyTrash = emptyTrash;
  }

  bind();
  window.EWHome = { refresh, render };
})();
