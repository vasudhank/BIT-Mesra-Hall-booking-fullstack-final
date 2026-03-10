import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { getTrashedNoticesApi, permanentlyDeleteNoticeApi, restoreNoticeApi } from '../api/noticesApi';
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
  Search: () => <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27a6 6 0 10-.71.71l.27.28v.79L20 21.5 21.5 20l-6-6zm-5.5 0A4.5 4.5 0 1110 5a4.5 4.5 0 010 9z"></path></svg>
};

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
  const [themeMode, setThemeMode] = React.useState(() => normalizeThemeMode(readCookieValue(THEME_COOKIE_KEY) || 'Light'));

  const formatDate = React.useCallback((value) => {
    if (!value) return 'N/A';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return 'N/A';
    return dt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }, []);

  const loadTrash = React.useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      setError('');
      setTrashedNotices([]);
      return;
    }

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
  }, [isAdmin, appliedSearch, sortKey]);

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

  React.useEffect(() => {
    loadTrash();
  }, [loadTrash]);

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

  return (
    <div className={`trash-page theme-${resolvedTheme}`}>
      <header className="trash-header">
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

          <div className="trash-sort-wrap">
            <label htmlFor="trash-sort" className="trash-sort-label">Sort</label>
            <select
              id="trash-sort"
              className="trash-sort-select"
              value={sortKey}
              onChange={(e) => setSortKey(String(e.target.value || 'TRASH_LATEST'))}
            >
              <option value="TRASH_LATEST">Deleted Date (Newest)</option>
              <option value="TRASH_OLDEST">Deleted Date (Oldest)</option>
              <option value="PUBLISHED_LATEST">Published Date (Newest)</option>
              <option value="PUBLISHED_OLDEST">Published Date (Oldest)</option>
              <option value="TITLE_ASC">Alphabet (A-Z)</option>
              <option value="TITLE_DESC">Alphabet (Z-A)</option>
            </select>
          </div>
        </div>
      </header>

      <div className="trash-layout">

        <main className="trash-main">
          {!isAdmin && <div className="empty-trash-message">Only admin can view deleted notices.</div>}
          {isAdmin && loading && <div className="empty-trash-message">Loading trash...</div>}
          {isAdmin && !loading && error && <div className="empty-trash-message trash-error">{error}</div>}
          {isAdmin && !loading && !error && info && <div className="empty-trash-message trash-info">{info}</div>}
          {isAdmin && !loading && !error && trashedNotices.length === 0 && (
            <div className="empty-trash-message">There are no deleted notices.</div>
          )}
          {isAdmin && !loading && !error && trashedNotices.length > 0 && (
            <div className="trash-list">
              {trashedNotices.map((notice) => (
                <article key={notice._id} className="trash-item">
                  <div className="trash-item-head">
                    <h3>{notice.title || notice.subject || 'Notice'}</h3>
                    <div className="trash-item-head-right">
                      {isAdmin && (
                        <div className="trash-item-actions-inline">
                          <button
                            type="button"
                            className="trash-restore-btn"
                            onClick={() => restoreNotice(notice._id)}
                            disabled={restoringId === notice._id || deletingId === notice._id}
                          >
                            {restoringId === notice._id ? 'Restoring...' : 'Restore'}
                          </button>
                          <button
                            type="button"
                            className="trash-delete-btn"
                            onClick={() => permanentlyDeleteNotice(notice._id, notice.title || notice.subject || 'Notice')}
                            disabled={deletingId === notice._id || restoringId === notice._id}
                          >
                            {deletingId === notice._id ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      )}
                      <span className={`trash-badge ${notice.kind === 'HOLIDAY' ? 'holiday' : 'general'}`}>
                        {notice.kind === 'HOLIDAY' ? 'Alert/Closure' : 'Notice'}
                      </span>
                    </div>
                  </div>
                  <p>{notice.summary || notice.content || notice.body || 'No preview available.'}</p>
                  <div className="trash-item-meta">
                    <span>Deleted: {formatDate(notice.deletedAt)}</span>
                    <span>Published: {formatDate(notice.createdAt)}</span>
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
