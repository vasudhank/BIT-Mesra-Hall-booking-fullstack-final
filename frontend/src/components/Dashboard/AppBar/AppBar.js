import "./AppBar.css"
import * as React from 'react';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Menu from '@mui/material/Menu';
import MenuIcon from '@mui/icons-material/Menu';
import Container from '@mui/material/Container';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import Divider from '@mui/material/Divider'; 
import useMediaQuery from '@mui/material/useMediaQuery';
import { Link, useNavigate, useLocation } from "react-router-dom";
import api from '../../../api/axiosInstance';
import { useDispatch } from "react-redux";
import { removeStatus } from "../../../store/slices/userSlice";
import QuickPageMenu from '../../Navigation/QuickPageMenu';
import {
  THEME_SYNC_EVENT,
  applyThemeToBody,
  readGlobalThemeMode,
  resolveEffectiveThemeMode,
  setPageThemeMode
} from '../../../utils/themeModeScope';

const pages = [
  ['Dashboard', '/admin/hall'],
  ['BOOKINGS', '/admin/booking'],
  ['DEPARTMENTS', '/admin/department'],
  ['REQUESTS', '/admin/department/request']
];

export default function Appbar({
  showSearch = false,
  searchValue = "",
  onSearchChange,
  onSearchSubmit,
  searchPlaceholder = "Search",
  mobileStripToggleVisible = false,
  onMobileStripToggle,
  mobileTopActions = [],
  mobileSearchExpandable = false,
  mobileSortVisible = false,
  mobileSortValue = "",
  onMobileSortChange,
  mobileSortOptions = [],
  collapsedMobile = false
}) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const [anchorElNav, setAnchorElNav] = React.useState(null);
  const [anchorElUser, setAnchorElUser] = React.useState(null);
  const [dateTime, setDateTime] = React.useState("");
  const isMobileMenu = useMediaQuery('(max-width:900px)');
  const [mobileSearchExpanded, setMobileSearchExpanded] = React.useState(false);
  const [effectiveMode, setEffectiveMode] = React.useState(() =>
    resolveEffectiveThemeMode(location.pathname, readGlobalThemeMode())
  );
  const mobileSearchAreaRef = React.useRef(null);
  const mobileSearchInputRef = React.useRef(null);
  const isCollapsedMobileMode = collapsedMobile && isMobileMenu;
  const isDarkMode = effectiveMode === 'dark';
  const appbarTextColor = isDarkMode ? '#f8fafc' : '#0f172a';
  const appbarTextSoft = isDarkMode ? 'rgba(226, 232, 240, 0.9)' : 'rgba(30, 41, 59, 0.9)';
  const searchSurface = isDarkMode ? 'rgba(15, 23, 42, 0.88)' : 'rgba(255, 255, 255, 0.96)';
  const searchBorder = isDarkMode ? 'rgba(148, 163, 184, 0.34)' : 'rgba(15, 23, 42, 0.16)';
  const searchTextColor = isDarkMode ? '#f8fafc' : '#0f172a';
  const searchPlaceholderColor = isDarkMode ? 'rgba(226, 232, 240, 0.72)' : 'rgba(30, 41, 59, 0.62)';
  const searchIconColor = isDarkMode ? '#e2e8f0' : '#475569';
  const menuSurface = isDarkMode ? '#0f1623' : '#ffffff';
  const menuBorder = isDarkMode ? 'rgba(148, 163, 184, 0.32)' : 'rgba(15, 23, 42, 0.14)';

  const searchInputSx = {
    '& .MuiOutlinedInput-root': {
      borderRadius: '24px',
      background: searchSurface,
      '& fieldset': {
        borderColor: searchBorder
      },
      '&:hover fieldset': {
        borderColor: searchBorder
      },
      '&.Mui-focused fieldset': {
        borderColor: searchIconColor
      },
      '& input': {
        color: searchTextColor,
        fontFamily: 'Inter',
        fontWeight: 500
      },
      '& input::placeholder': {
        color: searchPlaceholderColor,
        opacity: 1
      },
      '& .MuiSvgIcon-root': {
        color: searchIconColor
      }
    }
  };
  const normalizedMobileTopActions = React.useMemo(
    () =>
      Array.isArray(mobileTopActions)
        ? mobileTopActions.filter((action) => action && typeof action.label === 'string' && typeof action.onClick === 'function')
        : [],
    [mobileTopActions]
  );
  const shouldUseMobileExpandableSearch = isMobileMenu && showSearch && mobileSearchExpandable;

  const logout = async () => {
    try {
      await api.get('/logout', { withCredentials: true });
      dispatch(removeStatus());
      navigate('/admin_login');
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
    if (!shouldUseMobileExpandableSearch && mobileSearchExpanded) {
      setMobileSearchExpanded(false);
    }
  }, [shouldUseMobileExpandableSearch, mobileSearchExpanded]);

  React.useEffect(() => {
    if (!mobileSearchExpanded) return;
    const timer = window.setTimeout(() => {
      mobileSearchInputRef.current?.focus?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mobileSearchExpanded]);

  React.useEffect(() => {
    if (!shouldUseMobileExpandableSearch || !mobileSearchExpanded) return;

    const handlePointerDownOutside = (event) => {
      if (!mobileSearchAreaRef.current?.contains(event.target)) {
        setMobileSearchExpanded(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDownOutside, true);
    document.addEventListener('touchstart', handlePointerDownOutside, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDownOutside, true);
      document.removeEventListener('touchstart', handlePointerDownOutside, true);
    };
  }, [shouldUseMobileExpandableSearch, mobileSearchExpanded]);

  const handleOpenNavMenu = (event) => { setAnchorElNav(event.currentTarget); };
  const handleOpenUserMenu = (event) => { setAnchorElUser(event.currentTarget); };
  const handleCloseNavMenu = () => { setAnchorElNav(null); };
  const handleCloseUserMenu = () => { setAnchorElUser(null); };
  const togglePageTheme = () => {
    const nextMode = effectiveMode === 'dark' ? 'light' : 'dark';
    setPageThemeMode(location.pathname, nextMode);
    applyThemeToBody(nextMode);
    setEffectiveMode(nextMode);
  };
  const themeActionLabel = effectiveMode === 'dark' ? 'LIGHT' : 'DARK';
  const themeShortcutLabel = effectiveMode === 'dark' ? 'Ctrl+L' : 'Ctrl+D';
  const mobileMenuTextColor = appbarTextColor;
  const mobileMenuDangerColor = effectiveMode === 'dark' ? '#FCA5A5' : '#D32F2F';
  const mobileMenuDividerColor = isDarkMode ? 'rgba(248, 250, 252, 0.26)' : 'rgba(37, 53, 79, 0.2)';
  const mobileMenuPaperSx = {
    backgroundColor: menuSurface,
    backdropFilter: 'blur(10px)',
    color: mobileMenuTextColor,
    border: `1px solid ${menuBorder}`,
    borderRadius: isCollapsedMobileMode ? '0 16px 16px 16px' : '16px',
    minWidth: '200px',
    mt: isCollapsedMobileMode ? 0 : 1
  };
  const desktopMenuPaperSx = {
    mt: '45px',
    '& .MuiPaper-root': {
      backgroundColor: menuSurface,
      color: mobileMenuTextColor,
      border: `1px solid ${menuBorder}`
    }
  };
  const mobileMenuContent = (
    <>
      {normalizedMobileTopActions.map((action) => (
        <MenuItem
          key={`mobile-top-action-${action.key || action.label}`}
          onClick={() => {
            handleCloseNavMenu();
            action.onClick();
          }}
        >
          <Typography textAlign="center" className="dropdown-text" sx={{ width: '100%', fontWeight: 700, color: mobileMenuTextColor }}>
            {action.label}
          </Typography>
        </MenuItem>
      ))}
      {normalizedMobileTopActions.length > 0 && (
        <Divider sx={{ my: 1, borderColor: mobileMenuDividerColor, borderBottomWidth: '1px', opacity: 1 }} />
      )}
      {pages.map(([label, path]) => (
        <MenuItem key={label} onClick={() => { handleCloseNavMenu(); navigate(path); }}>
          <Typography textAlign="center" className="dropdown-text" sx={{ width: '100%', fontWeight: 700, color: mobileMenuTextColor }}>{label}</Typography>
        </MenuItem>
      ))}
      <Divider sx={{ my: 1, borderColor: mobileMenuDividerColor, borderBottomWidth: '1px', opacity: 1 }} />
      <MenuItem onClick={() => { handleCloseNavMenu(); navigate('/'); }}>
        <Typography textAlign="center" className="dropdown-text" sx={{ width: '100%', color: mobileMenuTextColor }}>HOME</Typography>
      </MenuItem>
      <MenuItem
        disableRipple
        sx={{ px: 1.25, py: 0.8, width: '100%', display: 'flex', justifyContent: 'center' }}
      >
        <QuickPageMenu
          buttonLabel="MENU"
          className="appbar-user-menu-root-mobile"
          buttonClassName="appbar-user-menu-btn appbar-user-menu-btn-mobile"
          panelClassName="appbar-user-submenu-panel"
          itemClassName="appbar-user-submenu-item"
          hideThemeToggle
          align="left"
          includeKeys={['schedule', 'ai', 'contacts', 'notices', 'calendar', 'complaints', 'queries', 'feedback']}
          matchParentMenuWidth
          panelOffsetX={-10}
          closeParentMenu={handleCloseNavMenu}
        />
      </MenuItem>
      <MenuItem onClick={() => { handleCloseNavMenu(); navigate('/admin/account'); }}>
        <Typography textAlign="center" className="dropdown-text" sx={{ width: '100%', color: mobileMenuTextColor }}>ACCOUNTS</Typography>
      </MenuItem>
      <Divider sx={{ my: 0.4, borderColor: mobileMenuDividerColor, borderBottomWidth: '1px', opacity: 1 }} />
      <MenuItem onClick={togglePageTheme}>
        <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: isMobileMenu ? 'center' : 'space-between', gap: 1.2 }}>
          <Typography textAlign="center" className="dropdown-text" sx={{ width: isMobileMenu ? 'auto' : '100%', color: mobileMenuTextColor }}>
            {themeActionLabel}
          </Typography>
          {!isMobileMenu && (
            <Typography sx={{ color: isDarkMode ? 'rgba(226, 232, 240, 0.82)' : '#64748b', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.02em' }}>
              {themeShortcutLabel}
            </Typography>
          )}
        </Box>
      </MenuItem>
      <MenuItem onClick={() => { handleCloseNavMenu(); logout(); }}>
        <Typography textAlign="center" className="dropdown-text" sx={{ width: '100%', color: mobileMenuDangerColor }}>LOGOUT</Typography>
      </MenuItem>
    </>
  );

  if (isCollapsedMobileMode) {
    return (
      <>
        <button
          type="button"
          className="appbar-collapsed-launcher"
          onClick={handleOpenNavMenu}
          aria-label="Open user menu"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5l8 7-8 7z" />
          </svg>
        </button>
        <Menu
          id="menu-appbar-collapsed"
          anchorEl={anchorElNav}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          keepMounted
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          open={Boolean(anchorElNav)}
          onClose={handleCloseNavMenu}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiPaper-root': mobileMenuPaperSx
          }}
        >
          {mobileMenuContent}
        </Menu>
      </>
    );
  }

  return (
    <AppBar position="fixed" className="appbar">
      <Container maxWidth="xl">
        <Toolbar disableGutters sx={{ justifyContent: 'space-between', minHeight: { xs: 'auto', md: '64px' }, py: { xs: 1, md: 0 } }}>

          {/* ================= DESKTOP LOGO (Hidden on Mobile) ================= */}
          <Link to="/admin/hall">
            <Typography
              variant="h4"
              className="text-appbar"
              sx={{ mr: 2, display: { xs: 'none', md: 'flex' }, letterSpacing: '0.25rem', fontFamily: 'RecklessNeue' }}
            >
              ADMIN
            </Typography>
          </Link>

          {/* ================= DESKTOP NAV & USER (Hidden on Mobile) ================= */}
          <Box sx={{ flexGrow: 1, display: { xs: 'none', md: 'flex' }, justifyContent: 'center' }}>
            {pages.map(([label, path]) => (
              <Link key={label} to={path}>
                <Button
                  sx={{ my: 2, ml: 2, fontSize: '1.2rem', fontWeight: 'bold', fontFamily: 'RecklessNeue' }}
                  className="text-appbar"
                >
                  {label}
                </Button>
              </Link>
            ))}
          </Box>

          <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 2 }}>
            {showSearch && (
              <TextField
                value={searchValue}
                onChange={onSearchChange}
                onKeyDown={(e) => e.key === 'Enter' && onSearchSubmit()}
                placeholder={searchPlaceholder}
                size="small"
                sx={{
                  minWidth: 220,
                  ...searchInputSx
                }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={onSearchSubmit}><SearchIcon fontSize="small" /></IconButton>
                    </InputAdornment>
                  )
                }}
              />
            )}
            <Typography sx={{ fontSize: '0.85rem', whiteSpace: 'nowrap', color: appbarTextSoft, fontFamily: 'Inter' }}>
              {dateTime}
            </Typography>
            <Tooltip title="Open settings">
              <IconButton onClick={handleOpenUserMenu} sx={{ p: 0 }}>
                <Avatar />
              </IconButton>
            </Tooltip>
            <Menu
              sx={desktopMenuPaperSx}
              id="menu-appbar"
              anchorEl={anchorElUser}
              anchorOrigin={{ vertical: 'top', horizontal: 'right', }}
              keepMounted
              transformOrigin={{ vertical: 'top', horizontal: 'right', }}
              open={Boolean(anchorElUser)}
              onClose={handleCloseUserMenu}
            >
              <MenuItem onClick={handleCloseUserMenu} sx={{ color: mobileMenuTextColor }}><Link to="/" style={{ color: 'inherit', textDecoration: 'none' }}><Typography textAlign="center" className="dropdown-text" sx={{ color: 'inherit' }}>HOME</Typography></Link></MenuItem>
              <MenuItem onClick={() => { handleCloseUserMenu(); navigate('/admin/account'); }} sx={{ color: mobileMenuTextColor }}>
                <Typography textAlign="center" className="dropdown-text" sx={{ color: 'inherit' }}>ACCOUNTS</Typography>
              </MenuItem>
              <MenuItem onClick={handleCloseUserMenu} sx={{ color: mobileMenuTextColor }}>
                <Typography
                  textAlign="center"
                  className="dropdown-text"
                  onClick={logout}
                  sx={{ color: mobileMenuDangerColor, fontWeight: 700 }}
                >
                  LOGOUT
                </Typography>
              </MenuItem>
              <MenuItem disableRipple sx={{ px: 1.25, py: 0.8 }}>
                <QuickPageMenu
                  buttonLabel="MENU"
                  buttonClassName="appbar-user-menu-btn"
                  panelClassName="appbar-user-submenu-panel"
                  itemClassName="appbar-user-submenu-item"
                  hideThemeToggle
                  align="left"
                  includeKeys={['schedule', 'ai', 'contacts', 'notices', 'calendar', 'complaints', 'queries', 'feedback']}
                  matchParentMenuWidth
                  panelOffsetX={-10}
                  closeParentMenu={handleCloseUserMenu}
                />
              </MenuItem>
              <Divider sx={{ my: 0.3 }} />
              <MenuItem onClick={togglePageTheme} sx={{ color: mobileMenuTextColor }}>
                <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.2 }}>
                  <Typography textAlign="center" className="dropdown-text" sx={{ color: 'inherit' }}>
                    {themeActionLabel}
                  </Typography>
                  <Typography sx={{ color: isDarkMode ? 'rgba(226, 232, 240, 0.82)' : '#64748b', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.02em' }}>
                    {themeShortcutLabel}
                  </Typography>
                </Box>
              </MenuItem>
            </Menu>
          </Box>


          {/* ================= MOBILE VIEW (xs to sm) ================= */}
          <Box sx={{ display: { xs: 'flex', md: 'none' }, flexDirection: 'column', width: '100%', gap: 0.5 }}>
            
            {/* ROW 1: Date & Time (Stacked on top) */}
            <Typography sx={{ 
              fontSize: '0.75rem', 
              color: appbarTextSoft, 
              fontFamily: 'Inter',
              textAlign: 'center',
              width: '100%'
            }}>
              {dateTime}
            </Typography>

            {/* ROW 2: Search Box + Hamburger (Horizontal) */}
            <Box sx={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 0.25 }}>

              <Box ref={mobileSearchAreaRef} sx={{ display: 'flex', alignItems: 'center', flexGrow: 1, minWidth: 0, gap: 1 }}>
                {showSearch && mobileStripToggleVisible && typeof onMobileStripToggle === 'function' && (
                  <IconButton
                    className="appbar-mobile-strip-toggle"
                    onClick={onMobileStripToggle}
                    aria-label="Show controls"
                    title="Show controls"
                    size="small"
                  >
                    <span className="appbar-mobile-strip-toggle-icon" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" id="collapse-right">
                        <path d="M11,17a1,1,0,0,1-.71-1.71L13.59,12,10.29,8.71a1,1,0,0,1,1.41-1.41l4,4a1,1,0,0,1,0,1.41l-4,4A1,1,0,0,1,11,17Z"></path>
                        <path d="M15 13H5a1 1 0 0 1 0-2H15a1 1 0 0 1 0 2zM19 20a1 1 0 0 1-1-1V5a1 1 0 0 1 2 0V19A1 1 0 0 1 19 20z"></path>
                      </svg>
                    </span>
                  </IconButton>
                )}

                {/* Search Box */}
                {showSearch && shouldUseMobileExpandableSearch ? (
                  <>
                    <IconButton
                      size="small"
                      className="appbar-mobile-search-toggle"
                      onClick={() => setMobileSearchExpanded(true)}
                      aria-label="Open search"
                    >
                      <SearchIcon fontSize="small" />
                    </IconButton>

                    {mobileSearchExpanded ? (
                      <TextField
                        inputRef={mobileSearchInputRef}
                        value={searchValue}
                        onChange={onSearchChange}
                        onKeyDown={(e) => e.key === 'Enter' && onSearchSubmit()}
                        placeholder={searchPlaceholder}
                        size="small"
                        fullWidth
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          ...searchInputSx,
                          '& .MuiOutlinedInput-root': {
                            ...searchInputSx['& .MuiOutlinedInput-root'],
                            fontSize: '0.9rem',
                            height: '40px'
                          }
                        }}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <IconButton size="small" onClick={onSearchSubmit}>
                                <SearchIcon fontSize="small" />
                              </IconButton>
                            </InputAdornment>
                          )
                        }}
                      />
                    ) : (
                      mobileSortVisible &&
                      typeof onMobileSortChange === 'function' &&
                      Array.isArray(mobileSortOptions) &&
                      mobileSortOptions.length > 0 && (
                        <TextField
                          select
                          size="small"
                          value={mobileSortValue}
                          onChange={(event) => onMobileSortChange(event.target.value)}
                          className="appbar-mobile-sort-field"
                          SelectProps={{
                            renderValue: (selected) => {
                              const option = mobileSortOptions.find((item) => item.value === selected);
                              return option?.displayLabel || option?.label || '';
                            }
                          }}
                          sx={{
                            minWidth: 122,
                            maxWidth: 150,
                            flex: '0 0 auto',
                            '& .MuiOutlinedInput-root': {
                              borderRadius: '999px',
                              background: searchSurface,
                              '& fieldset': {
                                borderColor: searchBorder
                              },
                              '&:hover fieldset': {
                                borderColor: searchBorder
                              },
                              '&.Mui-focused fieldset': {
                                borderColor: searchIconColor
                              }
                            },
                            '& .MuiSelect-select': {
                              color: searchTextColor,
                              fontFamily: 'Inter',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              py: 0.62,
                              pr: 3.1,
                              pl: 1.25,
                              textAlign: 'center',
                              textAlignLast: 'center',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            },
                            '& .MuiSelect-icon': {
                              color: searchIconColor,
                              right: '8px',
                              fontSize: '1rem'
                            },
                            '& .MuiMenuItem-root': {
                              fontSize: '0.8rem'
                            }
                          }}
                        >
                          {mobileSortOptions.map((option) => (
                            <MenuItem key={option.value} value={option.value}>
                              {option.label}
                            </MenuItem>
                          ))}
                        </TextField>
                      )
                    )}
                  </>
                ) : showSearch ? (
                  <TextField
                    value={searchValue}
                    onChange={onSearchChange}
                    onKeyDown={(e) => e.key === 'Enter' && onSearchSubmit()}
                    placeholder={searchPlaceholder}
                    size="small"
                    fullWidth
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      ...searchInputSx,
                      '& .MuiOutlinedInput-root': {
                        ...searchInputSx['& .MuiOutlinedInput-root'],
                        fontSize: '0.9rem',
                        height: '40px'
                      }
                    }}
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={onSearchSubmit}><SearchIcon fontSize="small" /></IconButton>
                        </InputAdornment>
                      )
                    }}
                  />
                ) : <Box sx={{flexGrow:1}}/>}
              </Box>

              {/* Hamburger Menu (Inside AppBar on Mobile) */}
              <Box>
                <IconButton
                  size="large"
                  aria-label="account of current user"
                  aria-controls="menu-appbar"
                  aria-haspopup="true"
                  onClick={handleOpenNavMenu}
                  color="inherit"
                  sx={{ ml: 0 }}
                >
                  <MenuIcon fontSize="inherit" />
                </IconButton>
                <Menu
                  id="menu-appbar"
                  anchorEl={anchorElNav}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                  keepMounted
                  transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                  open={Boolean(anchorElNav)}
                  onClose={handleCloseNavMenu}
                  sx={{
                    display: { xs: 'block', md: 'none' },
                    '& .MuiPaper-root': {
                      ...mobileMenuPaperSx,
                      borderRadius: '16px',
                      mt: 1
                    }
                  }}
                >
                  {mobileMenuContent}
                </Menu>
              </Box>
            </Box>
          </Box>

        </Toolbar>
      </Container>
    </AppBar>
  );
}
