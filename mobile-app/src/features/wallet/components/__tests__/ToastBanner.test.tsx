import React from 'react';
import { render } from '@testing-library/react-native';

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
});
