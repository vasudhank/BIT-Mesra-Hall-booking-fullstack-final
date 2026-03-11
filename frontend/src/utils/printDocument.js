const delay = (ms) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const waitForAnimationFrame = (win) =>
  new Promise((resolve) => {
    if (!win || typeof win.requestAnimationFrame !== 'function') {
      resolve();
      return;
    }
    win.requestAnimationFrame(() => resolve());
  });

const waitForPrintRender = async (doc, win, settleDelayMs) => {
  if (doc?.fonts?.ready) {
    try {
      await Promise.race([doc.fonts.ready, delay(1800)]);
    } catch (_) {
      // ignore and continue with print flow
    }
  } else {
    await delay(120);
  }
  await waitForAnimationFrame(win);
  await waitForAnimationFrame(win);
  if (settleDelayMs > 0) {
    await delay(settleDelayMs);
  }
};

export const printHtmlDocument = ({
  html = '',
  title = '',
  validate,
  settleDelayMs = 220,
  printFallbackCleanupMs = 120000,
  initFallbackCleanupMs = 180000
} = {}) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;

  const printMarkup = String(html || '');
  if (!printMarkup.trim()) return false;

  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.opacity = '0';
  frame.style.border = '0';
  frame.style.pointerEvents = 'none';
  frame.setAttribute('aria-hidden', 'true');

  let hasPrinted = false;
  let afterPrintCleanupId = null;
  let initCleanupId = null;
  let retryId = null;

  const cleanup = () => {
    if (retryId) {
      window.clearTimeout(retryId);
      retryId = null;
    }
    if (afterPrintCleanupId) {
      window.clearTimeout(afterPrintCleanupId);
      afterPrintCleanupId = null;
    }
    if (initCleanupId) {
      window.clearTimeout(initCleanupId);
      initCleanupId = null;
    }
    if (frame.parentNode) {
      frame.parentNode.removeChild(frame);
    }
  };

  const tryPrint = async () => {
    if (hasPrinted) return;
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc || !doc.body) return;

    if (typeof validate === 'function' && !validate(doc)) {
      return;
    }

    hasPrinted = true;

    await waitForPrintRender(doc, win, settleDelayMs);

    const handleAfterPrint = () => {
      win.removeEventListener('afterprint', handleAfterPrint);
      cleanup();
    };
    win.addEventListener('afterprint', handleAfterPrint);
    afterPrintCleanupId = window.setTimeout(() => {
      win.removeEventListener('afterprint', handleAfterPrint);
      cleanup();
    }, Math.max(10000, Number(printFallbackCleanupMs) || 120000));

    try {
      win.focus();
      win.print();
    } catch (_) {
      cleanup();
    }
  };

  const attemptPrintSoon = (delayMs) => {
    if (retryId) {
      window.clearTimeout(retryId);
    }
    retryId = window.setTimeout(() => {
      tryPrint();
    }, Math.max(0, Number(delayMs) || 0));
  };

  frame.addEventListener('load', () => {
    attemptPrintSoon(50);
  });

  document.body.appendChild(frame);

  const frameDoc = frame.contentDocument || frame.contentWindow?.document;
  if (!frameDoc) {
    cleanup();
    return false;
  }

  if (title) {
    try {
      frameDoc.title = String(title);
    } catch (_) {
      // ignore title assignment failures
    }
  }

  frameDoc.open();
  frameDoc.write(printMarkup);
  frameDoc.close();

  attemptPrintSoon(240);
  initCleanupId = window.setTimeout(cleanup, Math.max(20000, Number(initFallbackCleanupMs) || 180000));
  return true;
};

export default printHtmlDocument;
