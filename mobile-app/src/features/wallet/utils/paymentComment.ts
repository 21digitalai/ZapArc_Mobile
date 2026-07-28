import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PaymentCommentWallet {
  masterKeyId: string;
  subWalletIndex: number;
}

function cleanComment(value: string | null | undefined): string | null {
  const comment = value?.trim();
  return comment ? comment : null;
}

/** Payment ids are stable after an SDK history refresh, but only per wallet. */
export function paymentCommentKey(wallet: PaymentCommentWallet, paymentId: string): string {
  return `payment_comment_${wallet.masterKeyId}_${wallet.subWalletIndex}_${paymentId}`;
}

export async function savePaymentComment(wallet: PaymentCommentWallet | null, paymentId: string | undefined, comment: string): Promise<void> {
  const value = cleanComment(comment);
  if (!wallet || !paymentId || !value) return;
  await AsyncStorage.setItem(paymentCommentKey(wallet, paymentId), value);
}

export async function loadPaymentComment(wallet: PaymentCommentWallet | null, paymentId: string | undefined): Promise<string | null> {
  if (!wallet || !paymentId) return null;
  return cleanComment(await AsyncStorage.getItem(paymentCommentKey(wallet, paymentId)));
}

export function shouldShowPaymentComment(description: string | null | undefined, comment: string | null | undefined): boolean {
  const normalizedComment = cleanComment(comment);
  return !!normalizedComment && normalizedComment !== cleanComment(description);
}
