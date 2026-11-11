import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { FeedbackProvider, useFeedback } from '../FeedbackComponents';

const mockToastBanner = jest.fn();

jest.mock('../ToastBanner', () => ({
  ToastBanner: (props: unknown) => {
    mockToastBanner(props);
    return null;
  },
}));

function FeedbackHarness(): React.JSX.Element {
  const { showError } = useFeedback();

  return (
    <>
      <Text onPress={() => showError('Camera could not read this QR')}>Show camera error</Text>
      <Text onPress={() => showError('This QR is not supported')}>Show different error</Text>
    </>
  );
}

describe('FeedbackProvider toast lifecycle', () => {
  beforeEach(() => {
    mockToastBanner.mockClear();
  });

  it('does not replace repeated visible errors but replaces a different error', () => {
    render(
      <FeedbackProvider>
        <FeedbackHarness />
      </FeedbackProvider>,
    );

    act(() => {
      screen.getByText('Show camera error').props.onPress();
    });
    const firstVisibleToast = mockToastBanner.mock.calls.at(-1)?.[0] as { revision?: string; visible?: boolean };

    act(() => {
      screen.getByText('Show camera error').props.onPress();
    });
    const repeatedVisibleToast = mockToastBanner.mock.calls.at(-1)?.[0] as { revision?: string; visible?: boolean };

    act(() => {
      screen.getByText('Show different error').props.onPress();
    });
    const differentVisibleToast = mockToastBanner.mock.calls.at(-1)?.[0] as { revision?: string; visible?: boolean };

    expect(firstVisibleToast.visible).toBe(true);
    expect(repeatedVisibleToast.revision).toBe(firstVisibleToast.revision);
    expect(differentVisibleToast.revision).not.toBe(firstVisibleToast.revision);
  });
});
