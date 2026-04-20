import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import SearchIcon from '@mui/icons-material/Search';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import { useSelector } from 'react-redux';
import api from '../api/axiosInstance';
import {
  createQuery,
  listQueries,
  postQueryQuickSolution,
  updateQueryStatus
} from '../api/queriesApi';
import QuickPageMenu from '../components/Navigation/QuickPageMenu';
import './ComplaintsPage.css';
import './QueriesPage.css';

const SORT_OPTIONS = [
  { value: 'DATE_DESC', label: 'Date: Newest First' },
  { value: 'DATE_ASC', label: 'Date: Oldest First' },
  { value: 'TITLE_ASC', label: 'Title: A-Z' },
  { value: 'TITLE_DESC', label: 'Title: Z-A' },
  { value: 'EMAIL_ASC', label: 'Email: A-Z' },
  { value: 'EMAIL_DESC', label: 'Email: Z-A' },
  { value: 'SOLUTIONS_DESC', label: 'Solutions: High-Low' },
  { value: 'SOLUTIONS_ASC', label: 'Solutions: Low-High' },
  { value: 'TRUSTED_DESC', label: 'Trusted: High-Low' },
  { value: 'TRUSTED_ASC', label: 'Trusted: Low-High' }
];

const SORT_DISPLAY_LABELS = {
  DATE_DESC: 'Date ↓',
  DATE_ASC: 'Date ↑',
  TITLE_ASC: 'Title ↑',
  TITLE_DESC: 'Title ↓',
  EMAIL_ASC: 'Email ↑',
  EMAIL_DESC: 'Email ↓',
  SOLUTIONS_DESC: 'Solutions ↓',
  SOLUTIONS_ASC: 'Solutions ↑',
  TRUSTED_DESC: 'Trusted ↓',
  TRUSTED_ASC: 'Trusted ↑'
};

const STATUS_STYLES = {
  IN_PROGRESS: 'support-status-in-progress',
  REOPENED: 'support-status-reopened',
  RESOLVED: 'support-status-resolved',
  CLOSED: 'support-status-closed'
};

const formatDate = (value) =>
  new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export default function QueriesPage({ mode = 'public' }) {
  const user = useSelector((s) => s.user);
  const location = useLocation();
  const navigate = useNavigate();
  const isDeveloperView = mode === 'developer' || location.pathname.startsWith('/developer/');
  const isAdminView = mode === 'admin' || location.pathname.startsWith('/admin/');
  const role = String(user.user || '').toUpperCase();
  const trusted = role === 'ADMIN' || role === 'DEVELOPER';
  const composeCardRef = useRef(null);

  const [filter, setFilter] = useState('ACTIVE');
  const [sort, setSort] = useState('DATE_DESC');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [queries, setQueries] = useState([]);
  const [counts, setCounts] = useState({ active: 0, resolved: 0, all: 0 });
  const [quickSolutionById, setQuickSolutionById] = useState({});
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 960px)').matches : false
  );
  const [fullscreenComposer, setFullscreenComposer] = useState(false);
  const [isHeaderStripCollapsed, setIsHeaderStripCollapsed] = useState(false);
  const [isComposeModalOpen, setIsComposeModalOpen] = useState(false);

  const [form, setForm] = useState({
    email: '',
    title: '',
    message: ''
  });

  const hideComposer = isDeveloperView;

  const logoutDeveloper = async () => {
    try {
      await api.get('/logout', { withCredentials: true });
    } catch {
      // ignore
    }
    navigate('/developer/login', { replace: true });
  };

  const fetchSessionEmail = async () => {
    try {
      const { data } = await api.get('/details', { withCredentials: true });
      const email = data?.details?.email || '';
      if (email) {
        setForm((prev) => ({ ...prev, email }));
      }
    } catch {
      // ignore
    }
  };

  const loadQueries = async () => {
    setLoading(true);
    try {
      const [res, countRes] = await Promise.all([
        listQueries({
          filter,
          sort,
          q: appliedSearch
        }),
        listQueries({
          filter: 'ALL',
          sort: 'DATE_DESC',
          q: appliedSearch
        })
      ]);

      const visibleQueries = Array.isArray(res.queries) ? res.queries : [];
      const allQueries = Array.isArray(countRes.queries) ? countRes.queries : [];

      const activeCount = allQueries.filter((item) => item.status === 'IN_PROGRESS' || item.status === 'REOPENED').length;
      const resolvedCount = allQueries.filter((item) => item.status === 'RESOLVED' || item.status === 'CLOSED').length;

      setQueries(visibleQueries);
      setCounts({
        active: activeCount,
        resolved: resolvedCount,
        all: allQueries.length
      });
    } catch (err) {
      console.error('Failed to load queries', err);
      setQueries([]);
      setCounts({ active: 0, resolved: 0, all: 0 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessionEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadQueries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, sort, appliedSearch]);

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
    if (hideComposer || !isMobile) {
      setIsHeaderStripCollapsed(false);
    }
  }, [hideComposer, isMobile]);

  useEffect(() => {
    if (hideComposer || isMobile) {
      setFullscreenComposer(false);
    }
  }, [hideComposer, isMobile]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!form.email.trim() || !form.title.trim() || !form.message.trim()) return;
    setSubmitting(true);
    try {
      await createQuery({
        email: form.email.trim(),
        title: form.title.trim(),
        message: form.message.trim()
      });
      setForm((prev) => ({ ...prev, title: '', message: '' }));
      setFullscreenComposer(false);
      await loadQueries();
    } catch (err) {
      console.error('Query submit failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickSolution = async (queryId) => {
    const body = String(quickSolutionById[queryId] || '').trim();
    if (!body) return;
    try {
      await postQueryQuickSolution(queryId, { body });
      setQuickSolutionById((prev) => ({ ...prev, [queryId]: '' }));
      await loadQueries();
    } catch (err) {
      console.error('Quick solution failed', err);
    }
  };

  const handleStatusAction = async (thread, nextStatus) => {
    try {
      await updateQueryStatus(thread._id, { status: nextStatus });
      await loadQueries();
    } catch (err) {
      console.error('Status update failed', err);
    }
  };

  const showMobileCompactControls = !hideComposer && isMobile;
  const isStripCollapsedOnMobile = showMobileCompactControls && isHeaderStripCollapsed;
  const getSortDisplayLabel = (value) => SORT_DISPLAY_LABELS[value] || SORT_OPTIONS.find((opt) => opt.value === value)?.label || '';
  const renderSortSelect = (className = '', labelText = 'SORT QUERIES') => (
    <div className={`support-sort-box ${className}`.trim()}>
      <label>{labelText}</label>
      <div className="support-sort-select-shell" data-selected-label={getSortDisplayLabel(sort)}>
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
    <div className="support-top-strip-shell">
      <div className={`support-top-strip ${showMobileCompactControls ? 'mobile-compact' : ''} ${isStripCollapsedOnMobile ? 'strip-collapsed-mobile' : ''}`}>
        {!isStripCollapsedOnMobile && (
          <>
            {isDeveloperView && (
              <div className="developer-action-row">
                <Link to="/" className="dev-action-btn">Home</Link>
                <Link to="/developer/account" className="dev-action-btn">Accounts</Link>
                <Link to="/developer/complaints" className="dev-action-btn">Complaints</Link>
                <Link to="/developer/queries" className="dev-action-btn">Queries</Link>
                <Link to="/developer/feedback" className="dev-action-btn">Feedback</Link>
                <Link to="/developer/monitoring" className="dev-action-btn">Monitoring</Link>
                <button className="dev-action-btn" onClick={logoutDeveloper}>Logout</button>
                <QuickPageMenu
                  buttonLabel="Menu"
                  buttonClassName="dev-action-btn support-dev-menu-btn"
                  panelClassName="support-dev-menu-panel"
                  itemClassName="support-dev-menu-item"
                  excludeKeys={['complaints', 'queries', 'feedback']}
                  align="left"
                  preferLeftWhenTight
                />
              </div>
            )}
            <div className="support-top-grid">
              <div className={`support-top-left ${showMobileCompactControls ? 'mobile-controls-visible' : ''}`} />
              <div className={`support-top-center ${showMobileCompactControls ? 'compact-mode' : ''}`}>
                <div className="support-title-row">
                  <h1>Queries</h1>
                  {showMobileCompactControls && (
                    <div className="support-title-mobile-tools">
                      {renderSortSelect('inline support-mobile-title-sort')}
                      <QuickPageMenu
                        iconOnly
                        buttonClassName="support-header-home-btn support-header-menu-btn"
                        panelClassName="support-menu-panel"
                        itemClassName="support-menu-item"
                        align="right"
                        topItems={[
                          { key: 'mobile-collapse-strip', label: 'Collapse Strip', onClick: () => setIsHeaderStripCollapsed(true) }
                        ]}
                        extraItems={[
                          { key: 'mobile-home', label: 'Home', path: '/' },
                          { key: 'mobile-compose-query', label: 'Ask a Query', onClick: () => setIsComposeModalOpen(true) }
                        ]}
                      />
                    </div>
                  )}
                </div>
                <p>Ask project-specific questions, get AI/community help, and mark accepted answers.</p>
                <div className="support-filter-row">
                  <button
                    className={`support-filter-btn ${filter === 'ACTIVE' ? 'active' : ''}`}
                    onClick={() => setFilter('ACTIVE')}
                  >
                    Active <span className="filter-count">{counts.active}</span>
                  </button>
                  <button
                    className={`support-filter-btn ${filter === 'RESOLVED' ? 'active' : ''}`}
                    onClick={() => setFilter('RESOLVED')}
                  >
                    Resolved <span className="filter-count">{counts.resolved}</span>
                  </button>
                  <button
                    className={`support-filter-btn ${filter === 'ALL' ? 'active' : ''}`}
                    onClick={() => setFilter('ALL')}
                  >
                    All <span className="filter-count">{counts.all}</span>
                  </button>
                </div>
              </div>
              <div className="support-top-right">
                <div className="support-search-box">
                  <button
                    type="button"
                    className="search-icon-btn"
                    onClick={() => setAppliedSearch(searchInput.trim())}
                    aria-label="Search queries"
                  >
                    <SearchIcon className="search-icon" />
                  </button>
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
                    aria-label="Search queries"
                    placeholder="Search queries..."
                  />
                </div>
              </div>
            </div>
          </>
        )}
        {showMobileCompactControls && isStripCollapsedOnMobile && (
          <button
            type="button"
            className="support-strip-toggle support-strip-toggle--restore-corner"
            onClick={() => setIsHeaderStripCollapsed(false)}
            aria-label="Expand header strip"
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
      className={`support-page queries-page support-page--detached-strip ${!hideComposer && !isMobile ? 'support-page--has-left' : ''}`.trim()}
    >
      {topStrip}
      <div className={`support-layout ${hideComposer ? 'support-layout--no-left' : ''}`}>
        {!hideComposer && !isMobile && (
          <aside className="support-left-panel">
            {renderSortSelect()}

            {!fullscreenComposer && (
              <form className="support-raise-card" onSubmit={onSubmit} ref={composeCardRef}>
                <div className="support-compose-head">
                  <h2>Ask a Query</h2>
                  <button
                    type="button"
                    className="support-expand-btn"
                    onClick={() => setFullscreenComposer(true)}
                    aria-label="Maximize ask query card"
                  >
                    <OpenInFullIcon fontSize="small" />
                  </button>
                </div>
                <p>Your email helps trusted responders follow up accurately.</p>
                <label className="support-input-label">
                  <span>Your Email *</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="name@example.com"
                    required
                  />
                </label>
                <label className="support-input-label">
                  <span>Query Title *</span>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="What is your question?"
                    required
                  />
                </label>
                <label className="support-input-label">
                  <span>Describe your question *</span>
                  <textarea
                    value={form.message}
                    onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
                    placeholder="Elaborate on your question here..."
                    required
                  />
                </label>
                <button className="support-primary-btn" type="submit" disabled={submitting}>
                  {submitting ? 'Submitting...' : 'Submit Query'}
                </button>
              </form>
            )}

            <div className="support-home-menu-row">
              <Link className="support-home-btn" to="/">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                Back to Home
              </Link>
              <QuickPageMenu
                buttonLabel="Menu"
                buttonClassName="support-home-btn support-menu-btn"
                panelClassName="support-menu-panel"
                itemClassName="support-menu-item"
                align="left"
                preferLeftWhenTight
              />
            </div>
          </aside>
        )}

        <section className="support-right-panel">
          <div className="support-list-area">
            {loading ? (
              <div className="support-empty">
                <div className="support-spinner"></div>
                Loading queries...
              </div>
            ) : queries.length === 0 ? (
              <div className="support-empty">No queries found for selected filter.</div>
            ) : (
              queries.map((item) => (
                <article className="support-thread-card" key={item._id}>
                  <div className="support-thread-head">
                    <div className="support-thread-info">
                      <h3>{item.title}</h3>
                      <p className="thread-preview">{item.message}</p>
                      <p className="thread-author">Asked by: <strong>{item.email}</strong></p>
                    </div>
                    <div className="support-thread-meta">
                      <span className={`support-status-chip ${STATUS_STYLES[item.status] || ''}`}>
                        {String(item.status || '').replaceAll('_', ' ')}
                      </span>
                      <span className="thread-date">{formatDate(item.createdAt)}</span>
                    </div>
                  </div>

                  <div className="support-thread-stats">
                    <span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg> {item.solutionsCount} Answers</span>
                    <span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg> {item.trustedCount} Trusted</span>
                    {item.aiPendingCount > 0 && <span className="ai-pending-tag">AI Thinking...</span>}
                  </div>

                  <div className="support-thread-actions">
                    <Link className="support-secondary-btn" to={`${isDeveloperView ? '/developer' : isAdminView ? '/admin' : ''}/queries/${item._id}`}>
                      Open Thread
                    </Link>
                    {trusted && (
                      <>
                        {(item.status === 'IN_PROGRESS' || item.status === 'REOPENED') && (
                          <button className="support-secondary-btn success" onClick={() => handleStatusAction(item, 'RESOLVED')}>
                            Mark Resolved
                          </button>
                        )}
                        {(item.status === 'RESOLVED' || item.status === 'CLOSED') && (
                          <button className="support-secondary-btn warning" onClick={() => handleStatusAction(item, 'REOPENED')}>
                            Reopen
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {trusted && (
                    <div className="support-quick-solution">
                      <textarea
                        placeholder="Type a quick answer..."
                        value={quickSolutionById[item._id] || ''}
                        onChange={(e) =>
                          setQuickSolutionById((prev) => ({
                            ...prev,
                            [item._id]: e.target.value
                          }))
                        }
                      />
                      <button
                        className="support-primary-btn compact"
                        onClick={() => handleQuickSolution(item._id)}
                      >
                        Post Answer
                      </button>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        </section>
      </div>

      {!hideComposer && !isMobile && fullscreenComposer && (
        <div className="support-compose-overlay-backdrop" onClick={() => setFullscreenComposer(false)}>
          <form
            className="support-raise-card support-compose-overlay-card"
            onSubmit={onSubmit}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="support-compose-head">
              <h2>Ask a Query</h2>
              <button
                type="button"
                className="support-expand-btn"
                onClick={() => setFullscreenComposer(false)}
                aria-label="Close maximized ask query card"
              >
                <CloseFullscreenIcon fontSize="small" />
              </button>
            </div>
            <p>Your email helps trusted responders follow up accurately.</p>
            <label className="support-input-label">
              <span>Your Email *</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="name@example.com"
                required
              />
            </label>
            <label className="support-input-label">
              <span>Query Title *</span>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="What is your question?"
                required
              />
            </label>
            <label className="support-input-label">
              <span>Describe your question *</span>
              <textarea
                value={form.message}
                onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
                placeholder="Elaborate on your question here..."
                required
              />
            </label>
            <button className="support-primary-btn" type="submit" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Query'}
            </button>
          </form>
        </div>
      )}

      {showMobileCompactControls && isComposeModalOpen && (
        <div className="support-mobile-compose-backdrop" onClick={() => setIsComposeModalOpen(false)}>
          <form className="support-raise-card support-mobile-compose-card" onSubmit={onSubmit} onClick={(e) => e.stopPropagation()}>
            <h2>Ask a Query</h2>
            <p>Your email helps trusted responders follow up accurately.</p>
            <label className="support-input-label">
              <span>Your Email *</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="name@example.com"
                required
              />
            </label>
            <label className="support-input-label">
              <span>Query Title *</span>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="What is your question?"
                required
              />
            </label>
            <label className="support-input-label">
              <span>Describe your question *</span>
              <textarea
                value={form.message}
                onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
                placeholder="Elaborate on your question here..."
                required
              />
            </label>
            <div className="support-mobile-compose-actions">
              <button type="button" className="support-secondary-btn" onClick={() => setIsComposeModalOpen(false)}>
                Cancel
              </button>
              <button className="support-primary-btn" type="submit" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit Query'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
