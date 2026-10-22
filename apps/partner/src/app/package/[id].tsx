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
import { Button } from '../../components/Button';
import { ChoiceChip } from '../../components/Chip';
import { Field } from '../../components/Field';
import { PriceInput } from '../../components/PriceInput';
import { Screen } from '../../components/Screen';
import { QueryView } from '../../components/States';
import { Txt } from '../../components/Txt';

/** Add or edit a package: a title, what is included (chips) and one price. */
export default function PackageEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vendor = useVendor();
  return <QueryView query={vendor}>{(v) => <PackageForm pkg={id === 'new' ? null : v?.packages.find((p) => p.id === id) ?? null} isNew={id === 'new'} />}</QueryView>;
}

function PackageForm({ pkg, isNew }: { pkg: Package | null; isNew: boolean }) {
  const { t } = useTranslation();
  const { save, remove, confirmRemove } = useCatalogMutations('packages', pkg?.id ?? null);
  const [title, setTitle] = useState(pkg?.title ?? '');
  const [items, setItems] = useState<string[]>(pkg?.items ?? []);
  const [item, setItem] = useState('');
  const [price, setPrice] = useState(pkg ? paiseToRupeesInput(pkg.pricePaise) : '');
  const [tried, setTried] = useState(false);

  const priceCheck = checkPrice(price);
  const titleError = title.trim().length < 2 ? t('form.short') : null;
  const itemsError = items.length === 0 ? t('package.itemsRequired') : null;

  function addItem() {
    const v = item.trim();
    if (!v || items.length >= MAX_ITEMS || items.includes(v)) return;
    setItems([...items, v.slice(0, 60)]);
    setItem('');
  }

  function submit() {
    setTried(true);
    if (titleError || itemsError || !priceCheck.ok) return;
    save.mutate({ title: title.trim(), items, pricePaise: priceCheck.paise });
  }

  if (!isNew && !pkg) {
    return (
      <Screen back title={t('package.editTitle')}>
        <Txt>{t('catalog.notFound')}</Txt>
      </Screen>
    );
  }

  return (
    <Screen
      back
      title={isNew ? t('package.newTitle') : t('package.editTitle')}
      footer={
        <>
          <Button testID="save-package" size="lg" label={t('common.save')} loading={save.isPending} onPress={submit} />
          {!isNew ? <Button kind="danger" label={t('common.delete')} loading={remove.isPending} onPress={confirmRemove} /> : null}
        </>
      }
    >
      <Field testID="package-title" label={t('package.title')} value={title} onChangeText={setTitle} maxLength={80} placeholder={t('package.titlePlaceholder')} error={tried ? titleError : null} />
      <View style={{ gap: space.sm }}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field
              testID="package-item"
              label={t('package.items', { n: items.length, max: MAX_ITEMS })}
              value={item}
              onChangeText={setItem}
              maxLength={60}
              placeholder={t('package.itemPlaceholder')}
              onSubmitEditing={addItem}
              submitBehavior="submit"
              returnKeyType="done"
              editable={items.length < MAX_ITEMS}
            />
          </View>
          <Button testID="add-item" kind="secondary" icon="plus" label={t('common.add')} onPress={addItem} disabled={!item.trim() || items.length >= MAX_ITEMS} style={{ marginTop: 28, height: 56 }} />
        </View>
        <View style={styles.chips}>
          {items.map((it) => (
            <ChoiceChip key={it} label={it} selected onRemove={() => setItems(items.filter((x) => x !== it))} />
          ))}
        </View>
        {tried && itemsError ? <Txt color={c.danger}>{itemsError}</Txt> : null}
        {items.length >= MAX_ITEMS ? <Txt size="xs">{t('package.itemsMax', { max: MAX_ITEMS })}</Txt> : null}
      </View>
      <PriceInput testID="package-price" label={t('package.price')} value={price} onChange={setPrice} showError={tried} />
      <Txt size="xs">{t('catalog.note')}</Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm },
});
