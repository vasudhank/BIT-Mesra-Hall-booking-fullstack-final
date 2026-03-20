import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  getNoticeTrashRetentionApi,
  getTrashedNoticesApi,
  permanentlyDeleteNoticeApi,
  restoreNoticeApi,
  updateNoticeTrashRetentionApi
} from '../api/noticesApi';
import { getCalendarAppearanceApi } from '../api/calendarApi';
import './TrashPage.css';

const THEME_COOKIE_KEY = 'bb_calendar_theme';
const VALID_THEME_MODES = ['Light', 'Dark', 'Auto'];

const normalizeThemeMode = (value) => {
  if (VALID_THEME_MODES.includes(String(value || ''))) return String(value);
  return 'Light';
};

const readCookieValue = (key) => {
  if (typeof document === 'undefined') return '';
  const parts = String(document.cookie || '').split(';');
  const item = parts.find((entry) => entry.trim().startsWith(`${key}=`));
  if (!item) return '';
  return decodeURIComponent(item.trim().slice(key.length + 1));
};

const Svgs = {
  Back: () => <svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"></path></svg>,
  Search: () => <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27a6 6 0 10-.71.71l.27.28v.79L20 21.5 21.5 20l-6-6zm-5.5 0A4.5 4.5 0 1110 5a4.5 4.5 0 010 9z"></path></svg>,
  ChevronDown: () => <svg viewBox="0 0 24 24"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"></path></svg>,
  Delete: () => <svg viewBox="0 0 24 24"><path d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2h4v2H4V6h4l1-2z"></path></svg>,
  Restore: () => <svg viewBox="0 0 24 24"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-.5-5-2-10-11-12z"></path></svg>
};

const MOBILE_MEDIA_QUERY = '(max-width: 768px)';

const TRASH_SORT_OPTIONS = [
  { value: 'TRASH_LATEST', label: 'Deleted Date (Newest)', compact: 'Deleted v' },
  { value: 'TRASH_OLDEST', label: 'Deleted Date (Oldest)', compact: 'Deleted ^' },
  { value: 'PUBLISHED_LATEST', label: 'Published Date (Newest)', compact: 'Published v' },
  { value: 'PUBLISHED_OLDEST', label: 'Published Date (Oldest)', compact: 'Published ^' },
  { value: 'TITLE_ASC', label: 'Alphabet (A-Z)', compact: 'Title A-Z' },
  { value: 'TITLE_DESC', label: 'Alphabet (Z-A)', compact: 'Title Z-A' }
];

export default function TrashPage() {
  const navigate = useNavigate();
  const auth = useSelector((state) => state.user);
  const isAdmin = auth?.status === 'Authenticated' && auth?.user === 'Admin';
  const isAuthenticated = auth?.status === 'Authenticated';

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [info, setInfo] = React.useState('');
  const [trashedNotices, setTrashedNotices] = React.useState([]);
  const [restoringId, setRestoringId] = React.useState('');
  const [deletingId, setDeletingId] = React.useState('');
  const [searchInput, setSearchInput] = React.useState('');
  const [appliedSearch, setAppliedSearch] = React.useState('');
  const [sortKey, setSortKey] = React.useState('TRASH_LATEST');
  const [retentionDays, setRetentionDays] = React.useState(30);
  const [retentionDraft, setRetentionDraft] = React.useState('30');
  const [retentionSaving, setRetentionSaving] = React.useState(false);
  const [themeMode, setThemeMode] = React.useState(() => normalizeThemeMode(readCookieValue(THEME_COOKIE_KEY) || 'Light'));
  const [isMobileView, setIsMobileView] = React.useState(() => (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(MOBILE_MEDIA_QUERY).matches
  ));
  const [mobileSearchOpen, setMobileSearchOpen] = React.useState(false);

  const mobileSearchFormRef = React.useRef(null);
  const mobileSearchInputRef = React.useRef(null);

  const formatDate = React.useCallback((value) => {
    if (!value) return 'N/A';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return 'N/A';
    return dt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }, []);

  const loadTrash = React.useCallback(async () => {
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const data = await getTrashedNoticesApi({
        limit: 300,
        sort: sortKey,
        search: appliedSearch || undefined
      });
      setTrashedNotices(Array.isArray(data?.notices) ? data.notices : []);
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to load deleted notices.');
      setTrashedNotices([]);
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, sortKey]);

  const loadRetention = React.useCallback(async () => {
    try {
      const data = await getNoticeTrashRetentionApi();
      const parsed = Number(data?.retentionDays);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 365) {
        setRetentionDays(parsed);
        setRetentionDraft(String(parsed));
      }
    } catch (_) {
      // noop
    }
  }, []);

  const restoreNotice = React.useCallback(async (noticeId) => {
    if (!isAdmin || !noticeId) return;
    setRestoringId(noticeId);
    setError('');
    setInfo('');
    try {
      await restoreNoticeApi(noticeId);
      setTrashedNotices((prev) => prev.filter((n) => String(n?._id) !== String(noticeId)));
      setInfo('Notice restored successfully.');
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to restore notice.');
    } finally {
      setRestoringId('');
    }
  }, [isAdmin]);

  const permanentlyDeleteNotice = React.useCallback(async (noticeId, noticeTitle) => {
    if (!isAdmin || !noticeId) return;
    const title = String(noticeTitle || 'this notice').trim();
    const confirmed = window.confirm(
      `Permanently delete "${title}"?\n\nThis cannot be undone and will remove it from trash and database.`
    );
    if (!confirmed) return;

    setDeletingId(noticeId);
    setError('');
    setInfo('');
    try {
      await permanentlyDeleteNoticeApi(noticeId);
      setTrashedNotices((prev) => prev.filter((n) => String(n?._id) !== String(noticeId)));
      setInfo('Notice permanently deleted.');
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to permanently delete notice.');
    } finally {
      setDeletingId('');
    }
  }, [isAdmin]);

  const saveRetention = React.useCallback(async () => {
    if (!isAdmin) return;
    const parsed = Number(retentionDraft);
    if (!Number.isFinite(parsed)) {
      setError('Retention must be a number between 1 and 365 days.');
      return;
    }

    const nextRetention = Math.max(1, Math.min(365, Math.floor(parsed)));
    setRetentionSaving(true);
    setError('');
    setInfo('');
    try {
      const data = await updateNoticeTrashRetentionApi(nextRetention);
      const saved = Number(data?.retentionDays);
      const resolved = Number.isFinite(saved) ? saved : nextRetention;
      setRetentionDays(resolved);
      setRetentionDraft(String(resolved));
      setInfo(`Trash auto-delete updated to ${resolved} day${resolved === 1 ? '' : 's'}.`);
      await loadTrash();
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to update trash retention.');
    } finally {
      setRetentionSaving(false);
    }
  }, [isAdmin, loadTrash, retentionDraft]);

  React.useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  React.useEffect(() => {
    loadRetention();
  }, [loadRetention]);

  React.useEffect(() => {
    if (String(searchInput || '').trim() === '' && appliedSearch) {
      setAppliedSearch('');
    }
  }, [searchInput, appliedSearch]);

  React.useEffect(() => {
    let cancelled = false;
    const cookieTheme = normalizeThemeMode(readCookieValue(THEME_COOKIE_KEY) || 'Light');
    setThemeMode(cookieTheme);

    if (!isAuthenticated) return () => { cancelled = true; };

    const loadAccountTheme = async () => {
      try {
        const data = await getCalendarAppearanceApi();
        if (cancelled) return;
        setThemeMode(normalizeThemeMode(data?.themeMode || cookieTheme));
      } catch (_) {
        if (cancelled) return;
        setThemeMode(cookieTheme);
      }
    };

    loadAccountTheme();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, auth?.user]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    const updateMobileState = (event) => {
      setIsMobileView(Boolean(event?.matches));
    };

    setIsMobileView(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateMobileState);
      return () => mediaQuery.removeEventListener('change', updateMobileState);
    }

    mediaQuery.addListener(updateMobileState);
    return () => mediaQuery.removeListener(updateMobileState);
  }, []);

  React.useEffect(() => {
    if (!isMobileView) {
      setMobileSearchOpen(false);
    }
  }, [isMobileView]);

  React.useEffect(() => {
    if (!isMobileView || !mobileSearchOpen) return undefined;

    const handlePointerDown = (event) => {
      const searchNode = mobileSearchFormRef.current;
      if (!searchNode) return;
      if (searchNode.contains(event.target)) return;
      setMobileSearchOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isMobileView, mobileSearchOpen]);

  React.useEffect(() => {
    if (!mobileSearchOpen) return;
    const frame = window.requestAnimationFrame(() => {
      mobileSearchInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mobileSearchOpen]);

  const resolvedTheme = React.useMemo(() => {
    if (themeMode === 'Dark') return 'dark';
    if (
      themeMode === 'Auto' &&
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }
    return 'light';
  }, [themeMode]);

  const applySearch = React.useCallback(() => {
    setAppliedSearch(String(searchInput || '').trim());
  }, [searchInput]);

  const selectedSortLabel = React.useMemo(() => {
    const match = TRASH_SORT_OPTIONS.find((option) => option.value === sortKey);
    return match?.compact || 'Sort v';
  }, [sortKey]);

  const renderSortControl = React.useCallback((className = '') => (
    <div className={`trash-sort-wrap ${className}`.trim()}>
      <span className="trash-sort-current" aria-hidden="true">{selectedSortLabel}</span>
      <select
        id="trash-sort"
        className="trash-sort-select"
        value={sortKey}
        onChange={(e) => setSortKey(String(e.target.value || 'TRASH_LATEST'))}
        aria-label="Sort trash"
      >
        {TRASH_SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <span className="trash-sort-chevron" aria-hidden="true"><Svgs.ChevronDown /></span>
    </div>
  ), [selectedSortLabel, sortKey]);

  return (
    <div className={`trash-page theme-${resolvedTheme}`}>
      <header className="trash-header">
        {isMobileView ? (
          <div className="trash-header-mobile-row">
            <button className="icon-btn trash-back-btn" onClick={() => navigate(-1)}><Svgs.Back /></button>
            <h2>Trash</h2>
            {mobileSearchOpen ? (
              <form
                ref={mobileSearchFormRef}
                className="trash-search-form trash-search-form-mobile-open"
                onSubmit={(e) => {
                  e.preventDefault();
                  applySearch();
                }}
              >
                <input
                  ref={mobileSearchInputRef}
                  type="text"
                  className="trash-search-input"
                  placeholder="Search deleted notices"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
                <button type="submit" className="trash-search-btn" aria-label="Search trash">
                  <Svgs.Search />
                </button>
              </form>
            ) : (
              <div className="trash-mobile-controls">
                <button
                  type="button"
                  className="trash-mobile-search-toggle"
                  aria-label="Open trash search"
                  onClick={() => setMobileSearchOpen(true)}
                >
                  <Svgs.Search />
                </button>
                {renderSortControl('trash-sort-wrap-mobile')}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="trash-header-left">
              <button className="icon-btn" onClick={() => navigate(-1)}><Svgs.Back /></button>
              <h2>Trash</h2>
            </div>
            <div className="trash-header-right">
              <form
                className="trash-search-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  applySearch();
                }}
              >
                <input
                  type="text"
                  className="trash-search-input"
                  placeholder="Search deleted notices"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
                <button type="submit" className="trash-search-btn" aria-label="Search trash">
                  <Svgs.Search />
                </button>
              </form>
              {renderSortControl()}
            </div>
          </>
        )}
      </header>

      {isAdmin && (
        <section className="trash-retention-bar" aria-label="Trash retention">
          <form
            className="trash-retention-form"
            onSubmit={(e) => {
              e.preventDefault();
              saveRetention();
            }}
          >
            <span className="trash-retention-label">Auto-delete after</span>
            <input
              type="number"
              min="1"
              max="365"
              step="1"
              className="trash-retention-input"
              value={retentionDraft}
              onChange={(e) => setRetentionDraft(e.target.value)}
              aria-label="Retention in days"
            />
            <span className="trash-retention-suffix">days</span>
            <button type="submit" className="trash-retention-save" disabled={retentionSaving}>
              {retentionSaving ? 'Saving...' : 'Save'}
            </button>
            <span className="trash-retention-meta">
              Current: {retentionDays} day{retentionDays === 1 ? '' : 's'} (max 365)
            </span>
          </form>
        </section>
      )}

      <div className="trash-layout">
        <main className="trash-main">
          {loading && <div className="empty-trash-message">Loading trash...</div>}
          {!loading && error && <div className="empty-trash-message trash-error">{error}</div>}
          {!loading && !error && info && <div className="empty-trash-message trash-info">{info}</div>}
          {!isAdmin && !loading && !error && (
            <div className="empty-trash-message trash-readonly-note">
              Read-only mode: only admin can restore or permanently delete notices.
            </div>
          )}
          {!loading && !error && trashedNotices.length === 0 && (
            <div className="empty-trash-message">There are no deleted notices.</div>
          )}
          {!loading && !error && trashedNotices.length > 0 && (
            <div className="trash-list">
              {trashedNotices.map((notice) => (
                <article key={notice._id} className="trash-item">
                  <div className="trash-item-head">
                    <h3>{notice.title || notice.subject || 'Notice'}</h3>
                    <div className="trash-item-actions-inline">
                      {isAdmin && (
                        <>
                          <button
                            type="button"
                            className="trash-action-icon trash-restore-btn"
                            onClick={() => restoreNotice(notice._id)}
                            disabled={restoringId === notice._id || deletingId === notice._id}
                            aria-label="Restore notice"
                            title={restoringId === notice._id ? 'Restoring...' : 'Restore'}
                          >
                            <Svgs.Restore />
                          </button>
                          <button
                            type="button"
                            className="trash-action-icon trash-delete-btn"
                            onClick={() => permanentlyDeleteNotice(notice._id, notice.title || notice.subject || 'Notice')}
                            disabled={deletingId === notice._id || restoringId === notice._id}
                            aria-label="Delete permanently"
                            title={deletingId === notice._id ? 'Deleting...' : 'Delete permanently'}
                          >
                            <Svgs.Delete />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <p>{notice.summary || notice.content || notice.body || 'No preview available.'}</p>
                  <div className="trash-item-meta">
                    <div className="trash-meta-dates">
                      <span className="trash-date-published">Published: {formatDate(notice.createdAt)}</span>
                      <span className="trash-date-deleted">Deleted: {formatDate(notice.deletedAt)}</span>
                    </div>
                    <span className={`trash-badge ${notice.kind === 'HOLIDAY' ? 'holiday' : 'general'}`}>
                      {notice.kind === 'HOLIDAY' ? 'Alert/Closure' : 'Notice'}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
