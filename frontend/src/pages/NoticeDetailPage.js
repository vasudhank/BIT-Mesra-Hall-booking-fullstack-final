import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getNoticeByIdApi } from '../api/noticesApi';
import './NoticesPage.css';

const READING_STORAGE_KEY = 'bit_notice_reading_preferences_v1';

const fallbackPrefs = {
  theme: 'classic',
  textSize: 17, // Numeric scale
  font: 'outfit'
};

const loadPrefs = () => {
  try {
    const raw = localStorage.getItem(READING_STORAGE_KEY);
    if (!raw) return fallbackPrefs;
    const parsed = JSON.parse(raw);

    // Migration logic from old string size to numbers
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

const formatDate = (value) => {
  if (!value) return 'N/A';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return 'N/A';
  return dt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

// Premium SVG Icons
const Icons = {
  Sun: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  Moon: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  Book: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  ArrowLeft: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
};

export default function NoticeDetailPage() {
  const { id } = useParams();

  const [reading, setReading] = useState(loadPrefs);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    localStorage.setItem(READING_STORAGE_KEY, JSON.stringify(reading));
  }, [reading]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await getNoticeByIdApi(id);
        if (!active) return;
        setNotice(data?.notice || null);
      } catch (err) {
        if (!active) return;
        setError(err?.response?.data?.error || 'Failed to load notice');
      } finally {
        if (active) setLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [id]);

  const contentParagraphs = React.useMemo(() => {
    const raw = String(notice?.content || notice?.body || '').trim();
    if (!raw) return [];
    return raw
      .split(/\n{2,}/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
  }, [notice]);

  const updateReading = (key, value) => {
    setReading(p => ({ ...p, [key]: value }));
  };

  const themeClasses = `notices-theme-root reader-theme-${reading.theme} reader-font-${reading.font}`;

  return (
    <div className={themeClasses} style={{ '--font-base': `${reading.textSize}px` }}>
      <div className="notices-layout-center">
        
        {/* Sticky controls strip for Reader View */}
        <section className="notices-sticky-strip" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
          <Link className="notices-hero-home" to="/notices" style={{ color: 'var(--notice-text)', fontWeight: 600 }}>
            <Icons.ArrowLeft /> Board
          </Link>
          
          <div className="strip-controls-row" style={{ gap: '12px' }}>
            <div className="readability-group">
              <button onClick={() => updateReading('theme', 'classic')} className={`readability-btn ${reading.theme === 'classic' ? 'active' : ''}`}><Icons.Sun/></button>
              <button onClick={() => updateReading('theme', 'paper')} className={`readability-btn ${reading.theme === 'paper' ? 'active' : ''}`}><Icons.Book/></button>
              <button onClick={() => updateReading('theme', 'night')} className={`readability-btn ${reading.theme === 'night' ? 'active' : ''}`}><Icons.Moon/></button>
            </div>

            <div className="readability-group">
              <button onClick={() => updateReading('textSize', Math.max(12, reading.textSize - 1))} className="readability-btn">A-</button>
              <span className="readability-val">{reading.textSize}px</span>
              <button onClick={() => updateReading('textSize', Math.min(40, reading.textSize + 1))} className="readability-btn">A+</button>
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
        </section>

        {loading && <div className="notice-empty">Fetching article...</div>}
        {!loading && error && <div className="notice-empty notice-error">{error}</div>}
        {!loading && !error && !notice && <div className="notice-empty">Notice not found or deleted.</div>}

        {!loading && !error && notice && (
          <article className="notice-detail-container">
            <header className="notice-detail-header">
              <h1>{notice.title || notice.subject || 'Institutional Update'}</h1>
              <div className="notice-meta" style={{ marginTop: '16px' }}>
                <span className={`notice-badge ${notice.kind === 'HOLIDAY' ? 'holiday' : 'general'}`} style={{ border: 'none' }}>
                  {notice.kind === 'HOLIDAY' ? 'Closure Notice' : 'General Update'}
                </span>
                <span>🗓 Published: {formatDate(notice.createdAt)}</span>
                {notice.holidayName && <span>🎉 Event: {notice.holidayName}</span>}
                {notice.startDateTime && <span>⏱ Start: {formatDate(notice.startDateTime)}</span>}
                {notice.endDateTime && <span>⏱ End: {formatDate(notice.endDateTime)}</span>}
                {Array.isArray(notice.rooms) && notice.rooms.length > 0 && (
                  <span>📍 Rooms: {notice.rooms.join(', ')}</span>
                )}
                {notice.closureAllHalls && <span>🚨 All halls marked closed</span>}
              </div>
            </header>

            <div className="notice-detail-body">
              {contentParagraphs.length === 0 && <p>No detailed body text provided.</p>}
              {contentParagraphs.map((paragraph, index) => (
                <p key={`${id}-${index}`}>{paragraph}</p>
              ))}
            </div>
          </article>
        )}
      </div>
    </div>
  );
}