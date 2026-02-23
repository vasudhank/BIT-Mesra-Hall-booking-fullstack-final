import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import HomeUpper from '../components/HomeUpper/HomeUpper';
import HomeFooter from '../components/HomeFooter/HomeFooter';
import { listFaqs } from '../api/faqApi';
import './FAQ.css';

export default function FAQ({ lightMode, toggleTheme }) {
  const sectionTopRef = useRef(null);
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openFaqId, setOpenFaqId] = useState(null); // Added for accordion UI
  const [mobileHeaderExpanded, setMobileHeaderExpanded] = useState(false);
  const [mobileHeaderLocked, setMobileHeaderLocked] = useState(false);

  const loadFaqs = async () => {
    setLoading(true);
    try {
      const res = await listFaqs();
      setFaqs(Array.isArray(res.faqs) ? res.faqs.filter((x) => x.active) : []);
    } catch (err) {
      console.error('Failed to load FAQs', err);
      setFaqs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFaqs();
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  useEffect(() => {
    const evaluate = () => {
      if (!sectionTopRef.current || window.innerWidth > 1364) {
        setMobileHeaderExpanded(false);
        setMobileHeaderLocked(false);
        return;
      }
      if (mobileHeaderLocked) {
        setMobileHeaderExpanded(true);
        return;
      }
      const sectionTop = sectionTopRef.current.getBoundingClientRect().top;
      if (sectionTop <= 0) {
        setMobileHeaderExpanded(true);
        setMobileHeaderLocked(true);
      } else {
        setMobileHeaderExpanded(false);
      }
    };

    evaluate();
    window.addEventListener('scroll', evaluate, { passive: true });
    window.addEventListener('resize', evaluate);

    return () => {
      window.removeEventListener('scroll', evaluate);
      window.removeEventListener('resize', evaluate);
    };
  }, [mobileHeaderLocked]);

  const toggleFaq = (id) => {
    setOpenFaqId(openFaqId === id ? null : id);
  };

  return (
    <div className="faq-page">
      <HomeUpper
        lightMode={lightMode}
        toggleTheme={toggleTheme}
        mobileHeaderExpanded={mobileHeaderExpanded}
      />
      <div ref={sectionTopRef} className="section-top-anchor" />
      
      <div className="faq-surface-layer">
        <div className="faq-container">
          <div className="faq-header-wrapper">
            <h1 className="faq-title">Frequently Asked Questions</h1>
            <p className="faq-subtitle">Trusted answers for common BIT Booking workflows.</p>
          </div>

          <div className="faq-layout">
            <section className="faq-main">
              {loading ? (
                <div className="faq-empty">
                  <div className="faq-spinner"></div>
                  <p>Loading answers...</p>
                </div>
              ) : faqs.length === 0 ? (
                <div className="faq-empty">
                  <p>No FAQs available yet.</p>
                </div>
              ) : (
                <div className="faq-list">
                  {faqs.map((faq) => {
                    const isOpen = openFaqId === faq._id;
                    return (
                      <article 
                        className={`faq-item ${isOpen ? 'open' : ''}`} 
                        key={faq._id}
                        onClick={() => toggleFaq(faq._id)}
                      >
                        <div className="faq-item-header">
                          <h3>{faq.question}</h3>
                          <span className="faq-chevron">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                          </span>
                        </div>
                        
                        <div className="faq-item-content">
                          <div className="faq-item-inner">
                            <p>{faq.answer}</p>
                            {faq.isAIGenerated && (
                              <span className="faq-ai-tag">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>
                                AI Generated
                              </span>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <aside className="faq-side">
              <div className="faq-help-card">
                <div className="faq-help-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                </div>
                <h2>Need something else?</h2>
                <p>If your answer is not listed here, use our live channels:</p>
                
                <div className="faq-help-links">
                  <Link to="/queries" className="faq-link-btn">Ask in Queries</Link>
                  <Link to="/complaints" className="faq-link-btn">Raise Complaint</Link>
                  <Link to="/feedback" className="faq-link-btn">Share Feedback</Link>
                </div>
              </div>
            </aside>
          </div>
        </div>
        
        <HomeFooter />
      </div>
    </div>
  );
}
