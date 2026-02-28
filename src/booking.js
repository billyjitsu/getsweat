const axios = require('axios');
const { getAuth, invalidateAuth } = require('./auth');
const { API_BASE_URL, PREFERRED_SPOT_NAME, makeHeaders } = require('./config');

// Get class layout spots and payment options in parallel
async function getClassInfo(classId, headers) {
  const [classResp, paymentResp] = await Promise.all([
    axios.get(`${API_BASE_URL}/classes/${classId}`, { headers }),
    axios.get(`${API_BASE_URL}/classes/${classId}/payment_options`, { headers })
  ]);

  const layoutSpots = classResp.data.layout?.spots || [];
  const paymentOptions = paymentResp.data.user_payment_options || [];

  return { layoutSpots, paymentOptions };
}

async function bookClassWithSpot(classId, label) {
  console.log(`[booking] Attempting to book: ${label} (class ${classId})`);

  let auth;
  try {
    auth = await getAuth();
  } catch (error) {
    console.error(`[booking] Auth failed: ${error.message}`);
    return { success: false, error: `Auth failed: ${error.message}` };
  }

  const headers = makeHeaders(auth);

  // 1. Get spots and payment options
  let preferredSpot = null;
  let fallbackSpot = null;
  let spotTaken = false;
  let paymentOptionId = null;

  try {
    const { layoutSpots, paymentOptions } = await getClassInfo(classId, headers);

    // Find available spots
    const available = layoutSpots.filter(s => s.is_available);
    console.log(`[booking] ${available.length} spots available out of ${layoutSpots.length}`);

    // Look for preferred seat
    preferredSpot = available.find(s => s.name === PREFERRED_SPOT_NAME);
    if (preferredSpot) {
      console.log(`[booking] Seat ${PREFERRED_SPOT_NAME} is available (id: ${preferredSpot.id})`);
    } else {
      console.log(`[booking] Seat ${PREFERRED_SPOT_NAME} not available`);
      spotTaken = true;
      // Pick any available spot as fallback
      if (available.length > 0) {
        fallbackSpot = available[0];
        console.log(`[booking] Will use seat ${fallbackSpot.name} instead (id: ${fallbackSpot.id})`);
      }
    }

    // Find active membership payment option
    const membershipOpt = paymentOptions.find(o =>
      o.membership_payment && o.membership_payment.is_active && !o.error_code
    );
    if (membershipOpt) {
      paymentOptionId = membershipOpt.id;
      console.log(`[booking] Using payment: ${membershipOpt.description} (${paymentOptionId})`);
    } else if (paymentOptions.length > 0) {
      // Use first available option
      paymentOptionId = paymentOptions[0].id;
      console.log(`[booking] Using first payment option: ${paymentOptionId}`);
    } else {
      return { success: false, error: 'No payment options available for this class' };
    }
  } catch (error) {
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      invalidateAuth();
      return { success: false, error: `Auth expired: ${error.message}` };
    }
    return { success: false, error: `Failed to get class info: ${error.message}` };
  }

  // 2. Create the reservation with spot and payment in one call
  const spotToBook = preferredSpot || fallbackSpot;
  const payload = {
    class_session: { id: String(classId) },
    is_booked_for_me: true,
    reservation_type: 'standard',
    payment_option: { id: paymentOptionId }
  };
  if (spotToBook) {
    payload.spot = { id: spotToBook.id };
  }

  let reservation;
  try {
    console.log(`[booking] Creating reservation...`);
    const resp = await axios.post(`${API_BASE_URL}/me/reservations`, payload, { headers });
    reservation = resp.data;
    console.log(`[booking] Reservation created: ${reservation.id}`);
  } catch (error) {
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      invalidateAuth();
      return { success: false, error: `Auth expired during booking: ${error.message}` };
    }
    const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    return { success: false, error: `Reservation failed: ${detail}` };
  }

  // Determine which spot was assigned
  const assignedSpotName = reservation.spot?.name || spotToBook?.name || null;

  return {
    success: true,
    reservationId: reservation.id,
    spotName: assignedSpotName,
    spotTaken,
    error: null
  };
}

module.exports = { bookClassWithSpot };
