import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { useAdManager } from '../hooks';
import { AdType } from '../types';
import { COLORS, SPACING } from '../../../utils/constants';

interface BannerAdProps {
  style?: any;
  onAdLoaded?: () => void;
  onAdError?: (error: string) => void;
}

export const BannerAd: React.FC<BannerAdProps> = ({
  style,
  onAdLoaded,
  onAdError,
}) => {
  const { isLoading, adConfig, error, shouldShow, trackImpression, trackClick } = useAdManager(AdType.BANNER);

  useEffect(() => {
    if (adConfig && shouldShow) {
      trackImpression();
      onAdLoaded?.();
    } else if (error) {
      onAdError?.(error);
    }
  }, [adConfig, shouldShow, error]);

  const handleAdPress = () => {
    if (adConfig) {
      trackClick();
      console.log('Banner ad clicked:', adConfig.adNetworkId);
    }
  };

  // Show loading state while fetching
  if (isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer, style]}>
        <ActivityIndicator size="small" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading ad...</Text>
      </View>
    );
  }

  // Don't render anything if user shouldn't see ads, there's no ad, or there's an error
  if (!shouldShow || !adConfig || error) {
    return null;
  }

  return (
    <View style={[styles.container, style]}>
      <Pressable
        style={styles.adContainer}
        onPress={handleAdPress}
        android_ripple={{ color: COLORS.primary + '20' }}
      >
        <View style={styles.adContent}>
          <Text style={styles.adLabel}>Advertisement</Text>
          <Text style={styles.adText}>
            Sample Banner Ad - Network: {adConfig.adNetworkId}
          </Text>
          <Text style={styles.adSubtext}>
            Tap to learn more
          </Text>
        </View>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginVertical: SPACING.sm,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.textSecondary + '30',
  },
  loadingText: {
    marginLeft: SPACING.sm,
    color: COLORS.textSecondary,
    fontSize: 14,
  },
  adContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.textSecondary + '30',
    overflow: 'hidden',
  },
  adContent: {
    padding: SPACING.md,
    minHeight: 80,
    justifyContent: 'center',
  },
  adLabel: {
    fontSize: 10,
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.xs,
  },
  adText: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  adSubtext: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
});
