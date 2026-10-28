// The parts of the service editor for what a vendor configures beyond price and rules: availability,
// the events served, ways to book (rate plans), price rules and their own questions. State and checks
// live in lib/serviceConfig.ts; this file only draws them.
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { EVENT_TYPES, type EventType, type PricingModel } from '@eventseva/app-shared';
import {
  newPlan,
  newPriceRule,
  newQuestion,
  WEEKDAYS,
  type AvailabilityForm,
  type PlanForm,
  type PriceRuleForm,
  type QuestionForm,
} from '../lib/serviceConfig';
import { c, space } from '../lib/theme';
import { Button, LinkButton } from './Button';
import { Card, CardHeader } from './Card';
import { ChoiceChip } from './Chip';
import { Field } from './Field';
import { Segmented } from './Segmented';
import { Txt } from './Txt';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const replaceAt = <T,>(list: T[], i: number, v: T) => list.map((x, j) => (j === i ? v : x));
const removeAt = <T,>(list: T[], i: number) => list.filter((_, j) => j !== i);

function Weekdays({ value, onChange, testID }: { value: number[]; onChange: (v: number[]) => void; testID: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.chips}>
      {WEEKDAYS.map((d) => (
        <ChoiceChip key={d} multi testID={`${testID}-${d}`} label={t(`calendar.weekdays.${DAY_KEYS[d]}`)} selected={value.includes(d)} onPress={() => onChange(toggle(value, d))} />
      ))}
    </View>
  );
}

function EventTypes({ value, onChange, testID }: { value: EventType[]; onChange: (v: EventType[]) => void; testID: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.chips}>
      {EVENT_TYPES.map((e) => (
        <ChoiceChip key={e} multi testID={`${testID}-${e}`} label={t(`eventType.${e}`)} selected={value.includes(e)} onPress={() => onChange(toggle(value, e))} />
      ))}
    </View>
  );
}

const Problem = ({ text }: { text: string | null }) =>
  text ? (
    <Txt size="sm" color={c.danger} accessibilityRole="alert">
      {text}
    </Txt>
  ) : null;

export function AvailabilityCard({ value, onChange, error }: { value: AvailabilityForm; onChange: (v: AvailabilityForm) => void; error: string | null }) {
  const { t } = useTranslation();
  return (
    <Card style={styles.card}>
      <CardHeader title={t('serviceConfig.availability')} />
      <Txt variant="bold" size="sm">{t('serviceConfig.workingDays')}</Txt>
      <Weekdays testID="working-day" value={value.workingDays} onChange={(workingDays) => onChange({ ...value, workingDays })} />
      <Txt size="xs" color={c.textMuted}>{t('serviceConfig.workingDaysHint')}</Txt>
      <Field
        testID="blocked-dates"
        label={`${t('serviceConfig.blockedDates')} ${t('form.optional')}`}
        hint={t('serviceConfig.blockedDatesHint')}
        value={value.blockedDates}
        onChangeText={(blockedDates) => onChange({ ...value, blockedDates })}
        placeholder="2026-12-24, 2026-12-25"
        autoCapitalize="none"
      />
      <Field
        testID="max-advance-days"
        label={`${t('serviceConfig.maxAdvanceDays')} ${t('form.optional')}`}
        value={value.maxAdvanceDays}
        onChangeText={(v) => onChange({ ...value, maxAdvanceDays: v.replace(/\D/g, '') })}
        keyboardType="number-pad"
        maxLength={3}
      />
      <Field
        testID="max-per-day"
        label={`${t('serviceConfig.maxPerDay')} ${t('form.optional')}`}
        value={value.maxPerDay}
        onChangeText={(v) => onChange({ ...value, maxPerDay: v.replace(/\D/g, '') })}
        keyboardType="number-pad"
        maxLength={4}
      />
      <Problem text={error} />
    </Card>
  );
}

export function EventTypesCard({ value, onChange }: { value: EventType[]; onChange: (v: EventType[]) => void }) {
  const { t } = useTranslation();
  return (
    <Card style={styles.card}>
      <CardHeader title={t('serviceConfig.eventTypes')} />
      <Txt size="xs" color={c.textMuted}>{t('serviceConfig.eventTypesHint')}</Txt>
      <EventTypes testID="event-type" value={value} onChange={onChange} />
    </Card>
  );
}

export function PlansCard({ value, onChange, models, error }: { value: PlanForm[]; onChange: (v: PlanForm[]) => void; models: readonly PricingModel[]; error: string | null }) {
  const { t } = useTranslation();
  const add = () => onChange(value.length ? [...value, newPlan(models[0])] : [newPlan(models[0]), newPlan(models[models.length > 1 ? 1 : 0])]);
  return (
    <Card style={styles.card}>
      <CardHeader title={t('serviceConfig.plans')} />
      <Txt size="xs" color={c.textMuted}>{t('serviceConfig.plansHint')}</Txt>
      {value.map((p, i) => (
        <View key={i} style={styles.item} testID={`plan-${i}`}>
          <Field testID={`plan-${i}-name`} label={t('serviceConfig.planName')} value={p.nameEn} onChangeText={(nameEn) => onChange(replaceAt(value, i, { ...p, nameEn }))} maxLength={80} placeholder={t('serviceConfig.planNamePlaceholder')} />
          <Field testID={`plan-${i}-name-hi`} label={`${t('serviceConfig.inHindi')} ${t('form.optional')}`} value={p.nameHi} onChangeText={(nameHi) => onChange(replaceAt(value, i, { ...p, nameHi }))} maxLength={80} />
          {models.length > 1 ? (
            <Segmented options={models.map((m) => ({ key: m, label: t(`engine.model.${m}`) }))} value={p.model} onChange={(model) => onChange(replaceAt(value, i, { ...p, model }))} />
          ) : null}
          {p.model !== 'quote' ? (
            <Field testID={`plan-${i}-rate`} label={t(`engine.rateLabel.${p.model}`)} prefix="₹" value={p.rate} onChangeText={(v) => onChange(replaceAt(value, i, { ...p, rate: v.replace(/[^\d.]/g, '') }))} keyboardType="decimal-pad" maxLength={9} />
          ) : null}
          <LinkButton testID={`plan-${i}-remove`} label={t('serviceConfig.remove')} color={c.danger} onPress={() => onChange(value.length === 2 ? [] : removeAt(value, i))} />
        </View>
      ))}
      {value.length < 6 ? <Button testID="add-plan" kind="outline" icon="plus" label={value.length ? t('serviceConfig.addPlan') : t('serviceConfig.addPlans')} onPress={add} /> : null}
      <Problem text={error} />
    </Card>
  );
}

export function PriceRulesCard({ value, onChange, error }: { value: PriceRuleForm[]; onChange: (v: PriceRuleForm[]) => void; error: string | null }) {
  const { t } = useTranslation();
  return (
    <Card style={styles.card}>
      <CardHeader title={t('serviceConfig.priceRules')} />
      <Txt size="xs" color={c.textMuted}>{t('serviceConfig.priceRulesHint')}</Txt>
      {value.map((r, i) => (
        <View key={i} style={styles.item} testID={`price-rule-${i}`}>
          <Field testID={`price-rule-${i}-label`} label={t('serviceConfig.ruleLabel')} value={r.labelEn} onChangeText={(labelEn) => onChange(replaceAt(value, i, { ...r, labelEn }))} maxLength={80} placeholder={t('serviceConfig.ruleLabelPlaceholder')} />
          <Segmented
            options={[{ key: 'percent', label: t('serviceConfig.percent') }, { key: 'amount', label: t('serviceConfig.amount') }]}
            value={r.kind}
            onChange={(kind) => onChange(replaceAt(value, i, { ...r, kind }))}
          />
          <Field
            testID={`price-rule-${i}-value`}
            label={t(r.kind === 'percent' ? 'serviceConfig.percentValue' : 'serviceConfig.amountValue')}
            prefix={r.kind === 'amount' ? '₹' : '%'}
            value={r.value}
            onChangeText={(v) => onChange(replaceAt(value, i, { ...r, value: v.replace(/[^\d.+-]/g, '') }))}
            keyboardType="numbers-and-punctuation"
            maxLength={9}
          />
          <Txt variant="bold" size="sm">{t('serviceConfig.onDays')}</Txt>
          <Weekdays testID={`price-rule-${i}-day`} value={r.days} onChange={(days) => onChange(replaceAt(value, i, { ...r, days }))} />
          <Txt variant="bold" size="sm">{t('serviceConfig.forEvents')}</Txt>
          <EventTypes testID={`price-rule-${i}-event`} value={r.eventTypes} onChange={(eventTypes) => onChange(replaceAt(value, i, { ...r, eventTypes }))} />
          <View style={styles.row}>
            <View style={styles.flex}><Field testID={`price-rule-${i}-from`} label={`${t('serviceConfig.from')} ${t('form.optional')}`} value={r.from} onChangeText={(from) => onChange(replaceAt(value, i, { ...r, from }))} placeholder="2026-11-01" autoCapitalize="none" maxLength={10} /></View>
            <View style={styles.flex}><Field testID={`price-rule-${i}-until`} label={`${t('serviceConfig.until')} ${t('form.optional')}`} value={r.until} onChangeText={(until) => onChange(replaceAt(value, i, { ...r, until }))} placeholder="2026-12-15" autoCapitalize="none" maxLength={10} /></View>
          </View>
          <LinkButton testID={`price-rule-${i}-remove`} label={t('serviceConfig.remove')} color={c.danger} onPress={() => onChange(removeAt(value, i))} />
        </View>
      ))}
      {value.length < 20 ? <Button testID="add-price-rule" kind="outline" icon="plus" label={t('serviceConfig.addPriceRule')} onPress={() => onChange([...value, newPriceRule()])} /> : null}
      <Problem text={error} />
    </Card>
  );
}

export function QuestionsCard({ value, onChange, error, categoryQuestions }: { value: QuestionForm[]; onChange: (v: QuestionForm[]) => void; error: string | null; categoryQuestions: string[] }) {
  const { t } = useTranslation();
  return (
    <Card style={styles.card}>
      <CardHeader title={t('serviceConfig.questions')} />
      <Txt size="xs" color={c.textMuted}>{t('serviceConfig.questionsHint')}</Txt>
      {categoryQuestions.length ? <Txt size="xs" color={c.textMuted}>{t('serviceConfig.alreadyAsked', { list: categoryQuestions.join(', ') })}</Txt> : null}
      {value.map((q, i) => (
        <View key={i} style={styles.item} testID={`question-${i}`}>
          <Field testID={`question-${i}-label`} label={t('serviceConfig.question')} value={q.labelEn} onChangeText={(labelEn) => onChange(replaceAt(value, i, { ...q, labelEn }))} maxLength={80} placeholder={t('serviceConfig.questionPlaceholder')} />
          <Field testID={`question-${i}-label-hi`} label={`${t('serviceConfig.inHindi')} ${t('form.optional')}`} value={q.labelHi} onChangeText={(labelHi) => onChange(replaceAt(value, i, { ...q, labelHi }))} maxLength={80} />
          <Segmented
            options={[{ key: 'text', label: t('serviceConfig.typeText') }, { key: 'boolean', label: t('serviceConfig.typeYesNo') }, { key: 'select', label: t('serviceConfig.typeChoice') }]}
            value={q.type}
            onChange={(type) => onChange(replaceAt(value, i, { ...q, type }))}
          />
          {q.type === 'select' ? (
            <Field testID={`question-${i}-options`} label={t('serviceConfig.choices')} hint={t('serviceConfig.choicesHint')} value={q.options} onChangeText={(options) => onChange(replaceAt(value, i, { ...q, options }))} maxLength={500} />
          ) : null}
          <ChoiceChip multi testID={`question-${i}-required`} label={t('serviceConfig.required')} selected={q.required} onPress={() => onChange(replaceAt(value, i, { ...q, required: !q.required }))} />
          <LinkButton testID={`question-${i}-remove`} label={t('serviceConfig.remove')} color={c.danger} onPress={() => onChange(removeAt(value, i))} />
        </View>
      ))}
      {value.length < 15 ? <Button testID="add-question" kind="outline" icon="plus" label={t('serviceConfig.addQuestion')} onPress={() => onChange([...value, newQuestion()])} /> : null}
      <Problem text={error} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  item: { gap: space.sm, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: c.lavender },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
});
