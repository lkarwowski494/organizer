import { AccountError, accountErrorCode } from '../account';

describe('AccountError', () => {
  it('niesie kod i nazwę; komunikat domyślnie = kod', () => {
    const e = new AccountError('network');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AccountError');
    expect(e.code).toBe('network');
    expect(e.message).toBe('network');
    expect(new AccountError('failed', 'opis').message).toBe('opis');
  });

  it('accountErrorCode: kod z AccountError, inne błędy to failed', () => {
    expect(accountErrorCode(new AccountError('canceled'))).toBe('canceled');
    expect(accountErrorCode(new Error('canceled'))).toBe('failed');
    expect(accountErrorCode('canceled')).toBe('failed');
  });
});
