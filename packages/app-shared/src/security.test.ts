import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSafeExternalUrl, isUuid } from './security.ts';
import { directionsUrl, pinUrl } from './travel.ts';

test('ids from outside must be UUIDs', () => {
  assert.equal(isUuid('3f2b6c1e-8a4d-4c2e-9b1f-0a1b2c3d4e5f'), true);
  for (const bad of ['../login', '3f2b6c1e', '3f2b6c1e-8a4d-4c2e-9b1f-0a1b2c3d4e5f/../x', '', null, 42]) assert.equal(isUuid(bad), false);
});

test('only known, safe links are opened', () => {
  assert.equal(isSafeExternalUrl(directionsUrl({ lat: 25.4246, lng: 81.8845 })), true);
  assert.equal(isSafeExternalUrl(directionsUrl('Hotel Kanha Shyam, Civil Lines')), true);
  assert.equal(isSafeExternalUrl(pinUrl({ lat: 25.4, lng: 81.8 })), true);
  assert.equal(isSafeExternalUrl('tel:+919811111111'), true);
  assert.equal(isSafeExternalUrl('https://api.cloudinary.com/v1_1/keidpig5/image/download?public_id=eventseva%2Fv%2Fdoc&format=pdf&type=private&timestamp=1&expires_at=2&api_key=3&signature=abc'), true);
  assert.equal(isSafeExternalUrl('https://play.google.com/store/apps/details?id=in.eventseva.partner'), true);
  for (const bad of [
    'javascript:alert(1)',
    'http://www.google.com/maps/dir/?api=1&destination=1,2',
    'https://www.google.com.evil.in/maps/dir/?api=1&destination=1',
    'https://evil.in/?https://www.google.com/maps/dir/',
    'tel:123; rm -rf',
    'intent://scan/#Intent;scheme=zxing;end',
    'https://play.google.com/store/apps/details?id=com.evil',
  ]) assert.equal(isSafeExternalUrl(bad), false, bad);
});
