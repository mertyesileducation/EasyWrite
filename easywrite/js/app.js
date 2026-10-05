/* EasyWrite — editör çekirdeği */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const editor = $('#editor');
  const page = $('#page');
  const titleInput = $('#docTitle');
  const FILE_FORMAT = 'easywrite';
  const FILE_VERSION = 2;
  const LEGACY_KEY = 'easywrite:autosave';
  const VERSION_INTERVAL = 5 * 60 * 1000;

  const PAGE_SIZES = { A4: [210, 297], Letter: [215.9, 279.4], A5: [148, 210] };
  const MM_TO_PX = 96 / 25.4;

  const DEFAULT_SETTINGS = {
    pageSize: 'A4',
    orientation: 'portrait',
    margin: 25.4,
    columns: 1,
    header: '',
    footer: '',
    pageNumbers: true,
  };

  const settings = { ...DEFAULT_SETTINGS };
  let zoom = 100;
  let current = null;        // açık belge kaydı
  let dirty = false;
  let lastVersionAt = 0;
  let savedRange = null;
  let selectedImg = null;
  let painterStyle = null;
  let boundaries = [];

  /* ---------- Yardımcılar ---------- */

  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, val) { try { localStorage.setItem(key, val); } catch { /* yok say */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* yok say */ } },
  };

  function toast(msg, ms = 2400) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, ms);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function countWords(text) {
    return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length;
  }

  function plainText() {
    return editor.innerText.replace(/​/g, '');
  }

  function isEditorOpen() {
    return !$('#editorView').hidden && !!current;
  }

  function selectionInEditor() {
    const sel = window.getSelection();
    return sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer);
  }

  function saveSelection() {
    if (selectionInEditor()) savedRange = window.getSelection().getRangeAt(0).cloneRange();
  }

  function restoreSelection() {
    editor.focus({ preventScroll: true });
    if (!savedRange || !editor.contains(savedRange.commonAncestorContainer)) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  function exec(cmd, value = null) {
    restoreSelection();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, value);
    saveSelection();
    markDirty();
    updateToolbar();
  }

  function insertHtml(html) {
    restoreSelection();
    document.execCommand('insertHTML', false, html);
    saveSelection();
    markDirty();
  }

  function insertText(text) {
    restoreSelection();
    document.execCommand('insertText', false, text);
    saveSelection();
    markDirty();
  }

  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function safeFileName(title) {
    // Bazı tarayıcılar ASCII dışı indirme adlarını reddettiği için Türkçe harfleri sadeleştir
    const tr = { ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U' };
    const name = (title ?? titleInput.value).trim()
      .replace(/[çÇğĞıİöÖşŞüÜ]/g, c => tr[c])
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\x20-\x7e]+/g, '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .trim();
    return name || 'belge';
  }

  function currentBlock() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentNode;
    while (node && node !== editor) {
      if (/^(P|H[1-6]|BLOCKQUOTE|PRE|LI|DIV|TD|TH)$/.test(node.nodeName)) return node;
      node = node.parentNode;
    }
    return null;
  }

  function closest(tag) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentNode;
    const found = node.closest ? node.closest(tag) : null;
    return found && editor.contains(found) ? found : null;
  }

  function unwrap(el) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  }

  function relTime(ts) {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 45) return 'az önce';
    if (diff < 3600) return `${Math.round(diff / 60)} dk önce`;
    if (diff < 86400) return `${Math.round(diff / 3600)} sa önce`;
    if (diff < 86400 * 7) return `${Math.round(diff / 86400)} gün önce`;
    return new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ---------- Diyalog ---------- */

  function openDialog(title, bodyHtml, opts = {}) {
    const { okText = 'Tamam', cancelText = 'İptal', hideOk = false, hideCancel = false, wide = false, onOpen } = opts;
    const dlg = $('#dialog');
    $('#dialogTitle').textContent = title;
    $('#dialogBody').innerHTML = bodyHtml;
    $('#dialogOk').textContent = okText;
    $('#dialogOk').hidden = hideOk;
    $('#dialogCancel').textContent = hideOk ? 'Kapat' : cancelText;
    $('#dialogCancel').hidden = hideCancel;
    dlg.classList.toggle('wide', wide);
    return new Promise(resolve => {
      dlg.addEventListener('close', () => {
        resolve(dlg.returnValue === 'ok' ? $('#dialogBody') : null);
      }, { once: true });
      dlg.returnValue = '';
      dlg.showModal();
      if (onOpen) onOpen($('#dialogBody'), dlg);
      const first = $('#dialogBody input:not([type=checkbox]), #dialogBody select');
      if (first) { first.focus(); if (first.select) first.select(); }
    });
  }

  async function promptDialog(title, label, value = '') {
    const body = await openDialog(title, `<label>${escapeHtml(label)} <input name="v" value="${escapeHtml(value)}"></label>`);
    return body ? body.querySelector('[name=v]').value : null;
  }

  async function confirmDialog(title, message, okText = 'Evet') {
    const body = await openDialog(title, `<p>${escapeHtml(message)}</p>`, { okText });
    return !!body;
  }

  /* ---------- Yazı tipi boyutu ---------- */

  function applyFontSize(pt) {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    if (sel.isCollapsed) {
      const span = document.createElement('span');
      span.style.fontSize = pt + 'pt';
      span.appendChild(document.createTextNode('​'));
      const range = sel.getRangeAt(0);
      range.insertNode(span);
      range.setStart(span.firstChild, 1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontSize', false, '7');
      $$('font[size="7"]', editor).forEach(font => {
        const span = document.createElement('span');
        span.style.fontSize = pt + 'pt';
        while (font.firstChild) span.appendChild(font.firstChild);
        font.replaceWith(span);
        $$('span', span).forEach(inner => { inner.style.fontSize = ''; });
      });
    }
    saveSelection();
    markDirty();
    updateToolbar();
  }

  function currentFontSizePt() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return 11;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentNode;
    const px = parseFloat(getComputedStyle(node).fontSize) || (11 / 0.75);
    return Math.round(px * 0.75 * 2) / 2;
  }

  const SIZE_STEPS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
  function stepFont(dir) {
    const cur = currentFontSizePt();
    let next = dir > 0 ? SIZE_STEPS.find(s => s > cur) : [...SIZE_STEPS].reverse().find(s => s < cur);
    if (next == null) next = dir > 0 ? cur + 10 : Math.max(1, cur - 1);
    applyFontSize(next);
  }

  /* ---------- Paragraf ---------- */

  function blocksInSelection() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return [];
    const range = sel.getRangeAt(0);
    const blocks = $$('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, div:not(.ew-pagebreak):not(.ew-toc)', editor)
      .filter(b => range.intersectsNode(b) && !b.querySelector('p, h1, h2, h3, li, div'));
    if (!blocks.length) {
      const b = currentBlock();
      if (b) blocks.push(b);
    }
    return blocks;
  }

  function applyLineHeight(value) {
    restoreSelection();
    let blocks = blocksInSelection();
    if (!blocks.length) {
      document.execCommand('formatBlock', false, 'p');
      blocks = blocksInSelection();
    }
    blocks.forEach(b => { b.style.lineHeight = value; });
    markDirty();
  }

  function changeCase(mode) {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) { toast('Önce metin seçin'); return; }
    const range = sel.getRangeAt(0);
    const walker = document.createTreeWalker(range.commonAncestorContainer.nodeType === 3
      ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (range.intersectsNode(walker.currentNode)) nodes.push(walker.currentNode);
    let sentenceStart = true;
    let wordStart = true;
    const startNode = range.startContainer;
    const endNode = range.endContainer;
    const startOff = range.startOffset;
    const endOff = range.endOffset;
    nodes.forEach(node => {
      const s = node === startNode ? startOff : 0;
      const e = node === endNode ? endOff : node.nodeValue.length;
      const part = node.nodeValue.slice(s, e);
      let out = '';
      for (const ch of part) {
        const lower = ch.toLocaleLowerCase('tr-TR');
        const upper = ch.toLocaleUpperCase('tr-TR');
        const isLetter = lower !== upper;
        if (mode === 'upper') out += upper;
        else if (mode === 'lower') out += lower;
        else if (mode === 'title') out += isLetter ? (wordStart ? upper : lower) : ch;
        else out += isLetter ? (sentenceStart ? upper : lower) : ch;
        if (isLetter || /\d/.test(ch)) { wordStart = false; sentenceStart = false; }
        if (/\s/.test(ch)) wordStart = true;
        if (/[.!?]/.test(ch)) sentenceStart = true;
      }
      node.nodeValue = node.nodeValue.slice(0, s) + out + node.nodeValue.slice(e);
    });
    try {
      range.setStart(startNode, startOff);
      range.setEnd(endNode, endOff);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch { /* yok say */ }
    saveSelection();
    markDirty();
  }

  /* ---------- Araç çubuğu durumu ---------- */

  const STATE_CMDS = ['bold', 'italic', 'underline', 'strikeThrough', 'subscript', 'superscript',
    'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'];

  function updateToolbar() {
    if (!selectionInEditor()) return;
    $$('[data-cmd]').forEach(btn => {
      if (!STATE_CMDS.includes(btn.dataset.cmd)) return;
      let on = false;
      try { on = document.queryCommandState(btn.dataset.cmd); } catch { /* yok say */ }
      btn.classList.toggle('on', on);
    });

    let font = '';
    try { font = document.queryCommandValue('fontName'); } catch { /* yok say */ }
    font = (font || '').split(',')[0].replace(/["']/g, '').trim();
    const fontSel = $('#fontName');
    if (font) {
      const match = Array.from(fontSel.options).find(o => o.value.toLowerCase() === font.toLowerCase());
      if (match) fontSel.value = match.value;
      else if (/carlito/i.test(font)) fontSel.value = 'Calibri';
    }

    const size = currentFontSizePt();
    const sizeSel = $('#fontSize');
    if (!Array.from(sizeSel.options).some(o => Number(o.value) === size)) {
      $$('option[data-temp]', sizeSel).forEach(o => o.remove());
      const opt = new Option(String(size), String(size));
      opt.dataset.temp = '1';
      sizeSel.add(opt);
    }
    sizeSel.value = String(size);

    const block = currentBlock();
    const tag = block ? block.nodeName.toLowerCase() : 'p';
    $$('.style-btn').forEach(b => b.classList.toggle('on', b.dataset.block === tag));

    const inTable = !!closest('td, th');
    $$('#tableTools .tb').forEach(b => { b.disabled = !inTable; });
  }

  /* ---------- İstatistik, sayfalama, gezinti ---------- */

  function updateStats() {
    const text = plainText();
    const words = countWords(text);
    const chars = text.replace(/\n/g, '').length;
    $('#statWords').textContent = `${words.toLocaleString('tr-TR')} sözcük`;
    $('#statChars').textContent = `${chars.toLocaleString('tr-TR')} karakter`;
    const goal = current && current.goal;
    $('#goalBar').hidden = !goal;
    if (goal) {
      const pct = Math.min(100, Math.round(words / goal * 100));
      $('#goalFill').style.width = `${pct}%`;
      $('#goalBar').title = `Hedef: ${words}/${goal} sözcük (%${pct})`;
      $('#goalBar').classList.toggle('done', pct >= 100);
    }
  }

  function pageDims() {
    let [w, h] = PAGE_SIZES[settings.pageSize] || PAGE_SIZES.A4;
    if (settings.orientation === 'landscape') [w, h] = [h, w];
    return { w, h };
  }

  function updatePagination() {
    $$('.page-break-line', page).forEach(l => l.remove());
    const { h } = pageDims();
    const contentH = (h - 2 * settings.margin) * MM_TO_PX;
    const marginPx = settings.margin * MM_TO_PX;
    if (contentH <= 0) return;

    // Elle eklenen sayfa sonlarını dikkate alarak sayfa sınırlarını hesapla
    const breaks = $$('.ew-pagebreak', editor).map(b => b.offsetTop - editor.offsetTop);
    const total = editor.scrollHeight;
    boundaries = [];
    let start = 0;
    let bi = 0;
    while (start < total) {
      const natural = start + contentH;
      while (bi < breaks.length && breaks[bi] <= start) bi++;
      if (bi < breaks.length && breaks[bi] < natural) {
        start = breaks[bi] + 1;
        bi++;
      } else {
        start = natural;
      }
      if (start < total) boundaries.push(start);
      if (boundaries.length > 500) break;
    }

    const pages = boundaries.length + 1;
    page.style.minHeight = `${Math.max(h * MM_TO_PX, total + 2 * marginPx)}px`;
    boundaries.forEach((y, i) => {
      const line = document.createElement('div');
      line.className = 'page-break-line';
      line.style.top = `${marginPx + y}px`;
      line.innerHTML = `<span>Sayfa ${i + 2}</span>`;
      page.appendChild(line);
    });

    page.dataset.pages = pages;
    updateCurrentPage();
    updateHeaderFooter(pages);
  }

  function pageOf(el) {
    const y = el.offsetTop - editor.offsetTop;
    return 1 + boundaries.filter(b => y >= b).length;
  }

  function updateCurrentPage() {
    const pages = Number(page.dataset.pages) || 1;
    let cur = 1;
    const sel = window.getSelection();
    if (selectionInEditor() && sel.rangeCount) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.height || rect.top) {
        const top = editor.getBoundingClientRect().top;
        const y = (rect.top - top) / (zoom / 100);
        cur = 1 + boundaries.filter(b => y >= b).length;
      }
    }
    $('#statPages').textContent = `Sayfa ${Math.min(cur, pages)} / ${pages}`;
  }

  function updateHeaderFooter(pages = Number(page.dataset.pages) || 1) {
    $('#pageHeader').textContent = settings.header;
    const footer = $('#pageFooter');
    footer.innerHTML = '';
    const left = document.createElement('span');
    left.textContent = settings.footer;
    const right = document.createElement('span');
    right.textContent = settings.pageNumbers ? `Toplam ${pages} sayfa` : '';
    footer.append(left, right);
  }

  function ensureHeadingIds() {
    const seen = new Set();
    $$('h1, h2, h3', editor).forEach(h => {
      if (h.closest('.ew-toc')) return;
      if (!h.id || seen.has(h.id)) h.id = 'h-' + Math.random().toString(36).slice(2, 9);
      seen.add(h.id);
    });
  }

  function headings() {
    return $$('h1, h2, h3', editor).filter(h => !h.closest('.ew-toc') && h.textContent.trim());
  }

  function updateNav() {
    if ($('#navPane').hidden) return;
    const list = $('#navList');
    const hs = headings();
    if (!hs.length) {
      list.innerHTML = '<p class="nav-empty">Başlık yok. Gezinti için metninize <b>Başlık</b> stilleri uygulayın.</p>';
      return;
    }
    ensureHeadingIds();
    list.innerHTML = hs.map(h =>
      `<button class="nav-item lvl${h.nodeName[1]}" data-target="${h.id}">${escapeHtml(h.textContent.trim())}</button>`).join('');
  }

  function tocHtml() {
    ensureHeadingIds();
    const hs = headings();
    const items = hs.map(h =>
      `<p class="toc-l${h.nodeName[1]}"><a href="#${h.id}"><span class="toc-t">${escapeHtml(h.textContent.trim())}</span><span class="toc-pg">${pageOf(h)}</span></a></p>`).join('');
    return '<p class="toc-title">İçindekiler</p>' +
      (items || '<p><i>Henüz başlık yok — Başlık 1–3 stillerini kullanın, tablo otomatik güncellenir.</i></p>');
  }

  function refreshTocs() {
    const tocs = $$('.ew-toc', editor);
    if (!tocs.length) return;
    const html = tocHtml();
    tocs.forEach(t => { if (t.innerHTML !== html) t.innerHTML = html; });
  }

  let structTimer = null;
  function scheduleStructureUpdate() {
    clearTimeout(structTimer);
    structTimer = setTimeout(() => { refreshTocs(); updateNav(); }, 350);
  }

  /* ---------- Sayfa ayarları ---------- */

  function applySettings() {
    const { w, h } = pageDims();
    const root = document.documentElement.style;
    root.setProperty('--page-w', `${w}mm`);
    root.setProperty('--page-h', `${h}mm`);
    root.setProperty('--margin', `${settings.margin}mm`);
    root.setProperty('--zoom', zoom / 100);
    editor.style.columnCount = settings.columns > 1 ? settings.columns : '';
    editor.style.columnGap = settings.columns > 1 ? '12mm' : '';

    $('#pageSize').value = settings.pageSize;
    $('#orientation').value = settings.orientation;
    $('#margins').value = String(settings.margin);
    $('#columns').value = String(settings.columns);
    $('#headerText').value = settings.header;
    $('#footerText').value = settings.footer;
    $('#pageNumbers').checked = settings.pageNumbers;
    $('#zoomLabel').textContent = `${zoom}%`;
    $('#zoomStat').textContent = `${zoom}%`;
    $('#zoomSlider').value = zoom;

    updatePrintStyle();
    drawRuler();
    updatePagination();
  }

  function changeSetting(key, value) {
    settings[key] = value;
    applySettings();
    markDirty();
  }

  function cssString(s) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
  }

  function updatePrintStyle() {
    let style = $('#printStyle');
    if (!style) {
      style = document.createElement('style');
      style.id = 'printStyle';
      document.head.appendChild(style);
    }
    const { w, h } = pageDims();
    const font = 'font: 9pt Calibri, Arial, sans-serif; color: #777;';
    const header = settings.header ? `@top-center { content: ${cssString(settings.header)}; ${font} }` : '';
    const footerL = settings.footer ? `@bottom-left { content: ${cssString(settings.footer)}; ${font} }` : '';
    const pageNo = settings.pageNumbers ? `@bottom-right { content: counter(page) " / " counter(pages); ${font} }` : '';
    style.textContent = `@page { size: ${w}mm ${h}mm; margin: ${settings.margin}mm; ${header} ${footerL} ${pageNo} }`;
  }

  function drawRuler() {
    const inner = $('#rulerInner');
    const { w } = pageDims();
    const z = zoom / 100;
    inner.innerHTML = '';
    const marginPx = settings.margin * MM_TO_PX * z;
    const totalPx = w * MM_TO_PX * z;
    const frag = document.createDocumentFragment();
    const shade = (left, width) => {
      const d = document.createElement('div');
      d.className = 'ruler-margin';
      d.style.left = `${left}px`;
      d.style.width = `${width}px`;
      frag.appendChild(d);
    };
    shade(0, marginPx);
    shade(totalPx - marginPx, marginPx);
    for (let mm = 0; mm <= w; mm += 5) {
      const x = mm * MM_TO_PX * z;
      const tick = document.createElement('div');
      tick.className = mm % 10 === 0 ? 'ruler-tick major' : 'ruler-tick';
      tick.style.left = `${x}px`;
      frag.appendChild(tick);
      if (mm % 10 === 0 && mm > 0 && mm < w) {
        const lbl = document.createElement('div');
        lbl.className = 'ruler-num';
        lbl.textContent = String(mm / 10);
        lbl.style.left = `${x - 6}px`;
        frag.appendChild(lbl);
      }
    }
    inner.appendChild(frag);
  }

  function setZoom(z) {
    zoom = Math.max(50, Math.min(200, Math.round(z / 10) * 10));
    storage.set('easywrite:zoom', String(zoom));
    applySettings();
    positionImgTools();
  }

  function fitWidth() {
    const { w } = pageDims();
    const avail = $('#workspace').clientWidth - 32;
    setZoom(Math.floor(avail / (w * MM_TO_PX) * 10) * 10);
  }

  /* ---------- Belge yaşam döngüsü ---------- */

  function sanitize(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    $$('script, iframe, object, embed, link, meta, style, base, form, input, button, textarea, select', tpl.content).forEach(n => n.remove());
    tpl.content.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        const name = attr.name.toLowerCase();
        const val = attr.value.replace(/\s+/g, '').toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc') el.removeAttribute(attr.name);
        else if ((name === 'href' || name === 'src' || name === 'xlink:href') && (val.startsWith('javascript:') || val.startsWith('vbscript:'))) el.removeAttribute(attr.name);
        else if (name === 'class') {
          const keep = attr.value.split(/\s+/).filter(c => /^(ew-|toc-)/.test(c));
          if (keep.length) el.setAttribute('class', keep.join(' ')); else el.removeAttribute('class');
        }
      });
      const special = el.classList.contains('ew-pagebreak') || el.classList.contains('ew-toc');
      if (el.hasAttribute('contenteditable') && !special) el.removeAttribute('contenteditable');
      if (special) el.setAttribute('contenteditable', 'false');
    });
    return tpl.innerHTML;
  }

  function ensureContent() {
    if (!editor.innerHTML.trim()) editor.innerHTML = '<p><br></p>';
  }

  function serializeEditor() {
    const clone = editor.cloneNode(true);
    $$('.find-hit', clone).forEach(unwrap);
    $$('img.selected', clone).forEach(img => img.classList.remove('selected'));
    return clone.innerHTML.replace(/​/g, '');
  }

  function setSaveState(text, cls = '') {
    const el = $('#saveState');
    el.textContent = text;
    el.className = `save-state ${cls}`;
  }

  let saveTimer = null;
  function markDirty() {
    if (!current) return;
    dirty = true;
    setSaveState('Kaydediliyor…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist(), 700);
  }

  async function persist({ version = false, label = '' } = {}) {
    clearTimeout(saveTimer);
    const doc = current;
    if (!doc || (!dirty && !version)) return;
    const text = plainText();
    Object.assign(doc, {
      title: titleInput.value.trim() || 'Adsız belge',
      html: serializeEditor(),
      settings: { ...settings },
      updated: Date.now(),
      words: countWords(text),
      preview: text.replace(/\s+/g, ' ').trim().slice(0, 300),
    });
    dirty = false;
    try {
      await EWStore.put(doc);
      if (version || Date.now() - lastVersionAt > VERSION_INTERVAL) {
        await EWStore.addVersion(doc.id, { title: doc.title, html: doc.html, settings: doc.settings, words: doc.words, label });
        lastVersionAt = Date.now();
      }
      if (doc === current) {
        setSaveState(`Kaydedildi · ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`, 'ok');
      }
    } catch (err) {
      console.error(err);
      dirty = true;
      setSaveState('Kaydedilemedi!', 'err');
      toast('Belge kaydedilemedi: depolama alanı dolu olabilir.');
    }
  }

  function loadIntoEditor(doc) {
    titleInput.value = doc.title || 'Adsız belge';
    Object.keys(settings).forEach(k => delete settings[k]);
    Object.assign(settings, DEFAULT_SETTINGS, doc.settings || {});
    delete settings.zoom;
    editor.innerHTML = sanitize(doc.html || '');
    ensureContent();
    $('#wordGoal').value = doc.goal || '';
    applySettings();
    updateStats();
    updateNav();
    document.title = `${titleInput.value} — EasyWrite`;
    $('#workspace').scrollTop = 0;
  }

  async function createDocument({ title = 'Adsız belge', html = '<p><br></p>', settings: s = {} } = {}) {
    const now = Date.now();
    const doc = {
      id: EWStore.uid(),
      title,
      html: sanitize(html),
      settings: { ...DEFAULT_SETTINGS, ...s },
      created: now,
      updated: now,
      starred: false,
      deleted: null,
      words: 0,
      preview: '',
      goal: 0,
    };
    const tmp = document.createElement('div');
    tmp.innerHTML = doc.html;
    const text = tmp.textContent;
    doc.words = countWords(text);
    doc.preview = text.replace(/\s+/g, ' ').trim().slice(0, 300);
    await EWStore.put(doc);
    return doc;
  }

  async function newFromTemplate(templateId) {
    const t = EWTemplates.find(x => x.id === templateId) || EWTemplates[0];
    const doc = await createDocument({ title: t.title, html: t.html(), settings: t.settings || {} });
    openDoc(doc.id);
  }

  function openDoc(id) {
    const target = `#/doc/${encodeURIComponent(id)}`;
    if (location.hash === target) route();
    else location.hash = target;
  }

  function goHome() {
    if (location.hash && location.hash !== '#/') location.hash = '#/';
    else route();
  }

  async function showEditor(id) {
    if (current && current.id === id && !$('#editorView').hidden) return;
    await persist();
    const doc = await EWStore.get(id);
    if (!doc || doc.deleted) {
      toast('Belge bulunamadı');
      goHome();
      return;
    }
    current = doc;
    dirty = false;
    lastVersionAt = 0;
    stopSpeech();
    $('#homeView').hidden = true;
    $('#editorView').hidden = false;
    loadIntoEditor(doc);
    setSaveState(`Son kayıt: ${relTime(doc.updated)}`);
    // İlk açılışta mevcut halin bir sürümünü sakla
    const versions = await EWStore.versions(doc.id);
    if (!versions.length) {
      await EWStore.addVersion(doc.id, { title: doc.title, html: doc.html, settings: doc.settings, words: doc.words, label: 'İlk sürüm' });
    }
    lastVersionAt = versions.length ? versions[0].at : Date.now();
    placeCaretAtStart();
  }

  function placeCaretAtStart() {
    editor.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(editor, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    saveSelection();
  }

  async function showHome() {
    await persist();
    current = null;
    stopSpeech();
    closeFind();
    selectImage(null);
    $('#editorView').hidden = true;
    $('#homeView').hidden = false;
    document.title = 'EasyWrite';
    if (window.EWHome) EWHome.refresh();
  }

  function route() {
    const m = location.hash.match(/^#\/doc\/(.+)$/);
    if (m) showEditor(decodeURIComponent(m[1]));
    else showHome();
  }

  async function newDoc() {
    const doc = await createDocument();
    openDoc(doc.id);
  }

  async function duplicateDoc(src = current) {
    if (!src) return null;
    if (src === current) await persist();
    const copy = await createDocument({ title: `${src.title} (kopya)`, html: src.html, settings: src.settings });
    copy.goal = src.goal || 0;
    await EWStore.put(copy);
    return copy;
  }

  /* ---------- İçe aktarma ---------- */

  function readFile(file, as) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      if (as === 'buffer') r.readAsArrayBuffer(file); else r.readAsText(file);
    });
  }

  async function parseFile(file) {
    const name = file.name.replace(/\.[^.]+$/, '');
    const ext = (file.name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
    if (ext === 'docx') return EWDocx.importDocx(await readFile(file, 'buffer'), file.name);
    const text = await readFile(file);
    if (ext === 'ewrite' || ext === 'json') {
      const doc = JSON.parse(text);
      if (doc.format !== FILE_FORMAT) throw new Error('format');
      return { title: doc.title, html: doc.html, settings: doc.settings, goal: doc.goal };
    }
    if (ext === 'html' || ext === 'htm') {
      const parsed = new DOMParser().parseFromString(text, 'text/html');
      const content = parsed.querySelector('.ew-document') || parsed.body;
      return { title: parsed.title || name, html: content.innerHTML };
    }
    if (ext === 'md' || ext === 'markdown') return { title: name, html: markdownToHtml(text) };
    if (ext === 'doc' || ext === 'rtf' || ext === 'odt' || ext === 'pdf') throw new Error(`.${ext} biçimi desteklenmiyor; lütfen .docx olarak kaydedip açın`);
    return { title: name, html: textToHtml(text) };
  }

  async function importFiles(files) {
    files = Array.from(files || []);
    if (!files.length) return;
    let last = null;
    let ok = 0;
    for (const file of files) {
      try {
        const parsed = await parseFile(file);
        const doc = await createDocument({ title: parsed.title || file.name, html: parsed.html, settings: parsed.settings || {} });
        if (parsed.goal) { doc.goal = parsed.goal; await EWStore.put(doc); }
        last = doc;
        ok++;
      } catch (err) {
        console.error(err);
        toast(`"${file.name}" açılamadı: ${err.message === 'format' ? 'geçersiz dosya' : err.message}`, 4000);
      }
    }
    if (ok === 1 && last) { openDoc(last.id); toast(`"${last.title}" açıldı`); }
    else if (ok > 1) { toast(`${ok} belge içe aktarıldı`); if (window.EWHome && $('#editorView').hidden) EWHome.refresh(); else goHome(); }
  }

  function textToHtml(text) {
    return text.split(/\r?\n/).map(l => `<p>${escapeHtml(l) || '<br>'}</p>`).join('');
  }

  function markdownToHtml(md) {
    const inline = s => escapeHtml(s)
      .replace(/!\[([^\]]*)\]\((\S+?)\)/g, '<img src="$2" alt="$1">')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/__(.+?)__/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/~~(.+?)~~/g, '<s>$1</s>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\(((?:https?:|mailto:)[^)\s]+)\)/g, '<a href="$2">$1</a>');
    const out = [];
    let list = null;
    let code = null;
    let table = null;
    const lines = md.split(/\r?\n/);
    const flushTable = () => {
      if (!table) return;
      out.push('<table><tbody>' + table.map((r, i) => '<tr>' + r.map(c => i === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      table = null;
    };
    for (const line of lines) {
      if (code !== null) {
        if (/^```/.test(line)) { out.push(`<pre>${escapeHtml(code.join('\n'))}</pre>`); code = null; } else code.push(line);
        continue;
      }
      if (/^```/.test(line)) { code = []; continue; }
      if (/^\s*\|.*\|\s*$/.test(line)) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
        table = table || [];
        table.push(line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
        continue;
      }
      flushTable();
      const h = line.match(/^(#{1,6})\s+(.*)/);
      const ul = line.match(/^\s*[-*+]\s+(.*)/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
      const want = ul ? 'ul' : ol ? 'ol' : null;
      if (list && list !== want) { out.push(`</${list}>`); list = null; }
      if (want && !list) { out.push(`<${want}>`); list = want; }
      if (h) { const n = Math.min(3, h[1].length); out.push(`<h${n}>${inline(h[2])}</h${n}>`); }
      else if (want) out.push(`<li>${inline((ul || ol)[1])}</li>`);
      else if (/^>\s?/.test(line)) out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
      else if (/^(-{3,}|\*{3,})\s*$/.test(line)) out.push('<hr>');
      else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
    if (code !== null) out.push(`<pre>${escapeHtml(code.join('\n'))}</pre>`);
    flushTable();
    if (list) out.push(`</${list}>`);
    return out.join('') || '<p><br></p>';
  }

  /* ---------- Dışa aktarma ---------- */

  function exportStyles(s = settings) {
    let [w, h] = PAGE_SIZES[s.pageSize] || PAGE_SIZES.A4;
    if (s.orientation === 'landscape') [w, h] = [h, w];
    return `
      @page { size: ${w}mm ${h}mm; margin: ${s.margin}mm; }
      body { font-family: Calibri, Carlito, Arial, sans-serif; font-size: 11pt; line-height: 1.15; color: #111; }
      .ew-document { max-width: ${w - 2 * s.margin}mm; margin: 0 auto; }
      p { margin: 0 0 8pt; }
      h1 { font-size: 20pt; color: #2f5496; font-weight: normal; }
      h2 { font-size: 16pt; color: #2f5496; font-weight: normal; }
      h3 { font-size: 13pt; color: #1f3763; }
      blockquote { margin: 8pt 24pt; padding-left: 12pt; border-left: 3px solid #ccc; color: #555; font-style: italic; }
      pre { background: #f4f4f4; padding: 8pt; font-family: Consolas, monospace; font-size: 10pt; white-space: pre-wrap; }
      table { border-collapse: collapse; width: 100%; }
      td, th { border: 1px solid #999; padding: 4pt 6pt; vertical-align: top; }
      img { max-width: 100%; height: auto; }
      .ew-toc a { display: flex; color: inherit; text-decoration: none; }
      .ew-toc .toc-t { flex: 1; } .ew-toc .toc-l2 { padding-left: 16pt; } .ew-toc .toc-l3 { padding-left: 32pt; }
      .ew-toc .toc-title { font-size: 16pt; color: #2f5496; }
      .ew-pagebreak { page-break-after: always; break-after: page; border: 0; height: 0; }`;
  }

  function cleanHtml(html) {
    return html.replace(/ contenteditable="false"/g, '');
  }

  async function withRendered(doc, fn) {
    // Kaydedilmiş bir belgeyi dışa aktarmak için görünmez bir kapta işler
    if (current && doc.id === current.id && !$('#editorView').hidden) return fn(editor, settings);
    const holder = document.createElement('div');
    holder.className = 'offscreen-render page';
    const s = { ...DEFAULT_SETTINGS, ...(doc.settings || {}) };
    let [w] = PAGE_SIZES[s.pageSize] || PAGE_SIZES.A4;
    if (s.orientation === 'landscape') w = (PAGE_SIZES[s.pageSize] || PAGE_SIZES.A4)[1];
    holder.style.width = `${w}mm`;
    holder.style.padding = `${s.margin}mm`;
    const ed = document.createElement('div');
    ed.className = 'editor';
    ed.innerHTML = sanitize(doc.html || '');
    holder.appendChild(ed);
    document.body.appendChild(holder);
    await Promise.all($$('img', ed).map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
    try { return fn(ed, s); } finally { holder.remove(); }
  }

  async function exportDocxFor(doc) {
    if (doc === current) { clearHits(); await persist(); }
    const blob = await withRendered(doc, (root, s) => EWDocx.exportDocx({ root, title: doc.title, settings: s }));
    download(`${safeFileName(doc.title)}.docx`, blob);
    toast('Word (.docx) olarak kaydedildi');
  }

  function ewritePayload(doc) {
    return JSON.stringify({
      format: FILE_FORMAT, version: FILE_VERSION, title: doc.title, settings: doc.settings,
      goal: doc.goal || 0, html: doc.html, savedAt: new Date(doc.updated).toISOString(),
    }, null, 2);
  }

  async function exportEwriteFor(doc) {
    if (doc === current) await persist();
    download(`${safeFileName(doc.title)}.ewrite`, ewritePayload(doc), 'application/json');
    toast('.ewrite dosyası indirildi');
  }

  function exportHtml() {
    const title = escapeHtml(titleInput.value);
    const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>${title}</title>
<meta name="generator" content="EasyWrite">
<style>${exportStyles()}</style></head>
<body><div class="ew-document">${cleanHtml(serializeEditor())}</div></body></html>`;
    download(`${safeFileName()}.html`, html, 'text/html');
    toast('HTML olarak dışa aktarıldı');
  }

  function htmlToMarkdown(root) {
    const inline = node => {
      let s = '';
      node.childNodes.forEach(n => {
        if (n.nodeType === 3) { s += n.nodeValue.replace(/\s+/g, ' '); return; }
        if (n.nodeType !== 1) return;
        const t = n.nodeName;
        const inner = inline(n);
        const cs = n.style || {};
        if (t === 'BR') s += '  \n';
        else if (t === 'B' || t === 'STRONG' || cs.fontWeight === 'bold') s += inner.trim() ? `**${inner}**` : inner;
        else if (t === 'I' || t === 'EM' || cs.fontStyle === 'italic') s += inner.trim() ? `*${inner}*` : inner;
        else if (t === 'S' || t === 'STRIKE' || t === 'DEL') s += `~~${inner}~~`;
        else if (t === 'CODE') s += `\`${inner}\``;
        else if (t === 'A') s += n.getAttribute('href') && !n.getAttribute('href').startsWith('#') ? `[${inner}](${n.getAttribute('href')})` : inner;
        else if (t === 'IMG') s += /^https?:/.test(n.getAttribute('src') || '') ? `![${n.alt || ''}](${n.getAttribute('src')})` : `![${n.alt || 'resim'}]()`;
        else s += inner;
      });
      return s;
    };
    const lines = [];
    const block = (el, depth = 0) => {
      el.childNodes.forEach(n => {
        if (n.nodeType === 3) { if (n.nodeValue.trim()) lines.push(n.nodeValue.trim(), ''); return; }
        if (n.nodeType !== 1) return;
        const t = n.nodeName;
        if (/^H[1-6]$/.test(t)) lines.push(`${'#'.repeat(+t[1])} ${inline(n).trim()}`, '');
        else if (t === 'UL' || t === 'OL') {
          let i = 1;
          n.childNodes.forEach(li => {
            if (li.nodeName !== 'LI') return;
            const own = document.createElement('div');
            li.childNodes.forEach(c => { if (c.nodeName !== 'UL' && c.nodeName !== 'OL') own.appendChild(c.cloneNode(true)); });
            lines.push(`${'  '.repeat(depth)}${t === 'OL' ? `${i++}.` : '-'} ${inline(own).trim()}`);
            li.childNodes.forEach(c => { if (c.nodeName === 'UL' || c.nodeName === 'OL') { const w = document.createElement('div'); w.appendChild(c.cloneNode(true)); block(w, depth + 1); lines.pop(); } });
          });
          lines.push('');
        } else if (t === 'BLOCKQUOTE') lines.push(`> ${inline(n).trim()}`, '');
        else if (t === 'PRE') lines.push('```', n.textContent, '```', '');
        else if (t === 'HR') lines.push('---', '');
        else if (t === 'TABLE') {
          const rows = Array.from(n.querySelectorAll('tr')).map(r => Array.from(r.cells).map(c => inline(c).trim().replace(/\|/g, '\\|')));
          if (rows.length) {
            lines.push(`| ${rows[0].join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`);
            rows.slice(1).forEach(r => lines.push(`| ${r.join(' | ')} |`));
            lines.push('');
          }
        } else if (n.classList.contains('ew-pagebreak')) lines.push('---', '');
        else if (n.classList.contains('ew-toc')) { /* İçindekiler Markdown'a aktarılmaz */ }
        else if (t === 'DIV' && n.querySelector('p, h1, h2, h3, ul, ol, table')) block(n, depth);
        else { const s = inline(n).trim(); lines.push(s, ''); }
      });
    };
    block(root);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function exportMd() {
    const tmp = document.createElement('div');
    tmp.innerHTML = serializeEditor();
    download(`${safeFileName()}.md`, htmlToMarkdown(tmp), 'text/markdown;charset=utf-8');
    toast('Markdown olarak dışa aktarıldı');
  }

  function exportTxt() {
    download(`${safeFileName()}.txt`, plainText(), 'text/plain;charset=utf-8');
    toast('Düz metin olarak dışa aktarıldı');
  }

  async function share() {
    if (!current) return;
    clearHits();
    await persist();
    const blob = EWDocx.exportDocx({ root: editor, title: current.title, settings });
    const file = new File([blob], `${safeFileName()}.docx`, { type: blob.type });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: current.title });
      } else if (navigator.share) {
        await navigator.share({ title: current.title, text: plainText().slice(0, 10000) });
      } else {
        download(file.name, blob);
        toast('Paylaşım desteklenmiyor; belge .docx olarak indirildi');
      }
    } catch (err) {
      if (err.name !== 'AbortError') toast('Paylaşılamadı');
    }
  }

  /* ---------- Sürüm geçmişi ---------- */

  async function showHistory() {
    if (!current) return;
    await persist();
    const versions = await EWStore.versions(current.id);
    if (!versions.length) { toast('Henüz kayıtlı sürüm yok'); return; }
    const items = versions.map((v, i) => `
      <button type="button" class="ver-item${i === 0 ? ' active' : ''}" data-i="${i}">
        <b>${new Date(v.at).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}</b>
        <span>${escapeHtml(v.label || relTime(v.at))} · ${v.words || 0} sözcük</span>
      </button>`).join('');
    let chosen = 0;
    const body = await openDialog('Sürüm geçmişi', `
      <div class="history">
        <div class="ver-list">${items}</div>
        <div class="ver-preview"><div class="editor" id="verPreview"></div></div>
      </div>`, {
      okText: 'Bu sürümü geri yükle',
      wide: true,
      onOpen: bodyEl => {
        const show = i => {
          chosen = i;
          $$('.ver-item', bodyEl).forEach(b => b.classList.toggle('active', +b.dataset.i === i));
          $('#verPreview', bodyEl).innerHTML = sanitize(versions[i].html);
        };
        bodyEl.addEventListener('click', e => {
          const b = e.target.closest('.ver-item');
          if (b) show(+b.dataset.i);
        });
        show(0);
      },
    });
    if (!body) return;
    const v = versions[chosen];
    await EWStore.addVersion(current.id, { title: current.title, html: current.html, settings: current.settings, words: current.words, label: 'Geri yüklemeden önce' });
    current.html = v.html;
    current.title = v.title || current.title;
    current.settings = { ...DEFAULT_SETTINGS, ...(v.settings || {}) };
    loadIntoEditor(current);
    dirty = true;
    await persist({ version: true, label: 'Geri yüklendi' });
    toast('Sürüm geri yüklendi');
  }

  /* ---------- Ekleme ---------- */

  async function insertTable() {
    saveSelection();
    const body = await openDialog('Tablo ekle', `
      <div class="grid-picker" id="gridPicker"></div>
      <div class="grid-label" id="gridLabel">3 × 3</div>
      <label>Satır <input type="number" name="rows" min="1" max="100" value="3"></label>
      <label>Sütun <input type="number" name="cols" min="1" max="20" value="3"></label>
      <label class="check-line"><input type="checkbox" name="header" checked> Başlık satırı</label>`,
    { okText: 'Ekle', onOpen: setupGridPicker });
    if (!body) return;
    const rows = Math.max(1, Math.min(100, parseInt(body.querySelector('[name=rows]').value, 10) || 3));
    const cols = Math.max(1, Math.min(20, parseInt(body.querySelector('[name=cols]').value, 10) || 3));
    const header = body.querySelector('[name=header]').checked;
    let html = '<table><tbody>';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        const tag = header && r === 0 ? 'th' : 'td';
        html += `<${tag}><br></${tag}>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    insertHtml(html);
  }

  function setupGridPicker(body, dlg) {
    const grid = body.querySelector('#gridPicker');
    const rowsIn = body.querySelector('[name=rows]');
    const colsIn = body.querySelector('[name=cols]');
    for (let r = 1; r <= 8; r++) {
      for (let c = 1; c <= 10; c++) {
        const cell = document.createElement('span');
        cell.dataset.r = r; cell.dataset.c = c;
        grid.appendChild(cell);
      }
    }
    const paint = (r, c) => {
      grid.querySelectorAll('span').forEach(s => s.classList.toggle('hot', +s.dataset.r <= r && +s.dataset.c <= c));
      body.querySelector('#gridLabel').textContent = `${r} × ${c}`;
    };
    grid.addEventListener('mouseover', e => {
      if (!e.target.dataset.r) return;
      rowsIn.value = e.target.dataset.r;
      colsIn.value = e.target.dataset.c;
      paint(+e.target.dataset.r, +e.target.dataset.c);
    });
    grid.addEventListener('click', e => { if (e.target.dataset.r) dlg.close('ok'); });
    paint(3, 3);
  }

  function tableOp(op) {
    restoreSelection();
    const cell = closest('td, th');
    if (!cell) return;
    const row = cell.parentElement;
    const table = cell.closest('table');
    const idx = Array.from(row.children).indexOf(cell);
    const newCell = tag => { const c = document.createElement(tag); c.innerHTML = '<br>'; return c; };

    switch (op) {
      case 'rowAbove':
      case 'rowBelow': {
        const tr = document.createElement('tr');
        Array.from(row.children).forEach(() => tr.appendChild(newCell('td')));
        row.parentElement.insertBefore(tr, op === 'rowAbove' ? row : row.nextSibling);
        break;
      }
      case 'colLeft':
      case 'colRight':
        $$('tr', table).forEach(tr => {
          const ref = tr.children[idx];
          const tag = ref && ref.nodeName === 'TH' ? 'th' : 'td';
          const c = newCell(tag);
          if (!ref) tr.appendChild(c);
          else tr.insertBefore(c, op === 'colLeft' ? ref : ref.nextSibling);
        });
        break;
      case 'delRow':
        if ($$('tr', table).length <= 1) table.remove(); else row.remove();
        break;
      case 'delCol':
        if (row.children.length <= 1) table.remove();
        else $$('tr', table).forEach(tr => tr.children[idx] && tr.children[idx].remove());
        break;
      case 'delTable':
        table.remove();
        break;
    }
    ensureContent();
    markDirty();
    updatePagination();
  }

  function insertImage() {
    saveSelection();
    $('#imageInput').click();
  }

  function shrinkImage(dataUrl, maxSide = 1600) {
    // Çok büyük fotoğrafları depolamayı şişirmemesi için küçült
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        if (scale >= 1 && dataUrl.length < 1.5e6) { resolve(dataUrl); return; }
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(/^data:image\/png/.test(dataUrl) && dataUrl.length < 3e6 ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function insertImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const url = file.type === 'image/svg+xml' ? reader.result : await shrinkImage(reader.result);
      insertHtml(`<img src="${url}" alt="${escapeHtml(file.name)}" style="width:50%">`);
      setTimeout(updatePagination, 80);
    };
    reader.readAsDataURL(file);
  }

  async function insertLink() {
    saveSelection();
    const existing = closest('a');
    const sel = window.getSelection();
    const selectedText = sel.rangeCount ? sel.toString() : '';
    const body = await openDialog(existing ? 'Bağlantıyı düzenle' : 'Bağlantı ekle', `
      <label>Görüntülenecek metin <input name="text" value="${escapeHtml(existing ? existing.textContent : selectedText)}"></label>
      <label>Adres (URL) <input name="url" placeholder="https://" value="${escapeHtml(existing ? existing.getAttribute('href') || '' : '')}"></label>
      ${existing ? '<label class="check-line"><input type="checkbox" name="remove"> Bağlantıyı kaldır</label>' : ''}`);
    if (!body) return;
    let url = body.querySelector('[name=url]').value.trim();
    const text = body.querySelector('[name=text]').value || url;
    const remove = body.querySelector('[name=remove]');
    const fix = u => /^(https?:|mailto:|#|\/)/i.test(u) ? u : 'https://' + u;
    if (existing) {
      if (remove && remove.checked) unwrap(existing);
      else if (url) { existing.setAttribute('href', fix(url)); existing.textContent = text; }
      markDirty();
      return;
    }
    if (!url) return;
    insertHtml(`<a href="${escapeHtml(fix(url))}" target="_blank" rel="noopener">${escapeHtml(text)}</a>&nbsp;`);
  }

  function insertPageBreak() {
    insertHtml('<div class="ew-pagebreak" contenteditable="false"></div><p><br></p>');
    updatePagination();
  }

  function insertDate() {
    insertText(new Date().toLocaleString('tr-TR', { dateStyle: 'long', timeStyle: 'short' }));
  }

  function insertToc() {
    if ($('.ew-toc', editor)) { refreshTocs(); toast('İçindekiler tablosu güncellendi'); return; }
    insertHtml(`<div class="ew-toc" contenteditable="false">${tocHtml()}</div><p><br></p>`);
    setTimeout(refreshTocs, 100);
  }

  const SPECIAL_CHARS = '©®™§¶†‡•…–—«»‹›“”‘’°±×÷≠≈≤≥∞√∑∏∫∂πΩαβγδλμσφ€£¥₺¢½¼¾¹²³←↑→↓↔⇒⇔✓✗★☆♥♦♣♠☺☎✉✂😀😊👍🙏🎉🔥💡📌✅❌⚠️';
  function specialChars() {
    saveSelection();
    const buttons = Array.from(SPECIAL_CHARS.replace(/️/g, '')).map(ch => `<button type="button" data-ch="${ch}">${ch}</button>`).join('');
    openDialog('Simge ekle', `<div class="char-grid">${buttons}</div>`, {
      hideOk: true,
      onOpen: (body, dlg) => body.addEventListener('click', e => {
        const ch = e.target.dataset && e.target.dataset.ch;
        if (!ch) return;
        dlg.close();
        insertText(ch);
      }),
    });
  }

  function showShortcuts() {
    const list = [
      ['Ctrl+B / I / U', 'Kalın / İtalik / Altı çizili'],
      ['Ctrl+Z / Ctrl+Y', 'Geri al / Yinele'],
      ['Ctrl+S', 'Kaydet (sürüm oluşturur)'],
      ['Ctrl+O', 'Aç / içe aktar'],
      ['Ctrl+Alt+N', 'Yeni belge'],
      ['Ctrl+P', 'Yazdır / PDF'],
      ['Ctrl+F / Ctrl+H', 'Bul / Değiştir'],
      ['Ctrl+K', 'Bağlantı ekle'],
      ['Ctrl+Enter', 'Sayfa sonu'],
      ['Ctrl+L / E / R / J', 'Hizalama'],
      ['Ctrl+Alt+1/2/3', 'Başlık 1/2/3'],
      ['Ctrl+Alt+0', 'Normal metin'],
      ['Ctrl+] / Ctrl+[', 'Yazıyı büyüt / küçült'],
      ['Ctrl+Shift+V', 'Biçimsiz yapıştır'],
      ['Ctrl + / Ctrl -', 'Yakınlaştır / uzaklaştır'],
      ['Esc', 'Ana ekrandan çıkmadan panelleri kapat'],
    ];
    openDialog('Klavye kısayolları',
      `<div class="shortcut-list">${list.map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('')}</div>`,
      { hideOk: true });
  }

  /* ---------- Biçim boyacısı ---------- */

  function formatPainter() {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentNode;
    const cs = getComputedStyle(node);
    painterStyle = {
      bold: Number(cs.fontWeight) >= 600,
      italic: cs.fontStyle === 'italic',
      underline: cs.textDecorationLine.includes('underline'),
      strike: cs.textDecorationLine.includes('line-through'),
      color: cs.color,
      font: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
      size: Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2,
    };
    $('[data-action="formatPainter"]').classList.add('on');
    editor.style.cursor = 'copy';
    toast('Biçim kopyalandı — uygulamak için metin seçin');
  }

  function cancelPainter() {
    painterStyle = null;
    $('[data-action="formatPainter"]').classList.remove('on');
    editor.style.cursor = '';
  }

  function applyPainter() {
    if (!painterStyle) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const p = painterStyle;
    cancelPainter();
    saveSelection();
    exec('removeFormat');
    if (p.bold) exec('bold');
    if (p.italic) exec('italic');
    if (p.underline) exec('underline');
    if (p.strike) exec('strikeThrough');
    exec('foreColor', p.color);
    exec('fontName', p.font);
    applyFontSize(p.size);
  }

  /* ---------- Bul / değiştir ---------- */

  let hits = [];
  let hitIndex = -1;

  function clearHits() {
    $$('.find-hit', editor).forEach(unwrap);
    hits = [];
    hitIndex = -1;
  }

  function runFind() {
    clearHits();
    const term = $('#findInput').value;
    if (!term) { $('#findCount').textContent = ''; return; }
    const caseSensitive = $('#findCase').checked;
    const norm = s => caseSensitive ? s : s.toLocaleLowerCase('tr-TR');
    const needle = norm(term);
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      if (node.parentElement.closest('.ew-toc')) return;
      const hay = norm(node.nodeValue);
      // Küçük harfe dönüşüm uzunluğu değiştirmiyorsa konumlar birebir eşleşir
      if (hay.length !== node.nodeValue.length) return;
      const positions = [];
      let i = hay.indexOf(needle);
      while (i !== -1) { positions.push(i); i = hay.indexOf(needle, i + needle.length); }
      for (let k = positions.length - 1; k >= 0; k--) {
        const range = document.createRange();
        range.setStart(node, positions[k]);
        range.setEnd(node, positions[k] + term.length);
        const mark = document.createElement('span');
        mark.className = 'find-hit';
        range.surroundContents(mark);
      }
    });
    hits = $$('.find-hit', editor);
    if (hits.length) gotoHit(0);
    else $('#findCount').textContent = 'Yok';
  }

  function gotoHit(i) {
    if (!hits.length) return;
    hitIndex = (i + hits.length) % hits.length;
    hits.forEach((h, k) => h.classList.toggle('current', k === hitIndex));
    hits[hitIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
    $('#findCount').textContent = `${hitIndex + 1} / ${hits.length}`;
  }

  function replaceOne() {
    if (!hits.length) { runFind(); return; }
    hits[hitIndex].replaceWith(document.createTextNode($('#replaceInput').value));
    editor.normalize();
    const keep = hitIndex;
    runFind();
    if (hits.length) gotoHit(keep);
    markDirty();
  }

  function replaceAll() {
    runFind();
    const count = hits.length;
    const repl = $('#replaceInput').value;
    hits.forEach(h => h.replaceWith(document.createTextNode(repl)));
    editor.normalize();
    hits = [];
    $('#findCount').textContent = '';
    if (count) markDirty();
    toast(`${count} eşleşme değiştirildi`);
    updateStats();
  }

  function openFind(withReplace) {
    $('#findBar').hidden = false;
    $('#replaceRow').hidden = !withReplace;
    const sel = window.getSelection();
    if (selectionInEditor() && !sel.isCollapsed) $('#findInput').value = sel.toString();
    $('#findInput').focus();
    $('#findInput').select();
    if ($('#findInput').value) runFind();
  }

  function closeFind() {
    if ($('#findBar').hidden) return;
    $('#findBar').hidden = true;
    clearHits();
    editor.focus();
  }

  /* ---------- Resim araçları ---------- */

  function selectImage(img) {
    if (selectedImg) selectedImg.classList.remove('selected');
    selectedImg = img;
    const tools = $('#imgTools');
    if (!img) { tools.hidden = true; return; }
    img.classList.add('selected');
    tools.hidden = false;
    positionImgTools();
  }

  function positionImgTools() {
    if (!selectedImg) return;
    const r = selectedImg.getBoundingClientRect();
    const tools = $('#imgTools');
    tools.style.left = `${Math.max(8, Math.min(window.innerWidth - tools.offsetWidth - 8, r.left))}px`;
    tools.style.top = `${Math.max(8, r.top - 44)}px`;
  }

  function imageAction(btn) {
    if (!selectedImg) return;
    const size = btn.dataset.img;
    const align = btn.dataset.imgAlign;
    if (size === 'delete') {
      selectedImg.remove();
      selectImage(null);
    } else if (size) {
      selectedImg.style.width = `${size}%`;
    } else if (align) {
      selectedImg.style.display = 'block';
      selectedImg.style.marginLeft = align === 'left' ? '0' : 'auto';
      selectedImg.style.marginRight = align === 'right' ? '0' : 'auto';
    }
    markDirty();
    setTimeout(() => { positionImgTools(); updatePagination(); }, 30);
  }

  /* ---------- Gözden geçir: sayım, sesli okuma, dikte ---------- */

  function wordCountDialog() {
    const text = plainText();
    const sel = window.getSelection();
    const selText = selectionInEditor() && !sel.isCollapsed ? sel.toString() : '';
    const words = countWords(text);
    const rows = [
      ['Sayfa', Number(page.dataset.pages) || 1],
      ['Sözcük', words],
      ['Karakter (boşluklu)', text.replace(/\n/g, '').length],
      ['Karakter (boşluksuz)', text.replace(/\s/g, '').length],
      ['Paragraf', text.split(/\n+/).filter(l => l.trim()).length],
      ['Cümle', (text.match(/[^.!?…]+[.!?…]+/g) || []).length],
      ['Okuma süresi', `${Math.max(1, Math.round(words / 200))} dk`],
      ['Konuşma süresi', `${Math.max(1, Math.round(words / 130))} dk`],
    ];
    if (selText) rows.unshift(['Seçili sözcük', countWords(selText)]);
    openDialog('Sözcük sayımı',
      `<table class="stats-table">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${typeof v === 'number' ? v.toLocaleString('tr-TR') : v}</td></tr>`).join('')}</table>`,
      { hideOk: true });
  }

  let speaking = false;
  function stopSpeech() {
    if (window.speechSynthesis && speaking) window.speechSynthesis.cancel();
    speaking = false;
    $('#readAloudBtn').classList.remove('on');
    $('#readAloudBtn').textContent = '🔊 Sesli oku';
    if (recognition) recognition.stop();
  }

  function readAloud() {
    const synth = window.speechSynthesis;
    if (!synth) { toast('Bu tarayıcı sesli okumayı desteklemiyor'); return; }
    if (speaking) { stopSpeech(); return; }
    const sel = window.getSelection();
    const text = (selectionInEditor() && !sel.isCollapsed ? sel.toString() : plainText()).trim();
    if (!text) { toast('Okunacak metin yok'); return; }
    const voice = synth.getVoices().find(v => /^tr/i.test(v.lang));
    const chunks = text.match(/[^.!?…\n]+[.!?…]*\s*|\n+/g) || [text];
    synth.cancel();
    speaking = true;
    $('#readAloudBtn').classList.add('on');
    $('#readAloudBtn').textContent = '⏹ Durdur';
    chunks.filter(c => c.trim()).forEach((chunk, i, arr) => {
      const u = new SpeechSynthesisUtterance(chunk.trim());
      u.lang = 'tr-TR';
      if (voice) u.voice = voice;
      if (i === arr.length - 1) u.onend = () => { speaking = false; stopSpeech(); };
      synth.speak(u);
    });
  }

  let recognition = null;
  function dictate() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Bu tarayıcı dikteyi desteklemiyor (Chrome veya Edge deneyin)', 3500); return; }
    if (recognition) { recognition.stop(); return; }
    saveSelection();
    recognition = new SR();
    recognition.lang = 'tr-TR';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) insertText(e.results[i][0].transcript.trim() + ' ');
      }
    };
    recognition.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') toast(`Dikte hatası: ${e.error}`); };
    recognition.onend = () => {
      recognition = null;
      $('#dictateBtn').classList.remove('on');
      $('#dictating').hidden = true;
    };
    try {
      recognition.start();
      $('#dictateBtn').classList.add('on');
      $('#dictating').hidden = false;
      toast('Konuşmaya başlayın — durdurmak için tekrar Dikte\'ye basın');
    } catch { recognition = null; }
  }

  /* ---------- Görünüm ---------- */

  function setNav(show) {
    $('#navPane').hidden = !show;
    $('#showNav').checked = show;
    document.body.classList.toggle('nav-open', show);
    storage.set('easywrite:nav', show ? '1' : '0');
    if (show) updateNav();
  }

  function toggleTheme() {
    const root = document.documentElement;
    const isDark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = isDark ? 'light' : 'dark';
    storage.set('easywrite:theme', root.dataset.theme);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = isDark ? '#2b579a' : '#1f2a3a';
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }

  /* ---------- Eylemler ---------- */

  const actions = {
    goHome,
    newDoc,
    importDoc: () => $('#fileInput').click(),
    saveDoc: async () => { dirty = true; await persist({ version: true, label: 'Elle kaydedildi' }); toast('Kaydedildi'); },
    duplicateDoc: async () => { const c = await duplicateDoc(); if (c) { openDoc(c.id); toast('Kopya oluşturuldu'); } },
    history: showHistory,
    exportDocx: () => current && exportDocxFor(current),
    exportEwrite: () => current && exportEwriteFor(current),
    exportHtml, exportMd, exportTxt, share,
    print: () => { clearHits(); window.print(); },
    undo: () => exec('undo'),
    redo: () => exec('redo'),
    formatPainter,
    growFont: () => stepFont(1),
    shrinkFont: () => stepFont(-1),
    find: () => openFind(false),
    replace: () => openFind(true),
    findNext: () => (hits.length ? gotoHit(hitIndex + 1) : runFind()),
    findPrev: () => (hits.length ? gotoHit(hitIndex - 1) : runFind()),
    replaceOne, replaceAll, closeFind,
    insertTable, insertImage, insertLink, insertDate, specialChars, insertToc,
    pageBreak: insertPageBreak,
    rowAbove: () => tableOp('rowAbove'),
    rowBelow: () => tableOp('rowBelow'),
    colLeft: () => tableOp('colLeft'),
    colRight: () => tableOp('colRight'),
    delRow: () => tableOp('delRow'),
    delCol: () => tableOp('delCol'),
    delTable: () => tableOp('delTable'),
    wordCount: wordCountDialog,
    readAloud, dictate,
    zoomIn: () => setZoom(zoom + 10),
    zoomOut: () => setZoom(zoom - 10),
    zoomReset: () => setZoom(100),
    fitWidth,
    closeNav: () => setNav(false),
    fullscreen: toggleFullscreen,
    toggleTheme,
    shortcuts: showShortcuts,
  };

  /* ---------- Olay bağlama ---------- */

  function bindEvents() {
    // Düğmeler editör seçimini kaybetmesin
    document.addEventListener('mousedown', e => {
      const btn = e.target.closest('.tb, .style-btn, .float-tools button');
      if (btn && !btn.classList.contains('color')) e.preventDefault();
    });

    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-action], [data-cmd], [data-block], [data-img], [data-img-align]');
      if (!btn || btn.closest('dialog') || btn.disabled) return;
      if (btn.dataset.action) { if (actions[btn.dataset.action]) actions[btn.dataset.action](btn); }
      else if (btn.dataset.cmd) exec(btn.dataset.cmd);
      else if (btn.dataset.block) exec('formatBlock', btn.dataset.block);
      else imageAction(btn);
    });

    $$('.rtab').forEach(tab => tab.addEventListener('click', () => {
      $$('.rtab').forEach(t => t.classList.toggle('active', t === tab));
      $$('.rpanel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab.dataset.tab));
      storage.set('easywrite:tab', tab.dataset.tab);
    }));

    $('#fontName').addEventListener('change', e => exec('fontName', e.target.value));
    $('#fontSize').addEventListener('change', e => applyFontSize(parseFloat(e.target.value)));
    $('#lineHeight').addEventListener('change', e => applyLineHeight(e.target.value));
    $('#caseSelect').addEventListener('change', e => {
      if (e.target.value) changeCase(e.target.value);
      e.target.value = '';
    });

    $('#foreColor').addEventListener('input', e => { $('#foreSwatch').style.background = e.target.value; });
    $('#foreColor').addEventListener('change', e => exec('foreColor', e.target.value));
    $('#hiliteColor').addEventListener('input', e => { $('#hiliteSwatch').style.background = e.target.value; });
    $('#hiliteColor').addEventListener('change', e => exec('hiliteColor', e.target.value));
    ['#foreColor', '#hiliteColor'].forEach(id => $(id).addEventListener('click', saveSelection));
    $$('.ribbon select').forEach(s => s.addEventListener('mousedown', saveSelection));

    $('#pageSize').addEventListener('change', e => changeSetting('pageSize', e.target.value));
    $('#orientation').addEventListener('change', e => changeSetting('orientation', e.target.value));
    $('#margins').addEventListener('change', e => changeSetting('margin', parseFloat(e.target.value)));
    $('#columns').addEventListener('change', e => changeSetting('columns', parseInt(e.target.value, 10)));
    $('#headerText').addEventListener('input', e => { settings.header = e.target.value; updateHeaderFooter(); updatePrintStyle(); markDirty(); });
    $('#footerText').addEventListener('input', e => { settings.footer = e.target.value; updateHeaderFooter(); updatePrintStyle(); markDirty(); });
    $('#pageNumbers').addEventListener('change', e => { settings.pageNumbers = e.target.checked; updateHeaderFooter(); updatePrintStyle(); markDirty(); });
    $('#wordGoal').addEventListener('input', e => {
      if (!current) return;
      current.goal = Math.max(0, parseInt(e.target.value, 10) || 0);
      updateStats();
      markDirty();
    });

    $('#zoomSlider').addEventListener('input', e => setZoom(Number(e.target.value)));
    $('#showRuler').addEventListener('change', e => { $('#ruler').hidden = !e.target.checked; storage.set('easywrite:ruler', e.target.checked ? '1' : '0'); });
    $('#showNav').addEventListener('change', e => setNav(e.target.checked));
    $('#spellcheck').addEventListener('change', e => { editor.spellcheck = e.target.checked; });
    $('#focusMode').addEventListener('change', e => {
      document.body.classList.toggle('focus-mode', e.target.checked);
      if (e.target.checked) toast('Odak modundan çıkmak için Esc');
    });

    $('#navList').addEventListener('click', e => {
      const item = e.target.closest('.nav-item');
      if (!item) return;
      const h = document.getElementById(item.dataset.target);
      if (!h) return;
      h.scrollIntoView({ block: 'start', behavior: 'smooth' });
      const range = document.createRange();
      range.selectNodeContents(h);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      saveSelection();
    });

    titleInput.addEventListener('input', () => {
      document.title = `${titleInput.value || 'Adsız belge'} — EasyWrite`;
      markDirty();
    });
    titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); editor.focus(); } });

    $('#fileInput').addEventListener('change', e => {
      importFiles(e.target.files);
      e.target.value = '';
    });
    $('#imageInput').addEventListener('change', e => { insertImageFile(e.target.files[0]); e.target.value = ''; });

    editor.addEventListener('input', () => {
      if (!editor.firstElementChild && editor.textContent === '') ensureContent();
      markDirty();
      updateStats();
      updatePagination();
      scheduleStructureUpdate();
    });
    editor.addEventListener('mouseup', () => { saveSelection(); applyPainter(); });
    editor.addEventListener('keyup', saveSelection);
    editor.addEventListener('click', e => {
      selectImage(e.target.nodeName === 'IMG' ? e.target : null);
      const a = e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) {
        e.preventDefault();
        const target = document.getElementById(href.slice(1));
        if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else if (e.ctrlKey || e.metaKey) {
        window.open(a.href, '_blank', 'noopener');
      }
    });
    editor.addEventListener('paste', e => {
      const items = Array.from(e.clipboardData ? e.clipboardData.items : []);
      const img = items.find(i => i.type.startsWith('image/'));
      const html = e.clipboardData && e.clipboardData.getData('text/html');
      if (img && !html) {
        e.preventDefault();
        saveSelection();
        insertImageFile(img.getAsFile());
        return;
      }
      if (html) {
        e.preventDefault();
        const clean = sanitize(html.replace(/<!--[\s\S]*?-->/g, ''));
        document.execCommand('insertHTML', false, clean);
      }
    });
    editor.addEventListener('dragover', e => e.preventDefault());
    editor.addEventListener('drop', e => {
      const file = e.dataTransfer.files[0];
      if (!file) return;
      e.preventDefault();
      if (file.type.startsWith('image/')) {
        if (document.caretRangeFromPoint) {
          const r = document.caretRangeFromPoint(e.clientX, e.clientY);
          if (r) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
        }
        saveSelection();
        insertImageFile(file);
      } else {
        importFiles(e.dataTransfer.files);
      }
    });

    document.addEventListener('selectionchange', () => {
      if (selectionInEditor()) {
        saveSelection();
        updateToolbar();
        updateCurrentPage();
      }
    });

    $('#workspace').addEventListener('scroll', positionImgTools, { passive: true });
    window.addEventListener('resize', positionImgTools);

    $('#findInput').addEventListener('input', runFind);
    $('#findCase').addEventListener('change', runFind);
    $('#findInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); actions[e.shiftKey ? 'findPrev' : 'findNext'](); }
    });
    $('#replaceInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
    });

    document.addEventListener('keydown', handleShortcut);

    // Sekme gizlenince veya kapanırken hemen kaydet (mobilde önemli)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });
    window.addEventListener('pagehide', () => persist());
    window.addEventListener('hashchange', route);

    new ResizeObserver(() => { if (isEditorOpen()) updatePagination(); }).observe(editor);
  }

  function handleShortcut(e) {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if ($('#dialog').open) return;

    if (!isEditorOpen()) {
      if (mod && key === 'o') { e.preventDefault(); actions.importDoc(); }
      if (mod && e.altKey && key === 'n') { e.preventDefault(); newDoc(); }
      return;
    }

    if (e.key === 'Escape') {
      closeFind();
      if (document.body.classList.contains('focus-mode')) {
        $('#focusMode').checked = false;
        document.body.classList.remove('focus-mode');
      }
      if (painterStyle) cancelPainter();
      selectImage(null);
      return;
    }
    if (!mod) {
      if (selectedImg && (e.key === 'Delete' || e.key === 'Backspace') && document.activeElement === editor) {
        e.preventDefault();
        imageAction({ dataset: { img: 'delete' } });
      }
      return;
    }

    const map = {
      s: () => actions.saveDoc(),
      o: () => actions.importDoc(),
      p: () => actions.print(),
      f: () => openFind(false),
      h: () => openFind(true),
      k: () => insertLink(),
      l: () => exec('justifyLeft'),
      e: () => exec('justifyCenter'),
      r: () => exec('justifyRight'),
      j: () => exec('justifyFull'),
      ']': () => stepFont(1),
      '[': () => stepFont(-1),
      '=': () => setZoom(zoom + 10),
      '+': () => setZoom(zoom + 10),
      '-': () => setZoom(zoom - 10),
    };

    if (e.altKey) {
      const blocks = { 1: 'h1', 2: 'h2', 3: 'h3', 0: 'p' };
      const code = e.code && e.code.startsWith('Digit') ? e.code.slice(5) : key;
      if (code in blocks) { e.preventDefault(); exec('formatBlock', blocks[code]); return; }
      if (key === 'n') { e.preventDefault(); newDoc(); return; }
      return;
    }
    if (key === 'enter' && document.activeElement === editor) {
      e.preventDefault();
      insertPageBreak();
      return;
    }
    if (key === 'v' && e.shiftKey && document.activeElement === editor) {
      e.preventDefault();
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(text => insertText(text)).catch(() => toast('Pano okunamadı'));
      }
      return;
    }
    if (e.shiftKey) return;
    if (map[key]) {
      // Hizalama kısayolları yalnızca editördeyken
      if ('lerj'.includes(key) && document.activeElement !== editor) return;
      e.preventDefault();
      map[key]();
    }
  }

  /* ---------- Başlangıç ---------- */

  async function migrateAndSeed() {
    const legacy = storage.get(LEGACY_KEY);
    if (legacy) {
      try {
        const old = JSON.parse(legacy);
        if (old.format === FILE_FORMAT && old.html) {
          await createDocument({ title: old.title || 'Kurtarılan belge', html: old.html, settings: old.settings || {} });
        }
      } catch { /* bozuk taslak — yok say */ }
      storage.remove(LEGACY_KEY);
      storage.set('easywrite:welcomed', '1');
    }
    if (!storage.get('easywrite:welcomed')) {
      const all = await EWStore.all();
      if (!all.length) {
        const w = EWTemplates.welcome;
        await createDocument({ title: w.title, html: w.html() });
      }
      storage.set('easywrite:welcomed', '1');
    }
  }

  async function init() {
    const theme = storage.get('easywrite:theme');
    if (theme) document.documentElement.dataset.theme = theme;
    zoom = Number(storage.get('easywrite:zoom')) || 100;
    if (storage.get('easywrite:ruler') === '0') { $('#showRuler').checked = false; $('#ruler').hidden = true; }
    if (storage.get('easywrite:nav') === '1') setNav(true);
    const tab = storage.get('easywrite:tab');
    if (tab && $(`.rtab[data-tab="${tab}"]`)) $(`.rtab[data-tab="${tab}"]`).click();

    document.execCommand('defaultParagraphSeparator', false, 'p');
    bindEvents();
    await migrateAndSeed();
    EWStore.persist();

    const params = new URLSearchParams(location.search);
    if (params.has('new')) {
      history.replaceState(null, '', location.pathname);
      const t = params.get('new');
      if (t && t !== '1') newFromTemplate(t); else newDoc();
      return;
    }
    route();
  }

  window.EW = {
    $, $$, storage, toast, escapeHtml, countWords, sanitize, relTime, safeFileName,
    openDialog, promptDialog, confirmDialog,
    createDocument, newFromTemplate, openDoc, goHome, duplicateDoc, importFiles,
    exportDocxFor, exportEwriteFor, actions,
    get current() { return current; },
    markdownToHtml, htmlToMarkdown,
  };

  document.addEventListener('DOMContentLoaded', init);
})();
