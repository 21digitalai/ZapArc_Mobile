// Transaction History Screen
// Full transaction list with filtering and details

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Linking,
  ToastAndroid,
  Dimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Text, IconButton, Chip, Button, Divider } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../../../contexts/ThemeContext';
import { getGradientColors, getPrimaryTextColor, getSecondaryTextColor, getIconColor, BRAND_COLOR } from '../../../utils/theme-helpers';
import { useWallet } from '../../../hooks/useWallet';
import { useLanguage } from '../../../hooks/useLanguage';
import { useCurrency } from '../../../hooks/useCurrency';
import type { Transaction } from '../types';
import { buildTransactionRows, type TransactionRow, type WalletAsset } from '../utils/transactionRows';

// =============================================================================
// Types
// =============================================================================

type FilterType = 'all' | 'sent' | 'received';

// =============================================================================
// Component
// =============================================================================

export function TransactionHistoryScreen(): React.JSX.Element {
  const { transactions, refreshTransactions, isLoading } = useWallet();
  const { t } = useLanguage();
  const { formatTx, refreshSettings } = useCurrency();

  const params = useLocalSearchParams<{ asset?: string }>();
  const [activeAsset, setActiveAsset] = useState<WalletAsset>(params.asset === 'USDB' ? 'USDB' : 'BTC');

  const { themeMode } = useAppTheme();
  const gradientColors = getGradientColors(themeMode);
  const primaryTextColor = getPrimaryTextColor(themeMode);
  const secondaryTextColor = getSecondaryTextColor(themeMode);
  const iconColor = getIconColor(themeMode);

  // State
  const [filter, setFilter] = useState<FilterType>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [selectedSwapRow, setSelectedSwapRow] = useState<TransactionRow | null>(null);
  const [selectedTxNote, setSelectedTxNote] = useState<string | null>(null);
  const [selectedTxRecipient, setSelectedTxRecipient] = useState<string | null>(null);
  // Full-text popover for truncated detail values. Holds the label + full
  // value + the on-screen anchor rect (measured from the tapped row) so we
  // can float a bubble just above it.
  const [detailPopover, setDetailPopover] = useState<
    { label: string; value: string; x: number; y: number; width: number } | null
  >(null);

  // Load stored user note + recipient when a transaction detail is opened.
  // Both are written locally at send time (see send.tsx): the note is the
  // sender's message to the recipient; the recipient is the Lightning
  // Address / LNURL the user paid (the SDK history doesn't surface it).
  useEffect(() => {
    if (!selectedTransaction?.id) {
      setSelectedTxNote(null);
      setSelectedTxRecipient(null);
      return;
    }
    const id = selectedTransaction.id;
    AsyncStorage.getItem(`payment_note_${id}`)
      .then((note) => setSelectedTxNote(note))
      .catch(() => setSelectedTxNote(null));
    AsyncStorage.getItem(`payment_recipient_${id}`)
      .then((r) => setSelectedTxRecipient(r))
      .catch(() => setSelectedTxRecipient(null));
  }, [selectedTransaction]);

  // Dismiss the popover whenever the detail modal closes.
  useEffect(() => {
    if (!selectedTransaction) setDetailPopover(null);
  }, [selectedTransaction]);

  // Filtered transactions
  const transactionRows = useMemo(() => buildTransactionRows(transactions, activeAsset), [transactions, activeAsset]);

  const filteredTransactions = useMemo(() => {
    if (filter === 'all') return transactionRows;
    const typeMap: Record<string, string> = { received: 'receive', sent: 'send' };
    return transactionRows.filter((row) => row.displayType === typeMap[filter]);
  }, [transactionRows, filter]);

  // Group transactions by date
  const groupedTransactions = useMemo(() => {
    const groups: { [key: string]: TransactionRow[] } = {};

    filteredTransactions.forEach((row) => {
      const tx = row.transaction;
      const date = new Date(tx.timestamp);
      const key = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(row);
    });

    return Object.entries(groups).map(([date, txs]) => ({
      date,
      transactions: txs,
    }));
  }, [filteredTransactions]);

  // Refresh handler
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshTransactions();
    } finally {
      setRefreshing(false);
    }
  }, [refreshTransactions]);

  // Refresh transactions and settings when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      refreshSettings();
      refreshTransactions();
    }, [refreshTransactions, refreshSettings])
  );

  useFocusEffect(
    useCallback(() => {
      setActiveAsset(params.asset === 'USDB' ? 'USDB' : 'BTC');
    }, [params.asset])
  );

  // Format time
  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Render transaction item
  const renderTransaction = (row: TransactionRow): React.JSX.Element => {
    const tx = row.transaction;
    const isReceived = row.displayType === 'receive';
    const method = row.isSwap ? 'swap' : (tx.method || (tx.txid ? 'onchain' : 'lightning'));
    const isDirectUsdbTransfer = !row.isSwap && tx.asset === 'USDB';
    const txIcon = isDirectUsdbTransfer ? (isReceived ? '$↓' : '$↑') : (method === 'swap' ? '⇄' : method === 'onchain' ? '⛓️' : '⚡');
    const txIconColor = isDirectUsdbTransfer ? '#4CAF50' : primaryTextColor;
    const rowAsset: 'BTC' | 'USDB' = row.isSwap ? activeAsset : (tx.asset === 'USDB' ? 'USDB' : 'BTC');
    const formattedAmount = formatTx(row.displayAmount ?? 0, isReceived, {
      asset: rowAsset,
    });

    return (
      <TouchableOpacity
        style={styles.transactionItem}
        onPress={() => {
          setSelectedTransaction(tx);
          setSelectedSwapRow(row.isSwap ? row : null);
        }}
      >
        <View
          style={[
            styles.transactionIcon,
            isReceived ? styles.iconReceived : styles.iconSent,
          ]}
        >
          <Text style={[styles.transactionIconText, { color: primaryTextColor }]}>
            {method === 'swap' ? '⇄' : method === 'onchain' ? '⛓️' : '⚡'}
          </Text>
        </View>

        <View style={styles.transactionInfo}>
          <Text style={[styles.transactionDescription, { color: primaryTextColor }]} numberOfLines={1}>
            {row.displayDescription || tx.description || (isReceived ? t('wallet.receivedPayment') : t('wallet.sentPayment'))}
          </Text>
          <Text style={[styles.transactionTime, { color: secondaryTextColor }]}>{formatTime(tx.timestamp)}</Text>
        </View>

        <View style={styles.transactionAmountContainer}>
          <Text
            style={[
              styles.transactionAmount,
              isReceived ? styles.amountReceived : styles.amountSent,
            ]}
          >
            {formattedAmount.primary}
          </Text>
          {formattedAmount.secondaryCompact && (
            <Text style={[styles.transactionAmountSecondary, { color: secondaryTextColor }]}>
              {formattedAmount.secondaryCompact}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // Render section header
  const renderSectionHeader = (date: string): React.JSX.Element => (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionHeaderText, { color: secondaryTextColor }]}>{date}</Text>
    </View>
  );

  // Render transaction details modal
  const renderDetailsModal = (): React.JSX.Element | null => {
    if (!selectedTransaction) return null;

    const tx = selectedTransaction;
    const isReceived = tx.type === 'receive';
    const method = tx.method || (tx.txid ? 'onchain' : 'lightning');
    const date = new Date(tx.timestamp);

    return (
      <>
      <Modal
        visible={!!selectedTransaction}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedTransaction(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: primaryTextColor }]}>{t('wallet.transactionDetails')}</Text>
              <IconButton
                icon="close"
                iconColor={iconColor}
                size={24}
                onPress={() => { setSelectedTransaction(null); setSelectedSwapRow(null); }}
              />
            </View>

            {/* Amount */}
            <View style={styles.modalAmountContainer}>
              <View
                style={[
                  styles.modalIcon,
                  isReceived ? styles.iconReceived : styles.iconSent,
                ]}
              >
                <Text style={[styles.modalIconText, { color: primaryTextColor }]}> 
                  {method === 'onchain' ? '⛓️' : '⚡'}
                </Text>
              </View>
              <Text
                style={[
                  styles.modalAmount,
                  isReceived ? styles.amountReceived : styles.amountSent,
                ]}
              >
                {formatTx(tx.amount ?? 0, isReceived, { asset: tx.asset === 'USDB' ? 'USDB' : 'BTC' }).primary}
              </Text>
              {formatTx(tx.amount ?? 0, isReceived, { asset: tx.asset === 'USDB' ? 'USDB' : 'BTC' }).secondary && (
                <Text style={[styles.modalAmountSecondary, { color: secondaryTextColor }]}>
                  {formatTx(tx.amount ?? 0, isReceived, { asset: tx.asset === 'USDB' ? 'USDB' : 'BTC' }).secondary}
                </Text>
              )}
              <Text style={styles.modalStatus}>
                {tx.status === 'completed' ? `\u2713 ${t('wallet.statusCompleted')}` : tx.status}
              </Text>
            </View>

            <Divider style={styles.divider} />

            {/* Details */}
            <View style={styles.detailsContainer}>
              <DetailRow label={t('wallet.type')} value={isReceived ? t('wallet.received') : t('wallet.sent')} />
              <DetailRow label="Method" value={method === 'onchain' ? 'On-chain' : 'Lightning'} />
              <DetailRow
                label={t('wallet.date')}
                value={date.toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              />
              <DetailRow label={t('wallet.time')} value={formatTime(tx.timestamp)} />
              {!isReceived && selectedTxRecipient && (
                <DetailRow
                  label={t('wallet.to')}
                  value={selectedTxRecipient}
                  copyable
                  fullValue={selectedTxRecipient}
                  onShowFull={setDetailPopover}
                />
              )}
              {tx.description && (
                <DetailRow
                  label={t('payments.description')}
                  value={tx.description}
                  onShowFull={setDetailPopover}
                />
              )}
              {selectedTxNote && (
                <DetailRow
                  label={t('wallet.yourMessage')}
                  value={selectedTxNote}
                  onShowFull={setDetailPopover}
                />
              )}
              {tx.feeSats !== undefined && tx.feeSats > 0 && (
                <DetailRow
                  label={t('wallet.fee')}
                  value={
                    tx.asset === 'USDB'
                      ? `${(tx.feeSats / 1e6).toFixed(6)} USDB`
                      : `${tx.feeSats.toLocaleString()} ${t('wallet.sats')}`
                  }
                />
              )}
              {(tx.paymentType === 'conversion' || selectedSwapRow?.isSwap) && (
                <DetailRow
                  label={t('wallet.type')}
                  value={
                    selectedSwapRow?.swapDirection === 'USDB_TO_BTC'
                      ? `${t('swap.history.label')} (${t('swap.history.usdbToBtc')})`
                      : `${t('swap.history.label')} (${t('swap.history.btcToUsdb')})`
                  }
                />
              )}
              {selectedSwapRow?.isSwap && selectedSwapRow.btcSide && selectedSwapRow.usdbSide && (
                selectedSwapRow.swapDirection === 'BTC_TO_USDB' ? (
                  <>
                    <DetailRow
                      label={t('swap.youPay')}
                      value={`${Number(selectedSwapRow.btcSide.amount || 0).toLocaleString()} sats`}
                    />
                    <DetailRow
                      label={t('swap.youReceive')}
                      value={`${(Number(selectedSwapRow.usdbSide.amount || 0) / 1e6).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      })} USDB`}
                    />
                  </>
                ) : (
                  <>
                    <DetailRow
                      label={t('swap.youPay')}
                      value={`${(Number(selectedSwapRow.usdbSide.amount || 0) / 1e6).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      })} USDB`}
                    />
                    <DetailRow
                      label={t('swap.youReceive')}
                      value={`${Number(selectedSwapRow.btcSide.amount || 0).toLocaleString()} sats`}
                    />
                  </>
                )
              )}
              {tx.id && (
                <DetailRow
                  label={t('wallet.paymentId')}
                  value={String(tx.id)}
                  copyable
                  fullValue={String(tx.id)}
                  onShowFull={setDetailPopover}
                />
              )}
              {tx.tokenIdentifier && (
                <DetailRow
                  label={t('wallet.token')}
                  value={String(tx.tokenIdentifier)}
                  copyable
                  fullValue={String(tx.tokenIdentifier)}
                  onShowFull={setDetailPopover}
                />
              )}
              {method === 'onchain' && tx.txid && (
                <>
                  <DetailRow
                    label="TXID"
                    value={`${tx.txid.slice(0, 16)}...`}
                    copyable
                    fullValue={tx.txid}
                    onShowFull={setDetailPopover}
                  />
                  <TouchableOpacity onPress={() => Linking.openURL(`https://mempool.space/tx/${tx.txid}`)}>
                    <Text style={styles.mempoolLink}>{t('wallet.viewOnMempool')}</Text>
                  </TouchableOpacity>
                </>
              )}
              {tx.paymentHash && (
                <DetailRow
                  label={t('wallet.paymentHash')}
                  value={`${tx.paymentHash.slice(0, 16)}...`}
                  copyable
                  fullValue={tx.paymentHash}
                  onShowFull={setDetailPopover}
                />
              )}
            </View>

            {/* Close Button */}
            <Button
              mode="outlined"
              onPress={() => setSelectedTransaction(null)}
              style={styles.closeModalButton}
              labelStyle={[styles.closeModalButtonLabel, { color: primaryTextColor }]}
            >
              {t('common.close')}
            </Button>
          </View>
        </View>
      </Modal>

      {/* Full-text bubble. Tapping a truncated detail value floats this
          above the tapped row, showing the complete text (selectable) with
          a copy action. Tapping the backdrop dismisses it. Rendered as its
          own transparent Modal so it overlays the detail sheet cleanly and
          isn't clipped by the sheet's max height / scroll. */}
      <Modal
        visible={!!detailPopover}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailPopover(null)}
      >
        <TouchableOpacity
          style={styles.popoverBackdrop}
          activeOpacity={1}
          onPress={() => setDetailPopover(null)}
        >
          {detailPopover && (() => {
            const screen = Dimensions.get('window');
            const BUBBLE_MARGIN = 16;
            const maxWidth = screen.width - BUBBLE_MARGIN * 2;
            // Anchor horizontally to the tapped value but clamp on-screen.
            let left = detailPopover.x + detailPopover.width - Math.min(maxWidth, 320);
            if (left < BUBBLE_MARGIN) left = BUBBLE_MARGIN;
            if (left + Math.min(maxWidth, 320) > screen.width - BUBBLE_MARGIN) {
              left = screen.width - BUBBLE_MARGIN - Math.min(maxWidth, 320);
            }
            // Place the bubble just above the row; if too close to the top,
            // flip below instead.
            const flipBelow = detailPopover.y < 140;
            const top = flipBelow ? detailPopover.y + 28 : undefined;
            const bottom = flipBelow ? undefined : screen.height - detailPopover.y + 8;
            return (
              <TouchableOpacity
                activeOpacity={1}
                onPress={async () => {
                  try {
                    await Clipboard.setStringAsync(detailPopover.value);
                    ToastAndroid && ToastAndroid.show?.(t('common.copied'), ToastAndroid.SHORT);
                  } catch {}
                }}
                style={[
                  styles.popoverBubble,
                  { left, maxWidth: Math.min(maxWidth, 320), top, bottom },
                ]}
              >
                <Text style={styles.popoverLabel}>{detailPopover.label}</Text>
                <Text style={styles.popoverValue} selectable>
                  {detailPopover.value}
                </Text>
                <Text style={styles.popoverHint}>{t('wallet.tapToCopy')}</Text>
              </TouchableOpacity>
            );
          })()}
        </TouchableOpacity>
      </Modal>
      </>
    );
  };

  return (
    <LinearGradient
      colors={gradientColors}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <IconButton
            icon="arrow-left"
            iconColor={iconColor}
            size={24}
            onPress={() => router.back()}
          />
          <Text style={[styles.headerTitle, { color: primaryTextColor }]}>{t('wallet.transactionHistory')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Filter Chips */}
        <View style={styles.filterContainer}>
          <Chip
            selected={filter === 'all'}
            onPress={() => setFilter('all')}
            style={[styles.filterChip, filter === 'all' && styles.filterChipActive]}
            textStyle={[
              styles.filterChipText,
              filter === 'all' && styles.filterChipTextActive,
            ]}
          >
            {t('common.all')}
          </Chip>
          <Chip
            selected={filter === 'received'}
            onPress={() => setFilter('received')}
            style={[styles.filterChip, filter === 'received' && styles.filterChipActive]}
            textStyle={[
              styles.filterChipText,
              filter === 'received' && styles.filterChipTextActive,
            ]}
          >
            {t('wallet.receivedPlural')}
          </Chip>
          <Chip
            selected={filter === 'sent'}
            onPress={() => setFilter('sent')}
            style={[styles.filterChip, filter === 'sent' && styles.filterChipActive]}
            textStyle={[
              styles.filterChipText,
              filter === 'sent' && styles.filterChipTextActive,
            ]}
          >
            {t('wallet.sentPlural')}
          </Chip>
        </View>

        {/* Transaction List */}
        {filteredTransactions.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={[styles.emptyTitle, { color: primaryTextColor }]}>{t('wallet.noTransactions')}</Text>
            <Text style={[styles.emptySubtitle, { color: secondaryTextColor }]}>
              {filter === 'all'
                ? t('wallet.historyWillAppear')
                : t('wallet.noTransactionsFound', { filter: filter === 'received' ? t('wallet.received').toLowerCase() : t('wallet.sent').toLowerCase() })}
            </Text>
          </View>
        ) : (
          <FlatList
            data={groupedTransactions}
            keyExtractor={(item) => item.date}
            renderItem={({ item }) => (
              <View>
                {renderSectionHeader(item.date)}
                {item.transactions.map((row) => (
                  <View key={row.id}>{renderTransaction(row)}</View>
                ))}
              </View>
            )}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={BRAND_COLOR}
              />
            }
          />
        )}

        {/* Transaction Details Modal */}
        {renderDetailsModal()}
      </SafeAreaView>
    </LinearGradient>
  );
}

// =============================================================================
// Detail Row Component
// =============================================================================

type DetailPopover = { label: string; value: string; x: number; y: number; width: number };

interface DetailRowProps {
  label: string;
  value: string;
  copyable?: boolean;
  fullValue?: string;
  /** When provided, tapping the (possibly truncated) value floats a
   *  bubble showing the full text just above the row. */
  onShowFull?: (popover: DetailPopover) => void;
}

function DetailRow({ label, value, copyable, fullValue, onShowFull }: DetailRowProps): React.JSX.Element {
  const { t } = useLanguage();
  const { themeMode } = useAppTheme();
  const primaryTextColor = getPrimaryTextColor(themeMode);
  const secondaryTextColor = getSecondaryTextColor(themeMode);
  const iconColor = getIconColor(themeMode);
  const valueRef = useRef<View | null>(null);

  const handleCopy = async (): Promise<void> => {
    try {
      await Clipboard.setStringAsync(fullValue || value);
      ToastAndroid && ToastAndroid.show?.(t('common.copied'), ToastAndroid.SHORT);
    } catch {}
  };

  // Tapping the value measures the row's on-screen rect and asks the parent
  // to float a full-text bubble above it. Falls back to copy if no
  // onShowFull handler is wired (preserves prior copyable-row behaviour).
  const handleValuePress = (): void => {
    if (!onShowFull) {
      if (copyable) void handleCopy();
      return;
    }
    const node = valueRef.current;
    if (!node || typeof node.measureInWindow !== 'function') return;
    node.measureInWindow((x, y, width) => {
      onShowFull({ label, value: fullValue || value, x, y, width });
    });
  };

  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: secondaryTextColor }]}>{label}</Text>
      <View style={styles.detailValueContainer}>
        <TouchableOpacity
          ref={valueRef}
          style={styles.detailValueTouch}
          onPress={handleValuePress}
          activeOpacity={0.6}
        >
          <Text
            style={[styles.detailValue, { color: primaryTextColor }]}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {value}
          </Text>
        </TouchableOpacity>
        {copyable && (
          <IconButton
            icon="content-copy"
            iconColor={iconColor}
            size={16}
            onPress={handleCopy}
            style={styles.copyButton}
          />
        )}
      </View>
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerSpacer: {
    width: 48,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  filterChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'transparent',
  },
  filterChipActive: {
    backgroundColor: BRAND_COLOR,
  },
  filterChipText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
  },
  filterChipTextActive: {
    color: '#1a1a2e',
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  sectionHeader: {
    paddingVertical: 8,
    marginTop: 8,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  iconReceived: {
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
  },
  iconSent: {
    backgroundColor: 'rgba(255, 107, 107, 0.2)',
  },
  transactionIconText: {
    fontSize: 18,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionDescription: {
    fontSize: 15,
    marginBottom: 2,
  },
  transactionTime: {
    fontSize: 12,
  },
  transactionAmountContainer: {
    alignItems: 'flex-end',
  },
  transactionAmount: {
    fontSize: 15,
    fontWeight: '600',
  },
  amountReceived: {
    color: '#4CAF50',
  },
  amountSent: {
    color: '#FF6B6B',
  },
  transactionAmountSecondary: {
    fontSize: 11,
    marginTop: 2,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  modalAmountContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  modalIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalIconText: {
    fontSize: 24,
  },
  modalAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  modalAmountSecondary: {
    fontSize: 14,
    marginBottom: 8,
  },
  modalStatus: {
    fontSize: 14,
    color: '#4CAF50',
  },
  divider: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 16,
  },
  detailsContainer: {
    marginBottom: 24,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  detailLabel: {
    fontSize: 14,
  },
  detailValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  detailValueTouch: {
    flexShrink: 1,
    maxWidth: '90%',
  },
  detailValue: {
    fontSize: 14,
    textAlign: 'right',
  },
  copyButton: {
    margin: 0,
    marginLeft: 4,
  },
  popoverBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  popoverBubble: {
    position: 'absolute',
    backgroundColor: '#10131f',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  popoverLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  popoverValue: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  popoverHint: {
    color: BRAND_COLOR,
    fontSize: 11,
    marginTop: 8,
  },
  mempoolLink: {
    color: BRAND_COLOR,
    fontSize: 13,
    textAlign: 'right',
    marginTop: 8,
  },
  closeModalButton: {
    borderColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 12,
  },
  closeModalButtonLabel: {
  },
});
