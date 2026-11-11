import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';

import { MINIMUM_AUTOMATIC_TOAST_DURATION_MS, ToastBanner } from '../ToastBanner';

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

    jest.advanceTimersByTime(3000);
    rerender(<ToastBanner visible onDismiss={onDismiss} revision={2} title={`Payment ${title.toLowerCase()}`} tone={tone} duration={100} />);

    expect(getByText(`Payment ${title.toLowerCase()}`)).toBeTruthy();
    jest.advanceTimersByTime(3000);
    expect(onDismiss).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not restart its dismissal timer when its revision is unchanged', () => {
    const onDismiss = jest.fn();
    const { rerender } = render(
      <ToastBanner visible onDismiss={onDismiss} revision="same-error" title="Camera could not read this QR" tone="danger" />,
    );

    act(() => {
      jest.advanceTimersByTime(3000);
      rerender(
        <ToastBanner visible onDismiss={onDismiss} revision="same-error" title="Camera could not read this QR" tone="danger" />,
      );
      jest.advanceTimersByTime(1999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
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

  it('lets long title and subtitle text wrap without truncating the toast', () => {
    const { getByText } = render(
      <ToastBanner
        visible
        onDismiss={jest.fn()}
        revision={1}
        title="This is a deliberately long notification title that should remain readable on a narrow screen"
        subtitle="A long explanatory detail should grow the toast vertically instead of being cut off"
      />,
    );

    const title = getByText('This is a deliberately long notification title that should remain readable on a narrow screen');
    const subtitle = getByText('A long explanatory detail should grow the toast vertically instead of being cut off');

    expect(title.props.numberOfLines).toBeUndefined();
    expect(subtitle.props.numberOfLines).toBeUndefined();
  });

  it('gives wrapped copy the remaining row width while preserving a trailing amount chip', () => {
    const { getByText } = render(
      <ToastBanner
        visible
        onDismiss={jest.fn()}
        revision={1}
        title="This is a deliberately long notification title that should wrap before displacing the toast shell"
        trailing="100 sats"
      />,
    );

    const trailing = getByText('100 sats');
    expect(trailing.props.numberOfLines).toBe(1);

    const textColumn = getByText('This is a deliberately long notification title that should wrap before displacing the toast shell').parent?.parent;
    expect(textColumn?.props.style).toEqual(expect.objectContaining({ flexBasis: 0, minWidth: 0 }));
  });

  it('keeps automatic banners visible for at least five seconds by default', () => {
    const onDismiss = jest.fn();
    render(<ToastBanner visible onDismiss={onDismiss} revision={1} title="Long-running notification" />);

    jest.advanceTimersByTime(MINIMUM_AUTOMATIC_TOAST_DURATION_MS - 1);
    expect(onDismiss).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('clamps shorter automatic durations to five seconds at the timer boundary', () => {
    const onDismiss = jest.fn();
    render(<ToastBanner visible onDismiss={onDismiss} revision={1} title="Short request" duration={100} />);

    jest.advanceTimersByTime(MINIMUM_AUTOMATIC_TOAST_DURATION_MS - 1);
    expect(onDismiss).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('preserves an explicitly longer automatic duration', () => {
    const onDismiss = jest.fn();
    render(<ToastBanner visible onDismiss={onDismiss} revision={1} title="Long-running notification" duration={6500} />);

    jest.advanceTimersByTime(5000);
    expect(onDismiss).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1500);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
