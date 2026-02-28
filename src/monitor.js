const axios = require('axios');
const TelegramNotifier = require("./telegram");
const { getAuth, invalidateAuth } = require('./auth');
const { bookClassWithSpot } = require('./booking');
const { API_BASE_URL, REGION_ID, LOCATION_ID, WEEKLY_SCHEDULE, BOOKING_OPENS_DAYS_AHEAD, BOOKING_OPENS_HOUR, BOOKING_OPENS_TZ, makeHeaders } = require('./config');
require('dotenv').config();

// Create Telegram notifier instance
const telegram = new TelegramNotifier(
  process.env.TOKEN,
  process.env.CHANNEL
);

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
      notificationSent: false,
      booked: false
    });
  });

  return upcomingClasses;
}

// Get class data for a specific date
async function getClassData(date) {
  try {
    const auth = await getAuth();
    const headers = makeHeaders(auth);
    const response = await axios.get(
      `${API_BASE_URL}/classes?min_start_date=${date}&max_start_date=${date}&page_size=500&location=${LOCATION_ID}&region=${REGION_ID}`,
      { headers }
    );
    return response.data.results || [];
  } catch (error) {
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      invalidateAuth();
      console.error(`[monitor] Auth expired, will re-login on next call`);
    }
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
  if (!classData) return 'Not Open';
  if (classData.is_bookable === false) return 'Not Open';
  if (classData.status === 'Not Open') return 'Not Open';

  const now = new Date();
  const bookingStartDate = classData.booking_start_datetime ? new Date(classData.booking_start_datetime) : null;

  if (bookingStartDate && now < bookingStartDate) {
    return 'Not Open (Opens ' + bookingStartDate.toLocaleString() + ')';
  }

  return 'Open';
}

// Get detailed status information for console logging
function getDetailedStatus(classData) {
  if (!classData) return 'NOT FOUND';

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

// Attempt booking and send Telegram notification with result
async function attemptBooking(classData, classInfo) {
  // Skip if already reserved for this class
  if (classData.is_user_reserved) {
    console.log(`[booking] Already reserved for ${classInfo.label} — skipping`);
    classInfo.booked = true;
    return;
  }

  const result = await bookClassWithSpot(classData.id, classInfo.label);

  if (result.success) {
    classInfo.booked = true;

    let spotMsg = '';
    if (result.spotName) {
      spotMsg = `\n<b>Seat:</b> ${result.spotName}`;
    } else if (result.spotTaken) {
      spotMsg = `\n<b>Seat 6:</b> taken — auto-assigned seat`;
    }

    const message = `
✅ <b>Auto-Booked!</b>

${classInfo.label}
<b>Date:</b> ${classData.start_date}
<b>Time:</b> ${formatTime(classData.start_time)}
<b>Class:</b> ${classData.name}
<b>Instructor:</b> ${classData.instructors[0]?.name || 'Unknown'}
<b>Reservation:</b> ${result.reservationId}${spotMsg}
`;
    console.log(message);
    await telegram.sendMessage(message);
  } else {
    const message = `
❌ <b>Auto-Book Failed</b>

${classInfo.label}
<b>Date:</b> ${classData.start_date}
<b>Time:</b> ${formatTime(classData.start_time)}
<b>Error:</b> ${result.error}

Book manually: https://www.getsweatstudio.com/schedule?_mt=%2Fclasses%2F${classData.id}%2Freserve
`;
    console.log(message);
    await telegram.sendMessage(message);
  }
}

// Check classes and update their status
async function checkClasses(upcomingClasses, isHourlyCheck = false) {
  const timestamp = new Date().toLocaleString();
  console.log(`\n[${timestamp}] ${isHourlyCheck ? 'HOURLY CHECK' : 'Regular check'} for availability updates...`);

  for (const classInfo of upcomingClasses) {
    // Skip already-booked classes
    if (classInfo.booked) {
      console.log(`\n${classInfo.label}: ALREADY BOOKED — skipping`);
      continue;
    }

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

        // Check if it's available now and not yet booked
        if (isClassAvailable(matchingClass) && classInfo.lastBookingStatus === 'Open' && !classInfo.notificationSent) {
          await attemptBooking(matchingClass, classInfo);
          classInfo.notificationSent = true;
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
      const becameAvailable = !isClassAvailable({ status: classInfo.lastStatus, available_spot_count: classInfo.lastAvailability })
                            && isClassAvailable(classData);
      const becameBookable = classInfo.lastBookingStatus !== 'Open' && currentBookingStatus === 'Open';

      // Update stored values
      classInfo.lastStatus = classData.status;
      classInfo.lastAvailability = classData.available_spot_count;
      classInfo.lastBookingStatus = currentBookingStatus;

      // If class became available OR booking status changed to open
      if ((becameAvailable || becameBookable) && isClassAvailable(classData) && currentBookingStatus === 'Open' && !classInfo.notificationSent) {
        console.log(`\n${classInfo.label} became available and booking is open!`);
        await attemptBooking(classData, classInfo);
        classInfo.notificationSent = true;
      }
      // If class went from open to waitlist or unavailable, reset notification flag
      else if (!isClassAvailable(classData) || currentBookingStatus !== 'Open') {
        classInfo.notificationSent = false;
      }

      // Just log the current status without sending notification
      console.log(`\n${classInfo.label}: ${getDetailedStatus(classData)}`);
    } else {
      console.log(`\n${classInfo.label}: CLASS NO LONGER FOUND (ID: ${classInfo.id})`);
      classInfo.notificationSent = false;
    }
  }
}

// Main monitoring function
async function monitorClasses() {
  console.log('Starting GetSweat Studio class availability monitor (auto-booking enabled)');
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

      // If already reserved, mark as booked and skip
      if (matchingClass.is_user_reserved) {
        console.log(`Already reserved for this class — skipping`);
        classInfo.booked = true;
        classInfo.notificationSent = true;
      }
      // Check if it's available now
      else if (isClassAvailable(matchingClass)) {
        if (classInfo.lastBookingStatus === 'Open') {
          await attemptBooking(matchingClass, classInfo);
          classInfo.notificationSent = true;
        } else {
          console.log(`Class is available but booking is not open yet.`);
        }
      }
    } else {
      console.log(`\nClass NOT FOUND for ${classInfo.label} on ${classInfo.date}`);
    }
  }

  console.log('\nStarting periodic checks...');

  // Schedule aggressive checks at booking open windows (7 days ahead at 12pm PST)
  scheduleBookingWindowChecks(upcomingClasses);

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

        // Re-schedule booking windows for any new classes
        scheduleBookingWindowChecks(upcomingClasses);
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

// Calculate when booking opens for a class (7 days before at 12:00 PM PST)
function getBookingOpenTime(classDate) {
  // classDate is "YYYY-MM-DD" string
  // Booking opens 7 days before at 12:00 PM Los_Angeles time
  const [year, month, day] = classDate.split('-').map(Number);

  // Create a date object in LA timezone for 7 days before the class
  const openDate = new Date(year, month - 1, day - BOOKING_OPENS_DAYS_AHEAD);
  const openDateStr = `${openDate.getFullYear()}-${String(openDate.getMonth() + 1).padStart(2, '0')}-${String(openDate.getDate()).padStart(2, '0')}`;

  // Build a timestamp at 12:00 PM in LA timezone
  // Using Intl to get the correct UTC offset for that date
  const laDate = new Date(`${openDateStr}T${String(BOOKING_OPENS_HOUR).padStart(2, '0')}:00:00`);
  // toLocaleString trick to get the LA time as a UTC timestamp
  const utcStr = laDate.toLocaleString('en-US', { timeZone: BOOKING_OPENS_TZ });
  const laLocal = new Date(utcStr);
  const offset = laLocal - laDate;
  return new Date(laDate.getTime() - offset);
}

// Schedule aggressive checks around the booking open window for each class
function scheduleBookingWindowChecks(upcomingClasses) {
  const now = Date.now();

  for (const classInfo of upcomingClasses) {
    if (classInfo.booked || classInfo.bookingWindowScheduled) continue;

    const openTime = getBookingOpenTime(classInfo.date);
    const msUntilOpen = openTime.getTime() - now;

    // Only schedule if the window is in the future and within the next 8 days
    if (msUntilOpen < -60000 || msUntilOpen > 8 * 24 * 60 * 60 * 1000) continue;

    classInfo.bookingWindowScheduled = true;

    const openTimeStr = openTime.toLocaleString('en-US', { timeZone: BOOKING_OPENS_TZ });
    console.log(`[booking-window] ${classInfo.label} (${classInfo.date}) opens at ${openTimeStr} PST`);

    // Start checking 2 seconds before the window opens
    const startOffset = msUntilOpen - 2000;

    if (startOffset <= 0) {
      // Window already open or about to open — check immediately
      console.log(`[booking-window] ${classInfo.label} — window already open, checking now`);
      runBookingWindowBurst(classInfo);
    } else {
      const minsUntil = Math.round(startOffset / 60000);
      console.log(`[booking-window] ${classInfo.label} — burst scheduled in ${minsUntil} minutes`);
      setTimeout(() => runBookingWindowBurst(classInfo), startOffset);
    }
  }
}

// Rapid-fire checks when a booking window opens
async function runBookingWindowBurst(classInfo) {
  if (classInfo.booked) return;

  console.log(`\n[booking-window] BURST START for ${classInfo.label} (${classInfo.date})`);

  // Check every 2 seconds for the first 30 seconds, then every 5s for another 30s
  const schedule = [
    { count: 15, interval: 2000 },  // 0-30s: every 2s
    { count: 6,  interval: 5000 },  // 30-60s: every 5s
  ];

  for (const phase of schedule) {
    for (let i = 0; i < phase.count; i++) {
      if (classInfo.booked) {
        console.log(`[booking-window] ${classInfo.label} — already booked, stopping burst`);
        return;
      }

      try {
        const classes = await getClassData(classInfo.date);
        const matchingClass = findClassByTime(classes, classInfo.time);

        if (matchingClass) {
          // Store class ID if we didn't have it
          if (!classInfo.id) {
            classInfo.id = matchingClass.id;
            classInfo.lastStatus = matchingClass.status;
            classInfo.lastAvailability = matchingClass.available_spot_count;
            classInfo.lastBookingStatus = getBookingStatus(matchingClass);
          }

          const bookingStatus = getBookingStatus(matchingClass);
          const available = isClassAvailable(matchingClass);

          console.log(`[booking-window] ${classInfo.label}: ${matchingClass.available_spot_count} spots, booking: ${bookingStatus}`);

          if (available && bookingStatus === 'Open') {
            console.log(`[booking-window] ${classInfo.label} — OPEN! Booking now...`);
            await attemptBooking(matchingClass, classInfo);
            classInfo.notificationSent = true;
            return;
          }
        } else {
          console.log(`[booking-window] ${classInfo.label}: class not found yet`);
        }
      } catch (error) {
        console.error(`[booking-window] Error checking ${classInfo.label}: ${error.message}`);
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, phase.interval));
    }
  }

  console.log(`[booking-window] Burst complete for ${classInfo.label} — did not book, regular monitoring continues`);
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
