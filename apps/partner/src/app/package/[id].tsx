import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Package } from '@eventseva/app-shared';
import { MAX_PACKAGE_ITEMS as MAX_ITEMS } from '../../lib/catalog';
import { checkPrice, paiseToRupeesInput } from '../../lib/money';
import { useVendor } from '../../lib/queries';
import { c, space } from '../../lib/theme';
import { useCatalogMutations } from '../../hooks/useCatalogMutations';
import { useForm } from '../../hooks/useForm';
import { toast } from '../../lib/toast';
import { Button } from '../../components/Button';
import { ChoiceChip } from '../../components/Chip';
import { Field } from '../../components/Field';
import { PriceInput } from '../../components/PriceInput';
import { Screen } from '../../components/Screen';
import { EmptyInline, QueryView } from '../../components/States';
import { Txt } from '../../components/Txt';

/** Add or edit a package: a title, what is included (chips) and one price. */
export default function PackageEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vendor = useVendor();
  return <QueryView query={vendor}>{(v) => <PackageForm pkg={id === 'new' ? null : v?.packages.find((p) => p.id === id) ?? null} isNew={id === 'new'} />}</QueryView>;
}

const FIELDS = ['title', 'items', 'price'] as const;

function PackageForm({ pkg, isNew }: { pkg: Package | null; isNew: boolean }) {
  const { t } = useTranslation();
  const { save, remove, confirmRemove } = useCatalogMutations('packages', pkg?.id ?? null);
  const form = useForm(FIELDS);
  const [title, setTitle] = useState(pkg?.title ?? '');
  const [items, setItems] = useState<string[]>(pkg?.items ?? []);
  const [item, setItem] = useState('');
  const [price, setPrice] = useState(pkg ? paiseToRupeesInput(pkg.pricePaise) : '');

  const priceCheck = checkPrice(price);
  const errors = {
    title: title.trim().length < 2 ? t(title.trim() ? 'form.short' : 'package.titleRequired') : null,
    items: items.length === 0 ? t('package.itemsRequired') : null,
    price: priceCheck.ok ? null : 'price',
  };
  const duplicate = !!item.trim() && items.includes(item.trim());

  function addItem() {
    const v = item.trim();
    if (!v || items.length >= MAX_ITEMS || items.includes(v)) return;
    setItems([...items, v.slice(0, 60)]);
    setItem('');
  }

  /** A small delete: gone at once, with Undo (UX.md §4). */
  function removeItem(it: string) {
    const index = items.indexOf(it);
    setItems((list) => list.filter((x) => x !== it));
    toast.info(t('package.itemRemoved', { item: it }), {
      action: {
        label: t('common.undo'),
        onPress: () =>
          setItems((list) => {
            if (list.includes(it)) return list;
            const next = [...list];
            next.splice(Math.min(index, next.length), 0, it);
            return next;
          }),
      },
    });
  }

  function submit() {
    if (save.isPending || !form.check(errors) || !priceCheck.ok) return;
    save.mutate({ title: title.trim(), items, pricePaise: priceCheck.paise });
  }

  if (!isNew && !pkg) {
    return (
      <Screen back title={t('package.editTitle')}>
        <EmptyInline icon="search" text={t('catalog.notFound')} />
      </Screen>
    );
  }

  return (
    <Screen
      back
      scrollRef={form.scrollRef}
      title={isNew ? t('package.newTitle') : t('package.editTitle')}
      footer={
        <>
          <Button testID="save-package" size="lg" label={isNew ? t('package.add') : t('common.saveChanges')} loadingLabel={t('common.saving')} loading={save.isPending} onPress={submit} />
          {!isNew ? <Button testID="delete-package" kind="dangerOutline" icon="trash" label={t('package.delete')} loading={remove.isPending} disabled={save.isPending} onPress={() => confirmRemove(pkg?.title ?? '')} /> : null}
        </>
      }
    >
      <View {...form.at('title')}>
        <Field
          ref={form.ref('title')}
          testID="package-title"
          label={t('package.title')}
          value={title}
          onChangeText={setTitle}
          onBlur={form.blur('title')}
          maxLength={80}
          placeholder={t('package.titlePlaceholder')}
          error={form.show('title') ? errors.title : null}
        />
      </View>
      <View style={{ gap: space.sm }} {...form.at('items')}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field
              ref={form.ref('items')}
              testID="package-item"
              label={t('package.items', { n: items.length, max: MAX_ITEMS })}
              value={item}
              onChangeText={setItem}
              onBlur={form.blur('items')}
              maxLength={60}
              placeholder={t('package.itemPlaceholder')}
              onSubmitEditing={addItem}
              submitBehavior="submit"
              returnKeyType="done"
              editable={items.length < MAX_ITEMS}
              error={duplicate ? t('package.itemDuplicate') : form.show('items') && errors.items ? errors.items : null}
            />
          </View>
          <Button testID="add-item" kind="secondary" icon="plus" label={t('common.add')} onPress={addItem} disabled={!item.trim() || duplicate || items.length >= MAX_ITEMS} style={{ marginTop: 28, minHeight: 56 }} />
        </View>
        <View style={styles.chips}>
          {items.map((it) => (
            <ChoiceChip key={it} testID={`item-${it}`} label={it} onRemove={() => removeItem(it)} />
          ))}
        </View>
        {items.length >= MAX_ITEMS ? <Txt size="xs">{t('package.itemsMax', { max: MAX_ITEMS })}</Txt> : null}
      </View>
      <View {...form.at('price')}>
        <PriceInput ref={form.ref('price')} testID="package-price" label={t('package.price')} value={price} onChange={setPrice} onBlur={form.blur('price')} showError={form.show('price')} />
      </View>
      <Txt size="xs" color={c.textMuted}>
        {t('catalog.note')}
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm },
});
