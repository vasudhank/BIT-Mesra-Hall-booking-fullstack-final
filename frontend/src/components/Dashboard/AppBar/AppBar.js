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
import { Link,useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import { useDispatch } from "react-redux";
import { removeStatus } from "../../../store/slices/userSlice";

export default function Appbar({
  showSearch = false,
  searchValue = "",
  onSearchChange,
  onSearchSubmit
}) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const [anchorElNav, setAnchorElNav] = React.useState(null);
  const [anchorElUser, setAnchorElUser] = React.useState(null);
  const [dateTime, setDateTime] = React.useState("");

  const logout = async ()=> {
    try{
      await axios.get('http://localhost:8000/api/logout',{ withCredentials:true });
      dispatch(removeStatus());
      navigate('/admin_login');
    } catch {}
  };

  React.useEffect(() => {
    const updateTime = () => {
      const now = new Date(
        new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
      );

      const days = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
      const months = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];

      setDateTime(
        `${days[now.getDay()]}, ${months[now.getMonth()]} ${String(now.getDate()).padStart(2,"0")}, ${now.getFullYear()} - ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")} IST`
      );
    };

    updateTime();
    const i = setInterval(updateTime, 1000);
    return () => clearInterval(i);
  }, []);

  const handleOpenNavMenu = (event) => { setAnchorElNav(event.currentTarget); }; const handleOpenUserMenu = (event) => { setAnchorElUser(event.currentTarget); }; const handleCloseNavMenu = () => { setAnchorElNav(null); }; const handleCloseUserMenu = () => { setAnchorElUser(null); };

  return (
    <AppBar position="fixed" className="appbar">
      <Container maxWidth="xl">
        <Toolbar disableGutters>

          {/* LEFT BRAND */}
          <Link to="/admin/hall">
            <Typography
              variant="h4"
              className="text-appbar"
              sx={{ mr: 2, display: { xs: 'none', md: 'flex' }, letterSpacing: '0.25rem', fontFamily: 'RecklessNeue'}}
            >
              ADMIN
            </Typography>
          </Link>

          {/* CENTER NAV */}
          <Box sx={{ flexGrow: 1, display: { xs: 'none', md: 'flex' } }}>
            {[
              ['Dashboard','/admin/hall'],
              ['BOOKINGS','/admin/booking'],
              ['DEPARTMENT','/admin/department'],
              ['REQUESTS','/admin/department/request']
            ].map(([label, path]) => (
              <Link key={label} to={path}>
                <Button
                  sx={{ my:2, ml:2, fontSize:'1.2rem', fontWeight:'bold', fontFamily:'RecklessNeue' }}
                  className="text-appbar"
                >
                  {label}
                </Button>
              </Link>
            ))}
          </Box>

          {/* RIGHT SECTION */}
          <Box sx={{ display:'flex', alignItems:'center', gap:2 }}>

            {/* 🔍 ADMIN HALL SEARCH ONLY */}
            {showSearch && (
              <TextField
                value={searchValue}
                onChange={onSearchChange}
                onKeyDown={(e)=> e.key === 'Enter' && onSearchSubmit()}
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

            {/* DATE TIME */}
            <Typography sx={{ fontSize:'0.85rem', whiteSpace:'nowrap', color:'white', fontFamily:'Inter' }}>
              {dateTime}
            </Typography>

            {/* USER */}
            <Tooltip title="Open settings">
              <IconButton onClick={(e)=>setAnchorElUser(e.currentTarget)} sx={{ p:0 }}>
                <Avatar />
              </IconButton>
            </Tooltip>

           <Menu sx={{ mt: '45px' , color:'white' }} id="menu-appbar" anchorEl={anchorElUser} anchorOrigin={{ vertical: 'top', horizontal: 'right', }} keepMounted transformOrigin={{ vertical: 'top', horizontal: 'right', }} open={Boolean(anchorElUser)} onClose={handleCloseUserMenu} > <MenuItem onClick={handleCloseUserMenu} sx={{color:'black'}}> <Link to="/"> <Typography textAlign="center" className="dropdown-text" sx={{color:'black'}}>HOME</Typography> </Link> </MenuItem> <MenuItem onClick={handleCloseUserMenu} sx={{color:'black'}}> <Typography textAlign="center" className="dropdown-text" onClick={logout} sx={{color:'black'}}>LOGOUT</Typography> </MenuItem> </Menu>

          </Box>
        </Toolbar>
      </Container>
    </AppBar>
  );
}
