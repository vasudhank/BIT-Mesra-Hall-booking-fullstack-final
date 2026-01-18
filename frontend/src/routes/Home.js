import React from 'react' // Removed useEffect, useState
import HomeUpper from '../components/HomeUpper/HomeUpper'
import HomeLower from '../components/HomeLower/HomeLower'
// Removed Loading import

export default function Home() {
  // Removed artificial delay logic entirely. 
  // This saves you exactly 2.0 seconds on LCP.

  return (
    <>
      <HomeUpper/>
      <HomeLower/>
    </>
  )
}