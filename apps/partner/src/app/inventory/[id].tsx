import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDateTime, type InventoryInput, type InventoryItem, type ItemCondition, type ItemQuality, type Media, type RentPer } from '@eventseva/app-shared';
import { api } from '../../lib/api';
import { confirm } from '../../lib/confirm';
import { errorText } from '../../lib/errors';
import { categoryName, checkStock, CONDITIONS, intOrNull, invalidateInventory, inventoryKeys, QUALITIES, UNITS, useInventoryItem, useItemCategories, useMovements } from '../../lib/inventory';
import { checkPrice, paiseToRupeesInput, rupeesInputToPaise } from '../../lib/money';
import { toast } from '../../lib/toast';
import { itemUploads } from '../../lib/uploadQueue';
import { c, space } from '../../lib/theme';
import { useForm } from '../../hooks/useForm';
import { useLang } from '../../hooks/useLang';
import { usePhotoUpload } from '../../hooks/usePhotoUpload';
import { Button, LinkButton } from '../../components/Button';
import { Card, CardHeader, Row } from '../../components/Card';
import { ChoiceChip } from '../../components/Chip';
import { Field } from '../../components/Field';
import { MediaGrid } from '../../components/MediaGrid';
import { Notice } from '../../components/Notice';
import { PriceInput } from '../../components/PriceInput';
import { Screen } from '../../components/Screen';
import { Segmented } from '../../components/Segmented';
import { QueryView } from '../../components/States';
import { Txt } from '../../components/Txt';

const MAX_ITEM_PHOTOS = 8;

/** Add or edit one rental item: what it is, price, stock, quality, charges and photos. */
export default function ItemEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const item = useInventoryItem(isNew ? null : id);
  if (isNew) return <ItemForm item={null} />;
  return <QueryView query={item}>{(i) => <ItemForm item={i} />}</QueryView>;
}

const FIELDS = ['name', 'category', 'price', 'total', 'repair', 'qty', 'days', 'quality'] as const;
/** Optional money: empty means ₹0. */
const optionalPaise = (text: string) => (text.trim() ? rupeesInputToPaise(text) : 0);

function ItemForm({ item }: { item: InventoryItem | null }) {
  const { t } = useTranslation();
  const lang = useLang();
  const qc = useQueryClient();
  const form = useForm(FIELDS);
  const categories = useItemCategories();

  const [name, setName] = useState(item?.name ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(item?.categoryId ?? null);
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const knownUnit = !item || (UNITS as readonly string[]).includes(item.unit);
  const [unit, setUnit] = useState(item?.unit ?? 'piece');
  const [customUnit, setCustomUnit] = useState(knownUnit ? '' : item!.unit);
  const [price, setPrice] = useState(item ? paiseToRupeesInput(item.rentPaise) : '');
  const [rentPer, setRentPer] = useState<RentPer>(item?.rentPer ?? 'booking');
  const [total, setTotal] = useState(item ? String(item.totalQty) : '');
  const [repair, setRepair] = useState(item?.repairQty ? String(item.repairQty) : '');
  const [minQty, setMinQty] = useState(item && item.minQty > 1 ? String(item.minQty) : '');
  const [maxQty, setMaxQty] = useState(item?.maxQty ? String(item.maxQty) : '');
  const [minDays, setMinDays] = useState(item && item.minDays > 1 ? String(item.minDays) : '');
  const [maxDays, setMaxDays] = useState(item?.maxDays ? String(item.maxDays) : '');
  const [deposit, setDeposit] = useState(item?.depositPaise ? paiseToRupeesInput(item.depositPaise) : '');
  const [damage, setDamage] = useState(item?.damagePaise ? paiseToRupeesInput(item.damagePaise) : '');
  const [missing, setMissing] = useState(item && item.missingPaise !== item.damagePaise ? paiseToRupeesInput(item.missingPaise) : '');
  const [quality, setQuality] = useState<ItemQuality>(item?.quality ?? 'standard');
  const [qualityText, setQualityText] = useState(item?.qualityLabel ?? '');
  const [condition, setCondition] = useState<ItemCondition>(item?.condition ?? 'good');
  const [description, setDescription] = useState(item?.description ?? '');
  const [active, setActive] = useState(item?.isActive ?? true);

  const priceCheck = checkPrice(price);
  const stock = checkStock(intOrNull(total), intOrNull(repair), intOrNull(minQty), intOrNull(maxQty), intOrNull(minDays), intOrNull(maxDays));
  const money = [deposit, damage, missing].map(optionalPaise);
  const errors = {
    name: name.trim().length < 2 ? t(name.trim() ? 'form.short' : 'inventory.nameRequired') : null,
    category: categoryId ? null : t('inventory.categoryRequired'),
    price: priceCheck.ok ? null : 'price',
    total: stock.total ? t('inventory.totalRequired') : null,
    repair: stock.repair ? t('inventory.repairTooMany') : null,
    qty: stock.qty ? t('inventory.maxBelowMin') : null,
    days: stock.days ? t(stock.days === 'daysRange' ? 'inventory.daysRange' : 'inventory.maxBelowMin') : money.some((m) => m === null) ? t('inventory.moneyInvalid') : null,
    quality: quality === 'custom' && !qualityText.trim() ? t('inventory.qualityLabelRequired') : null,
  };

  const onError = (e: unknown) => toast.error(errorText(t, e));
  const save = useMutation({
    mutationFn: (body: InventoryInput) => (item ? api.patch<InventoryItem>(`/v1/partner/inventory/${item.id}`, body) : api.post<InventoryItem>('/v1/partner/inventory', body)),
    onSuccess: (saved) => {
      invalidateInventory(qc);
      qc.setQueryData(inventoryKeys.item(saved.id), saved);
      toast.success(t(item ? 'inventory.saved' : 'inventory.added'));
      // A new item opens again as "edit", so photos can be added straight away.
      if (item) router.back();
      else router.replace(`/inventory/${saved.id}`);
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.delete<{ result: 'deleted' | 'archived'; openBookings: number }>(`/v1/partner/inventory/${item!.id}`),
    onSuccess: (r) => {
      invalidateInventory(qc);
      toast.success(r.result === 'deleted' ? t('inventory.deleted') : t('inventory.archived', { count: r.openBookings }));
      router.back();
    },
    onError,
  });
  const addCategory = useMutation({
    mutationFn: (nameEn: string) => api.post<{ id: string }>('/v1/partner/item-categories', { nameEn }),
    onSuccess: (cat) => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.categories });
      setCategoryId(cat.id);
      setNewCategory(null);
    },
    onError,
  });

  function submit() {
    if (save.isPending || !form.check(errors) || !priceCheck.ok) return;
    const [depositPaise, damagePaise, missingPaise] = money as number[];
    save.mutate({
      name: name.trim(),
      description: description.trim() || null,
      categoryId: categoryId!,
      unit: unit === 'other' ? customUnit.trim() || 'piece' : unit,
      rentPaise: priceCheck.paise,
      rentPer,
      totalQty: intOrNull(total)!,
      repairQty: intOrNull(repair) ?? 0,
      minQty: intOrNull(minQty) ?? 1,
      maxQty: intOrNull(maxQty),
      minDays: intOrNull(minDays) ?? 1,
      maxDays: intOrNull(maxDays),
      depositPaise,
      damagePaise,
      missingPaise,
      quality,
      qualityLabel: quality === 'custom' ? qualityText.trim() : null,
      condition,
      isActive: active,
    });
  }

  async function confirmRemove() {
    if (!item || remove.isPending) return;
    const ok = await confirm({
      title: t('catalog.deleteTitleNamed', { name: item.name }),
      body: item.openBookings || item.totalQty ? t('inventory.deleteBodyKept') : t('inventory.deleteBody'),
      confirmLabel: t('inventory.delete'),
      cancelLabel: t('common.keep'),
      destructive: true,
    });
    if (ok) remove.mutate();
  }

  const num = (set: (v: string) => void) => (v: string) => set(v.replace(/\D/g, ''));

  return (
    <Screen
      back
      scrollRef={form.scrollRef}
      title={item ? t('inventory.editTitle') : t('inventory.newTitle')}
      footer={
        <>
          <Button testID="save-item" size="lg" label={item ? t('common.saveChanges') : t('inventory.add')} loadingLabel={t('common.saving')} loading={save.isPending} onPress={submit} />
          {item ? <Button testID="delete-item" kind="dangerOutline" icon="trash" label={t('inventory.delete')} loading={remove.isPending} disabled={save.isPending} onPress={() => void confirmRemove()} /> : null}
        </>
      }
    >
      <View {...form.at('name')}>
        <Field ref={form.ref('name')} testID="item-name" label={t('inventory.name')} value={name} onChangeText={setName} onBlur={form.blur('name')} maxLength={80}
          placeholder={t('inventory.namePlaceholder')} error={form.show('name') ? errors.name : null} />
      </View>

      <View style={styles.group} {...form.at('category')} accessibilityRole="radiogroup" accessibilityLabel={t('inventory.category')}>
        <Txt variant="bold" size="sm">{t('inventory.category')}</Txt>
        <View style={styles.chips}>
          {(categories.data ?? []).map((cat) => (
            <ChoiceChip key={cat.id} testID={`item-cat-${cat.key ?? cat.id}`} label={categoryName(cat, lang)} selected={categoryId === cat.id} onPress={() => setCategoryId(cat.id)} />
          ))}
          <ChoiceChip testID="item-cat-new" label={t('inventory.newCategory')} selected={newCategory !== null} onPress={() => setNewCategory('')} />
        </View>
        {newCategory !== null ? (
          <View style={styles.inline}>
            <View style={{ flex: 1 }}>
              <Field testID="new-category" label={t('inventory.newCategoryName')} value={newCategory} onChangeText={setNewCategory} maxLength={40} autoFocus />
            </View>
            <Button testID="add-category" kind="secondary" label={t('inventory.addCategory')} loading={addCategory.isPending}
              disabled={newCategory.trim().length < 2} onPress={() => addCategory.mutate(newCategory.trim())} />
          </View>
        ) : null}
        {form.show('category') && errors.category ? <Txt size="sm" color={c.danger} accessibilityRole="alert">{errors.category}</Txt> : null}
      </View>

      <View {...form.at('price')}>
        <PriceInput ref={form.ref('price')} testID="item-price" label={t('inventory.price')} value={price} onChange={setPrice} onBlur={form.blur('price')} showError={form.show('price')} />
      </View>
      <Segmented options={[{ key: 'booking', label: t('inventory.perBooking') }, { key: 'day', label: t('inventory.perDay') }]} value={rentPer} onChange={setRentPer} />
      <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={t('inventory.unit')}>
        <Txt variant="bold" size="sm">{t('inventory.unit')}</Txt>
        <View style={styles.chips}>
          {UNITS.map((u) => (
            <ChoiceChip key={u} testID={`unit-${u}`} label={t(`inventory.units.${u}`)} selected={unit === u} onPress={() => setUnit(u)} />
          ))}
          <ChoiceChip testID="unit-other" label={t('inventory.units.other')} selected={unit === 'other' || !(UNITS as readonly string[]).includes(unit)} onPress={() => setUnit('other')} />
        </View>
        {unit === 'other' || !(UNITS as readonly string[]).includes(unit) ? (
          <Field testID="unit-custom" label={t('inventory.unitCustom')} value={customUnit} onChangeText={(v) => { setCustomUnit(v); setUnit('other'); }} maxLength={20} placeholder={t('inventory.unitPlaceholder')} />
        ) : null}
      </View>

      <View style={styles.pair}>
        <View style={{ flex: 1 }} {...form.at('total')}>
          <Field ref={form.ref('total')} testID="item-total" label={t('inventory.total')} value={total} onChangeText={num(setTotal)} onBlur={form.blur('total')} keyboardType="number-pad" maxLength={6}
            error={form.show('total') ? errors.total : null} />
        </View>
        <View style={{ flex: 1 }} {...form.at('repair')}>
          <Field testID="item-repair" label={t('inventory.repair')} hint={t('inventory.repairHint')} value={repair} onChangeText={num(setRepair)} onBlur={form.blur('repair')} keyboardType="number-pad" maxLength={6}
            error={form.show('repair') ? errors.repair : null} />
        </View>
      </View>
      <View {...form.at('qty')}>
        <View style={styles.pair}>
          <View style={{ flex: 1 }}><Field testID="item-min-qty" label={t('inventory.minQty')} value={minQty} onChangeText={num(setMinQty)} onBlur={form.blur('qty')} keyboardType="number-pad" maxLength={6} placeholder="1" /></View>
          <View style={{ flex: 1 }}><Field testID="item-max-qty" label={t('inventory.maxQty')} value={maxQty} onChangeText={num(setMaxQty)} onBlur={form.blur('qty')} keyboardType="number-pad" maxLength={6} placeholder={t('inventory.noLimit')} /></View>
        </View>
        {form.show('qty') && errors.qty ? <Txt size="sm" color={c.danger} accessibilityRole="alert">{errors.qty}</Txt> : null}
      </View>
      <View {...form.at('days')}>
        <View style={styles.pair}>
          <View style={{ flex: 1 }}><Field testID="item-min-days" label={t('inventory.minDays')} value={minDays} onChangeText={num(setMinDays)} onBlur={form.blur('days')} keyboardType="number-pad" maxLength={2} placeholder="1" /></View>
          <View style={{ flex: 1 }}><Field testID="item-max-days" label={t('inventory.maxDays')} value={maxDays} onChangeText={num(setMaxDays)} onBlur={form.blur('days')} keyboardType="number-pad" maxLength={2} placeholder={t('inventory.noLimit')} /></View>
        </View>
        {form.show('days') && errors.days ? <Txt size="sm" color={c.danger} accessibilityRole="alert">{errors.days}</Txt> : null}
      </View>

      <Card style={{ gap: space.md }}>
        <CardHeader title={t('inventory.chargesTitle')} />
        <Field testID="item-deposit" label={t('inventory.deposit')} hint={t('inventory.depositHint')} prefix="₹" value={deposit} onChangeText={setDeposit} keyboardType="decimal-pad" maxLength={9} placeholder="0" />
        <Field testID="item-damage" label={t('inventory.damage')} hint={t('inventory.damageHint')} prefix="₹" value={damage} onChangeText={setDamage} keyboardType="decimal-pad" maxLength={9} placeholder="0" />
        <Field testID="item-missing" label={t('inventory.missing')} hint={t('inventory.missingHint')} prefix="₹" value={missing} onChangeText={setMissing} keyboardType="decimal-pad" maxLength={9} placeholder={damage || '0'} />
      </Card>

      <View style={styles.group} {...form.at('quality')} accessibilityRole="radiogroup" accessibilityLabel={t('inventory.qualityTitle')}>
        <Txt variant="bold" size="sm">{t('inventory.qualityTitle')}</Txt>
        <View style={styles.chips}>
          {QUALITIES.map((q) => (
            <ChoiceChip key={q} testID={`quality-${q}`} label={t(`inventory.quality.${q}`)} selected={quality === q} onPress={() => setQuality(q)} />
          ))}
        </View>
        {quality === 'custom' ? (
          <Field testID="quality-label" label={t('inventory.qualityLabel')} value={qualityText} onChangeText={setQualityText} maxLength={30} onBlur={form.blur('quality')}
            error={form.show('quality') ? errors.quality : null} />
        ) : null}
      </View>
      <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={t('inventory.conditionTitle')}>
        <Txt variant="bold" size="sm">{t('inventory.conditionTitle')}</Txt>
        <View style={styles.chips}>
          {CONDITIONS.map((k) => (
            <ChoiceChip key={k} testID={`condition-${k}`} label={t(`inventory.condition.${k}`)} selected={condition === k} onPress={() => setCondition(k)} />
          ))}
        </View>
        {condition === 'needs_repair' ? <Notice tone="warning">{t('inventory.needsRepairNote')}</Notice> : null}
      </View>
      <Field label={t('inventory.description')} value={description} onChangeText={setDescription} multiline maxLength={1000} placeholder={t('inventory.descriptionPlaceholder')} />
      <View style={styles.group}>
        <Txt variant="bold" size="sm">{t('inventory.visibility')}</Txt>
        <Segmented options={[{ key: 'on', label: t('inventory.visible') }, { key: 'off', label: t('inventory.hidden') }]} value={active ? 'on' : 'off'} onChange={(k) => setActive(k === 'on')} />
      </View>
      {item ? <Txt size="xs" color={c.textMuted}>{t('inventory.editNote')}</Txt> : null}

      {item ? <ItemPhotos item={item} /> : <Notice tone="plain" icon="image">{t('inventory.photosAfterSave')}</Notice>}
      {item ? <History itemId={item.id} /> : null}
    </Screen>
  );
}

/** Up to 8 photos per item; they show to customers after the team's review, like gallery photos. */
function ItemPhotos({ item }: { item: InventoryItem }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const media: Media[] = item.photos.map((p, i) => ({ ...p, type: 'photo', durationSec: null, isCover: false, coverCrop: null, sortOrder: i }));
  const queue = itemUploads(item.id);
  const upload = usePhotoUpload({ media, limits: { photos: MAX_ITEM_PHOTOS, videos: 0 }, videos: false, queue });
  const remove = useMutation({
    mutationFn: (mediaId: string) => api.delete(`/v1/partner/media/${mediaId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: inventoryKeys.item(item.id) }),
    onError: (e) => toast.error(errorText(t, e)),
  });
  // Finished uploads appear as real photos once the item is read again.
  const done = upload.items.filter((u) => u.state === 'done').length;
  const [seen, setSeen] = useState(done);
  if (done !== seen) {
    setSeen(done);
    invalidateInventory(qc);
  }
  return (
    <Card>
      <CardHeader title={t('inventory.photos', { n: item.photos.length, max: MAX_ITEM_PHOTOS })} />
      <MediaGrid
        compact
        media={media}
        uploads={upload.items}
        onAdd={() => void upload.pick()}
        canAdd={upload.canAdd}
        onMore={async (m) => {
          const ok = await confirm({ title: t('photos.deleteTitle'), body: t('photos.deleteBody'), confirmLabel: t('inventory.deletePhoto'), cancelLabel: t('common.keep'), destructive: true });
          if (ok) remove.mutate(m.id);
        }}
        onCancelUpload={upload.cancel}
        onRetryUpload={upload.retry}
        onDismissUpload={upload.dismiss}
      />
      <Txt size="xs" color={c.textMuted}>{t('inventory.photosNote')}</Txt>
    </Card>
  );
}

/** Every change to the stock: listed, dispatched, returned, damaged, missing, repaired. */
function History({ itemId }: { itemId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const moves = useMovements(itemId);
  const [all, setAll] = useState(false);
  const list = moves.data ?? [];
  if (!list.length) return null;
  return (
    <Card>
      <CardHeader title={t('inventory.history')} right={list.length > 5 && !all ? <LinkButton label={t('inventory.showAll')} onPress={() => setAll(true)} /> : null} />
      {(all ? list : list.slice(0, 5)).map((m, i) => (
        <Row key={m.id} first={i === 0}>
          <Txt size="sm" style={{ flex: 1 }}>{t(`inventory.moves.${m.kind}`, { n: m.qty })}</Txt>
          <Txt size="xs" color={c.textMuted}>{formatDateTime(m.createdAt, lang)}</Txt>
        </Row>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm },
  inline: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  pair: { flexDirection: 'row', gap: space.md },
});
