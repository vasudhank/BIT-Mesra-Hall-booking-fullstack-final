import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { deleteNoticeApi, getNoticeByIdApi, updateNoticeApi } from '../api/noticesApi';
import api from '../api/axiosInstance';
import HallMultiSelectDropdown from '../components/Notices/HallMultiSelectDropdown';
import { printHtmlDocument } from '../utils/printDocument';
import { exportPdfFromPrintHtml } from '../utils/exportPdfFromPrintHtml';
import './NoticesPage.css';

const READING_STORAGE_KEY = 'bit_notice_reading_preferences_v1';

const fallbackPrefs = {
  theme: 'classic',
  textSize: 15,
  font: 'outfit'
};

const loadPrefs = () => {
  try {
    const raw = localStorage.getItem(READING_STORAGE_KEY);
    if (!raw) return fallbackPrefs;
    const parsed = JSON.parse(raw);

    let size = fallbackPrefs.textSize;
    if (typeof parsed.textSize === 'number') {
      size = Math.min(Math.max(12, parsed.textSize), 40);
    } else if (parsed.textSize === 'small') size = 15;
    else if (parsed.textSize === 'medium') size = 17;
    else if (parsed.textSize === 'large') size = 20;

    return {
      theme: ['classic', 'paper', 'night'].includes(parsed?.theme) ? parsed.theme : fallbackPrefs.theme,
      textSize: size,
      font: parsed?.font || fallbackPrefs.font
    };
  } catch (_) {
    return fallbackPrefs;
  }
};

const toDateTimeLocalInput = (value) => {
  if (!value) return '';
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const toIsoOrNull = (value) => {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
};

const formatDate = (value) => {
  if (!value) return 'N/A';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return 'N/A';
  return dt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

const TITLE_COLORS = [
  { key: 'red', value: '#b91c1c', label: 'Red' },
  { key: 'green', value: '#166534', label: 'Green' },
  { key: 'black', value: '#111827', label: 'Black' },
  { key: 'maroon', value: '#7f1d1d', label: 'Maroon' }
];
const COMPACT_NOTICE_COLORS = TITLE_COLORS.slice(0, 2);

const FONT_OPTIONS = [
  { value: 'outfit', label: 'Outfit (Sans)', family: 'Outfit' },
  { value: 'roboto', label: 'Roboto (Sans)', family: 'Roboto' },
  { value: 'nunito', label: 'Nunito (Sans)', family: 'Nunito' },
  { value: 'space', label: 'Space Grotesk (Sans)', family: 'Space Grotesk' },
  { value: 'oswald', label: 'Oswald (Sans)', family: 'Oswald' },
  { value: 'lora', label: 'Lora (Serif)', family: 'Lora' },
  { value: 'merriweather', label: 'Merriweather (Serif)', family: 'Merriweather' },
  { value: 'playfair', label: 'Playfair Display (Serif)', family: 'Playfair Display' },
  { value: 'mono', label: 'Fira Code (Mono)', family: 'Fira Code' },
  { value: 'courgette', label: 'Courgette (Cursive)', family: 'Courgette' }
];

const INLINE_FONT_OPTIONS = FONT_OPTIONS.map((opt) => ({
  value: opt.value,
  label: opt.family
}));

const INLINE_TEXT_COLORS = [
  { key: 'red', value: '#b91c1c', label: 'Text red' },
  { key: 'green', value: '#166534', label: 'Text green' },
  { key: 'black', value: '#111827', label: 'Text black' },
  { key: 'maroon', value: '#7f1d1d', label: 'Text maroon' }
];

const INLINE_HIGHLIGHT_COLORS = [
  { key: 'hl-yellow', value: '#fef08a', label: 'Highlight yellow' },
  { key: 'hl-green', value: '#bbf7d0', label: 'Highlight green' },
  { key: 'hl-blue', value: '#bfdbfe', label: 'Highlight blue' },
  { key: 'hl-rose', value: '#fecdd3', label: 'Highlight rose' }
];

const sanitizeColorToken = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(raw) ? raw.toLowerCase() : '';
};

const sanitizeFontToken = (value) => {
  const raw = String(value ?? '').trim().toLowerCase();
  return FONT_OPTIONS.some((opt) => opt.value === raw) ? raw : '';
};

const sanitizeFontSizeToken = (value) => {
  if (value === '' || value === null || typeof value === 'undefined') return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return Math.min(72, Math.max(12, Math.round(num)));
};

const sanitizeDescriptionHtml = (value) =>
  String(value || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');

const sanitizeTitleHtml = (value) => sanitizeDescriptionHtml(value);

const stripInlineTypographyStyles = (htmlValue) => {
  const html = String(htmlValue || '').trim();
  if (!html) return '';
  if (typeof window === 'undefined' || typeof window.DOMParser === 'undefined') {
    return html;
  }
  try {
    const parser = new window.DOMParser();
    const doc = parser.parseFromString(`<div id="notice-typography-root">${html}</div>`, 'text/html');
    const root = doc.getElementById('notice-typography-root');
    if (!root) return html;
    root.querySelectorAll('[style]').forEach((el) => {
      el.style.removeProperty('font-family');
      el.style.removeProperty('font-size');
      const styleAttr = el.getAttribute('style');
      if (!styleAttr || !styleAttr.trim()) {
        el.removeAttribute('style');
      }
    });
    return String(root.innerHTML || '').trim();
  } catch (_) {
    return html;
  }
};

const stripInlineColorStyles = (htmlValue) => {
  const html = String(htmlValue || '').trim();
  if (!html) return '';
  if (typeof window === 'undefined' || typeof window.DOMParser === 'undefined') {
    return html;
  }
  try {
    const parser = new window.DOMParser();
    const doc = parser.parseFromString(`<div id="notice-color-root">${html}</div>`, 'text/html');
    const root = doc.getElementById('notice-color-root');
    if (!root) return html;
    root.querySelectorAll('[style]').forEach((el) => {
      el.style.removeProperty('color');
      const styleAttr = el.getAttribute('style');
      if (!styleAttr || !styleAttr.trim()) {
        el.removeAttribute('style');
      }
    });
    return String(root.innerHTML || '').trim();
  } catch (_) {
    return html;
  }
};

const normalizeStylePayload = (style) => {
  const source = style && typeof style === 'object' ? style : {};
  return {
    titleColor: sanitizeColorToken(source.titleColor),
    descriptionColor: sanitizeColorToken(source.descriptionColor),
    titleFont: sanitizeFontToken(source.titleFont),
    descriptionFont: sanitizeFontToken(source.descriptionFont),
    titleFontSize: sanitizeFontSizeToken(source.titleFontSize),
    descriptionFontSize: sanitizeFontSizeToken(source.descriptionFontSize),
    titleHtml: sanitizeTitleHtml(source.titleHtml || '').trim(),
    contentHtml: sanitizeDescriptionHtml(source.contentHtml || '').trim()
  };
};

const mergeStylePayload = (baseStyle, patchStyle) => {
  const base = normalizeStylePayload(baseStyle);
  const patch = normalizeStylePayload(patchStyle);
  return {
    titleColor: patch.titleColor || base.titleColor || '',
    descriptionColor: patch.descriptionColor || base.descriptionColor || '',
    titleFont: patch.titleFont || base.titleFont || '',
    descriptionFont: patch.descriptionFont || base.descriptionFont || '',
    titleFontSize: patch.titleFontSize || base.titleFontSize || '',
    descriptionFontSize: patch.descriptionFontSize || base.descriptionFontSize || '',
    titleHtml: patch.titleHtml || base.titleHtml || '',
    contentHtml: patch.contentHtml || base.contentHtml || ''
  };
};

const applyStylePatch = (baseStyle, patchStyleRaw) => {
  const base = normalizeStylePayload(baseStyle);
  const source = patchStyleRaw && typeof patchStyleRaw === 'object' ? patchStyleRaw : {};
  const next = { ...base };

  if (Object.prototype.hasOwnProperty.call(source, 'titleColor')) {
    next.titleColor = sanitizeColorToken(source.titleColor);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'descriptionColor')) {
    next.descriptionColor = sanitizeColorToken(source.descriptionColor);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'titleFont')) {
    next.titleFont = sanitizeFontToken(source.titleFont);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'descriptionFont')) {
    next.descriptionFont = sanitizeFontToken(source.descriptionFont);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'titleFontSize')) {
    next.titleFontSize = sanitizeFontSizeToken(source.titleFontSize);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'descriptionFontSize')) {
    next.descriptionFontSize = sanitizeFontSizeToken(source.descriptionFontSize);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'titleHtml')) {
    next.titleHtml = sanitizeTitleHtml(source.titleHtml || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(source, 'contentHtml')) {
    next.contentHtml = sanitizeDescriptionHtml(source.contentHtml || '').trim();
  }

  return next;
};

const getPrivateStyleStorageKey = (noticeId, viewerKey) =>
  `bit_notice_private_style_v2_${String(noticeId || '')}_${String(viewerKey || 'guest')}`;

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildDefaultDescriptionHtml = (rawValue) => {
  const raw = String(rawValue || '').trim();
  if (!raw) return '<p>No detailed body text provided.</p>';
  return raw
    .split(/\n{2,}/)
    .map((chunk) => `<p>${escapeHtml(chunk.trim())}</p>`)
    .join('');
};

const buildDefaultTitleHtml = (rawValue) => {
  const raw = String(rawValue || '').trim();
  if (!raw) return 'Institutional Update';
  return escapeHtml(raw);
};

const PRINT_FONT_STACK = {
  outfit: "'Outfit', sans-serif",
  roboto: "'Roboto', sans-serif",
  nunito: "'Nunito', sans-serif",
  space: "'Space Grotesk', sans-serif",
  oswald: "'Oswald', sans-serif",
  lora: "'Lora', serif",
  merriweather: "'Merriweather', serif",
  playfair: "'Playfair Display', serif",
  mono: "'Fira Code', monospace",
  courgette: "'Courgette', cursive"
};

const GLOBAL_TITLE_DESC_RATIO = 25 / 15;

const getFontStack = (fontKey, fallbackKey = 'outfit') => {
  const safeKey = sanitizeFontToken(fontKey) || sanitizeFontToken(fallbackKey) || 'outfit';
  return PRINT_FONT_STACK[safeKey] || PRINT_FONT_STACK.outfit;
};

const getFontKeyFromFamily = (familyValue, fallbackKey = 'outfit') => {
  const raw = String(familyValue || '').toLowerCase();
  if (!raw) return sanitizeFontToken(fallbackKey) || 'outfit';
  const matched = FONT_OPTIONS.find((opt) => raw.includes(opt.family.toLowerCase()));
  return matched?.value || sanitizeFontToken(fallbackKey) || 'outfit';
};

const safeHexColor = (value, fallback = '#111827') => {
  const raw = String(value || '').trim();
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(raw) ? raw : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const hexToRgb = (hex) => {
  const normalized = safeHexColor(hex, '#111827').replace('#', '');
  const full = normalized.length === 3
    ? normalized.split('').map((ch) => ch + ch).join('')
    : normalized;
  const int = Number.parseInt(full, 16);
  if (!Number.isFinite(int)) return { r: 17, g: 24, b: 39 };
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255
  };
};

const rgbToHex = ({ r, g, b }) => {
  const toHex = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const rgbToHsv = ({ r, g, b }) => {
  const rn = clamp(r / 255, 0, 1);
  const gn = clamp(g / 255, 0, 1);
  const bn = clamp(b / 255, 0, 1);
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = ((bn - rn) / d) + 2;
    else h = ((rn - gn) / d) + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
};

const hsvToRgb = (h, s, v) => {
  const hh = ((Number(h) % 360) + 360) % 360;
  const ss = clamp(Number(s), 0, 1);
  const vv = clamp(Number(v), 0, 1);
  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;
  let rn = 0;
  let gn = 0;
  let bn = 0;

  if (hh < 60) [rn, gn, bn] = [c, x, 0];
  else if (hh < 120) [rn, gn, bn] = [x, c, 0];
  else if (hh < 180) [rn, gn, bn] = [0, c, x];
  else if (hh < 240) [rn, gn, bn] = [0, x, c];
  else if (hh < 300) [rn, gn, bn] = [x, 0, c];
  else [rn, gn, bn] = [c, 0, x];

  return {
    r: Math.round((rn + m) * 255),
    g: Math.round((gn + m) * 255),
    b: Math.round((bn + m) * 255)
  };
};

const hexToHsv = (hex) => rgbToHsv(hexToRgb(hex));
const hsvToHex = (h, s, v) => rgbToHex(hsvToRgb(h, s, v));

const STANDARD_FONT_SIZES = [
  8, 9, 10, 11, 12, 14, 15, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 44, 48, 56, 64, 72
];

const formatFontSizeDisplay = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const rounded = Math.round(num * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

const Icons = {
  Sun: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  Moon: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  Book: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  ArrowLeft: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
  Scope: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7h12"/><path d="M3 12h18"/><path d="M3 17h10"/><circle cx="18" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>,
  Print: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>,
  Undo: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a4 4 0 1 1 0 8h-1" />
    </svg>
  ),
  Edit: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
  Trash: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>,
  Close: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>,
  Alert: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
};

function FontSizeControl({
  value,
  onChange,
  min = 12,
  max = 72,
  className = '',
  ariaLabel = 'Font size control'
}) {
  const [draftValue, setDraftValue] = useState(formatFontSizeDisplay(value));
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    setDraftValue(formatFontSizeDisplay(value));
  }, [value]);

  useEffect(() => {
    if (!dropdownOpen) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && rootRef.current.contains(event.target)) return;
      setDropdownOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [dropdownOpen]);

  const commitTypedValue = () => {
    const parsed = Number.parseFloat(String(draftValue || '').trim());
    if (!Number.isFinite(parsed)) {
      setDraftValue(formatFontSizeDisplay(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    onChange(clamped);
    setDraftValue(formatFontSizeDisplay(clamped));
  };

  const presetSizes = STANDARD_FONT_SIZES.filter((size) => size >= min && size <= max);
  const sizeFieldChars = Math.max(
    2,
    Math.min(6, String((draftValue || formatFontSizeDisplay(value) || '').trim()).length || 2)
  );

  return (
    <div ref={rootRef} className={`readability-group notice-size-control ${className}`} aria-label={ariaLabel}>
      <button
        type="button"
        className="readability-btn"
        onClick={() => onChange(Math.max(min, Number(value) - 1))}
        aria-label="Decrease font size"
      >
        A-
      </button>

      <div
        className="notice-size-center"
        style={{ '--notice-size-ch': sizeFieldChars }}
        onMouseDown={(event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (target.closest('.notice-size-dropdown-toggle')) return;
          if (target.closest('.notice-size-dropdown')) return;
          event.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
        }}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          className="notice-size-input"
          value={draftValue}
          spellCheck={false}
          onChange={(e) => {
            const next = String(e.target.value || '').replace(/[^\d.]/g, '');
            const firstDot = next.indexOf('.');
            const safe = firstDot >= 0
              ? `${next.slice(0, firstDot + 1)}${next.slice(firstDot + 1).replace(/\./g, '')}`
              : next;
            setDraftValue(safe);
          }}
          onBlur={commitTypedValue}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitTypedValue();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setDraftValue(formatFontSizeDisplay(value));
              e.currentTarget.blur();
            }
          }}
          aria-label="Editable font size value"
        />

        <button
          type="button"
          className={`notice-size-dropdown-toggle ${dropdownOpen ? 'open' : ''}`}
          onClick={() => setDropdownOpen((prev) => !prev)}
          aria-label="Open preset font size list"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>

        {dropdownOpen && (
          <div className="notice-size-dropdown" role="listbox" aria-label="Preset font sizes">
            {presetSizes.map((size) => (
              <button
                key={`preset-size-${size}`}
                type="button"
                className={`notice-size-dropdown-item ${Math.round(Number(value)) === size ? 'active' : ''}`}
                onClick={() => {
                  onChange(size);
                  setDraftValue(formatFontSizeDisplay(size));
                  setDropdownOpen(false);
                }}
                aria-label={`Set font size ${size}`}
              >
                {size}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        className="readability-btn"
        onClick={() => onChange(Math.min(max, Number(value) + 1))}
        aria-label="Increase font size"
      >
        A+
      </button>
    </div>
  );
}

export default function NoticeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const auth = useSelector((s) => s.user);
  const isAdmin = auth.status === 'Authenticated' && auth.user === 'Admin';

  const [reading, setReading] = useState(loadPrefs);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [halls, setHalls] = useState([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    kind: 'GENERAL',
    holidayName: '',
    startDateTime: '',
    endDateTime: '',
    rooms: [],
    closureAllHalls: false
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState({ type: '', text: '' });
  const [styleDraft, setStyleDraft] = useState({
    titleColor: '',
    descriptionColor: '',
    titleFont: '',
    descriptionFont: '',
    titleFontSize: '',
    descriptionFontSize: '',
    titleHtml: '',
    contentHtml: ''
  });
  const [typographyOverrideMode, setTypographyOverrideMode] = useState({
    title: 'global',
    description: 'global'
  });
  const [printDialog, setPrintDialog] = useState({
    open: false,
    colorMode: 'color',
    includeMeta: true,
    includeBorder: false
  });
  const [printPdfBusy, setPrintPdfBusy] = useState(false);
  const [scopeDialog, setScopeDialog] = useState({ open: false });
  const [hasPendingStyleChanges, setHasPendingStyleChanges] = useState(false);
  const [selectionToolbar, setSelectionToolbar] = useState({ open: false, x: 0, y: 0 });
  const [selectionTextControls, setSelectionTextControls] = useState({
    font: fallbackPrefs.font,
    fontSize: fallbackPrefs.textSize
  });
  const [originalColorState, setOriginalColorState] = useState({ titleColor: '', descriptionColor: '' });
  const [customPicker, setCustomPicker] = useState({
    open: false,
    target: 'title',
    left: 0,
    top: 0,
    h: 0,
    s: 0,
    v: 0
  });
  const [pickerDragMode, setPickerDragMode] = useState('');
  const [pickerHexDraft, setPickerHexDraft] = useState('#111827');
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 960px)').matches : false
  );
  const [isHeaderStripCollapsed, setIsHeaderStripCollapsed] = useState(false);
  const [isTitleControlsCollapsed, setIsTitleControlsCollapsed] = useState(false);
  const [isDescriptionControlsCollapsed, setIsDescriptionControlsCollapsed] = useState(false);
  const [headerStripHeight, setHeaderStripHeight] = useState(0);
  const [detailControlsHeight, setDetailControlsHeight] = useState(0);
  const [headerExpandTop, setHeaderExpandTop] = useState(10);
  const [titleExpandTop, setTitleExpandTop] = useState(120);
  const [descriptionExpandTop, setDescriptionExpandTop] = useState(180);

  const noticeTitleRef = useRef(null);
  const noticeBodyRef = useRef(null);
  const selectedRangeRef = useRef(null);
  const inlineTextColorInputRef = useRef(null);
  const inlineHighlightColorInputRef = useRef(null);
  const customPickerRef = useRef(null);
  const pickerSvRef = useRef(null);
  const pickerHueRef = useRef(null);
  const headerStripRef = useRef(null);
  const detailControlsRef = useRef(null);
  const titleControlsCardRef = useRef(null);
  const descriptionControlsCardRef = useRef(null);
  const headerEdgeToggleRef = useRef(null);
  const titleCardToggleRef = useRef(null);
  const descriptionCardToggleRef = useRef(null);

  const allStripsExpanded = !isHeaderStripCollapsed && !isTitleControlsCollapsed && !isDescriptionControlsCollapsed;

  useEffect(() => {
    localStorage.setItem(READING_STORAGE_KEY, JSON.stringify(reading));
  }, [reading]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 960px)');
    const onChange = (event) => setIsMobile(event.matches);
    setIsMobile(mediaQuery.matches);
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', onChange);
      return () => mediaQuery.removeEventListener('change', onChange);
    }
    mediaQuery.addListener(onChange);
    return () => mediaQuery.removeListener(onChange);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setIsHeaderStripCollapsed(false);
    }
  }, [isMobile]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const updateHeaderStripHeight = () => {
      const rect = headerStripRef.current?.getBoundingClientRect?.();
      setHeaderStripHeight(Math.max(0, Math.round(rect?.height || 0)));
    };

    updateHeaderStripHeight();
    window.addEventListener('resize', updateHeaderStripHeight);

    let observer = null;
    if (typeof ResizeObserver !== 'undefined' && headerStripRef.current) {
      observer = new ResizeObserver(updateHeaderStripHeight);
      observer.observe(headerStripRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateHeaderStripHeight);
      if (observer) observer.disconnect();
    };
  }, [isHeaderStripCollapsed, isMobile]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const updateDetailControlsHeight = () => {
      const rect = detailControlsRef.current?.getBoundingClientRect?.();
      setDetailControlsHeight(Math.max(0, Math.round(rect?.height || 0)));
    };

    updateDetailControlsHeight();
    window.addEventListener('resize', updateDetailControlsHeight);

    let observer = null;
    if (typeof ResizeObserver !== 'undefined' && detailControlsRef.current) {
      observer = new ResizeObserver(updateDetailControlsHeight);
      observer.observe(detailControlsRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateDetailControlsHeight);
      if (observer) observer.disconnect();
    };
  }, [isTitleControlsCollapsed, isDescriptionControlsCollapsed, isMobile, loading, error, notice?._id]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const updateIfMoved = (setter, nextValue) => {
      if (!Number.isFinite(nextValue)) return;
      const safeNext = Math.max(0, Math.round(nextValue));
      setter((prev) => (Math.abs(prev - safeNext) >= 1 ? safeNext : prev));
    };

    const measureAnchorTops = () => {
      if (!allStripsExpanded) return;

      const headerTop = headerEdgeToggleRef.current?.getBoundingClientRect?.()?.top;
      const titleTop = titleCardToggleRef.current?.getBoundingClientRect?.()?.top;
      const descriptionTop = descriptionCardToggleRef.current?.getBoundingClientRect?.()?.top;

      updateIfMoved(setHeaderExpandTop, headerTop);
      updateIfMoved(setTitleExpandTop, titleTop);
      updateIfMoved(setDescriptionExpandTop, descriptionTop);
    };

    const rafId = window.requestAnimationFrame(measureAnchorTops);
    window.addEventListener('resize', measureAnchorTops);

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measureAnchorTops);
      if (headerStripRef.current) observer.observe(headerStripRef.current);
      if (detailControlsRef.current) observer.observe(detailControlsRef.current);
      if (headerEdgeToggleRef.current) observer.observe(headerEdgeToggleRef.current);
      if (titleCardToggleRef.current) observer.observe(titleCardToggleRef.current);
      if (descriptionCardToggleRef.current) observer.observe(descriptionCardToggleRef.current);
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', measureAnchorTops);
      if (observer) observer.disconnect();
    };
  }, [
    allStripsExpanded,
    isMobile,
    loading,
    error,
    notice?._id,
    headerStripHeight,
    detailControlsHeight
  ]);

  const viewerKey = useMemo(() => {
    if (auth.status === 'Authenticated') {
      return String(auth.user || 'auth').toLowerCase();
    }
    return 'guest';
  }, [auth.status, auth.user]);

  const privateStyleStorageKey = useMemo(
    () => getPrivateStyleStorageKey(id, viewerKey),
    [id, viewerKey]
  );

  const fetchNotice = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getNoticeByIdApi(id);
      setNotice(data?.notice || null);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load notice');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchHalls = useCallback(async () => {
    try {
      const response = await api.get('/hall/view_halls', { withCredentials: true });
      setHalls(Array.isArray(response?.data?.halls) ? response.data.halls : []);
    } catch (_) {
      setHalls([]);
    }
  }, []);

  useEffect(() => {
    fetchNotice();
  }, [fetchNotice]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchHalls();
  }, [isAdmin, fetchHalls]);

  const defaultDescriptionHtml = useMemo(
    () => buildDefaultDescriptionHtml(notice?.content || notice?.body || ''),
    [notice]
  );

  const defaultTitleHtml = useMemo(
    () => buildDefaultTitleHtml(notice?.title || notice?.subject || ''),
    [notice]
  );

  useEffect(() => {
    if (!notice?._id) return;
    const publicStyle = normalizeStylePayload(notice.publicStyle);

    let privatePersisted = {};
    try {
      const raw = localStorage.getItem(privateStyleStorageKey);
      if (raw) privatePersisted = normalizeStylePayload(JSON.parse(raw));
    } catch (_) {
      privatePersisted = {};
    }

    const merged = mergeStylePayload(publicStyle, privatePersisted);
    setStyleDraft({
      titleColor: merged.titleColor || '',
      descriptionColor: merged.descriptionColor || '',
      titleFont: merged.titleFont || '',
      descriptionFont: merged.descriptionFont || '',
      titleFontSize: merged.titleFontSize || '',
      descriptionFontSize: merged.descriptionFontSize || '',
      titleHtml: merged.titleHtml || defaultTitleHtml,
      contentHtml: merged.contentHtml || defaultDescriptionHtml
    });
    setOriginalColorState({
      titleColor: merged.titleColor || '',
      descriptionColor: merged.descriptionColor || ''
    });
  }, [notice, privateStyleStorageKey, defaultDescriptionHtml, defaultTitleHtml]);

  const persistPrivateStyle = useCallback((nextStyle) => {
    try {
      localStorage.setItem(privateStyleStorageKey, JSON.stringify(normalizeStylePayload(nextStyle)));
    } catch (_) {
      // Intentionally ignored for quota or private mode failures.
    }
  }, [privateStyleStorageKey]);

  const syncBodyDraftFromDom = useCallback(() => {
    if (!noticeBodyRef.current) return '';
    const html = String(noticeBodyRef.current.innerHTML || '').trim();
    setStyleDraft((prev) => ({ ...prev, contentHtml: html || defaultDescriptionHtml }));
    return html;
  }, [defaultDescriptionHtml]);

  const syncTitleDraftFromDom = useCallback(() => {
    if (!noticeTitleRef.current) return '';
    const html = String(noticeTitleRef.current.innerHTML || '').trim();
    setStyleDraft((prev) => ({ ...prev, titleHtml: html || defaultTitleHtml }));
    return html;
  }, [defaultTitleHtml]);

  const buildTypographyResetPatch = useCallback((scope = 'both') => {
    const patch = {};
    if (scope === 'both' || scope === 'title') {
      const titleSource = noticeTitleRef.current?.innerHTML || styleDraft.titleHtml || defaultTitleHtml;
      patch.titleHtml = stripInlineTypographyStyles(titleSource) || defaultTitleHtml;
    }
    if (scope === 'both' || scope === 'description') {
      const bodySource = noticeBodyRef.current?.innerHTML || styleDraft.contentHtml || defaultDescriptionHtml;
      patch.contentHtml = stripInlineTypographyStyles(bodySource) || defaultDescriptionHtml;
    }
    return patch;
  }, [styleDraft.titleHtml, styleDraft.contentHtml, defaultTitleHtml, defaultDescriptionHtml]);

  const applyTypographyResetLocally = useCallback((scope = 'both') => {
    const patch = buildTypographyResetPatch(scope);
    setStyleDraft((prev) => {
      const next = applyStylePatch(prev, patch);
      if (isAdmin) {
        setHasPendingStyleChanges(true);
      } else {
        persistPrivateStyle(next);
      }
      return next;
    });
    return patch;
  }, [buildTypographyResetPatch, isAdmin, persistPrivateStyle]);

  const commitPatchWithScope = useCallback(async (patch, scope) => {
    const rawPatch = patch && typeof patch === 'object' ? patch : {};
    let success = true;

    setStyleDraft((prev) => {
      const next = applyStylePatch(prev, rawPatch);
      if (scope === 'private_permanent') {
        persistPrivateStyle(next);
      }
      return next;
    });

    if (scope === 'public' && isAdmin && notice?._id) {
      const publicNext = applyStylePatch(notice.publicStyle, rawPatch);
      try {
        await updateNoticeApi(notice._id, { publicStyle: publicNext });
        setNotice((prev) => (prev ? { ...prev, publicStyle: publicNext } : prev));
        setActionMessage({ type: 'success', text: 'Notice styling published for all users.' });
      } catch (err) {
        success = false;
        setActionMessage({ type: 'error', text: err?.response?.data?.error || 'Unable to publish notice style.' });
      }
    }
    return success;
  }, [isAdmin, notice, persistPrivateStyle]);

  const applyStyleDraftPatch = useCallback((patch) => {
    const rawPatch = patch && typeof patch === 'object' ? patch : {};
    setStyleDraft((prev) => {
      const next = applyStylePatch(prev, rawPatch);
      if (isAdmin) {
        setHasPendingStyleChanges(true);
      } else {
        persistPrivateStyle(next);
      }
      return next;
    });
  }, [isAdmin, persistPrivateStyle]);

  const closeScopeDialog = () => setScopeDialog({ open: false });

  const openScopeDialog = () => {
    if (!isAdmin) return;
    const titleHtml = sanitizeTitleHtml(syncTitleDraftFromDom() || styleDraft.titleHtml || defaultTitleHtml) || defaultTitleHtml;
    const contentHtml = sanitizeDescriptionHtml(syncBodyDraftFromDom() || styleDraft.contentHtml || defaultDescriptionHtml) || defaultDescriptionHtml;
    setStyleDraft((prev) => applyStylePatch(prev, { titleHtml, contentHtml }));
    setScopeDialog({ open: true });
  };

  const applyScopeChoice = async (scope) => {
    closeScopeDialog();
    if (!notice?._id) return;

    const fullPatch = normalizeStylePayload({
      ...styleDraft,
      titleFont: titleFontKey,
      descriptionFont: descriptionFontKey,
      titleFontSize: titleFontSizePx,
      descriptionFontSize: descriptionFontSizePx,
      titleHtml: sanitizeTitleHtml(syncTitleDraftFromDom() || styleDraft.titleHtml || defaultTitleHtml) || defaultTitleHtml,
      contentHtml: sanitizeDescriptionHtml(syncBodyDraftFromDom() || styleDraft.contentHtml || defaultDescriptionHtml) || defaultDescriptionHtml
    });

    const success = await commitPatchWithScope(fullPatch, scope);
    if (success) {
      setHasPendingStyleChanges(false);
      if (scope === 'private_permanent') {
        setActionMessage({ type: 'success', text: 'Notice styling saved privately.' });
      } else if (scope === 'private_temporary') {
        setActionMessage({ type: 'success', text: 'Notice styling applied for this session.' });
      }
    }
  };

  const clearSelectionToolbar = useCallback(() => {
    selectedRangeRef.current = null;
    setSelectionToolbar({ open: false, x: 0, y: 0 });
  }, []);

  const captureSelectionComputedTypography = useCallback((range) => {
    const node = range?.startContainer;
    if (!node || typeof window === 'undefined') {
      setSelectionTextControls({ font: reading.font, fontSize: reading.textSize });
      return;
    }
    const elementNode = node.nodeType === 3 ? node.parentElement : node;
    const computed = elementNode && window.getComputedStyle ? window.getComputedStyle(elementNode) : null;
    const fontSizeRaw = Number.parseFloat(String(computed?.fontSize || ''));
    const fontSize = Number.isFinite(fontSizeRaw)
      ? Math.min(72, Math.max(12, Math.round(fontSizeRaw)))
      : reading.textSize;
    const font = getFontKeyFromFamily(computed?.fontFamily, reading.font);
    setSelectionTextControls({ font, fontSize });
  }, [reading.font, reading.textSize]);

  const openSelectionToolbarForRange = useCallback((range) => {
    if (!range) return;
    const rects = range.getClientRects();
    const anchorRect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
    const toolbarWidthEstimate = 268;
    const toolbarHeightEstimate = 132;
    const gap = 10;
    const pad = 8;

    let x = anchorRect.right + gap;
    let y = anchorRect.top + (anchorRect.height / 2) - (toolbarHeightEstimate / 2);

    if (x + toolbarWidthEstimate > window.innerWidth - pad) {
      x = anchorRect.left - toolbarWidthEstimate - gap;
    }
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    if (y + toolbarHeightEstimate > window.innerHeight - pad) {
      y = window.innerHeight - toolbarHeightEstimate - pad;
    }

    selectedRangeRef.current = range.cloneRange();
    captureSelectionComputedTypography(range);
    setSelectionToolbar({
      open: true,
      x,
      y
    });
  }, [captureSelectionComputedTypography]);

  const captureSelectionToolbar = useCallback(() => {
    if (!noticeBodyRef.current && !noticeTitleRef.current) return;
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      clearSelectionToolbar();
      return;
    }

    const range = selection.getRangeAt(0);
    const inBody = noticeBodyRef.current?.contains(range.commonAncestorContainer);
    const inTitle = noticeTitleRef.current?.contains(range.commonAncestorContainer);
    if (!inBody && !inTitle) {
      clearSelectionToolbar();
      return;
    }
    openSelectionToolbarForRange(range);
  }, [clearSelectionToolbar, openSelectionToolbarForRange]);

  const applyInlineStyleFromSelection = (styles) => {
    const range = selectedRangeRef.current;
    if (!range || range.collapsed) return;

    const inBody = noticeBodyRef.current?.contains(range.commonAncestorContainer);
    const inTitle = noticeTitleRef.current?.contains(range.commonAncestorContainer);
    if (!inBody && !inTitle) return;

    const wrapper = document.createElement('span');
    const inlineSelectionId = `inline-sel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    wrapper.setAttribute('data-inline-selection-id', inlineSelectionId);
    const stylePatch = styles && typeof styles === 'object' ? styles : {};
    Object.entries(stylePatch).forEach(([key, value]) => {
      if (typeof value === 'string' && value.trim() !== '') {
        wrapper.style[key] = value.trim();
      }
    });

    const fragment = range.extractContents();
    if (!fragment || !fragment.textContent?.trim()) {
      clearSelectionToolbar();
      return;
    }

    wrapper.appendChild(fragment);
    range.insertNode(wrapper);

    const selection = window.getSelection?.();
    selection?.removeAllRanges();
    const nextRange = document.createRange();
    nextRange.selectNodeContents(wrapper);
    selection?.addRange(nextRange);
    openSelectionToolbarForRange(nextRange);

    const patch = {};
    if (inBody) {
      const html = syncBodyDraftFromDom();
      patch.contentHtml = html || defaultDescriptionHtml;
    }
    if (inTitle) {
      const html = syncTitleDraftFromDom();
      patch.titleHtml = html || defaultTitleHtml;
    }
    applyStyleDraftPatch(patch);

    // React re-renders edited HTML from draft state; re-resolve the styled span after paint
    // so repeated A+/A- or font changes keep targeting the current selection.
    setTimeout(() => {
      const host = inTitle ? noticeTitleRef.current : noticeBodyRef.current;
      const target = host?.querySelector?.(`[data-inline-selection-id="${inlineSelectionId}"]`);
      if (!target) return;
      const sel = window.getSelection?.();
      if (!sel) return;
      const nextRange = document.createRange();
      nextRange.selectNodeContents(target);
      sel.removeAllRanges();
      sel.addRange(nextRange);
      openSelectionToolbarForRange(nextRange);
    }, 0);
  };

  useEffect(() => {
    if (!selectionToolbar.open) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (target && target.closest && target.closest('.notice-selection-toolbar')) return;
      clearSelectionToolbar();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') clearSelectionToolbar();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [selectionToolbar.open, clearSelectionToolbar]);

  useEffect(() => {
    if (!actionMessage.text || actionMessage.type === 'error') return undefined;
    const timer = setTimeout(() => {
      setActionMessage((prev) => (prev.type === 'error' ? prev : { type: '', text: '' }));
    }, 9000);
    return () => clearTimeout(timer);
  }, [actionMessage.text, actionMessage.type]);

  const updateReading = (key, value) => {
    setReading((p) => ({ ...p, [key]: value }));
  };

  const applyHeaderColor = useCallback((colorValue) => {
    const nextColor = sanitizeColorToken(colorValue);
    if (!nextColor) return;
    const titleSource = syncTitleDraftFromDom() || styleDraft.titleHtml || defaultTitleHtml;
    const contentSource = syncBodyDraftFromDom() || styleDraft.contentHtml || defaultDescriptionHtml;
    const normalizedTitleHtml = stripInlineColorStyles(titleSource) || defaultTitleHtml;
    const normalizedContentHtml = stripInlineColorStyles(contentSource) || defaultDescriptionHtml;

    applyStyleDraftPatch({
      titleColor: nextColor,
      descriptionColor: nextColor,
      titleHtml: normalizedTitleHtml,
      contentHtml: normalizedContentHtml
    });
  }, [
    applyStyleDraftPatch,
    syncTitleDraftFromDom,
    syncBodyDraftFromDom,
    styleDraft.titleHtml,
    styleDraft.contentHtml,
    defaultTitleHtml,
    defaultDescriptionHtml
  ]);

  const customPickerColor = useMemo(
    () => hsvToHex(customPicker.h, customPicker.s, customPicker.v),
    [customPicker.h, customPicker.s, customPicker.v]
  );

  const closeCustomColorPicker = useCallback(() => {
    setCustomPicker((prev) => ({ ...prev, open: false }));
    setPickerDragMode('');
  }, []);

  const openCustomColorPicker = (event, target) => {
    const unifiedColor = (styleDraft.titleColor && styleDraft.titleColor === styleDraft.descriptionColor)
      ? styleDraft.titleColor
      : '';
    let baseColor = safeHexColor(styleDraft.descriptionColor || styleDraft.titleColor, '#111827');
    if (target === 'title') {
      baseColor = safeHexColor(styleDraft.titleColor, '#111827');
    } else if (target === 'description') {
      baseColor = safeHexColor(styleDraft.descriptionColor, '#111827');
    } else if (target === 'global') {
      baseColor = safeHexColor(unifiedColor || styleDraft.titleColor || styleDraft.descriptionColor, '#111827');
    }
    const hsv = hexToHsv(baseColor);
    const triggerRect = event.currentTarget.getBoundingClientRect();
    const panelWidth = 328;
    const panelHeight = 290;

    let left = triggerRect.right + 10;
    let top = triggerRect.top - 10;

    if (left + panelWidth > window.innerWidth - 8) {
      left = triggerRect.left - panelWidth - 10;
    }
    if (left < 8) left = 8;
    if (top + panelHeight > window.innerHeight - 8) {
      top = window.innerHeight - panelHeight - 8;
    }
    if (top < 8) top = 8;

    setCustomPicker({
      open: true,
      target,
      left,
      top,
      h: hsv.h,
      s: hsv.s,
      v: hsv.v
    });
    setPickerHexDraft(baseColor);
  };

  const applyCustomPickerColor = () => {
    const nextColor = safeHexColor(pickerHexDraft || customPickerColor, customPickerColor);
    if (customPicker.target === 'title') {
      applyStyleDraftPatch({ titleColor: nextColor });
    } else if (customPicker.target === 'description') {
      applyStyleDraftPatch({ descriptionColor: nextColor });
    } else {
      applyHeaderColor(nextColor);
    }
    closeCustomColorPicker();
  };

  const updatePickerFromSvPointer = useCallback((clientX, clientY) => {
    if (!pickerSvRef.current) return;
    const rect = pickerSvRef.current.getBoundingClientRect();
    const s = clamp((clientX - rect.left) / rect.width, 0, 1);
    const v = clamp(1 - ((clientY - rect.top) / rect.height), 0, 1);
    setCustomPicker((prev) => ({ ...prev, s, v }));
  }, []);

  const updatePickerFromHuePointer = useCallback((clientY) => {
    if (!pickerHueRef.current) return;
    const rect = pickerHueRef.current.getBoundingClientRect();
    const h = clamp(((clientY - rect.top) / rect.height) * 360, 0, 360);
    setCustomPicker((prev) => ({ ...prev, h }));
  }, []);

  useEffect(() => {
    if (!customPicker.open) return undefined;

    const onPointerDown = (event) => {
      const target = event.target;
      if (target && target.closest && target.closest('.notice-custom-color-picker')) return;
      if (target && target.closest && target.closest('.notice-color-dot-any')) return;
      closeCustomColorPicker();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeCustomColorPicker();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [customPicker.open, closeCustomColorPicker]);

  useEffect(() => {
    if (!customPicker.open || !pickerDragMode) return undefined;
    const onMouseMove = (event) => {
      if (pickerDragMode === 'sv') updatePickerFromSvPointer(event.clientX, event.clientY);
      if (pickerDragMode === 'hue') updatePickerFromHuePointer(event.clientY);
    };
    const onMouseUp = () => setPickerDragMode('');

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [customPicker.open, pickerDragMode, updatePickerFromHuePointer, updatePickerFromSvPointer]);

  useEffect(() => {
    if (!customPicker.open) return;
    setPickerHexDraft(customPickerColor);
  }, [customPickerColor, customPicker.open]);

  const openEditModal = () => {
    if (!isAdmin || !notice?._id) return;
    setActionMessage({ type: '', text: '' });
    setEditForm({
      title: String(notice.title || notice.subject || '').trim(),
      description: String(notice.content || notice.body || notice.summary || '').trim(),
      kind: String(notice.kind || '').toUpperCase() === 'HOLIDAY' ? 'HOLIDAY' : 'GENERAL',
      holidayName: String(notice.holidayName || '').trim(),
      startDateTime: toDateTimeLocalInput(notice.startDateTime),
      endDateTime: toDateTimeLocalInput(notice.endDateTime),
      rooms: Array.isArray(notice.rooms) ? notice.rooms : [],
      closureAllHalls: Boolean(notice.closureAllHalls)
    });
    setEditError('');
    setEditOpen(true);
  };

  const closeEditModal = () => {
    if (editSaving) return;
    setEditOpen(false);
    setEditError('');
  };

  const saveEditedNotice = async (e) => {
    e?.preventDefault?.();
    if (!isAdmin || !id) return;

    const nextTitle = String(editForm.title || '').trim();
    const nextDescription = String(editForm.description || '').trim();
    const nextStart = editForm.startDateTime ? toIsoOrNull(editForm.startDateTime) : null;
    const nextEnd = editForm.endDateTime ? toIsoOrNull(editForm.endDateTime) : null;

    if (!nextTitle && !nextDescription) {
      setEditError('Title or description is required.');
      return;
    }

    if ((editForm.startDateTime && !nextStart) || (editForm.endDateTime && !nextEnd)) {
      setEditError('Please provide valid start/end timeline values.');
      return;
    }

    if (nextStart && nextEnd && new Date(nextEnd) <= new Date(nextStart)) {
      setEditError('End timeline must be after start timeline.');
      return;
    }

    const payloadRooms = editForm.closureAllHalls ? [] : (Array.isArray(editForm.rooms) ? editForm.rooms : []);
    const payloadKind = editForm.kind === 'HOLIDAY' ? 'HOLIDAY' : 'GENERAL';
    const payloadHolidayName = payloadKind === 'HOLIDAY' ? String(editForm.holidayName || '').trim() : '';

    setEditSaving(true);
    setEditError('');
    setActionMessage({ type: '', text: '' });
    try {
      await updateNoticeApi(id, {
        title: nextTitle,
        subject: nextTitle,
        description: nextDescription,
        content: nextDescription,
        body: nextDescription,
        summary: nextDescription,
        startDateTime: nextStart,
        endDateTime: nextEnd,
        rooms: payloadRooms,
        closureAllHalls: Boolean(editForm.closureAllHalls),
        kind: payloadKind,
        holidayName: payloadHolidayName
      });
      await fetchNotice();
      setEditOpen(false);
      setActionMessage({ type: 'success', text: 'Notice updated successfully.' });
    } catch (err) {
      setEditError(err?.response?.data?.error || 'Unable to update notice.');
    } finally {
      setEditSaving(false);
    }
  };

  const openDeleteDialog = () => {
    if (!isAdmin || !notice?._id) return;
    setActionMessage({ type: '', text: '' });
    setDeleteDialogOpen(true);
  };

  const closeDeleteDialog = () => {
    if (deleteSaving) return;
    setDeleteDialogOpen(false);
  };

  const confirmDeleteNotice = async () => {
    if (!isAdmin || !id) return;
    setDeleteSaving(true);
    setActionMessage({ type: '', text: '' });
    try {
      await deleteNoticeApi(id);
      setDeleteDialogOpen(false);
      navigate('/notices', { replace: true });
    } catch (err) {
      setActionMessage({ type: 'error', text: err?.response?.data?.error || 'Unable to delete notice.' });
    } finally {
      setDeleteSaving(false);
    }
  };

  const themeClasses = `notices-theme-root reader-theme-${reading.theme} reader-font-${reading.font}`;
  const titleUsesGlobalTypography = typographyOverrideMode.title === 'global';
  const descriptionUsesGlobalTypography = typographyOverrideMode.description === 'global';
  const globalDescriptionFontSizePx = reading.textSize;
  const globalTitleFontSizePx = Number((globalDescriptionFontSizePx * GLOBAL_TITLE_DESC_RATIO).toFixed(2));
  const titleFontKey = titleUsesGlobalTypography
    ? reading.font
    : (sanitizeFontToken(styleDraft.titleFont) || reading.font);
  const descriptionFontKey = descriptionUsesGlobalTypography
    ? reading.font
    : (sanitizeFontToken(styleDraft.descriptionFont) || reading.font);
  const titleFontSizePx = titleUsesGlobalTypography
    ? globalTitleFontSizePx
    : (sanitizeFontSizeToken(styleDraft.titleFontSize) || globalTitleFontSizePx);
  const descriptionFontSizePx = descriptionUsesGlobalTypography
    ? globalDescriptionFontSizePx
    : (sanitizeFontSizeToken(styleDraft.descriptionFontSize) || globalDescriptionFontSizePx);
  const titleFontFamily = getFontStack(titleFontKey, reading.font);
  const descriptionFontFamily = getFontStack(descriptionFontKey, reading.font);

  const applyGlobalTextSize = (nextValue) => {
    const size = Math.min(40, Math.max(12, Math.round(Number(nextValue) || reading.textSize)));
    updateReading('textSize', size);
    setTypographyOverrideMode({ title: 'global', description: 'global' });
    applyTypographyResetLocally('both');
  };

  const applyGlobalFont = (fontValue) => {
    const safeFont = sanitizeFontToken(fontValue) || reading.font;
    updateReading('font', safeFont);
    setTypographyOverrideMode({ title: 'global', description: 'global' });
    applyTypographyResetLocally('both');
  };

  const applyTitleTypographyChange = (patch) => {
    setTypographyOverrideMode((prev) => ({ ...prev, title: 'individual' }));
    const resetPatch = buildTypographyResetPatch('title');
    applyStyleDraftPatch({ ...patch, ...resetPatch });
  };

  const applyDescriptionTypographyChange = (patch) => {
    setTypographyOverrideMode((prev) => ({ ...prev, description: 'individual' }));
    const resetPatch = buildTypographyResetPatch('description');
    applyStyleDraftPatch({ ...patch, ...resetPatch });
  };

  const applySelectionFont = (fontKey) => {
    const safeKey = sanitizeFontToken(fontKey) || reading.font;
    setSelectionTextControls((prev) => ({ ...prev, font: safeKey }));
    applyInlineStyleFromSelection({ fontFamily: getFontStack(safeKey, reading.font) });
  };

  const applySelectionFontSize = (fontSize) => {
    const next = Math.min(72, Math.max(12, Math.round(Number(fontSize) || reading.textSize)));
    setSelectionTextControls((prev) => ({ ...prev, fontSize: next }));
    applyInlineStyleFromSelection({ fontSize: `${next}px` });
  };

  const updatePrintDialog = (patch) => {
    setPrintDialog((prev) => ({ ...prev, ...patch }));
  };

  const closePrintDialog = () => {
    setPrintDialog((prev) => ({ ...prev, open: false }));
  };

  const openPrintDialog = () => {
    syncBodyDraftFromDom();
    syncTitleDraftFromDom();
    clearSelectionToolbar();
    setPrintDialog((prev) => ({ ...prev, open: true }));
  };

  const buildNoticePrintDocument = () => {
    if (!notice || typeof document === 'undefined') return;

    const currentBodyHtml = sanitizeDescriptionHtml(syncBodyDraftFromDom() || styleDraft.contentHtml || defaultDescriptionHtml);
    const currentTitleHtml = sanitizeTitleHtml(syncTitleDraftFromDom() || styleDraft.titleHtml || defaultTitleHtml);
    const marginMm = 14;
    const innerPadMm = Math.max(4, Math.min(16, Math.round(marginMm * 0.55)));
    const paperSize = 'A4';
    const orientation = 'portrait';
    const fontStack = getFontStack(reading.font, 'outfit');
    const bwMode = String(printDialog.colorMode || 'color') === 'bw';
    const border = printDialog.includeBorder ? '1px solid #cbd5e1' : 'none';
    const titleColor = safeHexColor(styleDraft.titleColor, '#0f172a');
    const descriptionColor = safeHexColor(styleDraft.descriptionColor, '#111827');
    const printTitleFont = getFontStack(titleFontKey, reading.font);
    const printDescriptionFont = getFontStack(descriptionFontKey, reading.font);
    const printTitleFontSize = titleFontSizePx;
    const printDescriptionFontSize = descriptionFontSizePx;

    const chips = [
      notice.kind === 'HOLIDAY' ? 'CLOSURE NOTICE' : 'GENERAL NOTICE',
      `Published: ${formatDate(notice.createdAt)}`,
      notice.holidayName ? `Event: ${notice.holidayName}` : '',
      notice.startDateTime ? `Start: ${formatDate(notice.startDateTime)}` : '',
      notice.endDateTime ? `End: ${formatDate(notice.endDateTime)}` : '',
      Array.isArray(notice.rooms) && notice.rooms.length > 0 ? `Rooms: ${notice.rooms.join(', ')}` : '',
      notice.closureAllHalls ? 'All halls marked closed' : ''
    ].filter(Boolean);

    const chipsHtml = printDialog.includeMeta
      ? `<div class="meta">${chips.map((item, index) => `<span class="${index === 0 ? 'badge' : ''}">${escapeHtml(item)}</span>`).join('')}</div>`
      : '';

    const rawDocTitle = String(notice.title || notice.subject || 'Notice').trim() || 'Notice';
    const docTitle = escapeHtml(rawDocTitle);
    const docHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${docTitle}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Courgette&family=Fira+Code:wght@400;500&family=Lora:ital,wght@0,400;0,500;0,600;1,400&family=Merriweather:wght@300;400;700&family=Nunito:wght@400;600&family=Oswald:wght@400;500&family=Outfit:wght@300;400;500;600;700&family=Playfair+Display:wght@400;600&family=Roboto:wght@400;500&family=Space+Grotesk:wght@400;500&display=swap">
  <style>
    @page { size: ${paperSize} ${orientation}; margin: ${marginMm}mm; }
    html, body { margin: 0; padding: 0; background: #ffffff; color: #0f172a; font-family: ${fontStack}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .shell { width: 100%; box-sizing: border-box; padding: 0 ${innerPadMm}mm; border: ${border}; border-radius: 10px; }
    h1 { margin: 0 0 12px; font-size: ${printTitleFontSize}px; line-height: 1.25; color: ${titleColor}; font-weight: 700; font-family: ${printTitleFont}; }
    .meta { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 18px; }
    .meta span { border: 1px solid #cbd5e1; border-radius: 6px; padding: 4px 10px; font-size: 12px; color: #334155; background: #f8fafc; }
    .meta .badge { text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700; }
    .separator { border: 0; border-top: 1px solid #dbe5f0; margin: 0 0 18px; }
    .body { color: ${descriptionColor}; font-size: ${printDescriptionFontSize}px; line-height: 1.78; font-family: ${printDescriptionFont}; }
    .body p { margin: 0 0 1.1em; text-indent: 1.15em; line-height: 1.78; orphans: 3; widows: 3; }
    ${bwMode ? `
    .shell { filter: grayscale(1); }
    .body, .body * { color: #111827 !important; }
    .meta span { background: #ffffff !important; border-color: #9ca3af !important; color: #111827 !important; }
    ` : ''}
  </style>
</head>
<body>
  <article class="shell">
    <h1>${currentTitleHtml}</h1>
    ${chipsHtml}
    <hr class="separator" />
    <section class="body">${currentBodyHtml}</section>
  </article>
</body>
</html>`;

    return {
      html: docHtml,
      title: rawDocTitle,
      marginMm,
      orientation
    };
  };

  const runCustomPrint = () => {
    const built = buildNoticePrintDocument();
    if (!built) return;
    printHtmlDocument({
      html: built.html,
      title: built.title,
      validate: (doc) => {
        const hasTitle = Boolean(doc.querySelector('h1'));
        const bodyText = String(doc.querySelector('.body')?.textContent || '').trim();
        return hasTitle && bodyText.length > 0;
      },
      settleDelayMs: 360,
      printFallbackCleanupMs: 180000,
      initFallbackCleanupMs: 240000
    });
    closePrintDialog();
  };

  const downloadNoticePdf = async () => {
    if (printPdfBusy) return;
    const built = buildNoticePrintDocument();
    if (!built) return;
    setPrintPdfBusy(true);
    try {
      await exportPdfFromPrintHtml({
        html: built.html,
        title: built.title,
        orientation: built.orientation,
        marginMm: built.marginMm
      });
      setActionMessage({ type: 'success', text: 'Notice PDF downloaded.' });
      closePrintDialog();
    } catch (_) {
      setActionMessage({ type: 'error', text: 'Unable to download notice PDF.' });
    } finally {
      setPrintPdfBusy(false);
    }
  };

  const titleColorChanged = (styleDraft.titleColor || '') !== (originalColorState.titleColor || '');
  const descriptionColorChanged = (styleDraft.descriptionColor || '') !== (originalColorState.descriptionColor || '');
  const headerSharedColor = (styleDraft.titleColor && styleDraft.titleColor === styleDraft.descriptionColor)
    ? styleDraft.titleColor
    : '';
  const allDetailCardsCollapsed = isTitleControlsCollapsed && isDescriptionControlsCollapsed;
  const allFixedPanelsCollapsed = isHeaderStripCollapsed && allDetailCardsCollapsed;

  return (
    <div
      className={`notice-detail-print-page ${themeClasses} ${isHeaderStripCollapsed ? 'notice-header-strip-collapsed' : ''}`}
      style={{
        '--font-base': `${reading.textSize}px`,
        '--notice-header-strip-height': `${headerStripHeight}px`,
        '--notice-detail-controls-height': `${detailControlsHeight}px`,
        '--notice-combined-fixed-height': `${Math.max(0, headerStripHeight + detailControlsHeight)}px`,
        '--notice-header-expand-top': `${headerExpandTop}px`,
        '--notice-title-expand-top': `${titleExpandTop}px`,
        '--notice-description-expand-top': `${descriptionExpandTop}px`
      }}
    >
      <div
        className={`notice-detail-fixed-opaque-shell ${allFixedPanelsCollapsed ? 'is-hidden' : ''}`}
        aria-hidden="true"
      />
      <div className="notices-layout-center">
        <section
          ref={headerStripRef}
          className={`notices-sticky-strip notice-detail-sticky-strip ${isHeaderStripCollapsed ? 'notice-detail-sticky-strip-collapsed' : ''}`}
        >
          {!isHeaderStripCollapsed && (
            <>
              <div className="notice-detail-strip-main-row">
                <Link className="notices-hero-home notice-detail-board-link" to="/notices">
                  <Icons.ArrowLeft /> Board
                </Link>

                <div className="notice-detail-strip-controls-top">
                  {!isMobile && (
                    <div className="notice-color-swatches compact notice-header-color-swatches notice-header-color-swatches-desktop">
                      {TITLE_COLORS.map((color) => (
                        <button
                          key={`header-desktop-color-${color.key}`}
                          type="button"
                          className={`notice-color-dot ${headerSharedColor === color.value ? 'active' : ''}`}
                          style={{ '--dot-color': color.value }}
                          title={`Apply ${color.label} to all`}
                          aria-label={`Apply ${color.label} to title, description and selected text`}
                          onClick={() => applyHeaderColor(color.value)}
                        />
                      ))}
                      <button
                        type="button"
                        className="notice-color-dot notice-color-dot-any"
                        title="Choose any global color"
                        aria-label="Choose any global color"
                        onClick={(e) => openCustomColorPicker(e, 'global')}
                      />
                    </div>
                  )}

                  {notice && (
                    <div className="notice-admin-icon-group" role="group" aria-label="Notice actions">
                      {isAdmin && (
                        <button
                          type="button"
                          className={`notice-admin-icon-btn scope ${hasPendingStyleChanges ? 'has-pending' : ''}`}
                          onClick={openScopeDialog}
                          title="Apply styling scope"
                          aria-label="Apply styling scope"
                        >
                          <Icons.Scope />
                        </button>
                      )}
                      <button
                        type="button"
                        className="notice-admin-icon-btn print"
                        onClick={openPrintDialog}
                        title="Print notice"
                        aria-label="Print notice"
                      >
                        <Icons.Print />
                      </button>
                      {isAdmin && (
                        <>
                          <button
                            type="button"
                            className="notice-admin-icon-btn"
                            onClick={openEditModal}
                            title="Edit notice"
                            aria-label="Edit notice"
                          >
                            <Icons.Edit />
                          </button>
                          <button
                            type="button"
                            className="notice-admin-icon-btn danger"
                            onClick={openDeleteDialog}
                            title="Delete notice"
                            aria-label="Delete notice"
                          >
                            <Icons.Trash />
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {isMobile && (
                    <div className="notice-color-swatches compact notice-header-color-swatches notice-header-color-swatches-mobile-inline">
                      {COMPACT_NOTICE_COLORS.map((color) => (
                        <button
                          key={`header-mobile-inline-color-${color.key}`}
                          type="button"
                          className={`notice-color-dot ${headerSharedColor === color.value ? 'active' : ''}`}
                          style={{ '--dot-color': color.value }}
                          title={`Apply ${color.label} to all`}
                          aria-label={`Apply ${color.label} to title, description and selected text`}
                          onClick={() => applyHeaderColor(color.value)}
                        />
                      ))}
                      <button
                        type="button"
                        className="notice-color-dot notice-color-dot-any"
                        title="Choose any global color"
                        aria-label="Choose any global color"
                        onClick={(e) => openCustomColorPicker(e, 'global')}
                      />
                    </div>
                  )}

                  <div className="readability-group notice-detail-theme-group notice-detail-theme-group-top">
                    <button type="button" onClick={() => updateReading('theme', 'classic')} className={`readability-btn ${reading.theme === 'classic' ? 'active' : ''}`}><Icons.Sun/></button>
                    <button type="button" onClick={() => updateReading('theme', 'paper')} className={`readability-btn ${reading.theme === 'paper' ? 'active' : ''}`}><Icons.Book/></button>
                    <button type="button" onClick={() => updateReading('theme', 'night')} className={`readability-btn ${reading.theme === 'night' ? 'active' : ''}`}><Icons.Moon/></button>
                  </div>

                  <div className="notice-detail-typography-desktop">
                    <FontSizeControl
                      value={reading.textSize}
                      onChange={applyGlobalTextSize}
                      min={12}
                      max={40}
                      className="notice-header-font-size-group notice-detail-header-font-size-group"
                      ariaLabel="Global font size control"
                    />

                    <div className="readability-group notice-detail-font-select-group">
                      <select
                        className="readability-select"
                        value={reading.font}
                        onChange={(e) => applyGlobalFont(e.target.value)}
                      >
                        {FONT_OPTIONS.map((opt) => (
                          <option key={`reading-font-desktop-${opt.value}`} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="notice-detail-strip-typography-row">
                <div className="readability-group notice-detail-theme-group notice-detail-theme-group-mobile">
                  <button type="button" onClick={() => updateReading('theme', 'classic')} className={`readability-btn ${reading.theme === 'classic' ? 'active' : ''}`}><Icons.Sun/></button>
                  <button type="button" onClick={() => updateReading('theme', 'paper')} className={`readability-btn ${reading.theme === 'paper' ? 'active' : ''}`}><Icons.Book/></button>
                  <button type="button" onClick={() => updateReading('theme', 'night')} className={`readability-btn ${reading.theme === 'night' ? 'active' : ''}`}><Icons.Moon/></button>
                </div>

                <FontSizeControl
                  value={reading.textSize}
                  onChange={applyGlobalTextSize}
                  min={12}
                  max={40}
                  className="notice-header-font-size-group notice-detail-header-font-size-group"
                  ariaLabel="Global font size control"
                />

                <div className="readability-group notice-detail-font-select-group">
                  <select
                    className="readability-select"
                    value={reading.font}
                    onChange={(e) => applyGlobalFont(e.target.value)}
                  >
                    {FONT_OPTIONS.map((opt) => (
                      <option key={`reading-font-${opt.value}`} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="button"
                ref={headerEdgeToggleRef}
                className="notice-detail-strip-edge-toggle"
                onClick={() => setIsHeaderStripCollapsed(true)}
                aria-label="Collapse notice detail header strip"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
              </button>
            </>
          )}
        </section>

        {isHeaderStripCollapsed && !isMobile && (
          <button
            type="button"
            className="notice-detail-strip-float-toggle"
            onClick={() => setIsHeaderStripCollapsed(false)}
            aria-label="Expand notice detail header strip"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        )}

        {isMobile && (isHeaderStripCollapsed || isTitleControlsCollapsed || isDescriptionControlsCollapsed) && (
          <div className="notice-detail-mobile-collapse-stack" aria-label="Collapsed strip controls">
            {isHeaderStripCollapsed && (
              <button
                type="button"
                className="notice-detail-mobile-collapse-btn"
                onClick={() => setIsHeaderStripCollapsed(false)}
                aria-label="Expand notice detail header strip"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            )}

            {isTitleControlsCollapsed && (
              <button
                type="button"
                className="notice-detail-mobile-collapse-btn"
                onClick={() => setIsTitleControlsCollapsed(false)}
                aria-label="Expand title and status controls"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            )}

            {isDescriptionControlsCollapsed && (
              <button
                type="button"
                className="notice-detail-mobile-collapse-btn"
                onClick={() => setIsDescriptionControlsCollapsed(false)}
                aria-label="Expand description controls"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            )}
          </div>
        )}

        {actionMessage.text && (
          <div className={`notice-inline-message ${actionMessage.type === 'error' ? 'error' : ''}`} style={{ marginBottom: '22px' }}>
            {actionMessage.text}
          </div>
        )}

        {loading && <div className="notice-empty">Fetching article...</div>}
        {!loading && error && <div className="notice-empty notice-error">{error}</div>}
        {!loading && !error && !notice && <div className="notice-empty">Notice not found or deleted.</div>}

        {!loading && !error && notice && (
          <article className="notice-detail-container">
            <div
              ref={detailControlsRef}
              className={`notice-detail-fixed-control-area ${allDetailCardsCollapsed ? 'is-empty' : ''}`}
            >
              {!isTitleControlsCollapsed && (
                <section
                  ref={titleControlsCardRef}
                  className="notice-detail-floating-card notice-detail-floating-title-card"
                >
                  <header className="notice-detail-header">
                    <div className="notice-color-control">
                      <div className="notice-color-control-left">
                        <div className="notice-color-swatches">
                          {(isMobile ? COMPACT_NOTICE_COLORS : TITLE_COLORS).map((color) => (
                            <button
                              key={`title-${color.key}`}
                              type="button"
                              className={`notice-color-dot ${styleDraft.titleColor === color.value ? 'active' : ''}`}
                              style={{ '--dot-color': color.value }}
                              title={color.label}
                              aria-label={`Set title color ${color.label}`}
                              onClick={() => applyStyleDraftPatch({ titleColor: color.value })}
                            />
                          ))}
                          <button
                            type="button"
                            className="notice-color-dot notice-color-dot-any"
                            title="Choose any title color"
                            aria-label="Choose any title color"
                            onClick={(e) => openCustomColorPicker(e, 'title')}
                          />
                          {titleColorChanged && (
                            <button
                              type="button"
                              className="notice-color-undo-btn"
                              title="Undo title color"
                              aria-label="Undo title color"
                              onClick={() => applyStyleDraftPatch({ titleColor: originalColorState.titleColor || '' })}
                            >
                              <Icons.Undo />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="notice-color-control-right">
                        <FontSizeControl
                          value={titleFontSizePx}
                          onChange={(next) => applyTitleTypographyChange({ titleFontSize: next })}
                          min={12}
                          max={72}
                          className="notice-inline-font-size-group"
                          ariaLabel="Title font size control"
                        />
                        <div className="readability-group notice-inline-font-family-group">
                          <select
                            className="readability-select notice-inline-font-select"
                            value={titleFontKey}
                            onChange={(e) => applyTitleTypographyChange({ titleFont: e.target.value })}
                            aria-label="Title font style"
                          >
                            {INLINE_FONT_OPTIONS.map((opt) => (
                              <option key={`title-font-${opt.value}`} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    <h1
                      ref={noticeTitleRef}
                      style={{
                        color: styleDraft.titleColor || undefined,
                        fontFamily: titleFontFamily,
                        fontSize: `${titleFontSizePx}px`
                      }}
                      onMouseUp={captureSelectionToolbar}
                      onKeyUp={captureSelectionToolbar}
                      dangerouslySetInnerHTML={{ __html: styleDraft.titleHtml || defaultTitleHtml }}
                    />
                    <div className="notice-meta" style={{ marginTop: '16px' }}>
                      <span className={`notice-badge ${notice.kind === 'HOLIDAY' ? 'holiday' : 'general'}`} style={{ border: 'none' }}>
                        {notice.kind === 'HOLIDAY' ? 'Closure Notice' : 'General Notice'}
                      </span>
                      <span>Published: {formatDate(notice.createdAt)}</span>
                      <span>Source: {notice.source === 'EMAIL' ? 'Email Notice' : 'Manual Notice'}</span>
                      {notice.emailFrom && <span>From: {notice.emailFrom}</span>}
                      {notice.holidayName && <span>Event: {notice.holidayName}</span>}
                      {notice.startDateTime && <span>Start: {formatDate(notice.startDateTime)}</span>}
                      {notice.endDateTime && <span>End: {formatDate(notice.endDateTime)}</span>}
                      {Array.isArray(notice.rooms) && notice.rooms.length > 0 && (
                        <span>Rooms: {notice.rooms.join(', ')}</span>
                      )}
                      {notice.closureAllHalls && <span>All halls marked closed</span>}
                    </div>
                  </header>

                  <button
                    type="button"
                    ref={titleCardToggleRef}
                    className="notice-detail-content-card-toggle"
                    aria-label="Collapse title and status controls"
                    onClick={() => setIsTitleControlsCollapsed(true)}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                  </button>
                </section>
              )}

              {isTitleControlsCollapsed && !isMobile && (
                <button
                  type="button"
                  className="notice-detail-content-card-expand notice-detail-title-card-expand"
                  aria-label="Expand title and status controls"
                  onClick={() => setIsTitleControlsCollapsed(false)}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </button>
              )}

              {!isDescriptionControlsCollapsed && (
                <section
                  ref={descriptionControlsCardRef}
                  className="notice-detail-floating-card notice-detail-floating-description-card"
                >
                  <div className="notice-color-control">
                    <div className="notice-color-control-left">
                      <div className="notice-color-swatches">
                        {(isMobile ? COMPACT_NOTICE_COLORS : TITLE_COLORS).map((color) => (
                          <button
                            key={`desc-${color.key}`}
                            type="button"
                            className={`notice-color-dot ${styleDraft.descriptionColor === color.value ? 'active' : ''}`}
                            style={{ '--dot-color': color.value }}
                            title={color.label}
                            aria-label={`Set description color ${color.label}`}
                            onClick={() => applyStyleDraftPatch({ descriptionColor: color.value })}
                          />
                        ))}
                        <button
                          type="button"
                          className="notice-color-dot notice-color-dot-any"
                          title="Choose any description color"
                          aria-label="Choose any description color"
                          onClick={(e) => openCustomColorPicker(e, 'description')}
                        />
                        {descriptionColorChanged && (
                          <button
                            type="button"
                            className="notice-color-undo-btn"
                            title="Undo description color"
                            aria-label="Undo description color"
                            onClick={() => applyStyleDraftPatch({ descriptionColor: originalColorState.descriptionColor || '' })}
                          >
                            <Icons.Undo />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="notice-color-control-right">
                      <FontSizeControl
                        value={descriptionFontSizePx}
                        onChange={(next) => applyDescriptionTypographyChange({ descriptionFontSize: next })}
                        min={12}
                        max={72}
                        className="notice-inline-font-size-group"
                        ariaLabel="Description font size control"
                      />
                      <div className="readability-group notice-inline-font-family-group">
                        <select
                          className="readability-select notice-inline-font-select"
                          value={descriptionFontKey}
                          onChange={(e) => applyDescriptionTypographyChange({ descriptionFont: e.target.value })}
                          aria-label="Description font style"
                        >
                          {INLINE_FONT_OPTIONS.map((opt) => (
                            <option key={`description-font-${opt.value}`} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    ref={descriptionCardToggleRef}
                    className="notice-detail-content-card-toggle"
                    aria-label="Collapse description controls"
                    onClick={() => setIsDescriptionControlsCollapsed(true)}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                  </button>
                </section>
              )}

              {isDescriptionControlsCollapsed && !isMobile && (
                <button
                  type="button"
                  className="notice-detail-content-card-expand notice-detail-description-card-expand"
                  aria-label="Expand description controls"
                  onClick={() => setIsDescriptionControlsCollapsed(false)}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </button>
              )}
            </div>

            <div className={`notice-detail-body-wrap ${allDetailCardsCollapsed ? 'controls-fully-collapsed' : ''}`}>
              <div
                className="notice-detail-body"
                ref={noticeBodyRef}
                style={{
                  '--notice-description-color': styleDraft.descriptionColor || '',
                  '--notice-description-font-family': descriptionFontFamily,
                  '--notice-description-font-size': `${descriptionFontSizePx}px`
                }}
                onMouseUp={captureSelectionToolbar}
                onKeyUp={captureSelectionToolbar}
                dangerouslySetInnerHTML={{ __html: styleDraft.contentHtml || defaultDescriptionHtml }}
              />
            </div>

            {selectionToolbar.open && (
              <div
                className="notice-selection-toolbar"
                style={{ left: `${selectionToolbar.x}px`, top: `${selectionToolbar.y}px` }}
              >
                <div className="notice-selection-toolbar-group">
                  <span className="notice-selection-toolbar-label">Typography</span>
                  <FontSizeControl
                    value={selectionTextControls.fontSize || reading.textSize}
                    onChange={applySelectionFontSize}
                    min={12}
                    max={72}
                    className="notice-selection-font-size-group"
                    ariaLabel="Selected text font size control"
                  />
                  <div className="readability-group notice-selection-font-family-group">
                    <select
                      className="readability-select notice-selection-font-select"
                      value={selectionTextControls.font || reading.font}
                      onChange={(e) => applySelectionFont(e.target.value)}
                      aria-label="Selected text font style"
                    >
                      {FONT_OPTIONS.map((opt) => (
                        <option key={`selected-font-${opt.value}`} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="notice-selection-toolbar-group">
                  <span className="notice-selection-toolbar-label">Text</span>
                  <div className="notice-color-swatches compact">
                    {INLINE_TEXT_COLORS.map((color) => (
                      <button
                        key={`inline-text-${color.key}`}
                        type="button"
                        className="notice-color-dot"
                        style={{ '--dot-color': color.value }}
                        title={color.label}
                        aria-label={color.label}
                        onClick={() => applyInlineStyleFromSelection({ color: color.value })}
                      />
                    ))}
                    <button
                      type="button"
                      className="notice-color-dot notice-color-dot-any"
                      title="Choose any text color"
                      aria-label="Choose any text color"
                      onClick={() => inlineTextColorInputRef.current?.click()}
                    />
                    <input
                      ref={inlineTextColorInputRef}
                      type="color"
                      className="notice-color-hidden-input"
                      value="#111827"
                      onChange={(e) => applyInlineStyleFromSelection({ color: e.target.value })}
                      aria-label="Pick custom text color"
                    />
                  </div>
                </div>
                <div className="notice-selection-toolbar-group">
                  <span className="notice-selection-toolbar-label">Highlight</span>
                  <div className="notice-color-swatches compact">
                    {INLINE_HIGHLIGHT_COLORS.map((color) => (
                      <button
                        key={`inline-highlight-${color.key}`}
                        type="button"
                        className="notice-color-dot"
                        style={{ '--dot-color': color.value }}
                        title={color.label}
                        aria-label={color.label}
                        onClick={() => applyInlineStyleFromSelection({ backgroundColor: color.value })}
                      />
                    ))}
                    <button
                      type="button"
                      className="notice-color-dot notice-color-dot-any"
                      title="Choose any highlight color"
                      aria-label="Choose any highlight color"
                      onClick={() => inlineHighlightColorInputRef.current?.click()}
                    />
                    <input
                      ref={inlineHighlightColorInputRef}
                      type="color"
                      className="notice-color-hidden-input"
                      value="#fef08a"
                      onChange={(e) => applyInlineStyleFromSelection({ backgroundColor: e.target.value })}
                      aria-label="Pick custom highlight color"
                    />
                  </div>
                </div>
              </div>
            )}
          </article>
        )}
      </div>

      {customPicker.open && (
        <div
          ref={customPickerRef}
          className="notice-custom-color-picker"
          style={{ left: `${customPicker.left}px`, top: `${customPicker.top}px` }}
        >
          <div className="notice-custom-color-picker-head">
            <span className="notice-custom-color-picker-title">
              {customPicker.target === 'title' ? 'Title Color' : 'Description Color'}
            </span>
            <span className="notice-custom-color-picker-value">{pickerHexDraft}</span>
          </div>

          <div className="notice-custom-picker-workspace">
            <div
              ref={pickerSvRef}
              className="notice-custom-picker-sv"
              style={{ '--picker-hue-color': `hsl(${customPicker.h}, 100%, 50%)` }}
              onMouseDown={(e) => {
                e.preventDefault();
                updatePickerFromSvPointer(e.clientX, e.clientY);
                setPickerDragMode('sv');
              }}
            >
              <span
                className="notice-custom-picker-sv-thumb"
                style={{
                  left: `${customPicker.s * 100}%`,
                  top: `${(1 - customPicker.v) * 100}%`
                }}
              />
            </div>

            <div
              ref={pickerHueRef}
              className="notice-custom-picker-hue"
              onMouseDown={(e) => {
                e.preventDefault();
                updatePickerFromHuePointer(e.clientY);
                setPickerDragMode('hue');
              }}
            >
              <span
                className="notice-custom-picker-hue-thumb"
                style={{ top: `${(customPicker.h / 360) * 100}%` }}
              />
            </div>
          </div>

          <div className="notice-custom-picker-footer">
            <span className="notice-custom-picker-preview" style={{ background: pickerHexDraft }} />
            <input
              type="text"
              className="notice-custom-picker-hex-input"
              value={pickerHexDraft}
              onChange={(e) => {
                const next = String(e.target.value || '').trim();
                setPickerHexDraft(next);
                if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(next)) {
                  const hsv = hexToHsv(next);
                  setCustomPicker((prev) => ({ ...prev, h: hsv.h, s: hsv.s, v: hsv.v }));
                }
              }}
              aria-label="Custom hex color"
            />
            <button type="button" className="notice-admin-secondary-btn" onClick={closeCustomColorPicker}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={applyCustomPickerColor}>
              Apply
            </button>
          </div>
        </div>
      )}

      {printDialog.open && (
        <div className="notice-admin-modal-backdrop" onClick={closePrintDialog}>
          <section className="notice-print-card" onClick={(e) => e.stopPropagation()}>
            <header className="notice-admin-modal-header">
              <h3>Print Notice</h3>
              <button type="button" className="notice-admin-modal-close" onClick={closePrintDialog} aria-label="Close">
                <Icons.Close />
              </button>
            </header>

            <div className="notice-print-grid">
              <label className="input-group">
                <span>Color Mode</span>
                <select
                  className="premium-input"
                  value={printDialog.colorMode}
                  onChange={(e) => updatePrintDialog({ colorMode: e.target.value })}
                >
                  <option value="color">Color</option>
                  <option value="bw">Black &amp; White</option>
                </select>
              </label>
            </div>

            <div className="notice-print-toggles">
              <label className="notice-checkbox-label">
                <input
                  type="checkbox"
                  checked={printDialog.includeMeta}
                  onChange={(e) => updatePrintDialog({ includeMeta: e.target.checked })}
                />
                Include status/timeline chips
              </label>

              <label className="notice-checkbox-label">
                <input
                  type="checkbox"
                  checked={printDialog.includeBorder}
                  onChange={(e) => updatePrintDialog({ includeBorder: e.target.checked })}
                />
                Add page frame border
              </label>
            </div>

            <p className="notice-print-note">
              This opens print preview from a clean generated document, so app route text is not used as the page URL header.
            </p>

            <div className="notice-admin-modal-actions">
              <button type="button" className="notice-admin-secondary-btn" onClick={closePrintDialog}>
                Cancel
              </button>
              {isMobile && (
                <button
                  type="button"
                  className="notice-admin-secondary-btn"
                  onClick={downloadNoticePdf}
                  disabled={printPdfBusy}
                >
                  {printPdfBusy ? 'Preparing PDF...' : 'Download PDF'}
                </button>
              )}
              <button type="button" className="btn-primary" onClick={runCustomPrint}>
                Preview &amp; Print
              </button>
            </div>
          </section>
        </div>
      )}

      {scopeDialog.open && (
        <div className="notice-admin-modal-backdrop" onClick={closeScopeDialog}>
          <section className="notice-style-scope-card" onClick={(e) => e.stopPropagation()}>
            <header className="notice-admin-modal-header">
              <h3>Apply Styling Scope</h3>
              <button type="button" className="notice-admin-modal-close" onClick={closeScopeDialog} aria-label="Close">
                <Icons.Close />
              </button>
            </header>
            <p className="notice-style-scope-copy">
              Apply all current styling changes at once.
            </p>
            <div className="notice-style-scope-actions">
              <button type="button" className="btn-primary" onClick={() => applyScopeChoice('public')}>
                Public for All
              </button>
              <button type="button" className="notice-admin-secondary-btn" onClick={() => applyScopeChoice('private_temporary')}>
                Private Temporary
              </button>
              <button type="button" className="notice-admin-secondary-btn" onClick={() => applyScopeChoice('private_permanent')}>
                Private Permanent
              </button>
            </div>
          </section>
        </div>
      )}

      {editOpen && (
        <div className="notice-admin-modal-backdrop" onClick={closeEditModal}>
          <section className="notice-admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <header className="notice-admin-modal-header">
              <h3>Edit Notice</h3>
              <button type="button" className="notice-admin-modal-close" onClick={closeEditModal} aria-label="Close">
                <Icons.Close />
              </button>
            </header>

            <form onSubmit={saveEditedNotice} className="notice-admin-modal-form">
              <label className="input-group">
                <span>Title</span>
                <input
                  className="premium-input"
                  value={editForm.title}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="Notice title"
                  maxLength={240}
                />
              </label>

              <label className="input-group">
                <span>Description</span>
                <textarea
                  className="premium-input"
                  value={editForm.description}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Detailed notice content"
                />
              </label>

              <div className="notice-admin-modal-grid">
                <label className="input-group">
                  <span>Classification</span>
                  <select
                    className="premium-input"
                    value={editForm.kind}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, kind: e.target.value }))}
                  >
                    <option value="GENERAL">General Notice</option>
                    <option value="HOLIDAY">Holiday / Closure</option>
                  </select>
                </label>

                <label className="input-group">
                  <span>Holiday Event Name (Optional)</span>
                  <input
                    className="premium-input"
                    value={editForm.holidayName}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, holidayName: e.target.value }))}
                    placeholder="Event name"
                    maxLength={180}
                    disabled={editForm.kind !== 'HOLIDAY'}
                  />
                </label>
              </div>

              <div className="notice-admin-modal-grid">
                <label className="input-group">
                  <span>Start Timeline</span>
                  <input
                    className="premium-input"
                    type="datetime-local"
                    value={editForm.startDateTime}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, startDateTime: e.target.value }))}
                  />
                </label>

                <label className="input-group">
                  <span>End Timeline</span>
                  <input
                    className="premium-input"
                    type="datetime-local"
                    value={editForm.endDateTime}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, endDateTime: e.target.value }))}
                  />
                </label>
              </div>

              <label className="input-group">
                <span>Affected Halls</span>
                <HallMultiSelectDropdown
                  halls={halls}
                  selectedHalls={editForm.rooms}
                  onChange={(next) => setEditForm((prev) => ({ ...prev, rooms: next }))}
                  disabled={editForm.closureAllHalls}
                  startDateTime={editForm.startDateTime}
                  endDateTime={editForm.endDateTime}
                  fieldHeight={35}
                  fieldPlaceholderOffsetY={5}
                  fieldInputOffsetY={2}
                  hallRowNameOffsetY={-1}
                />
              </label>

              <label className="notice-checkbox-label">
                <input
                  type="checkbox"
                  checked={editForm.closureAllHalls}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setEditForm((prev) => ({ ...prev, closureAllHalls: checked, rooms: checked ? [] : prev.rooms }));
                  }}
                />
                Campus-wide closure applies
              </label>

              {editError && <div className="notice-admin-error">{editError}</div>}

              <div className="notice-admin-modal-actions">
                <button type="button" className="notice-admin-secondary-btn" onClick={closeEditModal} disabled={editSaving}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={editSaving}>
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {deleteDialogOpen && (
        <div className="notice-admin-modal-backdrop" onClick={closeDeleteDialog}>
          <section className="notice-delete-confirm-card" onClick={(e) => e.stopPropagation()}>
            <div className="notice-delete-confirm-head">
              <div className="notice-delete-confirm-icon">
                <Icons.Alert />
              </div>
              <div className="notice-delete-confirm-copy">
                <h4>Delete this notice?</h4>
                <p className="notice-delete-confirm-title">{notice?.title || notice?.subject || 'Selected notice'}</p>
                <p className="notice-delete-confirm-desc">
                  This will remove the notice from the board and move it to trash.
                </p>
              </div>
            </div>

            <div className="notice-delete-confirm-actions">
              <button type="button" className="notice-admin-secondary-btn" onClick={closeDeleteDialog} disabled={deleteSaving}>
                Cancel
              </button>
              <button type="button" className="notice-admin-danger-btn" onClick={confirmDeleteNotice} disabled={deleteSaving}>
                {deleteSaving ? 'Deleting...' : 'Delete Notice'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
