import React, { useEffect, useState } from 'react';
import "./DepartmentHistory.css";
import axios from 'axios';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import DepartmentAppBar from '../DepartmentAppBar/DepartmentAppBar';

export default function DepartmentHistory() {
  const [list, setList] = useState([]);

  useEffect(() => {
    axios.get('http://localhost:8000/api/booking/department_history', {
      withCredentials: true
    }).then(res => {
      setList(res.data.history);
    });
  }, []);

  return (
    <div className='department-history-body'>
      <DepartmentAppBar />

      <div className='department-history-title'>
        YOUR BOOKINGS
      </div>

      <Grid container spacing={2} justifyContent="center">
        {list.map(b => (
          <Grid item xs={11} md={8} key={b._id}>
            <Card className='department-history-card'>
              <Typography variant="h6">{b.hall}</Typography>
              <Typography>{b.event}</Typography>

              <Typography
                style={{
                  color:
                    b.status === 'APPROVED' ? 'green' :
                    b.status === 'REJECTED' ? 'red' :
                    'orange'
                }}
              >
                Status: {b.status}
              </Typography>
            </Card>
          </Grid>
        ))}
      </Grid>
    </div>
  );
}
