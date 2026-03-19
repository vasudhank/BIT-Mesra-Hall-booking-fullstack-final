import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { createNoticeApi, deleteNoticeApi, getNoticesApi, updateNoticeApi } from '../api/noticesApi';
import api from '../api/axiosInstance';
import HallMultiSelectDropdown from '../components/Notices/HallMultiSelectDropdown';
import QuickPageMenu from '../components/Navigation/QuickPageMenu';
import { fuzzyFilterAndRank } from '../utils/fuzzySearch';
import './NoticesPage.css';

const READING_STORAGE_KEY = 'bit_notice_reading_preferences_v1';

const defaultReading = {
  theme: 'classic',
  textSize: 17, // Changed to numeric scale
  font: 'outfit'
};

const loadReadingPrefs = () => {
  try {
    const raw = localStorage.getItem(READING_STORAGE_KEY);
    if (!raw) return defaultReading;
    const parsed = JSON.parse(raw);

    // Safely migrate old strings ('small', 'medium', 'large') to numbers
    let size = defaultReading.textSize;
    if (typeof parsed.textSize === 'number') {
      size = Math.min(Math.max(12, parsed.textSize), 40);
    } else if (parsed.textSize === 'small') size = 15;
    else if (parsed.textSize === 'medium') size = 17;
    else if (parsed.textSize === 'large') size = 20;

    return {
      theme: ['classic', 'paper', 'night'].includes(parsed?.theme) ? parsed.theme : defaultReading.theme,
      textSize: size,
      font: parsed?.font || defaultReading.font
    };
  } catch (_) {
    return defaultReading;
  }
};

const saveReadingPrefs = (prefs) => {
  localStorage.setItem(READING_STORAGE_KEY, JSON.stringify(prefs));
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

const filterNoticesByQuery = (sourceNotices, query) =>
  fuzzyFilterAndRank(
    sourceNotices,
    query,
    (notice) => [
      notice?.title,
      notice?.subject,
      notice?.content,
      notice?.body,
      notice?.summary,
      notice?.holidayName,
      notice?.kind,
      Array.isArray(notice?.rooms) ? notice.rooms.join(' ') : '',
      notice?.closureAllHalls ? 'campus wide closure all halls' : ''
    ],
    { threshold: 0.45 }
  );

// Premium SVG Icons
const Icons = {
  Search: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>,
  Sun: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  Moon: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  Book: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  Pen: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
  Home: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  ArrowRight: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>,
  Maximize: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>,
  Minimize: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>,
  Edit: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
  Trash: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>,
  Close: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>,
  Alert: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
};

export default function NoticesPage({ mode = 'public' }) {
  const auth = useSelector((s) => s.user);
  const isAdmin = mode === 'admin' || (auth.status === 'Authenticated' && auth.user === 'Admin');
  const allowAdminComposer = isAdmin;

  const [reading, setReading] = useState(loadReadingPrefs);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notices, setNotices] = useState([]);
  const [halls, setHalls] = useState([]);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [sort, setSort] = useState('LATEST');
  const [kind, setKind] = useState('ALL');

  // Composer States
  const [isComposerMaximized, setIsComposerMaximized] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [manualKind, setManualKind] = useState('AUTO');
  const [holidayName, setHolidayName] = useState('');
  const [startDateTime, setStartDateTime] = useState('');
  const [endDateTime, setEndDateTime] = useState('');
  const [selectedComposeHalls, setSelectedComposeHalls] = useState([]);
  const [closureAllHalls, setClosureAllHalls] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postMessage, setPostMessage] = useState('');
  const [editNoticeId, setEditNoticeId] = useState('');
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
  const [deleteDialog, setDeleteDialog] = useState({ open: false, notice: null });
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState({ type: '', text: '' });
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 960px)').matches : false
  );
  const [isMobileHeaderCollapsed, setIsMobileHeaderCollapsed] = useState(false);
  const [isMobileComposeOpen, setIsMobileComposeOpen] = useState(false);
  const [mobileHeaderStripHeight, setMobileHeaderStripHeight] = useState(0);
  const mobileSearchInputHeight = 40;
  const mobileFontControlWidth = 124;
  const mobileHeaderStripRef = useRef(null);

  useEffect(() => {
    saveReadingPrefs(reading);
  }, [reading]);

  const fetchNotices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getNoticesApi({
        search: '',
        sort,
        kind: kind === 'ALL' ? '' : kind,
        limit: 300
      });
      const incoming = Array.isArray(data?.notices) ? data.notices : [];
      setNotices(filterNoticesByQuery(incoming, appliedSearch));
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load notices');
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, sort, kind]);

  const fetchHalls = useCallback(async () => {
    try {
      const response = await api.get('/hall/view_halls', { withCredentials: true });
      setHalls(Array.isArray(response?.data?.halls) ? response.data.halls : []);
    } catch (_) {
      setHalls([]);
    }
  }, []);

  useEffect(() => {
    fetchNotices();
  }, [fetchNotices]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchHalls();
  }, [isAdmin, fetchHalls]);

  useEffect(() => {
    const timer = setInterval(() => {
      fetchNotices();
    }, 30000);
    return () => clearInterval(timer);
  }, [fetchNotices]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isComposerMaximized) {
        setIsComposerMaximized(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isComposerMaximized]);

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
      setIsMobileHeaderCollapsed(false);
      setIsMobileComposeOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const updateStripHeight = () => {
      if (!isMobile) {
        setMobileHeaderStripHeight(0);
        return;
      }
      const rect = mobileHeaderStripRef.current?.getBoundingClientRect?.();
      setMobileHeaderStripHeight(Math.max(0, Math.round(rect?.height || 0)));
    };

    updateStripHeight();
    window.addEventListener('resize', updateStripHeight);

    let observer = null;
    if (typeof ResizeObserver !== 'undefined' && mobileHeaderStripRef.current) {
      observer = new ResizeObserver(updateStripHeight);
      observer.observe(mobileHeaderStripRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateStripHeight);
      if (observer) observer.disconnect();
    };
  }, [isMobile, isMobileHeaderCollapsed, reading.theme, reading.textSize, reading.font]);

  const onSearchSubmit = (e) => {
    e?.preventDefault?.();
    setAppliedSearch(search.trim());
  };

  const resetComposer = () => {
    setTitle('');
    setContent('');
    setManualKind('AUTO');
    setHolidayName('');
    setStartDateTime('');
    setEndDateTime('');
    setSelectedComposeHalls([]);
    setClosureAllHalls(false);
    setIsComposerMaximized(false);
  };

  const submitNotice = async (e) => {
    e.preventDefault();
    if (!title.trim() && !content.trim()) {
      setPostMessage('Notice title or content is required.');
      return;
    }

    setPosting(true);
    setPostMessage('');
    try {
      await createNoticeApi({
        title: title.trim(),
        content: content.trim(),
        kind: manualKind === 'AUTO' ? undefined : manualKind,
        holidayName: holidayName.trim(),
        startDateTime: startDateTime || undefined,
        endDateTime: endDateTime || undefined,
        rooms: closureAllHalls ? [] : selectedComposeHalls,
        closureAllHalls
      });
      setPostMessage('Notice posted successfully.');
      setTimeout(resetComposer, 1500);
      fetchNotices();
    } catch (err) {
      setPostMessage(err?.response?.data?.error || 'Unable to post notice.');
    } finally {
      setPosting(false);
    }
  };

  const openEditModal = (notice) => {
    if (!isAdmin || !notice?._id) return;
    setActionMessage({ type: '', text: '' });
    setEditNoticeId(String(notice._id));
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
    setEditNoticeId('');
  };

  const handleEditFormChange = (key, value) => {
    setEditForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'closureAllHalls' && value) {
        next.rooms = [];
      }
      return next;
    });
  };

  const saveEditedNotice = async (e) => {
    e?.preventDefault?.();
    if (!isAdmin || !editNoticeId) return;

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
      await updateNoticeApi(editNoticeId, {
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
      setEditOpen(false);
      setEditNoticeId('');
      setActionMessage({ type: 'success', text: 'Notice updated successfully.' });
      fetchNotices();
    } catch (err) {
      setEditError(err?.response?.data?.error || 'Unable to update notice.');
    } finally {
      setEditSaving(false);
    }
  };

  const openDeleteDialog = (notice) => {
    if (!isAdmin || !notice?._id) return;
    setActionMessage({ type: '', text: '' });
    setDeleteDialog({ open: true, notice });
  };

  const closeDeleteDialog = () => {
    if (deleteSaving) return;
    setDeleteDialog({ open: false, notice: null });
  };

  const confirmDeleteNotice = async () => {
    if (!isAdmin || !deleteDialog.notice?._id) return;
    setDeleteSaving(true);
    setActionMessage({ type: '', text: '' });
    try {
      await deleteNoticeApi(deleteDialog.notice._id);
      setDeleteDialog({ open: false, notice: null });
      setActionMessage({ type: 'success', text: 'Notice moved to trash.' });
      fetchNotices();
    } catch (err) {
      setActionMessage({ type: 'error', text: err?.response?.data?.error || 'Unable to delete notice.' });
    } finally {
      setDeleteSaving(false);
    }
  };

  const updateReading = (key, value) => setReading(p => ({ ...p, [key]: value }));

  // Dynamic CSS custom property mapping
  const themeClasses = `notices-theme-root reader-theme-${reading.theme} reader-font-${reading.font}`;
  const showMobileNoticesControls = isMobile;
  const noticesMenuPanelClass = `notices-hero-menu-panel notices-menu-theme-${reading.theme}`;
  const mobileHeaderExtraMenuItems = [
    { key: 'mobile-home', label: 'Home', path: '/' },
    ...(allowAdminComposer ? [{ key: 'mobile-compose', label: 'Compose', onClick: () => setIsMobileComposeOpen(true) }] : []),
    { key: 'mobile-trash', label: 'Trash', path: '/trash' }
  ];

  const renderComposerCard = ({ mobilePopup = false } = {}) => (
    <section
      className={`notice-composer-card ${isComposerMaximized && !mobilePopup ? 'maximized' : ''} ${mobilePopup ? 'mobile-compose-popup-card' : ''}`}
      onClick={mobilePopup ? (event) => event.stopPropagation() : undefined}
    >
      <div className="composer-card-header">
        <h2><Icons.Pen /> Compose Update</h2>
        {!mobilePopup ? (
          <button type="button" className="btn-icon" onClick={() => setIsComposerMaximized(!isComposerMaximized)} title={isComposerMaximized ? "Minimize" : "Maximize"}>
            {isComposerMaximized ? <Icons.Minimize /> : <Icons.Maximize />}
          </button>
        ) : (
          <button type="button" className="btn-icon" onClick={() => setIsMobileComposeOpen(false)} title="Close compose popup">
            <Icons.Close />
          </button>
        )}
      </div>

      <form onSubmit={submitNotice} className={`notice-composer-grid ${mobilePopup ? 'mobile-compose-grid' : ''}`}>
        <div className="input-group">
          <label>Title</label>
          <input className="premium-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter brief subject" maxLength={240} />
        </div>
        
        <div className="input-group" style={{ flex: !mobilePopup && isComposerMaximized ? '1' : 'none' }}>
          <label>Full Content</label>
          <textarea className="premium-input" style={{ height: !mobilePopup && isComposerMaximized ? '100%' : '120px' }} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Type the detailed announcement..." />
        </div>
        
        <div className={!mobilePopup && isComposerMaximized ? "composer-row-2" : ""}>
          <div className="input-group">
            <label>Classification</label>
            <select className="premium-input" value={manualKind} onChange={(e) => setManualKind(e.target.value)}>
              <option value="AUTO">Auto Detect Context</option>
              <option value="GENERAL">General Notice</option>
              <option value="HOLIDAY">Holiday / Closure</option>
            </select>
          </div>

          <div className="input-group">
            <label>Holiday Event Name (Optional)</label>
            <input className="premium-input" value={holidayName} onChange={(e) => setHolidayName(e.target.value)} placeholder="e.g., Diwali Break" maxLength={120} />
          </div>
        </div>

        <div className={!mobilePopup && isComposerMaximized ? "composer-row-2" : ""}>
          <div className="input-group">
            <label>Start Timeline</label>
            <input className="premium-input" type="datetime-local" value={startDateTime} onChange={(e) => setStartDateTime(e.target.value)} />
          </div>

          <div className="input-group">
            <label>End Timeline</label>
            <input className="premium-input" type="datetime-local" value={endDateTime} onChange={(e) => setEndDateTime(e.target.value)} />
          </div>
        </div>

        <div className="input-group">
          <label>Affected Rooms (Comma Separated)</label>
          <HallMultiSelectDropdown
            halls={halls}
            selectedHalls={selectedComposeHalls}
            onChange={setSelectedComposeHalls}
            disabled={closureAllHalls}
            startDateTime={startDateTime}
            endDateTime={endDateTime}
            fieldHeight={35}
            fieldPlaceholderOffsetY={5}
            fieldInputOffsetY={2}
            hallRowNameOffsetY={-1}
          />
        </div>

        <label className="notice-checkbox-label">
          <input
            type="checkbox"
            checked={closureAllHalls}
            onChange={(e) => {
              const checked = e.target.checked;
              setClosureAllHalls(checked);
              if (checked) setSelectedComposeHalls([]);
            }}
          />
          Campus-wide closure applies
        </label>

        <button type="submit" className="btn-primary" disabled={posting}>
          {posting ? 'Publishing securely...' : 'Publish to Board'}
        </button>
        {postMessage && <p className="notice-post-message" style={{textAlign:'center', fontSize:'0.9rem', color:'var(--notice-accent)'}}>{postMessage}</p>}
      </form>
    </section>
  );

  return (
    <div
      className={themeClasses}
      style={{
        '--font-base': `${reading.textSize}px`,
        '--notices-mobile-strip-height': `${mobileHeaderStripHeight}px`
      }}
    >
      {!showMobileNoticesControls && !allowAdminComposer && (
        <div className="notices-fixed-top-actions">
          <Link className="notices-hero-home" to="/"><Icons.Home /> Home</Link>
          <Link className="notices-hero-trash-btn" to="/trash" title="Open Trash" aria-label="Open Trash">
            <Icons.Trash />
            <span>Trash</span>
          </Link>
          <QuickPageMenu
            buttonLabel="Menu"
            buttonClassName="notices-hero-menu-btn"
            panelClassName={noticesMenuPanelClass}
            itemClassName="notices-hero-menu-item"
            hideThemeToggle
            align="right"
          />
        </div>
      )}

      <div className={allowAdminComposer ? "notices-layout-grid" : "notices-layout-center"}>
        
        {/* LEFT SIDEBAR */}
        {allowAdminComposer && !isMobile && (
          <aside className={`notices-sidebar ${isComposerMaximized ? 'sidebar-maximized' : ''}`}>
            <header className="notices-hero notices-hero-sidebar">
              <h1>Notice Board</h1>
              <p>Manage and broadcast institutional updates instantly.</p>
            </header>

            <div className="notices-hero-quick-actions notices-sidebar-quick-actions">
              <Link className="notices-hero-home" to="/"><Icons.Home /> Home</Link>
              <Link className="notices-hero-trash-btn" to="/trash" title="Open Trash" aria-label="Open Trash">
                <Icons.Trash />
                <span>Trash</span>
              </Link>
              <QuickPageMenu
                buttonLabel="Menu"
                buttonClassName="notices-hero-menu-btn"
                panelClassName={noticesMenuPanelClass}
                itemClassName="notices-hero-menu-item"
                hideThemeToggle
                align="left"
              />
            </div>

            {isComposerMaximized && (
              <div className="composer-backdrop" onClick={() => setIsComposerMaximized(false)} />
            )}

            {renderComposerCard()}
          </aside>
        )}

        {/* RIGHT SIDE */}
        <main className="notices-main">
          
          {!allowAdminComposer && (
            <header className="notices-hero" style={{marginBottom: '24px'}}>
              <h1>Notice Board</h1>
              <p>Stay informed with the latest institutional announcements.</p>
            </header>
          )}

          <section
            ref={mobileHeaderStripRef}
            className={`notices-sticky-strip ${showMobileNoticesControls ? 'mobile-compact' : ''} ${showMobileNoticesControls && isMobileHeaderCollapsed ? 'strip-collapsed-mobile' : ''}`}
            style={
              showMobileNoticesControls
                ? {
                    '--notice-mobile-search-height': `${mobileSearchInputHeight}px`,
                    '--notice-mobile-font-control-width': `${mobileFontControlWidth}px`
                  }
                : undefined
            }
          >
            {!(showMobileNoticesControls && isMobileHeaderCollapsed) && (
              <>
                <form onSubmit={onSearchSubmit} className={`strip-search-row ${showMobileNoticesControls ? 'mobile-search-row' : ''}`}>
                  <div className="search-wrapper">
                    <button type="submit" className="search-inline-btn" aria-label="Search notices">
                      <Icons.Search />
                    </button>
                    <input
                      className="premium-input"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search keywords, events, or rooms..."
                    />
                  </div>
                  {showMobileNoticesControls && (
                    <QuickPageMenu
                      iconOnly
                      buttonClassName="notices-mobile-menu-btn"
                      panelClassName={noticesMenuPanelClass}
                      itemClassName="notices-hero-menu-item"
                      hideThemeToggle
                      align="right"
                      extraItems={mobileHeaderExtraMenuItems}
                    />
                  )}
                  {!showMobileNoticesControls && (
                    <button type="submit" className="btn-primary" style={{padding: '12px 20px'}}>Search</button>
                  )}
                  {!showMobileNoticesControls && (
                    <>
                      <select className="premium-input notice-strip-sort-select" value={sort} onChange={(e) => setSort(e.target.value)}>
                        <option value="LATEST">Latest First</option>
                        <option value="OLDEST">Oldest First</option>
                        <option value="HOLIDAY_FIRST">Holidays First</option>
                      </select>
                      <select className="premium-input notice-strip-sort-select" value={kind} onChange={(e) => setKind(e.target.value)}>
                        <option value="ALL">All Categories</option>
                        <option value="GENERAL">General</option>
                        <option value="HOLIDAY">Closures</option>
                      </select>
                    </>
                  )}
                </form>

                {showMobileNoticesControls && (
                  <div className="strip-mobile-sort-row">
                    <select className="premium-input notice-strip-sort-select" value={kind} onChange={(e) => setKind(e.target.value)}>
                      <option value="ALL">All Categories</option>
                      <option value="GENERAL">General</option>
                      <option value="HOLIDAY">Closures</option>
                    </select>
                    <select className="premium-input notice-strip-sort-select" value={sort} onChange={(e) => setSort(e.target.value)}>
                      <option value="LATEST">Latest First</option>
                      <option value="OLDEST">Oldest First</option>
                      <option value="HOLIDAY_FIRST">Holidays First</option>
                    </select>
                  </div>
                )}

                {!showMobileNoticesControls ? (
                  <div className="strip-controls-row">
                    <div className="readability-group theme-readability-group">
                      <button type="button" onClick={() => updateReading('theme', 'classic')} className={`readability-btn ${reading.theme === 'classic' ? 'active' : ''}`}><Icons.Sun/><span className="readability-text">Light</span></button>
                      <button type="button" onClick={() => updateReading('theme', 'paper')} className={`readability-btn ${reading.theme === 'paper' ? 'active' : ''}`}><Icons.Book/><span className="readability-text">Sepia</span></button>
                      <button type="button" onClick={() => updateReading('theme', 'night')} className={`readability-btn ${reading.theme === 'night' ? 'active' : ''}`}><Icons.Moon/><span className="readability-text">Dark</span></button>
                    </div>
                    <div className="readability-group">
                      <button type="button" onClick={() => updateReading('textSize', Math.max(12, reading.textSize - 1))} className="readability-btn">A-</button>
                      <span className="readability-val">{reading.textSize}px</span>
                      <button type="button" onClick={() => updateReading('textSize', Math.min(40, reading.textSize + 1))} className="readability-btn">A+</button>
                    </div>
                    <div className="readability-group">
                      <select 
                        className="readability-select"
                        value={reading.font}
                        onChange={(e) => updateReading('font', e.target.value)}
                      >
                        <option value="outfit">Outfit (Sans)</option>
                        <option value="roboto">Roboto (Sans)</option>
                        <option value="nunito">Nunito (Sans)</option>
                        <option value="space">Space Grotesk (Sans)</option>
                        <option value="oswald">Oswald (Sans)</option>
                        <option value="lora">Lora (Serif)</option>
                        <option value="merriweather">Merriweather (Serif)</option>
                        <option value="playfair">Playfair Display (Serif)</option>
                        <option value="mono">Fira Code (Mono)</option>
                        <option value="courgette">Courgette (Cursive)</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="strip-controls-row mobile-controls-row-one">
                      <div className="readability-group theme-readability-group mobile-theme-group">
                        <button type="button" onClick={() => updateReading('theme', 'classic')} className={`readability-btn ${reading.theme === 'classic' ? 'active' : ''}`}><Icons.Sun/><span className="readability-text">Light</span></button>
                        <button type="button" onClick={() => updateReading('theme', 'paper')} className={`readability-btn ${reading.theme === 'paper' ? 'active' : ''}`}><Icons.Book/><span className="readability-text">Sepia</span></button>
                        <button type="button" onClick={() => updateReading('theme', 'night')} className={`readability-btn ${reading.theme === 'night' ? 'active' : ''}`}><Icons.Moon/><span className="readability-text">Dark</span></button>
                      </div>
                      <div className="readability-group mobile-size-group">
                        <button type="button" onClick={() => updateReading('textSize', Math.max(12, reading.textSize - 1))} className="readability-btn">A-</button>
                        <span className="readability-val">{reading.textSize}px</span>
                        <button type="button" onClick={() => updateReading('textSize', Math.min(40, reading.textSize + 1))} className="readability-btn">A+</button>
                      </div>
                      <div className="readability-group mobile-font-group">
                        <select 
                          className="readability-select"
                          value={reading.font}
                          onChange={(e) => updateReading('font', e.target.value)}
                        >
                          <option value="outfit">Outfit</option>
                          <option value="roboto">Roboto</option>
                          <option value="nunito">Nunito</option>
                          <option value="space">Space Grotesk</option>
                          <option value="oswald">Oswald</option>
                          <option value="lora">Lora</option>
                          <option value="merriweather">Merriweather</option>
                          <option value="playfair">Playfair</option>
                          <option value="mono">Fira Code</option>
                          <option value="courgette">Courgette</option>
                        </select>
                      </div>
                    </div>
                  </>
                )}

                {showMobileNoticesControls && (
                  <button
                    type="button"
                    className="notices-strip-toggle notices-strip-toggle--bottom"
                    onClick={() => setIsMobileHeaderCollapsed(true)}
                    aria-label="Collapse notices header"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="18 15 12 9 6 15"></polyline>
                    </svg>
                  </button>
                )}
              </>
            )}

            {showMobileNoticesControls && isMobileHeaderCollapsed && (
              <button
                type="button"
                className="notices-strip-toggle notices-strip-toggle--floating"
                onClick={() => setIsMobileHeaderCollapsed(false)}
                aria-label="Expand notices header"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
            )}
          </section>

          {/* Scrollable Notices List */}
          <section className="notices-list">
            {actionMessage.text && (
              <div className={`notice-inline-message ${actionMessage.type === 'error' ? 'error' : ''}`}>
                {actionMessage.text}
              </div>
            )}
            {loading && <div className="notice-empty">Syncing latest notices...</div>}
            {!loading && error && <div className="notice-empty notice-error">{error}</div>}
            {!loading && !error && notices.length === 0 && (
              <div className="notice-empty">No updates found for the selected filters.</div>
            )}

            {!loading && !error && notices.map((notice) => (
              <article key={notice._id} className="notice-card">
                <div className="notice-card-head">
                  <h3>{notice.title || notice.subject}</h3>
                  <div className="notice-card-head-right">
                    {isAdmin && (
                      <div className="notice-admin-icon-group" role="group" aria-label="Notice actions">
                        <button
                          type="button"
                          className="notice-admin-icon-btn"
                          onClick={() => openEditModal(notice)}
                          title="Edit notice"
                          aria-label="Edit notice"
                        >
                          <Icons.Edit />
                        </button>
                        <button
                          type="button"
                          className="notice-admin-icon-btn danger"
                          onClick={() => openDeleteDialog(notice)}
                          title="Delete notice"
                          aria-label="Delete notice"
                        >
                          <Icons.Trash />
                        </button>
                      </div>
                    )}
                    <span className={`notice-badge ${notice.kind === 'HOLIDAY' ? 'holiday' : 'general'}`}>
                      {notice.kind === 'HOLIDAY' ? 'Closure' : 'Notice'}
                    </span>
                  </div>
                </div>
                <p className="notice-summary">{notice.summary || 'Click below to read the full details of this announcement.'}</p>
                <div className="notice-meta">
                  <span>Published: {formatDate(notice.createdAt)}</span>
                  {notice.startDateTime && <span>Starts: {formatDate(notice.startDateTime)}</span>}
                  {notice.endDateTime && <span>Ends: {formatDate(notice.endDateTime)}</span>}
                  {Array.isArray(notice.rooms) && notice.rooms.length > 0 && (
                    <span>Locations: {notice.rooms.join(', ')}</span>
                  )}
                  {notice.closureAllHalls && <span>Campus-wide Closure</span>}
                </div>
                <div className="notice-actions">
                  <Link to={`/notices/${notice._id}`} className="read-more-link">
                    Read Full Article <Icons.ArrowRight />
                  </Link>
                </div>
              </article>
            ))}
          </section>
        </main>
      </div>

      {showMobileNoticesControls && allowAdminComposer && isMobileComposeOpen && (
        <div className="notice-admin-modal-backdrop notice-mobile-compose-backdrop" onClick={() => setIsMobileComposeOpen(false)}>
          {renderComposerCard({ mobilePopup: true })}
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
                  onChange={(e) => handleEditFormChange('title', e.target.value)}
                  placeholder="Notice title"
                  maxLength={240}
                />
              </label>

              <label className="input-group">
                <span>Description</span>
                <textarea
                  className="premium-input"
                  value={editForm.description}
                  onChange={(e) => handleEditFormChange('description', e.target.value)}
                  placeholder="Detailed notice content"
                />
              </label>

              <div className="notice-admin-modal-grid">
                <label className="input-group">
                  <span>Classification</span>
                  <select
                    className="premium-input"
                    value={editForm.kind}
                    onChange={(e) => handleEditFormChange('kind', e.target.value)}
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
                    onChange={(e) => handleEditFormChange('holidayName', e.target.value)}
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
                    onChange={(e) => handleEditFormChange('startDateTime', e.target.value)}
                  />
                </label>

                <label className="input-group">
                  <span>End Timeline</span>
                  <input
                    className="premium-input"
                    type="datetime-local"
                    value={editForm.endDateTime}
                    onChange={(e) => handleEditFormChange('endDateTime', e.target.value)}
                  />
                </label>
              </div>

              <label className="input-group">
                <span>Affected Halls (Comma Separated)</span>
                <HallMultiSelectDropdown
                  halls={halls}
                  selectedHalls={editForm.rooms}
                  onChange={(next) => handleEditFormChange('rooms', next)}
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
                  onChange={(e) => handleEditFormChange('closureAllHalls', e.target.checked)}
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

      {deleteDialog.open && (
        <div className="notice-admin-modal-backdrop" onClick={closeDeleteDialog}>
          <section className="notice-delete-confirm-card" onClick={(e) => e.stopPropagation()}>
            <div className="notice-delete-confirm-head">
              <div className="notice-delete-confirm-icon">
                <Icons.Alert />
              </div>
              <div className="notice-delete-confirm-copy">
                <h4>Delete this notice?</h4>
                <p className="notice-delete-confirm-title">
                  {deleteDialog.notice?.title || deleteDialog.notice?.subject || 'Selected notice'}
                </p>
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



