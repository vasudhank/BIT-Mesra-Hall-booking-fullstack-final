import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { createNoticeApi, getNoticesApi } from '../api/noticesApi';
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

const splitRooms = (value) =>
  String(value || '')
    .split(/[,\n;|]/)
    .map((x) => x.trim())
    .filter(Boolean);

const formatDate = (value) => {
  if (!value) return 'N/A';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return 'N/A';
  return dt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

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
  Minimize: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
};

export default function NoticesPage({ mode = 'public' }) {
  const auth = useSelector((s) => s.user);
  const allowAdminComposer = mode === 'admin' || (auth.status === 'Authenticated' && auth.user === 'Admin');

  const [reading, setReading] = useState(loadReadingPrefs);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notices, setNotices] = useState([]);
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
  const [roomsText, setRoomsText] = useState('');
  const [closureAllHalls, setClosureAllHalls] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postMessage, setPostMessage] = useState('');

  useEffect(() => {
    saveReadingPrefs(reading);
  }, [reading]);

  const fetchNotices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getNoticesApi({
        search: appliedSearch,
        sort,
        kind: kind === 'ALL' ? '' : kind,
        limit: 300
      });
      setNotices(Array.isArray(data?.notices) ? data.notices : []);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load notices');
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, sort, kind]);

  useEffect(() => {
    fetchNotices();
  }, [fetchNotices]);

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
    setRoomsText('');
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
        rooms: splitRooms(roomsText),
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

  const updateReading = (key, value) => setReading(p => ({ ...p, [key]: value }));

  // Dynamic CSS custom property mapping
  const themeClasses = `notices-theme-root reader-theme-${reading.theme} reader-font-${reading.font}`;

  return (
    <div className={themeClasses} style={{ '--font-base': `${reading.textSize}px` }}>
      <div className={allowAdminComposer ? "notices-layout-grid" : "notices-layout-center"}>
        
        {/* LEFT SIDEBAR */}
        {allowAdminComposer && (
          <aside className={`notices-sidebar ${isComposerMaximized ? 'sidebar-maximized' : ''}`}>
            <header className="notices-hero notices-hero-sidebar">
              <h1>Notice Board</h1>
              <p>Manage and broadcast institutional updates instantly.</p>
              <Link className="notices-hero-home" to="/"><Icons.Home /> Return Home</Link>
            </header>

            {isComposerMaximized && (
              <div className="composer-backdrop" onClick={() => setIsComposerMaximized(false)} />
            )}

            <section className={`notice-composer-card ${isComposerMaximized ? 'maximized' : ''}`}>
              <div className="composer-card-header">
                <h2><Icons.Pen /> Compose Update</h2>
                <button type="button" className="btn-icon" onClick={() => setIsComposerMaximized(!isComposerMaximized)} title={isComposerMaximized ? "Minimize" : "Maximize"}>
                  {isComposerMaximized ? <Icons.Minimize /> : <Icons.Maximize />}
                </button>
              </div>

              <form onSubmit={submitNotice} className="notice-composer-grid">
                <div className="input-group">
                  <label>Title</label>
                  <input className="premium-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter brief subject" maxLength={240} />
                </div>
                
                <div className="input-group" style={{ flex: isComposerMaximized ? '1' : 'none' }}>
                  <label>Full Content</label>
                  <textarea className="premium-input" style={{ height: isComposerMaximized ? '100%' : '120px' }} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Type the detailed announcement..." />
                </div>
                
                <div className={isComposerMaximized ? "composer-row-2" : ""}>
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

                <div className={isComposerMaximized ? "composer-row-2" : ""}>
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
                  <input className="premium-input" value={roomsText} onChange={(e) => setRoomsText(e.target.value)} placeholder="Hall 1, Main Aud." />
                </div>

                <label className="notice-checkbox-label">
                  <input type="checkbox" checked={closureAllHalls} onChange={(e) => setClosureAllHalls(e.target.checked)} />
                  Campus-wide closure applies
                </label>

                <button type="submit" className="btn-primary" disabled={posting}>
                  {posting ? 'Publishing securely...' : 'Publish to Board'}
                </button>
                {postMessage && <p className="notice-post-message" style={{textAlign:'center', fontSize:'0.9rem', color:'var(--notice-accent)'}}>{postMessage}</p>}
              </form>
            </section>
          </aside>
        )}

        {/* RIGHT SIDE */}
        <main className="notices-main">
          
          {!allowAdminComposer && (
            <header className="notices-hero" style={{marginBottom: '24px'}}>
              <h1>Notice Board</h1>
              <p>Stay informed with the latest institutional announcements.</p>
              <Link className="notices-hero-home" to="/"><Icons.Home /> Return Home</Link>
            </header>
          )}

          <section className="notices-sticky-strip">
            <form onSubmit={onSearchSubmit} className="strip-search-row">
              <div className="search-wrapper">
                <Icons.Search />
                <input
                  className="premium-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search keywords, events, or rooms..."
                />
              </div>
              <button type="submit" className="btn-primary" style={{padding: '12px 20px'}}>Search</button>
              <select className="premium-input" style={{width: 'auto'}} value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="LATEST">Latest First</option>
                <option value="OLDEST">Oldest First</option>
                <option value="HOLIDAY_FIRST">Holidays First</option>
              </select>
              <select className="premium-input" style={{width: 'auto'}} value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="ALL">All Categories</option>
                <option value="GENERAL">General</option>
                <option value="HOLIDAY">Closures</option>
              </select>
            </form>

            <div className="strip-controls-row">
              {/* Theme Selector */}
              <div className="readability-group">
                <button type="button" onClick={() => updateReading('theme', 'classic')} className={`readability-btn ${reading.theme === 'classic' ? 'active' : ''}`}><Icons.Sun/> Light</button>
                <button type="button" onClick={() => updateReading('theme', 'paper')} className={`readability-btn ${reading.theme === 'paper' ? 'active' : ''}`}><Icons.Book/> Sepia</button>
                <button type="button" onClick={() => updateReading('theme', 'night')} className={`readability-btn ${reading.theme === 'night' ? 'active' : ''}`}><Icons.Moon/> Dark</button>
              </div>

              {/* Incremental Font Size Controls */}
              <div className="readability-group">
                <button type="button" onClick={() => updateReading('textSize', Math.max(12, reading.textSize - 1))} className="readability-btn">A-</button>
                <span className="readability-val">{reading.textSize}px</span>
                <button type="button" onClick={() => updateReading('textSize', Math.min(40, reading.textSize + 1))} className="readability-btn">A+</button>
              </div>

              {/* Font Dropdown Selection */}
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
          </section>

          {/* Scrollable Notices List */}
          <section className="notices-list">
            {loading && <div className="notice-empty">Syncing latest notices...</div>}
            {!loading && error && <div className="notice-empty notice-error">{error}</div>}
            {!loading && !error && notices.length === 0 && (
              <div className="notice-empty">No updates found for the selected filters.</div>
            )}

            {!loading && !error && notices.map((notice) => (
              <article key={notice._id} className="notice-card">
                <div className="notice-card-head">
                  <h3>{notice.title || notice.subject}</h3>
                  <span className={`notice-badge ${notice.kind === 'HOLIDAY' ? 'holiday' : 'general'}`}>
                    {notice.kind === 'HOLIDAY' ? 'Closure' : 'Update'}
                  </span>
                </div>
                <p className="notice-summary">{notice.summary || 'Click below to read the full details of this announcement.'}</p>
                <div className="notice-meta">
                  <span>🗓 {formatDate(notice.createdAt)}</span>
                  {notice.startDateTime && <span>⏱ Starts: {formatDate(notice.startDateTime)}</span>}
                  {notice.endDateTime && <span>⏱ Ends: {formatDate(notice.endDateTime)}</span>}
                  {Array.isArray(notice.rooms) && notice.rooms.length > 0 && (
                    <span>📍 Locations: {notice.rooms.join(', ')}</span>
                  )}
                  {notice.closureAllHalls && <span>🚨 Campus-wide Closure</span>}
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
    </div>
  );
}