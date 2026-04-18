import React from 'react';
import LinkedInIcon from '@mui/icons-material/LinkedIn';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import ArrowOutwardRoundedIcon from '@mui/icons-material/ArrowOutwardRounded';
import HomeUpper from '../components/HomeUpper/HomeUpper';
import HomeFooter from '../components/HomeFooter/HomeFooter';
import './About.css';

function normalizeExternalUrl(value) {
  const trimmedValue = String(value || '').trim();

  if (!trimmedValue) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    return trimmedValue;
  }

  return `https://${trimmedValue.replace(/^\/+/, '')}`;
}

function getExternalId(url) {
  const normalizedUrl = normalizeExternalUrl(url);

  if (!normalizedUrl) {
    return '';
  }

  return normalizedUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

const teamProfiles = [
  {
    badge: 'Developer',
    name: String(process.env.REACT_APP_ABOUT_DEV_NAME || '').trim(),
    role: String(process.env.REACT_APP_ABOUT_DEV_ROLE || 'Project Developer').trim(),
    image: String(process.env.REACT_APP_ABOUT_DEV_IMAGE || '').trim(),
    profileUrl: normalizeExternalUrl(process.env.REACT_APP_ABOUT_DEV_LINKEDIN),
    profileId: getExternalId(process.env.REACT_APP_ABOUT_DEV_LINKEDIN),
    profileLabel: String(process.env.REACT_APP_ABOUT_DEV_PROFILE_LABEL || 'LinkedIn').trim(),
    email: String(process.env.REACT_APP_ABOUT_DEV_EMAIL || '').trim()
  },
  {
    badge: 'Guide',
    name: String(process.env.REACT_APP_ABOUT_GUIDE_NAME || '').trim(),
    role: String(process.env.REACT_APP_ABOUT_GUIDE_ROLE || 'Project Guide').trim(),
    image: String(process.env.REACT_APP_ABOUT_GUIDE_IMAGE || '').trim(),
    profileUrl: normalizeExternalUrl(process.env.REACT_APP_ABOUT_GUIDE_LINKEDIN),
    profileId: getExternalId(process.env.REACT_APP_ABOUT_GUIDE_LINKEDIN),
    profileLabel: String(process.env.REACT_APP_ABOUT_GUIDE_PROFILE_LABEL || 'LinkedIn').trim(),
    email: String(process.env.REACT_APP_ABOUT_GUIDE_EMAIL || '').trim()
  }
].filter((profile) => profile.name && profile.image);

export default function About({ lightMode, toggleTheme }) {
  return (
    <div className="about-page about-page--compact">
      <HomeUpper
        lightMode={lightMode}
        toggleTheme={toggleTheme}
        compact
      />

      <div className="about-surface-layer">
        <div className="about-content">
          <div className="about-content-inner">
            <h1 className="about-title">
              About Us - BIT Mesra Institute Hall Booking System
            </h1>

            <div className="about-copy">
              <p>
                The BIT Mesra Institute Hall Booking System is a centralized digital platform designed to simplify and modernize the process of booking academic and non-academic halls within the campus of Birla Institute of Technology, Mesra, Ranchi. This system has been created specifically for faculty members, department heads (HODs), and administrative staff to manage hall reservations in an efficient, transparent, and conflict-free manner.
              </p>

              <p>
                Before the introduction of this platform, hall booking at BIT Mesra was handled entirely through manual email communication. Faculty members had to send emails to HODs or administrators requesting approval for specific halls on specific dates and time slots. In many cases, this process involved follow-up phone calls to ensure that the request was noticed and approved. While this method worked on a small scale, it became increasingly problematic as the number of booking requests grew.
              </p>

              <p>
                In real scenarios, multiple faculty members often requested the same hall for the same date, sometimes even for the same time slot. Since all requests were scattered across different email threads, administrators had to manually search through their inboxes to check whether a hall had already been approved for someone else. This was not only time-consuming but also highly error-prone. It was very easy to forget previous approvals, overlook certain emails, or accidentally approve conflicting bookings. Managing dozens of such requests every week through emails alone became mentally exhausting and practically unmanageable.
              </p>

              <p>
                The BIT Mesra Institute Hall Booking System solves this problem by providing a single, centralized platform where all booking activities are recorded and visible in real time. Faculty members can now view the availability status of each hall before sending a booking request. The system displays the next booked date and time for every hall and also provides a complete booking schedule in a clear table format, where rows represent halls and columns represent dates and time slots. This transparency itself reduces conflicts, as users can instantly see whether a hall is already booked and plan accordingly.
              </p>

              <p>
                When a faculty member submits a booking request, the administrator receives the request in three ways: on their dashboard within the system, on their email, and via SMS on their registered phone number. Each notification includes direct links that allow the administrator to approve or reject the request instantly without needing to manually log in every time. To further improve convenience, the administrator also receives a list of other booking requests for the same hall and date, making it easier to detect potential conflicts at a glance.
              </p>

              <p>
                Once a decision is made, the faculty member is automatically notified through both email and SMS. This ensures that there is no ambiguity or delay in communication. Both parties always remain informed about the current status of the booking, eliminating unnecessary follow-ups and confusion.
              </p>

              <p>
                The platform also includes powerful management tools for administrators. They can filter booking requests based on hall, date, status, or conflicts, allowing them to handle a large volume of requests efficiently. A built-in search feature makes it easy to locate specific halls or requests within seconds. Faculty members also benefit from similar search functionality on their dashboards, enabling them to quickly find hall information and availability.
              </p>

              <p>
                In addition to booking management, the system provides a direct contact directory containing phone numbers and email addresses of faculty members, HODs, and administrators. This allows users to communicate instantly whenever necessary, without searching through separate lists or directories.
              </p>

              <p>
                One of the most advanced features of this platform is the integrated AI Mode. This intelligent assistant helps users understand how to use the system through guided navigation, voice instructions, screenshots, and interactive explanations. Users can ask questions in natural language, either by typing or speaking, and the AI will guide them step by step through the required actions.
              </p>

              <p>
                Faculty members can even submit booking requests simply by speaking to the AI, specifying the hall name, date, and time slot. The AI processes the request and submits it automatically. Administrators can also interact with the AI to check for conflicts, review schedules, and approve or reject requests using voice commands, without performing any manual clicks. This reduces mental workload and allows complex administrative tasks to be completed in seconds through simple conversation.
              </p>

              <p className="about-copy-conclusion">
                Overall, the BIT Mesra Institute Hall Booking System transforms a previously chaotic and inefficient process into a streamlined, intelligent, and user-friendly digital experience. It reduces administrative burden, prevents booking conflicts, improves transparency, and ensures that hall management at BIT Mesra is accurate, fast, and future-ready.
              </p>
            </div>

            {teamProfiles.length > 0 ? (
              <section className="about-team-section" aria-labelledby="about-team-title">
                <div className="about-team-header">
                  <p className="about-team-eyebrow">People Behind The Platform</p>
                  <h2 className="about-team-title" id="about-team-title">
                    Developer &amp; Guide
                  </h2>
                  <p className="about-team-description">
                    The platform has been shaped through focused project development and academic guidance.
                  </p>
                </div>

                <div className="about-team-gallery">
                  {teamProfiles.map((profile, index) => (
                    <article
                      key={profile.badge}
                      className={`about-team-card ${index % 2 === 0 ? 'about-team-card--left' : 'about-team-card--right'}`}
                    >
                      <span className="about-team-badge">{profile.badge}</span>

                      <div className="about-team-avatar-shell">
                        <img
                          className="about-team-avatar"
                          src={profile.image}
                          alt={`${profile.name} profile`}
                          loading="lazy"
                        />
                      </div>

                      <div className="about-team-card-body">
                        <h3 className="about-team-name">{profile.name}</h3>
                        {profile.role ? <p className="about-team-role">{profile.role}</p> : null}

                        <div className="about-team-links">
                          {profile.profileUrl ? (
                            <a
                              className="about-team-link"
                              href={profile.profileUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <span className="about-team-link-icon">
                                <LinkedInIcon fontSize="small" />
                              </span>
                              <span className="about-team-link-text">
                                <span className="about-team-link-label">{profile.profileLabel}</span>
                                <span className="about-team-link-value">{profile.profileId}</span>
                              </span>
                              <ArrowOutwardRoundedIcon fontSize="small" />
                            </a>
                          ) : null}

                          {profile.email ? (
                            <a className="about-team-link" href={`mailto:${profile.email}`}>
                              <span className="about-team-link-icon">
                                <EmailOutlinedIcon fontSize="small" />
                              </span>
                              <span className="about-team-link-text">
                                <span className="about-team-link-label">Mail ID</span>
                                <span className="about-team-link-value">{profile.email}</span>
                              </span>
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>

        <HomeFooter />
      </div>
    </div>
  );
}

