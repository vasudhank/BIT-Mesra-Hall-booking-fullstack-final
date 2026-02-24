import React, { useEffect, useState } from "react";
import "./DepartmentForgot.css";
import { useNavigate } from "react-router-dom";
import { departmentSendOtpApi, departmentResetPasswordApi, departmentVerifyOtpApi } from "../../api/departmentloginapi";
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

export default function DepartmentForgot() {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [timer, setTimer] = useState(0);
  const [success, setSuccess] = useState(false);

  const sendOtp = async () => {
    const res = await departmentSendOtpApi({ email });
    if (res?.data?.success) {
      setStep(2);
      setTimer(60);
      setOtpError("");
    }
  };

  const verifyOtp = async () => {
    try {
      const res = await departmentVerifyOtpApi({ email, otp });
      if (res.data.success) {
        setStep(3);
        setOtpError("");
      }
    } catch (err) {
      if (err.data?.msg === "OTP expired") {
        setOtpError("OTP Expired. Please click on Resend OTP.");
      } else {
        setOtpError("Wrong OTP. Please enter valid OTP.");
      }
    }
  };

  const resetPassword = async () => {
    if (password !== confirm) return;
    const res = await departmentResetPasswordApi({ email, otp, password });
    if (res?.data?.success) {
      setSuccess(true);
    }
  };

  useEffect(() => {
    if (timer > 0) {
      const t = setTimeout(() => setTimer(timer - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [timer]);

  const checks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password)
  };

  if (success) {
    return (
      <div className="forgot-body">
        <div className="success-card glass">
          <CheckCircleIcon className="tick-icon" />
          <h2>Success!</h2>
          <p>Your password has been updated.</p>
          <button autoFocus onClick={() => navigate("/department_login", { replace: true })}>
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="forgot-body">
      <div className="forgot-card glass">

        <div className="card-header">
          <h2>
            {step === 1 && "Reset Password"}
            {step === 2 && "Verify OTP"}
            {step === 3 && "Set New Password"}
          </h2>
          <div className="divider" />
        </div>

        {step === 1 && (
          <>
            <p className="subtitle">Enter your department email</p>
            <div className="input-group">
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <button onClick={sendOtp}>Send OTP</button>
          </>
        )}

        {step === 2 && (
          <>
            <p className="subtitle">We’ve sent a 6-digit OTP to your email</p>
            <div className="input-group">
              <input
                placeholder="Enter OTP"
                value={otp}
                onChange={e => setOtp(e.target.value)}
              />
            </div>
            <button onClick={verifyOtp}>Verify</button>

            {otpError && (
              <p style={{ color: "red", marginTop: "10px" }}>
                {otpError}
              </p>
            )}

            {timer > 0 ? (
              <p className="timer">Resend in {timer}s</p>
            ) : (
              <button className="link-btn" onClick={sendOtp}>
                Resend OTP
              </button>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <div className="pass-box">
              <input
                type={show ? "text" : "password"}
                placeholder="New password"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
              <span onClick={() => setShow(!show)}>
                {show ? <VisibilityOffIcon /> : <VisibilityIcon />}
              </span>
            </div>

            <div className="pass-box">
              <input
                type={show ? "text" : "password"}
                placeholder="Confirm password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
              />
            </div>

            <div className="rules">
              <div className={`rule ${checks.length && "ok"}`}>
                <span className="dot" /> At least 8 characters
              </div>
              <div className={`rule ${checks.upper && "ok"}`}>
                <span className="dot" /> One uppercase letter
              </div>
              <div className={`rule ${checks.lower && "ok"}`}>
                <span className="dot" /> One lowercase letter
              </div>
              <div className={`rule ${checks.number && "ok"}`}>
                <span className="dot" /> One number
              </div>
              <div className={`rule ${checks.special && "ok"}`}>
                <span className="dot" /> One special character
              </div>
            </div>

            <button
              onClick={resetPassword}
              disabled={
                !checks.length ||
                !checks.upper ||
                !checks.lower ||
                !checks.number ||
                !checks.special ||
                password !== confirm
              }
            >
              Update Password
            </button>
          </>
        )}

      </div>
    </div>
  );
}
