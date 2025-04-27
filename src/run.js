const axios = require('axios');

// Your authentication cookies/headers
const cookies = 'server-session-bind=36fa1fda-a3c1-4b64-8340-6db109db6fca; XSRF-TOKEN=1742700885|6tiH6IXYfG4n; hs=-438574742; svSession=da276e7cd78d5a172bf807e51460967d6f4f99c81fc157649b59f7e3ad43a12f665b836ab32bc99b3fe23d6d3f588a581e60994d53964e647acf431e4f798bcd2a3a6ee058301ff0390455e9cdc86d13555dfb935e6b5fa8b0cd0f3439c9097b1ad924d21671527841a96a70f4c7432b68eff24e2908b1df6836338e12e62f2011ef5f462f08c13c41badcb020def4ea; bSession=395b75c0-9aa2-4dbc-96bb-42a9955ee529|5;';

// Common headers to use with requests
const headers = {
  'Cookie': cookies,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Referer': 'https://www.getsweatstudio.com/',
  'Accept': 'application/json',
  'Content-Type': 'application/json'
};

// Config constants
const REGION_ID = '48541';
const LOCATION_ID = '48718';
const API_BASE_URL = 'https://getsweatstudio.marianatek.com/api/customer/v1';

// 1. Get available classes for a specific date
async function getClassesForDate(date) {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/classes?min_start_date=${date}&max_start_date=${date}&page_size=500&location=${LOCATION_ID}&region=${REGION_ID}`,
      { headers }
    );
    return response.data.results;
  } catch (error) {
    console.error('Error fetching classes:', error.message);
    throw error;
  }
}

// 2. Find a specific class (e.g., by time and instructor)
function findDesiredClass(classes, options = {}) {
    // Filter classes based on options
    return classes.find(cls => {
      // Convert API time format (24-hour) to requested format (12-hour)
      const classTimeObj = new Date(`2000-01-01T${cls.start_time}`);
      const classTime = classTimeObj.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      }).replace(/\s/g, ''); // Remove space between time and AM/PM
      
      const requestedTime = options.time.replace(/\s/g, ''); // Remove space if any
      
      // Example criteria - using more flexible matching
      const matchesTime = options.time ? classTime.toLowerCase() === requestedTime.toLowerCase() : true;
      
      // Check if instructor name is included in the instructors array
      const matchesInstructor = options.instructor ? 
        cls.instructors.some(instructor => instructor.name === options.instructor) : true;
      
      // More flexible class type matching
      const matchesType = options.classType ? 
        cls.class_type.name.toLowerCase().includes(options.classType.toLowerCase()) : true;
      
      return matchesTime && matchesInstructor && matchesType;
    });
  }

// 3. Book the class
async function bookClass(classId) {
  try {
    // Using the endpoint and method you captured
    const response = await axios.post(
      `${API_BASE_URL}/me/reservations`,
      {
        class: { id: classId }
        // Add any other required fields based on what you see in the request payload
      },
      { headers }
    );
    
    console.log('Reservation created with ID:', response.data.id);
    return response.data;
  } catch (error) {
    console.error('Error booking class:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

// 4. Check reservation details
async function checkReservation(reservationId) {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/me/reservations/${reservationId}`,
      { headers }
    );
    return response.data;
  } catch (error) {
    console.error('Error checking reservation:', error.message);
    throw error;
  }
}

// 5. Check cart for the reservation
async function checkReservationCart(reservationId) {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/me/reservations/${reservationId}/cart`,
      { headers }
    );
    return response.data;
  } catch (error) {
    console.error('Error checking reservation cart:', error.message);
    throw error;
  }
}

// 6. Select a seat (if needed)
async function selectSeat(reservationId, spotId) {
  try {
    // You'll need to capture the actual request for seat selection
    // This is a placeholder based on typical API patterns
    const response = await axios.post(
      `${API_BASE_URL}/me/reservations/${reservationId}/select_spot`,
      { spot_id: spotId },
      { headers }
    );
    return response.data;
  } catch (error) {
    console.error('Error selecting seat:', error.message);
    throw error;
  }
}

// Main function to run the booking process
async function bookDesiredClass(targetDate, targetTime, instructor, classType) {
  try {
    console.log(`Looking for ${classType} class on ${targetDate} at ${targetTime} with ${instructor}`);
    
    // 1. Get classes for the target date
    const classes = await getClassesForDate(targetDate);
    console.log("Classes", classes);
    console.log(`Found ${classes.length} classes on ${targetDate}`);
    
    // 2. Find the desired class
    const desiredClass = findDesiredClass(classes, {
      time: targetTime,
      instructor: instructor,
      classType: classType
    });
    
    if (!desiredClass) {
      console.log('Could not find the desired class');
      return;
    }
    
    console.log(`Found desired class: ${desiredClass.class_type.name} at ${new Date(desiredClass.start_date).toLocaleString()}`);
    console.log(`Class ID: ${desiredClass.id}`);
    
    // 3. Book the class
    // const bookingResult = await bookClass(desiredClass.id);
    // console.log('Booking successful:', bookingResult);
    
    // // 4. Check reservation details
    // const reservationDetails = await checkReservation(bookingResult.id);
    // console.log('Reservation details:', reservationDetails);
    
    // // 5. Check cart
    // const cartDetails = await checkReservationCart(bookingResult.id);
    // console.log('Cart details:', cartDetails);
    
    // // 6. Select a seat if needed
    // if (reservationDetails.needs_spot_selection) {
    //   // You would need to determine which spot ID to use
    //   // This would typically be part of the class data or a separate API call
    //   const spotId = 'your-preferred-spot-id';
    //   const seatResult = await selectSeat(bookingResult.id, spotId);
    //   console.log('Seat selection successful:', seatResult);
    // }
    
    // console.log('Booking process completed successfully!');
    
  } catch (error) {
    console.error('Error in booking process:', error);
  }
}

// Run the script with your desired parameters
// Format: YYYY-MM-DD, Time (hh:mm AM/PM), Instructor Name, Class Type
bookDesiredClass('2025-04-28', '5:30 PM', 'JESS', 'ride');