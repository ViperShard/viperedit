/* ============================================================
   ViperEdit — Core editor
   Organized into sections:
     1.  Utilities
     2.  Storage
     3.  Settings
     4.  Documents
     5.  Fonts
     6.  Command registry
     7.  Core editor wiring
     8.  Formatting actions
     9.  Background manager
     10. Command palette
     11. Settings panel
     12. Find & replace
     13. Slash commands
     14. Table picker
     15. Export / import
     16. Shortcuts
     17. Init
   ============================================================ */

(() => {
  'use strict';

  /* ============================================================
     1. Utilities
     ============================================================ */

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const uid = () => 'd_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  const debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  /* ============================================================
     Pagination — Google-Docs-style paged layout.

     DOM model:
         <div id="editor" contenteditable>
           <div class="paper"> ... blocks (p, h1, ...) ... </div>
           <div class="paper"> ... </div>
         </div>

     Each .paper is a physical sheet (min-height = 11 in @ 96 dpi) with
     its own padding = page margin. Text actually lives inside the paper
     element — not as an overlay. Papers are separated by a visible
     wallpaper gap (CSS gap on the editor flex column).

     On every input we:
       1. Merge split-continuation blocks back across paper boundaries so
          we measure with the document's canonical block list.
       2. Flatten all block children across all papers, in order.
       3. Redistribute blocks across papers: for each block in order, try
          to place it in the current paper. If placing it overflows the
          paper's content area, either split it (if it's text and tall)
          or move it whole to the next paper. Create papers as needed.
       4. Remove any now-empty trailing papers.
     ============================================================ */

  const CURSOR_MARKER_ID = '__ve_cursor_marker__';

  function placeCursorMarker() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const r = sel.getRangeAt(0).cloneRange();
    const m = document.createElement('span');
    m.id = CURSOR_MARKER_ID;
    m.setAttribute('data-ve-cursor', '1');
    m.style.cssText = 'display:inline;width:0;height:0;';
    r.insertNode(m);
    return true;
  }

  function restoreCursorMarker() {
    const m = document.getElementById(CURSOR_MARKER_ID);
    if (!m) return;
    const r = document.createRange();
    r.setStartAfter(m);
    r.collapse(true);
    const sel = window.getSelection();
    try { sel.removeAllRanges(); sel.addRange(r); } catch {}
    m.remove();
  }

  // Walk backward from (node, offset) looking for whitespace, without
  // crossing the boundary of `root`. Returns { node, offset } if a
  // whitespace character is found within `limit` scanned characters,
  // or null if none exists nearby. Split points land AFTER the
  // whitespace so the trailing space stays on the previous page.
  function findWordBoundaryBefore(node, offset, root, limit = 120) {
    let cur = node;
    let curOffset = offset;
    let scanned = 0;
    while (cur && scanned < limit) {
      if (cur.nodeType === 3) {
        const text = cur.nodeValue || '';
        let i = Math.min(curOffset, text.length);
        while (i > 0 && scanned < limit) {
          if (/\s/.test(text.charAt(i - 1))) {
            return { node: cur, offset: i };
          }
          i--;
          scanned++;
        }
        curOffset = i;
      }
      // Step to the previous node in document order within `root`.
      let prev = cur.previousSibling;
      if (prev) {
        while (prev.lastChild) prev = prev.lastChild;
        cur = prev;
        curOffset = cur.nodeType === 3 ? (cur.nodeValue || '').length : 0;
      } else {
        cur = cur.parentNode;
        if (!cur || cur === root || !root.contains(cur)) break;
      }
    }
    return null;
  }

  // Split a block-level element at the given viewport Y coordinate.
  // Returns the newly-created "second half" element, or null if the
  // split couldn't be done (off-screen, unsupported, etc.).
  function splitBlockAtY(block, viewportY) {
    const rect = block.getBoundingClientRect();
    if (viewportY <= rect.top || viewportY >= rect.bottom) return null;
    const x = rect.left + Math.min(20, rect.width / 4);

    let node, offset;
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, viewportY);
      if (!pos) return null;
      node = pos.offsetNode;
      offset = pos.offset;
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, viewportY);
      if (!r) return null;
      node = r.startContainer;
      offset = r.startOffset;
    } else {
      return null;
    }
    if (!node || !block.contains(node)) return null;

    // Snap to the nearest word boundary BEFORE the found position so we
    // don't cut a word in half. If there's no whitespace within ~120
    // characters (e.g. a URL or a stream of no-space text), fall back to
    // the mid-character split — still better than overflowing.
    const snap = findWordBoundaryBefore(node, offset, block);
    if (snap) { node = snap.node; offset = snap.offset; }

    const range = document.createRange();
    try {
      range.setStart(node, offset);
      range.setEndAfter(block.lastChild || block);
    } catch { return null; }

    let frag;
    try { frag = range.extractContents(); } catch { return null; }
    if (!frag || !frag.childNodes.length) return null;

    const newBlock = document.createElement(block.tagName);
    // Copy attributes except our own housekeeping and the inline style
    // (which contains the page-break margin we manage ourselves).
    for (const a of Array.from(block.attributes)) {
      if (a.name === 'data-ve-pagebreak' || a.name === 'data-ve-split') continue;
      if (a.name === 'style') continue;
      try { newBlock.setAttribute(a.name, a.value); } catch {}
    }
    newBlock.appendChild(frag);
    block.parentNode.insertBefore(newBlock, block.nextSibling);
    return newBlock;
  }

  function newPaper() {
    const p = document.createElement('div');
    p.className = 'paper';
    return p;
  }

  function getPapers(editor) {
    return Array.from(editor.querySelectorAll(':scope > .paper'));
  }

  // Normalize the editor's direct children so that exactly one or more
  // .paper siblings hold all content blocks — no orphan direct children,
  // no nested papers. Orphans get absorbed into the nearest adjacent paper
  // (preserving document order). Called at the start of every pagination
  // pass so we always start from a clean structural baseline.
  function normalizeEditorStructure(editor) {
    if (!editor) return;

    // 1. Unwrap any accidentally-nested papers (a .paper inside a .paper).
    //    Content goes into the outer paper at the nested paper's position.
    let guard = 0;
    while (guard++ < 20) {
      const nested = editor.querySelector('.paper .paper');
      if (!nested) break;
      const parent = nested.parentNode;
      while (nested.firstChild) parent.insertBefore(nested.firstChild, nested);
      nested.remove();
    }

    // 2. Absorb any orphan direct children of .editor into the nearest
    //    adjacent paper. Walk children in reverse so the "nearest previous
    //    paper" logic is simple; if none, fall back to the next one; if
    //    neither, create a fresh paper to hold them.
    const orphans = Array.from(editor.children).filter((c) => !c.classList.contains('paper'));
    for (const orphan of orphans) {
      let target = orphan.previousElementSibling;
      while (target && !target.classList.contains('paper')) target = target.previousElementSibling;
      if (target) {
        target.appendChild(orphan);   // append at end of previous paper
        continue;
      }
      let next = orphan.nextElementSibling;
      while (next && !next.classList.contains('paper')) next = next.nextElementSibling;
      if (next) {
        next.insertBefore(orphan, next.firstChild);   // prepend into next paper
        continue;
      }
      // No papers exist at all — make one and drop the orphan in.
      const fresh = newPaper();
      editor.insertBefore(fresh, orphan);
      fresh.appendChild(orphan);
    }

    // 3. Strip pure-whitespace text nodes at editor level (browsers insert
    //    these sometimes; they'd render in the flex gap between papers).
    for (const ch of Array.from(editor.childNodes)) {
      if (ch.nodeType === 3 && !ch.nodeValue.trim()) ch.remove();
    }

    // 4. If we still have nothing, create a seed paper with an empty <p>.
    if (!editor.children.length) {
      const paper = newPaper();
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      paper.appendChild(p);
      editor.appendChild(paper);
    }
  }

  const Pagination = {
    PAGE_H: 11 * 96,       // 1056 px — US Letter @ 96 dpi

    _raf: null,
    schedule() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this.update();
      });
    },

    // Merge split-continuation blocks back into their logical origin so
    // we measure with the canonical block list. Continuations can sit at
    // the start of paper[N] (with their origin at the end of paper[N-1])
    // or inline inside a paper if the user moved content around.
    _mergeSplits(editor) {
      const papers = getPapers(editor);
      for (let i = 0; i < papers.length; i++) {
        const paper = papers[i];
        // Check the very first child: if it's a split, its origin is in the
        // previous paper's last element.
        while (paper.firstElementChild &&
               paper.firstElementChild.getAttribute('data-ve-split') === '1') {
          const first = paper.firstElementChild;
          const prevPaper = papers[i - 1];
          const prevLast = prevPaper ? prevPaper.lastElementChild : null;
          if (prevLast && prevLast.tagName === first.tagName) {
            while (first.firstChild) prevLast.appendChild(first.firstChild);
            first.remove();
          } else {
            first.removeAttribute('data-ve-split');
            break;
          }
        }
        // Sibling-level splits inside the same paper.
        Array.from(paper.querySelectorAll(':scope > [data-ve-split="1"]')).forEach((s) => {
          const prev = s.previousElementSibling;
          if (prev && prev.tagName === s.tagName) {
            while (s.firstChild) prev.appendChild(s.firstChild);
            s.remove();
          } else {
            s.removeAttribute('data-ve-split');
          }
        });
      }
    },

    update() {
      const editor = $('#editor');
      if (!editor) return;
      normalizeEditorStructure(editor);

      const hadCursor = placeCursorMarker();
      try {
        this._mergeSplits(editor);

        const papers = getPapers(editor);
        if (!papers.length) { editor.appendChild(newPaper()); papers.push(editor.lastElementChild); }

        // 1. Flatten: collect block children across all papers in order.
        const blocks = [];
        for (const paper of papers) {
          for (const ch of Array.from(paper.childNodes)) {
            if (ch.nodeType === 1) blocks.push(ch);
            else if (ch.nodeType === 3 && !ch.nodeValue.trim()) ch.remove();
          }
        }
        if (!blocks.length) {
          const p = document.createElement('p');
          p.innerHTML = '<br>';
          blocks.push(p);
        }

        // 2. Redistribute. Each iteration either advances `i` (block placed)
        //    or advances to the next paper (current block pushed). A safety
        //    iteration cap guards against any unexpected non-progress.
        let paperIdx = 0;
        let curPaper = papers[0];
        let i = 0;
        let iter = 0;
        const MAX_ITER = Math.max(2000, blocks.length * 6);

        const ensurePaperAt = (idx) => {
          while (papers.length <= idx) {
            const p = newPaper();
            editor.appendChild(p);
            papers.push(p);
          }
          return papers[idx];
        };

        // A block fits on the current paper iff its bottom edge lands at or
        // above the content area's bottom boundary. We measure against the
        // block directly (its offsetTop + offsetHeight inside the paper)
        // instead of paper.scrollHeight vs clientHeight — the latter counts
        // padding as part of the available space, so content that spills
        // INTO the bottom margin reads as "fits" and no break is triggered.
        const paperOverflow = (paper) => {
          const last = paper.lastElementChild;
          if (!last) return false;
          const cs = getComputedStyle(paper);
          const padBot = parseFloat(cs.paddingBottom) || 0;
          // clientHeight = padding-box height. Subtracting padBot gives the
          // padding-box-relative Y of the content area's bottom.
          const contentBottom = paper.clientHeight - padBot;
          return (last.offsetTop + last.offsetHeight) > contentBottom + 0.5;
        };

        while (i < blocks.length && iter++ < MAX_ITER) {
          const block = blocks[i];
          curPaper.appendChild(block);   // moves it in (or leaves it in place)

          if (!paperOverflow(curPaper)) { i++; continue; }

          // Overflow: try to split at the content area's bottom boundary.
          const rect = curPaper.getBoundingClientRect();
          const cs = getComputedStyle(curPaper);
          const padBot = parseFloat(cs.paddingBottom) || 0;
          // Snap the split a hair ABOVE the boundary so the line that
          // contains the split point ends above the margin — otherwise the
          // last line on the page would extend a few pixels into the
          // bottom margin.
          const safety = 2;
          const splitY = rect.bottom - padBot - safety;

          // Temporarily lift the hard clip so caretPositionFromPoint can
          // find the text node at splitY.
          const prevOverflow = curPaper.style.overflow;
          curPaper.style.overflow = 'visible';
          const tail = splitBlockAtY(block, splitY);
          curPaper.style.overflow = prevOverflow;

          if (tail) {
            tail.remove();
            tail.setAttribute('data-ve-split', '1');
            blocks.splice(i + 1, 0, tail);
            // Sanity: if the first half STILL overflows (e.g. an image was
            // split and the remaining half is taller than one page), push
            // it whole to the next paper.
            if (paperOverflow(curPaper) && curPaper.children.length > 1) {
              block.remove();
              paperIdx++;
              curPaper = ensurePaperAt(paperIdx);
              curPaper.appendChild(block);
              i++;
              continue;
            }
            i++;
            paperIdx++;
            curPaper = ensurePaperAt(paperIdx);
            continue;
          }

          // Split failed. If the block is the ONLY child of the current
          // paper we have no choice but to accept it oversize (clipped).
          // Otherwise push the whole block to the next paper.
          if (curPaper.children.length === 1) {
            i++;
            paperIdx++;
            curPaper = ensurePaperAt(paperIdx);
            continue;
          }
          block.remove();
          paperIdx++;
          curPaper = ensurePaperAt(paperIdx);
          // don't increment i — retry placing this same block on next paper
        }

        // 3. Prune trailing empty papers.
        for (let k = papers.length - 1; k > paperIdx; k--) {
          if (!papers[k].children.length) papers[k].remove();
        }

        // 4. Update page-count stat.
        const pageCount = paperIdx + 1;
        const pc = $('#page-count-stat');
        if (pc) pc.textContent = `${pageCount} page${pageCount === 1 ? '' : 's'}`;
      } finally {
        if (hadCursor) restoreCursorMarker();
      }
    }
  };

  // Flatten the editor's <div.paper> wrappers + split continuations into a
  // single canonical stream of block HTML. Used when saving to IDB.
  function cleanEditorHTML() {
    const editor = $('#editor');
    const clone = editor.cloneNode(true);
    // Merge split continuations across papers.
    Array.from(clone.querySelectorAll('.paper')).forEach((paper) => {
      while (paper.firstElementChild &&
             paper.firstElementChild.getAttribute('data-ve-split') === '1') {
        const first = paper.firstElementChild;
        const prevPaper = paper.previousElementSibling;
        const prevLast = (prevPaper && prevPaper.classList.contains('paper'))
          ? prevPaper.lastElementChild : null;
        if (prevLast && prevLast.tagName === first.tagName) {
          while (first.firstChild) prevLast.appendChild(first.firstChild);
          first.remove();
        } else {
          first.removeAttribute('data-ve-split');
          break;
        }
      }
      // Intra-paper splits.
      Array.from(paper.querySelectorAll(':scope > [data-ve-split="1"]')).forEach((s) => {
        const prev = s.previousElementSibling;
        if (prev && prev.tagName === s.tagName) {
          while (s.firstChild) prev.appendChild(s.firstChild);
          s.remove();
        } else {
          s.removeAttribute('data-ve-split');
        }
      });
    });
    // Unwrap paper containers — saved HTML is a flat block list.
    const out = document.createElement('div');
    Array.from(clone.querySelectorAll(':scope > .paper')).forEach((p) => {
      while (p.firstChild) out.appendChild(p.firstChild);
    });
    // Strip cursor markers.
    out.querySelectorAll('[data-ve-cursor], #' + CURSOR_MARKER_ID).forEach((n) => n.remove());
    return out.innerHTML;
  }

  // Flattened editor HTML with a page-break hint on the first block of each
  // paper. Used by Export.download('html') so printed / PDF output paginates
  // identically to the editor view.
  function pagedExportHTML() {
    const editor = $('#editor');
    const clone = editor.cloneNode(true);
    // Merge split continuations across papers (as in cleanEditorHTML).
    Array.from(clone.querySelectorAll('.paper')).forEach((paper) => {
      while (paper.firstElementChild &&
             paper.firstElementChild.getAttribute('data-ve-split') === '1') {
        const first = paper.firstElementChild;
        const prevPaper = paper.previousElementSibling;
        const prevLast = (prevPaper && prevPaper.classList.contains('paper'))
          ? prevPaper.lastElementChild : null;
        if (prevLast && prevLast.tagName === first.tagName) {
          while (first.firstChild) prevLast.appendChild(first.firstChild);
          first.remove();
        } else {
          first.removeAttribute('data-ve-split');
          break;
        }
      }
      Array.from(paper.querySelectorAll(':scope > [data-ve-split="1"]')).forEach((s) => {
        const prev = s.previousElementSibling;
        if (prev && prev.tagName === s.tagName) {
          while (s.firstChild) prev.appendChild(s.firstChild);
          s.remove();
        } else {
          s.removeAttribute('data-ve-split');
        }
      });
    });
    // Unwrap papers and mark the first block of each (except the first
    // paper) with a page-break directive.
    const out = document.createElement('div');
    const papers = Array.from(clone.querySelectorAll(':scope > .paper'));
    papers.forEach((p, idx) => {
      const firstEl = p.firstElementChild;
      if (idx > 0 && firstEl) firstEl.setAttribute('data-ve-pagebreak', '1');
      while (p.firstChild) out.appendChild(p.firstChild);
    });
    out.querySelectorAll('[data-ve-cursor], #' + CURSOR_MARKER_ID).forEach((n) => n.remove());
    return out.innerHTML;
  }

  /* ============================================================
     Per-document page margins
     ============================================================

     Google Docs stores margins per-document, not globally, and defaults
     to 1 inch on all four sides. Each ViperEdit doc carries its own
     { top, right, bottom, left } in inches; Margins.apply() pushes those
     values into CSS custom properties the .paper reads. */

  const MARGIN_DEFAULT = Object.freeze({ top: 1, right: 1, bottom: 1, left: 1 });
  const MARGIN_PRESETS = {
    narrow: { top: 0.5,  right: 0.5,  bottom: 0.5,  left: 0.5  },
    normal: { top: 1,    right: 1,    bottom: 1,    left: 1    },
    wide:   { top: 1.33, right: 1.33, bottom: 1.33, left: 1.33 }
  };

  function clampMargin(v) {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0, Math.min(4, n));
  }

  const Margins = {
    // Read the margin record off a doc, falling back to the default if
    // missing (older docs from before custom margins existed).
    forDoc(doc) {
      if (!doc || !doc.margins) return { ...MARGIN_DEFAULT };
      const m = doc.margins;
      return {
        top:    clampMargin(m.top),
        right:  clampMargin(m.right),
        bottom: clampMargin(m.bottom),
        left:   clampMargin(m.left)
      };
    },
    // Push the doc's margins into CSS vars + the print @page rule.
    apply(doc) {
      const m = this.forDoc(doc);
      const root = document.documentElement.style;
      // 1 inch = 96 CSS pixels (the editor's coordinate system).
      root.setProperty('--page-pad-top',    (m.top    * 96) + 'px');
      root.setProperty('--page-pad-right',  (m.right  * 96) + 'px');
      root.setProperty('--page-pad-bottom', (m.bottom * 96) + 'px');
      root.setProperty('--page-pad-left',   (m.left   * 96) + 'px');

      let style = document.getElementById('ve-print-page-style');
      if (!style) {
        style = document.createElement('style');
        style.id = 've-print-page-style';
        document.head.appendChild(style);
      }
      style.textContent =
        `@media print { @page { size: Letter; margin: ${m.top}in ${m.right}in ${m.bottom}in ${m.left}in; } }`;

      if (typeof Pagination !== 'undefined') Pagination.schedule();
    },
    // Update the current document's margins and persist.
    setForCurrent(margins) {
      const doc = Docs && Docs.current ? Docs.current() : null;
      if (!doc) return;
      doc.margins = {
        top:    clampMargin(margins.top),
        right:  clampMargin(margins.right),
        bottom: clampMargin(margins.bottom),
        left:   clampMargin(margins.left)
      };
      doc.updatedAt = Date.now();
      Persist.saveDoc(doc);
      this.apply(doc);
    }
  };

  // Inches used for the current doc's margins — consulted by export.
  function currentPageMarginInches() {
    const doc = Docs && Docs.current ? Docs.current() : null;
    const m = Margins.forDoc(doc);
    return `${m.top}in ${m.right}in ${m.bottom}in ${m.left}in`;
  }

  // Flip the UI theme without the transitional flash. Transitions on the
  // glass surfaces would otherwise interpolate between wildly different
  // rgba alpha values for ~250 ms and look like a blink.
  function toggleTheme() {
    const html = document.documentElement;
    const cur = html.getAttribute('data-theme') || 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    html.classList.add('theme-switching');
    // Force a reflow so the class takes effect before the attribute change.
    void html.offsetHeight;
    html.setAttribute('data-theme', next);
    // Remove after the browser has painted the new theme.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      html.classList.remove('theme-switching');
    }));
    if (window.VE_IDB && Persist && Persist.cache) Persist.cache.theme = next;
    Persist.saveTheme(next);
  }

  // Resize + re-encode an image file to keep background/inline images
  // inexpensive to store in IndexedDB. Returns a data URL.
  function compressImageFile(file, maxDim = 2048, quality = 0.85) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type || !file.type.startsWith('image/')) {
        return reject(new Error('not an image'));
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const max = Math.max(img.width, img.height);
        const scale = max > maxDim ? maxDim / max : 1;
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        // Keep PNG for transparency, otherwise use JPEG for much smaller files.
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(c.toDataURL(mime, quality));
      };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  const fuzzyScore = (q, s) => {
    if (!q) return 1;
    q = q.toLowerCase();
    s = s.toLowerCase();
    if (s.includes(q)) return 100 - (s.indexOf(q));
    let qi = 0, score = 0;
    for (let i = 0; i < s.length && qi < q.length; i++) {
      if (s[i] === q[qi]) { score += 2; qi++; } else { score -= 0.1; }
    }
    return qi === q.length ? score : 0;
  };

  /* ============================================================
     2. Persistence — IndexedDB (via VE_IDB) with in-memory cache
     ============================================================ */

  const IDB = window.VE_IDB;

  const Persist = {
    // Cached in memory — authoritative while the app is running.
    cache: {
      docs: [],          // Array of doc objects
      currentId: null,
      settings: null,
      theme: 'dark',
      background: null
    },

    async loadAll() {
      const [docs, currentId, settings, theme, background] = await Promise.all([
        IDB.getAll('docs'),
        IDB.get('meta', 'currentId'),
        IDB.get('meta', 'settings'),
        IDB.get('meta', 'theme'),
        IDB.get('meta', 'background')
      ]);
      this.cache.docs       = docs || [];
      this.cache.currentId  = currentId || null;
      this.cache.settings   = settings || null;
      this.cache.theme      = theme || 'dark';
      this.cache.background = background || null;
    },

    // Fire-and-forget writes. Errors are logged but don't block UI.
    saveDoc(doc)        { IDB.set('docs', doc.id, doc).catch(e => console.warn('saveDoc', e)); },
    deleteDoc(id)       { IDB.delete('docs', id).catch(e => console.warn('deleteDoc', e)); },
    saveCurrentId(id)   { IDB.set('meta', 'currentId', id).catch(()=>{}); },
    saveSettings(s)     { IDB.set('meta', 'settings', s).catch(()=>{}); },
    saveTheme(t)        { IDB.set('meta', 'theme', t).catch(()=>{}); },
    saveBackground(b)   { IDB.set('meta', 'background', b).catch(()=>{}); }
  };

  /* ============================================================
     3. Settings
     ============================================================ */

  const DEFAULT_SETTINGS = {
    theme: 'dark',                // 'dark' | 'light'  (light is experimental in glass UI)
    pageStyle: 'paper',           // 'paper' | 'sepia' | 'glass' | 'dark'
    fontFamily: '"Inter", sans-serif',
    fontSize: 11,                 // pt, applied as base document size via zoom
    lineHeight: 1.55,
    spellcheck: true,
    smartQuotes: true,
    autoLinks: true,
    autosaveMs: 600,
    zoom: 100,
    // Per-command shortcut overrides. Keys are command ids, values are
    // canonical combo strings (e.g. "Ctrl+Shift+P") or null to unbind.
    // When a command id is absent here, its registered default is used.
    shortcuts: {}
  };

  const Settings = {
    data: { ...DEFAULT_SETTINGS },

    get(k) { return this.data[k]; },
    set(k, v) {
      this.data[k] = v;
      Persist.saveSettings(this.data);
      this.apply();
    },
    setMany(partial) {
      if (!partial) return;
      for (const [k, v] of Object.entries(partial)) {
        if (k in DEFAULT_SETTINGS) this.data[k] = v;
      }
      Persist.saveSettings(this.data);
      this.apply();
      // Keep font dropdown in sync
      const fs = $('#font-family');
      if (fs && partial.fontFamily) fs.value = partial.fontFamily;
    },
    apply() {
      const s = this.data;
      document.body.setAttribute('data-page', s.pageStyle);
      document.documentElement.style.setProperty('--font-doc-default', s.fontFamily);

      // Line height + spellcheck (margins are per-doc and owned by Margins.apply)
      const ed = $('#editor');
      if (ed) {
        ed.style.lineHeight = s.lineHeight;
        ed.spellcheck = !!s.spellcheck;
      }

      // Zoom — only actually apply a transform when zoom != 100%.
      // A transform (even scale(1)) puts the element on its own compositor
      // layer, which on some browsers distorts how backdrop-filter samples
      // the background behind the glass page and causes visible artifacts.
      const page = $('#page');
      if (page) page.style.transform = s.zoom === 100 ? '' : `scale(${s.zoom / 100})`;
      const zv = $('#zoom-val');
      if (zv) zv.textContent = s.zoom + '%';

      // Sync the font-family dropdown.
      const fs = $('#font-family');
      if (fs && s.fontFamily && fs.value !== s.fontFamily) fs.value = s.fontFamily;

      // The @page print rule is written by Margins.apply() (per-doc, not
      // per-setting), so we don't touch it here.

      // Font-family / line-height changes affect block heights and therefore
      // pagination. Recompute after layout settles.
      if (typeof Pagination !== 'undefined') Pagination.schedule();
    }
  };

  /* ============================================================
     4. Documents (multi-doc)
     ============================================================ */

  const Docs = {
    all: [],            // populated in init()
    currentId: null,

    current() { return this.all.find(d => d.id === this.currentId); },

    createWelcome() {
      const d = {
        id: uid(),
        title: 'Welcome to ViperEdit',
        html: `
          <h1>Welcome to ViperEdit</h1>
          <p>A <b>powerful</b>, <i>modular</i> document editor with a <span style="background:rgba(109,40,217,0.15)">crystal-white Apple Glass</span> interface.</p>
          <h2>Try these</h2>
          <ul>
            <li>Click the <b>Hub</b> chip (top-left) to return to ViperHub and see your documents and templates.</li>
            <li>Press <b>Ctrl+Shift+P</b> to open the command palette.</li>
            <li>Press <b>Ctrl+F</b> to find and replace.</li>
            <li>Press <b>/</b> on a new line for slash commands.</li>
            <li>Click the image icon to change the background — uploads persist in IndexedDB.</li>
            <li>In the file menu, <b>Save settings to this document</b> records a preset that reapplies whenever you open this doc.</li>
          </ul>
          <blockquote>Everything you do — documents, wallpapers, settings — is saved in IndexedDB and persists across sessions.</blockquote>
          <p></p>`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        preset: null,
        margins: { ...MARGIN_DEFAULT }
      };
      this.all.push(d);
      this.currentId = d.id;
      Persist.saveDoc(d);
      Persist.saveCurrentId(d.id);
      return d;
    },

    ensureCurrent() {
      if (!this.all.length) return this.createWelcome();
      if (!this.current()) { this.currentId = this.all[0].id; Persist.saveCurrentId(this.currentId); }
      return this.current();
    },

    switchTo(id) {
      this.saveCurrent();
      this.currentId = id;
      Persist.saveCurrentId(id);
      Editor.load(this.current());
    },

    create(template) {
      this.saveCurrent();
      const d = {
        id: uid(),
        title: template ? (template.name === 'Blank document' ? 'Untitled document' : template.name) : 'Untitled document',
        html: template ? (template.html || '') : '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        preset: (template && template.preset) ? { ...template.preset } : null,
        margins: (template && template.margins) ? { ...template.margins } : { ...MARGIN_DEFAULT }
      };
      this.all.push(d);
      this.currentId = d.id;
      Persist.saveDoc(d);
      Persist.saveCurrentId(d.id);
      Editor.load(d);
    },

    saveCurrent() {
      const d = this.current();
      if (!d) return;
      d.title = $('#doc-title').value || 'Untitled document';
      d.html  = cleanEditorHTML();
      d.updatedAt = Date.now();
      Persist.saveDoc(d);
    },

    duplicate() {
      this.saveCurrent();
      const cur = this.current();
      if (!cur) return;
      const d = {
        id: uid(),
        title: cur.title + ' (copy)',
        html: cur.html,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        preset:  cur.preset  ? { ...cur.preset }  : null,
        margins: cur.margins ? { ...cur.margins } : { ...MARGIN_DEFAULT }
      };
      this.all.push(d);
      this.currentId = d.id;
      Persist.saveDoc(d);
      Persist.saveCurrentId(d.id);
      Editor.load(d);
    },

    remove(id) {
      const idx = this.all.findIndex(d => d.id === id);
      if (idx < 0) return;
      this.all.splice(idx, 1);
      Persist.deleteDoc(id);
      if (this.currentId === id) {
        this.currentId = this.all[0]?.id || null;
        if (this.currentId) { Persist.saveCurrentId(this.currentId); Editor.load(this.current()); }
        else { this.createWelcome(); Editor.load(this.current()); }
      }
    },

    savePresetFromCurrentSettings() {
      const d = this.current();
      if (!d) return;
      d.preset = {
        fontFamily: Settings.get('fontFamily'),
        fontSize:   Settings.get('fontSize'),
        lineHeight: Settings.get('lineHeight'),
        pageStyle:  Settings.get('pageStyle'),
        zoom:       Settings.get('zoom')
      };
      d.updatedAt = Date.now();
      Persist.saveDoc(d);
      Editor.updatePresetBadge();
    },

    clearPreset() {
      const d = this.current();
      if (!d) return;
      d.preset = null;
      d.updatedAt = Date.now();
      Persist.saveDoc(d);
      Editor.updatePresetBadge();
    },

    updateDocCount() {
      const n = this.all.length;
      const el = $('#doc-count');
      if (el) el.textContent = `${n} document${n === 1 ? '' : 's'}`;
    }
  };

  /* ============================================================
     5. Fonts
     ============================================================ */

  const Fonts = {
    load() {
      const link = $('#fonts-link');
      if (link && window.VE_buildFontsURL) link.href = window.VE_buildFontsURL();
    },
    populate() {
      const sel = $('#font-family');
      if (!sel) return;
      const F = window.VE_FONTS;
      const groupOrder = [
        ['Sans Serif', F.sans],
        ['Serif',      F.serif],
        ['Display',    F.display],
        ['Monospace',  F.mono],
        ['Handwriting', F.handwriting],
        ['System',     F.system]
      ];
      sel.innerHTML = '';
      for (const [label, list] of groupOrder) {
        const og = document.createElement('optgroup');
        og.label = label;
        for (const f of list) {
          const opt = document.createElement('option');
          opt.value = f.family;
          opt.textContent = f.name;
          opt.style.fontFamily = f.family;
          og.appendChild(opt);
        }
        sel.appendChild(og);
      }
      sel.value = Settings.get('fontFamily');
    }
  };

  /* ============================================================
     6. Command registry
     ============================================================ */

  const Commands = {
    list: [],
    byId: {},
    register(cmd) {
      this.list.push(cmd);
      this.byId[cmd.id] = cmd;
      return cmd;
    },
    run(id, ...args) {
      const c = this.byId[id];
      if (!c) return;
      try { c.run(...args); } catch (e) { console.error('Command failed:', id, e); }
    },
    search(q) {
      if (!q) return this.list.slice().sort((a,b) => (a.group||'').localeCompare(b.group||''));
      return this.list
        .map(c => ({ c, s: fuzzyScore(q, c.title) + fuzzyScore(q, c.keywords || '') * 0.5 }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map(x => x.c);
    }
  };

  /* ============================================================
     7. Core editor wiring
     ============================================================ */

  const Editor = {
    el: null,
    titleEl: null,
    saveStatus: null,

    init() {
      this.el = $('#editor');
      this.titleEl = $('#doc-title');
      this.saveStatus = $('#save-status');
      this.el.dataset.placeholder = 'Start writing…';

      try { document.execCommand('styleWithCSS', false, true); } catch {}
      try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}

      // Events
      on(this.el, 'input', () => { this.scheduleSave(); this.updateCounts(); this.checkSlash(); Pagination.schedule(); });
      on(this.el, 'keyup',  () => UI.refreshToolbar());
      on(this.el, 'mouseup', () => UI.refreshToolbar());

      // Tab / Shift+Tab indent the current block (or list item) instead of
      // moving focus out of the editor. Matches Google Docs / Word behavior.
      on(this.el, 'keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          this._indentBlock(e.shiftKey ? -1 : 1);
          this.scheduleSave();
          Pagination.schedule();
          return;
        }
        // Backspace at the start of a paper's first block — the browser's
        // default won't merge across .paper sibling wrappers, so we do it
        // manually.
        if (e.key === 'Backspace') {
          const sel = window.getSelection();
          if (!sel || !sel.isCollapsed || !sel.rangeCount) return;
          const r = sel.getRangeAt(0);
          if (r.startOffset !== 0) return;
          // Walk up to find the containing block (child of a .paper).
          let block = r.startContainer;
          if (block.nodeType === 3) block = block.parentNode;
          while (block && block.parentNode && !(block.parentNode.classList && block.parentNode.classList.contains('paper'))) {
            block = block.parentNode;
          }
          if (!block || !block.parentNode) return;
          const paper = block.parentNode;
          if (paper.firstElementChild !== block) return;
          // Also make sure the caret is truly at the start of that block.
          const probe = document.createRange();
          probe.selectNodeContents(block);
          probe.setEnd(r.startContainer, r.startOffset);
          if (probe.toString().length > 0) return;
          const prevPaper = paper.previousElementSibling;
          if (!prevPaper || !prevPaper.classList.contains('paper')) return;
          const prevLast = prevPaper.lastElementChild;
          if (!prevLast) return;
          e.preventDefault();
          // Move cursor to end of prev paper's last block, then merge.
          const tgtRange = document.createRange();
          tgtRange.selectNodeContents(prevLast);
          tgtRange.collapse(false);
          // If same tagName and both are block-ish, merge their contents.
          if (prevLast.tagName === block.tagName) {
            const mergeAtOffset = prevLast.childNodes.length;
            while (block.firstChild) prevLast.appendChild(block.firstChild);
            block.remove();
            // Collapse the caret at the merge seam.
            const sel2 = window.getSelection();
            sel2.removeAllRanges();
            const mergeRange = document.createRange();
            const mergeTarget = prevLast.childNodes[mergeAtOffset] || prevLast;
            if (mergeTarget === prevLast) {
              mergeRange.selectNodeContents(prevLast);
              mergeRange.collapse(false);
            } else {
              mergeRange.setStart(mergeTarget, 0);
              mergeRange.collapse(true);
            }
            sel2.addRange(mergeRange);
          } else {
            // Different tag types: move block after prevLast (same paper) so
            // the user can fall back to another Backspace inside the paper.
            prevPaper.appendChild(block);
            const sel2 = window.getSelection();
            sel2.removeAllRanges();
            sel2.addRange(tgtRange);
          }
          this.scheduleSave();
          Pagination.schedule();
        }
      });
      on(document, 'selectionchange', () => {
        if (document.activeElement === this.el) UI.refreshToolbar();
      });

      on(this.titleEl, 'input', () => this.scheduleSave());
      on(this.titleEl, 'keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.el.focus(); }
      });

      // Paste sanitation + images
      on(this.el, 'paste', (e) => this.handlePaste(e));

      // Drag-and-drop images
      on(this.el, 'dragover', (e) => {
        if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
      });
      on(this.el, 'drop', (e) => {
        const files = e.dataTransfer?.files;
        if (!files || !files.length) return;
        for (const f of files) {
          if (!f.type.startsWith('image/')) continue;
          e.preventDefault();
          const r = new FileReader();
          r.onload = (ev) => this.insertHTML(`<img src="${ev.target.result}" alt="" />`);
          r.readAsDataURL(f);
        }
      });

      // Checklist click
      on(this.el, 'click', (e) => {
        const li = e.target.closest('ul[data-type="checklist"] > li');
        if (!li) return;
        const rect = li.getBoundingClientRect();
        if (e.clientX - rect.left <= 24) {
          li.classList.toggle('checked');
          this.scheduleSave();
        }
      });
    },

    load(doc) {
      if (!doc) return;
      this.titleEl.value = doc.title || 'Untitled document';
      // Wrap the document body in a single .paper; pagination will split
      // it across as many papers as the content needs.
      const inner = doc.html || '<p><br></p>';
      this.el.innerHTML = `<div class="paper">${inner}</div>`;
      // Apply the document's per-side page margins before pagination
      // measures anything.
      Margins.apply(doc);
      this.updateCounts();
      // Apply the document's preset, if any.
      if (doc.preset && Object.keys(doc.preset).length) {
        Settings.setMany(doc.preset);
      }
      UI.refreshToolbar();
      Docs.updateDocCount();
      $('#doc-name-chip').textContent = doc.title || 'Untitled';
      this.updatePresetBadge();
      Pagination.schedule();
    },

    updatePresetBadge() {
      const d = Docs.current();
      const badge = $('#preset-badge');
      if (!badge) return;
      const hasPreset = !!(d && d.preset && Object.keys(d.preset).length);
      badge.hidden = !hasPreset;
    },

    _saveTimer: null,
    scheduleSave() {
      if (this.saveStatus) {
        this.saveStatus.textContent = 'Saving…';
        this.saveStatus.classList.add('saving');
      }
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => {
        Docs.saveCurrent();
        if (this.saveStatus) {
          this.saveStatus.textContent = 'Saved';
          this.saveStatus.classList.remove('saving');
        }
        $('#doc-name-chip').textContent = this.titleEl.value || 'Untitled';
      }, Settings.get('autosaveMs'));
    },

    updateCounts() {
      const text = this.el.innerText || '';
      const chars = text.length;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      const mins  = Math.max(1, Math.ceil(words / 220));
      $('#word-count').textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'}`;
      $('#char-count').textContent = `${chars.toLocaleString()} character${chars === 1 ? '' : 's'}`;
      $('#read-time').textContent = `${mins} min read`;
    },

    exec(cmd, value = null) {
      this.el.focus();
      document.execCommand(cmd, false, value);
      UI.refreshToolbar();
      this.scheduleSave();
      this.updateCounts();
    },

    // Tab = first-line indent on the paragraph containing the caret.
    // Uses CSS text-indent so only the first line shifts right — matches
    // Google Docs' Tab behavior. Inside a list item we defer to the
    // native list-nesting indent. We explicitly skip .paper wrappers so
    // the block-walker doesn't end up shifting the whole page.
    _indentBlock(direction) {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const r = sel.getRangeAt(0);
      let block = r.startContainer;
      if (block.nodeType === 3) block = block.parentNode;
      // Only true text blocks are indentable. Crucially, .paper and the
      // editor root are NOT in this set, even though they're DIVs — we
      // don't want Tab to shift the whole page.
      const TEXT_BLOCKS = /^(?:P|H[1-6]|LI|PRE|BLOCKQUOTE)$/i;
      while (block && block !== this.el) {
        if (block.tagName && TEXT_BLOCKS.test(block.tagName)) break;
        if (block.classList && block.classList.contains('paper')) return;
        block = block.parentNode;
      }
      if (!block || block === this.el) return;
      if (block.tagName === 'LI') {
        document.execCommand(direction > 0 ? 'indent' : 'outdent');
        return;
      }
      const step = 40;   // 40 px = roughly one Google-Docs tab stop
      const current = parseFloat(block.style.textIndent) || 0;
      const next = Math.max(0, current + direction * step);
      block.style.textIndent = next ? next + 'px' : '';
      if (!block.getAttribute('style')) block.removeAttribute('style');
    },

    insertHTML(html) {
      this.el.focus();
      document.execCommand('insertHTML', false, html);
      this.scheduleSave();
      this.updateCounts();
    },

    handlePaste(e) {
      const clip = e.clipboardData;
      if (!clip) return;
      const items = clip.items || [];
      for (const it of items) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          e.preventDefault();
          const r = new FileReader();
          r.onload = (ev) => this.insertHTML(`<img src="${ev.target.result}" alt="" />`);
          r.readAsDataURL(it.getAsFile());
          return;
        }
      }
      const html = clip.getData('text/html');
      const text = clip.getData('text/plain');
      if (html) {
        e.preventDefault();
        this.insertHTML(sanitizeHTML(html));
      } else if (text) {
        e.preventDefault();
        let out = esc(text).replace(/\n/g, '<br>');
        if (Settings.get('autoLinks')) {
          out = out.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`);
        }
        this.insertHTML(out);
      }
    },

    // -------- Slash command detection ----------
    checkSlash() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) { Slash.close(); return; }
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType !== 3) { Slash.close(); return; }
      const text = node.textContent.slice(0, range.startOffset);
      const m = /\/([a-zA-Z]{0,20})$/.exec(text);
      if (m) {
        const before = text[text.length - m[0].length - 1];
        if (!before || /\s/.test(before)) { Slash.open(m[1]); return; }
      }
      Slash.close();
    }
  };

  /* ============================================================
     Sanitizer (used for paste + imported HTML)
     ============================================================ */

  function sanitizeHTML(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const allowed = new Set([
      'A','B','STRONG','I','EM','U','S','STRIKE','BR','P','DIV','SPAN','FONT',
      'H1','H2','H3','H4','H5','H6','UL','OL','LI','BLOCKQUOTE','PRE','CODE',
      'IMG','HR','TABLE','THEAD','TBODY','TR','TH','TD','SUB','SUP'
    ]);
    const w = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT);
    const rm = [];
    while (w.nextNode()) {
      const el = w.currentNode;
      if (!allowed.has(el.tagName)) { rm.push(el); continue; }
      [...el.attributes].forEach((a) => {
        const n = a.name.toLowerCase();
        const v = (a.value || '').trim();
        if (n.startsWith('on')) el.removeAttribute(a.name);
        if ((n === 'href' || n === 'src') && /^javascript:/i.test(v)) el.removeAttribute(a.name);
      });
    }
    rm.forEach((el) => {
      while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
      el.remove();
    });
    return tpl.innerHTML;
  }

  /* ============================================================
     Color menu — shared popup for text color + highlight buttons.
     Owns preset swatches, "None", and a "Custom color…" entry that opens
     the browser's native picker via a hidden <input type="color">.
     ============================================================ */

  const COLOR_PRESETS = [
    // Row 1 — common text blacks / greys
    '#000000','#434343','#666666','#999999','#b7b7b7','#cccccc','#d9d9d9','#efefef','#f3f3f3','#ffffff',
    // Row 2 — warm highlights / brights
    '#c00000','#e06666','#f6b26b','#ffd966','#93c47d','#76a5af','#6fa8dc','#8e7cc3','#c27ba0','#980000',
    // Row 3 — deeper saturations
    '#ff0000','#ff9900','#ffff00','#00ff00','#00ffff','#4a86e8','#0000ff','#9900ff','#ff00ff','#741b47',
    // Row 4 — mutes
    '#5b0f00','#783f04','#7f6000','#274e13','#0c343d','#1c4587','#073763','#20124d','#4c1130','#000000'
  ];

  const ColorMenu = {
    _triggers: [],
    _currentCmd: null,
    _currentTrigger: null,
    _savedRange: null,

    init() {
      this._triggers = $$('.tb-colordd');
      const popup = $('#color-popup');
      if (!popup) return;

      // Build preset grid once.
      const grid = $('#cp-grid');
      grid.innerHTML = '';
      for (const c of COLOR_PRESETS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cp-swatch';
        b.style.background = c;
        b.dataset.color = c;
        b.title = c;
        grid.appendChild(b);
      }

      // Clicking a trigger opens the popup anchored under it and
      // remembers which command the popup is for.
      this._triggers.forEach((trigger) => {
        const btn = trigger.querySelector('.tb-colordd-btn');
        // preventDefault on mousedown stops the button from stealing focus
        // from the editor — keeps the text selection intact so execCommand
        // applies to the right range. We also save the range as a safety
        // net in case another handler still collapses it.
        on(btn, 'mousedown', (e) => {
          e.preventDefault();
          this._saveSelection();
        });
        on(btn, 'click', (e) => {
          e.stopPropagation();
          this.open(trigger, trigger.dataset.cmd);
        });
      });

      // preventDefault on the popup itself so any mousedown inside it
      // (swatches, None, Custom…) also doesn't steal editor focus.
      on(popup, 'mousedown', (e) => e.preventDefault());

      // Swatch selection
      on(grid, 'click', (e) => {
        const s = e.target.closest('.cp-swatch');
        if (!s) return;
        this._apply(this._currentCmd, s.dataset.color);
        this.close();
      });

      // "None" button — unset the color for the current command.
      on($('.cp-none', popup), 'click', () => {
        this._apply(this._currentCmd, null);
        this.close();
      });

      // Label the None button contextually ("No highlight" / "Automatic").
      // We rewrite its text every open, so just create the element here.

      // "Custom color…" — open the hidden native picker.
      const hidden = $('#cp-hidden');
      on($('.cp-custom', popup), 'click', () => {
        // Clicking the hidden input opens the OS picker. The `input` event
        // fires once the user commits a color.
        hidden.click();
      });
      on(hidden, 'input', () => {
        this._apply(this._currentCmd, hidden.value);
        this.close();
      });
      on(hidden, 'change', () => {
        this._apply(this._currentCmd, hidden.value);
        this.close();
      });

      // Close when clicking outside or pressing Escape.
      on(document, 'mousedown', (e) => {
        if (popup.hidden) return;
        if (popup.contains(e.target)) return;
        if (this._currentTrigger && this._currentTrigger.contains(e.target)) return;
        this.close();
      });
      on(document, 'keydown', (e) => {
        if (e.key === 'Escape' && !popup.hidden) this.close();
      });
    },

    open(trigger, cmd) {
      const popup = $('#color-popup');
      if (!popup) return;
      this._currentCmd = cmd;
      this._currentTrigger = trigger;
      $('.cp-none', popup).textContent = cmd === 'hiliteColor' ? 'No highlight' : 'Automatic';

      // Position popup just below the trigger (fixed coords).
      popup.hidden = false;
      const r = trigger.getBoundingClientRect();
      popup.style.top = (r.bottom + 4) + 'px';
      popup.style.left = Math.min(
        r.left,
        window.innerWidth - popup.offsetWidth - 8
      ) + 'px';
    },

    close() {
      const popup = $('#color-popup');
      if (popup) popup.hidden = true;
      this._currentCmd = null;
      this._currentTrigger = null;
    },

    _saveSelection() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) { this._savedRange = null; return; }
      const r = sel.getRangeAt(0);
      if (!Editor.el.contains(r.startContainer)) { this._savedRange = null; return; }
      this._savedRange = r.cloneRange();
    },

    _restoreSelection() {
      if (!this._savedRange) return false;
      Editor.el.focus();
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(this._savedRange);
      return true;
    },

    _apply(cmd, value) {
      // 1. Make sure the editor is focused and selection is inside it.
      //    preventDefault on mousedown usually keeps the live selection
      //    intact, but savedRange is a fallback if something else stole
      //    focus.
      let sel = window.getSelection();
      const selInEditor = sel && sel.rangeCount &&
        Editor.el.contains(sel.getRangeAt(0).startContainer);
      if (!selInEditor) {
        Editor.el.focus();
        if (this._savedRange) {
          sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(this._savedRange);
        }
      }
      sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const r = sel.getRangeAt(0);

      // 2. Collapsed cursor (no text selected) — insert a styled span
      //    seeded with a zero-width placeholder and move the caret
      //    inside it, so the user's next keystroke types in the
      //    chosen color. This is how Google Docs' "click a color
      //    first, then start typing" flow works.
      if (r.collapsed && value !== null) {
        this._insertPendingColorSpan(cmd, value);
        this._paintTriggerBar(cmd, value);
        UI.refreshToolbar();
        Editor.scheduleSave();
        Editor.updateCounts();
        Pagination.schedule();
        return;
      }

      // 3. "None" with a collapsed cursor: exit the colored span the
      //    cursor is currently inside (if any) by moving the caret to
      //    just after that span, so the next keystroke is uncolored.
      if (r.collapsed && value === null) {
        this._exitStyleSpanAtCaret(cmd);
        this._paintTriggerBar(cmd, value);
        UI.refreshToolbar();
        Editor.scheduleSave();
        Editor.updateCounts();
        Pagination.schedule();
        return;
      }

      // 4. Non-empty selection — apply via execCommand as before.
      if (value === null) {
        if (cmd === 'hiliteColor') {
          document.execCommand('hiliteColor', false, 'transparent');
          document.execCommand('backColor',   false, 'transparent');
          this._stripInlineStyleInSelection('backgroundColor');
        } else {
          document.execCommand('foreColor',  false, '#000000');
          this._stripInlineStyleInSelection('color');
        }
      } else {
        document.execCommand(cmd, false, value);
      }
      this._paintTriggerBar(cmd, value);
      UI.refreshToolbar();
      Editor.scheduleSave();
      Editor.updateCounts();
      Pagination.schedule();
    },

    _paintTriggerBar(cmd, value) {
      if (!this._currentTrigger) return;
      const bar = this._currentTrigger.querySelector('.tb-colordd-bar');
      if (!bar) return;
      bar.style.background =
        value === null
          ? (cmd === 'hiliteColor' ? 'transparent' : '#000000')
          : value;
    },

    // Insert <span style="color:X">​</span> (or background-color for
    // hiliteColor) at the caret, and move the caret inside the span so
    // typing inherits the style. The zero-width space is a "landing
    // character" — Chrome won't place a caret inside a truly empty
    // inline element.
    _insertPendingColorSpan(cmd, value) {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const r = sel.getRangeAt(0);
      const span = document.createElement('span');
      if (cmd === 'foreColor')   span.style.color = value;
      if (cmd === 'hiliteColor') span.style.backgroundColor = value;
      span.appendChild(document.createTextNode('​'));
      r.deleteContents();
      r.insertNode(span);
      const caret = document.createRange();
      caret.setStart(span.firstChild, 1);
      caret.collapse(true);
      sel.removeAllRanges();
      sel.addRange(caret);
    },

    // Walk up from the caret looking for an ancestor <span> carrying the
    // relevant inline style (color for foreColor, background-color for
    // hiliteColor). If found, move the caret to immediately after that
    // span so subsequent keystrokes land outside it, uncolored. Any
    // trailing whitespace we create isn't visible and is cleaned up on
    // the next edit.
    _exitStyleSpanAtCaret(cmd) {
      const prop = cmd === 'hiliteColor' ? 'backgroundColor' : 'color';
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      let node = sel.getRangeAt(0).startContainer;
      if (node.nodeType === 3) node = node.parentNode;
      let styled = null;
      while (node && node !== Editor.el) {
        if (node.tagName === 'SPAN' && node.style && node.style[prop]) {
          styled = node; break;
        }
        node = node.parentNode;
      }
      if (!styled) return;
      // Insert a zero-width space AFTER the styled span so the caret has
      // a landing spot with no inherited style.
      const afterNode = document.createTextNode('​');
      if (styled.nextSibling) styled.parentNode.insertBefore(afterNode, styled.nextSibling);
      else styled.parentNode.appendChild(afterNode);
      const caret = document.createRange();
      caret.setStart(afterNode, 1);
      caret.collapse(true);
      sel.removeAllRanges();
      sel.addRange(caret);
    },

    // Walk all elements intersected by the current selection and remove
    // the given inline CSS property. Used for "None" so residual
    // background-color or color styles don't override our reset.
    _stripInlineStyleInSelection(cssProp) {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const root = range.commonAncestorContainer;
      const startNode = root.nodeType === 1 ? root : root.parentNode;
      if (!startNode) return;
      const walker = document.createTreeWalker(startNode, NodeFilter.SHOW_ELEMENT);
      const victims = [];
      let node = walker.currentNode;
      while (node) {
        if (node !== startNode && range.intersectsNode(node)) {
          if (node.style && node.style[cssProp]) victims.push(node);
        }
        node = walker.nextNode();
      }
      // Also check startNode itself.
      if (startNode.style && startNode.style[cssProp] && range.intersectsNode(startNode)) {
        victims.push(startNode);
      }
      for (const v of victims) {
        v.style[cssProp] = '';
        if (!v.getAttribute('style')) v.removeAttribute('style');
      }
    }
  };

  /* ============================================================
     8. UI — toolbar, menus, theme, counts
     ============================================================ */

  const UI = {
    stateCmds: [
      'bold','italic','underline','strikeThrough','superscript','subscript',
      'insertUnorderedList','insertOrderedList',
      'justifyLeft','justifyCenter','justifyRight','justifyFull'
    ],

    init() {
      // Toolbar buttons with data-cmd
      $$('.tb-btn[data-cmd]').forEach((btn) => {
        on(btn, 'mousedown', (e) => e.preventDefault());
        on(btn, 'click', () => Editor.exec(btn.dataset.cmd));
      });

      // Color controls — dropdown with "None", a preset palette, and a
      // Custom… option. See ColorMenu (initialised below) for logic.
      ColorMenu.init();

      // Block style
      on($('#block-style'), 'change', (e) => Editor.exec('formatBlock', `<${e.target.value.toUpperCase()}>`));

      // Font family
      on($('#font-family'), 'change', (e) => {
        Editor.exec('fontName', e.target.value);
      });

      // Font size picker maps to execCommand with inline style fallback
      on($('#font-size'), 'change', (e) => {
        const pt = parseInt(e.target.value, 10);
        // fontSize execCommand uses 1..7 scale; instead wrap in span for fidelity
        Editor.el.focus();
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || sel.isCollapsed) {
          document.execCommand('fontSize', false, 4);
          // Walk back and set inline size on resulting <font> tags
          $$('font[size="4"]', Editor.el).forEach((f) => {
            f.removeAttribute('size');
            f.style.fontSize = pt + 'pt';
          });
        } else {
          document.execCommand('fontSize', false, 4);
          $$('font[size="4"]', Editor.el).forEach((f) => {
            f.removeAttribute('size');
            f.style.fontSize = pt + 'pt';
          });
        }
        Editor.scheduleSave();
        Editor.updateCounts();
      });

      // Action buttons
      $$('.tb-btn[data-action]').forEach((btn) => {
        on(btn, 'mousedown', (e) => e.preventDefault());
        on(btn, 'click', (e) => this.runAction(btn.dataset.action, btn, e));
      });

      // Theme
      on($('#btn-theme'), 'click', () => toggleTheme());

      // File menu
      const fileMenu = $('#file-menu');
      const btnFile = $('#btn-file');
      on(btnFile, 'click', (e) => { e.stopPropagation(); fileMenu.hidden = !fileMenu.hidden; });
      on(document, 'click', (e) => {
        if (!fileMenu.contains(e.target) && e.target !== btnFile) fileMenu.hidden = true;
      });
      on(fileMenu, 'click', (e) => {
        const b = e.target.closest('button[data-action]');
        if (!b) return;
        fileMenu.hidden = true;
        this.runFileAction(b.dataset.action);
      });

      // Top bar buttons
      on($('#btn-palette'),    'click', () => Palette.open());
      on($('#btn-find'),       'click', () => Find.toggle(true));
      on($('#btn-background'), 'click', () => Background.open());
      on($('#btn-focus'),      'click', () => this.toggleFocus());
      on($('#btn-settings'),   'click', () => SettingsUI.open());
      // Back-to-hub chip is wired by App.init() separately; no-op here.
    },

    runAction(action, btn, evt) {
      switch (action) {
        case 'link':      this.insertLink(); break;
        case 'image':     this.insertImage(); break;
        case 'hr':        Editor.exec('insertHorizontalRule'); break;
        case 'table':     TablePicker.open(btn); break;
        case 'checklist': this.toggleChecklist(); break;
        case 'zoom-in':   Settings.set('zoom', Math.min(200, Settings.get('zoom') + 10)); break;
        case 'zoom-out':  Settings.set('zoom', Math.max(50, Settings.get('zoom') - 10)); break;
      }
    },

    runFileAction(action) {
      switch (action) {
        case 'hub':           App.showHub(); break;
        case 'new':           App.newBlank(); break;
        case 'open':          $('#file-input').click(); break;
        case 'download-html': Export.download('html'); break;
        case 'download-md':   Export.download('md'); break;
        case 'download-txt':  Export.download('txt'); break;
        case 'print':         window.print(); break;
        case 'page-setup':    PageSetup.open(); break;
        case 'save-preset':   Docs.savePresetFromCurrentSettings(); break;
        case 'clear-preset':  Docs.clearPreset(); break;
        case 'duplicate':     App.duplicate(); break;
        case 'rename':        { const n = prompt('New name:', Editor.titleEl.value); if (n) { Editor.titleEl.value = n; Editor.scheduleSave(); } break; }
        case 'delete':
          if (confirm('Delete this document?')) { Docs.remove(Docs.currentId); }
          break;
      }
    },

    insertLink() {
      const sel = window.getSelection();
      const hasSel = sel && sel.toString().length > 0;
      const url = prompt('Enter URL:', 'https://');
      if (!url) return;
      if (hasSel) Editor.exec('createLink', url);
      else {
        const label = prompt('Link text:', url) || url;
        Editor.insertHTML(`<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`);
      }
    },

    insertImage() {
      const url = prompt('Image URL (or drag / paste an image into the page):', 'https://');
      if (!url) return;
      Editor.insertHTML(`<img src="${esc(url)}" alt="" />`);
    },

    toggleChecklist() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      // Find nearest block
      let block = range.startContainer;
      if (block.nodeType === 3) block = block.parentElement;
      while (block && block !== Editor.el && !/^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(block.tagName)) block = block.parentElement;
      if (!block || block === Editor.el) {
        Editor.insertHTML('<ul data-type="checklist"><li>Task</li></ul>');
        return;
      }
      // If already in a checklist, unwrap
      const li = block.closest && block.closest('ul[data-type="checklist"] > li');
      if (li) {
        const ul = li.parentElement;
        const p = document.createElement('p');
        p.innerHTML = li.innerHTML || '<br>';
        ul.parentElement.insertBefore(p, ul);
        li.remove();
        if (!ul.children.length) ul.remove();
        Editor.scheduleSave();
        return;
      }
      // Otherwise convert this block into a checklist item
      const ul = document.createElement('ul');
      ul.setAttribute('data-type', 'checklist');
      const newLi = document.createElement('li');
      newLi.innerHTML = block.innerHTML || 'Task';
      ul.appendChild(newLi);
      block.parentElement.replaceChild(ul, block);
      Editor.scheduleSave();
    },

    toggleFocus() {
      document.body.classList.toggle('focus-mode');
      $('#btn-focus').classList.toggle('active', document.body.classList.contains('focus-mode'));
    },

    refreshToolbar() {
      for (const cmd of this.stateCmds) {
        const btn = document.querySelector(`.tb-btn[data-cmd="${cmd}"]`);
        if (!btn) continue;
        let active = false;
        try { active = document.queryCommandState(cmd); } catch {}
        btn.classList.toggle('active', !!active);
      }
      try {
        const block = (document.queryCommandValue('formatBlock') || '').toLowerCase();
        const sel = $('#block-style');
        const valid = ['h1','h2','h3','h4','blockquote','pre','p'];
        if (sel && valid.includes(block)) sel.value = block;
        else if (sel) sel.value = 'p';
      } catch {}
    }
  };

  /* ============================================================
     9. Background manager
     ============================================================ */

  const BG_PRESETS = [
    { id: 'none', label: 'None' },
    { id: 'viper',   css: 'radial-gradient(1200px 700px at 15% 10%, #3b1b7a 0%, transparent 60%), radial-gradient(1000px 800px at 85% 90%, #0e6b8c 0%, transparent 55%), radial-gradient(900px 700px at 70% 20%, #6b21a8 0%, transparent 55%), linear-gradient(135deg, #0a0a18 0%, #140a1c 50%, #0a0a18 100%)' },
    { id: 'sequoia', css: 'radial-gradient(1200px 800px at 10% 10%, #ff6aa2 0%, transparent 60%), radial-gradient(1200px 900px at 90% 90%, #6a5cff 0%, transparent 60%), linear-gradient(135deg, #1a0b2e 0%, #2b1055 50%, #0f0c2e 100%)' },
    { id: 'aurora',  css: 'radial-gradient(900px 700px at 20% 20%, #00d4aa 0%, transparent 55%), radial-gradient(900px 700px at 80% 80%, #7c3aed 0%, transparent 55%), radial-gradient(700px 500px at 60% 30%, #06b6d4 0%, transparent 50%), linear-gradient(160deg, #031124 0%, #0a1f3a 100%)' },
    { id: 'sunset',  css: 'radial-gradient(1000px 700px at 20% 80%, #ff5f6d 0%, transparent 55%), radial-gradient(900px 700px at 80% 20%, #ffc371 0%, transparent 50%), linear-gradient(135deg, #2b0b30 0%, #4b1450 50%, #2b0b30 100%)' },
    { id: 'ocean',   css: 'radial-gradient(1000px 800px at 20% 10%, #0891b2 0%, transparent 55%), radial-gradient(900px 700px at 80% 90%, #1e3a8a 0%, transparent 55%), linear-gradient(160deg, #020617 0%, #0c1e3f 100%)' },
    { id: 'rose',    css: 'radial-gradient(900px 700px at 20% 10%, #fb7185 0%, transparent 55%), radial-gradient(900px 700px at 80% 90%, #a855f7 0%, transparent 55%), linear-gradient(135deg, #1b0a20 0%, #2b0b30 100%)' },
    { id: 'forest',  css: 'radial-gradient(900px 700px at 20% 10%, #065f46 0%, transparent 55%), radial-gradient(900px 700px at 80% 80%, #166534 0%, transparent 55%), linear-gradient(160deg, #041210 0%, #0b1f1a 100%)' },
    { id: 'mono',    css: 'radial-gradient(900px 700px at 20% 10%, #3f3f46 0%, transparent 55%), radial-gradient(900px 700px at 80% 80%, #71717a 0%, transparent 45%), linear-gradient(160deg, #0a0a0a 0%, #18181b 100%)' },
    { id: 'sunrise', css: 'radial-gradient(1000px 800px at 50% 100%, #fb923c 0%, transparent 55%), radial-gradient(900px 700px at 80% 10%, #fbbf24 0%, transparent 50%), linear-gradient(160deg, #2b0b4b 0%, #4b1450 100%)' }
  ];

  const Background = {
    apply(cfg) {
      const layer = $('#bg-layer');
      if (!layer) return;
      if (!cfg || cfg.type === 'none') {
        layer.style.backgroundImage = '';     // falls back to default CSS gradient
      } else if (cfg.type === 'preset') {
        const p = BG_PRESETS.find(x => x.id === cfg.id);
        layer.style.backgroundImage = p?.css || '';
      } else if (cfg.type === 'image') {
        layer.style.backgroundImage = `url('${cfg.data}')`;
      }
      Persist.cache.background = cfg || null;
      Persist.saveBackground(cfg || null);
    },
    loadSaved() {
      const cfg = Persist.cache.background || { type: 'preset', id: 'viper' };
      this.apply(cfg);
    },
    open() { $('#overlay-background').hidden = false; this.render(); },
    close() { $('#overlay-background').hidden = true; },
    render() {
      const grid = $('#bg-presets');
      const saved = Persist.cache.background || { type: 'preset', id: 'viper' };
      grid.innerHTML = '';
      for (const p of BG_PRESETS) {
        const card = document.createElement('div');
        card.className = 'bg-card' + (p.id === 'none' ? ' bg-none' : '') +
          (saved.type === 'preset' && saved.id === p.id ? ' active' :
           (saved.type === 'none' && p.id === 'none') ? ' active' : '');
        if (p.css) card.style.backgroundImage = p.css;
        if (p.id === 'none') card.textContent = 'None';
        on(card, 'click', () => {
          if (p.id === 'none') this.apply({ type: 'none' });
          else this.apply({ type: 'preset', id: p.id });
          this.render();
        });
        grid.appendChild(card);
      }
    }
  };

  /* ============================================================
     10. Command palette
     ============================================================ */

  const Palette = {
    active: 0,
    results: [],
    init() {
      on($('#btn-settings-close'), 'click', () => SettingsUI.close());
      on($('#btn-bg-close'),       'click', () => Background.close());

      on($('#palette-input'), 'input', () => this.render());
      on($('#palette-input'), 'keydown', (e) => this.keys(e));
      on($('#overlay-palette'), 'click', (e) => {
        if (e.target === $('#overlay-palette')) this.close();
      });
      on($('#overlay-settings'), 'click', (e) => {
        if (e.target === $('#overlay-settings')) SettingsUI.close();
      });
      on($('#overlay-background'), 'click', (e) => {
        if (e.target === $('#overlay-background')) Background.close();
      });
    },
    open() {
      Slash.close();
      $('#overlay-palette').hidden = false;
      const inp = $('#palette-input');
      inp.value = '';
      inp.focus();
      this.active = 0;
      this.render();
    },
    close() { $('#overlay-palette').hidden = true; Editor.el.focus(); },
    render() {
      const q = $('#palette-input').value.trim();
      this.results = Commands.search(q).slice(0, 60);
      const list = $('#palette-list');
      list.innerHTML = '';
      if (!this.results.length) {
        list.innerHTML = '<div class="palette-item"><span class="pi-icon">∅</span><span class="pi-title">No matches</span></div>';
        return;
      }
      this.active = Math.min(this.active, this.results.length - 1);
      this.results.forEach((c, i) => {
        const row = document.createElement('div');
        row.className = 'palette-item' + (i === this.active ? ' active' : '');
        row.innerHTML = `
          <span class="pi-icon">${c.icon || '•'}</span>
          <span class="pi-title">${esc(c.title)}</span>
          <span class="pi-group">${esc(c.group || '')}</span>
          ${c.shortcut ? `<span class="pi-shortcut">${c.shortcut.split('+').map(k => `<span>${esc(k)}</span>`).join('')}</span>` : ''}
        `;
        on(row, 'mouseenter', () => { this.active = i; this.highlight(); });
        on(row, 'click', () => this.run(i));
        list.appendChild(row);
      });
    },
    highlight() {
      $$('.palette-item', $('#palette-list')).forEach((el, i) => el.classList.toggle('active', i === this.active));
      const el = $('#palette-list').children[this.active];
      if (el) el.scrollIntoView({ block: 'nearest' });
    },
    keys(e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.active = Math.min(this.results.length - 1, this.active + 1); this.highlight(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.active = Math.max(0, this.active - 1); this.highlight(); }
      else if (e.key === 'Enter')   { e.preventDefault(); this.run(this.active); }
      else if (e.key === 'Escape')  { e.preventDefault(); this.close(); }
    },
    run(i) {
      const c = this.results[i];
      if (!c) return;
      this.close();
      c.run();
    }
  };

  /* ============================================================
     11. Settings panel
     ============================================================ */

  const SETTING_ROWS = [
    { key: 'pageStyle', title: 'Page style', desc: 'Paper, sepia, glass, or dark canvas',
      type: 'select',
      options: [['paper','Paper'], ['sepia','Sepia'], ['glass','Glass (translucent)'], ['dark','Dark']]
    },
    { key: 'fontFamily', title: 'Default font', desc: 'Applied to the whole page',
      type: 'font-select'
    },
    { key: 'fontSize', title: 'Default font size', desc: 'Points',
      type: 'number', min: 8, max: 48
    },
    { key: 'lineHeight', title: 'Line height', desc: 'Vertical spacing',
      type: 'select',
      options: [[1.2,'Compact (1.2)'], [1.4,'1.4'], [1.55,'Comfortable (1.55)'], [1.75,'Relaxed (1.75)'], [2,'Double (2.0)']]
    },
    { key: 'zoom', title: 'Zoom', desc: 'Page scale',
      type: 'number', min: 50, max: 200, step: 10
    },
    { key: 'spellcheck', title: 'Spellcheck', desc: 'Native browser spellcheck in the editor',
      type: 'toggle'
    },
    { key: 'smartQuotes', title: 'Smart quotes', desc: 'Convert straight quotes to curly as you type',
      type: 'toggle'
    },
    { key: 'autoLinks', title: 'Auto-link URLs', desc: 'Make pasted URLs clickable',
      type: 'toggle'
    },
    { key: 'autosaveMs', title: 'Autosave delay', desc: 'Debounce for autosaving (ms)',
      type: 'number', min: 100, max: 5000, step: 100
    }
  ];

  /* ============================================================
     Page Setup — per-document margins UI (File → Page setup…).
     Streamlined: four inputs (Top / Bottom / Left / Right) in inches or
     centimetres, three preset buttons (Narrow / Normal / Wide), a reset,
     and an apply. Google-Docs-default is Normal (1 in all sides).
     ============================================================ */
  const PageSetup = {
    // 'in' or 'cm' — remembered for the session only.
    _unit: 'in',
    _draft: null,   // working copy while the modal is open

    init() {
      on($('#btn-page-setup-close'), 'click', () => this.close());
      on($('#overlay-page-setup'), 'click', (e) => {
        if (e.target === $('#overlay-page-setup')) this.close();
      });
      on($('#btn-ps-default'), 'click', () => this.loadPreset('normal'));
      on($('#btn-ps-apply'),   'click', () => this.apply());
      on($('#ps-unit'), 'change', (e) => { this._unit = e.target.value; this.render(); });
      $$('[data-ps-preset]').forEach((btn) =>
        on(btn, 'click', () => this.loadPreset(btn.dataset.psPreset)));
      ['ps-top','ps-bottom','ps-left','ps-right'].forEach((id) => {
        on($('#' + id), 'input', (e) => {
          const key = id.slice(3);
          const raw = parseFloat(e.target.value);
          if (!Number.isFinite(raw)) return;
          this._draft[key] = this._unit === 'cm' ? raw / 2.54 : raw;
        });
      });
    },

    open() {
      const doc = Docs.current();
      this._draft = Margins.forDoc(doc);
      $('#overlay-page-setup').hidden = false;
      $('#ps-unit').value = this._unit;
      this.render();
      setTimeout(() => $('#ps-top').focus(), 30);
    },
    close() {
      $('#overlay-page-setup').hidden = true;
      this._draft = null;
      if (Editor && Editor.el) Editor.el.focus();
    },
    loadPreset(name) {
      const p = MARGIN_PRESETS[name] || MARGIN_PRESETS.normal;
      this._draft = { ...p };
      this.render();
    },
    render() {
      if (!this._draft) return;
      const toDisplay = (v) => this._unit === 'cm' ? (v * 2.54).toFixed(2) : v.toFixed(2);
      $('#ps-top').value    = toDisplay(this._draft.top);
      $('#ps-bottom').value = toDisplay(this._draft.bottom);
      $('#ps-left').value   = toDisplay(this._draft.left);
      $('#ps-right').value  = toDisplay(this._draft.right);
    },
    apply() {
      if (!this._draft) return;
      Margins.setForCurrent(this._draft);
      this.close();
    }
  };

  const SettingsUI = {
    init() {
      on($('#settings-search'), 'input', () => this.render());
    },
    open() {
      $('#overlay-settings').hidden = false;
      const s = $('#settings-search');
      s.value = '';
      s.focus();
      this.render();
    },
    close() { $('#overlay-settings').hidden = true; Editor.el.focus(); },
    render() {
      const q = $('#settings-search').value.trim().toLowerCase();
      const list = $('#settings-list');
      list.innerHTML = '';

      // ---- Regular settings ----
      const filtered = SETTING_ROWS.filter(r => !q || (r.title + ' ' + r.desc + ' ' + r.key).toLowerCase().includes(q));
      if (filtered.length) {
        const head = document.createElement('div');
        head.className = 'setting-section-title';
        head.textContent = 'General';
        list.appendChild(head);
        for (const row of filtered) list.appendChild(this.renderRow(row));
      }

      // ---- Shortcuts (one row per registered command) ----
      const overrides = Settings.get('shortcuts') || {};
      const cmds = Commands.list
        .slice()
        .filter(c => {
          // Only include "runnable" commands, not pure filler. Everything registered
          // currently qualifies, but hide font.* and bg.* since there are tons.
          if (c.id.startsWith('font.') || c.id.startsWith('bg.') || c.id.startsWith('tpl.')) return false;
          if (!q) return true;
          return (c.title + ' ' + (c.group || '') + ' ' + (c.keywords || '')).toLowerCase().includes(q);
        })
        .sort((a, b) => (a.group || '').localeCompare(b.group || '') || a.title.localeCompare(b.title));

      if (cmds.length) {
        const head = document.createElement('div');
        head.className = 'setting-section-title';
        head.textContent = 'Keyboard shortcuts';
        list.appendChild(head);

        const hint = document.createElement('div');
        hint.className = 'setting-subhint';
        hint.textContent = 'Click a shortcut to record a new key combination. Esc cancels, Backspace clears.';
        list.appendChild(hint);

        for (const cmd of cmds) list.appendChild(this.renderShortcutRow(cmd, overrides));
      }

      if (!filtered.length && !cmds.length) {
        list.innerHTML = '<div class="setting"><div class="setting-label"><div class="s-title">Nothing matches your search.</div></div></div>';
      }
    },

    renderShortcutRow(cmd, overrides) {
      const wrap = document.createElement('div');
      wrap.className = 'setting shortcut-row';

      const label = document.createElement('div');
      label.className = 'setting-label';
      const groupTag = cmd.group ? `<span class="shortcut-group">${esc(cmd.group)}</span>` : '';
      label.innerHTML = `<div class="s-title">${groupTag}${esc(cmd.title)}</div>`;

      const ctrl = document.createElement('div');
      ctrl.className = 'setting-ctrl shortcut-ctrl';

      const combo = Shortcuts.comboFor(cmd.id);
      const def = Shortcuts.defaultFor(cmd.id);
      const overridden = cmd.id in overrides;

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'shortcut-chip' + (combo ? '' : ' unbound');
      chip.title = combo ? `Click to rebind "${cmd.title}"` : `Click to set a shortcut for "${cmd.title}"`;
      this._paintChip(chip, combo);

      const startRecording = () => {
        chip.classList.add('recording');
        chip.textContent = 'Press keys…';
        Shortcuts.beginRecording(cmd.id, (newCombo) => {
          chip.classList.remove('recording');
          if (newCombo === null) {
            // cancelled (Escape) — just rerender this row to restore state
            this.render();
            return;
          }
          // newCombo may be '' (clear) or a canonical combo
          Shortcuts.set(cmd.id, newCombo || null);
          this.render();
        });
      };
      on(chip, 'click', (e) => {
        e.preventDefault();
        if (Shortcuts.recording) Shortcuts.cancelRecording();
        startRecording();
      });

      ctrl.appendChild(chip);

      if (combo) {
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'shortcut-btn';
        clearBtn.textContent = 'Clear';
        clearBtn.title = 'Unbind this shortcut';
        on(clearBtn, 'click', () => { Shortcuts.set(cmd.id, null); this.render(); });
        ctrl.appendChild(clearBtn);
      }

      if (overridden && def) {
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'shortcut-btn';
        resetBtn.textContent = 'Reset';
        resetBtn.title = `Reset to default (${def})`;
        on(resetBtn, 'click', () => { Shortcuts.resetToDefault(cmd.id); this.render(); });
        ctrl.appendChild(resetBtn);
      }

      wrap.appendChild(label);
      wrap.appendChild(ctrl);
      return wrap;
    },

    _paintChip(chip, combo) {
      if (!combo) { chip.textContent = 'None'; return; }
      chip.innerHTML = '';
      for (const part of combo.split('+')) {
        const k = document.createElement('span');
        k.className = 'kbd';
        k.textContent = part;
        chip.appendChild(k);
      }
    },
    renderRow(row) {
      const wrap = document.createElement('div');
      wrap.className = 'setting';
      const label = document.createElement('div');
      label.className = 'setting-label';
      label.innerHTML = `<div class="s-title">${esc(row.title)}</div><div class="s-desc">${esc(row.desc)}</div>`;
      const ctrl = document.createElement('div');
      ctrl.className = 'setting-ctrl';

      const val = Settings.get(row.key);

      if (row.type === 'select') {
        const sel = document.createElement('select');
        for (const [v, lbl] of row.options) {
          const opt = document.createElement('option');
          opt.value = v; opt.textContent = lbl;
          if (String(val) === String(v)) opt.selected = true;
          sel.appendChild(opt);
        }
        on(sel, 'change', () => {
          const v = sel.value;
          Settings.set(row.key, isNaN(v) || v === '' ? v : (row.options.some(o => typeof o[0] === 'number') ? parseFloat(v) : v));
        });
        ctrl.appendChild(sel);
      } else if (row.type === 'number') {
        const inp = document.createElement('input');
        inp.type = 'number'; inp.min = row.min; inp.max = row.max; inp.step = row.step || 1;
        inp.value = val;
        on(inp, 'change', () => {
          let n = parseFloat(inp.value);
          if (isNaN(n)) n = val;
          n = Math.max(row.min, Math.min(row.max, n));
          Settings.set(row.key, n);
        });
        ctrl.appendChild(inp);
      } else if (row.type === 'toggle') {
        const tog = document.createElement('div');
        tog.className = 'switch' + (val ? ' on' : '');
        on(tog, 'click', () => { const nv = !Settings.get(row.key); Settings.set(row.key, nv); tog.classList.toggle('on', nv); });
        ctrl.appendChild(tog);
      } else if (row.type === 'font-select') {
        const sel = document.createElement('select');
        const F = window.VE_FONTS;
        const groups = [['Sans', F.sans], ['Serif', F.serif], ['Display', F.display], ['Monospace', F.mono], ['Handwriting', F.handwriting], ['System', F.system]];
        for (const [lbl, list] of groups) {
          const og = document.createElement('optgroup'); og.label = lbl;
          for (const f of list) {
            const opt = document.createElement('option');
            opt.value = f.family; opt.textContent = f.name;
            opt.style.fontFamily = f.family;
            if (val === f.family) opt.selected = true;
            og.appendChild(opt);
          }
          sel.appendChild(og);
        }
        on(sel, 'change', () => Settings.set(row.key, sel.value));
        ctrl.appendChild(sel);
      }

      wrap.appendChild(label);
      wrap.appendChild(ctrl);
      return wrap;
    }
  };

  /* ============================================================
     12. Find & replace
     ============================================================ */

  const Find = {
    matches: [],
    index: -1,
    init() {
      on($('#btn-find'), 'click', () => this.toggle(true));
      on($('#find-close'), 'click', () => this.toggle(false));
      on($('#find-input'), 'input', () => this.run());
      on($('#find-input'), 'keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? this.prev() : this.next(); }
        else if (e.key === 'Escape') { this.toggle(false); }
      });
      on($('#find-prev'), 'click', () => this.prev());
      on($('#find-next'), 'click', () => this.next());
      on($('#replace-one'), 'click', () => this.replaceOne());
      on($('#replace-all'), 'click', () => this.replaceAll());
      on($('#find-case'),  'change', () => this.run());
      on($('#find-regex'), 'change', () => this.run());
    },
    toggle(show) {
      const bar = $('#find-bar');
      if (typeof show === 'undefined') show = bar.hidden;
      bar.hidden = !show;
      if (show) {
        const inp = $('#find-input');
        inp.focus(); inp.select();
      } else {
        this.clearHighlights();
      }
    },
    clearHighlights() {
      $$('.find-hit', Editor.el).forEach((el) => {
        const parent = el.parentNode;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        el.remove();
        parent.normalize();
      });
      this.matches = [];
      this.index = -1;
      $('#find-count').textContent = '0/0';
    },
    buildRegex() {
      const q = $('#find-input').value;
      if (!q) return null;
      const flags = $('#find-case').checked ? 'g' : 'gi';
      try {
        return $('#find-regex').checked
          ? new RegExp(q, flags)
          : new RegExp(q.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), flags);
      } catch { return null; }
    },
    run() {
      this.clearHighlights();
      const rx = this.buildRegex();
      if (!rx) return;
      const walker = document.createTreeWalker(Editor.el, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => n.parentElement.closest('.find-hit') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      });
      const textNodes = [];
      let n;
      while ((n = walker.nextNode())) textNodes.push(n);

      for (const node of textNodes) {
        const text = node.nodeValue;
        if (!text) continue;
        const parts = [];
        let lastIdx = 0, m;
        rx.lastIndex = 0;
        while ((m = rx.exec(text))) {
          if (m.index > lastIdx) parts.push({ text: text.slice(lastIdx, m.index) });
          parts.push({ text: m[0], match: true });
          lastIdx = m.index + m[0].length;
          if (m[0].length === 0) rx.lastIndex++;
        }
        if (parts.length === 0) continue;
        if (lastIdx < text.length) parts.push({ text: text.slice(lastIdx) });

        const frag = document.createDocumentFragment();
        for (const p of parts) {
          if (p.match) {
            const span = document.createElement('span');
            span.className = 'find-hit';
            span.textContent = p.text;
            frag.appendChild(span);
            this.matches.push(span);
          } else {
            frag.appendChild(document.createTextNode(p.text));
          }
        }
        node.parentNode.replaceChild(frag, node);
      }

      if (this.matches.length) { this.index = 0; this.highlightCurrent(); }
      this.updateCount();
    },
    updateCount() {
      $('#find-count').textContent = this.matches.length
        ? `${this.index + 1}/${this.matches.length}`
        : '0/0';
    },
    highlightCurrent() {
      this.matches.forEach((el, i) => el.classList.toggle('find-hit-current', i === this.index));
      const el = this.matches[this.index];
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    next() {
      if (!this.matches.length) { this.run(); return; }
      this.index = (this.index + 1) % this.matches.length;
      this.highlightCurrent(); this.updateCount();
    },
    prev() {
      if (!this.matches.length) { this.run(); return; }
      this.index = (this.index - 1 + this.matches.length) % this.matches.length;
      this.highlightCurrent(); this.updateCount();
    },
    replaceOne() {
      if (!this.matches.length) { this.run(); return; }
      const el = this.matches[this.index];
      if (!el) return;
      const repl = $('#replace-input').value;
      el.replaceWith(document.createTextNode(repl));
      Editor.scheduleSave();
      this.run();
    },
    replaceAll() {
      if (!this.matches.length) this.run();
      const repl = $('#replace-input').value;
      for (const el of this.matches.slice()) {
        el.replaceWith(document.createTextNode(repl));
      }
      this.matches = [];
      Editor.scheduleSave();
      this.run();
    }
  };

  /* ============================================================
     13. Slash commands
     ============================================================ */

  const SLASH_ITEMS = [
    { id: 'h1', title: 'Heading 1',    desc: 'Big section title',  icon: 'H1', run: () => Editor.exec('formatBlock', '<H1>') },
    { id: 'h2', title: 'Heading 2',    desc: 'Medium heading',     icon: 'H2', run: () => Editor.exec('formatBlock', '<H2>') },
    { id: 'h3', title: 'Heading 3',    desc: 'Small heading',      icon: 'H3', run: () => Editor.exec('formatBlock', '<H3>') },
    { id: 'p',  title: 'Paragraph',    desc: 'Normal body text',   icon: '¶',  run: () => Editor.exec('formatBlock', '<P>') },
    { id: 'ul', title: 'Bulleted list', desc: 'Unordered list',    icon: '•',  run: () => Editor.exec('insertUnorderedList') },
    { id: 'ol', title: 'Numbered list', desc: 'Ordered list',      icon: '1.', run: () => Editor.exec('insertOrderedList') },
    { id: 'check', title: 'Checklist', desc: 'Task list',          icon: '☑',  run: () => UI.toggleChecklist() },
    { id: 'q',  title: 'Quote',        desc: 'Block quote',        icon: '"',  run: () => Editor.exec('formatBlock', '<BLOCKQUOTE>') },
    { id: 'code', title: 'Code block', desc: 'Monospace block',    icon: '</>',run: () => Editor.exec('formatBlock', '<PRE>') },
    { id: 'hr', title: 'Divider',      desc: 'Horizontal rule',    icon: '—',  run: () => Editor.exec('insertHorizontalRule') },
    { id: 'img', title: 'Image',       desc: 'Insert an image URL', icon: '◨', run: () => UI.insertImage() },
    { id: 'link', title: 'Link',       desc: 'Insert a link',      icon: '↗',  run: () => UI.insertLink() },
    { id: 'tbl', title: 'Table',       desc: 'Insert a small table', icon: '▦', run: () => Editor.insertHTML(buildTableHTML(3,3)) }
  ];

  const Slash = {
    isOpen: false,
    active: 0,
    filtered: [],
    filter: '',
    startRange: null,

    open(filter) {
      this.filter = filter || '';
      this.filtered = this.filter
        ? SLASH_ITEMS.filter(i => fuzzyScore(this.filter, i.id + ' ' + i.title) > 0)
        : SLASH_ITEMS.slice();
      if (!this.filtered.length) { this.close(); return; }
      this.active = 0;
      this.render();
      this.position();
      $('#slash-menu').hidden = false;
      this.isOpen = true;
    },
    close() { $('#slash-menu').hidden = true; this.isOpen = false; },

    render() {
      const m = $('#slash-menu');
      m.innerHTML = '';
      this.filtered.forEach((it, i) => {
        const el = document.createElement('div');
        el.className = 'slash-item' + (i === this.active ? ' active' : '');
        el.innerHTML = `<span class="si-icon">${esc(it.icon)}</span><div><div>${esc(it.title)}</div><div class="si-desc">${esc(it.desc)}</div></div>`;
        on(el, 'mouseenter', () => { this.active = i; this.highlight(); });
        on(el, 'mousedown', (e) => { e.preventDefault(); this.run(i); });
        m.appendChild(el);
      });
    },
    highlight() {
      $$('.slash-item', $('#slash-menu')).forEach((el, i) => el.classList.toggle('active', i === this.active));
    },
    position() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0).cloneRange();
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      const m = $('#slash-menu');
      m.style.top = `${window.scrollY + rect.bottom + 6}px`;
      m.style.left = `${window.scrollX + rect.left}px`;
    },
    run(i) {
      const it = this.filtered[i];
      if (!it) return;
      this.removeSlashText();
      this.close();
      it.run();
    },
    removeSlashText() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType !== 3) return;
      const text = node.textContent;
      const before = text.slice(0, range.startOffset);
      const m = /\/([a-zA-Z]{0,20})$/.exec(before);
      if (!m) return;
      const start = before.length - m[0].length;
      node.textContent = text.slice(0, start) + text.slice(range.startOffset);
      const r = document.createRange();
      r.setStart(node, start);
      r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    },
    keydown(e) {
      if (!this.isOpen) return false;
      if (e.key === 'ArrowDown') { e.preventDefault(); this.active = Math.min(this.filtered.length - 1, this.active + 1); this.highlight(); return true; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); this.active = Math.max(0, this.active - 1); this.highlight(); return true; }
      if (e.key === 'Enter')     { e.preventDefault(); this.run(this.active); return true; }
      if (e.key === 'Escape')    { e.preventDefault(); this.close(); return true; }
      return false;
    }
  };

  /* ============================================================
     14. Table picker
     ============================================================ */

  function buildTableHTML(rows, cols) {
    let s = '<table><thead><tr>';
    for (let c = 0; c < cols; c++) s += `<th>&nbsp;</th>`;
    s += '</tr></thead><tbody>';
    for (let r = 1; r < rows; r++) {
      s += '<tr>';
      for (let c = 0; c < cols; c++) s += '<td>&nbsp;</td>';
      s += '</tr>';
    }
    s += '</tbody></table><p></p>';
    return s;
  }

  const TablePicker = {
    rows: 3, cols: 3,
    init() {
      const grid = $('#table-grid');
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 10; c++) {
          const cell = document.createElement('div');
          cell.className = 'table-cell';
          cell.dataset.r = r;
          cell.dataset.c = c;
          on(cell, 'mouseenter', () => {
            this.rows = r + 1; this.cols = c + 1;
            this.highlight();
          });
          on(cell, 'click', (e) => {
            e.preventDefault();
            $('#table-picker').hidden = true;
            Editor.insertHTML(buildTableHTML(this.rows, this.cols));
          });
          grid.appendChild(cell);
        }
      }
      on(document, 'click', (e) => {
        if (!$('#table-picker').contains(e.target) && !e.target.closest('#btn-table')) {
          $('#table-picker').hidden = true;
        }
      });
    },
    open(anchor) {
      const picker = $('#table-picker');
      picker.hidden = false;
      const rect = anchor.getBoundingClientRect();
      picker.style.top = `${window.scrollY + rect.bottom + 6}px`;
      picker.style.left = `${window.scrollX + rect.left}px`;
      this.rows = 1; this.cols = 1;
      this.highlight();
    },
    highlight() {
      $$('.table-cell', $('#table-grid')).forEach((cell) => {
        const r = +cell.dataset.r + 1, c = +cell.dataset.c + 1;
        cell.classList.toggle('hl', r <= this.rows && c <= this.cols);
      });
      $('#table-label').textContent = `${this.cols} × ${this.rows}`;
    }
  };

  /* ============================================================
     15. Export / import
     ============================================================ */

  const Export = {
    download(kind) {
      const title = ($('#doc-title').value || 'Untitled').replace(/[\/\\?%*:|"<>]/g, '-');
      let blob, ext;
      if (kind === 'txt') {
        blob = new Blob([Editor.el.innerText || ''], { type: 'text/plain;charset=utf-8' });
        ext = 'txt';
      } else if (kind === 'md') {
        blob = new Blob([htmlToMarkdown(Editor.el)], { type: 'text/markdown;charset=utf-8' });
        ext = 'md';
      } else {
        const ff = Settings.get('fontFamily');
        const margin = currentPageMarginInches();
        // Exported HTML carries the same page-break hints the editor uses,
        // so when the receiver prints or "Save as PDF", the paper pagination
        // matches what they saw in the editor exactly.
        const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${esc(title)}</title>
<style>
  @page { size: Letter; margin: ${margin}; }
  html, body { margin: 0; }
  body { font-family: ${ff}; line-height: 1.6; color: #1f1f1f; }
  .doc { max-width: 780px; margin: 40px auto; padding: 0 24px; }
  h1,h2,h3 { font-weight: 500; letter-spacing: -0.01em; }
  blockquote { border-left: 3px solid #8b5cf6; padding: 4px 14px; color: #555; background: #f5f0ff; }
  pre { background: #f3f4f6; padding: 12px; border-radius: 6px; overflow-x: auto; }
  a { color: #8b5cf6; }
  img { max-width: 100%; height: auto; }
  hr { border: none; border-top: 1px solid #ddd; margin: 18px 0; }
  table { border-collapse: collapse; } th, td { border: 1px solid #ddd; padding: 6px 10px; }
  [data-ve-pagebreak="1"] { break-before: page; page-break-before: always; }
  @media print {
    .doc { max-width: none; margin: 0; padding: 0; }
  }
</style></head><body>
<div class="doc">
<h1>${esc(title)}</h1>
${pagedExportHTML()}
</div>
</body></html>`;
        blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        ext = 'html';
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${title}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    importFile(file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target.result;
        if (/\.md$/i.test(file.name)) {
          Editor.el.innerHTML = markdownToHTML(content);
        } else if (/\.(html?|htm)$/i.test(file.name)) {
          const tpl = document.createElement('template');
          tpl.innerHTML = content;
          const body = tpl.content.querySelector('body');
          Editor.el.innerHTML = sanitizeHTML(body ? body.innerHTML : content);
        } else {
          Editor.el.innerHTML = esc(content).replace(/\n/g, '<br>');
        }
        Editor.titleEl.value = file.name.replace(/\.[^.]+$/, '');
        Editor.scheduleSave();
        Editor.updateCounts();
      };
      reader.readAsText(file);
    }
  };

  function htmlToMarkdown(root) {
    const out = [];
    function walk(node, ctx = {}) {
      if (node.nodeType === 3) { out.push(node.nodeValue.replace(/\n/g, ' ')); return; }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      const inner = () => { for (const c of node.childNodes) walk(c, ctx); };
      switch (tag) {
        case 'H1': out.push('\n# '); inner(); out.push('\n\n'); break;
        case 'H2': out.push('\n## '); inner(); out.push('\n\n'); break;
        case 'H3': out.push('\n### '); inner(); out.push('\n\n'); break;
        case 'H4': out.push('\n#### '); inner(); out.push('\n\n'); break;
        case 'H5': out.push('\n##### '); inner(); out.push('\n\n'); break;
        case 'H6': out.push('\n###### '); inner(); out.push('\n\n'); break;
        case 'B': case 'STRONG': out.push('**'); inner(); out.push('**'); break;
        case 'I': case 'EM':     out.push('*');  inner(); out.push('*'); break;
        case 'U':                out.push('');   inner(); out.push(''); break;
        case 'S': case 'STRIKE': out.push('~~'); inner(); out.push('~~'); break;
        case 'CODE':             out.push('`');  inner(); out.push('`'); break;
        case 'PRE':              out.push('\n```\n'); out.push(node.innerText); out.push('\n```\n\n'); break;
        case 'BLOCKQUOTE': {
          const sub = [];
          const prev = out.push; // no-op; we'll do inline capture
          for (const c of node.childNodes) {
            const tmpOut = [];
            const old = out.splice(0);
            walk(c, ctx);
            const chunk = out.splice(0).join('');
            out.push(...old);
            sub.push(chunk);
          }
          const text = sub.join('').trim().split('\n').map(l => '> ' + l).join('\n');
          out.push('\n' + text + '\n\n');
          break;
        }
        case 'UL': {
          out.push('\n');
          for (const li of node.children) {
            if (li.tagName !== 'LI') continue;
            out.push('- ');
            for (const c of li.childNodes) walk(c, ctx);
            out.push('\n');
          }
          out.push('\n');
          break;
        }
        case 'OL': {
          out.push('\n');
          let i = 1;
          for (const li of node.children) {
            if (li.tagName !== 'LI') continue;
            out.push(`${i}. `); i++;
            for (const c of li.childNodes) walk(c, ctx);
            out.push('\n');
          }
          out.push('\n');
          break;
        }
        case 'A': {
          const href = node.getAttribute('href') || '';
          out.push('['); inner(); out.push(`](${href})`);
          break;
        }
        case 'IMG': {
          const alt = node.getAttribute('alt') || '';
          const src = node.getAttribute('src') || '';
          out.push(`![${alt}](${src})`);
          break;
        }
        case 'HR': out.push('\n---\n\n'); break;
        case 'BR': out.push('  \n'); break;
        case 'P': case 'DIV': inner(); out.push('\n\n'); break;
        default: inner();
      }
    }
    for (const c of root.childNodes) walk(c);
    return out.join('').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function markdownToHTML(md) {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      let l = lines[i];
      // Code fence
      if (l.startsWith('```')) {
        const buf = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i++; }
        out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
        i++;
        continue;
      }
      if (l.startsWith('---') && l.replace(/[-\s]/g, '') === '') { out.push('<hr>'); i++; continue; }
      const h = /^(#{1,6})\s+(.*)$/.exec(l);
      if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
      if (l.startsWith('> ')) {
        const buf = [];
        while (i < lines.length && lines[i].startsWith('> ')) { buf.push(lines[i].slice(2)); i++; }
        out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>');
        continue;
      }
      if (/^[-*]\s+/.test(l)) {
        out.push('<ul>');
        while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
          out.push('<li>' + inline(lines[i].replace(/^[-*]\s+/, '')) + '</li>');
          i++;
        }
        out.push('</ul>');
        continue;
      }
      if (/^\d+\.\s+/.test(l)) {
        out.push('<ol>');
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
          out.push('<li>' + inline(lines[i].replace(/^\d+\.\s+/, '')) + '</li>');
          i++;
        }
        out.push('</ol>');
        continue;
      }
      if (l.trim() === '') { i++; continue; }
      // Paragraph (merge consecutive non-empty lines)
      const buf = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^([#>*-]|\d+\.)\s/.test(lines[i])) {
        buf.push(lines[i]); i++;
      }
      out.push('<p>' + inline(buf.join(' ')) + '</p>');
    }
    return out.join('\n');

    function inline(t) {
      return esc(t)
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, a, s) => `<img alt="${a}" src="${s}">`)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, url) => `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`)
        .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/~~([^~]+)~~/g, '<s>$1</s>');
    }
  }

  /* ============================================================
     16. Docs UI
     ============================================================ */

  /* ============================================================
     ViperHub — full-screen landing view
     ============================================================ */

  const Hub = {
    query: '',

    init() {
      // Search input
      on($('#hub-search'), 'input', (e) => {
        this.query = e.target.value.trim().toLowerCase();
        this.render();
      });

      // Hub-specific topbar buttons
      on($('#hub-btn-background'), 'click', () => Background.open());
      on($('#hub-btn-settings'),   'click', () => SettingsUI.open());
      on($('#hub-btn-theme'),      'click', () => toggleTheme());
    },

    show() {
      this.render();
      // Focus search after a beat so the view transition finishes
      setTimeout(() => { const s = $('#hub-search'); if (s) s.focus(); }, 50);
    },

    render() {
      this.renderTemplates();
      this.renderDocs();
    },

    _matches(text) {
      if (!this.query) return true;
      return String(text || '').toLowerCase().includes(this.query);
    },

    renderTemplates() {
      const grid = $('#hub-templates-row');
      if (!grid) return;
      grid.innerHTML = '';
      const tpls = (window.VE_TEMPLATES || []).filter(t =>
        this._matches(t.name) || this._matches(t.desc));
      if (!tpls.length) {
        grid.innerHTML = '<div class="hub-empty">No templates match your search.</div>';
        return;
      }
      for (const t of tpls) {
        const card = document.createElement('div');
        card.className = 'tpl-card';
        card.dataset.tpl = t.id;
        card.style.setProperty('--tpl-accent', t.accent || '#6d28d9');
        const hasPreset = t.preset && Object.keys(t.preset).length;
        card.innerHTML = `
          <div class="tc-icon">${esc(t.icon || '+')}</div>
          <div>
            <div class="tc-name">${esc(t.name)}</div>
            <div class="tc-desc">${esc(t.desc || '')}</div>
          </div>
          ${hasPreset ? '<span class="tc-preset">Preset</span>' : ''}
        `;
        on(card, 'click', () => App.openTemplate(t));
        grid.appendChild(card);
      }
    },

    _buildPreview(doc) {
      const tmp = document.createElement('div');
      tmp.innerHTML = doc.html || '';
      // First heading (if any)
      const h = tmp.querySelector('h1, h2, h3');
      const heading = h ? (h.innerText || '').trim() : '';
      // Strip the heading for snippet
      if (h) h.remove();
      const text = (tmp.innerText || '').trim().replace(/\s+/g, ' ');
      return { heading, snippet: text.slice(0, 240) };
    },

    renderDocs() {
      const grid = $('#hub-docs-grid');
      if (!grid) return;
      grid.innerHTML = '';
      const sub = $('#hub-docs-count');

      const filtered = Docs.all
        .filter(d => this._matches(d.title) || this._matches(d.html))
        .sort((a, b) => b.updatedAt - a.updatedAt);

      if (sub) sub.textContent = `${Docs.all.length} total · ${filtered.length} shown`;

      if (!filtered.length) {
        grid.innerHTML = `<div class="hub-empty">${Docs.all.length ? 'No documents match your search.' : 'No documents yet — pick a template above to begin.'}</div>`;
        return;
      }

      for (const d of filtered) {
        const card = document.createElement('div');
        card.className = 'doc-card' + (d.id === Docs.currentId ? ' active' : '');
        const hasPreset = d.preset && Object.keys(d.preset).length;
        const { heading, snippet } = this._buildPreview(d);
        const isEmpty = !heading && !snippet;
        const words = (d.html || '').replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
        const rel = this._relativeTime(d.updatedAt);

        card.innerHTML = `
          <div class="dc-preview${isEmpty ? ' is-empty' : ''}">
            ${isEmpty ? 'Empty document' : `
              ${heading ? `<div class="dc-snippet-heading">${esc(heading)}</div>` : ''}
              ${snippet ? `<div class="dc-snippet">${esc(snippet)}</div>` : ''}
            `}
          </div>
          <div class="dc-meta">
            <div class="dc-title">${esc(d.title || 'Untitled')}</div>
            <div class="dc-info">
              ${hasPreset ? '<span class="dc-preset-tag">Preset</span>' : ''}
              <span>${esc(rel)}</span>
              <span class="dot">·</span>
              <span>${words.toLocaleString()} word${words === 1 ? '' : 's'}</span>
            </div>
          </div>
          <button class="dc-delete" title="Delete">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>
          </button>
        `;

        on(card, 'click', (e) => {
          if (e.target.closest('.dc-delete')) {
            e.stopPropagation();
            if (confirm(`Delete "${d.title || 'Untitled'}"?`)) {
              Docs.remove(d.id);
              this.renderDocs();
              Docs.updateDocCount();
            }
            return;
          }
          App.openDoc(d.id);
        });
        grid.appendChild(card);
      }
    },

    _relativeTime(ts) {
      const now = Date.now();
      const diff = Math.max(0, now - ts);
      const m = 60_000, h = 3_600_000, d = 86_400_000;
      if (diff < m)      return 'just now';
      if (diff < h)      return `${Math.floor(diff / m)} min ago`;
      if (diff < d)      return `${Math.floor(diff / h)} hr ago`;
      if (diff < 7 * d)  return `${Math.floor(diff / d)} day${Math.floor(diff / d) === 1 ? '' : 's'} ago`;
      return new Date(ts).toLocaleDateString();
    }
  };

  /* ============================================================
     App — view switching (hub ↔ editor)
     ============================================================ */

  const App = {
    // Suppress pushState while we apply a popstate — otherwise we'd pollute
    // the history stack when reacting to a back/forward event.
    _applyingRoute: false,

    init() {
      // Back-to-hub chip in the editor topbar
      on($('#btn-hub'), 'click', () => this.showHub());
      // Browser back/forward: re-apply the URL-driven view.
      on(window, 'popstate', () => this._applyRoute(location.hash, { push: false }));
    },

    isHub() { return document.body.getAttribute('data-view') === 'hub'; },

    // --- Routing ------------------------------------------------------------
    // Hash forms:
    //   #/hub               → Hub view
    //   #/doc/<docId>       → Editor view on that document
    _parseHash(hash) {
      const h = String(hash || '').replace(/^#/, '');
      if (!h || h === '/' || h === '/hub') return { view: 'hub' };
      const m = h.match(/^\/doc\/(.+)$/);
      if (m) return { view: 'doc', id: decodeURIComponent(m[1]) };
      return { view: 'hub' };
    },
    _hashFor(route) {
      if (!route) return '#/hub';
      return route.view === 'doc' && route.id
        ? `#/doc/${encodeURIComponent(route.id)}`
        : '#/hub';
    },
    _pushRoute(route, replace = false) {
      if (this._applyingRoute) return;
      const url = this._hashFor(route);
      if (location.hash === url && !replace) return;
      try {
        if (replace) history.replaceState(route, '', url);
        else         history.pushState(route, '', url);
      } catch { /* some environments disallow pushState with file:// */ }
    },
    // Apply the route to the UI. Called on init and on popstate. When
    // `push` is true we also update the history stack.
    _applyRoute(hash, opts = { push: true }) {
      const route = this._parseHash(hash);
      this._applyingRoute = true;
      try {
        if (route.view === 'doc') {
          const doc = Docs.all.find(d => d.id === route.id);
          if (doc) {
            if (Docs.currentId !== doc.id) Docs.switchTo(doc.id);
            document.body.setAttribute('data-view', 'editor');
            setTimeout(() => Editor.el && Editor.el.focus(), 30);
            if (opts.push) this._pushRoute(route, true);
            return;
          }
          // Fall through to hub if the referenced doc is gone.
        }
        Docs.saveCurrent();
        document.body.setAttribute('data-view', 'hub');
        Hub.show();
        if (opts.push) this._pushRoute({ view: 'hub' }, true);
      } finally {
        this._applyingRoute = false;
      }
    },
    // Called once during init() after state is hydrated — choose the
    // initial view from the URL hash so refreshes stay put.
    restoreRoute() {
      this._applyRoute(location.hash, { push: true });
    },

    showHub() {
      Docs.saveCurrent();                              // flush so previews reflect latest
      document.body.setAttribute('data-view', 'hub');
      Hub.show();
      this._pushRoute({ view: 'hub' });
    },

    enterEditor() {
      document.body.setAttribute('data-view', 'editor');
      setTimeout(() => Editor.el && Editor.el.focus(), 30);
      const id = Docs.currentId;
      if (id) this._pushRoute({ view: 'doc', id });
    },

    openDoc(id) {
      if (Docs.currentId !== id) Docs.switchTo(id);
      this.enterEditor();
    },

    openTemplate(t) {
      Docs.create(t);
      this.enterEditor();
    },

    newBlank() {
      const blank = (window.VE_TEMPLATES || []).find(t => t.id === 'blank');
      Docs.create(blank || null);
      this.enterEditor();
    },

    duplicate() {
      Docs.duplicate();
      this.enterEditor();
    }
  };

  /* ============================================================
     ViperShard app launcher (opens from the brand logo button)
     ============================================================ */

  const AppLauncher = {
    init() {
      const open = (e) => {
        e.stopPropagation();
        const menu = $('#app-launcher');
        if (!menu.hidden) { this.close(); return; }
        this.open(e.currentTarget);
      };
      const hub = $('#brand-launcher-hub');
      const ed  = $('#brand-launcher-editor');
      if (hub) on(hub, 'click', open);
      if (ed)  on(ed,  'click', open);

      on(document, 'click', (e) => {
        const menu = $('#app-launcher');
        if (menu.hidden) return;
        if (menu.contains(e.target)) return;
        if (e.target.closest('.brand-launcher')) return;
        this.close();
      });
    },

    open(anchor) {
      this.render();
      const menu = $('#app-launcher');
      menu.hidden = false;
      const r = anchor.getBoundingClientRect();
      menu.style.top  = `${r.bottom + 8}px`;
      menu.style.left = `${r.left}px`;
      // Keep inside viewport
      const pad = 12;
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth - pad) {
        menu.style.left = `${window.innerWidth - rect.width - pad}px`;
      }
    },
    close() { $('#app-launcher').hidden = true; },

    render() {
      const grid = $('#al-grid');
      const foot = $('#al-foot');
      if (!grid) return;
      grid.innerHTML = '';
      const apps = Array.isArray(window.VIPERSHARD_APPS) ? window.VIPERSHARD_APPS.slice() : [];

      if (!apps.length) {
        grid.innerHTML = '<div class="al-empty" style="grid-column:1/-1;padding:20px;text-align:center;color:var(--fg-soft);font-size:12px">Coming soon!</div>';
        foot.textContent = 'More apps by ViperShard are on the way.';
        return;
      }

      for (const a of apps) {
        const tag = a.url ? 'a' : 'div';
        const card = document.createElement(tag);
        card.className = 'al-card'
          + (a.current ? ' current' : '')
          + (a.comingSoon ? ' coming-soon' : '');
        if (a.url) { card.href = a.url; card.target = '_blank'; card.rel = 'noopener'; }
        card.style.setProperty('--al-accent', a.accent || 'var(--accent)');
        card.innerHTML = `
          <span class="al-icon">${esc(a.icon || '◻')}</span>
          <span class="al-name">${esc(a.name)}</span>
          ${a.current ? '<span class="al-current-tag" title="You are here"></span>' : ''}
        `;
        if (!a.url) {
          on(card, 'click', (e) => e.preventDefault());
        } else {
          on(card, 'click', () => this.close());
        }
        grid.appendChild(card);
      }

      const active = apps.filter(a => !a.comingSoon && a.url);   // launchable apps
      if (active.length === 0) {
        foot.textContent = 'Coming soon — more apps by ViperShard are on the way.';
      } else {
        foot.textContent = `${apps.length} app${apps.length === 1 ? '' : 's'} · ${active.length} launchable.`;
      }
    }
  };

  /* ============================================================
     Profile / sign-in menu
     ============================================================ */

  const ProfileMenu = {
    init() {
      const open = (e) => {
        e.stopPropagation();
        const menu = $('#profile-menu');
        if (!menu.hidden) { this.close(); return; }
        this.open(e.currentTarget);
      };
      const hub = $('#profile-btn-hub');
      const ed  = $('#profile-btn-editor');
      if (hub) on(hub, 'click', open);
      if (ed)  on(ed,  'click', open);

      on($('#pm-signout'), 'click', () => {
        window.VE_Auth.signOut();
        this.close();
      });

      on(document, 'click', (e) => {
        const menu = $('#profile-menu');
        if (menu.hidden) return;
        if (menu.contains(e.target)) return;
        if (e.target.closest('.profile-btn')) return;
        this.close();
      });

      // Always keep the profile button avatar in sync with auth state.
      this.renderButtons();
    },

    open(anchor) {
      this.renderMenu();
      const menu = $('#profile-menu');
      menu.hidden = false;
      const r = anchor.getBoundingClientRect();
      menu.style.top = `${r.bottom + 8}px`;
      menu.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
      menu.style.left = 'auto';
    },
    close() { $('#profile-menu').hidden = true; },

    async renderMenu() {
      const u = window.VE_Auth && window.VE_Auth.user;
      const signedIn = !!u;
      $('#pm-signed-out').hidden = signedIn;
      $('#pm-signed-in').hidden = !signedIn;

      if (signedIn) {
        const pic = $('#pm-pic');
        if (pic) pic.src = u.picture || '';
        $('#pm-name').textContent  = u.name || '';
        $('#pm-email').textContent = u.email || '';
        this._renderStorage();
      } else {
        // Let GIS render its official button.
        window.VE_Auth.renderButton($('#auth-slot'));
      }
    },

    async _renderStorage() {
      const el = $('#pm-storage');
      if (!el) return;
      const est = await window.VE_IDB.estimate();
      if (!est || !est.quota) {
        el.textContent = 'Storage usage unavailable in this browser.';
        return;
      }
      const used = est.usage || 0;
      const quota = est.quota;
      const usedFmt = fmtBytes(used);
      const quotaFmt = fmtBytes(quota);
      const pct = Math.min(100, (used / quota) * 100);
      el.innerHTML = `
        <div><strong>${usedFmt}</strong> used of ~${quotaFmt} available</div>
        <div class="pm-storage-bar"><div class="pm-storage-bar-fill" style="width:${pct.toFixed(2)}%"></div></div>
        <div style="font-size:10.5px;color:var(--fg-soft)">Persistent storage is ${await isPersisted() ? 'enabled' : 'requested'} — your browser will try not to evict this data.</div>
      `;
    },

    renderButtons() {
      const u = window.VE_Auth && window.VE_Auth.user;
      const pair = [
        ['#profile-btn-hub',    '#profile-pic-hub',    '#profile-guest-hub'],
        ['#profile-btn-editor', '#profile-pic-editor', '#profile-guest-editor']
      ];
      for (const [bSel, pSel, gSel] of pair) {
        const btn = $(bSel), pic = $(pSel), guest = $(gSel);
        if (!btn) continue;
        if (u && u.picture) {
          if (pic) { pic.src = u.picture; pic.hidden = false; }
          if (guest) guest.style.display = 'none';
          btn.classList.add('is-signed-in');
          btn.title = u.name ? `Signed in as ${u.name}` : 'Signed in';
        } else {
          if (pic) { pic.hidden = true; pic.src = ''; }
          if (guest) guest.style.display = 'inline-block';
          btn.classList.remove('is-signed-in');
          btn.title = 'Sign in';
        }
      }
    }
  };

  function fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }
  async function isPersisted() {
    try { return navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; }
    catch { return false; }
  }

  /* ============================================================
     17. Shortcuts + global key handling
     ============================================================ */

  // Canonicalize a combo string so "ctrl+b", "Ctrl + B", "Meta+b" all
  // compare equal. Order is fixed: Ctrl, Alt, Shift, <key>.
  function canonicalCombo(raw) {
    if (!raw) return '';
    const parts = String(raw).split('+').map(s => s.trim()).filter(Boolean);
    let ctrl = false, alt = false, shift = false;
    let key = '';
    for (const p of parts) {
      const low = p.toLowerCase();
      if (low === 'ctrl' || low === 'control' || low === 'cmd' || low === 'meta' || low === 'command') ctrl = true;
      else if (low === 'alt' || low === 'option') alt = true;
      else if (low === 'shift') shift = true;
      else key = p.length === 1 ? p.toUpperCase() : (p[0].toUpperCase() + p.slice(1));
    }
    if (!key) return '';
    const out = [];
    if (ctrl)  out.push('Ctrl');
    if (alt)   out.push('Alt');
    if (shift) out.push('Shift');
    out.push(key);
    return out.join('+');
  }

  // Build a canonical combo from a KeyboardEvent. Returns '' for
  // non-shortcut keypresses (bare printable chars, or lone modifiers).
  function comboFromEvent(e) {
    const k = e.key;
    if (!k) return '';
    if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return '';

    const mod = e.ctrlKey || e.metaKey;
    const alt = e.altKey;
    const shift = e.shiftKey;
    const isFn = /^F\d{1,2}$/.test(k);

    // Ignore bare printable keys — otherwise typing letters would fire commands.
    // Allow: function keys (F1-F12) with no modifiers, or any key with Ctrl/Meta/Alt.
    if (!mod && !alt && !isFn) return '';

    let key = k;
    if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
    // else keep as-is (Enter, Escape, ArrowUp, F1, /, etc.)

    const parts = [];
    if (mod)   parts.push('Ctrl');
    if (alt)   parts.push('Alt');
    if (shift) parts.push('Shift');
    parts.push(key);
    return parts.join('+');
  }

  const Shortcuts = {
    // combo (canonical) -> commandId
    bindings: {},
    // commandId -> combo
    cmdToCombo: {},
    // When non-null, Settings UI is capturing the next keypress as a new binding.
    // Shape: { cmdId, resolve(combo|null) }
    recording: null,

    // Build the live binding table from registered command defaults + user overrides.
    rebuild() {
      const bindings = {};
      const cmdToCombo = {};
      const overrides = Settings.get('shortcuts') || {};

      // 1. User overrides win outright.
      for (const id of Object.keys(overrides)) {
        const raw = overrides[id];
        if (!raw) continue;             // null/'' = explicitly unbound
        const c = canonicalCombo(raw);
        if (!c) continue;
        bindings[c] = id;
        cmdToCombo[id] = c;
      }
      // 2. Defaults fill in wherever the user hasn't spoken and the slot is free.
      for (const cmd of Commands.list) {
        if (cmd.id in overrides) continue;   // user made a choice (even if null)
        if (!cmd.shortcut) continue;
        const c = canonicalCombo(cmd.shortcut);
        if (!c || bindings[c]) continue;
        bindings[c] = cmd.id;
        cmdToCombo[cmd.id] = c;
      }
      this.bindings = bindings;
      this.cmdToCombo = cmdToCombo;
    },

    // Current combo for a command (user override if present, else default).
    comboFor(id) {
      return this.cmdToCombo[id] || '';
    },
    defaultFor(id) {
      const cmd = Commands.byId[id];
      return cmd && cmd.shortcut ? canonicalCombo(cmd.shortcut) : '';
    },

    // Assign a new combo to a command. Pass null to unbind. Automatically
    // steals the combo from any other command that currently holds it.
    set(id, combo) {
      const overrides = { ...(Settings.get('shortcuts') || {}) };
      const c = combo ? canonicalCombo(combo) : null;

      if (c) {
        // Kick any conflicting user override off this combo.
        for (const k of Object.keys(overrides)) {
          if (k === id) continue;
          const existing = overrides[k] ? canonicalCombo(overrides[k]) : '';
          if (existing === c) overrides[k] = null;
        }
        // Kick any default-bound command off this combo by explicitly unbinding it.
        for (const cmd of Commands.list) {
          if (cmd.id === id) continue;
          if (cmd.id in overrides) continue;
          if (cmd.shortcut && canonicalCombo(cmd.shortcut) === c) {
            overrides[cmd.id] = null;
          }
        }
      }

      // If the new value equals the registered default, clear the override entry
      // so "reset to default" stays idempotent.
      const def = this.defaultFor(id);
      if (c && c === def) delete overrides[id];
      else overrides[id] = c;   // c may be null (unbound)

      Settings.set('shortcuts', overrides);
      this.rebuild();
    },

    resetToDefault(id) {
      const overrides = { ...(Settings.get('shortcuts') || {}) };
      delete overrides[id];
      Settings.set('shortcuts', overrides);
      this.rebuild();
    },

    // Called from the global keydown handler. Returns true if dispatched.
    dispatch(e) {
      // Recording mode: capture the combo instead of firing. Must run BEFORE the
      // "modifier required" filter — Esc/Backspace and bare Fn keys are allowed.
      if (this.recording) {
        const k = e.key;
        // Ignore lone modifier keys — wait for the real key.
        if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return false;
        e.preventDefault();
        e.stopPropagation();
        if (k === 'Escape')    { this._resolveRecording(null, true); return true; }
        if (k === 'Backspace') { this._resolveRecording('', false); return true; }
        // Build a combo even for bare keys (lets the user bind e.g. F5, Enter).
        const parts = [];
        if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
        if (e.altKey)               parts.push('Alt');
        if (e.shiftKey)             parts.push('Shift');
        let key = k;
        if (key === ' ') key = 'Space';
        else if (key.length === 1) key = key.toUpperCase();
        parts.push(key);
        this._resolveRecording(parts.join('+'), false);
        return true;
      }

      const combo = comboFromEvent(e);
      if (!combo) return false;

      // Don't fire shortcuts from inside an open overlay's inputs —
      // the palette/settings/find sheets own their own keys.
      const ae = document.activeElement;
      if (ae && ae.closest && ae.closest('.overlay:not([hidden]) input, .overlay:not([hidden]) textarea, .overlay:not([hidden]) select')) {
        return false;
      }

      const id = this.bindings[combo];
      if (!id) return false;
      e.preventDefault();
      Commands.run(id);
      return true;
    },

    // -- Recording API used by Settings UI ------------------------------------
    beginRecording(cmdId, onResolve) {
      // onResolve(combo)  — combo is '' for unbound, null for "cancelled"
      this.recording = { cmdId, onResolve };
    },
    cancelRecording() {
      if (!this.recording) return;
      this._resolveRecording(null, true);
    },
    _resolveRecording(combo, cancelled) {
      const r = this.recording;
      this.recording = null;
      if (!r) return;
      try { r.onResolve(cancelled ? null : combo); }
      catch (e) { console.warn('shortcut recorder callback failed', e); }
    }
  };

  function handleKeydown(e) {
    // Shortcut recorder intercepts everything first.
    if (Shortcuts.recording) { Shortcuts.dispatch(e); return; }
    // Slash menu key handling next.
    if (Slash.keydown(e)) return;
    // User-configurable shortcuts.
    Shortcuts.dispatch(e);
  }

  /* ============================================================
     18. Register commands
     ============================================================ */

  function registerCommands() {
    const R = (c) => Commands.register(c);

    // Formatting
    R({ id: 'fmt.bold',          title: 'Bold',            group: 'Format', icon: 'B', shortcut: 'Ctrl+B', run: () => Editor.exec('bold') });
    R({ id: 'fmt.italic',        title: 'Italic',          group: 'Format', icon: 'I', shortcut: 'Ctrl+I', run: () => Editor.exec('italic') });
    R({ id: 'fmt.underline',     title: 'Underline',       group: 'Format', icon: 'U', shortcut: 'Ctrl+U', run: () => Editor.exec('underline') });
    R({ id: 'fmt.strike',        title: 'Strikethrough',   group: 'Format', icon: 'S', run: () => Editor.exec('strikeThrough') });
    R({ id: 'fmt.super',         title: 'Superscript',     group: 'Format', icon: 'x²', run: () => Editor.exec('superscript') });
    R({ id: 'fmt.sub',           title: 'Subscript',       group: 'Format', icon: 'x₂', run: () => Editor.exec('subscript') });
    R({ id: 'fmt.clear',         title: 'Clear formatting', group: 'Format', icon: '✗', run: () => Editor.exec('removeFormat') });

    // Blocks
    R({ id: 'block.p',           title: 'Paragraph',       group: 'Block', icon: '¶', shortcut: 'Ctrl+Alt+0', run: () => Editor.exec('formatBlock', '<P>') });
    R({ id: 'block.h1',          title: 'Heading 1',       group: 'Block', icon: 'H1', shortcut: 'Ctrl+Alt+1', run: () => Editor.exec('formatBlock', '<H1>') });
    R({ id: 'block.h2',          title: 'Heading 2',       group: 'Block', icon: 'H2', shortcut: 'Ctrl+Alt+2', run: () => Editor.exec('formatBlock', '<H2>') });
    R({ id: 'block.h3',          title: 'Heading 3',       group: 'Block', icon: 'H3', shortcut: 'Ctrl+Alt+3', run: () => Editor.exec('formatBlock', '<H3>') });
    R({ id: 'block.h4',          title: 'Heading 4',       group: 'Block', icon: 'H4', run: () => Editor.exec('formatBlock', '<H4>') });
    R({ id: 'block.quote',       title: 'Quote block',     group: 'Block', icon: '"', run: () => Editor.exec('formatBlock', '<BLOCKQUOTE>') });
    R({ id: 'block.code',        title: 'Code block',      group: 'Block', icon: '</>', run: () => Editor.exec('formatBlock', '<PRE>') });

    // Lists
    R({ id: 'list.ul',           title: 'Bulleted list',   group: 'List', icon: '•', run: () => Editor.exec('insertUnorderedList') });
    R({ id: 'list.ol',           title: 'Numbered list',   group: 'List', icon: '1.', run: () => Editor.exec('insertOrderedList') });
    R({ id: 'list.check',        title: 'Checklist',       group: 'List', icon: '☑', run: () => UI.toggleChecklist() });

    // Align
    R({ id: 'align.left',        title: 'Align left',      group: 'Align', icon: '⇤', run: () => Editor.exec('justifyLeft') });
    R({ id: 'align.center',      title: 'Align center',    group: 'Align', icon: '↔', run: () => Editor.exec('justifyCenter') });
    R({ id: 'align.right',       title: 'Align right',     group: 'Align', icon: '⇥', run: () => Editor.exec('justifyRight') });
    R({ id: 'align.justify',     title: 'Justify',         group: 'Align', icon: '≡', run: () => Editor.exec('justifyFull') });

    // Insert
    R({ id: 'ins.link',          title: 'Insert link',     group: 'Insert', icon: '↗', shortcut: 'Ctrl+K', run: () => UI.insertLink() });
    R({ id: 'ins.image',         title: 'Insert image',    group: 'Insert', icon: '◨', run: () => UI.insertImage() });
    R({ id: 'ins.table',         title: 'Insert table',    group: 'Insert', icon: '▦', run: () => Editor.insertHTML(buildTableHTML(3, 3)) });
    R({ id: 'ins.hr',            title: 'Insert divider',  group: 'Insert', icon: '—', run: () => Editor.exec('insertHorizontalRule') });

    // Document
    R({ id: 'doc.hub',           title: 'Back to ViperHub', group: 'Doc', icon: '◳', run: () => App.showHub() });
    R({ id: 'doc.new',           title: 'New blank document', group: 'Doc', icon: '+', shortcut: 'Ctrl+D', run: () => App.newBlank() });
    R({ id: 'doc.open',          title: 'Open file…',      group: 'Doc', icon: '📂', run: () => $('#file-input').click() });
    R({ id: 'doc.dup',           title: 'Duplicate document', group: 'Doc', icon: '⎘', run: () => App.duplicate() });
    R({ id: 'doc.page-setup',    title: 'Page setup…',         group: 'Doc', icon: '▭', keywords: 'margins paper size letter', run: () => PageSetup.open() });
    R({ id: 'doc.preset.save',   title: 'Save settings to this document', group: 'Doc', icon: '◆', run: () => Docs.savePresetFromCurrentSettings() });
    R({ id: 'doc.preset.clear',  title: 'Clear document preset', group: 'Doc', icon: '◇', run: () => Docs.clearPreset() });
    R({ id: 'doc.rename',        title: 'Rename document', group: 'Doc', run: () => { const n = prompt('New name:', Editor.titleEl.value); if (n) { Editor.titleEl.value = n; Editor.scheduleSave(); } } });
    R({ id: 'doc.delete',        title: 'Delete document', group: 'Doc', icon: '🗑', run: () => { if (confirm('Delete this document?')) Docs.remove(Docs.currentId); } });
    R({ id: 'doc.dl.html',       title: 'Download as HTML', group: 'Export', icon: '⬇', shortcut: 'Ctrl+S', run: () => Export.download('html') });
    R({ id: 'doc.dl.md',         title: 'Download as Markdown', group: 'Export', icon: '⬇', run: () => Export.download('md') });
    R({ id: 'doc.dl.txt',        title: 'Download as Text', group: 'Export', icon: '⬇', run: () => Export.download('txt') });
    R({ id: 'doc.print',         title: 'Print / Save as PDF', group: 'Export', icon: '⎙', shortcut: 'Ctrl+P', run: () => window.print() });

    // View / UI
    R({ id: 'view.settings',     title: 'Open settings',   group: 'View', icon: '⚙', run: () => SettingsUI.open() });
    R({ id: 'view.bg',           title: 'Change background', group: 'View', icon: '🖼', run: () => Background.open() });
    R({ id: 'view.focus',        title: 'Toggle focus mode', group: 'View', icon: '◰', shortcut: 'F11', run: () => UI.toggleFocus() });
    R({ id: 'view.palette',      title: 'Open command palette', group: 'View', icon: '⌘', shortcut: 'Ctrl+Shift+P', run: () => Palette.open() });
    R({ id: 'view.palette2',     title: 'Open command palette (alt)', group: 'View', icon: '⌘', shortcut: 'Ctrl+/', run: () => Palette.open() });
    R({ id: 'view.theme',        title: 'Toggle theme',    group: 'View', icon: '☾', run: () => $('#btn-theme').click() });
    R({ id: 'view.find',         title: 'Find & replace',  group: 'View', icon: '🔍', shortcut: 'Ctrl+F', run: () => Find.toggle(true) });
    R({ id: 'view.zoomIn',       title: 'Zoom in',         group: 'View', icon: '+', run: () => Settings.set('zoom', Math.min(200, Settings.get('zoom') + 10)) });
    R({ id: 'view.zoomOut',      title: 'Zoom out',        group: 'View', icon: '−', run: () => Settings.set('zoom', Math.max(50, Settings.get('zoom') - 10)) });
    R({ id: 'view.zoom100',      title: 'Reset zoom',      group: 'View', run: () => Settings.set('zoom', 100) });

    // Page style
    R({ id: 'page.paper', title: 'Page style: Paper',  group: 'Page', run: () => Settings.set('pageStyle','paper') });
    R({ id: 'page.sepia', title: 'Page style: Sepia',  group: 'Page', run: () => Settings.set('pageStyle','sepia') });
    R({ id: 'page.glass', title: 'Page style: Glass',  group: 'Page', run: () => Settings.set('pageStyle','glass') });
    R({ id: 'page.dark',  title: 'Page style: Dark',   group: 'Page', run: () => Settings.set('pageStyle','dark') });

    // Fonts (one command per font, searchable)
    for (const f of (window.VE_allFonts ? window.VE_allFonts() : [])) {
      R({
        id: 'font.' + f.name.toLowerCase().replace(/\s+/g, '-'),
        title: 'Font: ' + f.name,
        group: 'Font',
        icon: 'Aa',
        keywords: 'font typeface ' + f.group,
        run: () => {
          Editor.exec('fontName', f.family);
          $('#font-family').value = f.family;
        }
      });
    }

    // Backgrounds as commands
    for (const p of BG_PRESETS) {
      R({
        id: 'bg.' + p.id,
        title: 'Background: ' + (p.label || p.id.charAt(0).toUpperCase() + p.id.slice(1)),
        group: 'Background',
        icon: '▦',
        run: () => Background.apply(p.id === 'none' ? { type: 'none' } : { type: 'preset', id: p.id })
      });
    }

    // Edit
    R({ id: 'edit.undo', title: 'Undo', group: 'Edit', icon: '↶', shortcut: 'Ctrl+Z', run: () => Editor.exec('undo') });
    R({ id: 'edit.redo', title: 'Redo', group: 'Edit', icon: '↷', shortcut: 'Ctrl+Y', run: () => Editor.exec('redo') });

    // Templates — one searchable command per template
    for (const t of (window.VE_TEMPLATES || [])) {
      R({
        id: 'tpl.' + t.id,
        title: 'New from template: ' + t.name,
        group: 'Template',
        icon: t.icon || '◦',
        keywords: 'template new ' + (t.desc || ''),
        run: () => App.openTemplate(t)
      });
    }
  }

  /* ============================================================
     19. Smart quotes (optional)
     ============================================================ */
  function smartQuotesHandler(e) {
    if (!Settings.get('smartQuotes')) return;
    if (e.inputType !== 'insertText') return;
    if (e.data !== '"' && e.data !== "'") return;

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);

    // Look at the character immediately before the caret (in any text node
    // that happens to be there). Elements with a nested structure still work
    // because we only care about the character under startContainer/offset.
    let before = '';
    const n = r.startContainer;
    if (n.nodeType === 3 && r.startOffset > 0) {
      before = n.textContent.charAt(r.startOffset - 1);
    }

    const open = !before || /\s|[\(\[\{]/.test(before);
    const replacement = e.data === '"' ? (open ? '“' : '”')   // “ ”
                                       : (open ? '‘' : '’');  // ‘ ’

    // Cancel the browser's native insertion and insert the smart quote
    // via execCommand. This keeps undo history intact and lets the
    // browser manage the caret position — no manual range math needed.
    e.preventDefault();
    try { document.execCommand('insertText', false, replacement); }
    catch { /* older browser — fall back to letting the plain quote through */ }
  }

  /* ============================================================
     20. Init
     ============================================================ */

  /* ============================================================
     Reload everything under a (possibly new) account namespace.
     Called from VE_Auth.onChange when the user signs in or out.
     ============================================================ */
  async function reloadAfterAuthChange() {
    // 1. Flush current doc under the OLD namespace so no work is lost.
    Docs.saveCurrent();

    // 2. Switch IDB to the new namespace.
    window.VE_IDB.setNamespace(window.VE_Auth.namespace());

    // 3. Clear in-memory state and reload from IDB under the new namespace.
    Persist.cache = {
      docs: [], currentId: null, settings: null,
      theme: Persist.cache.theme,            // keep visual theme across accounts
      background: null
    };
    try { await Persist.loadAll(); } catch (e) { console.warn('loadAll', e); }

    Settings.data = { ...DEFAULT_SETTINGS, ...(Persist.cache.settings || {}) };
    Docs.all       = Persist.cache.docs || [];
    Docs.currentId = Persist.cache.currentId || null;

    // 4. Re-apply settings, background, and load current (or welcome) doc.
    Settings.apply();
    if (typeof Shortcuts !== 'undefined' && Commands.list.length) Shortcuts.rebuild();
    Background.loadSaved();
    const doc = Docs.ensureCurrent();
    Editor.load(doc);
    Docs.updateDocCount();

    // 5. Update the profile button avatars and re-apply the current route
    //    (so a refresh under the new account preserves view context).
    ProfileMenu.renderButtons();
    App._applyRoute(location.hash, { push: false });
  }

  async function init() {
    // 0. Start Auth synchronously so we can pick the right IDB namespace
    //    before we read anything. The Auth module restores any saved session
    //    from localStorage synchronously; the GIS script loads asynchronously.
    window.VE_Auth.init();
    window.VE_IDB.setNamespace(window.VE_Auth.namespace());

    // Migrate legacy data (always does its work under the 'guest' namespace)
    try { await window.VE_migrate(); } catch (e) { console.warn('migrate', e); }

    // Load this namespace's data
    try { await Persist.loadAll(); }   catch (e) { console.warn('loadAll', e); }

    // Seed state from cache
    if (Persist.cache.settings) {
      Settings.data = { ...DEFAULT_SETTINGS, ...Persist.cache.settings };
    }
    Docs.all       = Persist.cache.docs || [];
    Docs.currentId = Persist.cache.currentId || null;

    // Theme from storage — crystal-white (light) is the default
    document.documentElement.setAttribute('data-theme', Persist.cache.theme || 'light');

    // Fonts
    Fonts.load();
    Fonts.populate();

    // Editor + docs
    Editor.init();
    const doc = Docs.ensureCurrent();
    Editor.load(doc);

    // UI modules
    UI.init();
    Palette.init();
    SettingsUI.init();
    PageSetup.init();
    Find.init();
    TablePicker.init();
    Hub.init();
    App.init();
    AppLauncher.init();
    ProfileMenu.init();

    // Whenever the user signs in or out, swap the IDB namespace and
    // reload everything so each account has its own independent workspace.
    window.VE_Auth.onChange((user) => {
      reloadAfterAuthChange().catch((e) => console.warn('auth reload failed', e));
    });

    // File import input
    on($('#file-input'), 'change', () => {
      const f = $('#file-input').files[0];
      if (f) Export.importFile(f);
      $('#file-input').value = '';
    });

    // Background upload — compressed before storing to keep IndexedDB lean.
    on($('#btn-bg-upload'), 'click', () => $('#bg-input').click());
    on($('#btn-bg-clear'),  'click', () => { Background.apply({ type: 'none' }); Background.render(); });
    on($('#bg-input'), 'change', async () => {
      const f = $('#bg-input').files[0];
      if (!f) return;
      try {
        const dataUrl = await compressImageFile(f, 2048, 0.85);
        Background.apply({ type: 'image', data: dataUrl });
        Background.render();
      } catch (e) {
        console.warn('Background upload failed:', e);
      }
      $('#bg-input').value = '';
    });

    // Global keydown
    on(document, 'keydown', handleKeydown);
    on(document, 'keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('#overlay-palette').hidden) Palette.close();
        if (!$('#overlay-settings').hidden) SettingsUI.close();
        if (!$('#overlay-background').hidden) Background.close();
        if (!$('#overlay-page-setup').hidden) PageSetup.close();
        if (!$('#app-launcher').hidden) AppLauncher.close();
        if (!$('#profile-menu').hidden) ProfileMenu.close();
        // (Hub is now a full-screen view, not a modal — nothing to close on Esc)
        if (!$('#slash-menu').hidden) Slash.close();
      }
    });

    // Smart quotes
    on(Editor.el, 'beforeinput', smartQuotesHandler);

    // Flush the active doc to IDB whenever the tab is backgrounded or closed.
    on(window, 'beforeunload', () => Docs.saveCurrent());
    on(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') Docs.saveCurrent(); });

    // Register everything (now that all modules exist)
    registerCommands();
    // Build the shortcut table from command defaults + user overrides.
    Shortcuts.rebuild();

    // Apply settings + background
    Settings.apply();
    Background.loadSaved();
    Docs.updateDocCount();

    // Restore the last view from the URL hash (so refresh stays in the
    // document if you were editing one, or on the hub otherwise).
    Hub.show();
    App.restoreRoute();
  }

  document.addEventListener('DOMContentLoaded', init);

})();
