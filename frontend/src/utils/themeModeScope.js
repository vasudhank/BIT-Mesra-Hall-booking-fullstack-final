const GLOBAL_THEME_KEY = 'theme';
const GLOBAL_THEME_STAMP_KEY = 'bit_theme_global_stamp_v1';
const PAGE_THEME_OVERRIDES_KEY = 'bit_theme_page_overrides_v1';

export const THEME_SYNC_EVENT = 'bit-theme-sync';

const canUseDom = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined';

export const normalizeThemeMode = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'dark' ? 'dark' : 'light';
};

export const normalizeThemePath = (pathname) => {
  const raw = String(pathname || '').trim();
  if (!raw) return '/';

  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const compacted = withLeadingSlash.replace(/\/{2,}/g, '/');
  const withoutTrailingSlash = compacted.length > 1 ? compacted.replace(/\/+$/g, '') : compacted;
  return withoutTrailingSlash.toLowerCase() || '/';
};

const safeReadStorage = (key, fallbackValue = '') => {
  if (!canUseDom()) return fallbackValue;
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallbackValue : value;
  } catch {
    return fallbackValue;
  }
};

const safeWriteStorage = (key, value) => {
  if (!canUseDom()) return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

const sanitizePageEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const mode = normalizeThemeMode(entry.mode);
  const changedAt = Number(entry.changedAt);
  if (!Number.isFinite(changedAt) || changedAt <= 0) return null;
  return { mode, changedAt };
};

export const readGlobalThemeMode = () => normalizeThemeMode(safeReadStorage(GLOBAL_THEME_KEY, 'light'));

export const readGlobalThemeStamp = () => {
  const value = Number(safeReadStorage(GLOBAL_THEME_STAMP_KEY, '0'));
  return Number.isFinite(value) && value > 0 ? value : 0;
};

export const readPageThemeOverrides = () => {
  const raw = safeReadStorage(PAGE_THEME_OVERRIDES_KEY, '{}');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const next = {};
    Object.keys(parsed).forEach((key) => {
      const normalizedPath = normalizeThemePath(key);
      const sanitized = sanitizePageEntry(parsed[key]);
      if (sanitized) {
        next[normalizedPath] = sanitized;
      }
    });
    return next;
  } catch {
    return {};
  }
};

export const readPageThemeOverride = (pathname) => {
  const normalizedPath = normalizeThemePath(pathname);
  const all = readPageThemeOverrides();
  return sanitizePageEntry(all[normalizedPath]);
};

const readNearestAncestorPageThemeOverride = (pathname) => {
  const normalizedPath = normalizeThemePath(pathname);
  const all = readPageThemeOverrides();

  if (!normalizedPath) return null;

  let currentPath = normalizedPath;
  while (true) {
    const match = sanitizePageEntry(all[currentPath]);
    if (match) return match;
    if (currentPath === '/') break;

    const parentPath = currentPath.replace(/\/[^/]+$/, '') || '/';
    if (parentPath === currentPath) break;
    currentPath = parentPath;
  }

  return null;
};

export const resolveEffectiveThemeMode = (pathname, fallbackGlobalMode = 'light') => {
  const globalMode = normalizeThemeMode(fallbackGlobalMode || readGlobalThemeMode());
  const globalStamp = readGlobalThemeStamp();
  const pageOverride = readNearestAncestorPageThemeOverride(pathname);

  if (pageOverride && pageOverride.changedAt > globalStamp) {
    return pageOverride.mode;
  }

  return globalMode;
};

export const applyThemeToBody = (mode) => {
  if (typeof document === 'undefined' || !document.body) return;
  const normalizedMode = normalizeThemeMode(mode);
  document.body.classList.remove('dark-mode', 'light-mode');
  document.body.classList.add(normalizedMode === 'dark' ? 'dark-mode' : 'light-mode');
};

export const dispatchThemeSync = (detail = {}) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(THEME_SYNC_EVENT, { detail }));
};

export const setGlobalThemeMode = (mode, options = {}) => {
  const normalizedMode = normalizeThemeMode(mode);
  const updateStamp = options?.updateStamp !== false;

  safeWriteStorage(GLOBAL_THEME_KEY, normalizedMode);
  let changedAt = readGlobalThemeStamp();
  if (updateStamp) {
    changedAt = Date.now();
    safeWriteStorage(GLOBAL_THEME_STAMP_KEY, String(changedAt));
  }

  dispatchThemeSync({
    scope: 'global',
    mode: normalizedMode,
    changedAt
  });

  return normalizedMode;
};

export const setPageThemeMode = (pathname, mode) => {
  const normalizedPath = normalizeThemePath(pathname);
  const normalizedMode = normalizeThemeMode(mode);
  const changedAt = Date.now();
  const all = readPageThemeOverrides();

  all[normalizedPath] = {
    mode: normalizedMode,
    changedAt
  };

  safeWriteStorage(PAGE_THEME_OVERRIDES_KEY, JSON.stringify(all));
  dispatchThemeSync({
    scope: 'page',
    path: normalizedPath,
    mode: normalizedMode,
    changedAt
  });

  return { mode: normalizedMode, changedAt, path: normalizedPath };
};
