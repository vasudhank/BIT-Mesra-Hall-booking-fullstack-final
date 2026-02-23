import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SearchIcon from '@mui/icons-material/Search';
import { useSelector } from 'react-redux';
import api from '../api/axiosInstance';
import {
  createComplaint,
  listComplaints,
  postComplaintQuickSolution,
  updateComplaintStatus
} from '../api/complaintsApi';
import './ComplaintsPage.css';

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

const STATUS_STYLES = {
  IN_PROGRESS: 'support-status-in-progress',
  REOPENED: 'support-status-reopened',
  RESOLVED: 'support-status-resolved',
  CLOSED: 'support-status-closed'
};

const formatDate = (value) =>
  new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

const openMailToInNewTab = (event) => {
  event.preventDefault();
  const href = event.currentTarget?.getAttribute('href');
  if (!href) return;
  window.open(href, '_blank', 'noopener,noreferrer');
};

export default function ComplaintsPage({ mode = 'public' }) {
  const user = useSelector((s) => s.user);
  const location = useLocation();
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
  const [complaints, setComplaints] = useState([]);
  const [quickSolutionById, setQuickSolutionById] = useState({});
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 960px)').matches : false
  );
  const [isComposerCompact, setIsComposerCompact] = useState(false);
  const [isHeaderStripCollapsed, setIsHeaderStripCollapsed] = useState(false);

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
    window.location.href = '/developer/login';
  };

  const counts = useMemo(() => {
    const active = complaints.filter((c) => c.status === 'IN_PROGRESS' || c.status === 'REOPENED').length;
    const resolved = complaints.filter((c) => c.status === 'RESOLVED' || c.status === 'CLOSED').length;
    return { active, resolved };
  }, [complaints]);

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

  const loadComplaints = async () => {
    setLoading(true);
    try {
      const res = await listComplaints({
        filter,
        sort,
        q: appliedSearch
      });
      setComplaints(Array.isArray(res.complaints) ? res.complaints : []);
    } catch (err) {
      console.error('Failed to load complaints', err);
      setComplaints([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessionEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const email = params.get('email');
    const title = params.get('title');
    const message = params.get('message');
    if (email || title || message) {
      setForm((prev) => ({
        ...prev,
        email: email || prev.email,
        title: title || prev.title,
        message: message || prev.message
      }));
    }
  }, [location.search]);

  useEffect(() => {
    loadComplaints();
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
    if (hideComposer || !isMobile || !isComposerCompact) {
      setIsHeaderStripCollapsed(false);
    }
  }, [hideComposer, isMobile, isComposerCompact]);

  useEffect(() => {
    if (hideComposer || !isMobile || !composeCardRef.current) {
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
  }, [hideComposer, isMobile]);

  const scrollToComposerCard = () => {
    composeCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!form.email.trim() || !form.title.trim() || !form.message.trim()) return;
    setSubmitting(true);
    try {
      await createComplaint({
        email: form.email.trim(),
        title: form.title.trim(),
        message: form.message.trim()
      });
      setForm((prev) => ({ ...prev, title: '', message: '' }));
      await loadComplaints();
    } catch (err) {
      console.error('Complaint submit failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickSolution = async (complaintId) => {
    const body = String(quickSolutionById[complaintId] || '').trim();
    if (!body) return;
    try {
      await postComplaintQuickSolution(complaintId, { body });
      setQuickSolutionById((prev) => ({ ...prev, [complaintId]: '' }));
      await loadComplaints();
    } catch (err) {
      console.error('Quick solution failed', err);
    }
  };

  const handleStatusAction = async (complaint, nextStatus) => {
    try {
      await updateComplaintStatus(complaint._id, { status: nextStatus });
      await loadComplaints();
    } catch (err) {
      console.error('Status update failed', err);
    }
  };

  const showMobileCompactControls = !hideComposer && isMobile && isComposerCompact;
  const isStripCollapsedOnMobile = showMobileCompactControls && isHeaderStripCollapsed;

  return (
    <div className="support-page complaints-page">
      <div className={`support-layout ${hideComposer ? 'support-layout--no-left' : ''}`}>
        {!hideComposer && (
          <aside className="support-left-panel">
            <div className="support-sort-box">
              <label>SORT COMPLAINTS</label>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <form className="support-raise-card" onSubmit={onSubmit} ref={composeCardRef}>
              <h2>Raise a Complaint</h2>
              <p>Your email will be used for follow-up solutions from admin/developer.</p>
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
                <span>Issue Title *</span>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="Brief summary of the issue"
                  required
                />
              </label>
              <label className="support-input-label">
                <span>Describe the issue *</span>
                <textarea
                  value={form.message}
                  onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
                  placeholder="Provide details to help us resolve this faster..."
                  required
                />
              </label>
              <button className="support-primary-btn" type="submit" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit Complaint'}
              </button>
            </form>

            <Link className="support-home-btn" to="/">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
              Back to Home
            </Link>
          </aside>
        )}

        <section className="support-right-panel">
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
                    <button className="dev-action-btn" onClick={logoutDeveloper}>Logout</button>
                  </div>
                )}
                <div className="support-top-grid">
                  <div className={`support-top-left ${showMobileCompactControls ? 'mobile-controls-visible' : ''}`}>
                    {(hideComposer || showMobileCompactControls) && (
                      <div className={`support-inline-mobile-tools ${showMobileCompactControls ? 'visible' : ''}`}>
                        <div className="support-sort-box inline">
                          <label>SORT COMPLAINTS</label>
                          <select value={sort} onChange={(e) => setSort(e.target.value)}>
                            {SORT_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        {showMobileCompactControls && (
                          <button type="button" className="support-inline-compose-btn" onClick={scrollToComposerCard}>
                            Raise a Complaint
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className={`support-top-center ${showMobileCompactControls ? 'compact-mode' : ''}`}>
                    <div className="support-title-row">
                      <h1>Complaints</h1>
                      {showMobileCompactControls && (
                        <Link className="support-header-home-btn" to="/">
                          Home
                        </Link>
                      )}
                    </div>
                    <p>Raise issues, track replies, and collaborate on trusted solutions.</p>
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
                        All <span className="filter-count">{complaints.length}</span>
                      </button>
                    </div>
                  </div>
                  <div className="support-top-right">
                    <label>SEARCH</label>
                    <div className="support-search-box">
                      <SearchIcon className="search-icon" />
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
                        placeholder="Search titles, emails..."
                      />
                    </div>
                  </div>
                </div>
                {showMobileCompactControls && (
                  <button
                    type="button"
                    className="support-strip-toggle support-strip-toggle--bottom"
                    onClick={() => setIsHeaderStripCollapsed(true)}
                    aria-label="Collapse header strip"
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
                className="support-strip-toggle support-strip-toggle--floating"
                onClick={() => setIsHeaderStripCollapsed(false)}
                aria-label="Expand header strip"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
            )}
          </div>

          <div className="support-list-area">
            {loading ? (
              <div className="support-empty">
                <div className="support-spinner"></div>
                Loading complaints...
              </div>
            ) : complaints.length === 0 ? (
              <div className="support-empty">No complaints found for selected filter.</div>
            ) : (
              complaints.map((item) => (
                <article className="support-thread-card" key={item._id}>
                  <div className="support-thread-head">
                    <div className="support-thread-info">
                      <h3>{item.title}</h3>
                      <p className="thread-preview">{item.message}</p>
                      <p className="thread-author">Reported by: <strong>{item.email}</strong></p>
                    </div>
                    <div className="support-thread-meta">
                      <span className={`support-status-chip ${STATUS_STYLES[item.status] || ''}`}>
                        {String(item.status || '').replaceAll('_', ' ')}
                      </span>
                      <span className="thread-date">{formatDate(item.createdAt)}</span>
                    </div>
                  </div>

                  <div className="support-thread-stats">
                    <span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg> {item.solutionsCount} Solutions</span>
                    <span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg> {item.trustedCount} Trusted</span>
                    {item.aiPendingCount > 0 && <span className="ai-pending-tag">AI Thinking...</span>}
                  </div>

                  <div className="support-thread-actions">
                    <Link className="support-secondary-btn" to={`${isDeveloperView ? '/developer' : isAdminView ? '/admin' : ''}/complaints/${item._id}`}>
                      Open Thread
                    </Link>
                    {trusted && (
                      <>
                        <a
                          className="support-secondary-btn outline"
                          href={`mailto:${item.email}?subject=${encodeURIComponent(`Regarding complaint: ${item.title}`)}&body=${encodeURIComponent(
                            `Complaint Ref: [Complaint#${item._id}]\nDo not change/remove subject or reference number for tracking.`
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={openMailToInNewTab}
                        >
                          Email User (Sync)
                        </a>
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
                        placeholder="Type a quick official solution..."
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
                        Post Official Solution
                      </button>
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
