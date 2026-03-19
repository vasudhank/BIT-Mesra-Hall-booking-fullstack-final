import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import SearchIcon from '@mui/icons-material/Search';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import { useSelector } from 'react-redux';
import { createFeedback, listFeedback, updateFeedbackStatus } from '../api/feedbackApi';
import api from '../api/axiosInstance';
import QuickPageMenu from '../components/Navigation/QuickPageMenu';
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

const SORT_DISPLAY_LABELS = {
  DATE_DESC: 'Date ↓',
  DATE_ASC: 'Date ↑',
  TYPE_ASC: 'Type ↑',
  TYPE_DESC: 'Type ↓',
  STATUS_ASC: 'Status ↑',
  STATUS_DESC: 'Status ↓',
  RATING_DESC: 'Rating ↓',
  RATING_ASC: 'Rating ↑'
};

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
  const [counts, setCounts] = useState({ NEW: 0, IN_REVIEW: 0, DONE: 0, ALL: 0 });
  const [fullscreenComposer, setFullscreenComposer] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 960px)').matches : false
  );
  const [isHeaderStripCollapsed, setIsHeaderStripCollapsed] = useState(false);
  const [isComposeModalOpen, setIsComposeModalOpen] = useState(false);
  const [form, setForm] = useState({
    type: 'SUGGESTION',
    message: '',
    email: '',
    rating: ''
  });

  const loadFeedback = async () => {
    setLoading(true);
    try {
      const [res, countRes] = await Promise.all([
        listFeedback({
          status: statusFilter,
          sort,
          q: appliedSearch
        }),
        listFeedback({
          status: 'ALL',
          sort: 'DATE_DESC',
          q: appliedSearch
        })
      ]);

      const visibleFeedback = Array.isArray(res.feedbacks) ? res.feedbacks : [];
      const allFeedback = Array.isArray(countRes.feedbacks) ? countRes.feedbacks : [];

      const statusCounts = { NEW: 0, IN_REVIEW: 0, DONE: 0, ALL: allFeedback.length };
      allFeedback.forEach((item) => {
        if (statusCounts[item.status] !== undefined) {
          statusCounts[item.status] += 1;
        }
      });

      setFeedbacks(visibleFeedback);
      setCounts(statusCounts);
    } catch (err) {
      console.error('Failed to load feedback', err);
      setFeedbacks([]);
      setCounts({ NEW: 0, IN_REVIEW: 0, DONE: 0, ALL: 0 });
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
    if (isDeveloperView || !isMobile) {
      setIsHeaderStripCollapsed(false);
    }
  }, [isDeveloperView, isMobile]);

  useEffect(() => {
    if (isDeveloperView || isMobile) {
      setFullscreenComposer(false);
    }
  }, [isDeveloperView, isMobile]);

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

  const showMobileCompactControls = !isDeveloperView && isMobile;
  const isStripCollapsedOnMobile = showMobileCompactControls && isHeaderStripCollapsed;
  const getSortDisplayLabel = (value) => SORT_DISPLAY_LABELS[value] || SORT_OPTIONS.find((opt) => opt.value === value)?.label || '';
  const renderSortSelect = (className = '', labelText = 'SORT FEEDBACK') => (
    <div className={`feedback-sort-wrap ${className}`.trim()}>
      <label>{labelText}</label>
      <div className="feedback-sort-select-shell" data-selected-label={getSortDisplayLabel(sort)}>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  const topStrip = (
    <div className="feedback-top-strip-shell">
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
                <QuickPageMenu
                  buttonLabel="Menu"
                  buttonClassName="dev-action-btn feedback-dev-menu-btn"
                  panelClassName="feedback-dev-menu-panel"
                  itemClassName="feedback-dev-menu-item"
                  align="left"
                  preferLeftWhenTight
                />
              </div>
            )}

            <div className={`feedback-top-row ${showMobileCompactControls ? 'compact-mode' : ''}`}>
              <div className="feedback-title-wrap">
                <div className="feedback-title-row">
                  <h1>FEEDBACK</h1>
                  {showMobileCompactControls && (
                    <div className="feedback-title-mobile-tools">
                      {renderSortSelect('inline feedback-mobile-title-sort')}
                      <QuickPageMenu
                        iconOnly
                        buttonClassName="feedback-header-home-btn feedback-header-menu-btn"
                        panelClassName="feedback-menu-panel"
                        itemClassName="feedback-menu-item"
                        align="right"
                        topItems={[
                          { key: 'mobile-collapse-strip', label: 'Collapse Strip', onClick: () => setIsHeaderStripCollapsed(true) }
                        ]}
                        extraItems={[
                          { key: 'mobile-home', label: 'Home', path: '/' },
                          { key: 'mobile-compose-feedback', label: 'Share Feedback', onClick: () => setIsComposeModalOpen(true) }
                        ]}
                      />
                    </div>
                  )}
                </div>
                <p>Help us improve with bugs, ideas, and appreciation.</p>
              </div>

              <div className="feedback-search-wrap">
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
                renderSortSelect()
              )}

              <div className="feedback-status-tabs">
                {STATUS_OPTIONS.map((status) => {
                  const label = status === 'ALL' ? 'All' : status.replace('_', ' ');
                  const count = counts[status] || 0;
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

          </>
        )}

        {showMobileCompactControls && isStripCollapsedOnMobile && (
          <button
            type="button"
            className="feedback-strip-toggle feedback-strip-toggle--restore-corner"
            onClick={() => setIsHeaderStripCollapsed(false)}
            aria-label="Expand feedback strip"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div
      className={`feedback-page feedback-page--detached-strip ${!isDeveloperView && !isMobile ? 'feedback-page--has-left' : ''}`.trim()}
    >
      {topStrip}
      <div className="feedback-layout">
        {!isDeveloperView && !isMobile && (
          <aside className="feedback-left">
            {!fullscreenComposer && (
              <form className="feedback-compose-card" onSubmit={submitFeedback} ref={composeCardRef}>
                <div className="feedback-compose-head">
                  <h2>Share Feedback</h2>
                  <button
                    type="button"
                    className="feedback-expand-btn"
                    onClick={() => setFullscreenComposer(true)}
                    aria-label="Maximize share feedback card"
                  >
                    <OpenInFullIcon fontSize="small" />
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
            )}

            {!fullscreenComposer && (
              <div className="feedback-home-menu-row">
                <Link className="feedback-home-btn" to="/">
                  Home
                </Link>
                <QuickPageMenu
                  buttonLabel="Menu"
                  buttonClassName="feedback-home-btn feedback-menu-btn"
                  panelClassName="feedback-menu-panel"
                  itemClassName="feedback-menu-item"
                  align="left"
                  preferLeftWhenTight
                />
              </div>
            )}
          </aside>
        )}

        <section className="feedback-right">
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

      {!isDeveloperView && !isMobile && fullscreenComposer && (
        <div className="feedback-compose-overlay-backdrop" onClick={() => setFullscreenComposer(false)}>
          <form
            className="feedback-compose-card feedback-compose-overlay-card"
            onSubmit={submitFeedback}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="feedback-compose-head">
              <h2>Share Feedback</h2>
              <button
                type="button"
                className="feedback-expand-btn"
                onClick={() => setFullscreenComposer(false)}
                aria-label="Close maximized share feedback card"
              >
                <CloseFullscreenIcon fontSize="small" />
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
        </div>
      )}

      {showMobileCompactControls && isComposeModalOpen && (
        <div className="feedback-mobile-compose-backdrop" onClick={() => setIsComposeModalOpen(false)}>
          <form className="feedback-compose-card feedback-mobile-compose-card" onSubmit={submitFeedback} onClick={(e) => e.stopPropagation()}>
            <div className="feedback-compose-head">
              <h2>Share Feedback</h2>
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
            <div className="feedback-mobile-compose-actions">
              <button type="button" className="feedback-home-btn" onClick={() => setIsComposeModalOpen(false)}>
                Cancel
              </button>
              <button className="feedback-submit-btn" type="submit">
                Submit Feedback
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
