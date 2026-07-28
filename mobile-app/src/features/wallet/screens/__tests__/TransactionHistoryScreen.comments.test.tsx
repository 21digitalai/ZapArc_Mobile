import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { TransactionHistoryScreen } from '../TransactionHistoryScreen';

let mockRows: any[] = [];
let mockStoredComment: string | null = null;

jest.mock('../../../../contexts/ThemeContext', () => ({ useAppTheme: () => ({ themeMode: 'dark' }) }));
jest.mock('../../../../hooks/useWallet', () => ({
  useWallet: () => ({
    transactions: [], refreshTransactions: jest.fn(), isLoading: false,
    activeWalletInfo: { masterKeyId: 'main', subWalletIndex: 0 },
  }),
}));
jest.mock('../../../../hooks/useLanguage', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
jest.mock('../../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatTx: () => ({ primary: '100 sats', secondary: '' }), refreshSettings: jest.fn() }),
}));
jest.mock('../../utils/transactionRows', () => ({ buildTransactionRows: () => mockRows }));
jest.mock('../../utils/paymentComment', () => ({
  loadPaymentComment: () => Promise.resolve(mockStoredComment),
  shouldShowPaymentComment: (description: string | null | undefined, comment: string | null | undefined) =>
    !!comment?.trim() && comment.trim() !== description?.trim(),
}));
jest.mock('../../utils/safeBack', () => ({ createSafeBackHandler: () => () => false }));
jest.mock('expo-router', () => ({
  router: { canGoBack: () => false, back: jest.fn(), replace: jest.fn(), push: jest.fn() },
  useFocusEffect: jest.fn(), useLocalSearchParams: () => ({}),
}));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: any) => children }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { SafeAreaView: ({ children }: any) => React.createElement(View, null, children) };
});

describe('TransactionHistoryScreen comment details', () => {
  beforeEach(() => {
    mockStoredComment = null;
    const transaction = {
      id: 'payment-comment-history', type: 'send', method: 'lightning', status: 'completed',
      amount: 100, timestamp: Date.now(), description: 'Sent payment to LNURL address',
    };
    mockRows = [{
      id: transaction.id, transaction, displayType: 'send', displayAmount: 100,
      displayDescription: transaction.description, isSwap: false,
    }];
  });

  it('renders separate provider Description and sender Comment rows', async () => {
    mockStoredComment = 'Lunch reimbursement';
    render(<TransactionHistoryScreen />);

    fireEvent.press(await screen.findByText('Sent payment to LNURL address'));
    await waitFor(() => {
      expect(screen.getByText('payments.description')).toBeTruthy();
      expect(screen.getByText('wallet.comment')).toBeTruthy();
      expect(screen.getByText('Lunch reimbursement')).toBeTruthy();
    });
  });

  it('suppresses a duplicate sender comment', async () => {
    mockStoredComment = 'Sent payment to LNURL address';
    render(<TransactionHistoryScreen />);

    fireEvent.press(await screen.findByText('Sent payment to LNURL address'));
    await waitFor(() => expect(screen.getByText('payments.description')).toBeTruthy());
    expect(screen.queryByText('wallet.comment')).toBeNull();
  });

  it('omits an empty sender comment', async () => {
    mockStoredComment = '   ';
    render(<TransactionHistoryScreen />);

    fireEvent.press(await screen.findByText('Sent payment to LNURL address'));
    await waitFor(() => expect(screen.getByText('payments.description')).toBeTruthy());
    expect(screen.queryByText('wallet.comment')).toBeNull();
  });
});
