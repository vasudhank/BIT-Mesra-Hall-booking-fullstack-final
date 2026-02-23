import React, { useEffect, useRef, useState } from 'react';
import HomeUpper from '../components/HomeUpper/HomeUpper';
import HomeFooter from '../components/HomeFooter/HomeFooter';
import './About.css';

export default function About({ lightMode, toggleTheme }) {
  const sectionTopRef = useRef(null);
  const [mobileHeaderExpanded, setMobileHeaderExpanded] = useState(false);
  const [mobileHeaderLocked, setMobileHeaderLocked] = useState(false);

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

  return (
    <div className="about-page" style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      flexDirection: 'column'
    }}>
      {/* Header Section */}
      <HomeUpper
        lightMode={lightMode}
        toggleTheme={toggleTheme}
        mobileHeaderExpanded={mobileHeaderExpanded}
      />
      <div ref={sectionTopRef} className="section-top-anchor" />

      {/* Main Content Section */}
      <div
        className="about-content"
        style={{ 
        flex: 1, 
        padding: '80px 24px', 
        maxWidth: '1000px', 
        margin: '0 auto',
        width: '100%'
      }}>
        <h1 style={{ 
          fontSize: '2.8rem', 
          fontWeight: '700', 
          marginBottom: '40px', 
          color: 'var(--text-primary)',
          borderLeft: '6px solid #b71c1c', // A professional accent line
          paddingLeft: '20px'
        }}>
          About Us - BIT Mesra Institute Hall Booking System
        </h1>

        <div style={{ 
          lineHeight: '1.8', 
          fontSize: '1.15rem', 
          color: 'var(--text-primary)',
          textAlign: 'justify'
        }}>
          <p style={{ marginBottom: '24px' }}>
            The BIT Mesra Institute Hall Booking System is a centralized digital platform designed to simplify and modernize the process of booking academic and non-academic halls within the campus of Birla Institute of Technology, Mesra, Ranchi. This system has been created specifically for faculty members, department heads (HODs), and administrative staff to manage hall reservations in an efficient, transparent, and conflict-free manner.
          </p>

          <p style={{ marginBottom: '24px' }}>
            Before the introduction of this platform, hall booking at BIT Mesra was handled entirely through manual email communication. Faculty members had to send emails to HODs or administrators requesting approval for specific halls on specific dates and time slots. In many cases, this process involved follow-up phone calls to ensure that the request was noticed and approved. While this method worked on a small scale, it became increasingly problematic as the number of booking requests grew.
          </p>

          <p style={{ marginBottom: '24px' }}>
            In real scenarios, multiple faculty members often requested the same hall for the same date, sometimes even for the same time slot. Since all requests were scattered across different email threads, administrators had to manually search through their inboxes to check whether a hall had already been approved for someone else. This was not only time-consuming but also highly error-prone. It was very easy to forget previous approvals, overlook certain emails, or accidentally approve conflicting bookings. Managing dozens of such requests every week through emails alone became mentally exhausting and practically unmanageable.
          </p>

          <p style={{ marginBottom: '24px' }}>
            The BIT Mesra Institute Hall Booking System solves this problem by providing a single, centralized platform where all booking activities are recorded and visible in real time. Faculty members can now view the availability status of each hall before sending a booking request. The system displays the next booked date and time for every hall and also provides a complete booking schedule in a clear table format, where rows represent halls and columns represent dates and time slots. This transparency itself reduces conflicts, as users can instantly see whether a hall is already booked and plan accordingly.
          </p>

          <p style={{ marginBottom: '24px' }}>
            When a faculty member submits a booking request, the administrator receives the request in three ways: on their dashboard within the system, on their email, and via SMS on their registered phone number. Each notification includes direct links that allow the administrator to approve or reject the request instantly without needing to manually log in every time. To further improve convenience, the administrator also receives a list of other booking requests for the same hall and date, making it easier to detect potential conflicts at a glance.
          </p>

          <p style={{ marginBottom: '24px' }}>
            Once a decision is made, the faculty member is automatically notified through both email and SMS. This ensures that there is no ambiguity or delay in communication. Both parties always remain informed about the current status of the booking, eliminating unnecessary follow-ups and confusion.
          </p>

          <p style={{ marginBottom: '24px' }}>
            The platform also includes powerful management tools for administrators. They can filter booking requests based on hall, date, status, or conflicts, allowing them to handle a large volume of requests efficiently. A built-in search feature makes it easy to locate specific halls or requests within seconds. Faculty members also benefit from similar search functionality on their dashboards, enabling them to quickly find hall information and availability.
          </p>

          <p style={{ marginBottom: '24px' }}>
            In addition to booking management, the system provides a direct contact directory containing phone numbers and email addresses of faculty members, HODs, and administrators. This allows users to communicate instantly whenever necessary, without searching through separate lists or directories.
          </p>

          <p style={{ marginBottom: '24px' }}>
            One of the most advanced features of this platform is the integrated AI Mode. This intelligent assistant helps users understand how to use the system through guided navigation, voice instructions, screenshots, and interactive explanations. Users can ask questions in natural language, either by typing or speaking, and the AI will guide them step by step through the required actions.
          </p>

          <p style={{ marginBottom: '24px' }}>
            Faculty members can even submit booking requests simply by speaking to the AI, specifying the hall name, date, and time slot. The AI processes the request and submits it automatically. Administrators can also interact with the AI to check for conflicts, review schedules, and approve or reject requests using voice commands, without performing any manual clicks. This reduces mental workload and allows complex administrative tasks to be completed in seconds through simple conversation.
          </p>

          <p style={{ marginBottom: '40px', fontWeight: '500' }}>
            Overall, the BIT Mesra Institute Hall Booking System transforms a previously chaotic and inefficient process into a streamlined, intelligent, and user-friendly digital experience. It reduces administrative burden, prevents booking conflicts, improves transparency, and ensures that hall management at BIT Mesra is accurate, fast, and future-ready.
          </p>
        </div>
      </div>

      {/* Footer Section */}
      <HomeFooter />
    </div>
  );
}

