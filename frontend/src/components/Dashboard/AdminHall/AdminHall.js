import React, { useEffect, useMemo, useState } from 'react';
import "./AdminHall.css";

import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import {
  Container,
  Box,
  Modal,
  Typography,
  FormControl,
  Input,
  useMediaQuery,
  useTheme,
  Select,
  MenuItem,
  Checkbox
} from '@mui/material';

import Appbar from '../AppBar/AppBar';
import HallCard from './HallCard';

import api from '../../../api/axiosInstance';
import { createHallApi } from '../../../api/createhallapi';
import { clearHallApi } from '../../../api/clearhallapi';

const SORT_OPTIONS = [
  { value: 'NAME_ASC', label: 'Hall Name (A-Z)' },
  { value: 'NAME_DESC', label: 'Hall Name (Z-A)' },
  { value: 'CAPACITY_ASC', label: 'Capacity (Low-High)' },
  { value: 'CAPACITY_DESC', label: 'Capacity (High-Low)' },
  { value: 'STATUS_BOOKED_FIRST', label: 'Booked First' },
  { value: 'STATUS_NOT_BOOKED_FIRST', label: 'Not Booked First' }
];

const compareHalls = (a, b, mode) => {
  const nameA = String(a.name || '');
  const nameB = String(b.name || '');
  const capA = Number(a.capacity || 0);
  const capB = Number(b.capacity || 0);
  const filledA = a.status === 'Filled' ? 1 : 0;
  const filledB = b.status === 'Filled' ? 1 : 0;

  if (mode === 'CAPACITY_ASC') return capA - capB || nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  if (mode === 'CAPACITY_DESC') return capB - capA || nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  if (mode === 'NAME_DESC') return nameB.localeCompare(nameA, undefined, { numeric: true, sensitivity: 'base' });
  if (mode === 'STATUS_BOOKED_FIRST') return filledB - filledA || nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  if (mode === 'STATUS_NOT_BOOKED_FIRST') return filledA - filledB || nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
};

export default function AdminHall() {
  const [halls, setHalls] = useState([]);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState('NAME_ASC');
  const [selectedHallIds, setSelectedHallIds] = useState([]);
  const [showAppbar, setShowAppbar] = useState(true);
  const [showControlStrip, setShowControlStrip] = useState(true);
  const [appbarHeight, setAppbarHeight] = useState(64);

  const [modal, setModal] = useState(false);
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const get_halls = async () => {
    try {
      const res = await api.get('/hall/view_halls');
      setHalls(res.data.halls || []);
    } catch (error) {
      console.error('Failed to fetch halls:', error);
    }
  };

  useEffect(() => {
    get_halls();
  }, []);

  useEffect(() => {
    const valid = new Set(halls.map((hall) => hall._id));
    setSelectedHallIds((prev) => prev.filter((id) => valid.has(id)));
  }, [halls]);

  useEffect(() => {
    if (!showAppbar) return;

    const measureAppbar = () => {
      const appbar = document.querySelector('.appbar');
      if (appbar) {
        setAppbarHeight(Math.round(appbar.getBoundingClientRect().height));
      }
    };

    const rafId = requestAnimationFrame(measureAppbar);
    window.addEventListener('resize', measureAppbar);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', measureAppbar);
    };
  }, [showAppbar, isMobile]);

  const filteredHalls = useMemo(() => {
    const query = search.trim().toLowerCase();
    const searched = !query
      ? [...halls]
      : halls.filter((hall) =>
          String(hall.name || '').toLowerCase().includes(query) ||
          String(hall.capacity || '').toLowerCase().includes(query) ||
          String(hall.status || '').toLowerCase().includes(query)
        );
    return searched.sort((a, b) => compareHalls(a, b, sortMode));
  }, [halls, search, sortMode]);

  const onSearchChange = (e) => setSearch(e.target.value);
  const onSearchSubmit = () => undefined;

  const handleOpen = () => setModal(true);
  const handleClose = () => {
    setModal(false);
    setName('');
    setCapacity('');
  };

  const handleCreateHallSubmit = async (e) => {
    e.preventDefault();
    if (!name || !capacity) return;

    try {
      await createHallApi({
        name,
        capacity: Number(capacity)
      });
      handleClose();
      get_halls();
    } catch (err) {
      console.error('Create hall failed:', err);
    }
  };

  const toggleHallSelection = (id) => {
    setSelectedHallIds((prev) =>
      prev.includes(id) ? prev.filter((hallId) => hallId !== id) : [...prev, id]
    );
  };

  const allHallIds = halls.map((hall) => hall._id);
  const allFilledHallIds = halls.filter((hall) => hall.status === 'Filled').map((hall) => hall._id);
  const selectedSet = new Set(selectedHallIds);
  const allHallsSelected = allHallIds.length > 0 && allHallIds.every((id) => selectedSet.has(id));
  const allFilledSelected = allFilledHallIds.length > 0 && allFilledHallIds.every((id) => selectedSet.has(id));

  const toggleSelectAllHalls = () => {
    if (allHallsSelected) {
      setSelectedHallIds([]);
      return;
    }
    setSelectedHallIds(allHallIds);
  };

  const toggleSelectAllFilled = () => {
    if (allFilledSelected) {
      setSelectedHallIds((prev) => prev.filter((id) => !allFilledHallIds.includes(id)));
      return;
    }
    setSelectedHallIds((prev) => Array.from(new Set([...prev, ...allFilledHallIds])));
  };

  const selectedHalls = halls.filter((hall) => selectedHallIds.includes(hall._id));
  const selectedFilledHalls = selectedHalls.filter((hall) => hall.status === 'Filled');
  const allFilledHalls = halls.filter((hall) => hall.status === 'Filled');

  const vacateOneHall = async (hall) => clearHallApi({ name: hall.name });
  const deleteOneHall = async (hall) => api.delete(`/hall/delete_hall/${hall._id}`);

  const runBulk = async (items, runner, confirmMsg) => {
    if (!items.length) return;
    if (!window.confirm(confirmMsg)) return;

    try {
      await Promise.allSettled(items.map((item) => runner(item)));
      setSelectedHallIds([]);
      get_halls();
    } catch (err) {
      console.error(err);
    }
  };

  const handleVacateSelected = () =>
    runBulk(
      selectedFilledHalls,
      vacateOneHall,
      `Vacate ${selectedFilledHalls.length} selected filled hall(s)?`
    );

  const handleVacateAllFilled = () =>
    runBulk(
      allFilledHalls,
      vacateOneHall,
      `Vacate all filled halls (${allFilledHalls.length})?`
    );

  const handleDeleteSelected = () =>
    runBulk(
      selectedHalls,
      deleteOneHall,
      `Delete ${selectedHalls.length} selected hall(s)? This cannot be undone.`
    );

  const handleSingleVacate = async (hall) => {
    await vacateOneHall(hall);
    get_halls();
  };

  const handleSingleDelete = async (hall) => {
    if (!window.confirm(`Are you sure you want to delete ${hall.name}? This cannot be undone.`)) return;
    await deleteOneHall(hall);
    get_halls();
  };

  return (
    <div className={`admin-hall-body${!showAppbar ? ' admin-hall-appbar-hidden' : ''}`}>
      {showAppbar && (
        <Appbar
          showSearch={true}
          searchValue={search}
          onSearchChange={onSearchChange}
          onSearchSubmit={onSearchSubmit}
          mobileStripToggleVisible={!showControlStrip}
          onMobileStripToggle={() => setShowControlStrip(true)}
        />
      )}

      <Box className='admin-hall-controls-anchor' sx={{ mt: isMobile ? 1 : 'var(--section-top-gap)' }}>
        <Modal
          open={modal}
          onClose={handleClose}
          aria-labelledby="create-hall-modal"
        >
          <Box className='modal'>
            <Typography className='modal-text' sx={{ mb: 3 }} variant="h6">
              CREATE HALL
            </Typography>

            <form onSubmit={handleCreateHallSubmit}>
              <FormControl fullWidth sx={{ mb: 2 }}>
                <Input
                  disableUnderline
                  placeholder="Hall Name"
                  required
                  value={name}
                  className='admin-input'
                  onChange={(e) => setName(e.target.value)}
                  sx={{ p: 1 }}
                />
              </FormControl>

              <FormControl fullWidth sx={{ mb: 2 }}>
                <Input
                  disableUnderline
                  type="number"
                  placeholder="Capacity"
                  required
                  value={capacity}
                  className='admin-input'
                  onChange={(e) => setCapacity(e.target.value)}
                  sx={{ p: 1 }}
                />
              </FormControl>

              <Button
                fullWidth
                className='btn-admin-hall'
                type="button"
                onClick={handleCreateHallSubmit}
              >
                CREATE HALL
              </Button>
            </form>
          </Box>
        </Modal>

        {showControlStrip ? (
          <Box
            className='admin-hall-controls-strip'
            style={isMobile ? { top: `${showAppbar ? appbarHeight + 8 : 6}px` } : undefined}
          >
            <Box className='admin-hall-controls-left'>
              <label className='admin-hall-select-inline'>
                <Checkbox
                  size='small'
                  checked={allFilledSelected}
                  onChange={toggleSelectAllFilled}
                  sx={{ color: 'white', '&.Mui-checked': { color: '#00d4ff' } }}
                />
                Select All Filled ({allFilledHallIds.length})
              </label>

              <Button
                size='small'
                className='admin-hall-bulk-btn bulk-vacate'
                onClick={handleVacateSelected}
                disabled={selectedFilledHalls.length === 0}
              >
                Vacate Selected
              </Button>

              <Button
                size='small'
                className='admin-hall-bulk-btn bulk-vacate-all'
                onClick={handleVacateAllFilled}
                disabled={allFilledHalls.length === 0}
              >
                Vacate All Filled
              </Button>

              <label className='admin-hall-select-inline'>
                <Checkbox
                  size='small'
                  checked={allHallsSelected}
                  onChange={toggleSelectAllHalls}
                  sx={{ color: 'white', '&.Mui-checked': { color: '#00d4ff' } }}
                />
                Select All Halls ({allHallIds.length})
              </label>

              <Button
                size='small'
                className='admin-hall-bulk-btn bulk-delete'
                onClick={handleDeleteSelected}
                disabled={selectedHalls.length === 0}
              >
                Delete Selected
              </Button>
            </Box>

            <Box className='admin-hall-controls-right'>
              <Button
                size='small'
                className='admin-hall-viewport-btn'
                onClick={() => setShowAppbar((v) => !v)}
              >
                {showAppbar ? 'Hide Appbar' : 'Show Appbar'}
              </Button>

              <Button
                size='small'
                className='admin-hall-viewport-btn admin-hall-collapse-btn'
                onClick={() => setShowControlStrip(false)}
              >
                Collapse Strip
              </Button>

              <FormControl size='small' className='admin-hall-sort-control'>
                <Select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value)}
                  displayEmpty
                >
                  {SORT_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Button className='btn-admin-hall-create' onClick={handleOpen}>
                CREATE HALL
              </Button>
            </Box>
          </Box>
        ) : (
          (!isMobile || !showAppbar) && (
          <button
            className='admin-hall-strip-toggle-btn'
            style={{ top: showAppbar ? (isMobile ? 88 : 78) : 10 }}
            onClick={() => setShowControlStrip(true)}
            aria-label='Show hall controls'
            title='Show controls'
          >
            <span className='admin-hall-strip-toggle-icon' aria-hidden='true'>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" id="collapse-right">
                <path d="M11,17a1,1,0,0,1-.71-1.71L13.59,12,10.29,8.71a1,1,0,0,1,1.41-1.41l4,4a1,1,0,0,1,0,1.41l-4,4A1,1,0,0,1,11,17Z"></path>
                <path d="M15 13H5a1 1 0 0 1 0-2H15a1 1 0 0 1 0 2zM19 20a1 1 0 0 1-1-1V5a1 1 0 0 1 2 0V19A1 1 0 0 1 19 20z"></path>
              </svg>
            </span>
          </button>
          )
        )}
        {showControlStrip && <div className='admin-hall-controls-spacer' />}
      </Box>

      <Container maxWidth={false} sx={{ mt: 2, padding: isMobile ? '0 !important' : '' }}>
        <Grid container spacing={isMobile ? 3 : 6} justifyContent="center">
          {filteredHalls.map((hall) => (
            <Grid key={hall._id} item xs={12} sm={7} md={5} lg={4} xl={4}>
              <HallCard
                data={hall}
                gethall={get_halls}
                isSelected={selectedHallIds.includes(hall._id)}
                onToggleSelect={() => toggleHallSelection(hall._id)}
                onVacateHall={handleSingleVacate}
                onDeleteHall={handleSingleDelete}
              />
            </Grid>
          ))}
        </Grid>
      </Container>
    </div>
  );
}
