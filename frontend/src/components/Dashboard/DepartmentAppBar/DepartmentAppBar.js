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
import { Link, useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import api from '../../../api/axiosInstance';
import { removeStatus } from "../../../store/slices/userSlice";

export default function DepartmentAppBar({
  showSearch = false,
  searchValue = "",
  onSearchChange,
  onSearchSubmit
}) {

  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [anchorElUser, setAnchorElUser] = React.useState(null);
  const [dateTime, setDateTime] = React.useState("");

  const logout = async ()=> {
    try{
      await api.get('/logout',{ withCredentials:true });
      dispatch(removeStatus());
      navigate('/department_login');
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

  return (
    <AppBar position="fixed" className="appbar">
      <Container maxWidth="xl">
        <Toolbar disableGutters>

          <Typography
            variant="h4"
            className="text-appbar"
            sx={{ mr: 2, display: { xs: 'none', md: 'flex' }, letterSpacing: '0.25rem', fontFamily: 'RecklessNeue'}}
          >
            DEPARTMENT
          </Typography>

          <Box sx={{ flexGrow: 1 }} />

          <Box sx={{ display:'flex', alignItems:'center', gap:2.5 }}>

            {/* 🔍 SEARCH BOX */}
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

            <Typography sx={{ fontSize:'0.85rem', whiteSpace:'nowrap', color:'white', fontFamily:'Inter' }}>
              {dateTime}
            </Typography>

            <Tooltip title="Open settings">
              <IconButton onClick={(e)=>setAnchorElUser(e.currentTarget)} sx={{ p:0 }}>
                <Avatar />
              </IconButton>
            </Tooltip>

            <Menu
              sx={{ mt: '45px' }}
              anchorEl={anchorElUser}
              anchorOrigin={{ vertical:'top', horizontal:'right' }}
              transformOrigin={{ vertical:'top', horizontal:'right' }}
              open={Boolean(anchorElUser)}
              onClose={()=>setAnchorElUser(null)}
            >
              <MenuItem onClick={()=>setAnchorElUser(null)}>
                <Link to="/">
                  <Typography className="dropdown-text">HOME</Typography>
                </Link>
              </MenuItem>
              <MenuItem onClick={() => { setAnchorElUser(null); }} sx={{ color: 'black' }}> <Link to="/department/account" style={{ textDecoration: 'none', color: 'inherit' }}> <Typography textAlign="center" className="dropdown-text" sx={{ color: 'black' }}> ACCOUNTS </Typography> </Link> </MenuItem>
              <MenuItem onClick={()=>setAnchorElUser(null)}>
                <Typography className="dropdown-text" onClick={logout}>
                  LOGOUT
                </Typography>
              </MenuItem>
            </Menu>

          </Box>
        </Toolbar>
      </Container>
    </AppBar>
  );
}
