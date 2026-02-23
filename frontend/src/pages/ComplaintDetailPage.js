import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SearchIcon from '@mui/icons-material/Search';
import ThumbUpAltOutlinedIcon from '@mui/icons-material/ThumbUpAltOutlined';
import ThumbUpAltIcon from '@mui/icons-material/ThumbUpAlt';
import ThumbDownAltOutlinedIcon from '@mui/icons-material/ThumbDownAltOutlined';
import ThumbDownAltIcon from '@mui/icons-material/ThumbDownAlt';
import CommentOutlinedIcon from '@mui/icons-material/CommentOutlined';
import ReplyOutlinedIcon from '@mui/icons-material/ReplyOutlined';
import {
  getComplaint,
  postComplaintReply,
  postComplaintSolution,
  reactComplaintReply,
  reactComplaintSolution,
  requestComplaintReopenOtp,
  updateComplaintStatus,
  verifyComplaintReopenOtp
} from '../api/complaintsApi';
import api from '../api/axiosInstance';
import './ComplaintDetailPage.css';

const STATUS_STYLES = {
  IN_PROGRESS: 'detail-status-in-progress',
  REOPENED: 'detail-status-reopened',
  RESOLVED: 'detail-status-resolved',
  CLOSED: 'detail-status-closed'
};

const SORT_OPTIONS = [
  { value: 'DATE_DESC', label: 'Time: Newest First' },
  { value: 'DATE_ASC', label: 'Time: Oldest First' },
  { value: 'TRUSTED_TOP', label: 'Trusted: Top' },
  { value: 'TRUSTED_BOTTOM', label: 'Trusted: Bottom' },
  { value: 'LIKES_DESC', label: 'Likes: High-Low' },
  { value: 'COMMENTS_DESC', label: 'Comments: High-Low' },
  { value: 'UPVOTES_DESC', label: 'Upvotes: High-Low' }
];

const formatDate = (value) =>
  new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

const pickFirstText = (obj, keys = []) => {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
};

const formatAuthor = (name, email) => {
  const safeName = String(name || 'Guest');
  const safeEmail = String(email || '').trim();
  return safeEmail ? `${safeName} (${safeEmail})` : safeName;
};

const getViewerId = () => {
  const key = 'supportViewerId';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const generated = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  localStorage.setItem(key, generated);
  return generated;
};

const openMailToInNewTab = (event) => {
  event.preventDefault();
  const href = event.currentTarget?.getAttribute('href');
  if (!href) return;
  window.open(href, '_blank', 'noopener,noreferrer');
};

const readReactionStore = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
};

const writeReactionStore = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const buildReplyTree = (replies = []) => {
  const map = new Map();
  const roots = [];
  replies.forEach((r) => {
    map.set(String(r._id), { ...r, children: [] });
  });
  replies.forEach((r) => {
    const node = map.get(String(r._id));
    if (r.parentReplyId && map.has(String(r.parentReplyId))) {
      map.get(String(r.parentReplyId)).children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
};

export default function ComplaintDetailPage({ mode = 'public' }) {
  const { id } = useParams();
  const issueCardRef = useRef(null);
  const addSolutionCardRef = useRef(null);
  const [complaint, setComplaint] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState('DATE_DESC');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [form, setForm] = useState({ authorName: '', authorEmail: '', body: '' });
  const [replyDrafts, setReplyDrafts] = useState({});
  const [openComments, setOpenComments] = useState({});
  const [openReplyComposer, setOpenReplyComposer] = useState({});
  const [replyParent, setReplyParent] = useState({});
  const [reopenOtp, setReopenOtp] = useState({ email: '', otp: '' });
  const [role, setRole] = useState('');
  const [sessionEmail, setSessionEmail] = useState('');
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 960px)').matches : false
  );
  const [isAddSolutionCompact, setIsAddSolutionCompact] = useState(false);
  const [isAnswersStripCollapsed, setIsAnswersStripCollapsed] = useState(false);
  const [isQuestionPopupOpen, setIsQuestionPopupOpen] = useState(false);

  const viewerId = useMemo(() => getViewerId(), []);
  const [solutionReactionMap, setSolutionReactionMap] = useState(() => readReactionStore('complaintSolutionReactions'));
  const [replyReactionMap, setReplyReactionMap] = useState(() => readReactionStore('complaintReplyReactions'));

  const trusted = role === 'ADMIN' || role === 'DEVELOPER';

  const load = async () => {
    setLoading(true);
    try {
      const [complaintRes, detailsRes] = await Promise.all([
        getComplaint(id, { viewerId }),
        api.get('/details', { withCredentials: true }).catch(() => ({ data: {} }))
      ]);
      const fetched = complaintRes?.complaint || null;
      setComplaint(fetched);
      if (fetched) {
        const nextSolutionReactions = {};
        const nextReplyReactions = {};
        (fetched.solutions || []).forEach((solution) => {
          nextSolutionReactions[solution._id] = Number(solution.userReaction || 0);
          (solution.replies || []).forEach((reply) => {
            nextReplyReactions[reply._id] = Number(reply.userReaction || 0);
          });
        });
        setSolutionReactionMap((prev) => {
          const merged = { ...prev, ...nextSolutionReactions };
          writeReactionStore('complaintSolutionReactions', merged);
          return merged;
        });
        setReplyReactionMap((prev) => {
          const merged = { ...prev, ...nextReplyReactions };
          writeReactionStore('complaintReplyReactions', merged);
          return merged;
        });
      }

      const userType = String(detailsRes?.data?.details?.type || '').toUpperCase();
      const userEmail = detailsRes?.data?.details?.email || '';
      setRole(userType);
      setSessionEmail(userEmail);
      if (userEmail) {
        setForm((prev) => ({ ...prev, authorEmail: userEmail }));
        setReopenOtp((prev) => ({ ...prev, email: userEmail }));
      }
    } catch (err) {
      console.error('Failed to load complaint detail', err);
      setComplaint(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const poll = setInterval(() => {
      if (complaint?.aiPendingCount > 0) load();
    }, 4000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, complaint?.aiPendingCount]);

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
    if (!isMobile || !addSolutionCardRef.current) {
      setIsAddSolutionCompact(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsAddSolutionCompact(entry.intersectionRatio < 0.2);
      },
      {
        threshold: [0, 0.2, 0.5, 1],
        rootMargin: '-64px 0px 0px 0px'
      }
    );

    observer.observe(addSolutionCardRef.current);
    return () => observer.disconnect();
  }, [id, isMobile]);

  useEffect(() => {
    if (!isMobile || !isAddSolutionCompact) {
      setIsAnswersStripCollapsed(false);
    }
  }, [isMobile, isAddSolutionCompact]);

  const filteredSolutions = useMemo(() => {
    if (!complaint) return [];
    const base = [...(complaint.solutions || [])];
    const query = appliedSearch.trim().toLowerCase();
    const bySearch = query
      ? base.filter((s) => {
          const emailMatch = String(s.authorEmail || '').toLowerCase().includes(query);
          const text = pickFirstText(s, ['body', 'message', 'content', 'solution']);
          const bodyMatch = text.toLowerCase().includes(query);
          return emailMatch || bodyMatch;
        })
      : base;

    const sorters = {
      DATE_DESC: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      DATE_ASC: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
      TRUSTED_TOP: (a, b) => Number(b.trusted) - Number(a.trusted),
      TRUSTED_BOTTOM: (a, b) => Number(a.trusted) - Number(b.trusted),
      LIKES_DESC: (a, b) => (b.likes || 0) - (a.likes || 0),
      COMMENTS_DESC: (a, b) => (b.replies?.length || 0) - (a.replies?.length || 0),
      UPVOTES_DESC: (a, b) => (b.likes || 0) - (a.likes || 0)
    };

    return bySearch.sort(sorters[sort] || sorters.DATE_DESC);
  }, [complaint, appliedSearch, sort]);

  const saveSolutionReactionMap = (next) => {
    setSolutionReactionMap(next);
    writeReactionStore('complaintSolutionReactions', next);
  };

  const saveReplyReactionMap = (next) => {
    setReplyReactionMap(next);
    writeReactionStore('complaintReplyReactions', next);
  };

  const submitSolution = async (e) => {
    e.preventDefault();
    if (!form.body.trim()) return;
    try {
      await postComplaintSolution(id, {
        authorName: trusted ? (role === 'ADMIN' ? 'Admin' : 'Developer') : form.authorName,
        authorEmail: trusted ? sessionEmail : form.authorEmail,
        body: form.body
      });
      setForm((prev) => ({ ...prev, body: '' }));
      await load();
    } catch (err) {
      alert(err?.response?.data?.error || 'Unable to post solution');
    }
  };

  const reactSolution = async (solutionId, value) => {
    try {
      const result = await reactComplaintSolution(id, solutionId, { voterId: viewerId, value });
      saveSolutionReactionMap({
        ...solutionReactionMap,
        [solutionId]: result.userReaction || 0
      });
      await load();
    } catch (err) {
      console.error('Solution reaction failed', err);
    }
  };

  const submitReply = async (solutionId) => {
    const draft = replyDrafts[solutionId] || {};
    const body = String(draft.body || '').trim();
    if (!body) return;
    try {
      await postComplaintReply(id, solutionId, {
        parentReplyId: replyParent[solutionId] || null,
        authorName: trusted ? (role === 'ADMIN' ? 'Admin' : 'Developer') : draft.authorName,
        authorEmail: trusted ? sessionEmail : draft.authorEmail,
        voterId: viewerId,
        body
      });
      setReplyDrafts((prev) => ({
        ...prev,
        [solutionId]: { ...prev[solutionId], body: '' }
      }));
      setReplyParent((prev) => ({ ...prev, [solutionId]: null }));
      setOpenReplyComposer((prev) => ({ ...prev, [solutionId]: false }));
      await load();
    } catch (err) {
      alert(err?.response?.data?.error || 'Unable to post reply');
    }
  };

  const reactReply = async (solutionId, replyId, value) => {
    try {
      const result = await reactComplaintReply(id, solutionId, replyId, { voterId: viewerId, value });
      saveReplyReactionMap({
        ...replyReactionMap,
        [replyId]: result.userReaction || 0
      });
      await load();
    } catch (err) {
      console.error('Reply reaction failed', err);
    }
  };

  const updateStatus = async (nextStatus) => {
    try {
      await updateComplaintStatus(id, { status: nextStatus });
      await load();
    } catch (err) {
      alert(err?.response?.data?.error || 'Status update failed');
    }
  };

  const sendReopenOtp = async () => {
    try {
      await requestComplaintReopenOtp(id, { email: reopenOtp.email });
      alert('OTP sent to reporter email.');
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to send OTP');
    }
  };

  const verifyReopenOtp = async () => {
    try {
      await verifyComplaintReopenOtp(id, { email: reopenOtp.email, otp: reopenOtp.otp });
      await load();
      setReopenOtp((prev) => ({ ...prev, otp: '' }));
    } catch (err) {
      alert(err?.response?.data?.error || 'OTP verification failed');
    }
  };

  const renderReplyNode = (solutionId, node, depth = 0) => {
    const reaction = replyReactionMap[node._id] || 0;
    return (
      <div className="thread-reply-node" style={{ '--depth': depth }} key={node._id}>
        <div className="thread-reply-content">
          <div className="thread-reply-head">
            <strong>{formatAuthor(node.authorName, node.authorEmail)}</strong>
            <span>{formatDate(node.createdAt)}</span>
          </div>
          <p>{pickFirstText(node, ['body', 'message', 'content', 'text'])}</p>
          <div className="thread-reply-actions">
            <button
              type="button"
              className={`thread-icon-btn ${reaction === 1 ? 'active' : ''}`}
              onClick={() => reactReply(solutionId, node._id, 1)}
              title="Like"
            >
              {reaction === 1 ? <ThumbUpAltIcon fontSize="small"/> : <ThumbUpAltOutlinedIcon fontSize="small"/>}
              <span>{node.upvotes || 0}</span>
            </button>
            <button
              type="button"
              className={`thread-icon-btn ${reaction === -1 ? 'active' : ''}`}
              onClick={() => reactReply(solutionId, node._id, -1)}
              title="Dislike"
            >
              {reaction === -1 ? <ThumbDownAltIcon fontSize="small"/> : <ThumbDownAltOutlinedIcon fontSize="small"/>}
              <span>{node.downvotes || 0}</span>
            </button>
            <button
              type="button"
              className="thread-icon-btn"
              onClick={() => {
                setReplyParent((prev) => ({ ...prev, [solutionId]: node._id }));
                setOpenReplyComposer((prev) => ({ ...prev, [solutionId]: true }));
              }}
              title="Reply"
            >
              <ReplyOutlinedIcon fontSize="small"/>
              <span>Reply</span>
            </button>
          </div>
        </div>
        {(node.children || []).map((child) => renderReplyNode(solutionId, child, depth + 1))}
      </div>
    );
  };

  if (loading && !complaint) {
    return (
      <div className="complaint-detail-page">
        <div className="support-empty"><div className="support-spinner"></div>Loading complaint...</div>
      </div>
    );
  }

  if (!complaint) {
    return <div className="complaint-detail-page"><div className="support-empty">Complaint not found.</div></div>;
  }

  const listPath =
    mode === 'developer' ? '/developer/complaints' : mode === 'admin' ? '/admin/complaints' : '/complaints';
  const showCompactAnswerControls = isMobile && isAddSolutionCompact;
  const isAnswersStripCollapsedOnMobile = showCompactAnswerControls && isAnswersStripCollapsed;
  const scrollToAddSolutionCard = () =>
    addSolutionCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="complaint-detail-page">
      <div className="complaint-detail-container">
        <Link className="thread-back-btn" to={listPath}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          Back to List
        </Link>

        <section className="thread-issue-card" ref={issueCardRef}>
          <div className="thread-issue-head">
            <h1>{complaint.title}</h1>
            <span className={`thread-status-chip ${STATUS_STYLES[complaint.status] || ''}`}>
              {String(complaint.status).replaceAll('_', ' ')}
            </span>
          </div>
          <div className="thread-issue-meta">
            <p>Reported by <strong>{complaint.email}</strong></p>
            <p>Posted {formatDate(complaint.createdAt)}</p>
          </div>
          <div className="thread-issue-body">
            <p>{pickFirstText(complaint, ['message', 'description', 'issue', 'body'])}</p>
          </div>
          <div className="thread-issue-actions">
            <a
              className="thread-action-btn primary"
              href={`mailto:${complaint.email}?subject=${encodeURIComponent(`Regarding complaint: ${complaint.title}`)}&body=${encodeURIComponent(
                `Complaint Ref: [Complaint#${complaint._id}]\nDo not change/remove subject or reference number for tracking.`
              )}`}
              target="_blank"
              rel="noreferrer"
              onClick={openMailToInNewTab}
            >
              Direct Mail Reporter
            </a>
            {trusted && (
              <>
                {(complaint.status === 'IN_PROGRESS' || complaint.status === 'REOPENED') && (
                  <button className="thread-action-btn success" onClick={() => updateStatus('RESOLVED')}>Mark Resolved</button>
                )}
                {(complaint.status === 'RESOLVED' || complaint.status === 'CLOSED') && (
                  <button className="thread-action-btn warning" onClick={() => updateStatus('REOPENED')}>Reopen</button>
                )}
              </>
            )}
            {!trusted && (complaint.status === 'RESOLVED' || complaint.status === 'CLOSED') && (
              <div className="thread-otp-box">
                <input
                  type="email"
                  placeholder="Reporter Email"
                  value={reopenOtp.email}
                  onChange={(e) => setReopenOtp((prev) => ({ ...prev, email: e.target.value }))}
                />
                <button onClick={sendReopenOtp}>Send OTP</button>
                <input
                  type="text"
                  placeholder="Enter OTP"
                  value={reopenOtp.otp}
                  onChange={(e) => setReopenOtp((prev) => ({ ...prev, otp: e.target.value }))}
                />
                <button className="thread-action-btn warning" onClick={verifyReopenOtp}>Verify & Reopen</button>
              </div>
            )}
          </div>
        </section>

        <section className="thread-add-solution-card" ref={addSolutionCardRef}>
          <h2>Contribute a Solution</h2>
          <p className="subtitle">Guest replies are allowed, but only admin/developer replies are marked trusted.</p>
          <form onSubmit={submitSolution}>
            {!trusted && (
              <div className="form-row">
                <input
                  type="text"
                  placeholder="Your Name *"
                  value={form.authorName}
                  onChange={(e) => setForm((prev) => ({ ...prev, authorName: e.target.value }))}
                  required
                />
                <input
                  type="email"
                  placeholder="Your Email *"
                  value={form.authorEmail}
                  onChange={(e) => setForm((prev) => ({ ...prev, authorEmail: e.target.value }))}
                  required
                />
              </div>
            )}
            <textarea
              placeholder="Write your solution..."
              value={form.body}
              onChange={(e) => setForm((prev) => ({ ...prev, body: e.target.value }))}
              required
            />
            <button type="submit" className="submit-btn">Post Solution</button>
          </form>
        </section>

        <section className="thread-solutions-card">
          <div
            className={`thread-solutions-strip ${showCompactAnswerControls ? 'mobile-compact' : ''} ${
              isAnswersStripCollapsedOnMobile ? 'strip-collapsed-mobile' : ''
            }`}
          >
            {!isAnswersStripCollapsedOnMobile && (
              <>
                <div className={`thread-solutions-title-row ${showCompactAnswerControls ? 'compact-mode' : ''}`}>
                  {showCompactAnswerControls && (
                    <Link className="thread-header-icon-btn" to={listPath} aria-label="Back to complaints list">
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                        <path d="M11,17a1,1,0,0,1-.71-1.71L13.59,12,10.29,8.71a1,1,0,0,1,1.41-1.41l4,4a1,1,0,0,1,0,1.41l-4,4A1,1,0,0,1,11,17Z"></path>
                        <path d="M15 13H5a1 1 0 0 1 0-2H15a1 1 0 0 1 0 2zM19 20a1 1 0 0 1-1-1V5a1 1 0 0 1 2 0V19A1 1 0 0 1 19 20z"></path>
                      </svg>
                    </Link>
                  )}
                  <h2>Solutions ({filteredSolutions.length})</h2>
                  {showCompactAnswerControls && (
                    <button
                      type="button"
                      className="thread-header-action-btn"
                      onClick={() => setIsQuestionPopupOpen(true)}
                    >
                      View Question
                    </button>
                  )}
                </div>

                <div
                  className={`thread-solutions-controls ${
                    showCompactAnswerControls ? 'mobile-compact-controls' : ''
                  }`}
                >
                  <select value={sort} onChange={(e) => setSort(e.target.value)}>
                    {SORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {showCompactAnswerControls && (
                    <button type="button" className="thread-inline-add-btn" onClick={scrollToAddSolutionCard}>
                      Add a Solution
                    </button>
                  )}
                  <div className="thread-solutions-search">
                    <SearchIcon className="search-icon" fontSize="small" />
                    <input
                      type="text"
                      placeholder="Search solutions..."
                      value={searchInput}
                      onChange={(e) => {
                        const next = e.target.value;
                        setSearchInput(next);
                        if (!next.trim()) setAppliedSearch('');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setAppliedSearch(searchInput.trim());
                      }}
                    />
                  </div>
                </div>

                {showCompactAnswerControls && (
                  <button
                    type="button"
                    className="thread-strip-toggle thread-strip-toggle--bottom"
                    onClick={() => setIsAnswersStripCollapsed(true)}
                    aria-label="Collapse answers strip"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="18 15 12 9 6 15"></polyline>
                    </svg>
                  </button>
                )}
              </>
            )}

            {showCompactAnswerControls && isAnswersStripCollapsedOnMobile && (
              <button
                type="button"
                className="thread-strip-toggle thread-strip-toggle--floating"
                onClick={() => setIsAnswersStripCollapsed(false)}
                aria-label="Expand answers strip"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
            )}
          </div>

          <div className="thread-solutions-list">
            {filteredSolutions.map((solution) => {
              const reaction = solutionReactionMap[solution._id] || 0;
              const isOpen = Boolean(openComments[solution._id]);
              const composerOpen = Boolean(openReplyComposer[solution._id]) || Boolean(replyParent[solution._id]);
              const replyTree = buildReplyTree(solution.replies || []);
              const draft = replyDrafts[solution._id] || {};
              const activeParent = replyParent[solution._id];
              return (
                <article className="thread-solution-item" key={solution._id}>
                  <div className="thread-solution-head">
                    <div className="head-author-area">
                      <h3>{formatAuthor(solution.authorName, solution.authorEmail)}</h3>
                      <div className="chip-group">
                        {solution.trusted && (
                          <span className="trusted-chip">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                            Trusted {solution.authorRole === 'DEVELOPER' ? 'Dev' : solution.authorRole === 'ADMIN' ? 'Admin' : ''}
                          </span>
                        )}
                        {solution.isAIGenerated && <span className="ai-chip">AI Generated</span>}
                        {solution.isAIPending && <span className="ai-thinking-chip">Thinking...</span>}
                      </div>
                    </div>
                    <span className="date-text">{formatDate(solution.createdAt)}</span>
                  </div>

                  <div className="thread-solution-body">
                    <p>{pickFirstText(solution, ['body', 'message', 'content', 'solution'])}</p>
                  </div>

                  <div className="thread-solution-actions">
                    <button
                      type="button"
                      className={`thread-icon-btn ${reaction === 1 ? 'active' : ''}`}
                      onClick={() => reactSolution(solution._id, 1)}
                    >
                      {reaction === 1 ? <ThumbUpAltIcon fontSize="small"/> : <ThumbUpAltOutlinedIcon fontSize="small"/>}
                      <span>{solution.likes || 0}</span>
                    </button>
                    <button
                      type="button"
                      className={`thread-icon-btn ${reaction === -1 ? 'active' : ''}`}
                      onClick={() => reactSolution(solution._id, -1)}
                    >
                      {reaction === -1 ? <ThumbDownAltIcon fontSize="small"/> : <ThumbDownAltOutlinedIcon fontSize="small"/>}
                      <span>{solution.dislikes || 0}</span>
                    </button>
                    <div className="action-divider"></div>
                    <button
                      type="button"
                      className={`thread-icon-btn ${isOpen ? 'active-text' : ''}`}
                      onClick={() => setOpenComments((prev) => ({ ...prev, [solution._id]: !prev[solution._id] }))}
                    >
                      <CommentOutlinedIcon fontSize="small"/>
                      <span>{solution.replies?.length || 0} Comments</span>
                    </button>
                    <button
                      type="button"
                      className={`thread-icon-btn ${composerOpen ? 'active-text' : ''}`}
                      onClick={() => {
                        setReplyParent((prev) => ({ ...prev, [solution._id]: null }));
                        setOpenReplyComposer((prev) => ({ ...prev, [solution._id]: true }));
                      }}
                    >
                      <ReplyOutlinedIcon fontSize="small"/>
                      <span>Reply</span>
                    </button>
                  </div>

                  {composerOpen && (
                    <div className="thread-reply-form">
                      {activeParent && (
                        <div className="replying-to-pill">
                          Replying to thread...
                          <button
                            type="button"
                            onClick={() => setReplyParent((prev) => ({ ...prev, [solution._id]: null }))}
                          >
                            ×
                          </button>
                        </div>
                      )}
                      {!trusted && (
                        <div className="thread-reply-ident form-row">
                          <input
                            type="text"
                            placeholder="Name (Optional)"
                            value={draft.authorName || ''}
                            onChange={(e) =>
                              setReplyDrafts((prev) => ({
                                ...prev,
                                [solution._id]: { ...prev[solution._id], authorName: e.target.value }
                              }))
                            }
                          />
                          <input
                            type="email"
                            placeholder="Email (Optional)"
                            value={draft.authorEmail || ''}
                            onChange={(e) =>
                              setReplyDrafts((prev) => ({
                                ...prev,
                                [solution._id]: { ...prev[solution._id], authorEmail: e.target.value }
                              }))
                            }
                          />
                        </div>
                      )}
                      <textarea
                        placeholder="Add a comment or reply..."
                        value={draft.body || ''}
                        onChange={(e) =>
                          setReplyDrafts((prev) => ({
                            ...prev,
                            [solution._id]: { ...prev[solution._id], body: e.target.value }
                          }))
                        }
                      />
                      <button className="submit-btn small" type="button" onClick={() => submitReply(solution._id)}>
                        Post Reply
                      </button>
                    </div>
                  )}

                  {isOpen && (
                    <div className="thread-replies-list">
                      {replyTree.length === 0 ? (
                        <div className="thread-no-comments">No comments on this solution yet.</div>
                      ) : (
                        replyTree.map((node) => renderReplyNode(solution._id, node))
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
      {isQuestionPopupOpen && (
        <div className="thread-question-modal-backdrop" onClick={() => setIsQuestionPopupOpen(false)}>
          <div className="thread-question-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{complaint.title}</h3>
            <p>{pickFirstText(complaint, ['message', 'description', 'issue', 'body'])}</p>
            <button type="button" className="thread-question-modal-close" onClick={() => setIsQuestionPopupOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
