import React, { useEffect, useState } from 'react';
import "./AdminDepartmentRequest.css";
import Appbar from '../AppBar/AppBar';
import Grid from '@mui/material/Grid';
import { Container, useMediaQuery, useTheme } from '@mui/material';
import api from '../../../api/axiosInstance';
import AdminDepartmentRequestCard from './AdminDepartmentRequestCard';
import Backdrop from '@mui/material/Backdrop';
import CircularProgress from '@mui/material/CircularProgress';

export default function AdminDepartmentRequest() {

  const [list, setlist] = useState([]); // Raw data
  const [filteredList, setFilteredList] = useState([]); // Displayed data
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState("");

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const handleClose = () => {
    setOpen(false);
  };

  /* ================= API CALL ================= */
  const get_department_requests = async () => {
    setOpen(true);
    try {
      const response = await api.get("/department/show_department_requests", {
        withCredentials: true
      });
      const data = response.data.requests || [];
      setlist(data);
      setFilteredList(data); // Initialize filtered list
    } catch (error) {
      console.log(error);
    }
    setOpen(false);
  };

  useEffect(() => {
    get_department_requests();
  }, []);

  /* ================= SEARCH LOGIC ================= */
  const onSearchChange = (e) => {
    const val = e.target.value;
    setSearch(val);
    // Auto-reset when cleared
    if (val.trim() === "") {
      setFilteredList(list);
    }
  };

  const onSearchSubmit = () => {
    if (!search.trim()) {
      setFilteredList(list);
      return;
    }
    const q = search.toLowerCase();
    const filtered = list.filter(req => 
      (req.department && req.department.toLowerCase().includes(q)) ||
      (req.head && req.head.toLowerCase().includes(q)) ||
      (req.email && req.email.toLowerCase().includes(q))
    );
    setFilteredList(filtered);
  };

  return (
    <>
      <Backdrop
        sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }}
        open={open}
        onClick={handleClose}
      >
        <CircularProgress color="inherit" />
      </Backdrop>

      <div className='admin-department-request-div'>

        <Appbar 
          showSearch={true}
          searchValue={search}
          onSearchChange={onSearchChange}
          onSearchSubmit={onSearchSubmit}
          searchPlaceholder="Search dept. , HOD, email..."
        />

        {/* Added margin-top for mobile to clear the stacked AppBar */}
        <Container maxWidth="xl" sx={{ mt: isMobile ? 12 : 10 }}>
          
          <Grid container justifyContent={'center'}>
            <Grid item xs={12}>
              <div className='admin-department-request-title-div'>
                <h2 className='admin-department-request-title'>DEPARTMENT&nbsp;&nbsp;&nbsp;REQUESTS</h2>
              </div>
            </Grid>
          </Grid>

          <Container sx={{ padding: isMobile ? '0 !important' : '' }}>
            <Grid container spacing={4} justifyContent={'center'} sx={{ marginTop: '1rem' }}>
              {filteredList.map((data, index) => {
                return (
                  <Grid item xs={12} sm={10} md={6} lg={4} key={data._id || index}>
                    <AdminDepartmentRequestCard data={data} getdepartment={get_department_requests} />
                  </Grid>
                );
              })}
              {filteredList.length === 0 && !open && (
                <h3 style={{ color: 'white', marginTop: '2rem', fontFamily: 'Inter', textAlign: 'center', width: '100%' }}>
                  No requests found.
                </h3>
              )}
            </Grid>
          </Container>

        </Container>
      </div>
    </>
  )
}