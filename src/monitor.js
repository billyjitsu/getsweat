const axios = require('axios');
const TelegramNotifier = require("./telegram"); 
require('dotenv').config();

// Your authentication cookies/headers (you'll need to update these when they expire)
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

// Create Telegram notifier instance
const telegram = new TelegramNotifier(
  process.env.TOKEN,
  process.env.CHANNEL
);

// Your weekly schedule definition
// Now we're just using instructor name for labeling, not filtering
const WEEKLY_SCHEDULE = [
  { day: 1, time: '17:30:00', label: 'Monday 5:30pm with JESS' },
  { day: 2, time: '06:15:00', label: 'Tuesday 6:15am with JULEZ' },
  { day: 3, time: '06:15:00', label: 'Wednesday 6:15am with JEWELZ' },
  { day: 5, time: '06:15:00', label: 'Friday 6:15am with JOSH' },
  { day: 6, time: '07:30:00', label: 'Saturday 7:30am with JESS' },
  { day: 0, time: '07:30:00', label: 'Sunday 7:30am with JESS' }
];

// Function to calculate upcoming dates for each class in the schedule
function calculateUpcomingDates() {
  const today = new Date();
  const upcomingClasses = [];

  WEEKLY_SCHEDULE.forEach(scheduleItem => {
    // Clone today's date
    const targetDate = new Date(today);
    
    // Calculate days to add to reach the target day of week
    // Day of week is 0-6 where 0 is Sunday
    const currentDay = today.getDay();
    let daysToAdd = scheduleItem.day - currentDay;
    
    // If the day has already passed this week, look for next week
    if (daysToAdd < 0) {
      daysToAdd += 7;
    }
    
    // Special case: if it's the same day but the time has passed, look for next week
    if (daysToAdd === 0) {
      const currentHour = today.getHours();
      const targetHour = parseInt(scheduleItem.time.split(':')[0], 10);
      
      if (currentHour >= targetHour) {
        daysToAdd = 7;
      }
    }
    
    // Set the target date
    targetDate.setDate(today.getDate() + daysToAdd);
    
    // Format as YYYY-MM-DD
    const formattedDate = targetDate.toISOString().split('T')[0];
    
    upcomingClasses.push({
      date: formattedDate,
      time: scheduleItem.time,
      label: scheduleItem.label,
      notificationSent: false // Add flag to track notification status
    });
  });
  
  return upcomingClasses;
}

// Get class data for a specific date
async function getClassData(date) {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/classes?min_start_date=${date}&max_start_date=${date}&page_size=500&location=${LOCATION_ID}&region=${REGION_ID}`,
      { headers }
    );
    return response.data.results || [];
  } catch (error) {
    console.error(`Error fetching class data for ${date}: ${error.message}`);
    return [];
  }
}

// Find specific class by time only (not filtering by instructor)
function findClassByTime(classes, time) {
  return classes.find(cls => cls.start_time === time);
}

// Check if class is available for registration
function isClassAvailable(classData) {
  if (!classData) return false;
  
  // Class is available if:
  // 1. It has available spots (available_spot_count > 0), OR
  // 2. Its status is not "Waitlist Only" or "Waitlist Full"
  return (
    (classData.available_spot_count > 0) ||
    (classData.spot_options && classData.spot_options.primary_availability > 0) ||
    (classData.status !== 'Waitlist Only' && classData.status !== 'Waitlist Full')
  );
}

// Format time from "HH:MM:SS" to "H:MM AM/PM"
function formatTime(timeString) {
  const [hours, minutes] = timeString.split(':');
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

// Get booking status (Open/Not Open)
function getBookingStatus(classData) {
  // Check if booking is open based on the data
  
  // If class data doesn't exist, it's not open
  if (!classData) return 'Not Open';
  
  // Check for an explicit property indicating booking status
  if (classData.is_bookable === false) return 'Not Open';
  
  // Check the status property
  if (classData.status === 'Not Open') return 'Not Open';
  
  // Look at the booking date to determine if it's open yet
  const now = new Date();
  const bookingStartDate = classData.booking_start_datetime ? new Date(classData.booking_start_datetime) : null;
  
  if (bookingStartDate && now < bookingStartDate) {
    return 'Not Open (Opens ' + bookingStartDate.toLocaleString() + ')';
  }
  
  // Default to open if none of the above checks indicate it's closed
  return 'Open';
}

// Get detailed status information for console logging
function getDetailedStatus(classData) {
  if (!classData) return 'NOT FOUND';
  
  // Get the booking status
  const bookingStatus = getBookingStatus(classData);
  
  if (classData.status === 'Waitlist Only') {
    return `WAITLIST ONLY (${classData.waitlist_count}/${classData.spot_options.waitlist_capacity} on waitlist) - ${bookingStatus}`;
  } else if (classData.status === 'Waitlist Full') {
    return `WAITLIST FULL (${classData.waitlist_count}/${classData.spot_options.waitlist_capacity} on waitlist) - ${bookingStatus}`;
  } else if (classData.available_spot_count > 0) {
    return `AVAILABLE (${classData.available_spot_count} spots open) - ${bookingStatus}`;
  } else {
    return `${classData.status || 'UNKNOWN STATUS'} - ${bookingStatus}`;
  }
}

// Send notification via Telegram
async function sendNotification(classData, label) {
  try {
    // Get booking status
    const bookingStatus = getBookingStatus(classData);
    
    // Format the message for Telegram
    const message = `
🎉 <b>Class Available!</b> 🎉

${label}
<b>Date:</b> ${classData.start_date}
<b>Time:</b> ${formatTime(classData.start_time)}
<b>Class:</b> ${classData.name}
<b>Instructor:</b> ${classData.instructors[0]?.name || 'Unknown'}
<b>Available spots:</b> ${classData.available_spot_count}
<b>Status:</b> ${classData.status || 'Available'}
<b>Booking:</b> ${bookingStatus}

Book now: https://www.getsweatstudio.com/schedule?_mt=%2Fclasses%2F${classData.id}%2Freserve
`;
    
    // Log to console
    console.log('\nCLASS AVAILABLE!');
    console.log(message);
    
    // Send to Telegram
    await telegram.sendMessage(message);
  } catch (error) {
    console.error('Error sending notification:', error);
  }
}

// Check classes and update their status
async function checkClasses(upcomingClasses, isHourlyCheck = false) {
  const timestamp = new Date().toLocaleString();
  console.log(`\n[${timestamp}] ${isHourlyCheck ? 'HOURLY CHECK' : 'Regular check'} for availability updates...`);
  
  for (const classInfo of upcomingClasses) {
    // Skip classes that don't have an ID (not found in initial check)
    if (!classInfo.id) {
      const classes = await getClassData(classInfo.date);
      const matchingClass = findClassByTime(classes, classInfo.time);
      
      if (matchingClass) {
        console.log(`\nFound class for ${classInfo.label} that was previously missing!`);
        console.log(`ID: ${matchingClass.id}`);
        console.log(`Status: ${getDetailedStatus(matchingClass)}`);
        
        // Store the class ID for future checks
        classInfo.id = matchingClass.id;
        classInfo.lastStatus = matchingClass.status;
        classInfo.lastAvailability = matchingClass.available_spot_count;
        classInfo.lastBookingStatus = getBookingStatus(matchingClass);
        
        // Check if it's available now and notification not yet sent
        if (isClassAvailable(matchingClass) && classInfo.lastBookingStatus === 'Open' && !classInfo.notificationSent) {
          await sendNotification(matchingClass, classInfo.label);
          classInfo.notificationSent = true; // Mark notification as sent
        }
      } else {
        console.log(`\n${classInfo.label}: STILL NOT FOUND`);
      }
      continue;
    }
    
    // Get updated class data
    const classes = await getClassData(classInfo.date);
    const classData = classes.find(cls => cls.id === classInfo.id);
    
    if (classData) {
      // Get current booking status
      const currentBookingStatus = getBookingStatus(classData);
      
      // Check if status changed
      const statusChanged = classInfo.lastStatus !== classData.status;
      const availabilityChanged = classInfo.lastAvailability !== classData.available_spot_count;
      const bookingStatusChanged = classInfo.lastBookingStatus !== currentBookingStatus;
      
      // Major changes that would trigger a new notification
      const becameAvailable = !isClassAvailable({ status: classInfo.lastStatus, available_spot_count: classInfo.lastAvailability }) 
                            && isClassAvailable(classData);
      const becameBookable = classInfo.lastBookingStatus !== 'Open' && currentBookingStatus === 'Open';
      
      // Update stored values
      classInfo.lastStatus = classData.status;
      classInfo.lastAvailability = classData.available_spot_count;
      classInfo.lastBookingStatus = currentBookingStatus;
      
      // If class became available OR booking status changed to open AND we haven't sent a notification yet
      if ((becameAvailable || becameBookable) && isClassAvailable(classData) && currentBookingStatus === 'Open' && !classInfo.notificationSent) {
        console.log(`\n${classInfo.label} became available and booking is open!`);
        await sendNotification(classData, classInfo.label);
        classInfo.notificationSent = true; // Mark notification as sent
      } 
      // If class went from open to waitlist or unavailable, reset notification flag
      else if (!isClassAvailable(classData) || currentBookingStatus !== 'Open') {
        classInfo.notificationSent = false; // Reset notification flag if class is no longer available
      }
      
      // Just log the current status without sending notification
      console.log(`\n${classInfo.label}: ${getDetailedStatus(classData)}`);
    } else {
      console.log(`\n${classInfo.label}: CLASS NO LONGER FOUND (ID: ${classInfo.id})`);
      classInfo.notificationSent = false; // Reset notification flag if class disappeared
    }
  }
}

// Main monitoring function
async function monitorClasses() {
  console.log('Starting GetSweat Studio class availability monitor');
  console.log(`Current time: ${new Date().toLocaleString()}`);
  console.log('Calculating upcoming classes to monitor...');
  
  // Calculate upcoming classes based on the current date and weekly schedule
  const upcomingClasses = calculateUpcomingDates();
  
  // Log the classes we'll be monitoring
  console.log('Monitoring these classes:');
  upcomingClasses.forEach(cls => {
    console.log(`- ${cls.date}: ${formatTime(cls.time)} (${cls.label})`);
  });
  
  // Initial check for all classes
  for (const classInfo of upcomingClasses) {
    const classes = await getClassData(classInfo.date);
    const matchingClass = findClassByTime(classes, classInfo.time);
    
    if (matchingClass) {
      console.log(`\nFound class for ${classInfo.label} on ${classInfo.date}`);
      console.log(`ID: ${matchingClass.id}`);
      console.log(`Status: ${getDetailedStatus(matchingClass)}`);
      console.log(`Class Type: ${matchingClass.class_type.name}`);
      console.log(`Instructor: ${matchingClass.instructors[0]?.name || 'Unknown'}`);
      
      // Store the class ID for future checks
      classInfo.id = matchingClass.id;
      classInfo.lastStatus = matchingClass.status;
      classInfo.lastAvailability = matchingClass.available_spot_count;
      classInfo.lastBookingStatus = getBookingStatus(matchingClass);
      
      // Check if it's available now
      if (isClassAvailable(matchingClass)) {
        // Only send notification if booking is actually open
        if (classInfo.lastBookingStatus === 'Open') {
          await sendNotification(matchingClass, classInfo.label);
          classInfo.notificationSent = true; // Mark notification as sent
        } else {
          console.log(`Class is available but booking is not open yet.`);
        }
      }
    } else {
      console.log(`\nClass NOT FOUND for ${classInfo.label} on ${classInfo.date}`);
    }
  }
  
  console.log('\nStarting periodic checks...');
  
  // Set up interval for regular checking (every 10 minutes)
  const regularCheckInterval = setInterval(async () => {
    try {
      await checkClasses(upcomingClasses, false);
      
      // Recalculate upcoming classes every 6 hours to keep the list fresh
      if (new Date().getHours() % 6 === 0 && new Date().getMinutes() < 10) {
        console.log('\nRefreshing upcoming classes list...');
        const newUpcomingClasses = calculateUpcomingDates();
        
        // Merge existing data with new dates
        for (const newClass of newUpcomingClasses) {
          const existingClass = upcomingClasses.find(
            c => c.date === newClass.date && c.time === newClass.time
          );
          
          if (!existingClass) {
            // This is a new class to monitor
            upcomingClasses.push(newClass);
            console.log(`Added new class to monitor: ${newClass.label} on ${newClass.date}`);
          }
        }
        
        // Remove classes that have passed
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        
        for (let i = upcomingClasses.length - 1; i >= 0; i--) {
          const classDate = upcomingClasses[i].date;
          
          if (classDate < todayStr) {
            console.log(`Removing past class: ${upcomingClasses[i].label} on ${classDate}`);
            upcomingClasses.splice(i, 1);
          }
        }
      }
      
    } catch (error) {
      console.error(`Error during monitoring: ${error.message}`);
    }
  }, 10 * 60 * 1000); // Check every 10 minutes
  
  // Set up top-of-the-hour checks
  scheduleHourlyChecks(upcomingClasses);
  
  // Allow for clean shutdown with Ctrl+C
  process.on('SIGINT', () => {
    console.log('Monitoring stopped by user');
    clearInterval(regularCheckInterval);
    process.exit(0);
  });
}

// Function to schedule hourly checks at the top of each hour
function scheduleHourlyChecks(upcomingClasses) {
  // Calculate time until next hour
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1);
  nextHour.setMinutes(0);
  nextHour.setSeconds(0);
  nextHour.setMilliseconds(0);
  
  // Calculate milliseconds until next hour
  const timeUntilNextHour = nextHour - now;
  
  console.log(`Scheduling first hourly check in ${Math.round(timeUntilNextHour/60000)} minutes`);
  
  // Schedule the first hourly check
  setTimeout(() => {
    // Run the check immediately at the top of the hour
    checkClasses(upcomingClasses, true);
    
    // Then set up a recurring interval every hour
    setInterval(() => {
      checkClasses(upcomingClasses, true);
    }, 60 * 60 * 1000); // Check every hour
  }, timeUntilNextHour);
}

// Start monitoring
monitorClasses();