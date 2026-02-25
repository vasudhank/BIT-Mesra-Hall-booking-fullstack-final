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
import TextField from "@mui/material/TextField";

export default function DepartmentBookingCard(props) {
  // --- MANUALLY CHANGE THESE PARAMETERS HERE ---
  const gapBetweenCards = "15px";
  const cardImageHeight = 100;
  // ---------------------------------------------

  const [successOpen, setSuccessOpen] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [feedbackSeverity, setFeedbackSeverity] = useState("error");
  const [description, setDescription] = useState("");

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

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // hh:mm + AM/PM states
  const [startHour, setStartHour] = useState("");
  const [startMinute, setStartMinute] = useState("");
  const [startPeriod, setStartPeriod] = useState("AM");

  const [endHour, setEndHour] = useState("");
  const [endMinute, setEndMinute] = useState("");
  const [endPeriod, setEndPeriod] = useState("AM");

  const showFeedback = (message, severity = "error") => {
    setFeedbackSeverity(severity);
    setErrorMessage(message);
    setErrorOpen(true);
  };

  const normalizeTwoDigits = (value) => String(value || "").replace(/\D/g, "").slice(0, 2);

  const to24Hour = (hourRaw, minuteRaw, periodRaw, label) => {
    const hourNum = parseInt(hourRaw, 10);
    const minuteNum = parseInt(minuteRaw, 10);
    const period = String(periodRaw || "").toUpperCase();

    if (!Number.isInteger(hourNum) || hourNum < 1 || hourNum > 12) {
      return { ok: false, message: `${label} hour must be between 1 and 12.` };
    }

    if (!Number.isInteger(minuteNum) || minuteNum < 0 || minuteNum > 59) {
      return { ok: false, message: `${label} minute must be between 00 and 59.` };
    }

    if (period !== "AM" && period !== "PM") {
      return { ok: false, message: `${label} must include AM or PM.` };
    }

    let hour24 = hourNum;
    if (hourNum === 12) {
      hour24 = period === "AM" ? 0 : 12;
    } else if (period === "PM") {
      hour24 += 12;
    }

    const hh = String(hour24).padStart(2, "0");
    const mm = String(minuteNum).padStart(2, "0");

    return {
      ok: true,
      value: `${hh}:${mm}:00`,
      label12: `${String(hourNum).padStart(2, "0")}:${mm} ${period}`
    };
  };

  const validateRange = () => {
    if (!startDate || !endDate || !startHour || !startMinute || !endHour || !endMinute) {
      showFeedback("Please fill all date and time fields.", "warning");
      return null;
    }

    const parsedStart = to24Hour(startHour, startMinute, startPeriod, "Start time");
    if (!parsedStart.ok) {
      showFeedback(parsedStart.message, "warning");
      return null;
    }

    const parsedEnd = to24Hour(endHour, endMinute, endPeriod, "End time");
    if (!parsedEnd.ok) {
      showFeedback(parsedEnd.message, "warning");
      return null;
    }

    const startDateTime = `${startDate}T${parsedStart.value}`;
    const endDateTime = `${endDate}T${parsedEnd.value}`;

    const startDT = new Date(startDateTime);
    const endDT = new Date(endDateTime);
    const now = new Date();

    if (startDT <= now) {
      showFeedback("Cannot create booking for a date/time that has already passed.", "warning");
      return null;
    }

    if (endDT <= startDT) {
      showFeedback("End date/time must be after start date/time.", "warning");
      return null;
    }

    return {
      startDateTime,
      endDateTime,
      startTime24: parsedStart.value,
      endTime24: parsedEnd.value,
      startTime12: parsedStart.label12,
      endTime12: parsedEnd.label12
    };
  };

  const handleClose = () => {
    setModal(false);
    setEvent("");
    setDescription("");
    setStartDate("");
    setEndDate("");
    setStartHour("");
    setStartMinute("");
    setStartPeriod("AM");
    setEndHour("");
    setEndMinute("");
    setEndPeriod("AM");
  };

  const bookHall = () => {
    setModal(true);
  };

  const handleBookingRequestSubmit = async (e) => {
    e.preventDefault();

    const validated = validateRange();
    if (!validated) return;

    const data = {
      hall: props.data.name,
      event,
      description,
      startDate,
      endDate,
      startTime12: validated.startTime12,
      endTime12: validated.endTime12,
      startTime24: validated.startTime24,
      endTime24: validated.endTime24,
      startDateTime: validated.startDateTime,
      endDateTime: validated.endDateTime
    };

    try {
      await createBookingRequestApi(data);
      setSuccessOpen(true);
      handleClose();
      props.gethall();
    } catch (err) {
      console.error(err);
      const serverMessage =
        err?.data?.msg ||
        err?.data?.message ||
        err?.msg ||
        "Failed to create booking request. Try again.";

      const warningMatch = /already passed|after start|date\/time|enddatetime/i.test(serverMessage);
      showFeedback(serverMessage, warningMatch ? "warning" : "error");
    }
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
        <Alert onClose={handleCloseError} severity={feedbackSeverity} sx={{ width: "100%" }}>
          {errorMessage}
        </Alert>
      </Snackbar>

      <Modal
        open={modal}
        onClose={handleClose}
        aria-labelledby="modal-modal-title"
        aria-describedby="modal-modal-description"
      >
        <Box
          className="modal"
          sx={{
            width: { xs: "90%", sm: "70%", md: "55%" },
            maxWidth: "600px",
            maxHeight: "90vh",
            position: "absolute",
            overflowY: "auto",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            bgcolor: "background.paper",
            boxShadow: 24,
            p: 4,
            borderRadius: 2
          }}
        >
          <Typography
            className="modal-text"
            sx={{ marginBottom: "1rem", textAlign: "center" }}
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

            <FormControl fullWidth sx={{ marginBottom: "0.75rem" }}>
              <TextField
                multiline
                rows={4}
                placeholder="Describe Your Event in some detail here. Prefer to describe in short and be precise. (Optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                inputProps={{ maxLength: 10000 }}
                sx={{
                  backgroundColor: "rgba(255, 255, 255, 0.05)",
                  borderRadius: "12px",
                  "& .MuiOutlinedInput-root": {
                    color: "white",
                    fontFamily: "Inter",
                    "& fieldset": { borderColor: "rgba(255,255,255,0.2)" }
                  }
                }}
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

            <Grid container spacing={2} sx={{ marginBottom: "1rem" }}>
              <Grid item xs={12} sm={6}>
                <Typography className="modal-text" sx={{ marginBottom: "0.4rem", opacity: 0.9, fontSize: "0.95rem" }}>
                  Start Time
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Input
                    disableUnderline={true}
                    type="text"
                    inputProps={{ inputMode: "numeric", pattern: "[0-9]*", maxLength: 2 }}
                    placeholder="hh"
                    value={startHour}
                    className="admin-input"
                    onChange={(e) => setStartHour(normalizeTwoDigits(e.target.value))}
                    sx={{
                      padding: "1rem",
                      width: "4.5rem",
                      textAlign: "center",
                      "& input": { textAlign: "center" }
                    }}
                    aria-label="Start hour"
                  />
                  <Typography sx={{ fontSize: "1.4rem", fontWeight: 700, lineHeight: 1 }}>
                    :
                  </Typography>
                  <Input
                    disableUnderline={true}
                    type="text"
                    inputProps={{ inputMode: "numeric", pattern: "[0-9]*", maxLength: 2 }}
                    placeholder="mm"
                    value={startMinute}
                    className="admin-input"
                    onChange={(e) => setStartMinute(normalizeTwoDigits(e.target.value))}
                    sx={{
                      padding: "0.8rem",
                      width: "4rem",
                      textAlign: "center",
                      "& input": { textAlign: "center" }
                    }}
                    aria-label="Start minute"
                  />
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      border: "1px solid rgba(255, 255, 255, 0.22)",
                      borderRadius: "12px",
                      overflow: "hidden",
                      height: "50px",
                      minWidth: { xs: "108px", sm: "116px" }
                    }}
                  >
                    <Button
                      type="button"
                      onClick={() => setStartPeriod("AM")}
                      sx={{
                        borderRadius: 0,
                        fontWeight: 700,
                        minWidth: "unset",
                        color: startPeriod === "AM" ? "#fff" : "rgba(255,255,255,0.75)",
                        background: startPeriod === "AM" ? "rgba(25, 118, 210, 0.45)" : "transparent"
                      }}
                    >
                      AM
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setStartPeriod("PM")}
                      sx={{
                        borderRadius: 0,
                        fontWeight: 700,
                        minWidth: "unset",
                        color: startPeriod === "PM" ? "#fff" : "rgba(255,255,255,0.75)",
                        background: startPeriod === "PM" ? "rgba(25, 118, 210, 0.45)" : "transparent"
                      }}
                    >
                      PM
                    </Button>
                  </Box>
                </Box>
              </Grid>

              <Grid item xs={12} sm={6}>
                <Typography className="modal-text" sx={{ marginBottom: "0.4rem", opacity: 0.9, fontSize: "0.95rem" }}>
                  End Time
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Input
                    disableUnderline={true}
                    type="text"
                    inputProps={{ inputMode: "numeric", pattern: "[0-9]*", maxLength: 2 }}
                    placeholder="hh"
                    value={endHour}
                    className="admin-input"
                    onChange={(e) => setEndHour(normalizeTwoDigits(e.target.value))}
                    sx={{
                      padding: "1rem",
                      width: "4.5rem",
                      textAlign: "center",
                      "& input": { textAlign: "center" }
                    }}
                    aria-label="End hour"
                  />
                  <Typography sx={{ fontSize: "1.4rem", fontWeight: 700, lineHeight: 1 }}>
                    :
                  </Typography>
                  <Input
                    disableUnderline={true}
                    type="text"
                    inputProps={{ inputMode: "numeric", pattern: "[0-9]*", maxLength: 2 }}
                    placeholder="mm"
                    value={endMinute}
                    className="admin-input"
                    onChange={(e) => setEndMinute(normalizeTwoDigits(e.target.value))}
                    sx={{
                      padding: "0.8rem",
                      width: "4rem",
                      textAlign: "center",
                      "& input": { textAlign: "center" }
                    }}
                    aria-label="End minute"
                  />
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      border: "1px solid rgba(255, 255, 255, 0.22)",
                      borderRadius: "12px",
                      overflow: "hidden",
                      height: "50px",
                      minWidth: { xs: "108px", sm: "116px" }
                    }}
                  >
                    <Button
                      type="button"
                      onClick={() => setEndPeriod("AM")}
                      sx={{
                        borderRadius: 0,
                        fontWeight: 700,
                        minWidth: "unset",
                        color: endPeriod === "AM" ? "#fff" : "rgba(255,255,255,0.75)",
                        background: endPeriod === "AM" ? "rgba(25, 118, 210, 0.45)" : "transparent"
                      }}
                    >
                      AM
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setEndPeriod("PM")}
                      sx={{
                        borderRadius: 0,
                        fontWeight: 700,
                        minWidth: "unset",
                        color: endPeriod === "PM" ? "#fff" : "rgba(255,255,255,0.75)",
                        background: endPeriod === "PM" ? "rgba(25, 118, 210, 0.45)" : "transparent"
                      }}
                    >
                      PM
                    </Button>
                  </Box>
                </Box>
              </Grid>
            </Grid>

            <Button size="medium" fullWidth className="btn-admin-hall" type="submit">
              BOOK HALL
            </Button>
          </form>
        </Box>
      </Modal>

      <Card
        sx={{
          width: "90%",
          borderRadius: "1.5rem",
          boxShadow: "0px 4px 20px rgba(0,0,0,0.3)",
          marginBottom: gapBetweenCards
        }}
        className="hall-admin-card"
      >
        <CardMedia
          sx={{ height: cardImageHeight }}
          image="https://images.unsplash.com/photo-1594122230689-45899d9e6f69?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Mnx8Y29uZmVyZW5jZSUyMGhhbGx8ZW58MHx8MHx8fDA%3D&w=1000&q=80"
          title="seminar hall"
        />

        <CardContent sx={{ padding: "8px", "&:last-child": { paddingBottom: "4px" } }}>
          <Typography
            gutterBottom
            variant="h6"
            component="div"
            className="hall-card-text"
            fontFamily={"RecklessNeue"}
            sx={{ textAlign: "center", my: 0, fontSize: "1.1rem" }}
          >
            {props.data.name}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            className="hall-card-text"
            sx={{ display: "flex", justifyContent: "center", alignItems: "center", mt: 0.5 }}
          >
            <EventSeatIcon fontSize="medium" />
            <span className="number-seat" style={{ fontSize: "0.9rem" }}>
              {props.data.capacity}
            </span>
          </Typography>
        </CardContent>

        <Grid container spacing={2} justifyContent={"center"} sx={{ pb: 1.5, pt: 0.5 }}>
          <Grid item xs={10} sm={6} md={5} lg={5} xl={5}>
            {props.data.status === "Not Filled" ? (
              <Button
                size="small"
                onClick={bookHall}
                fullWidth
                className="btn-admin-hall"
                sx={{ paddingY: "4px", fontSize: "0.8rem" }}
              >
                BOOK
              </Button>
            ) : (
              <Button
                size="small"
                fullWidth
                className="btn-admin-hall"
                disabled
                sx={{ opacity: 0.6, cursor: "not-allowed", paddingY: "4px", fontSize: "0.8rem" }}
              >
                Filled
              </Button>
            )}
          </Grid>
        </Grid>
      </Card>
    </>
  );
}
