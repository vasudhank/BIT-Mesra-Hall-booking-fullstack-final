import React, { useEffect, useRef, useState } from 'react'
import HomeUpper from '../components/HomeUpper/HomeUpper'
import HomeLower from '../components/HomeLower/HomeLower'

export default function Home({ lightMode, toggleTheme }) {
  const sectionTopRef = useRef(null);
  const [mobileHeaderExpanded, setMobileHeaderExpanded] = useState(false);

  useEffect(() => {
    const evaluate = () => {
      if (!sectionTopRef.current || window.innerWidth > 1364) {
        setMobileHeaderExpanded(false);
        return;
      }
      const sectionTop = sectionTopRef.current.getBoundingClientRect().top;
      setMobileHeaderExpanded(sectionTop <= 0);
    };

    evaluate();
    window.addEventListener('scroll', evaluate, { passive: true });
    window.addEventListener('resize', evaluate);

    return () => {
      window.removeEventListener('scroll', evaluate);
      window.removeEventListener('resize', evaluate);
    };
  }, []);

  return (
    <>
      <HomeUpper
        lightMode={lightMode}
        toggleTheme={toggleTheme}
        mobileHeaderExpanded={mobileHeaderExpanded}
      />
      <div ref={sectionTopRef} />
      <div>
        <HomeLower lightMode={lightMode} />
      </div>
    </>
  )
}
