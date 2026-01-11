import React, { useState } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import "../AdminHall/AdminHall.css";
import CardMedia from "@mui/material/CardMedia";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import EventSeatIcon from "@mui/icons-material/EventSeat";
import Grid from "@mui/material/Grid";
import { createBookingRequestApi } from "../../../api/createbookingapi";
import Modal from "@mui/material/Modal";
import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import Input from "@mui/material/Input";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";

export default function DepartmentBookingCard(props) {
  const [successOpen, setSuccessOpen] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleCloseSuccess = (event, reason) => {
    if (reason === "clickaway") return;
    setSuccessOpen(false);
  };
  const handleCloseError = (event, reason) => {
    if (reason === "clickaway") return;
    setErrorOpen(false);
  };

  const [modal, setModal] = useState(false);
  const [event, setEvent] = useState("");

  // date/time states
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // now using text inputs with 12-hour AM/PM format
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const handleClose = () => {
    setModal(false);
    setEvent("");
    setStartDate("");
    setEndDate("");
    setStartTime("");
    setEndTime("");
  };

  const bookHall = () => {
    setModal(true);
  };

  // parse 12-hour time like "2:30 PM" or "02:30:15 am" into "HH:MM:SS" 24-hour format
  const parse12HourTo24 = (t) => {
    if (!t || typeof t !== "string") return null;
    const m = t.trim().match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\s*(AM|PM)$/i);
    if (!m) return null;
    let hh = parseInt(m[1], 10);
    const mm = m[2];
    const ss = m[3] ? m[3] : "00";
    const ampm = m[4].toUpperCase();

    if (hh < 1 || hh > 12) return null;
    if (hh === 12) {
      hh = ampm === "AM" ? 0 : 12;
    } else if (ampm === "PM") {
      hh += 12;
    }
    const hhPadded = hh.toString().padStart(2, "0");
    return `${hhPadded}:${mm}:${ss}`;
  };

  const validateRange = () => {
    if (!startDate || !endDate || !startTime || !endTime) {
      setErrorMessage("Please fill all date and time fields.");
      setErrorOpen(true);
      return false;
    }

    const startTime24 = parse12HourTo24(startTime);
    const endTime24 = parse12HourTo24(endTime);

    if (!startTime24 || !endTime24) {
      setErrorMessage(
        "Time format invalid. Use format like '02:30 PM' or '2:30 AM' (hh:mm AM/PM)."
      );
      setErrorOpen(true);
      return false;
    }

    const startISO = `${startDate}T${startTime24}`;
    const endISO = `${endDate}T${endTime24}`;

    if (new Date(endISO) <= new Date(startISO)) {
      setErrorMessage("End date/time must be after start date/time.");
      setErrorOpen(true);
      return false;
    }

    return true;
  };

  const handleBookingRequestSubmit = async (e) => {
    e.preventDefault();

    // validate (also normalizes times)
    if (!validateRange()) return;

    const startTime24 = parse12HourTo24(startTime);
    const endTime24 = parse12HourTo24(endTime);

    const data = {
      hall: props.data.name,
      event: event,
      startDate, // "YYYY-MM-DD"
      endDate,
      // keep the original 12-hour strings for display if you want:
      startTime12: startTime, // e.g. "02:30 PM"
      endTime12: endTime,
      // normalized 24-hour with seconds:
      startTime24: startTime24, // e.g. "14:30:00"
      endTime24: endTime24,
      // combined ISO datetimes (good for backend):
      startDateTime: `${startDate}T${startTime24}`,
      endDateTime: `${endDate}T${endTime24}`,
    };

    try {
      const response = await createBookingRequestApi(data);
      setSuccessOpen(true);
    } catch (err) {
      console.error(err);
      setErrorMessage("Failed to create booking request. Try again.");
      setErrorOpen(true);
    }

    handleClose();
    // refresh hall list (as you had)
    props.gethall();
  };

  return (
    <>
      <Snackbar
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        open={successOpen}
        autoHideDuration={3000}
        onClose={handleCloseSuccess}
      >
        <Alert
          onClose={handleCloseSuccess}
          severity="success"
          sx={{ width: "100%", background: "#388e3c", color: "white" }}
        >
          Booking Request Made
        </Alert>
      </Snackbar>

      <Snackbar
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        open={errorOpen}
        autoHideDuration={4000}
        onClose={handleCloseError}
      >
        <Alert onClose={handleCloseError} severity="error" sx={{ width: "100%" }}>
          {errorMessage}
        </Alert>
      </Snackbar>

      <Modal
        open={modal}
        onClose={handleClose}
        aria-labelledby="modal-modal-title"
        aria-describedby="modal-modal-description"
      >
        <Box className="modal">
          <Typography
            className="modal-text"
            sx={{ marginBottom: "1rem" }}
            variant="h6"
            component="h2"
          >
            EVENT&nbsp;&nbsp;&nbsp;DETAILS
          </Typography>

          <form onSubmit={handleBookingRequestSubmit}>
            <FormControl fullWidth sx={{ marginBottom: "0.75rem" }}>
              <Input
                disableUnderline={true}
                type="text"
                placeholder="Event Name"
                required
                value={event}
                className="admin-input"
                onChange={(e) => setEvent(e.target.value)}
                sx={{ padding: "1rem" }}
              />
            </FormControl>

            <Grid container spacing={2} sx={{ marginBottom: "0.5rem" }}>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <Input
                    disableUnderline={true}
                    type="date"
                    placeholder="Start Date"
                    required
                    value={startDate}
                    className="admin-input"
                    onChange={(e) => setStartDate(e.target.value)}
                    sx={{ padding: "1rem" }}
                  />
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <Input
                    disableUnderline={true}
                    type="date"
                    placeholder="End Date"
                    required
                    value={endDate}
                    className="admin-input"
                    onChange={(e) => setEndDate(e.target.value)}
                    sx={{ padding: "1rem" }}
                  />
                </FormControl>
              </Grid>
            </Grid>

            {/* Time fields (12-hour with AM/PM). Placeholder contains the format hint. */}
            <Grid container spacing={2} sx={{ marginBottom: "1rem" }}>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <Input
                    disableUnderline={true}
                    type="text"
                    placeholder="Start time — hh:mm AM/PM"
                    required
                    value={startTime}
                    className="admin-input"
                    onChange={(e) => setStartTime(e.target.value)}
                    sx={{ padding: "1rem" }}
                    aria-label="Start time (hh:mm AM/PM)"
                  />
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <Input
                    disableUnderline={true}
                    type="text"
                    placeholder="End Time — hh:mm AM/PM"
                    required
                    value={endTime}
                    className="admin-input"
                    onChange={(e) => setEndTime(e.target.value)}
                    sx={{ padding: "1rem" }}
                    aria-label="End time (hh:mm AM/PM)"
                  />
                </FormControl>
              </Grid>
            </Grid>

            <Button size="medium" fullWidth className="btn-admin-hall" type="submit">
              BOOK HALL
            </Button>
          </form>
        </Box>
      </Modal>

      <Card sx={{}} className="hall-admin-card">
        <CardMedia
          sx={{ height: 140 }}
          image="https://images.unsplash.com/photo-1594122230689-45899d9e6f69?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Mnx8Y29uZmVyZW5jZSUyMGhhbGx8ZW58MHx8MHx8fDA%3D&w=1000&q=80"
          title="seminar hall"
        />
        <CardContent>
          <Typography
            gutterBottom
            variant="h5"
            component="div"
            className="hall-card-text"
            fontFamily={"RecklessNeue"}
          >
            {props.data.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" className="hall-card-text">
            <EventSeatIcon fontSize="large" />
            <span className="number-seat">{props.data.capacity}</span>
          </Typography>
        </CardContent>
        <Grid container spacing={2} justifyContent={"center"}>
          <Grid item xs={8} sm={5} md={4} lg={4} xl={4}>
            {props.data.status === "Not Filled" ? (
              <Button size="medium" onClick={bookHall} fullWidth className="btn-admin-hall">
                BOOK
              </Button>
            ) : (
              <Button size="medium" fullWidth className="btn-admin-hall" disabled>
                Filled
              </Button>
            )}
          </Grid>
        </Grid>
      </Card>
    </>
  );
}
