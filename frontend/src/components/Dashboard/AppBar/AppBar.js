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
import { Link, useNavigate, useLocation } from "react-router-dom";
import api from '../../../api/axiosInstance';
import { useDispatch } from "react-redux";
import { removeStatus } from "../../../store/slices/userSlice";

const pages = [
  ['Dashboard', '/admin/hall'],
  ['BOOKINGS', '/admin/booking'],
  ['DEPARTMENT', '/admin/department'],
  ['REQUESTS', '/admin/department/request']
];

export default function Appbar({
  showSearch = false,
  searchValue = "",
  onSearchChange,
  onSearchSubmit,
  searchPlaceholder = "Search"
}) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  // eslint-disable-next-line no-unused-vars
  const location = useLocation();

  const [anchorElNav, setAnchorElNav] = React.useState(null);
  const [anchorElUser, setAnchorElUser] = React.useState(null);
  const [dateTime, setDateTime] = React.useState("");

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

  const handleOpenNavMenu = (event) => { setAnchorElNav(event.currentTarget); };
  const handleOpenUserMenu = (event) => { setAnchorElUser(event.currentTarget); };
  const handleCloseNavMenu = () => { setAnchorElNav(null); };
  const handleCloseUserMenu = () => { setAnchorElUser(null); };

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
                  '& .MuiOutlinedInput-root': { borderRadius: '24px', background: 'rgba(255,255,255,0.9)' }
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
            <Typography sx={{ fontSize: '0.85rem', whiteSpace: 'nowrap', color: 'white', fontFamily: 'Inter' }}>
              {dateTime}
            </Typography>
            <Tooltip title="Open settings">
              <IconButton onClick={handleOpenUserMenu} sx={{ p: 0 }}>
                <Avatar />
              </IconButton>
            </Tooltip>
            <Menu
              sx={{ mt: '45px', color: 'white' }}
              id="menu-appbar"
              anchorEl={anchorElUser}
              anchorOrigin={{ vertical: 'top', horizontal: 'right', }}
              keepMounted
              transformOrigin={{ vertical: 'top', horizontal: 'right', }}
              open={Boolean(anchorElUser)}
              onClose={handleCloseUserMenu}
            >
              <MenuItem onClick={handleCloseUserMenu} sx={{ color: 'black' }}><Link to="/"><Typography textAlign="center" className="dropdown-text" sx={{ color: 'black' }}>HOME</Typography></Link></MenuItem>
              <MenuItem onClick={() => { handleCloseUserMenu(); navigate('/admin/contacts'); }} sx={{ color: 'black' }}>
                <Typography textAlign="center" className="dropdown-text" sx={{ color: 'black' }}>CONTACTS</Typography>
              </MenuItem>
              <MenuItem onClick={handleCloseUserMenu} sx={{ color: 'black' }}><Typography textAlign="center" className="dropdown-text" onClick={logout} sx={{ color: 'black' }}>LOGOUT</Typography></MenuItem>
            </Menu>
          </Box>


          {/* ================= MOBILE VIEW (xs to sm) ================= */}
          <Box sx={{ display: { xs: 'flex', md: 'none' }, flexDirection: 'column', width: '100%', gap: 0.5 }}>
            
            {/* ROW 1: Date & Time (Stacked on top) */}
            <Typography sx={{ 
              fontSize: '0.75rem', 
              color: 'rgba(255,255,255,0.9)', 
              fontFamily: 'Inter',
              textAlign: 'center',
              width: '100%'
            }}>
              {dateTime}
            </Typography>

            {/* ROW 2: Search Box + Hamburger (Horizontal) */}
            <Box sx={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              
              {/* Search Box */}
              {showSearch ? (
                <TextField
                  value={searchValue}
                  onChange={onSearchChange}
                  onKeyDown={(e) => e.key === 'Enter' && onSearchSubmit()}
                  placeholder={searchPlaceholder}
                  size="small"
                  fullWidth
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
                        <IconButton size="small" onClick={onSearchSubmit}><SearchIcon fontSize="small" /></IconButton>
                      </InputAdornment>
                    )
                  }}
                />
              ) : <Box sx={{flexGrow:1}}/>}

              {/* Hamburger Menu (Inside AppBar on Mobile) */}
              <Box>
                <IconButton
                  size="large"
                  aria-label="account of current user"
                  aria-controls="menu-appbar"
                  aria-haspopup="true"
                  onClick={handleOpenNavMenu}
                  color="inherit"
                  sx={{ ml: 1 }}
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
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      backdropFilter: 'blur(10px)',
                      borderRadius: '16px',
                      minWidth: '200px',
                      mt: 1
                    }
                  }}
                >
                  {pages.map(([label, path]) => (
                    <MenuItem key={label} onClick={() => { handleCloseNavMenu(); navigate(path); }}>
                      <Typography textAlign="center" className="dropdown-text" sx={{ width: '100%', fontWeight: 700, color: '#25354F' }}>{label}</Typography>
                    </MenuItem>
                  ))}
                  <Divider sx={{ my: 1 }} />
                  <MenuItem onClick={() => { handleCloseNavMenu(); navigate('/'); }}>
                    <Typography textAlign="center" className="dropdown-text" sx={{ width: '100%', color: '#25354F' }}>HOME</Typography>
                  </MenuItem>
                  <MenuItem onClick={() => { handleCloseNavMenu(); navigate('/admin/contacts'); }}>
                    <Typography textAlign="center" className="dropdown-text" sx={{ width: '100%', color: '#25354F' }}>CONTACTS</Typography>
                  </MenuItem>
                  <MenuItem onClick={() => { handleCloseNavMenu(); logout(); }}>
                    <Typography textAlign="center" className="dropdown-text" sx={{ width: '100%', color: '#d32f2f' }}>LOGOUT</Typography>
                  </MenuItem>
                </Menu>
              </Box>
            </Box>
          </Box>

        </Toolbar>
      </Container>
    </AppBar>
  );
}
