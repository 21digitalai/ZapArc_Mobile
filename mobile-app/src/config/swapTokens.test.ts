import { SWAP_TOKENS, USDB_TOKEN } from './swapTokens';

describe('swapTokens config', () => {
  it('defines a USDB token entry', () => {
    expect(SWAP_TOKENS).toHaveLength(1);
    expect(USDB_TOKEN).toMatchObject({
      id: 'USDB',
      ticker: 'USDB',
      label: 'USDB',
      displayDecimals: 2,
    });
  });
});
