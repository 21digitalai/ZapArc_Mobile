import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { TransactionDetailsModal } from '../TransactionDetailsModal';

const mockShowToast = jest.fn();
const mockExportPaymentDiagnostics = jest.fn();

jest.mock('../../../../contexts/ThemeContext', () => ({ useAppTheme: () => ({ themeMode: 'dark' }) }));
jest.mock('../../../../hooks/useCurrency', () => ({ useCurrency: () => ({ formatTx: () => ({ primary: '100 sats', secondary: '' }) }) }));
jest.mock('../../../../hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
jest.mock('../FeedbackComponents', () => ({ useFeedback: () => ({ showToast: mockShowToast }) }));
jest.mock('../../utils/paymentComment', () => ({ loadPaymentComment: () => Promise.resolve(null), shouldShowPaymentComment: () => false }));
jest.mock('../../../../services/breezSparkService', () => ({ exportPaymentDiagnostics: (...args: unknown[]) => mockExportPaymentDiagnostics(...args), exportDetailedSdkSupportLogs: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({}));
jest.mock('expo-sharing', () => ({}));

const transaction = { id: 'failed-payment', type: 'send' as const, status: 'failed' as const, amount: 100, timestamp: Date.now() };

function renderModal() {
  return render(<TransactionDetailsModal transaction={transaction} activeWalletInfo={{ masterKeyId: 'main', subWalletIndex: 0 }} refreshTransactions={jest.fn().mockResolvedValue(undefined)} onClose={jest.fn()} />);
}

describe('TransactionDetailsModal reconciliation feedback', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['return_reported_balance_unverified', 'A return was reported, but the wallet balance is not verified yet.'],
    ['unknown', 'The current wallet state could not be confirmed.'],
  ])('routes %s reconciliation through FeedbackProvider', async (reconciliation, expected) => {
    mockExportPaymentDiagnostics.mockResolvedValue(JSON.stringify({ reconciliation }));
    renderModal();
    fireEvent.press(screen.getByText('Check payment status'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('info', expected, 5000));
  });

  it('routes diagnostics timeout through FeedbackProvider', async () => {
    mockExportPaymentDiagnostics.mockRejectedValue(new Error('offline'));
    renderModal();
    fireEvent.press(screen.getByText('Check payment status'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('info', 'Payment status check timed out. Please try again.', 5000));
  });
});
