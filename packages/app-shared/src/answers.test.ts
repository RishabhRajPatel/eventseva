import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerLines } from './answers.ts';

const yesNo = { yes: 'Yes', no: 'No' };
const questions = [
  { key: 'menu', label: { en: 'Menu', hi: 'मेन्यू' }, options: [{ value: 'veg', label: { en: 'Veg', hi: 'शाकाहारी' } }, { value: 'jain', label: { en: 'Jain', hi: 'जैन' } }] },
  { key: 'generator', label: { en: 'Generator?', hi: 'जनरेटर?' } },
  { key: 'dishes', label: { en: 'Dishes', hi: 'व्यंजन' }, options: [{ value: 'paneer', label: { en: 'Paneer', hi: 'पनीर' } }] },
  { key: 'note', label: { en: 'Note', hi: 'नोट' } },
  { key: 'mode', label: { en: 'Mode', hi: 'मोड' } },
];

test('answers read in the app language, with choice labels and yes / no, skipping empty and internal ones', () => {
  const lines = answerLines({ questions, answers: { menu: 'jain', generator: false, dishes: ['paneer', 'dal'], note: '', mode: 'self_drive' } }, 'hi', { yes: 'हाँ', no: 'नहीं' });
  assert.deepEqual(lines, [
    { key: 'menu', label: 'मेन्यू', value: 'जैन' },
    { key: 'generator', label: 'जनरेटर?', value: 'नहीं' },
    { key: 'dishes', label: 'व्यंजन', value: 'पनीर, dal' },
  ]);
  assert.deepEqual(answerLines({ questions, answers: null }, 'en', yesNo), []);
  assert.deepEqual(answerLines({ answers: { menu: 'veg' } }, 'en', yesNo), []);
});

test('an attached file is a line of its own, marked as a file', () => {
  const lines = answerLines({ questions: [{ key: 'photo', label: { en: 'Venue photo', hi: 'जगह की फ़ोटो' } }], answers: { photo: { publicId: 'x/y', format: 'jpg' } } }, 'en', yesNo);
  assert.deepEqual(lines, [{ key: 'photo', label: 'Venue photo', value: 'JPG', file: true }]);
});
