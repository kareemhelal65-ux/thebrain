/**
 * Document Generation Service — Professional Templates Engine
 *
 * Produces production-grade PDF, DOCX, PPTX, and CSV files.
 * Supports cover pages, TOC, headers/footers, tables, charts,
 * code blocks, and brand-themed styling.
 */

const path = require('path');
const fs = require('fs');

// Lazy-loaded libs
let PDFDocument, docx, pptxgen, csvWriter;

function loadLibs() {
  if (!PDFDocument) {
    try { PDFDocument = require('pdfkit'); } catch { PDFDocument = null; }
    try { docx = require('docx'); } catch { docx = null; }
    try { pptxgen = require('pptxgenjs'); } catch { pptxgen = null; }
    try { csvWriter = require('csv-writer'); } catch { csvWriter = null; }
  }
}

// ─── Brand Theme ───────────────────────────────────────────────────────────
const BRAND = {
  primary:    '#1E1B4B',   // Deep indigo
  secondary:  '#312E81',   // Indigo 800
  accent:     '#6366F1',   // Indigo 500
  accent2:    '#06B6D4',   // Cyan 500
  dark:       '#0F172A',   // Slate 900
  dark2:      '#1E293B',   // Slate 800
  surface:    '#F8FAFC',   // Slate 50
  text:       '#1E293B',   // Slate 800
  textMuted:  '#64748B',   // Slate 500
  accentWarm: '#F59E0B',   // Amber 500
  success:    '#10B981',   // Emerald 500
  danger:     '#EF4444',   // Red 500
  border:     '#CBD5E1',   // Slate 300
};

const TYPOGRAPHY = {
  title:       { size: 28, bold: true, color: BRAND.primary },
  h1:          { size: 20, bold: true, color: BRAND.primary },
  h2:          { size: 16, bold: true, color: BRAND.secondary },
  h3:          { size: 13, bold: true, color: BRAND.accent },
  body:        { size: 11, color: BRAND.text },
  small:       { size: 9,  color: BRAND.textMuted },
  caption:     { size: 8,  color: BRAND.textMuted },
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Detect if content is tabular (contains markdown table rows) */
function detectTables(content) {
  const tables = [];
  const lines = content.split('\n');
  let inTable = false;
  let current = { headers: [], rows: [], startLine: -1 };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      const cols = line.split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1 || arr.length <= 2 && c !== '');
      if (!inTable) {
        inTable = true;
        current = { headers: cols, rows: [], startLine: i };
      } else {
        // Check if separator row
        if (cols.every(c => /^[-:]+$/.test(c.replace(/\s/g, '')))) continue;
        current.rows.push(cols);
      }
    } else {
      if (inTable && current.rows.length > 0) {
        tables.push({ ...current, endLine: i });
      }
      inTable = false;
    }
  }
  if (inTable && current.rows.length > 0) tables.push(current);
  return tables;
}

/** Parse markdown and produce structured sections */
function parseContent(content) {
  const sections = [];
  const lines = content.split('\n');
  let currentSection = { type: 'paragraph', lines: [] };

  function flush() {
    // Determine if current section has content based on its type
    let hasContent = false;
    if (currentSection.type === 'paragraph' || currentSection.type === 'blockquote') {
      hasContent = currentSection.lines && currentSection.lines.length > 0;
    } else if (currentSection.type === 'list' || currentSection.type === 'orderedList') {
      hasContent = currentSection.items && currentSection.items.length > 0;
    }
    if (hasContent) {
      sections.push({ ...currentSection });
      currentSection = { type: 'paragraph', lines: [] };
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const stripped = line.trim();

    if (!stripped) {
      // empty line — flush paragraph
      if (currentSection.type === 'paragraph' && currentSection.lines.length > 0) {
        flush();
      } else if (currentSection.type !== 'paragraph') {
        flush();
      }
      continue;
    }

    if (stripped.startsWith('# ')) {
      flush();
      sections.push({ type: 'h1', text: stripped.substring(2).trim(), raw });
    } else if (stripped.startsWith('## ')) {
      flush();
      sections.push({ type: 'h2', text: stripped.substring(3).trim(), raw });
    } else if (stripped.startsWith('### ')) {
      flush();
      sections.push({ type: 'h3', text: stripped.substring(4).trim(), raw });
    } else if (stripped.startsWith('|') && stripped.endsWith('|')) {
      flush();
      // Detect table
      const cols = stripped.split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1 || arr.length <= 2 && c !== '');
      if (i + 1 < lines.length && lines[i+1].trim().startsWith('|') && lines[i+1].includes('-')) {
        // Header row
        const table = { type: 'table', headers: cols, rows: [] };
        i++; // skip separator
        i++;
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          const rowCols = lines[i].split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1 || arr.length <= 2 && c !== '');
          table.rows.push(rowCols);
          i++;
        }
        i--;
        sections.push(table);
      } else {
        // It's not a table, treat as paragraph
        currentSection.lines.push(stripped);
      }
    } else if (stripped.startsWith('- ') || stripped.startsWith('* ')) {
      if (currentSection.type !== 'list') {
        flush();
        currentSection = { type: 'list', items: [] };
      }
      currentSection.items.push(stripped.substring(2).trim());
    } else if (/^\d+\.\s/.test(stripped)) {
      if (currentSection.type !== 'orderedList') {
        flush();
        currentSection = { type: 'orderedList', items: [] };
      }
      currentSection.items.push(stripped.replace(/^\d+\.\s*/, '').trim());
    } else if (stripped.startsWith('```')) {
      flush();
      const lang = stripped.substring(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      sections.push({ type: 'code', language: lang, code: codeLines.join('\n') });
    } else if (stripped.startsWith('---') || stripped.startsWith('***')) {
      flush();
      sections.push({ type: 'hr' });
    } else if (stripped.startsWith('> ')) {
      if (currentSection.type !== 'blockquote') {
        flush();
        currentSection = { type: 'blockquote', lines: [] };
      }
      currentSection.lines.push(stripped.substring(2));
    } else {
      if (currentSection.type === 'paragraph') {
        currentSection.lines.push(stripped);
      } else {
        flush();
        currentSection = { type: 'paragraph', lines: [stripped] };
      }
    }
  }

  flush();
  return sections;
}

/** Extract title from content (first # heading) */
function extractTitle(content) {
  const match = content.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : 'Untitled Document';
}

/** Escape text for XML-based formats */
function escXml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════════════════════
//  HTML BUILDING  —  one self-contained, inline-CSS, print-friendly document
//  used for BOTH the .html export AND (via Playwright) the .pdf export. Handles
//  markdown content, raw HTML content, and ```html-fenced HTML transparently.
// ═══════════════════════════════════════════════════════════════════════════

/** Escape HTML special chars in plain text. */
function escHtml(text) {
  return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Convert inline markdown (code, bold, italic, links) in plain text to safe HTML. */
function inlineMd(text) {
  let s = escHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

function isFullHtmlDoc(s) {
  return typeof s === 'string' && (/^\s*<!doctype html/i.test(s) || /<html[\s>]/i.test(s));
}

/** Heuristic: is this string already HTML (a fragment with several block tags)? */
function isLikelyHtml(content) {
  if (typeof content !== 'string') return false;
  if (isFullHtmlDoc(content)) return true;
  const tagCount = (content.match(/<(div|section|article|h[1-6]|table|thead|tbody|tr|td|ul|ol|li|p|header|main|style|span)\b/gi) || []).length;
  return tagCount >= 3;
}

/** Pull the inner HTML out of a ```html fenced block, if present. */
function extractFencedHtml(content) {
  const m = typeof content === 'string' && content.match(/```html\s*\n?([\s\S]*?)```/i);
  return m ? m[1].trim() : null;
}

/** Is this content a standalone SVG image? */
function isLikelySvg(content) {
  return typeof content === 'string' && /^\s*<svg[\s>]/i.test(content.trim()) && /<\/svg>/i.test(content);
}

/** Pull the inner SVG out of a ```svg fenced block, if present. */
function extractFencedSvg(content) {
  const m = typeof content === 'string' && content.match(/```svg\s*\n?([\s\S]*?)```/i);
  return m ? m[1].trim() : null;
}

// Print rules that make the browser repaginate to AVOID splitting tables rows,
// paragraphs, list items, code and blockquotes across pages, repeat table headers
// on every page, and wrap long words so nothing is clipped. Applied to agent HTML too.
const PRINT_CSS = '<style>@page{margin:16mm 14mm;}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}thead{display:table-header-group;}table{break-inside:auto;}tr,img,figure,p,li,blockquote,pre{break-inside:avoid;page-break-inside:avoid;}h1,h2,h3,h4{break-after:avoid;page-break-after:avoid;}td,th{overflow-wrap:anywhere;word-break:break-word;}pre,code{white-space:pre-wrap;overflow-wrap:anywhere;}}</style>';
function injectPrintCss(doc) {
  return /<\/head>/i.test(doc) ? doc.replace(/<\/head>/i, PRINT_CSS + '</head>') : doc;
}

/** Convert parsed markdown sections into semantic HTML (styled by the template). */
function markdownSectionsToHtml(content) {
  return sectionsToHtml(parseContent(content));
}

function sectionsToHtml(sections) {
  let html = '';
  for (const sec of sections) {
    switch (sec.type) {
      case 'h1': html += `<h1>${inlineMd(sec.text)}</h1>\n`; break;
      case 'h2': html += `<h2>${inlineMd(sec.text)}</h2>\n`; break;
      case 'h3': html += `<h3>${inlineMd(sec.text)}</h3>\n`; break;
      case 'paragraph': { const t = sec.lines.join(' '); if (t.trim()) html += `<p>${inlineMd(t)}</p>\n`; break; }
      case 'list': html += '<ul>' + sec.items.map(it => `<li>${inlineMd(it)}</li>`).join('') + '</ul>\n'; break;
      case 'orderedList': html += '<ol>' + sec.items.map(it => `<li>${inlineMd(it)}</li>`).join('') + '</ol>\n'; break;
      case 'blockquote': html += `<blockquote>${inlineMd(sec.lines.join(' '))}</blockquote>\n`; break;
      case 'code': html += `<pre><code>${escHtml(sec.code)}</code></pre>\n`; break;
      case 'hr': html += '<hr/>\n'; break;
      case 'table':
        if (sec.headers && sec.rows && sec.rows.length) {
          html += '<table><thead><tr>' + sec.headers.map(h => `<th>${inlineMd(h)}</th>`).join('') + '</tr></thead><tbody>'
            + sec.rows.map(r => '<tr>' + r.map(c => `<td>${inlineMd(c)}</td>`).join('') + '</tr>').join('')
            + '</tbody></table>\n';
        }
        break;
    }
  }
  return html;
}

function htmlTemplate(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escHtml(title)}</title>
<style>
  :root{--brand:#6366f1;--ink:#1e293b;--muted:#64748b;--line:#e2e8f0;}
  *{box-sizing:border-box;}
  body{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:#fff;margin:0;line-height:1.6;}
  .doc{max-width:820px;margin:0 auto;padding:40px 32px 64px;}
  .doc-header{border-bottom:3px solid var(--brand);padding-bottom:12px;margin-bottom:28px;}
  .doc-eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--brand);font-weight:700;}
  .doc-title{font-size:30px;font-weight:800;margin:6px 0 2px;color:#0f172a;}
  .doc-date{font-size:12px;color:var(--muted);}
  h1{font-size:24px;font-weight:800;margin:28px 0 10px;color:#0f172a;border-bottom:1px solid var(--line);padding-bottom:6px;}
  h2{font-size:19px;font-weight:700;margin:22px 0 8px;color:#1e293b;}
  h3{font-size:15px;font-weight:700;margin:16px 0 6px;color:var(--brand);}
  p{margin:8px 0;}
  ul,ol{margin:8px 0;padding-left:22px;}
  li{margin:3px 0;}
  a{color:var(--brand);text-decoration:none;}
  blockquote{border-left:3px solid var(--brand);margin:12px 0;padding:4px 14px;color:var(--muted);font-style:italic;background:#f8fafc;}
  code{background:#f1f5f9;padding:1px 5px;border-radius:4px;font-family:'SFMono-Regular',Consolas,monospace;font-size:.9em;}
  pre{background:#0f172a;color:#e2e8f0;padding:14px 16px;border-radius:8px;overflow-x:auto;font-size:12.5px;white-space:pre-wrap;overflow-wrap:anywhere;}
  pre code{background:transparent;color:inherit;padding:0;}
  hr{border:none;border-top:1px solid var(--line);margin:20px 0;}
  table{border-collapse:collapse;width:100%;margin:14px 0;font-size:13px;}
  th{background:var(--brand);color:#fff;text-align:left;padding:8px 10px;font-weight:600;}
  td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;word-break:break-word;overflow-wrap:anywhere;}
  tbody tr:nth-child(even){background:#f8fafc;}
  @page{margin:16mm 14mm;}
  @media print{
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .doc{padding:0;max-width:none;}
    thead{display:table-header-group;}
    table{break-inside:auto;table-layout:fixed;}
    tr,img,figure,p,li,blockquote,pre{break-inside:avoid;page-break-inside:avoid;}
    h1,h2,h3,h4{break-after:avoid;page-break-after:avoid;}
  }
</style></head>
<body><div class="doc">
  <div class="doc-header">
    <div class="doc-eyebrow">The Brain AIOS</div>
    <div class="doc-title">${escHtml(title)}</div>
    <div class="doc-date">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
  </div>
  ${bodyHtml}
</div></body></html>`;
}

/**
 * Produce a complete, self-contained, print-friendly HTML document from content
 * that may be markdown, an HTML fragment, a ```html-fenced block, or a full HTML doc.
 */
function buildStyledHtml(title, content) {
  if (typeof content === 'string') {
    // Standalone SVG (full or ```svg-fenced) → render it centered on the page.
    const svg = extractFencedSvg(content) || (isLikelySvg(content) ? content.trim() : null);
    if (svg) {
      return htmlTemplate(title, `<div style="display:flex;justify-content:center;align-items:center;padding:24px;"><div style="max-width:560px;width:100%;">${svg}</div></div>`);
    }
    const fenced = extractFencedHtml(content);
    const candidate = fenced || content;
    if (isFullHtmlDoc(candidate)) return injectPrintCss(candidate);
    if (fenced || isLikelyHtml(candidate)) return htmlTemplate(title, candidate);
  }
  return htmlTemplate(title, markdownSectionsToHtml(content));
}

/** Render markdown content as a slide deck preview (one card per H1/H2). */
function buildSlidesHtml(title, content) {
  const sections = parseContent(content);
  const slides = [];
  let cur = null;
  for (const sec of sections) {
    if (sec.type === 'h1' || sec.type === 'h2') {
      if (cur) slides.push(cur);
      cur = { heading: sec.text, body: [] };
    } else {
      if (!cur) cur = { heading: title, body: [] };
      cur.body.push(sec);
    }
  }
  if (cur) slides.push(cur);
  if (slides.length === 0) slides.push({ heading: title, body: sections });

  const slideCards = slides.map((s, i) => `
    <div class="slide">
      <div class="slide-bar"></div>
      <div class="slide-num">${i + 1} / ${slides.length}</div>
      <h2 class="slide-title">${escHtml(s.heading)}</h2>
      <div class="slide-body">${sectionsToHtml(s.body)}</div>
    </div>`).join('\n');

  const css = `
    :root{--brand:#6366f1;--ink:#1e293b;--muted:#64748b;--line:#e2e8f0;}
    *{box-sizing:border-box;}
    body{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:#0f172a;margin:0;padding:24px;}
    .deck{max-width:1000px;margin:0 auto;display:flex;flex-direction:column;gap:22px;}
    .slide{position:relative;background:#fff;border-radius:14px;aspect-ratio:16/9;padding:42px 48px;box-shadow:0 10px 30px rgba(0,0,0,.35);overflow:hidden;}
    .slide-bar{position:absolute;top:0;left:0;right:0;height:6px;background:linear-gradient(90deg,var(--brand),#06b6d4);}
    .slide-num{position:absolute;top:16px;right:20px;font-size:12px;color:var(--muted);font-weight:600;}
    .slide-title{font-size:28px;font-weight:800;color:#0f172a;margin:8px 0 18px;}
    .slide-body{font-size:16px;line-height:1.55;color:#334155;}
    .slide-body h3{font-size:16px;color:var(--brand);margin:10px 0 4px;}
    .slide-body ul,.slide-body ol{padding-left:22px;margin:6px 0;}
    .slide-body table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0;}
    .slide-body th{background:var(--brand);color:#fff;padding:6px 8px;text-align:left;}
    .slide-body td{padding:6px 8px;border-bottom:1px solid var(--line);}
    @media print{body{background:#fff;padding:0;}.slide{box-shadow:none;border:1px solid var(--line);break-inside:avoid;margin-bottom:14px;}}`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escHtml(title)}</title><style>${css}</style></head><body><div class="deck">${slideCards}</div></body></html>`;
}

/**
 * Build an in-OS preview document for ANY target format. Same styling the export
 * uses, so the preview is faithful ("what you preview is what you get"):
 *  - pptx → slide-deck view
 *  - csv / pdf / docx / md / html / txt → styled document view (tables, headings…)
 */
function buildPreviewHtml(title, content, format) {
  const f = String(format || '').toLowerCase();
  if (content && typeof content === 'object') content = jsonToMarkdown(content, { title });
  if (f === 'pptx') return buildSlidesHtml(title, content);
  return buildStyledHtml(title, content);
}

// ═══════════════════════════════════════════════════════════════════════════
//  PDF GENERATION  —  Professional-grade with pdfkit
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Primary PDF path: render the styled HTML through headless Chromium (Playwright)
 * so tables wrap and paginate correctly and agent-authored HTML renders as a real
 * page (not raw source). Falls back to the pdfkit renderer if the browser fails.
 */
async function generatePDFViaBrowser(title, content, outputPath, options = {}) {
  const { chromium } = require('playwright');
  const html = buildStyledHtml(title, content);
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'networkidle', timeout: 15000 });
    } catch {
      // A slow/offline external asset can stall networkidle; the content is already
      // set, so proceed to print anyway.
    }

    // ── Self-correction pass: render in print mode and verify quality ──
    // The print CSS already keeps rows/paragraphs from splitting and repeats table
    // headers. Here we additionally detect and fix horizontal overflow (the main
    // cause of clipped/invisible words): shrink any table whose content would spill
    // past the page width until every cell fits, so nothing is cut off.
    try {
      await page.emulateMedia({ media: 'print' });
      const adjustments = await page.evaluate(() => {
        let fixed = 0;
        document.querySelectorAll('table').forEach((t) => {
          const el = /** @type {HTMLElement} */ (t);
          el.style.tableLayout = 'fixed';
          el.style.width = '100%';
          let fs = parseFloat(getComputedStyle(el).fontSize) || 13;
          let guard = 0;
          // Shrink font + tighten padding until the table no longer overflows.
          while (el.scrollWidth > el.clientWidth + 1 && fs > 8 && guard < 8) {
            fs -= 1; guard += 1;
            el.style.fontSize = fs + 'px';
            el.querySelectorAll('th,td').forEach((c) => {
              const cell = /** @type {HTMLElement} */ (c);
              cell.style.padding = '4px 6px';
              cell.style.overflowWrap = 'anywhere';
              cell.style.wordBreak = 'break-word';
            });
          }
          if (guard > 0) fixed += 1;
        });
        return fixed;
      });
      if (adjustments > 0) console.log(`[DocGen] PDF self-correction: fitted ${adjustments} oversized table(s).`);
    } catch (e) {
      console.warn('[DocGen] PDF self-correction skipped:', e.message);
    }

    await page.pdf({
      path: outputPath,
      format: options.pageSize || 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    });
    return outputPath;
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
}

async function generatePDF(title, content, outputPath, options = {}) {
  try {
    return await generatePDFViaBrowser(title, content, outputPath, options);
  } catch (err) {
    console.warn('[DocGen] Browser PDF failed, falling back to pdfkit:', err.message);
    return await generatePDFLegacy(title, content, outputPath, options);
  }
}

async function generatePDFLegacy(title, content, outputPath, options = {}) {
  if (!PDFDocument) throw new Error('pdfkit not available');
  const DocClass = PDFDocument;

  return new Promise((resolve, reject) => {
    const doc = new DocClass({
      size: options.pageSize || 'A4',
      margin: 54,
      info: {
        Title: title,
        Creator: 'The Brain AIOS',
        Producer: 'pdfkit',
      },
      bufferPages: true,
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const pageWidth = doc.page.width - doc.options.margin * 2;
    let pageNum = 0;

    // ── Page event: header + footer (shapes only to avoid recursive page breaks) ──
    doc.on('pageAdded', () => {
      pageNum++;
    });

    // ── Helper: render header/footer text on a page after it's been finalized ──
    function addHeaderFooterToPage(pgIndex) {
      doc.switchToPage(pgIndex);
      const margin = doc.page.margins.left;
      const pw = doc.page.width - margin * 2;
      // Header decorative line
      doc.save();
      doc.rect(margin, 30, pw, 1).fill('#E2E8F0');
      doc.restore();
      // Header text
      doc.save();
      doc.fontSize(8).font('Helvetica').fillColor(BRAND.textMuted);
      doc.text(title.length > 80 ? title.substring(0, 77) + '...' : title, margin, 34, {
        width: pw, align: 'left', lineBreak: false
      });
      doc.restore();
      // Footer line
      doc.save();
      doc.rect(margin, doc.page.height - 40, pw, 1).fill('#E2E8F0');
      doc.restore();
      // Footer text
      doc.save();
      doc.fontSize(8).font('Helvetica').fillColor(BRAND.textMuted);
      doc.text(`Page ${pgIndex} | The Brain AIOS`, margin, doc.page.height - 35, {
        width: pw, align: 'center', lineBreak: false
      });
      doc.restore();
    }

    // ── Cover Page ──
    const coverBg = options.brandColor || BRAND.dark;
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(coverBg);
    doc.save();
    // Decorative accent bar
    doc.rect(0, doc.page.height * 0.4, doc.page.width, 4).fill(BRAND.accent);
    // Title
    doc.fontSize(36).font('Helvetica-Bold').fillColor('#FFFFFF')
      .text(title, doc.options.margin, doc.page.height * 0.45, {
        width: pageWidth, align: 'center'
      });
    // Subtitle / date
    doc.fontSize(14).font('Helvetica').fillColor(BRAND.accent2)
      .text(`Generated by The Brain AIOS • ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
        doc.options.margin, doc.page.height * 0.55, { width: pageWidth, align: 'center' });
    doc.restore();
    doc.addPage();

    // ── Table of Contents ──
    const tocEntries = [];
    const sections = parseContent(content);
    let tocPage = pageNum + 1;

    doc.fontSize(20).font('Helvetica-Bold').fillColor(BRAND.primary)
      .text('Table of Contents', doc.options.margin, doc.y, { underline: false });
    doc.moveDown(1);
    doc.fontSize(10).font('Helvetica').fillColor(BRAND.textMuted)
      .text(`The following sections are contained in this document:`, { width: pageWidth });
    doc.moveDown(1.5);

    for (const sec of sections) {
      if (sec.type === 'h1') {
        tocEntries.push({ text: sec.text, level: 1, page: pageNum });
        doc.fontSize(12).font('Helvetica-Bold').fillColor(BRAND.text)
          .text(`  ${sec.text}`, { indent: 0, continued: true, width: pageWidth - 80 });
      } else if (sec.type === 'h2') {
        tocEntries.push({ text: sec.text, level: 2, page: pageNum });
        doc.fontSize(11).font('Helvetica').fillColor(BRAND.textMuted)
          .text(`    ${sec.text}`, { indent: 15, width: pageWidth });
      }
    }
    doc.addPage();

    // ── Render Content ──
    function renderSection(sec) {
      const col = (name) => TYPOGRAPHY[name] || TYPOGRAPHY.body;

      switch (sec.type) {
        case 'h1':
          doc.moveDown(1);
          doc.fontSize(col('h1').size).font('Helvetica-Bold').fillColor(col('h1').color)
            .text(sec.text, { underline: false, paragraphGap: 8 });
          doc.moveDown(0.5);
          // Underline accent
          doc.rect(doc.options.margin, doc.y - 4, 60, 3).fill(BRAND.accent);
          doc.moveDown(0.5);
          break;

        case 'h2':
          doc.moveDown(0.8);
          doc.fontSize(col('h2').size).font('Helvetica-Bold').fillColor(col('h2').color)
            .text(sec.text);
          doc.moveDown(0.3);
          break;

        case 'h3':
          doc.moveDown(0.5);
          doc.fontSize(col('h3').size).font('Helvetica-Bold').fillColor(col('h3').color)
            .text(sec.text);
          doc.moveDown(0.2);
          break;

        case 'paragraph': {
          const text = sec.lines.join(' ');
          if (text.trim()) {
            doc.fontSize(col('body').size).font('Helvetica').fillColor(col('body').color)
              .text(text, {
                align: 'justify',
                paragraphGap: 6,
                lineGap: 2,
                indent: 0,
              });
          }
          break;
        }

        case 'list':
          for (const item of sec.items) {
            const bulletColor = BRAND.accent;
            doc.save();
            doc.fontSize(11).font('Helvetica-Bold').fillColor(bulletColor)
              .text('•', doc.options.margin, doc.y, { width: 15 });
            doc.restore();
            doc.fontSize(col('body').size).font('Helvetica').fillColor(col('body').color)
              .text(` ${item}`, doc.options.margin + 15, doc.y - 16, {
                width: pageWidth - 15, paragraphGap: 4, lineGap: 1
              });
          }
          doc.moveDown(0.3);
          break;

        case 'orderedList':
          sec.items.forEach((item, idx) => {
            doc.fontSize(col('body').size).font('Helvetica-Bold').fillColor(BRAND.accent)
              .text(`${idx + 1}.`, doc.options.margin, doc.y, { width: 20 });
            doc.font('Helvetica').fillColor(col('body').color)
              .text(` ${item}`, doc.options.margin + 20, doc.y - 16, {
                width: pageWidth - 20, paragraphGap: 4
              });
          });
          doc.moveDown(0.3);
          break;

        case 'table':
          if (sec.headers && sec.rows && sec.rows.length > 0) {
            const colCount = sec.headers.length;
            const colW = pageWidth / colCount;
            const rowH = 22;

            // Header row
            let yStart = doc.y;
            sec.headers.forEach((header, ci) => {
              const x = doc.options.margin + ci * colW;
              doc.save();
              doc.rect(x, yStart, colW, rowH).fill(BRAND.secondary);
              doc.restore();
              doc.fontSize(9).font('Helvetica-Bold').fillColor('#FFFFFF')
                .text(header, x + 4, yStart + 6, { width: colW - 8, align: 'left' });
            });

            // Data rows
            sec.rows.forEach((row, ri) => {
              const y = yStart + rowH + ri * rowH;
              const bg = ri % 2 === 0 ? BRAND.surface : '#FFFFFF';
              row.forEach((cell, ci) => {
                const x = doc.options.margin + ci * colW;
                doc.save();
                doc.rect(x, y, colW, rowH).fill(bg);
                doc.rect(x, y, colW, rowH).strokeColor(BRAND.border).stroke();
                doc.restore();
                doc.fontSize(9).font('Helvetica').fillColor(BRAND.text)
                  .text(cell, x + 4, y + 5, { width: colW - 8, align: 'left' });
              });
            });
            doc.y = yStart + rowH + sec.rows.length * rowH + 10;
          }
          break;

        case 'code':
          doc.save();
          doc.roundedRect(doc.options.margin, doc.y, pageWidth, 20, 4)
            .fill(BRAND.dark2);
          doc.restore();
          doc.fontSize(8).font('Courier').fillColor(BRAND.accent2)
            .text(sec.code, doc.options.margin + 8, doc.y - 18, {
              width: pageWidth - 16, lineGap: 2
            });
          doc.moveDown(0.5);
          break;

        case 'blockquote':
          doc.save();
          doc.rect(doc.options.margin, doc.y - 4, 4, 15).fill(BRAND.accent);
          doc.restore();
          doc.fontSize(10).font('Helvetica-Oblique').fillColor(BRAND.textMuted)
            .text(sec.lines.join(' '), doc.options.margin + 12, doc.y, {
              width: pageWidth - 16, paragraphGap: 4
            });
          break;

        case 'hr':
          doc.save();
          doc.moveDown(0.5);
          doc.rect(doc.options.margin, doc.y, pageWidth, 1).fill(BRAND.border);
          doc.moveDown(0.5);
          doc.restore();
          break;
      }
    }

    // Render content sections
    for (const sec of sections) {
      renderSection(sec);
    }

    // Final page numbering + header/footer for all pages (skip cover page)
    const totalPages = doc.bufferedPageRange().count;
    for (let i = 1; i < totalPages; i++) {
      addHeaderFooterToPage(i);
    }

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  DOCX GENERATION  —  Professional-grade with docx v9
// ═══════════════════════════════════════════════════════════════════════════

async function generateDOCX(title, content, outputPath, options = {}) {
  if (!docx) throw new Error('docx package not available');
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    Header, Footer, PageNumber, HeadingLevel, AlignmentType,
    WidthType, BorderStyle, ShadingType, TableOfContents,
    PageBreak, TabStopPosition, TabStopType
  } = docx;

  const themeColor = options.brandColor || BRAND.primary;
  const sections = parseContent(content);
  const children = [];

  // ── Title Page ──
  children.push(new Paragraph({ spacing: { before: 3000 } }));
  children.push(new Paragraph({          children: [new TextRun({ text: title, bold: true, size: 52, color: themeColor })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        }));
          children.push(new Paragraph({
          children: [new TextRun({
      text: `Generated by The Brain AIOS • ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
      size: 24, color: BRAND.accent2, italics: true
    })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: '', size: 1 })],
    spacing: { before: 2000 }
  }));
  children.push(new PageBreak());

  // ── Table of Contents ──
  children.push(new Paragraph({
    children: [new TextRun({ text: 'Table of Contents', bold: true, size: 36, color: BRAND.primary })],
    spacing: { after: 400 },
  }));
  children.push(new TableOfContents("Table of Contents", {
    hyperlink: true,
    headingStyleRange: "1-3",
  }));
  children.push(new PageBreak());

  // ── Content ──
  for (const sec of sections) {
    switch (sec.type) {
      case 'h1':
        children.push(new Paragraph({
          children: [new TextRun({ text: sec.text, bold: true, size: 36, color: themeColor })],
          spacing: { before: 400, after: 200 },
          heading: HeadingLevel.HEADING_1,
          thematicBreak: true,
        }));
        break;

      case 'h2':
        children.push(new Paragraph({
          children: [new TextRun({ text: sec.text, bold: true, size: 28, color: BRAND.secondary })],
          spacing: { before: 300, after: 150 },
          heading: HeadingLevel.HEADING_2,
        }));
        break;

      case 'h3':
        children.push(new Paragraph({
          children: [new TextRun({ text: sec.text, bold: true, size: 24, color: BRAND.accent })],
          spacing: { before: 200, after: 100 },
          heading: HeadingLevel.HEADING_3,
        }));
        break;

      case 'paragraph': {
        const text = sec.lines.join(' ');
        if (text.trim()) {
          children.push(new Paragraph({
            children: [new TextRun({ text, size: 21, color: BRAND.text })],
            spacing: { after: 200 },
            alignment: AlignmentType.JUSTIFIED,
          }));
        }
        break;
      }

      case 'list':
        for (const item of sec.items) {
          children.push(new Paragraph({
            children: [
              new TextRun({ text: '•  ', bold: true, size: 21, color: BRAND.accent }),
              new TextRun({ text: item, size: 21, color: BRAND.text }),
            ],
            spacing: { after: 100 },
            indent: { left: 720 },
          }));
        }
        break;

      case 'orderedList':
        sec.items.forEach((item, idx) => {
          children.push(new Paragraph({
            children: [
              new TextRun({ text: `${idx + 1}.  `, bold: true, size: 21, color: BRAND.accent }),
              new TextRun({ text: item, size: 21, color: BRAND.text }),
            ],
            spacing: { after: 100 },
            indent: { left: 720 },
          }));
        });
        break;

      case 'table':
        if (sec.headers && sec.rows) {
          const tableRows = [];
          // Header row
          tableRows.push(new TableRow({
            tableHeader: true,
            children: sec.headers.map(h => new TableCell({
              children: [new Paragraph({
                children: [new TextRun({ text: h, bold: true, size: 20, color: 'FFFFFF' })],
                alignment: AlignmentType.CENTER,
              })],
              shading: { type: ShadingType.CLEAR, fill: BRAND.secondary.replace('#', '') },
              verticalAlign: 'center',
            })),
          }));
          // Data rows
          sec.rows.forEach((row, ri) => {
            tableRows.push(new TableRow({
              children: row.map(cell => new TableCell({
                children: [new Paragraph({
                  children: [new TextRun({ text: cell, size: 19, color: BRAND.text })],
                })],
                shading: ri % 2 === 0
                  ? { type: ShadingType.CLEAR, fill: BRAND.surface.replace('#', '') }
                  : undefined,
              })),
            }));
          });
          children.push(new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tableRows,
          }));
          children.push(new Paragraph({ spacing: { after: 200 } }));
        }
        break;

      case 'code':
        children.push(new Paragraph({
          children: [new TextRun({
            text: sec.code,
            size: 16,
            font: 'Courier New',
            color: BRAND.accent2,
          })],
          spacing: { after: 200 },
          indent: { left: 360 },
          shading: { type: ShadingType.CLEAR, fill: BRAND.dark2.replace('#', '') },
        }));
        break;

      case 'blockquote':
        children.push(new Paragraph({
          children: [
            new TextRun({ text: '  │  ', size: 24, color: BRAND.accent }),
            new TextRun({ text: sec.lines.join(' '), size: 20, color: BRAND.textMuted, italics: true }),
          ],
          spacing: { after: 200 },
          indent: { left: 360 },
        }));
        break;

      case 'hr':
        children.push(new Paragraph({
          children: [new TextRun({ text: '─'.repeat(50), size: 12, color: BRAND.border })],
          spacing: { after: 200, before: 200 },
          alignment: AlignmentType.CENTER,
        }));
        break;
    }
  }

  const docInstance = new Document({
    creator: 'The Brain AIOS',
    title,
    description: `Generated document: ${title}`,
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 21, color: BRAND.text },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({ text: title, size: 16, color: BRAND.textMuted, italics: true })],
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: BRAND.border.replace('#', '') } },
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: 'Page ', size: 16, color: BRAND.textMuted }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: BRAND.textMuted }),
              new TextRun({ text: ' of ', size: 16, color: BRAND.textMuted }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: BRAND.textMuted }),
            ],
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 1, color: BRAND.border.replace('#', '') } },
          })],
        }),
      },
      children,
    }],
  });

  const buffer = await Packer.toBuffer(docInstance);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PPTX GENERATION  —  Professional-grade with pptxgenjs
// ═══════════════════════════════════════════════════════════════════════════

async function generatePPTX(title, content, outputPath, options = {}) {
  if (!pptxgen) throw new Error('pptxgenjs not available');
  const PptxGenJS = pptxgen;
  const pres = new PptxGenJS();

  // ── Theme / Master ──
  const themeColor = options.brandColor || BRAND.dark;
  pres.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pres.layout = 'WIDE';

  const sections = parseContent(content);

  // ── 1. Title Slide ──
  const titleSlide = pres.addSlide();
  titleSlide.background = { fill: themeColor };
  // Accent bar
  titleSlide.addShape(pres.ShapeType.rect, {
    x: 0, y: 3.2, w: 13.33, h: 0.08, fill: { color: BRAND.accent }
  });
  titleSlide.addText(title, {
    x: 0.8, y: 1.8, w: 11.73, h: 1.8,
    fontSize: 36, bold: true, color: 'FFFFFF', fontFace: 'Arial', align: 'center',
  });
  titleSlide.addText(`Generated by The Brain AIOS • ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, {
    x: 0.8, y: 3.6, w: 11.73, h: 0.6,
    fontSize: 14, color: BRAND.accent2, fontFace: 'Arial', align: 'center',
  });
  titleSlide.addShape(pres.ShapeType.rect, {
    x: 5.5, y: 6.5, w: 2.33, h: 0.04, fill: { color: BRAND.accent2 }
  });

  // ── 2. Content Slides ──
  // Group sections into slides (a slide = one h1/h2 or a grouping of follow-up content)
  let slideAccumulator = { heading: '', body: [], hasHeading: false };

  function flushSlide() {
    if (!slideAccumulator.hasHeading && slideAccumulator.body.length === 0) return;
    const slide = pres.addSlide();
    slide.background = { fill: 'F8FAFC' };

    // Top accent bar
    slide.addShape(pres.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 0.06, fill: { color: BRAND.accent }
    });

    if (slideAccumulator.heading) {
      slide.addText(slideAccumulator.heading, {
        x: 0.6, y: 0.3, w: 12.13, h: 0.8,
        fontSize: 24, bold: true, color: BRAND.primary, fontFace: 'Arial',
      });
      // Underline accent dot
      slide.addShape(pres.ShapeType.ellipse, {
        x: 0.6, y: 1.05, w: 0.4, h: 0.04, fill: { color: BRAND.accent }
      });
    }

    const bodyY = slideAccumulator.hasHeading ? 1.4 : 0.5;
    const bodyItems = [];

    for (const item of slideAccumulator.body) {
      if (item.type === 'bullet') {
        bodyItems.push({
          text: item.text,
          options: { bullet: { code: '2022', color: BRAND.accent }, fontSize: 14, color: BRAND.text, fontFace: 'Arial', breakLine: true, paraSpaceAfter: 6, indentLevel: 0 }
        });
      } else if (item.type === 'text') {
        bodyItems.push({
          text: item.text,
          options: { fontSize: 13, color: BRAND.textMuted, fontFace: 'Arial', breakLine: true, paraSpaceAfter: 8 }
        });
      } else if (item.type === 'code') {
        bodyItems.push({
          text: item.code,
          options: { fontSize: 10, color: BRAND.accent2, fontFace: 'Courier New', breakLine: true, paraSpaceAfter: 4 }
        });
      }
    }

    if (bodyItems.length > 0) {
      slide.addText(bodyItems, {
        x: 0.6, y: bodyY, w: 12.13, h: 5.5,
        valign: 'top',
        lineSpacingMultiple: 1.3,
      });
    }

    // Footer
    slide.addText(`The Brain AIOS • ${title}`, {
      x: 0.6, y: 7.0, w: 5, h: 0.3,
      fontSize: 8, color: BRAND.textMuted, fontFace: 'Arial',
    });
  }

  for (const sec of sections) {
    if (sec.type === 'h1' || sec.type === 'h2') {
      flushSlide();
      slideAccumulator = { heading: sec.text, body: [], hasHeading: true };
    } else if (sec.type === 'h3') {
      slideAccumulator.body.push({ type: 'text', text: sec.text });
    } else if (sec.type === 'paragraph') {
      slideAccumulator.body.push({ type: 'text', text: sec.lines.join(' ') });
    } else if (sec.type === 'list') {
      for (const item of sec.items) {
        slideAccumulator.body.push({ type: 'bullet', text: item });
      }
    } else if (sec.type === 'orderedList') {
      sec.items.forEach((item, idx) => {
        slideAccumulator.body.push({ type: 'bullet', text: `${idx + 1}. ${item}` });
      });
    } else if (sec.type === 'code') {
      slideAccumulator.body.push({ type: 'code', code: sec.code.substring(0, 300) });
    } else if (sec.type === 'table') {
      if (sec.headers && sec.rows) {
        // Render a small table on the slide
        slideAccumulator.body.push({ type: 'text', text: `[Table: ${sec.headers.join(' | ')}]` });
      }
    } else if (sec.type === 'blockquote') {
      slideAccumulator.body.push({ type: 'text', text: `"${sec.lines.join(' ')}"` });
    }
  }
  flushSlide();

  // ── 3. Closing Slide ──
  const closeSlide = pres.addSlide();
  closeSlide.background = { fill: themeColor };
  closeSlide.addText('Thank You', {
    x: 0.8, y: 2.5, w: 11.73, h: 1.2,
    fontSize: 40, bold: true, color: 'FFFFFF', fontFace: 'Arial', align: 'center',
  });
  closeSlide.addText('This document was generated by The Brain AIOS', {
    x: 0.8, y: 3.8, w: 11.73, h: 0.6,
    fontSize: 16, color: BRAND.accent2, fontFace: 'Arial', align: 'center',
  });
  closeSlide.addShape(pres.ShapeType.rect, {
    x: 5.5, y: 6.5, w: 2.33, h: 0.04, fill: { color: BRAND.accent }
  });

  await pres.writeFile({ fileName: outputPath });
  return outputPath;
}

// ═══════════════════════════════════════════════════════════════════════════
//  CSV GENERATION  —  Intelligent table detection
// ═══════════════════════════════════════════════════════════════════════════

async function generateCSV(title, content, outputPath, options = {}) {
  if (!csvWriter) throw new Error('csv-writer not available');
  const { createObjectCsvWriter } = csvWriter;

  const tables = detectTables(content);
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

  if (tables.length > 0) {
    // Use ALL detected tables
    let csvOutput = '';
    for (let ti = 0; ti < tables.length; ti++) {
      const table = tables[ti];
      if (ti > 0) csvOutput += '\n\n';
      // Quote-escape each cell
      const escCell = c => `"${String(c).replace(/"/g, '""')}"`;
      if (table.headers && table.headers.length > 0) {
        csvOutput += table.headers.map(escCell).join(',') + '\n';
      }
      for (const row of table.rows) {
        csvOutput += row.map(escCell).join(',') + '\n';
      }
    }
    fs.writeFileSync(outputPath, '\uFEFF' + csvOutput, 'utf8');
    return outputPath;
  }

  // Fallback: no tables found — produce a structured content CSV
  const sections = parseContent(content);
  const records = [];

  for (const sec of sections) {
    if (sec.type === 'h1' || sec.type === 'h2' || sec.type === 'h3') {
      records.push({ type: 'Heading', content: sec.text });
    } else if (sec.type === 'paragraph') {
      records.push({ type: 'Content', content: sec.lines.join(' ') });
    } else if (sec.type === 'list' || sec.type === 'orderedList') {
      for (const item of (sec.items || [])) {
        records.push({ type: sec.type === 'orderedList' ? 'Ordered Item' : 'Bullet', content: item });
      }
    }
  }

  if (records.length > 0) {
    const writer = createObjectCsvWriter({
      path: outputPath,
      header: [
        { id: 'type', title: 'Type' },
        { id: 'content', title: 'Content' },
      ],
    });
    await writer.writeRecords(records);
  } else {
    // Absolute fallback: dump text
    const writer = createObjectCsvWriter({
      path: outputPath,
      header: [{ id: 'line', title: 'Content' }],
    });
    await writer.writeRecords(content.split('\n').filter(Boolean).map(r => ({ line: r })));
  }

  return outputPath;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MARKDOWN GENERATION  —  Internal wikis, specs, PRDs, playbooks
// ═══════════════════════════════════════════════════════════════════════════

async function generateMD(title, content, outputPath, options = {}) {
  const date = new Date().toISOString().slice(0, 10);
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `agent: ${options.agent || 'The Brain AIOS'}`,
    `date: ${date}`,
    `status: ${options.status || 'draft'}`,
    '---',
    '',
  ].join('\n');

  // If the content doesn't already lead with the title heading, add it
  const body = /^#\s+/m.test(content) ? content : `# ${title}\n\n${content}`;
  fs.writeFileSync(outputPath, frontmatter + body, 'utf8');
  return outputPath;
}

// ═══════════════════════════════════════════════════════════════════════════
//  HTML GENERATION  —  Beautiful self-contained document webpage
// ═══════════════════════════════════════════════════════════════════════════

async function generateHTML(title, content, outputPath, options = {}) {
  // Self-contained, inline-CSS, print-friendly document — handles markdown OR
  // agent-authored HTML (full doc / fragment / ```html block) transparently.
  fs.writeFileSync(outputPath, buildStyledHtml(title, content), 'utf8');
  return outputPath;
}

/** Write a standalone .svg file (from raw SVG or a ```svg-fenced block). */
async function generateSVG(title, content, outputPath, options = {}) {
  const svg = extractFencedSvg(content) || (isLikelySvg(content) ? String(content).trim() : null);
  fs.writeFileSync(outputPath, svg || String(content), 'utf8');
  return outputPath;
}

async function generateHTMLLegacy(title, content, outputPath, options = {}) {
  const sections = parseContent(content);
  let htmlContent = '';

  for (const sec of sections) {
    switch (sec.type) {
      case 'h1':
        htmlContent += `<h1 class="text-3xl font-bold text-slate-900 dark:text-white mt-8 mb-4 border-b pb-2">${sec.text}</h1>\n`;
        break;
      case 'h2':
        htmlContent += `<h2 class="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-6 mb-3">${sec.text}</h2>\n`;
        break;
      case 'h3':
        htmlContent += `<h3 class="text-xl font-semibold text-slate-700 dark:text-slate-200 mt-4 mb-2">${sec.text}</h3>\n`;
        break;
      case 'paragraph':
        const text = sec.lines.join(' ');
        if (text.trim()) {
          htmlContent += `<p class="text-slate-600 dark:text-slate-300 leading-relaxed mb-4">${text}</p>\n`;
        }
        break;
      case 'list':
        htmlContent += `<ul class="list-disc pl-6 text-slate-600 dark:text-slate-300 mb-4 space-y-1">\n`;
        for (const item of sec.items) {
          htmlContent += `  <li>${item}</li>\n`;
        }
        htmlContent += `</ul>\n`;
        break;
      case 'orderedList':
        htmlContent += `<ol class="list-decimal pl-6 text-slate-600 dark:text-slate-300 mb-4 space-y-1">\n`;
        for (const item of sec.items) {
          htmlContent += `  <li>${item}</li>\n`;
        }
        htmlContent += `</ol>\n`;
        break;
      case 'blockquote':
        htmlContent += `<blockquote class="border-l-4 border-indigo-500 pl-4 italic text-slate-500 dark:text-slate-400 my-4">\n`;
        htmlContent += `  <p>${sec.lines.join(' ')}</p>\n`;
        htmlContent += `</blockquote>\n`;
        break;
      case 'code':
        htmlContent += `<pre class="bg-slate-900 text-slate-100 rounded-lg p-4 font-mono text-sm overflow-x-auto my-4"><code>${sec.code}</code></pre>\n`;
        break;
      case 'hr':
        htmlContent += `<hr class="my-6 border-slate-200 dark:border-slate-700" />\n`;
        break;
      case 'table':
        if (sec.headers && sec.rows) {
          htmlContent += `<div class="overflow-x-auto my-6 rounded-lg border border-slate-200 dark:border-slate-700">\n`;
          htmlContent += `  <table class="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-sm">\n`;
          htmlContent += `    <thead class="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold">\n`;
          htmlContent += `      <tr>\n`;
          for (const h of sec.headers) {
            htmlContent += `        <th class="px-4 py-3 text-left">${h}</th>\n`;
          }
          htmlContent += `      </tr>\n`;
          htmlContent += `    </thead>\n`;
          htmlContent += `    <tbody class="divide-y divide-slate-200 dark:divide-slate-700 text-slate-600 dark:text-slate-300">\n`;
          sec.rows.forEach((row, ri) => {
            const bgClass = ri % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-850/50';
            htmlContent += `      <tr class="${bgClass}">\n`;
            for (const cell of row) {
              htmlContent += `        <td class="px-4 py-3">${cell}</td>\n`;
            }
            htmlContent += `      </tr>\n`;
          });
          htmlContent += `    </tbody>\n`;
          htmlContent += `  </table>\n`;
          htmlContent += `</div>\n`;
        }
        break;
    }
  }

  const template = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: {
              primary: '#6366f1',
              secondary: '#4f46e5',
            }
          }
        }
      }
    }
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    body {
      font-family: 'Inter', sans-serif;
    }
  </style>
</head>
<body class="bg-slate-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100 min-h-screen transition-colors duration-200">
  <div class="max-w-4xl mx-auto px-4 py-8 md:py-16">
    <div class="flex justify-between items-center mb-8 border-b pb-4 border-slate-200 dark:border-slate-700">
      <div>
        <p class="text-xs text-brand-primary font-bold uppercase tracking-wider">The Brain AIOS Document</p>
        <span class="text-xs text-slate-400 dark:text-slate-500">\${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>
      <button id="theme-toggle" class="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors">
        <svg id="theme-toggle-dark-icon" class="w-5 h-5 hidden" fill="currentColor" viewBox="0 0 20 20"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"></path></svg>
        <svg id="theme-toggle-light-icon" class="w-5 h-5 hidden" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" fill-rule="evenodd" clip-rule="evenodd"></path></svg>
      </button>
    </div>
    
    <article class="prose prose-slate dark:prose-invert max-w-none">
      \${htmlContent}
    </article>
  </div>

  <script>
    const themeToggleBtn = document.getElementById('theme-toggle');
    const darkIcon = document.getElementById('theme-toggle-dark-icon');
    const lightIcon = document.getElementById('theme-toggle-light-icon');

    // Set initial icon
    if (localStorage.getItem('color-theme') === 'dark' || (!('color-theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
      lightIcon.classList.remove('hidden');
    } else {
      document.documentElement.classList.remove('dark');
      darkIcon.classList.remove('hidden');
    }

    themeToggleBtn.addEventListener('click', function() {
      // Toggle theme
      if (document.documentElement.classList.contains('dark')) {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('color-theme', 'light');
        lightIcon.classList.add('hidden');
        darkIcon.classList.remove('hidden');
      } else {
        document.documentElement.classList.add('dark');
        localStorage.setItem('color-theme', 'dark');
        darkIcon.classList.add('hidden');
        lightIcon.classList.remove('hidden');
      }
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(outputPath, template, 'utf8');
  return outputPath;
}

// ═══════════════════════════════════════════════════════════════════════════
//  JSON → MARKDOWN BRIDGE
//  Agents emit structured JSON (produce_agent_output). The renderers above
//  consume markdown. This converts an agent's content object into rich markdown
//  (headings, tables, bullets) so every format renderer works on agent output.
// ═══════════════════════════════════════════════════════════════════════════

/** Humanize a snake_case / camelCase key into a Title Case heading. */
function humanizeKey(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function scalarToString(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

/** Render an array of uniform objects as a markdown table; fall back to sections. */
function arrayOfObjectsToMarkdown(arr, headingLevel) {
  // Collect the union of keys across items
  const keySet = [];
  for (const item of arr) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      for (const k of Object.keys(item)) if (!keySet.includes(k)) keySet.push(k);
    }
  }
  // Only build a table if every value is scalar-ish and columns are reasonable
  const allScalar = arr.every(item =>
    item && typeof item === 'object' && !Array.isArray(item) &&
    Object.values(item).every(v => v === null || typeof v !== 'object'));

  if (allScalar && keySet.length > 0 && keySet.length <= 6) {
    const header = `| ${keySet.map(humanizeKey).join(' | ')} |`;
    const sep = `| ${keySet.map(() => '---').join(' | ')} |`;
    const rows = arr.map(item =>
      `| ${keySet.map(k => scalarToString(item[k]).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`);
    return [header, sep, ...rows].join('\n') + '\n';
  }

  // Otherwise render each object as a sub-section
  const h = '#'.repeat(Math.min(headingLevel, 6));
  return arr.map((item, i) => {
    if (item && typeof item === 'object') {
      const titleVal = item.name || item.title || item.firm || item.task || item.owner || `Item ${i + 1}`;
      const lines = [`${h} ${scalarToString(titleVal)}`];
      for (const [k, v] of Object.entries(item)) {
        if (['name', 'title', 'firm'].includes(k) && scalarToString(v) === scalarToString(titleVal)) continue;
        if (v === null || v === undefined || v === '') continue;
        if (Array.isArray(v)) {
          lines.push(`- **${humanizeKey(k)}:**`);
          v.forEach(x => lines.push(`  - ${typeof x === 'object' ? JSON.stringify(x) : scalarToString(x)}`));
        } else if (typeof v === 'object') {
          lines.push(`- **${humanizeKey(k)}:** ${JSON.stringify(v)}`);
        } else {
          lines.push(`- **${humanizeKey(k)}:** ${scalarToString(v)}`);
        }
      }
      return lines.join('\n');
    }
    return `- ${scalarToString(item)}`;
  }).join('\n\n') + '\n';
}

/**
 * Convert a structured agent output object into rich markdown.
 *
 * @param {Object} content - The agent's produce_agent_output content object
 * @param {Object} [options]
 * @param {string} [options.title] - Document title (becomes the H1)
 * @returns {string} Markdown
 */
function jsonToMarkdown(content, options = {}) {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;

  const parts = [];
  if (options.title) parts.push(`# ${options.title}\n`);

  // Lead with a summary if present
  if (content.summary && typeof content.summary === 'string') {
    parts.push(content.summary + '\n');
  }

  for (const [key, value] of Object.entries(content)) {
    if (key === 'summary' && options.title) continue; // already rendered as intro
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;

    parts.push(`## ${humanizeKey(key)}`);

    if (Array.isArray(value)) {
      if (value.every(v => v === null || typeof v !== 'object')) {
        // simple bullet list
        parts.push(value.map(v => `- ${scalarToString(v)}`).join('\n') + '\n');
      } else {
        parts.push(arrayOfObjectsToMarkdown(value, 3));
      }
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (v === null || v === undefined || v === '') continue;
        if (Array.isArray(v)) {
          parts.push(`- **${humanizeKey(k)}:**`);
          v.forEach(x => parts.push(`  - ${typeof x === 'object' ? JSON.stringify(x) : scalarToString(x)}`));
        } else if (typeof v === 'object') {
          parts.push(`- **${humanizeKey(k)}:** ${JSON.stringify(v)}`);
        } else {
          parts.push(`- **${humanizeKey(k)}:** ${scalarToString(v)}`);
        }
      }
      parts.push('');
    } else {
      parts.push(scalarToString(value) + '\n');
    }
  }

  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
//  FORMAT INFERENCE  —  Pick the right deliverable format
// ═══════════════════════════════════════════════════════════════════════════

const MD_AGENTS = new Set(['engineering', 'product']);

/**
 * Infer the best output format from the agent type, the user's stated intent,
 * and the produced content. Keyword-driven with sensible defaults. Returns one
 * of 'docx' | 'pdf' | 'csv' | 'pptx' | 'md'. Default is 'docx'.
 *
 * @param {string} agentType
 * @param {string} [userIntent] - The task description / user request text
 * @param {Object|string} [outputContent] - The structured output (used to detect list-shaped data)
 */
function inferOutputFormat(agentType, userIntent = '', outputContent = null) {
  const intent = String(userIntent || '').toLowerCase();

  // PPTX — explicit presentation intent
  if (/\b(deck|slides?|presentation|board update|pitch)\b/.test(intent)) return 'pptx';

  // PDF — final, locked, externally-shared deliverables
  if (/\b(send to investors?|share with (the )?board|client[- ]ready|final|locked|external)\b/.test(intent)) return 'pdf';

  // MD — specs, PRDs, playbooks, internal technical docs
  if (/\b(spec|prd|playbook|internal doc|wiki|readme|technical doc)\b/.test(intent)) return 'md';
  if (MD_AGENTS.has(agentType) && !/\b(report|memo|proposal)\b/.test(intent)) return 'md';

  // CSV — raw data tables / lists
  if (/\b(list|leads?|contacts?|export|spreadsheet|csv|comparison|table of)\b/.test(intent)) return 'csv';
  if (outputContent && typeof outputContent === 'object') {
    // A single dominant array of objects strongly implies a data list
    const arrayKeys = Object.entries(outputContent)
      .filter(([, v]) => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object');
    const listySignals = ['investor_targets', 'leads', 'investors', 'contacts', 'prospects'];
    if (arrayKeys.some(([k]) => listySignals.includes(k))) return 'csv';
  }

  // Default — formal report/memo
  return 'docx';
}

// ═══════════════════════════════════════════════════════════════════════════
//  EXPORT  —  Generate any format
// ═══════════════════════════════════════════════════════════════════════════

const FORMAT_GENERATORS = {
  pdf:  generatePDF,
  docx: generateDOCX,
  pptx: generatePPTX,
  csv:  generateCSV,
  md:   generateMD,
  html: generateHTML,
  svg:  generateSVG,
};

/**
 * Generate a document file in the specified format.
 *
 * @param {string} title  - Document title
 * @param {string} content - Markdown content
 * @param {'pdf'|'docx'|'pptx'|'csv'} format - Output format
 * @param {string} outputPath - Full file path to write to
 * @param {object} [options] - Optional settings (e.g., brandColor, pageSize)
 * @returns {Promise<string>} The output path
 */
async function generateFile(title, content, format, outputPath, options = {}) {
  loadLibs();

  // Normalize format
  let normFormat = String(format || '').toLowerCase().trim();
  if (normFormat === 'doc') normFormat = 'docx';
  if (normFormat === 'markdown') normFormat = 'md';
  if (normFormat === 'plaintext') normFormat = 'md';

  // Bridge: agents produce structured JSON — convert to rich markdown before rendering.
  if (content && typeof content === 'object') {
    content = jsonToMarkdown(content, { title });
  }

  // Handle empty content
  if (!content || String(content).trim().length === 0) {
    throw new Error('Cannot generate document: content is empty');
  }

  const generator = FORMAT_GENERATORS[normFormat];
  if (!generator) {
    // Fallback: write as plain text
    fs.writeFileSync(outputPath, `# ${title}\n\n${content}`, 'utf8');
    return outputPath;
  }

  return generator(title, content, outputPath, options);
}

/**
 * Convert a document from one format to another.
 * Reads the source file, parses it, then exports to the target format.
 *
 * @param {string} sourcePath - Path to source file
 * @param {string} targetFormat - 'pdf' | 'docx' | 'pptx' | 'csv'
 * @param {string} outputPath - Path to write the converted file
 * @returns {Promise<string>} Output path
 */
async function convertFile(sourcePath, targetFormat, outputPath) {
  loadLibs();

  // Read and parse source
  const content = fs.readFileSync(sourcePath, 'utf8');
  const ext = path.extname(sourcePath).toLowerCase();
  let title = path.basename(sourcePath, ext);

  // If it's markdown, try to extract title
  if (ext === '.md' || ext === '.txt') {
    const extracted = extractTitle(content);
    if (extracted !== 'Untitled Document') title = extracted;
  }

  return generateFile(title, content, targetFormat, outputPath);
}

module.exports = {
  generateFile,
  convertFile,
  parseContent,
  extractTitle,
  jsonToMarkdown,
  inferOutputFormat,
  buildStyledHtml,
  buildPreviewHtml,
  BRAND,
  FORMAT_GENERATORS,
};
