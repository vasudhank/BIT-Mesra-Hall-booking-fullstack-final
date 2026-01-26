import './App.css';
import React, { useEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Route,
  Routes,
} from "react-router-dom";

import Home from './routes/Home';
import AdminLoginRoute from './routes/AdminLoginRoute';
import DepartmentLoginRoute from './routes/DepartmentLoginRoute';
import DepartmentRegisterRoute from './routes/DepartmentRegisterRoute';

import AdminHallRoute from './routes/AdminHallRoute';
import AdminBookingRoute from './routes/AdminBookingRoute';
import AdminDepartmentRoute from './routes/AdminDepartmentRoute';
import AdminDepartmentRequestRoute from './routes/AdminDepartmentRequestRoute';

import DepartmentBookingRoute from './routes/DepartmentBookingRoute';
import DepartmentHistoryRoute from './routes/DepartmentHistoryRoute';

import DepartmentAccount from './components/Dashboard/DepartmentAccount/DepartmentAccount';
import Schedule from './components/Schedule/Schedule';
import DepartmentForgot from './components/DepartmentForgot/DepartmentForgot';
import AdminForgot from './components/AdminForgot/AdminForgot';

// NEW IMPORT
import AdminApproveDepartment from './components/AdminApproveDepartment/AdminApproveDepartment';
import About from './routes/About'; // NEW
import FAQ from './routes/FAQ';

import { checkauth } from './store/slices/userSlice';
import { useDispatch } from 'react-redux';

function App() {
  const dispatch = useDispatch();

  // ✅ GLOBAL THEME STATE
  const [lightMode, setLightMode] = useState(
    () => localStorage.getItem("theme") !== "dark"
  );

  // ✅ Run ONCE on app load
  useEffect(() => {
    dispatch(checkauth());
  }, [dispatch]);

  // ✅ Apply Theme Globally to Body
  useEffect(() => {
    localStorage.setItem("theme", lightMode ? "light" : "dark");
    if (lightMode) {
      document.body.classList.remove('dark-mode');
      document.body.classList.add('light-mode');
    } else {
      document.body.classList.remove('light-mode');
      document.body.classList.add('dark-mode');
    }
  }, [lightMode]);

  const toggleTheme = () => setLightMode(!lightMode);

  return (
    <Router>
      <Routes>

        {/* ===== PUBLIC ROUTES ===== */}
        {/* Pass theme props to Home */}
        <Route path="/" element={<Home lightMode={lightMode} toggleTheme={toggleTheme} />} />
        <Route path="/about" element={<About />} /> {/* NEW */}
        <Route path="/faqs" element={<FAQ />} /> {/* NEW */}
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/admin_login" element={<AdminLoginRoute />} />
        <Route path="/department_login" element={<DepartmentLoginRoute />} />
        <Route path="/department_register" element={<DepartmentRegisterRoute />} />
        <Route path="/admin/forgot" element={<AdminForgot />} />
        <Route path="/department/forgot" element={<DepartmentForgot />} />
        <Route path="/department/account" element={<DepartmentAccount />} />

        {/* ===== NEW ADMIN EMAIL ACTION ROUTE (Publicly accessible with token) ===== */}
        <Route path="/admin/department/approve/:token" element={<AdminApproveDepartment />} />

        {/* ===== ADMIN PROTECTED ROUTES ===== */}
        <Route path="/admin/hall" element={<AdminHallRoute />} />
        <Route path="/admin/booking" element={<AdminBookingRoute />} />
        <Route path="/admin/department" element={<AdminDepartmentRoute />} />
        <Route path="/admin/department/request" element={<AdminDepartmentRequestRoute />} />

        {/* ===== DEPARTMENT PROTECTED ROUTES ===== */}
        <Route path="/department/booking" element={<DepartmentBookingRoute />} />
        <Route path="/department/booking/history" element={<DepartmentHistoryRoute />} />

      </Routes>
    </Router>
  );
}

export default App;