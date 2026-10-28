import { availabilityForm, planForms, priceRuleForms, questionForms, toAvailability, toPlans, toPriceRules, toQuestions } from '../lib/serviceConfig';

describe('service config forms', () => {
  it('availability: every day means no limit; dates and numbers are checked', () => {
    expect(toAvailability({ workingDays: [], blockedDates: '', maxAdvanceDays: '', maxPerDay: '' })).toEqual({ ok: true, rules: {} });
    expect(toAvailability({ workingDays: [0, 1, 2, 3, 4, 5, 6], blockedDates: '', maxAdvanceDays: '', maxPerDay: '' })).toEqual({ ok: true, rules: {} });
    expect(toAvailability({ workingDays: [6, 0], blockedDates: '2026-12-25, 2026-12-24 2026-12-25', maxAdvanceDays: '90', maxPerDay: '2' })).toEqual({
      ok: true, rules: { workingDays: [0, 6], blockedDates: ['2026-12-24', '2026-12-25'], maxAdvanceDays: 90, maxPerDay: 2 },
    });
    expect(toAvailability({ workingDays: [], blockedDates: '2026-02-30', maxAdvanceDays: '', maxPerDay: '' })).toEqual({ ok: false, problem: 'dates' });
    expect(toAvailability({ workingDays: [], blockedDates: '', maxAdvanceDays: '900', maxPerDay: '' })).toEqual({ ok: false, problem: 'advance' });
    expect(toAvailability({ workingDays: [], blockedDates: '', maxAdvanceDays: '', maxPerDay: '0' })).toEqual({ ok: false, problem: 'perDay' });
    expect(availabilityForm({ workingDays: [1], blockedDates: ['2026-12-24'], maxPerDay: 3 })).toEqual({ workingDays: [1], blockedDates: '2026-12-24', maxAdvanceDays: '', maxPerDay: '3' });
  });

  it('plans: none or two and more; ids from names, kept once saved; the shared price settings go into each', () => {
    const base = { includedKm: 80, taxPercent: 18 as const, adjustments: [{ label: { en: 'Weekend', hi: 'वीकेंड' }, days: [0, 6], percent: 20 }] };
    expect(toPlans([], base)).toEqual({ ok: true, plans: [] });
    expect(toPlans([{ id: '', nameEn: 'Hourly', nameHi: '', model: 'hourly', rate: '800' }], base)).toEqual({ ok: false, problem: { index: -1, field: 'count' } });
    const r = toPlans([
      { id: '', nameEn: 'Full night!', nameHi: 'पूरी रात', model: 'fixed', rate: '20000' },
      { id: 'per_hour', nameEn: '', nameHi: 'प्रति घंटा', model: 'hourly', rate: '3000' },
    ], base);
    expect(r).toEqual({ ok: true, plans: [
      { id: 'full_night', name: { en: 'Full night!', hi: 'पूरी रात' }, pricing: { ...base, model: 'fixed', ratePaise: 2_000_000 } },
      { id: 'per_hour', name: { en: 'प्रति घंटा', hi: 'प्रति घंटा' }, pricing: { ...base, model: 'hourly', ratePaise: 300_000 } },
    ] });
    expect(toPlans([{ id: '', nameEn: 'A', nameHi: '', model: 'fixed', rate: '0' }, { id: '', nameEn: 'B', nameHi: '', model: 'fixed', rate: '5' }], {})).toEqual({ ok: false, problem: { index: 0, field: 'rate' } });
    expect(toPlans([{ id: '', nameEn: 'Same', nameHi: '', model: 'fixed', rate: '5' }, { id: '', nameEn: 'Same', nameHi: '', model: 'fixed', rate: '6' }], {}).ok && true).toBe(true);
    expect(planForms(r.ok ? r.plans : [])[1]).toEqual({ id: 'per_hour', nameEn: 'प्रति घंटा', nameHi: 'प्रति घंटा', model: 'hourly', rate: '3000' });
  });

  it('price rules: percent or amount, optional days, events and dates', () => {
    const rule = { labelEn: 'Weekend', labelHi: '', kind: 'percent' as const, value: '+20', days: [6, 0], eventTypes: [], from: '', until: '' };
    expect(toPriceRules([rule])).toEqual({ ok: true, adjustments: [{ label: { en: 'Weekend', hi: 'Weekend' }, percent: 20, days: [0, 6] }] });
    expect(toPriceRules([{ ...rule, kind: 'amount', value: '-500', days: [], eventTypes: ['wedding'], from: '2026-11-01', until: '2026-12-15' }])).toEqual({
      ok: true, adjustments: [{ label: { en: 'Weekend', hi: 'Weekend' }, amountPaise: -50_000, eventTypes: ['wedding'], from: '2026-11-01', until: '2026-12-15' }],
    });
    expect(toPriceRules([{ ...rule, value: '400' }])).toEqual({ ok: false, problem: { index: 0, field: 'value' } });
    expect(toPriceRules([{ ...rule, labelEn: ' ' }])).toEqual({ ok: false, problem: { index: 0, field: 'label' } });
    expect(toPriceRules([{ ...rule, from: '2026-12-15', until: '2026-11-01' }])).toEqual({ ok: false, problem: { index: 0, field: 'dates' } });
    expect(priceRuleForms([{ label: { en: 'Peak', hi: 'पीक' }, amountPaise: 100_000 }])[0]).toMatchObject({ kind: 'amount', value: '1000' });
  });

  it('questions: keys from the question, never the category\'s; choices need two or more', () => {
    const r = toQuestions([
      { key: '', labelEn: 'Occasion', labelHi: '', type: 'text', required: true, options: '' },
      { key: '', labelEn: 'Menu type', labelHi: 'मेन्यू', type: 'select', required: false, options: 'Veg, Jain, Veg' },
    ], ['occasion']);
    expect(r).toEqual({ ok: true, questions: [
      { key: 'occasion_1', label: { en: 'Occasion', hi: 'Occasion' }, type: 'text', required: true, maxLength: 300 },
      { key: 'menu_type', label: { en: 'Menu type', hi: 'मेन्यू' }, type: 'select', options: [
        { value: 'veg', label: { en: 'Veg', hi: 'Veg' } }, { value: 'jain', label: { en: 'Jain', hi: 'Jain' } },
      ] },
    ] });
    expect(toQuestions([{ key: '', labelEn: 'Menu', labelHi: '', type: 'select', required: false, options: 'Veg' }], [])).toEqual({ ok: false, problem: { index: 0, field: 'options' } });
    expect(toQuestions([{ key: '', labelEn: '', labelHi: '', type: 'text', required: false, options: '' }], [])).toEqual({ ok: false, problem: { index: 0, field: 'label' } });
    // A saved question keeps its key, so old answers still match.
    const saved = questionForms([{ key: 'song_list', label: { en: 'Songs', hi: 'गाने' }, type: 'text' }]);
    expect(toQuestions(saved, []).ok && (toQuestions(saved, []) as { questions: { key: string }[] }).questions[0].key).toBe('song_list');
  });
});
