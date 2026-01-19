import React, { useState, useEffect } from 'react'
import "./DepartmentBooking.css"
import "../AdminHall/AdminHall.css"
import Grid from '@mui/material/Grid';
import { Container } from '@mui/material';
import DepartmentAppBar from '../DepartmentAppBar/DepartmentAppBar';
import DepartmentBookingCard from './DepartmentBookingCard';
import Backdrop from '@mui/material/Backdrop';
import CircularProgress from '@mui/material/CircularProgress';
import api from '../../../api/axiosInstance';

export default function DepartmentBooking() {

  const [halls, setHalls] = useState([]);              // 🔥 ALL halls
  const [filteredHalls, setFilteredHalls] = useState([]); // 🔥 visible halls
  const [open, setOpen] = useState(true);

  /* 🔍 SEARCH STATE */
  const [searchValue, setSearchValue] = useState("");

  const get_halls = async () => {
    setOpen(true);
    try {
      const response = await api.get(
        `/hall/view_halls`,
        { withCredentials: true }
      );

      const all = response.data.halls || [];
      setHalls(all);
      setFilteredHalls(all);
    } catch (err) {
      console.log(err);
    }
    setOpen(false);
  };

  useEffect(() => {
    get_halls();
  }, []);

  /* ===============================
      🔍 SAME LOGIC AS ADMIN (CLIENT SIDE)
      =============================== */

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchValue(val);

    // 🔥 LIVE CLEAR
    if (val.trim() === "") {
      setFilteredHalls(halls);
    }
  };

  const handleSearchSubmit = () => {
    const q = searchValue.toLowerCase();
    setFilteredHalls(
      halls.filter(h => h.name.toLowerCase().includes(q))
    );
  };

  return (
    <>
      <Backdrop
        sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }}
        open={open}
      >
        <CircularProgress color="inherit" />
      </Backdrop>

      <div className='department-booking-body'>

        <DepartmentAppBar
          showSearch={true}
          searchValue={searchValue}
          onSearchChange={handleSearchChange}
          onSearchSubmit={handleSearchSubmit}
        />

        {/* Title now sits below appbar */}
        <div className='department-booking-title'>
          HALLS
        </div>

        {/* Card Container */}
        <Container sx={{ marginTop: '1rem', marginBottom: '1rem', padding: { xs: 0, sm: 2 } }}>
          <Grid container spacing={{ xs: 4, sm: 8, md: 10 }} justifyContent={'center'}>
            {filteredHalls.map(data => (
              <Grid
                item
                xs={12} // Full width on mobile (90-95vw handled by card width inside or padding)
                sm={7}
                md={5}
                lg={4}
                xl={4}
                key={data._id}
                display="flex" 
                justifyContent="center"
              >
                <DepartmentBookingCard
                  data={data}
                  gethall={get_halls}
                />
              </Grid>
            ))}
          </Grid>
        </Container>

      </div>
    </>
  );
}