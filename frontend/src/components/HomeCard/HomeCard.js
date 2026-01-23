import React, { useState, useEffect, useRef } from "react";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import CardActions from "@mui/material/CardActions";
import "./HomeCard.css";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import Lottie from "lottie-react";
import FeatureList from "./FeatureList";

// --- Admin animations ---
import adminAnim0 from "../../assets/animations/Login and Sign up.json";
import adminAnim1 from "../../assets/animations/login success.json";
import adminAnim2 from "../../assets/animations/Network.json";

// --- Department animations ---
import deptAnim0 from "../../assets/animations/Authentication Lock Login.json";
import deptAnim1 from "../../assets/animations/Booking confirmation.json";
import deptAnim2 from "../../assets/animations/calendar booking meeting orange.json";
import deptAnim3 from "../../assets/animations/Calendar Booking.json";

export default function HomeCard() {
  const auth = useSelector((state) => state.user);

  // === REFS: Separated for mobile control ===
  const adminCardRef = useRef(null);
  const adminAnimRef = useRef(null);
  const deptCardRef = useRef(null);
  const deptAnimRef = useRef(null); 

  /* ================= INTERSECTION OBSERVER ================= */

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: "-15% 0px", // Trigger slightly before center
      threshold: 0.2, // Trigger when 20% visible
    };

    const obsCallback = (entries) => {
      entries.forEach((entry) => {
        const el = entry.target;
        if (entry.isIntersecting) {
          el.classList.add("in-view");
        } else {
          el.classList.remove("in-view");
        }
      });
    };

    const observer = new IntersectionObserver(obsCallback, options);

    if (adminCardRef.current) observer.observe(adminCardRef.current);
    if (adminAnimRef.current) observer.observe(adminAnimRef.current);
    if (deptCardRef.current) observer.observe(deptCardRef.current);
    if (deptAnimRef.current) observer.observe(deptAnimRef.current);

    return () => {
      if (adminCardRef.current) observer.unobserve(adminCardRef.current);
      if (adminAnimRef.current) observer.unobserve(adminAnimRef.current);
      if (deptCardRef.current) observer.unobserve(deptCardRef.current);
      if (deptAnimRef.current) observer.unobserve(deptAnimRef.current);
      observer.disconnect();
    };
  }, []);

  /* ================= ADMIN ANIMATIONS ================= */

  const adminAnimations = [adminAnim0, adminAnim1, adminAnim2];
  const [currentAdminAnim, setCurrentAdminAnim] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentAdminAnim((prev) => (prev + 1) % adminAnimations.length);
    }, 10000); // 10 seconds per slide

    return () => clearInterval(interval);
  }, [adminAnimations.length]);

  /* ================= DEPARTMENT ANIMATIONS ================= */

  const departmentAnimations = [
    deptAnim0,
    deptAnim1,
    deptAnim2,
    deptAnim3,
  ];

  const [currentDeptAnim, setCurrentDeptAnim] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentDeptAnim((prev) => (prev + 1) % departmentAnimations.length);
    }, 10000); // 10 seconds per slide

    return () => clearInterval(interval);
  }, [departmentAnimations.length]);

  /* ================= RENDER ================= */

  return (
    <>
      <Grid
        container
        spacing={2}
        direction="row"
        justifyContent="center"
        alignItems="stretch"
      >
        {/* ================= ADMIN SECTION ================= */}
        
        {/* 1. Admin Card */}
        <Grid 
          item 
          xs={12} 
          md={7} 
          ref={adminCardRef} 
          className="scroll-block mobile-center-trigger from-left-logic"
        >
          <div className="home-card-scope">
            <div className="home-card pos-left">
              <Card elevation={0} sx={{ background: "none", boxShadow: "none" }}>
                
                {/* Content Alignment Class: align-left */}
                <CardContent className="align-left">
                  <Typography
                    gutterBottom
                    variant="h2"
                    component="div"
                    className="text-card-title"
                  >
                    ADMIN
                  </Typography>

                  <div className="text-card-desc">
                    <FeatureList
                      features={[
                        { text: "Create and manage departments" },
                        { text: "Approve or reject booking requests" },
                        { text: "Manage hall availability and clearing" },
                      ]}
                    />
                  </div>
                </CardContent>

                <CardActions className="card-actions-wrapper align-left">
                  <Button size="large" className="btn-modern-card">
                    {auth.status === "Authenticated" &&
                    auth.user === "Admin" ? (
                      <Link to="/admin/hall">LOGIN HERE</Link>
                    ) : (
                      <Link to="/admin_login">LOGIN HERE</Link>
                    )}
                  </Button>
                </CardActions>
              </Card>
            </div>
          </div>
        </Grid>

        {/* 2. Admin Animation */}
        <Grid 
          item 
          xs={12} 
          md={4} 
          ref={adminAnimRef} 
          className="scroll-block mobile-center-trigger from-right-logic"
        >
          <div className="lottie-admin-wrapper">
            {adminAnimations.map((anim, index) => (
              <div
                key={index}
                className={`lottie-admin-slide ${
                  index === currentAdminAnim ? "active" : ""
                }`}
              >
                <Lottie animationData={anim} loop />
              </div>
            ))}
          </div>
        </Grid>

        {/* ================= DEPARTMENT SECTION ================= */}

        {/* 3. Department Animation */}
        <Grid 
          item 
          xs={12} 
          md={4} 
          ref={deptAnimRef} 
          className="mobile-hidden scroll-block desktop-dept-anim"
        >
          <div className="lottie-dept-wrapper">
            {departmentAnimations.map((anim, index) => (
              <div
                key={index}
                className={`lottie-dept-slide ${
                  index === currentDeptAnim ? "active" : ""
                }`}
              >
                <Lottie animationData={anim} loop />
              </div>
            ))}
          </div>
        </Grid>

        {/* 4. Department Card */}
        <Grid 
          item 
          xs={12} 
          md={7} 
          ref={deptCardRef} 
          className="scroll-block mobile-center-trigger from-left-logic-dept"
        >
          <div className="home-card-scope">
            <div className="home-card pos-right">
              <Card sx={{ background: "none", boxShadow: "none" }}>
                
                {/* Content Alignment Class: align-right */}
                <CardContent className="align-right">
                  <Typography
                    gutterBottom
                    variant="h2"
                    component="div"
                    className="text-card-title"
                  >
                    DEPARTMENT
                  </Typography>

                  <div className="text-card-desc" style={{ textAlign: 'right' }}>
                    <FeatureList
                      features={[
                        { text: "Request login access for HODs" },
                        { text: "Book halls with one-click access" },
                        { text: "Track and manage past bookings" },
                      ]}
                    />
                  </div>
                </CardContent>

                <CardActions className="card-actions-wrapper align-right">
                  <Button size="large" className="btn-modern-card">
                    {auth.status === "Authenticated" &&
                    auth.user === "Department" ? (
                      <Link to="/department/booking">LOGIN HERE</Link>
                    ) : (
                      <Link to="/department_login">LOGIN HERE</Link>
                    )}
                  </Button>
                </CardActions>
              </Card>
            </div>
          </div>
        </Grid>
      </Grid>
    </>
  );
}