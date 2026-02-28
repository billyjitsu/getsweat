require('dotenv').config();

const API_BASE_URL = 'https://getsweatstudio.marianatek.com/api/customer/v1';
const REGION_ID = '48541';
const LOCATION_ID = '48718';
const PREFERRED_SPOT_NAME = '6';

// Classes open for booking 7 days ahead at 12:00 PM PST
const BOOKING_OPENS_DAYS_AHEAD = 7;
const BOOKING_OPENS_HOUR = 12; // 12:00 PM
const BOOKING_OPENS_TZ = 'America/Los_Angeles';

const WEEKLY_SCHEDULE = [
  { day: 1, time: '17:30:00', label: 'Monday 5:30pm with JESS' },
  { day: 3, time: '17:30:00', label: 'Wednesday 5:30pm with JESS' },
  { day: 6, time: '07:30:00', label: 'Saturday 7:30am with JESS' },
  { day: 0, time: '07:30:00', label: 'Sunday 7:30am with JESS' }
];

function makeHeaders(auth) {
  const base = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    'Referer': 'https://www.getsweatstudio.com/',
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };

  if (auth.type === 'bearer') {
    base['Authorization'] = `Bearer ${auth.value}`;
  } else {
    base['Cookie'] = auth.value;
  }

  return base;
}

module.exports = {
  API_BASE_URL,
  REGION_ID,
  LOCATION_ID,
  PREFERRED_SPOT_NAME,
  WEEKLY_SCHEDULE,
  BOOKING_OPENS_DAYS_AHEAD,
  BOOKING_OPENS_HOUR,
  BOOKING_OPENS_TZ,
  makeHeaders
};
