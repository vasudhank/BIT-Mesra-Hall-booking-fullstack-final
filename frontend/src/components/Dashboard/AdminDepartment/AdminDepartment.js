import React, { useEffect, useState } from 'react';
import Appbar from "../AppBar/AppBar";
import "./AdminDepartment.css";
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import { Container, useMediaQuery, useTheme } from '@mui/material';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { CardActionArea } from '@mui/material';
import Person2Icon from '@mui/icons-material/Person2';
import EmailIcon from '@mui/icons-material/Email';
import Backdrop from '@mui/material/Backdrop';
import CircularProgress from '@mui/material/CircularProgress';
import api from '../../../api/axiosInstance';
import Modal from '@mui/material/Modal';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import Input from '@mui/material/Input';
import { createDepartmentApi } from "../../../api/createdepartmentapi";


export default function AdminDepartment() {

  const [open, setOpen] = useState(true);
  const [list, setlist] = useState([]); // Raw data
  const [filteredList, setFilteredList] = useState([]); // Displayed data
  
  // Modal & Form State
  const [modal, setmodal] = useState(false);
  const [email, setemail] = useState("");
  const [password, setpassword] = useState('');
  const [department, setdepartment] = useState("");
  const [head, sethead] = useState('');
  
  // Search State
  const [search, setSearch] = useState("");

  // Responsive Hooks
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  /* ================= SEARCH LOGIC ================= */
  const onSearchChange = (e) => {
    const val = e.target.value;
    setSearch(val);
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
    const filtered = list.filter(dept => 
      (dept.department && dept.department.toLowerCase().includes(q)) ||
      (dept.head && dept.head.toLowerCase().includes(q)) ||
      (dept.email && dept.email.toLowerCase().includes(q))
    );
    setFilteredList(filtered);
  };

  /* ================= API CALLS ================= */
  const get_departments = async () => {
    setOpen(true);
    try {
      const response = await api.get("/department/show_departments");
      const data = response.data.departments || [];
      setlist(data);
      setFilteredList(data);
    } catch (err) {
      console.log(err);
    }
    setOpen(false);
  };

  const createDepartment = () => {
    setmodal(true);
  };

  const handleClose = () => {
    setmodal(false);
    setemail("");
    setpassword("");
    setdepartment("");
    sethead("");
  };

  const handleCreateDepartmentSubmit = async (e) => {
    e.preventDefault();
    setmodal(false);
    setOpen(true);
    const data = {
      email: email,
      password: password,
      department: department,
      head: head
    };

    try {
      // eslint-disable-next-line no-unused-vars
      const response = await createDepartmentApi(data);
      get_departments();
    } catch (err) {
      console.log(err);
      setOpen(false);
    }
    
    setemail("");
    setpassword("");
    setdepartment("");
    sethead("");
  };

  useEffect(() => {
    get_departments();
  }, []);

  return (
    <>
      <Backdrop
        sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }}
        open={open}
      >
        <CircularProgress color="inherit" />
      </Backdrop>

      <Modal
        open={modal}
        onClose={handleClose}
        aria-labelledby="modal-modal-title"
        aria-describedby="modal-modal-description"
      >
        <Box className='modal'>
          <Typography className='modal-text' sx={{ marginBottom: '1rem', fontFamily: 'RecklessNeue' }} variant="h6" component="h2">
            CREATE FACULTY
          </Typography>

          <form onSubmit={handleCreateDepartmentSubmit}>
            <FormControl fullWidth>
              <Input
                disableUnderline={true}
                type='email'
                placeholder="Email"
                required={true}
                value={email}
                className='admin-input'
                onChange={(e) => setemail(e.target.value)}
                sx={{ padding: '1rem' }}
              />
            </FormControl>
            <FormControl fullWidth>
              <Input
                disableUnderline={true}
                type='password'
                placeholder="Password"
                required={true}
                value={password}
                className='admin-input'
                onChange={(e) => setpassword(e.target.value)}
                sx={{ padding: '1rem' }}
              />
            </FormControl>
            <FormControl fullWidth>
              <Input
                disableUnderline={true}
                type='text'
                placeholder="Department Name"
                required={true}
                value={department}
                className='admin-input'
                onChange={(e) => setdepartment(e.target.value)}
                sx={{ padding: '1rem' }}
              />
            </FormControl>
            <FormControl fullWidth>
              <Input
                disableUnderline={true}
                type='text'
                placeholder="Faculty Name"
                required={true}
                value={head}
                className='admin-input'
                onChange={(e) => sethead(e.target.value)}
                sx={{ padding: '1rem' }}
              />
            </FormControl>

            <Button size="medium" fullWidth className='btn-admin-hall' type='submit'>CREATE FACULTY</Button>

          </form>
        </Box>
      </Modal>

      <div className='admin-department-body'>
        
        {/* 1. Appbar */}
        <Appbar 
          showSearch={true}
          searchValue={search}
          onSearchChange={onSearchChange}
          onSearchSubmit={onSearchSubmit}
          searchPlaceholder="Search departments..." 
        />

        <Container maxWidth="xl" sx={{ mt: 0 }}>
          
          {/* 2. FIXED Create Button Container */}
          <Box 
            className="fixed-create-btn-container"
            sx={{ 
              position: 'sticky', 
              top: 0, /* Stick to the top of the scrolling body (which starts after padding-top) */
              zIndex: 10,
              backgroundColor: 'transparent', 
              pt: 1, 
              pb: 1,
              display: 'flex',
              justifyContent: isMobile ? 'center' : 'flex-end'
            }}
          >
            <Button size="medium" className='btn-admin-department' onClick={createDepartment}>
              CREATE FACULTY
            </Button>
          </Box>

          {/* 3. Title Below Fixed Button */}
          <Grid container justifyContent={'center'} alignItems="center" sx={{ mb: 4 }}>
            <Grid item xs={12}>
              <div className='admin-department-title-div'>
                <h2 className='admin-department-title'>FACULTIES</h2>
              </div>
            </Grid>
          </Grid>

          {/* 4. List of Cards */}
          <Container>
            <Grid container spacing={4} justifyContent={'center'}>
              {filteredList.map((data, index) => (
                <Grid item xs={12} sm={10} md={6} lg={4} key={data._id || index}>
                  <Card sx={{ height: '100%' }} className='admin-department-card'>
                    <CardActionArea>
                      <CardContent>
                        <Typography gutterBottom variant="h5" className='admin-department-text' component="div" sx={{ mb: 2 }}>
                          {data.department}
                        </Typography>
                        
                        <Box display="flex" alignItems="center" mb={1}>
                          <Person2Icon sx={{ marginRight: "1rem", color: 'white' }} />
                          <Typography variant="body2" className='admin-department-text'>
                            {data.head}
                          </Typography>
                        </Box>

                        <Box display="flex" alignItems="center">
                          <EmailIcon sx={{ marginRight: "1rem", color: 'white' }} />
                          <Typography variant="body2" className='admin-department-text'>
                            {data.email}
                          </Typography>
                        </Box>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              ))}
              {filteredList.length === 0 && !open && (
                <Typography variant="h6" sx={{ color: 'white', mt: 4, fontFamily: 'Inter' }}>
                  No departments found.
                </Typography>
              )}
            </Grid>
          </Container>
        </Container>

      </div>
    </>
  )
}