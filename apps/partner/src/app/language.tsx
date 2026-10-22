import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Language, Me } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { useSession } from '../lib/session';
import { languageStore } from '../lib/tokens';
import { applyLanguage } from '../i18n';
import { c, radius, space } from '../lib/theme';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { FontLanguage, Txt } from '../components/Txt';

const OPTIONS: Array<{ lang: Language; name: string; sub: string }> = [
  { lang: 'en', name: 'language.englishName', sub: 'language.englishSub' },
  { lang: 'hi', name: 'language.hindiName', sub: 'language.hindiSub' },
];

/** Profile → Language (Language board). The whole app switches; the choice is saved on the server. */
export default function LanguageScreen() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { updateMe } = useSession();
  const current: Language = i18n.language === 'hi' ? 'hi' : 'en';
  const [choice, setChoice] = useState<Language>(current);
  const [saving, setSaving] = useState(false);

  async function apply() {
    if (choice === current) return router.back();
    setSaving(true);
    try {
      const me = await api.patch<Me>('/v1/me', { language: choice });
      await applyLanguage(choice);
      await languageStore.set(choice);
      updateMe(me);
      // Category names and similar text come from the server in the chosen language.
      void qc.invalidateQueries();
      router.back();
    } catch (e) {
      Alert.alert(t('errors.title'), errorText(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen back title={t('language.title')} subtitle={t('language.titleAlt')} footer={<Button testID="apply-language" size="lg" label={t('language.apply')} loading={saving} onPress={() => void apply()} />}>
      <View style={styles.tiles} accessibilityRole="radiogroup" accessibilityLabel={t('language.title')}>
        {OPTIONS.map((o) => {
          const on = o.lang === choice;
          return (
            <Pressable
              key={o.lang}
              testID={`lang-${o.lang}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => setChoice(o.lang)}
              style={[styles.tile, on ? styles.tileOn : null]}
            >
              {on ? (
                <View style={styles.tick}>
                  <Icon name="check" size={14} strokeWidth={3} color={c.white} />
                </View>
              ) : null}
              <FontLanguage lang={o.lang}>
                <Txt variant="bold" size="display" style={{ lineHeight: 40 }}>
                  {t(o.name)}
                </Txt>
              </FontLanguage>
              <Txt size="sm">{t(o.sub)}</Txt>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.info}>
        <Txt size="sm" style={{ lineHeight: 21 }}>
          {t('language.info')}
        </Txt>
      </View>
      <Txt size="sm">{t('language.changeLater')}</Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: space.md },
  tile: { flex: 1, minHeight: 112, borderRadius: radius.lg, backgroundColor: c.white, borderWidth: 1.5, borderColor: c.lilac, padding: space.lg, paddingVertical: space.xl, gap: 6 },
  tileOn: { borderWidth: 2, borderColor: c.royal, backgroundColor: c.lavender },
  tick: { position: 'absolute', top: 12, right: 12, width: 24, height: 24, borderRadius: 12, backgroundColor: c.royal, alignItems: 'center', justifyContent: 'center' },
  info: { borderRadius: radius.md, backgroundColor: c.white, padding: 14, paddingHorizontal: space.lg },
});
