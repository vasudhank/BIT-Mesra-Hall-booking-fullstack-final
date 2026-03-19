import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const MM_TO_PX = 96 / 25.4;
const MM_TO_PT = 72 / 25.4;
const PX_TO_PT = 72 / 96;

const delay = (ms) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const sanitizeFilename = (value, fallback = 'Document') => {
  const raw = String(value || '').trim() || fallback;
  return raw
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || fallback;
};

const getA4MmByOrientation = (orientation = 'portrait') => {
  const mode = String(orientation || 'portrait').toLowerCase() === 'landscape' ? 'landscape' : 'portrait';
  return mode === 'landscape'
    ? { widthMm: 297, heightMm: 210, orientation: 'landscape' }
    : { widthMm: 210, heightMm: 297, orientation: 'portrait' };
};

const waitForImages = async (root) => {
  const imgs = Array.from(root.querySelectorAll('img'));
  if (!imgs.length) return;
  await Promise.all(
    imgs.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    })
  );
};

const getSafePageSlices = ({
  renderRoot,
  rootHeight,
  contentPageHeightPx,
  keepTogetherSelector
}) => {
  const normalizedSelector = String(keepTogetherSelector || '').trim();
  const rootRect = renderRoot.getBoundingClientRect();
  const keepTogetherItems = normalizedSelector
    ? Array.from(renderRoot.querySelectorAll(normalizedSelector))
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const top = Math.max(0, Math.round(rect.top - rootRect.top));
          const bottom = Math.min(rootHeight, Math.round(rect.bottom - rootRect.top));
          return {
            top,
            bottom,
            height: Math.max(0, bottom - top)
          };
        })
        .filter((item) => item.height > 0)
        .sort((a, b) => a.top - b.top)
    : [];

  const pages = [];
  const minimumPageFill = Math.max(120, Math.round(contentPageHeightPx * 0.52));
  let cursor = 0;

  while (cursor < rootHeight) {
    const proposedEnd = Math.min(rootHeight, cursor + contentPageHeightPx);
    let safeEnd = proposedEnd;

    if (keepTogetherItems.length && proposedEnd < rootHeight) {
      const overlappingItem = keepTogetherItems.find(
        (item) => item.top < proposedEnd && item.bottom > proposedEnd
      );

      if (overlappingItem) {
        const breakBefore = overlappingItem.top;
        if (breakBefore - cursor >= minimumPageFill) {
          safeEnd = breakBefore;
        }
      }
    }

    if (safeEnd <= cursor) {
      safeEnd = proposedEnd;
    }

    pages.push({
      startPx: cursor,
      endPx: safeEnd
    });
    cursor = safeEnd;
  }

  return pages;
};

export const exportPdfFromPrintHtml = async ({
  html = '',
  title = 'Document',
  orientation = 'portrait',
  marginMm = 14,
  scale = 2.1,
  keepTogetherSelector = ''
} = {}) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('pdf-export-not-available');
  }

  const printHtml = String(html || '').trim();
  if (!printHtml) throw new Error('pdf-export-html-missing');

  const parser = new DOMParser();
  const parsed = parser.parseFromString(printHtml, 'text/html');

  const styleText = Array.from(parsed.querySelectorAll('style'))
    .map((node) => String(node.textContent || ''))
    .join('\n');
  const styleLinks = Array.from(parsed.querySelectorAll('link[rel="stylesheet"]'))
    .map((node) => String(node.getAttribute('href') || '').trim())
    .filter(Boolean);
  const bodyHtml = parsed.body ? parsed.body.innerHTML : printHtml;

  const { widthMm, heightMm, orientation: pdfOrientation } = getA4MmByOrientation(orientation);
  const safeMarginMm = Math.max(4, Math.min(22, Number(marginMm) || 14));

  const pageWidthPx = Math.round(widthMm * MM_TO_PX);
  const pageHeightPx = Math.round(heightMm * MM_TO_PX);
  const marginPx = Math.round(safeMarginMm * MM_TO_PX);
  const contentWidthPx = Math.max(420, pageWidthPx - marginPx * 2);
  const contentPageHeightPx = Math.max(420, pageHeightPx - marginPx * 2);

  const importsText = styleLinks.map((href) => `@import url('${href}');`).join('\n');

  const renderHost = document.createElement('div');
  renderHost.className = 'print-pdf-export-host';
  renderHost.style.position = 'fixed';
  renderHost.style.left = '-200000px';
  renderHost.style.top = '0';
  renderHost.style.pointerEvents = 'none';
  renderHost.style.opacity = '0';
  renderHost.style.zIndex = '-1';
  renderHost.style.background = '#ffffff';
  renderHost.style.width = `${contentWidthPx}px`;
  renderHost.style.padding = '0';
  renderHost.style.margin = '0';

  renderHost.innerHTML = `
    <style>
      ${importsText}
      ${styleText}
      .pdf-export-render-root {
        box-sizing: border-box;
        width: ${contentWidthPx}px;
        max-width: ${contentWidthPx}px;
        margin: 0;
        padding: 0;
        background: #ffffff;
      }
      .pdf-export-render-root * {
        box-sizing: border-box;
      }
    </style>
    <div class="pdf-export-render-root">${bodyHtml}</div>
  `;

  document.body.appendChild(renderHost);

  try {
    const renderRoot = renderHost.querySelector('.pdf-export-render-root');
    if (!renderRoot) throw new Error('pdf-export-root-missing');

    await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    await waitForImages(renderRoot);

    if (document.fonts?.ready) {
      try {
        await Promise.race([document.fonts.ready, delay(2400)]);
      } catch (_) {
        // ignore and continue
      }
    } else {
      await delay(140);
    }

    await new Promise((resolve) => window.requestAnimationFrame(resolve));

    const rootWidth = Math.max(1, Math.ceil(Math.max(renderRoot.scrollWidth, renderRoot.clientWidth)));
    const rootHeight = Math.max(1, Math.ceil(Math.max(renderRoot.scrollHeight, renderRoot.clientHeight)));

    const canvas = await html2canvas(renderRoot, {
      backgroundColor: '#ffffff',
      scale: Math.max(1.5, Math.min(3, Number(scale) || 2.1)),
      useCORS: true,
      logging: false,
      width: rootWidth,
      height: rootHeight,
      scrollX: 0,
      scrollY: 0,
      windowWidth: Math.max(rootWidth, contentWidthPx),
      windowHeight: Math.max(rootHeight, contentPageHeightPx)
    });

    const pdfDoc = new jsPDF({
      orientation: pdfOrientation,
      unit: 'pt',
      format: 'a4',
      compress: true
    });

    const marginPt = safeMarginMm * MM_TO_PT;
    const contentWidthPt = contentWidthPx * PX_TO_PT;
    const canvasScaleRatio = canvas.width / rootWidth;
    const safePages = getSafePageSlices({
      renderRoot,
      rootHeight,
      contentPageHeightPx,
      keepTogetherSelector
    });

    safePages.forEach((page, pageIndex) => {
      if (pageIndex > 0) {
        pdfDoc.addPage('a4', pdfOrientation);
      }

      const sliceStart = Math.max(0, Math.round(page.startPx * canvasScaleRatio));
      const sliceEnd = Math.min(canvas.height, Math.round(page.endPx * canvasScaleRatio));
      const sliceHeight = Math.max(1, sliceEnd - sliceStart);
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = sliceHeight;

      const sliceCtx = sliceCanvas.getContext('2d');
      if (!sliceCtx) throw new Error('pdf-export-context-missing');
      sliceCtx.drawImage(canvas, 0, sliceStart, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

      const imageData = sliceCanvas.toDataURL('image/png');
      const renderedSliceHeightPt = (sliceHeight / (canvas.width / rootWidth)) * PX_TO_PT;
      pdfDoc.addImage(imageData, 'PNG', marginPt, marginPt, contentWidthPt, renderedSliceHeightPt, undefined, 'FAST');
    });

    const safeName = sanitizeFilename(title, 'Document');
    pdfDoc.save(`${safeName}.pdf`);
  } finally {
    if (renderHost.parentNode) {
      renderHost.parentNode.removeChild(renderHost);
    }
  }
};

export default exportPdfFromPrintHtml;
