import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { useLanguage } from '../../../hooks/useLanguage';
import { BRAND_COLOR } from '../../../utils/theme-helpers';

type AssetTabBarProps = {
  assets: string[];
  active: string;
  onChange: (asset: string) => void;
  primaryTextColor: string;
};

export function AssetTabBar({ assets, active, onChange, primaryTextColor }: AssetTabBarProps) {
  const { t } = useLanguage();

  return (
    <View style={styles.tabContainer}>
      {assets.map((asset) => {
        const isActive = asset === active;
        return (
          <TouchableOpacity
            key={asset}
            style={[
              styles.tabButton,
              isActive && styles.tabButtonActive,
              { borderColor: BRAND_COLOR },
            ]}
            onPress={() => onChange(asset)}
            accessibilityRole="button"
            accessibilityLabel={t('home.assetTab.accessibilityLabel', { asset })}
          >
            <Text
              style={[
                styles.tabText,
                { color: isActive ? '#1a1a2e' : primaryTextColor },
              ]}
            >
              {asset}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 0,
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 14,
    padding: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    gap: 6,
  },
  tabButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: BRAND_COLOR,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
