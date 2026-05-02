const Booking_Requests = require('../models/booking_requests');
const { sendDecisionToDepartment } = require('../services/emailService');
const { sendDecisionSMSDepartment } = require('../services/smsService');
const { safeExecute } = require('../utils/safeNotify');
const {
  reserveHallSlotAtomically,
  pullHallBookingsByRequestIds
} = require('../services/bookingMutationService');

const clearTokenFields = (requestDoc) => {
  requestDoc.approvalToken = null;
  requestDoc.tokenExpiry = null;
};

exports.handleApproval = async (req, res, decision) => {
  try {
    const { token } = req.params;
    const expectedStatus = ['APPROVED', 'REJECTED'].includes(decision) ? 'PENDING' : 'AUTO_BOOKED';

    const requestDoc = await Booking_Requests.findOne({
      approvalToken: token,
      tokenExpiry: { $gt: Date.now() },
      status: expectedStatus
    }).populate('department');

    if (!requestDoc) {
      return res.status(400).send('Invalid or expired action link');
    }

    const departmentEmail = requestDoc.department.email;

    if (decision === 'REJECTED') {
      requestDoc.status = 'REJECTED';
      clearTokenFields(requestDoc);
      await requestDoc.save();

      safeExecute(
        () => sendDecisionToDepartment({
          email: departmentEmail,
          booking: requestDoc,
          decision: 'REJECTED'
        }),
        'DEPARTMENT EMAIL'
      );

      safeExecute(
        () => sendDecisionSMSDepartment({
          booking: requestDoc,
          decision: 'REJECTED'
        }),
        'DEPARTMENT SMS'
      );

      return res.send('Booking request rejected');
    }

    if (decision === 'APPROVED') {
      const reservationResult = await reserveHallSlotAtomically({
        hallName: requestDoc.hall,
        bookingRequestId: requestDoc._id,
        departmentId: requestDoc.department?._id || requestDoc.department || null,
        event: requestDoc.event,
        startDateTime: requestDoc.startDateTime,
        endDateTime: requestDoc.endDateTime
      });

      if (!reservationResult.reserved && reservationResult.reason === 'HALL_NOT_FOUND') {
        return res.status(404).send(`Hall not found: ${requestDoc.hall}`);
      }

      if (!reservationResult.reserved) {
        return res.status(409).send('Cannot approve: hall already booked for this time range.');
      }

      requestDoc.status = 'APPROVED';
      clearTokenFields(requestDoc);
      await requestDoc.save();

      safeExecute(
        () => sendDecisionToDepartment({
          email: departmentEmail,
          booking: requestDoc,
          decision: 'APPROVED'
        }),
        'DEPARTMENT EMAIL'
      );

      safeExecute(
        () => sendDecisionSMSDepartment({
          booking: requestDoc,
          decision: 'APPROVED'
        }),
        'DEPARTMENT SMS'
      );

      return res.send('Booking approved successfully');
    }

    if (decision === 'VACATED') {
      await pullHallBookingsByRequestIds({
        hallName: requestDoc.hall,
        requestIds: [requestDoc._id]
      });

      requestDoc.status = 'VACATED';
      clearTokenFields(requestDoc);
      await requestDoc.save();

      safeExecute(
        () => sendDecisionToDepartment({
          email: departmentEmail,
          booking: requestDoc,
          decision: 'VACATED'
        }),
        'DEPARTMENT EMAIL'
      );

      safeExecute(
        () => sendDecisionSMSDepartment({
          booking: requestDoc,
          decision: 'VACATED'
        }),
        'DEPARTMENT SMS'
      );

      return res.send('Auto-booked hall has been vacated');
    }

    if (decision === 'LEFT') {
      requestDoc.status = 'LEFT';
      clearTokenFields(requestDoc);
      await requestDoc.save();
      return res.send('Booking left as is and card cleared');
    }

    return res.status(400).send('Unknown decision');
  } catch (err) {
    console.error('approval link action failed:', err);
    return res.status(500).send('Server error');
  }
};
