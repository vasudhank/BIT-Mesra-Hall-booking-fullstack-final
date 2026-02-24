import React, { useRef } from 'react'
import HomeUpper from '../components/HomeUpper/HomeUpper'
import HomeLower from '../components/HomeLower/HomeLower'

export default function Home({ lightMode, toggleTheme }) {
  const sectionTopRef = useRef(null);

  return (
    <>
      <HomeUpper
        lightMode={lightMode}
        toggleTheme={toggleTheme}
      />
      <div ref={sectionTopRef} className="section-top-anchor" />
      <div>
        <HomeLower lightMode={lightMode} />
      </div>
    </>
  )
}
