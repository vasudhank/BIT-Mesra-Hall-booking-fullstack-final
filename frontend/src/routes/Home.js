import React from 'react' 
import HomeUpper from '../components/HomeUpper/HomeUpper'
import HomeLower from '../components/HomeLower/HomeLower'

export default function Home({ lightMode, toggleTheme }) {

  return (
    <>
      <HomeUpper lightMode={lightMode} toggleTheme={toggleTheme} />
      <HomeLower lightMode={lightMode} />
    </>
  )
}