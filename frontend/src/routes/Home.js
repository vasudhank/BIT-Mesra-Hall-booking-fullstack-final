import React, { useEffect, useRef, useState } from 'react'
import HomeUpper from '../components/HomeUpper/HomeUpper'
import HomeLower from '../components/HomeLower/HomeLower'

export default function Home({ lightMode, toggleTheme }) {
  const sectionTopRef = useRef(null);
  const [mobileHeaderExpanded, setMobileHeaderExpanded] = useState(false);
  const [mobileHeaderLocked, setMobileHeaderLocked] = useState(false);

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
    <>
      <HomeUpper
        lightMode={lightMode}
        toggleTheme={toggleTheme}
        mobileHeaderExpanded={mobileHeaderExpanded}
      />
      <div ref={sectionTopRef} className="section-top-anchor" />
      <div>
        <HomeLower lightMode={lightMode} />
      </div>
    </>
  )
}
