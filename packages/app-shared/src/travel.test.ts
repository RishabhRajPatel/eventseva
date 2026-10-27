import assert from 'node:assert/strict';
import { test } from 'node:test';
import { directionsUrl, formatClock, formatDistance, formatMinutes, minutesUntil, pinUrl } from './travel.ts';

test('maps links', () => {
  assert.equal(directionsUrl({ lat: 25.4246, lng: 81.8845 }), 'https://www.google.com/maps/dir/?api=1&destination=25.4246%2C81.8845');
  assert.equal(directionsUrl('Civil Lines, Prayagraj'), 'https://www.google.com/maps/dir/?api=1&destination=Civil%20Lines%2C%20Prayagraj');
  assert.equal(pinUrl({ lat: 1, lng: 2 }), 'https://www.google.com/maps/search/?api=1&query=1%2C2');
});

test('distance, time and clock text', () => {
  assert.equal(formatDistance(6.5), '6.5 km');
  assert.equal(formatDistance(12, 'hi'), '12 किमी');
  assert.equal(formatDistance(0.34), '300 m');
  assert.equal(formatMinutes(20), '20 min');
  assert.equal(formatMinutes(70), '1 h 10 min');
  assert.equal(formatMinutes(120, 'hi'), '2 घंटा');
  assert.equal(formatClock('17:30'), '5:30 pm');
  assert.equal(formatClock('00:05'), '12:05 am');
  assert.equal(minutesUntil(new Date(Date.UTC(2026, 0, 1, 0, 30)).toISOString(), Date.UTC(2026, 0, 1)), 30);
});
