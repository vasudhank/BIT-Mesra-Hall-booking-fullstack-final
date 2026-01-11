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

  const adminRowRef = useRef(null);
  const deptRowRef = useRef(null);

  /* ================= INTERSECTION OBSERVER ================= */

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: "-10% 0px",
      threshold: 0.5,
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

    if (adminRowRef.current) observer.observe(adminRowRef.current);
    if (deptRowRef.current) observer.observe(deptRowRef.current);

    return () => {
      if (adminRowRef.current) observer.unobserve(adminRowRef.current);
      if (deptRowRef.current) observer.unobserve(deptRowRef.current);
      observer.disconnect();
    };
  }, []);

  /* ================= ADMIN ANIMATIONS ================= */

  const adminAnimations = [adminAnim0, adminAnim1, adminAnim2];
  const [currentAdminAnim, setCurrentAdminAnim] = useState(0);
  const [nextAdminAnim, setNextAdminAnim] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const nextIndex =
        (currentAdminAnim + 1) % adminAnimations.length;

      setNextAdminAnim(nextIndex);

      setTimeout(() => {
        setCurrentAdminAnim(nextIndex);
        setNextAdminAnim(null);
      });
    }, 10000);

    return () => clearInterval(interval);
  }, [currentAdminAnim, adminAnimations.length]);

  /* ================= DEPARTMENT ANIMATIONS ================= */

  const departmentAnimations = [
    deptAnim0,
    deptAnim1,
    deptAnim2,
    deptAnim3,
  ];

  const [currentDeptAnim, setCurrentDeptAnim] = useState(0);
  const [nextDeptAnim, setNextDeptAnim] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const nextIndex =
        (currentDeptAnim + 1) % departmentAnimations.length;

      setNextDeptAnim(nextIndex);

      setTimeout(() => {
        setCurrentDeptAnim(nextIndex);
        setNextDeptAnim(null);
      });
    }, 10000);

    return () => clearInterval(interval);
  }, [currentDeptAnim, departmentAnimations.length]);

  /* ================= RENDER ================= */

  return (
    <>
      <Grid
        container
        spacing={2}
        direction="column"
        justifyContent="center"
        alignItems="stretch"
      >
        {/* ================= ADMIN ROW ================= */}
        <div ref={adminRowRef} className="scroll-row from-left">
          <Grid
            item
            xs={12}
            container
            alignItems="center"
            justifyContent="flex-start"
          >
            {/* Admin Card */}
            <Grid item xs={12} md={7}>
              <div className="home-card-scope">
              <div className="home-card pos-left">
              <Card elevation={0}
  sx={{
    background: "none",
    boxShadow: "none",
  }}>
                <CardContent>
                  <Typography
                    gutterBottom
                    variant="h4"
                    component="div"
                    className="text-card-home"
                    style={{ fontFamily: "RecklessNeue" }}
                  >
                    ADMIN
                  </Typography>

                  <Typography
                    variant="body1"
                    color="text.secondary"
                    className="text-card-home"
                    style={{ fontSize: "small", fontFamily: "Inter" }}
                  >
                    <FeatureList
                      features={[
                        { text: "Create and manage departments" },
                        { text: "Approve or reject booking requests" },
                        { text: "Manage hall availability and clearing" },
                      ]}
                    />
                  </Typography>
                </CardContent>

                <CardActions className="btn-card-home">
                  <Button size="small" className="btn-home-card-btn">
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

            {/* Admin Animation */}
            <Grid item xs={12} md={4}>
              <div className="lottie-admin-wrapper">
                {adminAnimations.map((anim, index) => (
                  <div
                    key={index}
                    className={`lottie-admin-slide ${
                      index === currentAdminAnim
                        ? "active"
                        : index === nextAdminAnim
                        ? "next"
                        : ""
                    }`}
                  >
                    <Lottie animationData={anim} loop />
                  </div>
                ))}
              </div>
            </Grid>
          </Grid>
        </div>

        {/* ================= DEPARTMENT ROW ================= */}
        <div ref={deptRowRef} className="scroll-row from-right">
          <Grid container spacing={2} alignItems="center">
            {/* Department Animation */}
            <Grid item xs={12} md={4}>
              <div className="lottie-dept-wrapper">
                {departmentAnimations.map((anim, index) => (
                  <div
                    key={index}
                    className={`lottie-dept-slide ${
                      index === currentDeptAnim
                        ? "active"
                        : index === nextDeptAnim
                        ? "next"
                        : ""
                    }`}
                  >
                    <Lottie animationData={anim} loop />
                  </div>
                ))}
              </div>
            </Grid>

            {/* Department Card */}
            
            <Grid item xs={12} md={7}>
              <div className="home-card-scope">
              <div className="home-card pos-right">
              <Card  sx={{
    background: "none",
    boxShadow: "none",
  }}>
                <CardContent className="right-text">
                  <Typography
                    gutterBottom
                    variant="h4"
                    component="div"
                    className="text-card-home"
                    style={{
                      fontFamily: "RecklessNeue",
                      paddingRight: "25px",
                    }}
                  >
                    DEPARTMENT
                  </Typography>

                  <Typography
                    variant="body1"
                    color="text.secondary"
                    className="text-card-home"
                    style={{
                      fontSize: "small",
                      fontFamily: "Inter",
                      paddingLeft: "280px",
                    }}
                  >
                    <FeatureList
                      features={[
                        { text: "Request login access for HODs" },
                        { text: "Book halls with one-click access" },
                        { text: "Track and manage past bookings" },
                      ]}
                    />
                  </Typography>
                </CardContent>

                <CardActions className="btn-card-home">
                  <Button size="small" className="btn-home-card-btn">
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
        </div>
      </Grid>
    </>
  );
}
