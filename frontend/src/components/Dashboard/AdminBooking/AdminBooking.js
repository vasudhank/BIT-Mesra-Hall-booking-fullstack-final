import React, { useEffect, useState } from 'react';
import Appbar from '../AppBar/AppBar';
import "./AdminBooking.css";
import Grid from '@mui/material/Grid';
import AdminBookingCard from './AdminBookingCard';
import Backdrop from '@mui/material/Backdrop';
import CircularProgress from '@mui/material/CircularProgress';
import api from '../../../api/axiosInstance';
import { Container, useMediaQuery, useTheme } from '@mui/material';

export default function AdminBooking() {

  const [bookingRequests, setBookingRequests] = useState([]); // Store raw data
  const [filteredRequests, setFilteredRequests] = useState([]); // Store filtered data
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState("");

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const get_booking_requests = async () => {
    setOpen(true);
    try {
      const response = await api.get('/booking/show_booking_requests', {
        withCredentials: true
      });
      const data = response.data.booking_requests || [];
      setBookingRequests(data);
      setFilteredRequests(data); // Initialize filtered list with all data
      setOpen(false);
    } catch (err) {
      console.log(err);
      setOpen(false);
    }
  };

  useEffect(() => {
    get_booking_requests();
  }, []);

  /* ================= SEARCH LOGIC ================= */
  const onSearchChange = (e) => {
    const val = e.target.value;
    setSearch(val);
    
    // Auto-reset when cleared
    if (val.trim() === "") {
      setFilteredRequests(bookingRequests);
    }
  };

  const onSearchSubmit = () => {
    if (!search.trim()) {
      setFilteredRequests(bookingRequests);
      return;
    }
    const q = search.toLowerCase();
    const filtered = bookingRequests.filter(req => 
      req.hall.toLowerCase().includes(q) ||
      req.department.department.toLowerCase().includes(q) ||
      req.event.toLowerCase().includes(q)
    );
    setFilteredRequests(filtered);
  };

  return (
    <>
      <Backdrop
        sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }}
        open={open}
      >
        <CircularProgress color="inherit" />
      </Backdrop>

      <div className='admin-booking-body'>
        <Appbar 
          showSearch={true}
          searchValue={search}
          onSearchChange={onSearchChange}
          onSearchSubmit={onSearchSubmit}
        />

        {/* Added Margin Top to prevent overlap with fixed AppBar */}
        <Container maxWidth="xl" sx={{ mt: isMobile ? 12 : 10 }}> 
          
          <Grid container justifyContent={'center'}>
            <Grid item xs={12}>
              <div className='admin-booking-title-div'>
                <h2 className='admin-booking-title'>BOOKING&nbsp;&nbsp;&nbsp;REQUESTS</h2>
              </div>
            </Grid>
          </Grid>

          <Grid container spacing={4} justifyContent={'center'}>
            {filteredRequests.map((data) => (
              // Cards are vertically stacked (xs=11 or 12) and centered
              <Grid item xs={11} sm={10} md={6} lg={4} key={data._id} display="flex" justifyContent="center">
                <AdminBookingCard data={data} getrequest={get_booking_requests} />
              </Grid>
            ))}
            {filteredRequests.length === 0 && !open && (
              <h3 style={{ color: 'white', marginTop: '2rem', fontFamily: 'Inter' }}>No requests found.</h3>
            )}
          </Grid>

        </Container>
      </div>
    </>
  );
}