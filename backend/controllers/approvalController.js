const Booking_Requests = require('../models/booking_requests');
const Hall = require('../models/hall');
const Department = require('../models/department');
const { sendDecisionToDepartment } = require('../services/emailService');

exports.handleApproval = async (req, res, decision) => {
  const { token } = req.params;

  const request = await Booking_Requests.findOne({
    approvalToken: token,
    tokenExpiry: { $gt: Date.now() },
    status: 'PENDING'
  }).populate('department');

  if (!request) {
    return res.status(400).send('Invalid or expired approval link');
  }

  const departmentEmail = request.department.email;

  if (decision === 'REJECT') {
    request.status = 'REJECTED';
    request.approvalToken = null;
    request.tokenExpiry = null;
    await request.save();

    // 🔽 NEW: email department
    await sendDecisionToDepartment({
      email: departmentEmail,
      booking: request,
      decision: 'REJECTED'
    });

    return res.send('Booking request rejected');
  }

  // APPROVE
  await Hall.findOneAndUpdate(
    { name: request.hall },
    {
      $push: {
        bookings: {
          department: request.department._id,
          event: request.event,
          startDateTime: request.startDateTime,
          endDateTime: request.endDateTime,
          bookingRequest: request._id
        }
      }
    }
  );

  request.status = 'APPROVED';
  request.approvalToken = null;
  request.tokenExpiry = null;
  await request.save();

  // 🔽 NEW: email department
  await sendDecisionToDepartment({
    email: departmentEmail,
    booking: request,
    decision: 'APPROVED'
  });

  res.send('Booking approved successfully');
};
