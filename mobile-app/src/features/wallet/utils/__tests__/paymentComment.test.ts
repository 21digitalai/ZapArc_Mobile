import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadPaymentComment,
  paymentCommentKey,
  savePaymentComment,
  shouldShowPaymentComment,
} from '../paymentComment';

const walletA = { masterKeyId: 'wallet-a', subWalletIndex: 0 };
const walletB = { masterKeyId: 'wallet-b', subWalletIndex: 0 };

describe('payment comments', () => {
  beforeEach(() => jest.clearAllMocks());

  it('persists and resolves a comment from the stable refreshed payment id', async () => {
    await savePaymentComment(walletA, 'payment-123', '  Dinner  ');

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      paymentCommentKey(walletA, 'payment-123'),
      'Dinner',
    );
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('Dinner');
    await expect(loadPaymentComment(walletA, 'payment-123')).resolves.toBe('Dinner');
  });

  it('never uses another wallet\'s comment key', async () => {
    await savePaymentComment(walletA, 'same-payment-id', 'Private');

    expect(paymentCommentKey(walletA, 'same-payment-id'))
      .not.toBe(paymentCommentKey(walletB, 'same-payment-id'));
  });

  it('keeps provider description and comment independent while suppressing duplicates', () => {
    expect(shouldShowPaymentComment('Sent payment to LNURL address', 'Dinner')).toBe(true);
    expect(shouldShowPaymentComment('Same text', ' Same text ')).toBe(false);
    expect(shouldShowPaymentComment('Description', '')).toBe(false);
  });
});
