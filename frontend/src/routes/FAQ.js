import React from 'react';
import HomeUpper from '../components/HomeUpper/HomeUpper';
import HomeFooter from '../components/HomeFooter/HomeFooter';

export default function FAQ() {
  const faqs = [
    {
      q: "How does the system prevent booking conflicts?",
      a: "The system provides a real-time schedule where rows represent halls and columns represent dates/slots. Faculty can see availability before requesting, and administrators are alerted to overlapping requests instantly."
    },
    {
      q: "How will I know if my booking is approved?",
      a: "Once the administrator makes a decision, you will receive an automated notification via both Email and SMS."
    },
    {
      q: "What is AI Mode?",
      a: "AI Mode is an intelligent assistant that allows you to book halls using voice commands, provides step-by-step navigation, and answers questions about the system in natural language."
    },
    {
      q: "Can I contact other department heads directly?",
      a: "Yes, the platform includes a direct contact directory with phone numbers and email addresses of faculty members and administrators for instant communication."
    }
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <HomeUpper />
      <div style={{ flex: 1, padding: '60px 20px', maxWidth: '800px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '40px', textAlign: 'center' }}>Frequently Asked Questions</h1>
        <div className="faq-list">
          {faqs.map((faq, index) => (
            <div key={index} style={{ marginBottom: '30px', padding: '20px', borderRadius: '8px', backgroundColor: 'rgba(128,128,128,0.05)', border: '1px solid var(--border-color)' }}>
              <h3 style={{ color: 'var(--text-primary)', marginBottom: '10px' }}>{faq.q}</h3>
              <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}>{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
      <HomeFooter />
    </div>
  );
}