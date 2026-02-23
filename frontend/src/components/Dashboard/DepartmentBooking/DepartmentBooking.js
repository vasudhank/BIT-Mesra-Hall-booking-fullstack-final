import React, { useEffect, useMemo, useState } from 'react';
import "./DepartmentBooking.css";
import "../AdminHall/AdminHall.css";
import Grid from '@mui/material/Grid';
import { Container } from '@mui/material';
import DepartmentAppBar from '../DepartmentAppBar/DepartmentAppBar';
import DepartmentBookingCard from './DepartmentBookingCard';
import Backdrop from '@mui/material/Backdrop';
import CircularProgress from '@mui/material/CircularProgress';
import api from '../../../api/axiosInstance';

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

export default function DepartmentBooking() {
  const [halls, setHalls] = useState([]);
  const [open, setOpen] = useState(true);
  const [searchValue, setSearchValue] = useState('');
  const [sortMode, setSortMode] = useState('NAME_ASC');

  const get_halls = async () => {
    setOpen(true);
    try {
      const response = await api.get('/hall/view_halls', { withCredentials: true });
      setHalls(response.data.halls || []);
    } catch (err) {
      console.log(err);
    }
    setOpen(false);
  };

  useEffect(() => {
    get_halls();
  }, []);

  const filteredHalls = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    const searched = !query
      ? [...halls]
      : halls.filter((hall) =>
          String(hall.name || '').toLowerCase().includes(query) ||
          String(hall.capacity || '').toLowerCase().includes(query) ||
          String(hall.status || '').toLowerCase().includes(query)
        );
    return searched.sort((a, b) => compareHalls(a, b, sortMode));
  }, [halls, searchValue, sortMode]);

  const handleSearchChange = (e) => setSearchValue(e.target.value);
  const handleSearchSubmit = () => undefined;

  return (
    <>
      <Backdrop sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }} open={open}>
        <CircularProgress color="inherit" />
      </Backdrop>

      <div className='department-booking-body'>
        <DepartmentAppBar
          showSearch={true}
          searchValue={searchValue}
          onSearchChange={handleSearchChange}
          onSearchSubmit={handleSearchSubmit}
          showSort={true}
          sortValue={sortMode}
          onSortChange={setSortMode}
          sortOptions={SORT_OPTIONS}
        />

        <div className='department-booking-title'>
          HALLS
        </div>

        <Container sx={{ marginTop: '1rem', marginBottom: '1rem', padding: { xs: 0, sm: 2 } }}>
          <Grid container spacing={{ xs: 4, sm: 8, md: 10 }} justifyContent={'center'}>
            {filteredHalls.map((data) => (
              <Grid
                item
                xs={12}
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
