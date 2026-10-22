// Profile → Language (Language board). Saved to the account with PATCH /v1/me {language}.
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Language } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { useMe, useSession } from '../lib/session';
import { c, radius, space } from '../lib/theme';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Screen, ScreenHeader } from '../components/Screen';

export default function LanguageScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const session = useSession();
  const qc = useQueryClient();
  const [choice, setChoice] = useState<Language>(me.language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const updated = choice === me.language ? me : await api.updateMe({ language: choice });
      session.setMe(updated);
      // Category names and notifications come back in the new language.
      await qc.invalidateQueries();
      router.back();
    } catch (e) {
      setError(errorText(t, e));
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          {error ? (
            <AppText size="sm" color={c.danger} align="center">
              {error}
            </AppText>
          ) : null}
          <Button label={t('language.apply')} onPress={apply} loading={busy} />
        </>
      }
    >
      <ScreenHeader title={t('language.title')} subtitle={t('language.subtitle')} />
      <View style={styles.body}>
        <View style={styles.tiles} accessibilityRole="radiogroup" accessibilityLabel={t('language.title')}>
          <Tile big={t('language.english')} small={t('language.englishLabel')} lang="en" selected={choice === 'en'} onPress={() => setChoice('en')} />
          <Tile big={t('language.hindiNative')} small={t('language.hindiLabel')} lang="hi" selected={choice === 'hi'} onPress={() => setChoice('hi')} />
        </View>
        <View style={styles.note}>
          <AppText size={14}>{t('language.note')}</AppText>
          {/* The same note in the other script, so either reader understands the choice. */}
          <AppText size={14} lang={me.language === 'hi' ? 'en' : 'hi'}>
            {t('language.noteOther')}
          </AppText>
        </View>
        <AppText size="sm">{t('language.later')}</AppText>
      </View>
    </Screen>
  );
}

function Tile({ big, small, lang, selected, onPress }: { big: string; small: string; lang: Language; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${big}, ${small}`}
      onPress={onPress}
      style={[styles.tile, selected && styles.tileOn]}
    >
      {selected ? (
        <View style={styles.tick}>
          <Icon name="check" size={14} color={c.white} strokeWidth={3} />
        </View>
      ) : null}
      <AppText variant="bold" size={28} lang={lang}>
        {big}
      </AppText>
      <AppText size={14}>{small}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: space.lg, gap: space.lg },
  tiles: { flexDirection: 'row', gap: space.md },
  tile: { flex: 1, minHeight: 112, borderRadius: radius.lg, backgroundColor: c.white, borderWidth: 1.5, borderColor: c.lilac, paddingVertical: space.xl, paddingHorizontal: space.lg, gap: 6 },
  tileOn: { borderWidth: 2, borderColor: c.royal, backgroundColor: c.lavender },
  tick: { position: 'absolute', top: space.md, right: space.md, width: 24, height: 24, borderRadius: 12, backgroundColor: c.royal, alignItems: 'center', justifyContent: 'center' },
  note: { borderRadius: radius.md, backgroundColor: c.white, paddingVertical: 14, paddingHorizontal: space.lg, gap: 6 },
});
