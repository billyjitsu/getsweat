const axios = require('axios');
const { getAuth } = require('./auth');
const { API_BASE_URL, REGION_ID, LOCATION_ID, makeHeaders } = require('./config');

// 1. Get available classes for a specific date
async function getClassesForDate(date) {
  const auth = await getAuth();
  const headers = makeHeaders(auth);
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
    return classes.find(cls => {
      const classTimeObj = new Date(`2000-01-01T${cls.start_time}`);
      const classTime = classTimeObj.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }).replace(/\s/g, '');

      const requestedTime = options.time.replace(/\s/g, '');

      const matchesTime = options.time ? classTime.toLowerCase() === requestedTime.toLowerCase() : true;
      const matchesInstructor = options.instructor ?
        cls.instructors.some(instructor => instructor.name === options.instructor) : true;
      const matchesType = options.classType ?
        cls.class_type.name.toLowerCase().includes(options.classType.toLowerCase()) : true;

      return matchesTime && matchesInstructor && matchesType;
    });
  }

// Main function to run the booking process
async function bookDesiredClass(targetDate, targetTime, instructor, classType) {
  try {
    console.log(`Looking for ${classType} class on ${targetDate} at ${targetTime} with ${instructor}`);

    const classes = await getClassesForDate(targetDate);
    console.log(`Found ${classes.length} classes on ${targetDate}`);

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

  } catch (error) {
    console.error('Error in booking process:', error);
  }
}

// Run the script with your desired parameters
// Format: YYYY-MM-DD, Time (hh:mm AM/PM), Instructor Name, Class Type
bookDesiredClass('2025-04-28', '5:30 PM', 'JESS', 'ride');
