import { PixelRatio, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { cardImage, wideImage, zoomImage, type MediaRef } from '@eventseva/app-shared';
import { CLOUD_NAME } from '../lib/config';
import { c } from '../lib/theme';
import { categoryIcon, Icon } from './Icon';

export interface VendorImageProps {
  media: MediaRef | null | undefined;
  /** Category icon for the placeholder (`category.icon` from the API). */
  icon: string;
  width: number;
  height: number;
  /** card = whole photo with blurred fill (never cropped); wide = vendor page; zoom = full-screen viewer. */
  mode?: 'card' | 'wide' | 'zoom';
  style?: StyleProp<ViewStyle>;
  label?: string;
}

export function imageUrl(media: MediaRef, mode: 'card' | 'wide' | 'zoom', width: number, height: number, cloud = CLOUD_NAME) {
  const ratio = PixelRatio.get();
  if (mode === 'card') return cardImage(cloud, media.publicId, width, height, ratio);
  if (mode === 'wide') return wideImage(cloud, media.publicId, width, ratio);
  return zoomImage(cloud, media.publicId, width, ratio);
}

/** A vendor photo, or the category icon on lavender when there is no photo or no Cloudinary set up. */
export function VendorImage({ media, icon, width, height, mode = 'card', style, label }: VendorImageProps) {
  const box = [styles.box, { width, height }, style];
  if (!media || !CLOUD_NAME || width <= 0) {
    return (
      <View style={box} accessibilityRole={label ? 'image' : undefined} accessibilityLabel={label}>
        <Icon name={categoryIcon(icon)} size={Math.max(24, Math.min(width, height) * 0.32)} color={c.royal} strokeWidth={1.6} />
      </View>
    );
  }
  return (
    <View style={box}>
      <Image
        source={{ uri: imageUrl(media, mode, width, height) }}
        placeholder={media.blurhash ? { blurhash: media.blurhash } : undefined}
        placeholderContentFit="cover"
        contentFit="contain"
        transition={200}
        recyclingKey={media.publicId}
        accessibilityLabel={label}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: c.lavender, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
