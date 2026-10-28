import { availabilityForm, conditionAnswers, removeQuestion, planForms, priceRuleForms, questionForms, toAvailability, toPlans, toPriceRules, toQuestions } from '../lib/serviceConfig';

describe('service config forms', () => {
  it('availability: every day means no limit; dates and numbers are checked', () => {
    expect(toAvailability({ workingDays: [], blockedDates: '', maxAdvanceDays: '', maxPerDay: '', breaks: '', maxConcurrent: '' })).toEqual({ ok: true, rules: {} });
    expect(toAvailability({ workingDays: [0, 1, 2, 3, 4, 5, 6], blockedDates: '', maxAdvanceDays: '', maxPerDay: '', breaks: '', maxConcurrent: '' })).toEqual({ ok: true, rules: {} });
    expect(toAvailability({ workingDays: [6, 0], blockedDates: '2026-12-25, 2026-12-24 2026-12-25', maxAdvanceDays: '90', maxPerDay: '2', breaks: '', maxConcurrent: '' })).toEqual({
      ok: true, rules: { workingDays: [0, 6], blockedDates: ['2026-12-24', '2026-12-25'], maxAdvanceDays: 90, maxPerDay: 2 },
    });
    expect(toAvailability({ workingDays: [], blockedDates: '2026-02-30', maxAdvanceDays: '', maxPerDay: '', breaks: '', maxConcurrent: '' })).toEqual({ ok: false, problem: 'dates' });
    expect(toAvailability({ workingDays: [], blockedDates: '', maxAdvanceDays: '900', maxPerDay: '', breaks: '', maxConcurrent: '' })).toEqual({ ok: false, problem: 'advance' });
    expect(toAvailability({ workingDays: [], blockedDates: '', maxAdvanceDays: '', maxPerDay: '0', breaks: '', maxConcurrent: '' })).toEqual({ ok: false, problem: 'perDay' });
    const base = { workingDays: [], blockedDates: '', maxAdvanceDays: '', maxPerDay: '' };
    expect(toAvailability({ ...base, breaks: '13:00-14:00, 19:00 – 19:30', maxConcurrent: '3' })).toEqual({ ok: true, rules: { breaks: [{ from: '13:00', to: '14:00' }, { from: '19:00', to: '19:30' }], maxConcurrent: 3 } });
    expect(toAvailability({ ...base, breaks: '14:00-13:00', maxConcurrent: '' })).toEqual({ ok: false, problem: 'breaks' });
    expect(toAvailability({ ...base, breaks: '', maxConcurrent: '1' })).toEqual({ ok: true, rules: {} });
    expect(toAvailability({ ...base, breaks: '', maxConcurrent: '500' })).toEqual({ ok: false, problem: 'concurrent' });
    expect(availabilityForm({ workingDays: [1], blockedDates: ['2026-12-24'], maxPerDay: 3 })).toEqual({ workingDays: [1], blockedDates: '2026-12-24', maxAdvanceDays: '', maxPerDay: '3', breaks: '', maxConcurrent: '' });
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
      { key: '', labelEn: 'Occasion', labelHi: '', type: 'text', required: true, options: '', showIf: null },
      { key: '', labelEn: 'Menu type', labelHi: 'मेन्यू', type: 'select', required: false, options: 'Veg, Jain, Veg', showIf: null },
    ], ['occasion']);
    expect(r).toEqual({ ok: true, questions: [
      { key: 'occasion_1', label: { en: 'Occasion', hi: 'Occasion' }, type: 'text', required: true, maxLength: 300 },
      { key: 'menu_type', label: { en: 'Menu type', hi: 'मेन्यू' }, type: 'select', options: [
        { value: 'veg', label: { en: 'Veg', hi: 'Veg' } }, { value: 'jain', label: { en: 'Jain', hi: 'Jain' } },
      ] },
    ] });
    expect(toQuestions([{ key: '', labelEn: 'Menu', labelHi: '', type: 'select', required: false, options: 'Veg', showIf: null }], [])).toEqual({ ok: false, problem: { index: 0, field: 'options' } });
    expect(toQuestions([{ key: '', labelEn: '', labelHi: '', type: 'text', required: false, options: '', showIf: null }], [])).toEqual({ ok: false, problem: { index: 0, field: 'label' } });
    // A saved question keeps its key, so old answers still match.
    const saved = questionForms([{ key: 'song_list', label: { en: 'Songs', hi: 'गाने' }, type: 'text' }]);
    expect(toQuestions(saved, []).ok && (toQuestions(saved, []) as { questions: { key: string }[] }).questions[0].key).toBe('song_list');
  });

  it('a question asked only after an earlier answer: mapped to keys and values, kept through edits and removals', () => {
    const forms = [
      { key: '', labelEn: 'Venue', labelHi: '', type: 'select' as const, required: true, options: 'Indoor, Open lawn', showIf: null },
      { key: '', labelEn: 'Generator?', labelHi: '', type: 'boolean' as const, required: true, options: '', showIf: { question: 0, answers: ['Open lawn'] } },
      { key: '', labelEn: 'How many kVA?', labelHi: '', type: 'number' as const, required: false, options: '', showIf: { question: 1, answers: ['yes'] } },
    ];
    const r = toQuestions(forms, []);
    expect(r.ok && r.questions.map((q) => q.showIf)).toEqual([undefined, { key: 'venue', values: ['open_lawn'] }, { key: 'generator', values: [true] }]);
    // Read back from the saved fields, the form is the same.
    expect(questionForms(r.ok ? r.questions : []).map((f) => f.showIf)).toEqual([null, { question: 0, answers: ['Open lawn'] }, { question: 1, answers: ['yes'] }]);
    expect(toQuestions([{ ...forms[0] }, { ...forms[1], showIf: { question: 0, answers: [] } }], [])).toEqual({ ok: false, problem: { index: 1, field: 'condition' } });
    expect(toQuestions([{ ...forms[0], showIf: { question: 1, answers: ['yes'] } }, forms[1]], [])).toEqual({ ok: false, problem: { index: 0, field: 'condition' } });
    // Removing the first question drops the condition on it and shifts the later one.
    expect(removeQuestion(forms, 0).map((f) => f.showIf)).toEqual([null, { question: 0, answers: ['yes'] }]);
    expect(conditionAnswers(forms[0])).toEqual(['Indoor', 'Open lawn']);
  });
});
