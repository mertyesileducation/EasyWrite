/* EasyWrite — Word (.docx) dışa ve içe aktarma (bağımlılıksız) */
(() => {
  'use strict';

  const enc = new TextEncoder();
  const MM_TO_TWIP = 1440 / 25.4;
  const PX_TO_TWIP = 15;
  const PX_TO_EMU = 9525;
  const MM_TO_PX = 96 / 25.4;

  /* ---------- ZIP ---------- */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zip(files) {
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    let centralSize = 0;

    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);

      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 0x0800, true);
      h.setUint16(8, 0, true);
      h.setUint16(10, time, true);
      h.setUint16(12, date, true);
      h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true);
      h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true);
      h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);

      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, time, true);
      c.setUint16(14, date, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true);
      c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      centralSize += 46 + name.length;
      offset += 30 + name.length + data.length;
    }

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Bu tarayıcı sıkıştırılmış dosyaları açamıyor');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Geçerli bir ZIP/DOCX değil');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const files = new Map();
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      const method = view.getUint16(p + 10, true);
      const compSize = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const local = view.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      const lNameLen = view.getUint16(local + 26, true);
      const lExtraLen = view.getUint16(local + 28, true);
      const start = local + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(start, start + compSize);
      files.set(name, { method, raw });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return {
      has: name => files.has(name),
      async bytes(name) {
        const f = files.get(name);
        if (!f) return null;
        return f.method === 0 ? f.raw : inflateRaw(f.raw);
      },
      async text(name) {
        const b = await this.bytes(name);
        return b ? dec.decode(b) : null;
      },
    };
  }

  /* ---------- Yardımcılar ---------- */

  const xmlEsc = s => String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function rgbToHex(rgb) {
    const m = String(rgb).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
    if (!m) return null;
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    return [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  const BLOCK_RE = /^(P|DIV|H[1-6]|BLOCKQUOTE|PRE|UL|OL|LI|TABLE|HR|SECTION|ARTICLE|HEADER|FOOTER|NAV|FIGURE|ASIDE|MAIN)$/;
  const isBlock = n => n.nodeType === 1 && BLOCK_RE.test(n.nodeName);

  /* ---------- Dışa aktarma ---------- */

  function exportDocx({ root, title, settings }) {
    const PAGE_SIZES = { A4: [210, 297], Letter: [215.9, 279.4], A5: [148, 210] };
    let [pw, ph] = PAGE_SIZES[settings.pageSize] || PAGE_SIZES.A4;
    if (settings.orientation === 'landscape') [pw, ph] = [ph, pw];
    const contentWidthMm = pw - 2 * settings.margin;
    const contentTw = Math.round(contentWidthMm * MM_TO_TWIP);
    const contentPx = contentWidthMm * MM_TO_PX;

    const rels = [];
    const media = [];
    const listIds = new Map();
    let nextNum = 2;
    let drawingId = 1;
    const addRel = (type, target, external) => {
      const id = `rId${rels.length + 10}`;
      rels.push({ id, type, target, external });
      return id;
    };

    function runProps(el, blk) {
      const cs = getComputedStyle(el);
      let underline = false;
      let strike = false;
      let shade = null;
      let va = null;
      for (let n = el; n && n !== root; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.textDecorationLine.includes('underline')) underline = true;
        if (s.textDecorationLine.includes('line-through')) strike = true;
        if (!va && (s.verticalAlign === 'sub' || s.verticalAlign === 'super')) va = s.verticalAlign;
        if (n === blk) break;
        if (!shade) shade = rgbToHex(s.backgroundColor);
      }
      const font = xmlEsc(cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() || 'Calibri');
      const sz = Math.round(parseFloat(cs.fontSize) * 0.75 * 2);
      const color = rgbToHex(cs.color);
      let p = `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>`;
      if (Number(cs.fontWeight) >= 600) p += '<w:b/>';
      if (cs.fontStyle === 'italic') p += '<w:i/>';
      if (strike) p += '<w:strike/>';
      if (color && color !== '000000') p += `<w:color w:val="${color}"/>`;
      if (sz) p += `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`;
      if (underline) p += '<w:u w:val="single"/>';
      if (shade) p += `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>`;
      if (va) p += `<w:vertAlign w:val="${va === 'sub' ? 'subscript' : 'superscript'}"/>`;
      return `<w:rPr>${p}</w:rPr>`;
    }

    function textRuns(node, blk) {
      const el = node.parentElement;
      const pre = getComputedStyle(el).whiteSpace.startsWith('pre');
      let text = node.nodeValue.replace(/\u200B/g, '');
      if (!pre) text = text.replace(/[\s\n]+/g, ' ');
      if (!text) return '';
      const rPr = runProps(el, blk);
      return text.split('\n').map((line, i) =>
        (i ? `<w:r>${rPr}<w:br/></w:r>` : '') +
        (line ? `<w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(line)}</w:t></w:r>` : '')).join('');
    }

    function imageRun(img) {
      let src = img.getAttribute('src') || '';
      let m = src.match(/^data:image\/(png|jpe?g);base64,(.*)$/i);
      if (!m) {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          src = c.toDataURL('image/png');
          m = src.match(/^data:image\/(png);base64,(.*)$/);
        } catch { m = null; }
      }
      if (!m || !img.naturalWidth) return '';
      const ext = m[1].toLowerCase() === 'png' ? 'png' : 'jpeg';
      const name = `image${media.length + 1}.${ext}`;
      media.push({ name: `word/media/${name}`, data: base64ToBytes(m[2]) });
      const rid = addRel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', `media/${name}`);
      let wPx = img.naturalWidth;
      const pct = (img.style.width || '').match(/^([\d.]+)%$/);
      if (pct) wPx = contentPx * parseFloat(pct[1]) / 100;
      else if (/px$/.test(img.style.width)) wPx = parseFloat(img.style.width);
      wPx = Math.min(wPx, contentPx);
      const hPx = wPx * img.naturalHeight / img.naturalWidth;
      const cx = Math.round(wPx * PX_TO_EMU);
      const cy = Math.round(hPx * PX_TO_EMU);
      const id = drawingId++;
      return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
        `<wp:docPr id="${id}" name="Resim ${id}" descr="${xmlEsc(img.alt || '')}"/>` +
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    }

    function inline(nodes, blk, state) {
      let out = '';
      for (const node of nodes) {
        if (node.nodeType === 3) { out += textRuns(node, blk); continue; }
        if (node.nodeType !== 1) continue;
        const tag = node.nodeName;
        if (tag === 'BR') out += '<w:r><w:br/></w:r>';
        else if (tag === 'IMG') {
          out += imageRun(node);
          if (node.style.marginLeft === 'auto' && node.style.marginRight === 'auto') state.jc = 'center';
          else if (node.style.marginLeft === 'auto') state.jc = 'right';
        } else if (tag === 'A' && /^(https?:|mailto:)/i.test(node.getAttribute('href') || '')) {
          const rid = addRel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', node.getAttribute('href'), true);
          out += `<w:hyperlink r:id="${rid}" w:history="1">${inline(node.childNodes, blk, state)}</w:hyperlink>`;
        } else if (node.classList.contains('toc-pg')) {
          // İçindekiler: sayfa numarasını noktalı sağ sekmeyle hizala
          state.tocTab = true;
          out += `<w:r><w:tab/></w:r>${inline(node.childNodes, blk, state)}`;
        } else if (!/^(SCRIPT|STYLE)$/.test(tag)) {
          out += inline(node.childNodes, blk, state);
        }
      }
      return out;
    }

    function paraProps(blk, ctx, state) {
      let p = '';
      if (blk && blk !== root) {
        const tag = blk.nodeName;
        const hm = tag.match(/^H([1-6])$/);
        if (hm) p += `<w:pStyle w:val="Heading${Math.min(3, +hm[1])}"/>`;
        else if (tag === 'BLOCKQUOTE') p += '<w:pStyle w:val="Quote"/>';
      }
      if (ctx.list && !ctx.list.used) {
        p += `<w:numPr><w:ilvl w:val="${ctx.list.ilvl}"/><w:numId w:val="${ctx.list.numId}"/></w:numPr>`;
        ctx.list.used = true;
      }
      if (blk && blk !== root) {
        const cs = getComputedStyle(blk);
        const bg = rgbToHex(cs.backgroundColor);
        if (bg) p += `<w:shd w:val="clear" w:color="auto" w:fill="${bg}"/>`;
        if (state.tocTab) p += `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${contentTw}"/></w:tabs>`;
        const before = Math.round(parseFloat(cs.marginTop) * PX_TO_TWIP) || 0;
        const after = Math.round(parseFloat(cs.marginBottom) * PX_TO_TWIP) || 0;
        let line = '';
        const lh = parseFloat(cs.lineHeight);
        const fs = parseFloat(cs.fontSize);
        if (!isNaN(lh) && fs) line = ` w:line="${Math.round(lh / fs * 240)}" w:lineRule="auto"`;
        p += `<w:spacing w:before="${before}" w:after="${after}"${line}/>`;
        if (!ctx.list) {
          const left = Math.round((parseFloat(cs.marginLeft) + parseFloat(cs.paddingLeft)) * PX_TO_TWIP) || 0;
          const right = Math.round(parseFloat(cs.marginRight) * PX_TO_TWIP) || 0;
          if (left || right) p += `<w:ind w:left="${left}" w:right="${right}"/>`;
        }
        const align = state.jc || { center: 'center', right: 'right', end: 'right', justify: 'both' }[cs.textAlign];
        if (align) p += `<w:jc w:val="${align}"/>`;
      } else if (state.jc) {
        p += `<w:jc w:val="${state.jc}"/>`;
      }
      return p ? `<w:pPr>${p}</w:pPr>` : '';
    }

    function paragraph(blk, nodes, ctx) {
      nodes = nodes.slice();
      while (nodes.length && nodes[nodes.length - 1].nodeName === 'BR') nodes.pop();
      const state = {};
      const runs = inline(nodes, blk, state);
      return `<w:p>${paraProps(blk, ctx, state)}${runs}</w:p>`;
    }

    function container(el, ctx) {
      let out = '';
      let buf = [];
      const flush = () => {
        const meaningful = buf.some(n => n.nodeType === 1 || n.nodeValue.trim());
        if (meaningful) out += paragraph(el, buf, ctx);
        buf = [];
      };
      for (const node of el.childNodes) {
        if (isBlock(node)) { flush(); out += block(node, ctx); } else buf.push(node);
      }
      flush();
      return out;
    }

    function block(el, ctx) {
      const tag = el.nodeName;
      if (el.classList.contains('ew-pagebreak')) return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      if (tag === 'HR') return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>';
      if (tag === 'TABLE') return table(el);
      if (tag === 'UL' || tag === 'OL') {
        const ilvl = ctx.list ? Math.min(8, ctx.list.ilvl + 1) : 0;
        let numId = 1;
        if (tag === 'OL') {
          if (!listIds.has(el)) listIds.set(el, nextNum++);
          numId = listIds.get(el);
        }
        let out = '';
        for (const li of el.children) {
          if (li.nodeName !== 'LI') { out += block(li, ctx); continue; }
          const liCtx = { list: { ilvl, numId, used: false } };
          let body = container(li, liCtx);
          if (!liCtx.list.used) body = `<w:p>${paraProps(li, liCtx, {})}</w:p>` + body;
          out += body;
        }
        return out;
      }
      if (Array.from(el.childNodes).some(isBlock)) return container(el, ctx);
      if (!el.childNodes.length) return `<w:p>${paraProps(el, ctx, {})}</w:p>`;
      return paragraph(el, Array.from(el.childNodes), ctx);
    }

    function table(el) {
      const rows = Array.from(el.rows || el.querySelectorAll('tr'));
      if (!rows.length) return '';
      const cols = Math.max(...rows.map(r => Array.from(r.cells).reduce((s, c) => s + (c.colSpan || 1), 0)));
      const colW = Math.floor(contentTw / cols);
      const border = side => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`;
      let out = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/>' +
        `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>` +
        '<w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>' +
        '</w:tblPr><w:tblGrid>' + `<w:gridCol w:w="${colW}"/>`.repeat(cols) + '</w:tblGrid>';
      for (const row of rows) {
        out += '<w:tr>';
        for (const cell of row.cells) {
          const span = cell.colSpan || 1;
          const bg = rgbToHex(getComputedStyle(cell).backgroundColor);
          let content = container(cell, {});
          if (!content.includes('<w:p')) content = '<w:p/>';
          else if (!/<\/w:p>$|<w:p\/>$/.test(content)) content += '<w:p/>';
          out += `<w:tc><w:tcPr><w:tcW w:w="${colW * span}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}` +
            `${bg ? `<w:shd w:val="clear" w:color="auto" w:fill="${bg}"/>` : ''}</w:tcPr>${content}</w:tc>`;
        }
        out += '</w:tr>';
      }
      return out + '</w:tbl>';
    }

    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

    let body = container(root, {});
    if (/<\/w:tbl>$/.test(body) || !body) body += '<w:p/>';

    // Üst/alt bilgi
    let headerRef = '';
    let footerRef = '';
    const extraParts = [];
    const small = '<w:rPr><w:color w:val="808080"/><w:sz w:val="18"/></w:rPr>';
    if (settings.header) {
      const rid = addRel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/header', 'header1.xml');
      headerRef = `<w:headerReference w:type="default" r:id="${rid}"/>`;
      extraParts.push({ name: 'word/header1.xml', type: 'header', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${small}<w:t xml:space="preserve">${xmlEsc(settings.header)}</w:t></w:r></w:p></w:hdr>` });
    }
    if (settings.footer || settings.pageNumbers) {
      const rid = addRel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer', 'footer1.xml');
      footerRef = `<w:footerReference w:type="default" r:id="${rid}"/>`;
      const pageField = settings.pageNumbers
        ? `<w:r>${small}<w:tab/></w:r><w:fldSimple w:instr=" PAGE "><w:r>${small}<w:t>1</w:t></w:r></w:fldSimple><w:r>${small}<w:t xml:space="preserve"> / </w:t></w:r><w:fldSimple w:instr=" NUMPAGES "><w:r>${small}<w:t>1</w:t></w:r></w:fldSimple>`
        : '';
      extraParts.push({ name: 'word/footer1.xml', type: 'footer', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="${contentTw}"/></w:tabs></w:pPr><w:r>${small}<w:t xml:space="preserve">${xmlEsc(settings.footer || '')}</w:t></w:r>${pageField}</w:p></w:ftr>` });
    }

    const mTw = Math.round(settings.margin * MM_TO_TWIP);
    const sect = `<w:sectPr>${headerRef}${footerRef}<w:pgSz w:w="${Math.round(pw * MM_TO_TWIP)}" w:h="${Math.round(ph * MM_TO_TWIP)}"${settings.orientation === 'landscape' ? ' w:orient="landscape"' : ''}/>` +
      `<w:pgMar w:top="${mTw}" w:right="${mTw}" w:bottom="${mTw}" w:left="${mTw}" w:header="708" w:footer="708" w:gutter="0"/>` +
      (settings.columns > 1 ? `<w:cols w:num="${settings.columns}" w:space="680"/>` : '<w:cols w:space="708"/>') +
      '</w:sectPr>';

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;

    const bulletLvls = Array.from({ length: 9 }, (_, i) =>
      `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${['•', '◦', '▪'][i % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
    const decimalLvls = Array.from({ length: 9 }, (_, i) =>
      `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${['decimal', 'lowerLetter', 'lowerRoman'][i % 3]}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
    let nums = '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    for (let n = 2; n < nextNum; n++) {
      nums += `<w:num w:numId="${n}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`;
    }
    const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>` +
      `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${bulletLvls}</w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${decimalLvls}</w:abstractNum>${nums}</w:numbering>`;

    const heading = (n, size, color) =>
      `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
      `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr>` +
      `<w:rPr><w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>` +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="tr-TR"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      heading(1, 40, '2F5496') + heading(2, 32, '2F5496') + heading(3, 26, '1F3763') +
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
      '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>' +
      '</w:styles>';

    const docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
      rels.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${xmlEsc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('') +
      '</Relationships>';

    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const coreXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${xmlEsc(title)}</dc:title><dc:creator>EasyWrite</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
    const appXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>EasyWrite</Application></Properties>';

    const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
      extraParts.map(p => `<Override PartName="/${p.name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${p.type}+xml"/>`).join('') +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';

    const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';

    return zip([
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rootRels },
      { name: 'docProps/core.xml', data: coreXml },
      { name: 'docProps/app.xml', data: appXml },
      { name: 'word/document.xml', data: documentXml },
      { name: 'word/styles.xml', data: stylesXml },
      { name: 'word/numbering.xml', data: numberingXml },
      { name: 'word/_rels/document.xml.rels', data: docRels },
      ...extraParts,
      ...media,
    ]);
  }

  /* ---------- İçe aktarma ---------- */

  const HIGHLIGHT = {
    yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
    darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
    darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff',
  };

  async function importDocx(buffer, fileName) {
    const z = await unzip(buffer);
    const parse = s => new DOMParser().parseFromString(s, 'application/xml');
    const docText = await z.text('word/document.xml');
    if (!docText) throw new Error('word/document.xml bulunamadı');
    const doc = parse(docText);

    const kids = (el, name) => Array.from(el ? el.children : []).filter(c => !name || c.localName === name);
    const kid = (el, name) => kids(el, name)[0] || null;
    const attr = (el, name) => el ? (el.getAttribute('w:' + name) ?? el.getAttribute(name)) : null;

    // İlişkiler
    const rels = new Map();
    const relText = await z.text('word/_rels/document.xml.rels');
    if (relText) {
      Array.from(parse(relText).getElementsByTagName('Relationship')).forEach(r => {
        rels.set(r.getAttribute('Id'), { target: r.getAttribute('Target'), external: r.getAttribute('TargetMode') === 'External' });
      });
    }

    // Stiller (başlık tespiti)
    const headingLevel = new Map();
    const quoteStyles = new Set();
    const stylesText = await z.text('word/styles.xml');
    if (stylesText) {
      Array.from(parse(stylesText).getElementsByTagName('w:style')).forEach(s => {
        const id = attr(s, 'styleId');
        const name = (attr(kid(s, 'name'), 'val') || '').toLowerCase();
        const outline = s.getElementsByTagName('w:outlineLvl')[0];
        let m = name.match(/^(heading|başlık)\s*(\d)$/);
        if (m) headingLevel.set(id, +m[2]);
        else if (name === 'title') headingLevel.set(id, 1);
        else if (outline) headingLevel.set(id, +attr(outline, 'val') + 1);
        if (/quote|alıntı/.test(name)) quoteStyles.add(id);
      });
    }

    // Numaralandırma (madde mi sıralı mı)
    const numFormats = new Map();
    const numText = await z.text('word/numbering.xml');
    if (numText) {
      const nx = parse(numText);
      const abstract = new Map();
      Array.from(nx.getElementsByTagName('w:abstractNum')).forEach(a => {
        const lv = new Map();
        Array.from(a.getElementsByTagName('w:lvl')).forEach(l => lv.set(+attr(l, 'ilvl'), attr(kid(l, 'numFmt'), 'val')));
        abstract.set(attr(a, 'abstractNumId'), lv);
      });
      Array.from(nx.getElementsByTagName('w:num')).forEach(n => {
        numFormats.set(attr(n, 'numId'), abstract.get(attr(kid(n, 'abstractNumId'), 'val')) || new Map());
      });
    }

    const mediaCache = new Map();
    async function mediaUrl(rid) {
      const rel = rels.get(rid);
      if (!rel) return null;
      const path = rel.target.startsWith('/') ? rel.target.slice(1) : 'word/' + rel.target.replace(/^\.\//, '');
      if (mediaCache.has(path)) return mediaCache.get(path);
      const bytes = await z.bytes(path);
      if (!bytes) return null;
      const ext = path.split('.').pop().toLowerCase();
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' }[ext];
      if (!mime) return null;
      const url = `data:${mime};base64,${bytesToBase64(bytes)}`;
      mediaCache.set(path, url);
      return url;
    }

    const out = document.createElement('div');

    function runStyle(rPr) {
      const st = [];
      const wrap = [];
      if (!rPr) return { st, wrap };
      const on = name => {
        const e = kid(rPr, name);
        return e && !['0', 'false'].includes(attr(e, 'val'));
      };
      if (on('b')) wrap.push('b');
      if (on('i')) wrap.push('i');
      const u = kid(rPr, 'u');
      if (u && attr(u, 'val') !== 'none') wrap.push('u');
      if (on('strike') || on('dstrike')) wrap.push('s');
      const va = attr(kid(rPr, 'vertAlign'), 'val');
      if (va === 'superscript') wrap.push('sup');
      if (va === 'subscript') wrap.push('sub');
      const color = attr(kid(rPr, 'color'), 'val');
      if (color && /^[0-9a-f]{6}$/i.test(color) && color !== '000000') st.push(`color:#${color}`);
      const sz = attr(kid(rPr, 'sz'), 'val');
      if (sz) st.push(`font-size:${+sz / 2}pt`);
      const font = attr(kid(rPr, 'rFonts'), 'ascii') || attr(kid(rPr, 'rFonts'), 'hAnsi');
      if (font) st.push(`font-family:'${font.replace(/'/g, '')}'`);
      const hl = attr(kid(rPr, 'highlight'), 'val');
      const shd = attr(kid(rPr, 'shd'), 'fill');
      if (hl && HIGHLIGHT[hl]) st.push(`background-color:${HIGHLIGHT[hl]}`);
      else if (shd && /^[0-9a-f]{6}$/i.test(shd) && shd.toUpperCase() !== 'FFFFFF') st.push(`background-color:#${shd}`);
      return { st, wrap };
    }

    async function runsInto(parent, nodes, state) {
      for (const n of nodes) {
        const name = n.localName;
        if (name === 'r') {
          const { st, wrap } = runStyle(kid(n, 'rPr'));
          let target = parent;
          if (st.length) {
            const span = document.createElement('span');
            span.setAttribute('style', st.join(';'));
            target.appendChild(span);
            target = span;
          }
          for (const tag of wrap) {
            const w = document.createElement(tag);
            target.appendChild(w);
            target = w;
          }
          for (const c of n.children) {
            const cn = c.localName;
            if (cn === 't') target.appendChild(document.createTextNode(c.textContent));
            else if (cn === 'tab') target.appendChild(document.createTextNode(' '));
            else if (cn === 'br') {
              if (attr(c, 'type') === 'page') state.pageBreak = true;
              else target.appendChild(document.createElement('br'));
            } else if (cn === 'lastRenderedPageBreak') {
              /* yok say */
            } else if (cn === 'drawing' || cn === 'pict') {
              const blip = c.getElementsByTagName('a:blip')[0] || c.getElementsByTagName('v:imagedata')[0];
              const rid = blip && (blip.getAttribute('r:embed') || blip.getAttribute('r:id'));
              const url = rid && await mediaUrl(rid);
              if (url) {
                const img = document.createElement('img');
                img.src = url;
                const ext = c.getElementsByTagName('wp:extent')[0];
                if (ext && state.contentEmu) {
                  const pct = Math.min(100, Math.round(+ext.getAttribute('cx') / state.contentEmu * 100));
                  img.style.width = `${pct}%`;
                }
                target.appendChild(img);
              }
            }
          }
        } else if (name === 'hyperlink') {
          const rel = rels.get(n.getAttribute('r:id'));
          const a = document.createElement('a');
          if (rel && rel.external) { a.href = rel.target; a.target = '_blank'; a.rel = 'noopener'; }
          parent.appendChild(a);
          await runsInto(a, Array.from(n.children), state);
        } else if (['ins', 'smartTag', 'fldSimple', 'customXml', 'sdtContent', 'sdt'].includes(name)) {
          await runsInto(parent, Array.from(name === 'sdt' ? kids(kid(n, 'sdtContent')) : n.children), state);
        }
      }
    }

    async function paragraph(p, state) {
      const pPr = kid(p, 'pPr');
      const styleId = attr(kid(pPr, 'pStyle'), 'val');
      const level = headingLevel.get(styleId);
      const tag = level ? `h${Math.min(3, level)}` : quoteStyles.has(styleId) ? 'blockquote' : 'p';
      const el = document.createElement(tag);
      const jc = attr(kid(pPr, 'jc'), 'val');
      const align = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[jc];
      if (align) el.style.textAlign = align;
      const spacing = kid(pPr, 'spacing');
      const line = attr(spacing, 'line');
      if (line && (!attr(spacing, 'lineRule') || attr(spacing, 'lineRule') === 'auto')) {
        const v = Math.round(+line / 240 * 100) / 100;
        if (v >= 0.8 && v <= 4 && Math.abs(v - 1.15) > 0.05) el.style.lineHeight = String(v);
      }
      const pState = { contentEmu: state.contentEmu };
      await runsInto(el, Array.from(p.children), pState);
      if (!el.childNodes.length) el.appendChild(document.createElement('br'));

      const numPr = kid(pPr, 'numPr');
      const numId = attr(kid(numPr, 'numId'), 'val');
      return { el, pageBreak: pState.pageBreak, list: numPr && numId && numId !== '0' ? {
        numId, ilvl: +(attr(kid(numPr, 'ilvl'), 'val') || 0),
      } : null };
    }

    async function table(tbl, state) {
      const table = document.createElement('table');
      const tbody = document.createElement('tbody');
      table.appendChild(tbody);
      for (const tr of kids(tbl, 'tr')) {
        const row = document.createElement('tr');
        for (const tc of kids(tr, 'tc')) {
          const tcPr = kid(tc, 'tcPr');
          const vMerge = kid(tcPr, 'vMerge');
          if (vMerge && attr(vMerge, 'val') !== 'restart') continue;
          const cell = document.createElement('td');
          const span = +(attr(kid(tcPr, 'gridSpan'), 'val') || 1);
          if (span > 1) cell.colSpan = span;
          const fill = attr(kid(tcPr, 'shd'), 'fill');
          if (fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toUpperCase() !== 'FFFFFF') cell.style.backgroundColor = `#${fill}`;
          await bodyInto(cell, Array.from(tc.children), state);
          row.appendChild(cell);
        }
        tbody.appendChild(row);
      }
      return table;
    }

    async function bodyInto(container, nodes, state) {
      const stack = []; // açık listeler: { el, numId }
      const closeLists = () => { stack.length = 0; };
      for (const n of nodes) {
        if (n.localName === 'p') {
          const { el, pageBreak, list } = await paragraph(n, state);
          if (list) {
            const fmt = (numFormats.get(list.numId) || new Map()).get(list.ilvl) || 'bullet';
            const ordered = fmt !== 'bullet' && fmt !== 'none';
            while (stack.length > list.ilvl + 1) stack.pop();
            if (stack.length === list.ilvl + 1 && stack[stack.length - 1].numId !== list.numId) stack.pop();
            while (stack.length < list.ilvl + 1) {
              const l = document.createElement(ordered ? 'ol' : 'ul');
              if (stack.length) {
                const parentList = stack[stack.length - 1].el;
                let li = parentList.lastElementChild;
                if (!li) { li = document.createElement('li'); parentList.appendChild(li); }
                li.appendChild(l);
              } else {
                container.appendChild(l);
              }
              stack.push({ el: l, numId: list.numId });
            }
            const li = document.createElement('li');
            while (el.firstChild) li.appendChild(el.firstChild);
            if (el.style.textAlign) li.style.textAlign = el.style.textAlign;
            stack[stack.length - 1].el.appendChild(li);
          } else {
            closeLists();
            container.appendChild(el);
          }
          if (pageBreak) {
            closeLists();
            const br = document.createElement('div');
            br.className = 'ew-pagebreak';
            br.setAttribute('contenteditable', 'false');
            container.appendChild(br);
          }
        } else if (n.localName === 'tbl') {
          closeLists();
          container.appendChild(await table(n, state));
        } else if (n.localName === 'sdt') {
          closeLists();
          await bodyInto(container, kids(kid(n, 'sdtContent')), state);
        }
      }
    }

    const body = doc.getElementsByTagName('w:body')[0];
    const sect = body && kid(body, 'sectPr');
    const settings = {};
    let contentEmu = 0;
    if (sect) {
      const pgSz = kid(sect, 'pgSz');
      const pgMar = kid(sect, 'pgMar');
      const w = +attr(pgSz, 'w') / MM_TO_TWIP;
      const h = +attr(pgSz, 'h') / MM_TO_TWIP;
      if (w && h) {
        const [sw, sh] = [Math.min(w, h), Math.max(w, h)];
        settings.pageSize = Math.abs(sw - 216) < 4 && Math.abs(sh - 279) < 4 ? 'Letter' : Math.abs(sw - 148) < 4 ? 'A5' : 'A4';
        settings.orientation = w > h ? 'landscape' : 'portrait';
      }
      const left = +attr(pgMar, 'left') / MM_TO_TWIP;
      if (left) {
        const options = [12.7, 19.1, 25.4, 50.8];
        settings.margin = options.reduce((a, b) => Math.abs(b - left) < Math.abs(a - left) ? b : a);
        if (w) contentEmu = (w - 2 * left) * MM_TO_PX * PX_TO_EMU;
      }
      const cols = attr(kid(sect, 'cols'), 'num');
      if (cols && +cols > 1) settings.columns = Math.min(3, +cols);
    }

    await bodyInto(out, body ? Array.from(body.children) : [], { contentEmu });

    let title = '';
    const core = await z.text('docProps/core.xml');
    if (core) {
      const t = parse(core).getElementsByTagName('dc:title')[0];
      if (t) title = t.textContent.trim();
    }
    return { title: title || (fileName || 'Belge').replace(/\.[^.]+$/, ''), html: out.innerHTML, settings };
  }

  window.EWDocx = { exportDocx, importDocx, zip, unzip };
})();
