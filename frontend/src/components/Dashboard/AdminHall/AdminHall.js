import React, { useEffect, useState } from 'react'
import "./AdminHall.css"
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import HallCard from './HallCard';
import { Container } from '@mui/material';
import Appbar from '../AppBar/AppBar';
import axios from 'axios';

export default function AdminHall() {

  const [halls, setHalls] = useState([]);
  const [filteredHalls, setFilteredHalls] = useState([]);
  const [search, setSearch] = useState("");

  const get_halls = async ()=>{
    const res = await axios.get(
      'http://localhost:8000/api/hall/view_halls',
      { withCredentials:true }
    );
    setHalls(res.data.halls || []);
    setFilteredHalls(res.data.halls || []);
  };

  useEffect(()=>{ get_halls(); }, []);

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

  return (
    <div className='admin-hall-body'>

      <Appbar
        showSearch={true}
        searchValue={search}
        onSearchChange={onSearchChange}
        onSearchSubmit={onSearchSubmit}
      />

      {/* 🔥 VERY SMALL GAP BELOW APPBAR */}
      <Grid
        container
        justifyContent="flex-end"
        sx={{ mt: 1 }}     // ← change this if needed
      >
        <Grid item xs={11} sm={5} md={4} lg={4} xl={3}>
          <Button fullWidth className='btn-admin-hall'>
            CREATE HALL
          </Button>
        </Grid>
      </Grid>

      <Container sx={{ mt: 2 }}>
        <Grid container spacing={6} justifyContent="center">
          {filteredHalls.map(h => (
            <Grid key={h._id} item xs={11} sm={7} md={5} lg={4} xl={4}>
              <HallCard data={h} gethall={get_halls}/>
            </Grid>
          ))}
        </Grid>
      </Container>

    </div>
  );
}
