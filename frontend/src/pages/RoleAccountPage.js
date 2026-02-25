import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import {
  changeAccountPassword,
  getAccount,
  sendAccountEmailOtp,
  updateAccountProfile,
  verifyAccountEmailOtp
} from '../api/accountApi';
import './RoleAccountPage.css';

const checkPasswordStrength = (pwd = '') => ({
  length: pwd.length >= 8,
  lower: /[a-z]/.test(pwd),
  upper: /[A-Z]/.test(pwd),
  digit: /[0-9]/.test(pwd),
  special: /[!@#$%^&*()_+=[\]{};:'",.<>/?`~\\-]/.test(pwd)
});

const PASSWORD_REQUIREMENTS = [
  { key: 'length', text: 'At least 8 characters' },
  { key: 'lower', text: 'One lowercase letter (a-z)' },
  { key: 'upper', text: 'One uppercase letter (A-Z)' },
  { key: 'digit', text: 'One number (0-9)' },
  { key: 'special', text: 'One special character (!@#$...)' }
];

export default function RoleAccountPage({ role = 'admin', backPath = '/', title = 'Account' }) {
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState({
    name: '',
    email: '',
    phone: '',
    type: ''
  });
  const [profile, setProfile] = useState({ name: '', phone: '' });
  const [emailChange, setEmailChange] = useState({ newEmail: '', otp: '' });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const passwordChecks = useMemo(
    () => checkPasswordStrength(passwordForm.newPassword),
    [passwordForm.newPassword]
  );

  const isPasswordValid = Object.values(passwordChecks).every(Boolean);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getAccount(role);
      const acc = res?.account || {};
      setAccount(acc);
      setProfile({ name: acc.name || '', phone: acc.phone || '' });
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to load account');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const saveProfile = async (e) => {
    e.preventDefault();
    try {
      const res = await updateAccountProfile(role, profile);
      setAccount(res.account || account);
      alert('Profile updated.');
    } catch (err) {
      alert(err?.response?.data?.error || 'Profile update failed');
    }
  };

  const sendOtp = async () => {
    try {
      await sendAccountEmailOtp(role, { newEmail: emailChange.newEmail });
      alert('OTP sent to new email.');
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to send OTP');
    }
  };

  const verifyOtp = async () => {
    try {
      const res = await verifyAccountEmailOtp(role, emailChange);
      setAccount(res.account || account);
      setEmailChange({ newEmail: '', otp: '' });
      alert('Email updated.');
    } catch (err) {
      alert(err?.response?.data?.error || 'OTP verification failed');
    }
  };

  const updatePassword = async (e) => {
    e.preventDefault();
    if (!passwordForm.currentPassword || !passwordForm.newPassword) return;
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      alert('New password and confirm password do not match.');
      return;
    }
    if (!isPasswordValid) {
      alert('New password does not meet all requirements.');
      return;
    }
    try {
      await changeAccountPassword(role, {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
      alert('Password changed successfully.');
    } catch (err) {
      alert(err?.response?.data?.error || 'Password change failed');
    }
  };

  return (
    <div className="role-account-page">
      <div className="role-account-container">
        <Link className="role-account-back" to={backPath}>
          Back
        </Link>
        <h1>{title}</h1>

        {loading ? (
          <div className="role-account-card">Loading account...</div>
        ) : (
          <>
            <section className="role-account-card">
              <h2>Profile</h2>
              <div className="role-account-summary">
                <p>
                  <strong>Role:</strong> {account.type || '-'}
                </p>
                <p>
                  <strong>Email:</strong> {account.email || '-'}
                </p>
              </div>
              <form onSubmit={saveProfile} className="role-account-form">
                <label className="role-account-input-label">Name</label>
                <input
                  type="text"
                  value={profile.name}
                  onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Name"
                />

                <label className="role-account-input-label">Phone</label>
                <input
                  type="text"
                  value={profile.phone}
                  onChange={(e) => setProfile((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="Phone"
                />
                <button type="submit">Save Profile</button>
              </form>
            </section>

            <section className="role-account-card">
              <h2>Change Email</h2>
              <div className="role-account-form">
                <input
                  type="email"
                  value={emailChange.newEmail}
                  onChange={(e) => setEmailChange((prev) => ({ ...prev, newEmail: e.target.value }))}
                  placeholder="New Email"
                />
                <button type="button" onClick={sendOtp}>
                  Send OTP
                </button>
                <input
                  type="text"
                  value={emailChange.otp}
                  onChange={(e) => setEmailChange((prev) => ({ ...prev, otp: e.target.value }))}
                  placeholder="Enter OTP"
                />
                <button type="button" onClick={verifyOtp}>
                  Verify & Update Email
                </button>
              </div>
            </section>

            <section className="role-account-card">
              <h2>Change Password</h2>
              <form className="role-account-form" onSubmit={updatePassword}>
                <label className="role-account-input-label">Current Password</label>
                <div className="role-account-password-wrap">
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
                    placeholder="Current Password"
                  />
                  <button
                    type="button"
                    className="role-account-eye-btn"
                    onClick={() => setShowCurrentPassword((prev) => !prev)}
                    aria-label="Toggle current password visibility"
                  >
                    {showCurrentPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </button>
                </div>

                <label className="role-account-input-label">New Password</label>
                <div className="role-account-password-wrap">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                    placeholder="New Password"
                  />
                  <button
                    type="button"
                    className="role-account-eye-btn"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    aria-label="Toggle new password visibility"
                  >
                    {showNewPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </button>
                </div>

                <div className="role-account-password-checklist">
                  {PASSWORD_REQUIREMENTS.map((rule) => {
                    const ok = Boolean(passwordChecks[rule.key]);
                    return (
                      <div
                        key={rule.key}
                        className={`role-account-password-rule ${ok ? 'passed' : ''}`}
                      >
                        <span className="role-account-password-rule-icon" aria-hidden="true">
                          {ok ? <CheckCircleRoundedIcon fontSize="small" /> : <RadioButtonUncheckedRoundedIcon fontSize="small" />}
                        </span>
                        <span>{rule.text}</span>
                      </div>
                    );
                  })}
                </div>

                <label className="role-account-input-label">Confirm New Password</label>
                <div className="role-account-password-wrap">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                    placeholder="Confirm New Password"
                  />
                  <button
                    type="button"
                    className="role-account-eye-btn"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    aria-label="Toggle confirm password visibility"
                  >
                    {showConfirmPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </button>
                </div>
                <button type="submit">Update Password</button>
              </form>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
