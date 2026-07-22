import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';

import { ToastBanner } from '../ToastBanner';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));

describe('ToastBanner', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([
    ['Completed', 'success'],
    ['Failed', 'danger'],
  ] as const)('restarts its timer when Pending is replaced by %s', (title, tone) => {
    const onDismiss = jest.fn();
    const { rerender, getByText } = render(
      <ToastBanner visible onDismiss={onDismiss} revision={1} title="Payment pending" tone="warn" duration={100} />,
    );

    jest.advanceTimersByTime(60);
    rerender(<ToastBanner visible onDismiss={onDismiss} revision={2} title={`Payment ${title.toLowerCase()}`} tone={tone} duration={100} />);

    expect(getByText(`Payment ${title.toLowerCase()}`)).toBeTruthy();
    jest.advanceTimersByTime(60);
    expect(onDismiss).not.toHaveBeenCalled();

    jest.advanceTimersByTime(40);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps the warn icon stable when reduced motion is enabled', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const loop = jest.spyOn(Animated, 'loop');

    const { getByText } = render(
      <ToastBanner visible onDismiss={jest.fn()} revision={1} title="Payment pending" tone="warn" />,
    );

    await act(async () => {});
    await waitFor(() => expect(getByText('Payment pending')).toBeTruthy());
    expect(loop).not.toHaveBeenCalled();
  });

  it('breathes the full Pending shell only when motion is allowed', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const loop = jest.spyOn(Animated, 'loop');

    render(
      <ToastBanner visible onDismiss={jest.fn()} revision={1} title="Payment pending" tone="warn" isPending />,
    );

    await act(async () => {});
    expect(loop).toHaveBeenCalledTimes(2);
  });
});
