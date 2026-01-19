import React, { useEffect, useState } from 'react';
import "./AdminHall.css";

import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import { Container, Box, Modal, Typography, FormControl, Input, useMediaQuery, useTheme } from '@mui/material';

import Appbar from '../AppBar/AppBar';
import HallCard from './HallCard';

import api from '../../../api/axiosInstance';
import { createHallApi } from '../../../api/createhallapi';

export default function AdminHall() {

  /* ================= STATE ================= */
  const [halls, setHalls] = useState([]);
  const [filteredHalls, setFilteredHalls] = useState([]);
  const [search, setSearch] = useState("");

  // modal state
  const [modal, setModal] = useState(false);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");

  // Responsive Hooks
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  /* ================= API ================= */
  const get_halls = async () => {
    try {
      const res = await api.get('/hall/view_halls');
      setHalls(res.data.halls || []);
      setFilteredHalls(res.data.halls || []);
    } catch (error) {
      console.error('Failed to fetch halls:', error);
    }
  };

  useEffect(() => {
    get_halls();
  }, []);

  /* ================= SEARCH ================= */
  const onSearchChange = (e) => {
    const val = e.target.value;
    setSearch(val);
    if (val.trim() === "") setFilteredHalls(halls);
  };

  const onSearchSubmit = () => {
    const q = search.toLowerCase();
    setFilteredHalls(
      halls.filter(h => h.name.toLowerCase().includes(q))
    );
  };

  /* ================= MODAL ================= */
  const handleOpen = () => setModal(true);
  const handleClose = () => {
    setModal(false);
    setName("");
    setCapacity("");
  };

  /* ================= CREATE HALL ================= */
  const handleCreateHallSubmit = async (e) => {
    e.preventDefault();

    if (!name || !capacity) return;

    try {
      console.log('Creating hall:', { name, capacity });

      await createHallApi({
        name,
        capacity: Number(capacity),
      });

      handleClose();
      get_halls(); // refresh list
    } catch (err) {
      console.error('Create hall failed:', err);
    }
  };


  /* ================= UI ================= */
  return (
    <div className='admin-hall-body'>

      <Appbar
        showSearch={true}
        searchValue={search}
        onSearchChange={onSearchChange}
        onSearchSubmit={onSearchSubmit}
      />

      {/* ================= CREATE HALL MODAL ================= */}
      {/* Reduced mt for mobile to bring button closer to the taller appbar */}
      <Box sx={{ mt: isMobile ? 1 : 'var(--section-top-gap)' }}>

        <Modal
          open={modal}
          onClose={handleClose}
          aria-labelledby="create-hall-modal"
        >
          <Box className='modal'>
            <Typography
              className='modal-text'
              sx={{ mb: 2 }}
              variant="h6"
            >
              CREATE HALL
            </Typography>

            <form onSubmit={handleCreateHallSubmit}>
              <FormControl fullWidth>
                <Input
                  disableUnderline
                  placeholder="Hall Name"
                  required
                  value={name}
                  className='admin-input'
                  onChange={(e) => setName(e.target.value)}
                  sx={{ p: 2 }}
                />
              </FormControl>

              <FormControl fullWidth>
                <Input
                  disableUnderline
                  type="number"
                  placeholder="Capacity"
                  required
                  value={capacity}
                  className='admin-input'
                  onChange={(e) => setCapacity(e.target.value)}
                  sx={{ p: 2 }}
                />
              </FormControl>

              <Button
                fullWidth
                className='btn-admin-hall'
                type="button"                 // 👈 IMPORTANT
                onClick={handleCreateHallSubmit} // 👈 IMPORTANT
              >
                CREATE HALL
              </Button>
            </form>
          </Box>
        </Modal>

        {/* ================= CREATE BUTTON ================= */}
        <Grid
          container
          spacing={isMobile ? 0 : 2} // Remove spacing on mobile
          justifyContent={isMobile ? 'center' : 'flex-end'} // Center button on mobile
          sx={{ mt: 0, px: isMobile ? 1 : 0 }}
        >
          {/* Adjusted Grid sizes for Mobile (xs=12) vs Desktop (md=5) */}
          <Grid item xs={12} sm={6} md={5} lg={4} xl={3}>
            <Button
              fullWidth
              className='btn-admin-hall'
              onClick={handleOpen}
            >
              CREATE HALL
            </Button>
          </Grid>
        </Grid>
      </Box>

      {/* ================= HALL LIST ================= */}
      <Container maxWidth={false} sx={{ mt: 2, padding: isMobile ? '0 !important' : '' }}>
        <Grid container spacing={isMobile ? 3 : 6} justifyContent="center">
          {filteredHalls.map(h => (
            /* Modified Breakpoints: xs={12} forces full width on mobile */
            <Grid key={h._id} item xs={12} sm={7} md={5} lg={4} xl={4}>
              <HallCard data={h} gethall={get_halls} />
            </Grid>
          ))}
        </Grid>
      </Container>

    </div>
  );
}