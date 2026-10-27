import { memo } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { FlashList, useRecyclingState } from '@shopify/flash-list';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDay, todayIst, type Review } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { keys, useReviews, useVendor } from '../lib/queries';
import { toast } from '../lib/toast';
import { c, radius, space } from '../lib/theme';
import { useLang } from '../hooks/useLang';
import { Button, LinkButton } from '../components/Button';
import { Card } from '../components/Card';
import { Field } from '../components/Field';
import { Screen } from '../components/Screen';
import { Empty, QueryView } from '../components/States';
import { Txt } from '../components/Txt';

export default function ReviewsScreen() {
  const { t } = useTranslation();
  const reviews = useReviews();
  const vendor = useVendor();
  const rating = vendor.data?.rating;
  const summary =
    rating && rating.count ? (
      <Card style={styles.summary}>
        <Txt variant="display" size="display" color={c.royal}>
          {rating.avg.toFixed(1)}
        </Txt>
        <View>
          <Stars rating={Math.round(rating.avg)} />
          <Txt size="sm">{t('reviews.count', { n: rating.count })}</Txt>
        </View>
      </Card>
    ) : null;
  return (
    <Screen back scroll={false} title={t('reviews.title')} testID="reviews">
      <QueryView query={reviews} padded>
        {(items) => (
          <FlashList
            data={items}
            keyExtractor={keyOf}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={Gap}
            ListHeaderComponent={summary ? <View style={{ paddingBottom: space.lg }}>{summary}</View> : null}
            refreshControl={<RefreshControl refreshing={reviews.isRefetching} onRefresh={() => void reviews.refetch()} colors={[c.royal]} />}
            renderItem={({ item }) => <ReviewCard review={item} />}
            ListEmptyComponent={<Empty icon="star" title={t('reviews.emptyTitle')} body={t('reviews.emptyBody')} />}
          />
        )}
      </QueryView>
    </Screen>
  );
}

const keyOf = (r: Review) => r.id;
const Gap = () => <View style={styles.gap} />;

function Stars({ rating }: { rating: number }) {
  const { t } = useTranslation();
  return (
    <Txt size="lg" color={c.royal} accessibilityLabel={t('reviews.stars', { n: rating })}>
      {'★'.repeat(rating)}
      <Txt size="lg" color={c.lilac}>
        {'★'.repeat(5 - rating)}
      </Txt>
    </Txt>
  );
}

const ReviewCard = memo(function ReviewCard({ review }: { review: Review }) {
  const { t } = useTranslation();
  const lang = useLang();
  const qc = useQueryClient();
  // List rows are recycled: this state resets when the row shows another review.
  const [editing, setEditing] = useRecyclingState(false, [review.id]);
  const [text, setText] = useRecyclingState(review.vendorReply ?? '', [review.id]);
  const reply = useMutation({
    mutationFn: (body: string) => api.post(`/v1/partner/reviews/${review.id}/reply`, { reply: body }),
    onSuccess: () => {
      setEditing(false);
      toast.success(t('reviews.replyPosted'));
      void qc.invalidateQueries({ queryKey: keys.reviews });
    },
    // The reply stays in the box, so nothing typed is lost.
    onError: (e) => toast.error(errorText(t, e)),
  });
  const valid = text.trim().length >= 2;

  return (
    <Card testID={`review-${review.id}`} style={{ gap: space.sm }}>
      <View style={styles.head}>
        <Txt variant="bold" size="md" style={{ flex: 1 }}>
          {review.customerName}
        </Txt>
        <Txt size="xs" color={c.textMuted}>
          {formatDay(todayIst(new Date(review.createdAt)), lang)}
        </Txt>
      </View>
      <Stars rating={review.rating} />
      {review.comment ? (
        <Txt size="md" style={{ lineHeight: 21 }}>
          {review.comment}
        </Txt>
      ) : null}
      {editing ? (
        <View style={{ gap: space.sm }}>
          <Field testID="reply-input" label={t('reviews.yourReply')} value={text} onChangeText={setText} multiline maxLength={1000} placeholder={t('reviews.replyPlaceholder')} />
          <View style={styles.buttons}>
            <Button kind="outline" label={t('common.cancel')} onPress={() => setEditing(false)} style={{ flex: 1 }} />
            <Button
              testID="save-reply"
              label={t('reviews.postReply')}
              loadingLabel={t('reviews.posting')}
              disabled={!valid}
              loading={reply.isPending}
              onPress={() => {
                if (!reply.isPending) reply.mutate(text.trim());
              }}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : review.vendorReply ? (
        <View style={styles.reply}>
          <Txt variant="bold" size="sm">
            {t('reviews.yourReply')}
          </Txt>
          <Txt size="sm" style={{ lineHeight: 20 }}>
            {review.vendorReply}
          </Txt>
          <LinkButton label={t('reviews.editReply')} onPress={() => setEditing(true)} />
        </View>
      ) : (
        <LinkButton testID="reply" label={t('reviews.reply')} onPress={() => setEditing(true)} />
      )}
    </Card>
  );
});

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.xxxl },
  gap: { height: space.lg },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  reply: { backgroundColor: c.cream, borderRadius: radius.md, padding: space.md, gap: space.xs },
  buttons: { flexDirection: 'row', gap: space.sm },
});
