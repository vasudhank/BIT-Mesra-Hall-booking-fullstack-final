import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import SearchIcon from '@mui/icons-material/Search';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import { useSelector } from 'react-redux';
import { createFeedback, listFeedback, updateFeedbackStatus } from '../api/feedbackApi';
import api from '../api/axiosInstance';
import './FeedbackPage.css';

const SORT_OPTIONS = [
  { value: 'DATE_DESC', label: 'Date: Newest First' },
  { value: 'DATE_ASC', label: 'Date: Oldest First' },
  { value: 'TYPE_ASC', label: 'Type: A-Z' },
  { value: 'TYPE_DESC', label: 'Type: Z-A' },
  { value: 'STATUS_ASC', label: 'Status: A-Z' },
  { value: 'STATUS_DESC', label: 'Status: Z-A' },
  { value: 'RATING_DESC', label: 'Rating: High-Low' },
  { value: 'RATING_ASC', label: 'Rating: Low-High' }
];

const STATUS_OPTIONS = ['ALL', 'NEW', 'IN_REVIEW', 'DONE'];
const TYPE_OPTIONS = ['BUG', 'SUGGESTION', 'PRAISE'];

const formatDate = (value) =>
  new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export default function FeedbackPage({ mode = 'public' }) {
  const user = useSelector((s) => s.user);
  const role = String(user.user || '').toUpperCase();
  const trusted = role === 'ADMIN' || role === 'DEVELOPER';
  const location = useLocation();
  const navigate = useNavigate();
  const isDeveloperView = mode === 'developer' || location.pathname.startsWith('/developer/');
  const composeCardRef = useRef(null);

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sort, setSort] = useState('DATE_DESC');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedbacks, setFeedbacks] = useState([]);
  const [fullscreenComposer, setFullscreenComposer] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 960px)').matches : false
  );
  const [isComposerCompact, setIsComposerCompact] = useState(false);
  const [isHeaderStripCollapsed, setIsHeaderStripCollapsed] = useState(false);
  const [form, setForm] = useState({
    type: 'SUGGESTION',
    message: '',
    email: '',
    rating: ''
  });

  const counts = useMemo(() => {
    const map = { NEW: 0, IN_REVIEW: 0, DONE: 0 };
    feedbacks.forEach((item) => {
      if (map[item.status] !== undefined) map[item.status] += 1;
    });
    return map;
  }, [feedbacks]);

  const loadFeedback = async () => {
    setLoading(true);
    try {
      const res = await listFeedback({
        status: statusFilter,
        sort,
        q: appliedSearch
      });
      setFeedbacks(Array.isArray(res.feedbacks) ? res.feedbacks : []);
    } catch (err) {
      console.error('Failed to load feedback', err);
      setFeedbacks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api
      .get('/details', { withCredentials: true })
      .then((res) => {
        if (res?.data?.details?.email) {
          setForm((prev) => ({ ...prev, email: res.data.details.email }));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadFeedback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, sort, appliedSearch]);

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
    if (isDeveloperView || !isMobile || !composeCardRef.current) {
      setIsComposerCompact(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsComposerCompact(entry.intersectionRatio < 0.2);
      },
      {
        threshold: [0, 0.2, 0.5, 1],
        rootMargin: '-64px 0px 0px 0px'
      }
    );

    observer.observe(composeCardRef.current);
    return () => observer.disconnect();
  }, [isDeveloperView, isMobile]);

  useEffect(() => {
    if (isDeveloperView || !isMobile || !isComposerCompact) {
      setIsHeaderStripCollapsed(false);
    }
  }, [isDeveloperView, isMobile, isComposerCompact]);

  const submitFeedback = async (e) => {
    e.preventDefault();
    if (!form.message.trim()) return;
    try {
      await createFeedback({
        type: form.type,
        message: form.message.trim(),
        email: form.email.trim(),
        rating: form.rating ? Number(form.rating) : null
      });
      setForm((prev) => ({ ...prev, message: '', rating: '' }));
      setFullscreenComposer(false);
      await loadFeedback();
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to submit feedback');
    }
  };

  const changeStatus = async (id, next) => {
    try {
      await updateFeedbackStatus(id, { status: next });
      await loadFeedback();
    } catch (err) {
      alert(err?.response?.data?.error || 'Unable to change status');
    }
  };

  const logoutDeveloper = async () => {
    try {
      await api.get('/logout', { withCredentials: true });
    } catch {
      // ignore
    } finally {
      navigate('/developer/login');
    }
  };

  const scrollToComposeCard = () => {
    composeCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const showMobileCompactControls = !isDeveloperView && isMobile && isComposerCompact;
  const isStripCollapsedOnMobile = showMobileCompactControls && isHeaderStripCollapsed;

  return (
    <div className={`feedback-page ${fullscreenComposer ? 'composer-fullscreen' : ''}`}>
      <div className="feedback-layout">
        {!isDeveloperView && (
          <aside className={`feedback-left ${fullscreenComposer ? 'fullscreen' : ''}`}>
            <form className="feedback-compose-card" onSubmit={submitFeedback} ref={composeCardRef}>
              <div className="feedback-compose-head">
                <h2>Share Feedback</h2>
                <button
                  type="button"
                  className="feedback-expand-btn"
                  onClick={() => setFullscreenComposer((prev) => !prev)}
                >
                  {fullscreenComposer ? <CloseFullscreenIcon /> : <OpenInFullIcon />}
                </button>
              </div>
              <p>Help us improve with bugs, ideas, and appreciation.</p>
              <label>
                <span>Type</span>
                <select
                  value={form.type}
                  onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
                >
                  {TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Your Email (Optional)</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="Your Email (Optional)"
                />
              </label>
              <label>
                <span>Rating (Optional)</span>
                <select
                  value={form.rating}
                  onChange={(e) => setForm((prev) => ({ ...prev, rating: e.target.value }))}
                >
                  <option value="">Select Rating</option>
                  <option value="5">5 - Excellent</option>
                  <option value="4">4 - Good</option>
                  <option value="3">3 - Average</option>
                  <option value="2">2 - Poor</option>
                  <option value="1">1 - Bad</option>
                </select>
              </label>
              <label>
                <span>Your Message *</span>
                <textarea
                  value={form.message}
                  onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
                  placeholder="Your Message *"
                  required
                />
              </label>
              <button className="feedback-submit-btn" type="submit">
                Submit Feedback
              </button>
            </form>

            {!fullscreenComposer && (
              <Link className="feedback-home-btn" to="/">
                Home
              </Link>
            )}
          </aside>
        )}

        <section className="feedback-right">
          <div className={`feedback-sticky-strip ${showMobileCompactControls ? 'mobile-compact' : ''} ${isStripCollapsedOnMobile ? 'strip-collapsed-mobile' : ''}`}>
            {!isStripCollapsedOnMobile && (
              <>
                {isDeveloperView && (
                  <div className="developer-action-row">
                    <Link to="/" className="dev-action-btn">
                      Home
                    </Link>
                    <Link to="/developer/account" className="dev-action-btn">
                      Accounts
                    </Link>
                    <button className="dev-action-btn" onClick={logoutDeveloper}>
                      Logout
                    </button>
                  </div>
                )}

                {showMobileCompactControls && (
                  <div className="feedback-inline-mobile-tools">
                    <div className="feedback-sort-wrap inline">
                      <label>SORT FEEDBACK</label>
                      <select value={sort} onChange={(e) => setSort(e.target.value)}>
                        {SORT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button type="button" className="feedback-inline-compose-btn" onClick={scrollToComposeCard}>
                      Share Feedback
                    </button>
                  </div>
                )}

                <div className={`feedback-top-row ${showMobileCompactControls ? 'compact-mode' : ''}`}>
                  <div className="feedback-title-wrap">
                    <div className="feedback-title-row">
                      <h1>FEEDBACK</h1>
                      {showMobileCompactControls && (
                        <Link className="feedback-header-home-btn" to="/">
                          Home
                        </Link>
                      )}
                    </div>
                    <p>Help us improve with bugs, ideas, and appreciation.</p>
                  </div>

                  <div className="feedback-search-wrap">
                    <label>SEARCH FEEDBACK</label>
                    <div className="feedback-search-box">
                      <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => {
                          const next = e.target.value;
                          setSearchInput(next);
                          if (!next.trim()) setAppliedSearch('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') setAppliedSearch(searchInput.trim());
                        }}
                        placeholder="Type, email, status..."
                      />
                      <button type="button" onClick={() => setAppliedSearch(searchInput.trim())}>
                        <SearchIcon />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="feedback-filter-row">
                  {!showMobileCompactControls && (
                    <div className="feedback-sort-wrap">
                      <label>SORT FEEDBACK</label>
                      <select value={sort} onChange={(e) => setSort(e.target.value)}>
                        {SORT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="feedback-status-tabs">
                    {STATUS_OPTIONS.map((status) => {
                      const label = status === 'ALL' ? 'All' : status.replace('_', ' ');
                      const count = status === 'ALL' ? feedbacks.length : (counts[status] || 0);
                      return (
                      <button
                        key={status}
                        className={`feedback-status-tab ${statusFilter === status ? 'active' : ''}`}
                        onClick={() => setStatusFilter(status)}
                      >
                        <span className="feedback-status-label">{label}</span>
                        <span className="feedback-status-count-badge">{count}</span>
                      </button>
                      );
                    })}
                  </div>
                </div>

                {showMobileCompactControls && (
                  <button
                    type="button"
                    className="feedback-strip-toggle feedback-strip-toggle--bottom"
                    onClick={() => setIsHeaderStripCollapsed(true)}
                    aria-label="Collapse feedback strip"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="18 15 12 9 6 15"></polyline>
                    </svg>
                  </button>
                )}
              </>
            )}

            {showMobileCompactControls && isStripCollapsedOnMobile && (
              <button
                type="button"
                className="feedback-strip-toggle feedback-strip-toggle--floating"
                onClick={() => setIsHeaderStripCollapsed(false)}
                aria-label="Expand feedback strip"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
            )}
          </div>

          <div className="feedback-list">
            {loading ? (
              <div className="feedback-empty">Loading feedback...</div>
            ) : feedbacks.length === 0 ? (
              <div className="feedback-empty">No feedback available for selected filters.</div>
            ) : (
              feedbacks.map((item) => (
                <article className="feedback-card" key={item._id}>
                  <div className="feedback-card-head">
                    <div>
                      <span className="feedback-type-tag">{item.type}</span>
                      <span className="feedback-status-tag">{item.status.replace('_', ' ')}</span>
                    </div>
                    <span>{formatDate(item.createdAt)}</span>
                  </div>
                  <p>{item.message}</p>
                  <div className="feedback-meta-row">
                    <span>Email: {item.email || 'Not provided'}</span>
                    <span>Rating: {item.rating || '-'}</span>
                  </div>

                  {trusted && (
                    <div className="feedback-card-actions">
                      <button onClick={() => changeStatus(item._id, 'NEW')}>Mark New</button>
                      <button onClick={() => changeStatus(item._id, 'IN_REVIEW')}>In Review</button>
                      <button onClick={() => changeStatus(item._id, 'DONE')}>Done</button>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
