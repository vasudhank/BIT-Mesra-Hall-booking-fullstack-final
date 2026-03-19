import "../AppBar/AppBar.css"
import * as React from 'react';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Menu from '@mui/material/Menu';
import Container from '@mui/material/Container';
import Avatar from '@mui/material/Avatar';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import Divider from '@mui/material/Divider';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useDispatch } from "react-redux";
import api from '../../../api/axiosInstance';
import { removeStatus } from "../../../store/slices/userSlice";
import QuickPageMenu from '../../Navigation/QuickPageMenu';
import {
  THEME_SYNC_EVENT,
  applyThemeToBody,
  readGlobalThemeMode,
  resolveEffectiveThemeMode,
  setPageThemeMode
} from '../../../utils/themeModeScope';

export default function DepartmentAppBar({
  showSearch = false,
  searchValue = "",
  onSearchChange,
  onSearchSubmit,
  showSort = false,
  sortValue = "",
  onSortChange,
  sortOptions = []
}) {

  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();

  const [anchorElUser, setAnchorElUser] = React.useState(null);
  const [dateTime, setDateTime] = React.useState("");
  const isMobileMenu = useMediaQuery('(max-width:900px)');
  const [isMobileSearchOpen, setIsMobileSearchOpen] = React.useState(false);
  const mobileSearchAreaRef = React.useRef(null);
  const [effectiveMode, setEffectiveMode] = React.useState(() =>
    resolveEffectiveThemeMode(location.pathname, readGlobalThemeMode())
  );

  const logout = async () => {
    try {
      await api.get('/logout', { withCredentials: true });
      dispatch(removeStatus());
      navigate('/department_login');
    } catch { }
  };

  React.useEffect(() => {
    const updateTime = () => {
      const now = new Date(
        new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
      );

      const days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
      const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

      setDateTime(
        `${days[now.getDay()]}, ${months[now.getMonth()]} ${String(now.getDate()).padStart(2, "0")}, ${now.getFullYear()} - ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")} IST`
      );
    };

    updateTime();
    const i = setInterval(updateTime, 1000);
    return () => clearInterval(i);
  }, []);

  const syncEffectiveMode = React.useCallback(() => {
    setEffectiveMode(resolveEffectiveThemeMode(location.pathname, readGlobalThemeMode()));
  }, [location.pathname]);

  React.useEffect(() => {
    syncEffectiveMode();
  }, [syncEffectiveMode]);

  React.useEffect(() => {
    const handleThemeSync = () => {
      syncEffectiveMode();
    };
    window.addEventListener(THEME_SYNC_EVENT, handleThemeSync);
    return () => {
      window.removeEventListener(THEME_SYNC_EVENT, handleThemeSync);
    };
  }, [syncEffectiveMode]);

  React.useEffect(() => {
    if (!isMobileMenu) {
      setIsMobileSearchOpen(false);
    }
  }, [isMobileMenu]);

  React.useEffect(() => {
    if (!isMobileMenu || !isMobileSearchOpen) return undefined;

    const handleOutsideSearch = (event) => {
      if (!mobileSearchAreaRef.current) return;
      if (!mobileSearchAreaRef.current.contains(event.target)) {
        setIsMobileSearchOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsMobileSearchOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideSearch);
    document.addEventListener('touchstart', handleOutsideSearch, { passive: true });
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleOutsideSearch);
      document.removeEventListener('touchstart', handleOutsideSearch);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isMobileMenu, isMobileSearchOpen]);

  const togglePageTheme = () => {
    const nextMode = effectiveMode === 'dark' ? 'light' : 'dark';
    setPageThemeMode(location.pathname, nextMode);
    applyThemeToBody(nextMode);
    setEffectiveMode(nextMode);
  };
  const themeActionLabel = effectiveMode === 'dark' ? 'LIGHT' : 'DARK';
  const themeShortcutLabel = effectiveMode === 'dark' ? 'Ctrl+L' : 'Ctrl+D';
  const mobileMenuTextColor = effectiveMode === 'dark' ? '#F8FAFC' : '#25354F';
  const mobileMenuDangerColor = effectiveMode === 'dark' ? '#FCA5A5' : '#D32F2F';
  const mobileMenuDividerColor = effectiveMode === 'dark' ? 'rgba(248, 250, 252, 0.28)' : 'rgba(37, 53, 79, 0.2)';
  const mobileMenuItemSx = isMobileMenu ? { minHeight: 42, justifyContent: 'center', px: 1.5 } : undefined;
  const getCompactSortLabel = (selected) => {
    const option = sortOptions.find((item) => item.value === selected);
    return option?.displayLabel || option?.label || '';
  };

  return (
    <AppBar position="fixed" className="appbar">
      <Container maxWidth="xl">
        <Toolbar 
          disableGutters 
          sx={{ 
            minHeight: { xs: 'auto', md: '64px' }, 
            py: { xs: 1, md: 0 },
            display: 'flex',
            justifyContent: 'space-between'
          }}
        >

          {/* ================= DESKTOP VIEW ================= */}
          <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', width: '100%' }}>
            <Typography
              variant="h4"
              className="text-appbar"
              sx={{ mr: 2, letterSpacing: '0.25rem', fontFamily: 'RecklessNeue' }}
            >
              DEPARTMENT
            </Typography>

            <Box sx={{ flexGrow: 1 }} />

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>

              {showSort && (
                <TextField
                  select
                  size="small"
                  value={sortValue}
                  onChange={(e) => onSortChange && onSortChange(e.target.value)}
                  SelectProps={{
                    renderValue: (selected) => getCompactSortLabel(selected)
                  }}
                  sx={{
                    minWidth: 185,
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '24px',
                      background: 'rgba(255,255,255,0.9)'
                    }
                  }}
                >
                  {sortOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              )}

              {/* 🔍 SEARCH BOX */}
              {showSearch && (
                <TextField
                  value={searchValue}
                  onChange={onSearchChange}
                  onKeyDown={(e) => e.key === 'Enter' && onSearchSubmit()}
                  placeholder="Search hall"
                  size="small"
                  sx={{
                    minWidth: 220,
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '24px',
                      background: 'rgba(255,255,255,0.9)'
                    }
                  }}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={onSearchSubmit}>
                          <SearchIcon />
                        </IconButton>
                      </InputAdornment>
                    )
                  }}
                />
              )}

              <Typography sx={{ fontSize: '0.85rem', whiteSpace: 'nowrap', color: 'white', fontFamily: 'Inter' }}>
                {dateTime}
              </Typography>

              <Tooltip title="Open settings">
                <IconButton onClick={(e) => setAnchorElUser(e.currentTarget)} sx={{ p: 0 }}>
                  <Avatar />
                </IconButton>
              </Tooltip>

            </Box>
          </Box>


          {/* ================= MOBILE VIEW (Stacked) ================= */}
          <Box sx={{ display: { xs: 'flex', md: 'none' }, flexDirection: 'column', width: '100%', gap: 1 }}>
            
            {/* ROW 1: DATE/TIME */}
            <Typography sx={{ 
              fontSize: '0.75rem', 
              whiteSpace: 'nowrap', 
              color: 'rgba(255,255,255,0.9)', 
              fontFamily: 'Inter',
              textAlign: 'center',
              width: '100%'
            }}>
              {dateTime}
            </Typography>

            {/* ROW 2: SEARCH + USER ICON */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, width: '100%' }}>
              {showSort && !isMobileSearchOpen && (
                <TextField
                  select
                  size="small"
                  value={sortValue}
                  onChange={(e) => onSortChange && onSortChange(e.target.value)}
                  SelectProps={{
                    renderValue: (selected) => getCompactSortLabel(selected)
                  }}
                  sx={{
                    minWidth: 140,
                    maxWidth: 150,
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '20px',
                      background: 'rgba(255,255,255,0.95)',
                      height: '40px'
                    },
                    '& .MuiSelect-select': {
                      fontSize: '0.8rem',
                      py: 1
                    }
                  }}
                >
                  {sortOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              
              {showSearch ? (
                isMobileSearchOpen ? (
                  <Box ref={mobileSearchAreaRef} sx={{ flexGrow: 1 }}>
                    <TextField
                      value={searchValue}
                      onChange={onSearchChange}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onSearchSubmit && onSearchSubmit();
                        }
                      }}
                      placeholder="Search hall"
                      size="small"
                      fullWidth
                      autoFocus
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          borderRadius: '24px',
                          background: 'rgba(255,255,255,0.95)',
                          fontSize: '0.9rem',
                          height: '40px'
                        }
                      }}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              size="small"
                              onClick={() => onSearchSubmit && onSearchSubmit()}
                              aria-label="Search halls"
                            >
                              <SearchIcon fontSize="small" />
                            </IconButton>
                          </InputAdornment>
                        )
                      }}
                    />
                  </Box>
                ) : (
                  <Box sx={{ flexGrow: 1, display: 'flex', justifyContent: 'flex-end' }}>
                    <IconButton
                      onClick={() => setIsMobileSearchOpen(true)}
                      aria-label="Open hall search"
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        color: '#ffffff',
                        background: 'rgba(255,255,255,0.12)',
                        border: '1px solid rgba(255,255,255,0.28)',
                        '&:hover': {
                          background: 'rgba(255,255,255,0.2)'
                        }
                      }}
                    >
                      <SearchIcon fontSize="small" />
                    </IconButton>
                  </Box>
                )
              ) : <Box sx={{ flexGrow: 1 }} />}

              {/* User Icon on Right */}
              <Tooltip title="Open settings">
                <IconButton onClick={(e) => setAnchorElUser(e.currentTarget)} sx={{ p: 0, ml: 1 }}>
                  <Avatar sx={{ width: 35, height: 35 }} />
                </IconButton>
              </Tooltip>

            </Box>
          </Box>

          {/* SHARED MENU */}
          <Menu
            sx={{
              mt: '45px',
              ...(isMobileMenu
                ? {
                    '& .MuiPaper-root': {
                      backgroundColor: effectiveMode === 'dark' ? 'rgba(8, 12, 22, 0.96)' : 'rgba(255, 255, 255, 0.96)',
                      backdropFilter: 'blur(10px)',
                      color: mobileMenuTextColor,
                      border: effectiveMode === 'dark' ? '1px solid rgba(248, 250, 252, 0.18)' : '1px solid rgba(37, 53, 79, 0.14)',
                      borderRadius: '16px',
                      minWidth: '200px'
                    }
                  }
                : {})
            }}
            anchorEl={anchorElUser}
            anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            open={Boolean(anchorElUser)}
            onClose={() => setAnchorElUser(null)}
          >
            {isMobileMenu && (
              <MenuItem onClick={() => { setAnchorElUser(null); navigate('/department/booking'); }} sx={mobileMenuItemSx}>
                <Typography textAlign="center" className="dropdown-text" sx={{ width: '100%', color: mobileMenuTextColor }}>BOOKINGS</Typography>
              </MenuItem>
            )}
            <MenuItem onClick={() => setAnchorElUser(null)} sx={mobileMenuItemSx}>
              <Link to="/" style={{ textDecoration: 'none', color: 'inherit', width: '100%', display: 'flex', justifyContent: 'center' }}>
                <Typography textAlign="center" className="dropdown-text" sx={{ width: '100%', color: isMobileMenu ? mobileMenuTextColor : 'inherit' }}>HOME</Typography>
              </Link>
            </MenuItem>
            <MenuItem onClick={() => { setAnchorElUser(null); }} sx={{ color: isMobileMenu ? mobileMenuTextColor : 'black', ...mobileMenuItemSx }}>
               <Link to="/department/account" style={{ textDecoration: 'none', color: 'inherit', width: '100%', display: 'flex', justifyContent: 'center' }}>
                 <Typography textAlign="center" className="dropdown-text" sx={{ color: isMobileMenu ? mobileMenuTextColor : 'black' }}> ACCOUNTS </Typography>
               </Link>
            </MenuItem>
            <MenuItem
              disableRipple
              sx={{ px: 1.25, py: 0.8, width: '100%', display: 'flex', justifyContent: 'center', ...mobileMenuItemSx }}
            >
              <QuickPageMenu
                buttonLabel="MENU"
                className={isMobileMenu ? 'appbar-user-menu-root-mobile' : ''}
                buttonClassName={`appbar-user-menu-btn${isMobileMenu ? ' appbar-user-menu-btn-mobile' : ''}`}
                panelClassName="appbar-user-submenu-panel"
                itemClassName="appbar-user-submenu-item"
                hideThemeToggle
                align="left"
                includeKeys={['schedule', 'ai', 'notices', 'calendar', 'complaints', 'queries', 'feedback']}
                matchParentMenuWidth
                panelOffsetX={-10}
                closeParentMenu={() => setAnchorElUser(null)}
              />
            </MenuItem>
            <Divider sx={{ my: 0.3, borderColor: isMobileMenu ? mobileMenuDividerColor : undefined, borderBottomWidth: '1px', opacity: 1 }} />
            <MenuItem onClick={togglePageTheme} sx={{ color: isMobileMenu ? mobileMenuTextColor : 'black', ...mobileMenuItemSx }}>
              <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: isMobileMenu ? 'center' : 'space-between', gap: 1.2 }}>
                <Typography textAlign="center" className="dropdown-text" sx={{ width: isMobileMenu ? 'auto' : '100%', color: isMobileMenu ? mobileMenuTextColor : 'black' }}>
                  {themeActionLabel}
                </Typography>
                {!isMobileMenu && (
                  <Typography sx={{ color: '#64748b', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.02em' }}>
                    {themeShortcutLabel}
                  </Typography>
                )}
              </Box>
            </MenuItem>
            <MenuItem onClick={() => setAnchorElUser(null)} sx={mobileMenuItemSx}>
              <Typography
                className="dropdown-text"
                sx={{
                  color: isMobileMenu ? mobileMenuDangerColor : 'red',
                  fontWeight: 'bold',
                  width: '100%',
                  textAlign: 'center'
                }}
                onClick={logout}
              >
                LOGOUT
              </Typography>
            </MenuItem>
          </Menu>

        </Toolbar>
      </Container>
    </AppBar>
  );
}
