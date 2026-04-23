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
  updateAccountSessionTimeout,
  verifyAccountEmailOtp
} from '../api/accountApi';
import './RoleAccountPage.css';

// Session timeout presets. "Month" is treated as 30 days and "Year" as 365 days to match backend.
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;
const DEFAULT_SESSION_TIMEOUT_MS = DAY_MS;

const SESSION_PRESETS = [
  { key: '1d', label: '1 day', ms: DAY_MS },
  { key: '1w', label: '1 week', ms: WEEK_MS },
  { key: '1m', label: '1 month', ms: MONTH_MS },
  { key: '1y', label: '1 year', ms: YEAR_MS },
  { key: 'custom', label: 'Custom (YY:MM:DD:HH)', ms: null }
];

const msToParts = (ms = 0) => {
  const totalHours = Math.max(0, Math.floor(Number(ms || 0) / HOUR_MS));
  const hoursPerYear = 365 * 24;
  const hoursPerMonth = 30 * 24;

  const years = Math.floor(totalHours / hoursPerYear);
  let remaining = totalHours - years * hoursPerYear;

  const months = Math.floor(remaining / hoursPerMonth);
  remaining -= months * hoursPerMonth;

  const days = Math.floor(remaining / 24);
  remaining -= days * 24;

  const hours = remaining;
  return { years, months, days, hours };
};

const partsToMs = (parts = {}) => {
  const years = Math.max(0, Math.floor(Number(parts.years || 0)));
  const months = Math.max(0, Math.floor(Number(parts.months || 0)));
  const days = Math.max(0, Math.floor(Number(parts.days || 0)));
  const hours = Math.max(0, Math.floor(Number(parts.hours || 0)));
  return years * YEAR_MS + months * MONTH_MS + days * DAY_MS + hours * HOUR_MS;
};

const humanizeParts = (parts = {}) => {
  const years = Math.max(0, Math.floor(Number(parts.years || 0)));
  const months = Math.max(0, Math.floor(Number(parts.months || 0)));
  const days = Math.max(0, Math.floor(Number(parts.days || 0)));
  const hours = Math.max(0, Math.floor(Number(parts.hours || 0)));

  const chunks = [];
  if (years) chunks.push(`${years} year${years === 1 ? '' : 's'}`);
  if (months) chunks.push(`${months} month${months === 1 ? '' : 's'}`);
  if (days) chunks.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) chunks.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (!chunks.length) return '0 hours';
  return chunks.join(' ');
};

const findPresetKeyForMs = (ms) => {
  const target = Math.floor(Number(ms || 0));
  const preset = SESSION_PRESETS.find((p) => p.ms && p.ms === target);
  return preset ? preset.key : 'custom';
};

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
  const [sessionPreset, setSessionPreset] = useState('1d');
  const [sessionCustom, setSessionCustom] = useState({ years: 0, months: 0, days: 0, hours: 0 });
  const [savingSessionTimeout, setSavingSessionTimeout] = useState(false);

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
      const resolvedName = String(acc.head || acc.name || '').trim();
      setProfile({ name: resolvedName, phone: acc.phone || '' });

      const rawMs = Number(acc.sessionTimeoutMs || 0);
      const resolvedMs = Number.isFinite(rawMs) && rawMs > 0 ? rawMs : DEFAULT_SESSION_TIMEOUT_MS;
      const presetKey = findPresetKeyForMs(resolvedMs);
      setSessionPreset(presetKey);
      setSessionCustom(msToParts(resolvedMs));
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

  const onSessionPresetChange = (value) => {
    const key = String(value || 'custom');
    setSessionPreset(key);

    const preset = SESSION_PRESETS.find((p) => p.key === key);
    if (preset && preset.ms) {
      setSessionCustom(msToParts(preset.ms));
    }
  };

  const setCustomField = (field, value) => {
    const num = value === '' ? '' : Number(value);
    setSessionCustom((prev) => ({
      ...prev,
      [field]: Number.isFinite(num) ? Math.max(0, Math.floor(num)) : 0
    }));
  };

  const saveSessionTimeout = async () => {
    if (savingSessionTimeout) return;

    try {
      setSavingSessionTimeout(true);

      let payload;
      if (sessionPreset !== 'custom') {
        payload = { preset: sessionPreset };
      } else {
        const ms = partsToMs(sessionCustom);
        if (!ms) {
          alert('Custom duration cannot be all zeros.');
          return;
        }
        payload = { preset: 'custom', custom: sessionCustom };
      }

      const res = await updateAccountSessionTimeout(role, payload);
      setAccount(res.account || account);

      const nextMs = Number(res?.account?.sessionTimeoutMs || 0) || DEFAULT_SESSION_TIMEOUT_MS;
      const nextPreset = findPresetKeyForMs(nextMs);
      setSessionPreset(nextPreset);
      setSessionCustom(msToParts(nextMs));

      alert('Session timeout updated. This session will now expire using the new timing.');
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to update session timeout.');
    } finally {
      setSavingSessionTimeout(false);
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
              <h2>Session Timeout</h2>
              <div className="role-account-summary">
                <p>
                  Choose how long you stay signed in on this device. Month = 30 days, Year = 365 days.
                </p>
              </div>

              <div className="role-account-form">
                <label className="role-account-input-label">Sign out after</label>
                <select
                  value={sessionPreset}
                  onChange={(e) => onSessionPresetChange(e.target.value)}
                >
                  {SESSION_PRESETS.map((preset) => (
                    <option key={preset.key} value={preset.key}>
                      {preset.label}
                    </option>
                  ))}
                </select>

                {sessionPreset === 'custom' && (
                  <>
                    <label className="role-account-input-label">Custom duration (YY : MM : DD : HH)</label>
                    <div className="role-account-duration-grid" role="group" aria-label="Custom session timeout">
                      <input
                        className="role-account-duration-input"
                        type="number"
                        min="0"
                        value={sessionCustom.years}
                        onChange={(e) => setCustomField('years', e.target.value)}
                        aria-label="Years"
                      />
                      <span className="role-account-duration-sep" aria-hidden="true">:</span>
                      <input
                        className="role-account-duration-input"
                        type="number"
                        min="0"
                        value={sessionCustom.months}
                        onChange={(e) => setCustomField('months', e.target.value)}
                        aria-label="Months"
                      />
                      <span className="role-account-duration-sep" aria-hidden="true">:</span>
                      <input
                        className="role-account-duration-input"
                        type="number"
                        min="0"
                        value={sessionCustom.days}
                        onChange={(e) => setCustomField('days', e.target.value)}
                        aria-label="Days"
                      />
                      <span className="role-account-duration-sep" aria-hidden="true">:</span>
                      <input
                        className="role-account-duration-input"
                        type="number"
                        min="0"
                        value={sessionCustom.hours}
                        onChange={(e) => setCustomField('hours', e.target.value)}
                        aria-label="Hours"
                      />
                    </div>
                    <div className="role-account-duration-help">
                      Example: 0 : 0 : 2 : 22 means 2 days 22 hours.
                    </div>
                  </>
                )}

                <div className="role-account-duration-preview">
                  Current selection: <span>{humanizeParts(sessionCustom)}</span>
                </div>

                <button type="button" onClick={saveSessionTimeout} disabled={savingSessionTimeout}>
                  {savingSessionTimeout ? 'Saving...' : 'Update Session Timeout'}
                </button>
              </div>
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
