// Full-screen photo viewer: swipe between photos, pinch to zoom (iOS ScrollView zoom), zoomImage URLs.
import { useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';
import { keys } from '../../../lib/queryClient';
import { c, space } from '../../../lib/theme';
import { useLayout } from '../../../hooks/useLayout';
import { AppText } from '../../../components/AppText';
import { IconButton } from '../../../components/Button';
import { Loading } from '../../../components/States';
import { VendorImage } from '../../../components/VendorImage';

export default function PhotosScreen() {
  const { id, index } = useLocalSearchParams<{ id: string; index?: string }>();
  const { t } = useTranslation();
  const { width, height } = useLayout();
  const vendor = useQuery({ queryKey: keys.vendor(id), queryFn: () => api.vendor(id) });
  const start = Number(index) || 0;
  const [current, setCurrent] = useState(start);

  if (!vendor.data) return <Loading />;
  const photos = vendor.data.media.filter((m) => m.type === 'photo');

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <FlatList
        data={photos}
        horizontal
        pagingEnabled
        initialScrollIndex={Math.min(start, Math.max(0, photos.length - 1))}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(m) => m.id}
        onMomentumScrollEnd={(e) => setCurrent(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index: i }) => (
          <ScrollView
            style={{ width, height }}
            contentContainerStyle={styles.center}
            maximumZoomScale={3}
            minimumZoomScale={1}
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <VendorImage
              media={item}
              icon={vendor.data.category.icon}
              width={width}
              height={Math.min(height, (width * item.height) / Math.max(1, item.width))}
              mode="zoom"
              style={styles.photo}
              label={t('vendor.photoOf', { n: i + 1, total: photos.length })}
            />
          </ScrollView>
        )}
      />
      <SafeAreaView edges={['top']} style={[styles.top, { paddingHorizontal: space.lg }]}>
        <IconButton icon="close" label={t('common.close')} onPress={() => router.back()} />
        <AppText variant="bold" size="md" color={c.white}>{`${current + 1} / ${photos.length}`}</AppText>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  photo: { backgroundColor: 'transparent' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space.sm },
});
