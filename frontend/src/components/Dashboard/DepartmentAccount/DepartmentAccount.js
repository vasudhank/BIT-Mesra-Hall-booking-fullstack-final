import React, { useEffect, useState } from "react";
import {
  Container,
  Grid,
  Card,
  CardContent,
  Typography,
  FormControl,
  Input,
  Button,
  InputAdornment,
  Snackbar,
  Alert,
  Box,
  Divider,
  Avatar,
  Tooltip,
  IconButton,
  Menu,
  MenuItem,
  CircularProgress
} from "@mui/material";
import HttpsIcon from '@mui/icons-material/Https';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import BusinessIcon from '@mui/icons-material/Business';
import PersonIcon from '@mui/icons-material/Person';
import LocalPhoneOutlinedIcon from '@mui/icons-material/LocalPhoneOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import api from '../../../api/axiosInstance';
import { Link, useNavigate, useLocation } from "react-router-dom";
import '../../../pages/RoleAccountPage.css';

function checkPasswordStrength(pwd) {
  const checks = {
    length: pwd.length >= 8,
    lower: /[a-z]/.test(pwd),
    upper: /[A-Z]/.test(pwd),
    digit: /[0-9]/.test(pwd),
    special: /[!@#$%^&*()_+=[\]{};:'",.<>/?`~\\-]/.test(pwd)
  };
  const passed = Object.values(checks).every(Boolean);
  return { checks, passed };
}

export default function DepartmentAccount() {
  const [email, setEmail] = useState("");
  const [deptName, setDeptName] = useState("");
  const [hodName, setHodName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [phoneSaving, setPhoneSaving] = useState(false);

  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [isAuth, setIsAuth] = useState(false);

  const [setupToken, setSetupToken] = useState(null);
  const [isSetupMode, setIsSetupMode] = useState(false);

  const [curReadOnly, setCurReadOnly] = useState(true);

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [anchorElUser, setAnchorElUser] = useState(null);

  const [successOpen, setSuccessOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState("Password changed successfully");
  const [errMsg, setErrMsg] = useState("");
  const [errorOpen, setErrorOpen] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  const pwdState = checkPasswordStrength(newPwd);

  useEffect(() => {
    const tokenFromUrl = new URLSearchParams(location.search).get("token");

    const hydrateProfile = (department) => {
      setEmail(department?.email || "");
      setDeptName(department?.department || "");
      setHodName(department?.head || "");
      setPhone(department?.phone || "");
      setPhoneDraft(department?.phone || "");
    };

    if (tokenFromUrl) {
      api.post("/department/verify_setup_token", { token: tokenFromUrl })
        .then((res) => {
          if (res.data && res.data.success) {
            setSetupToken(tokenFromUrl);
            setIsSetupMode(true);
            hydrateProfile(res.data.department);
            setIsAuth(true);
          }
        })
        .catch(() => {
          api.post("/department/auto_login", { token: tokenFromUrl }, { withCredentials: true })
            .then((r) => {
              if (r.data && r.data.success && r.data.department) {
                hydrateProfile(r.data.department);
                setIsAuth(true);
                const newUrl = window.location.pathname;
                window.history.replaceState({}, document.title, newUrl);
              } else {
                setErrMsg(r.data?.message || "Token login failed");
                setErrorOpen(true);
                setIsAuth(false);
              }
            })
            .catch((err) => {
              const message = err.response?.data?.message || "Invalid or Expired Link";
              setErrMsg(message);
              setErrorOpen(true);
              setIsAuth(false);
            });
        });
    } else {
      (async () => {
        try {
          const res = await api.get("/department/me", { withCredentials: true });
          if (res.data && res.data.success && res.data.department) {
            hydrateProfile(res.data.department);
            setIsAuth(true);
          }
        } catch (err) {
          setEmail("");
          setDeptName("");
          setHodName("");
          setPhone("");
          setPhoneDraft("");
          setIsAuth(false);
        }
      })();
    }
  }, [location.search]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if ((!isSetupMode && !currentPwd) || !newPwd || !confirmPwd) {
      setErrMsg("Please fill all fields");
      setErrorOpen(true);
      return;
    }

    if (newPwd !== confirmPwd) {
      setErrMsg("New password and confirm password do not match");
      setErrorOpen(true);
      return;
    }

    if (!pwdState.passed) {
      setErrMsg("New password does not meet the minimum requirements");
      setErrorOpen(true);
      return;
    }

    try {
      if (isSetupMode) {
        const res = await api.post("/department/complete_setup", {
          token: setupToken,
          newPassword: newPwd
        });

        if (res.data.success) {
          setSuccessMsg("Account secured! Redirecting to login...");
          setSuccessOpen(true);
          setTimeout(() => {
            navigate("/department_login");
          }, 2000);
        }
      } else {
        const payload = { currentPassword: currentPwd, newPassword: newPwd };
        const res = await api.post("/department/change_password", payload, { withCredentials: true });

        if (res.data && res.data.success) {
          setSuccessMsg("Password changed successfully");
          setSuccessOpen(true);
          setCurrentPwd("");
          setNewPwd("");
          setConfirmPwd("");
          setCurReadOnly(true);
          setShowCurrent(false);
          setShowNew(false);
          setShowConfirm(false);
        } else {
          setErrMsg(res.data.message || "Failed to change password");
          setErrorOpen(true);
        }
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 401 && !isSetupMode) {
        setErrMsg("Please login before changing password");
        setErrorOpen(true);
        navigate("/department_login");
        return;
      }
      setErrMsg(err.response?.data?.message || err.message || "Operation failed");
      setErrorOpen(true);
    }
  };

  const canEditPhone = isAuth && !isSetupMode;

  const startPhoneEdit = () => {
    if (!canEditPhone) return;
    setPhoneDraft(phone || "");
    setIsEditingPhone(true);
  };

  const cancelPhoneEdit = () => {
    setPhoneDraft(phone || "");
    setIsEditingPhone(false);
  };

  const savePhone = async () => {
    if (!canEditPhone) return;
    const normalizedPhone = phoneDraft.replace(/\D/g, "").slice(0, 15);

    if (!/^\d{10,15}$/.test(normalizedPhone)) {
      setErrMsg("Phone number must contain 10 to 15 digits");
      setErrorOpen(true);
      return;
    }

    setPhoneSaving(true);
    try {
      const res = await api.post(
        "/department/update_phone",
        { phone: normalizedPhone },
        { withCredentials: true }
      );

      if (res.data?.success) {
        const updatedPhone = res.data.phone || normalizedPhone;
        setPhone(updatedPhone);
        setPhoneDraft(updatedPhone);
        setIsEditingPhone(false);
        setSuccessMsg("Phone number updated successfully");
        setSuccessOpen(true);
      } else {
        setErrMsg(res.data?.message || "Failed to update phone number");
        setErrorOpen(true);
      }
    } catch (err) {
      if (err.response?.status === 401) {
        setErrMsg("Please login before updating phone number");
        setErrorOpen(true);
        navigate("/department_login");
        return;
      }
      setErrMsg(err.response?.data?.message || "Failed to update phone number");
      setErrorOpen(true);
    } finally {
      setPhoneSaving(false);
    }
  };

  const passwordRules = [
    { key: 'length', text: 'At least 8 characters' },
    { key: 'lower', text: 'Lowercase letter (a-z)' },
    { key: 'upper', text: 'Uppercase letter (A-Z)' },
    { key: 'digit', text: 'Number (0-9)' },
    { key: 'special', text: 'Special character (!@#$%^&*)' },
  ];

  const handleOpenUserMenu = (event) => setAnchorElUser(event.currentTarget);
  const handleCloseUserMenu = () => setAnchorElUser(null);

  const logout = async () => {
    try {
      await api.get("/logout", { withCredentials: true });
    } catch (err) {
      console.warn("Logout request failed:", err);
    } finally {
      handleCloseUserMenu();
      navigate("/department_login");
    }
  };

  return (
    <div className="role-account-page">
      {!isSetupMode && (
        <Box sx={{ position: 'fixed', top: 8, right: 12, zIndex: 1400 }}>
          <Tooltip title="Open settings">
            <IconButton onClick={handleOpenUserMenu} sx={{ p: 0 }}>
              <Avatar alt="" src="" sx={{ color: 'black' }} />
            </IconButton>
          </Tooltip>

          <Menu
            sx={{ mt: '45px', color: 'white' }}
            id="menu-appbar"
            anchorEl={anchorElUser}
            anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
            keepMounted
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            open={Boolean(anchorElUser)}
            onClose={handleCloseUserMenu}
          >
            <MenuItem onClick={handleCloseUserMenu} sx={{ color: 'black' }}>
              <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
                <Typography textAlign="center" className="dropdown-text" sx={{ color: 'black' }}>
                  HOME
                </Typography>
              </Link>
            </MenuItem>

            <MenuItem onClick={handleCloseUserMenu} sx={{ color: 'black' }}>
              <Link to="/department/booking" style={{ textDecoration: 'none', color: 'inherit' }}>
                <Typography textAlign="center" className="dropdown-text" sx={{ color: 'black' }}>
                  DEPARTMENT
                </Typography>
              </Link>
            </MenuItem>

            <MenuItem onClick={() => { handleCloseUserMenu(); logout(); }} sx={{ color: 'black' }}>
              <Typography textAlign="center" className="dropdown-text" sx={{ color: 'black' }}>
                LOGOUT
              </Typography>
            </MenuItem>
          </Menu>
        </Box>
      )}

      <Container sx={{ mt: 8, pb: 4 }}>
        <Grid container justifyContent="center">
          <Grid item xs={11} sm={8} md={6} lg={5}>
            <Card
              sx={{
                borderRadius: 3,
                border: '1px solid rgba(125, 157, 212, 0.34)',
                boxShadow: '0 14px 34px rgba(2, 8, 23, 0.33)',
                background: 'rgba(51, 73, 112, 0.9)'
              }}
            >
              <CardContent sx={{ p: { xs: 2.4, sm: 3 }, color: '#ebf2ff' }}>
                <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
                  {isSetupMode ? "Secure Your Account" : "Account"}
                </Typography>

                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2.2 }}>
                  <AccountCircleIcon sx={{ fontSize: 40, mr: 1, color: isSetupMode ? '#1976d2' : 'inherit' }} />
                  <Box>
                    <Typography variant="subtitle1">{email || "-"}</Typography>
                    <Typography variant="caption" color="text.secondary">Logged-in email</Typography>
                  </Box>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Box sx={{ display: 'flex', gap: 2, mb: 2.2, flexWrap: 'wrap' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <BusinessIcon />
                    <Box>
                      <Typography variant="body2">{deptName || '-'}</Typography>
                      <Typography variant="caption" color="text.secondary">Department</Typography>
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PersonIcon />
                    <Box>
                      <Typography variant="body2">{hodName || '-'}</Typography>
                      <Typography variant="caption" color="text.secondary">Faculty Name</Typography>
                    </Box>
                  </Box>
                </Box>

                <Box
                  sx={{
                    p: 2,
                    borderRadius: 2.5,
                    border: '1px solid rgba(148, 163, 184, 0.28)',
                    background:' #30466d',
                    mb: 2
                  }}
                >
                  <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary', fontWeight: 600 }}>
                    Phone Number
                  </Typography>

                  <FormControl fullWidth>
                    <Input
                      disableUnderline
                      type="tel"
                      placeholder="Mobile number"
                      value={isEditingPhone ? phoneDraft : (phone || "")}
                      onChange={(e) => setPhoneDraft(e.target.value.replace(/\D/g, '').slice(0, 15))}
                      inputProps={{
                        maxLength: 15,
                        pattern: "[0-9]{10,15}",
                        readOnly: !isEditingPhone
                      }}
                      startAdornment={
                        <InputAdornment position="start">
                          <LocalPhoneOutlinedIcon sx={{ color: '#334155' }} />
                        </InputAdornment>
                      }
                      endAdornment={
                        !isEditingPhone && canEditPhone ? (
                          <InputAdornment position="end">
                            <Tooltip title="Edit phone number" arrow>
                              <IconButton
                                size="small"
                                onClick={startPhoneEdit}
                                aria-label="Edit phone number"
                                sx={{
                                  border: '1px solid rgba(37, 99, 235, 0.25)',
                                  color: '#2563eb',
                                  backgroundColor: 'rgba(37, 99, 235, 0.06)'
                                }}
                              >
                                <EditOutlinedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </InputAdornment>
                        ) : null
                      }
                      sx={{
                        border: '1px solid rgba(148, 163, 184, 0.35)',
                        borderRadius: 2,
                        backgroundColor: '#ffffff',
                        px: 1,
                        py: 0.9
                      }}
                    />
                  </FormControl>

                  {isEditingPhone ? (
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1.4 }}>
                      <Button
                        type="button"
                        variant="outlined"
                        size="small"
                        onClick={cancelPhoneEdit}
                        startIcon={<CloseRoundedIcon fontSize="small" />}
                        sx={{ textTransform: 'none', borderRadius: 1.8 }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="contained"
                        size="small"
                        onClick={savePhone}
                        disabled={phoneSaving}
                        startIcon={phoneSaving ? null : <SaveRoundedIcon fontSize="small" />}
                        sx={{ textTransform: 'none', borderRadius: 1.8 }}
                      >
                        {phoneSaving ? <CircularProgress size={16} color="inherit" /> : "Save"}
                      </Button>
                    </Box>
                  ) : (
                    <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                      {canEditPhone
                        ? "Use the pencil icon to edit your contact number."
                        : (isSetupMode
                          ? "Phone editing is available after login."
                          : "Login to edit phone number.")}
                    </Typography>
                  )}
                </Box>

                <Divider sx={{ my: 2 }} />

                <Typography variant="h6" sx={{ mb: 1 }}>
                  {isSetupMode ? "Set New Password" : "Change password"}
                </Typography>

                {!isAuth && !isSetupMode && (
                  <Box sx={{ mb: 2 }}>
                    <Alert severity="info">You must log in to change this account's password. <Link to="/department_login">Login</Link></Alert>
                  </Box>
                )}

                {(isAuth || isSetupMode) && (
                  <form onSubmit={handleSubmit} autoComplete="off" noValidate>
                    <input type="hidden" name="fakeusernameremembered" />

                    {!isSetupMode && (
                      <FormControl fullWidth sx={{ mb: 2 }}>
                        <Input
                          name="cur_pass_field"
                          disableUnderline
                          placeholder="Current password"
                          type={showCurrent ? "text" : "password"}
                          value={currentPwd}
                          onChange={(e) => setCurrentPwd(e.target.value)}
                          startAdornment={<InputAdornment position="start"><HttpsIcon /></InputAdornment>}
                          endAdornment={
                            <InputAdornment position="end">
                              <IconButton
                                aria-label="toggle current password visibility"
                                onClick={() => setShowCurrent((s) => !s)}
                                edge="end"
                                size="small"
                              >
                                {showCurrent ? <VisibilityOff /> : <Visibility />}
                              </IconButton>
                            </InputAdornment>
                          }
                          inputProps={{ autoComplete: "off" }}
                          sx={{ padding: "1rem" }}
                          required
                          readOnly={curReadOnly}
                          onFocus={() => {
                            setCurReadOnly(false);
                            setCurrentPwd("");
                          }}
                        />
                      </FormControl>
                    )}

                    <FormControl fullWidth sx={{ mb: 1 }}>
                      <Input
                        name="new_pass_field"
                        disableUnderline
                        placeholder={isSetupMode ? "Create new password" : "New password"}
                        type={showNew ? "text" : "password"}
                        value={newPwd}
                        onChange={(e) => setNewPwd(e.target.value)}
                        startAdornment={<InputAdornment position="start"><HttpsIcon /></InputAdornment>}
                        endAdornment={
                          <InputAdornment position="end">
                            <IconButton
                              aria-label="toggle new password visibility"
                              onClick={() => setShowNew((s) => !s)}
                              edge="end"
                              size="small"
                            >
                              {showNew ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        }
                        inputProps={{ autoComplete: "new-password" }}
                        sx={{ padding: "1rem" }}
                        required
                      />
                    </FormControl>

                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" sx={{ mb: 1 }}>Password requirements:</Typography>
                      <Box component="ul" sx={{ pl: 0, m: 0 }}>
                        {passwordRules.map((rule) => {
                          const ok = pwdState.checks[rule.key];
                          return (
                            <Box key={rule.key} component="li" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.6, listStyle: 'none' }}>
                              {ok ? (
                                <CheckCircleIcon sx={{ color: 'green', fontSize: 18 }} />
                              ) : (
                                <RadioButtonUncheckedIcon sx={{ color: 'rgba(0,0,0,0.3)', fontSize: 18 }} />
                              )}
                              <Typography variant="body2" sx={{ color: ok ? 'green' : 'inherit' }}>{rule.text}</Typography>
                            </Box>
                          );
                        })}
                      </Box>
                    </Box>

                    <FormControl fullWidth sx={{ mb: 2 }}>
                      <Input
                        name="conf_new_pass_field"
                        disableUnderline
                        placeholder="Confirm new password"
                        type={showConfirm ? "text" : "password"}
                        value={confirmPwd}
                        onChange={(e) => setConfirmPwd(e.target.value)}
                        startAdornment={<InputAdornment position="start"><HttpsIcon /></InputAdornment>}
                        endAdornment={
                          <InputAdornment position="end">
                            <IconButton
                              aria-label="toggle confirm password visibility"
                              onClick={() => setShowConfirm((s) => !s)}
                              edge="end"
                              size="small"
                            >
                              {showConfirm ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        }
                        inputProps={{ autoComplete: "new-password" }}
                        sx={{ padding: "1rem" }}
                        required
                      />
                    </FormControl>

                    <Button fullWidth type="submit" variant="contained" sx={{ py: 1 }}>
                      {isSetupMode ? "SECURE ACCOUNT & LOGIN" : "Change password"}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Container>

      <Snackbar open={successOpen} autoHideDuration={3000} onClose={() => setSuccessOpen(false)}>
        <Alert severity="success" onClose={() => setSuccessOpen(false)}>{successMsg}</Alert>
      </Snackbar>
      <Snackbar open={errorOpen} autoHideDuration={4000} onClose={() => setErrorOpen(false)}>
        <Alert severity="error" onClose={() => setErrorOpen(false)}>{errMsg}</Alert>
      </Snackbar>
    </div>
  );
}
