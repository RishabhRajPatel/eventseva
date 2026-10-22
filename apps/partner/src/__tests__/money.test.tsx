import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import '../i18n';
import { checkPrice, paiseToRupeesInput, rupeesInputToPaise } from '../lib/money';
import { PriceInput } from '../components/PriceInput';

describe('rupee input → paise', () => {
  it('converts rupees typed by the vendor to paise', () => {
    expect(rupeesInputToPaise('1500')).toBe(150_000);
    expect(rupeesInputToPaise('1,500')).toBe(150_000);
    expect(rupeesInputToPaise('₹ 1,35,000')).toBe(13_500_000);
    expect(rupeesInputToPaise('99.5')).toBe(9_950);
    expect(rupeesInputToPaise('0.1')).toBe(10);
    // Floating point: 1.15 * 100 is 114.999… — must still be 115 paise.
    expect(rupeesInputToPaise('1.15')).toBe(115);
  });

  it('refuses text that is not an amount', () => {
    expect(rupeesInputToPaise('abc')).toBeNull();
    expect(rupeesInputToPaise('12.345')).toBeNull();
    expect(rupeesInputToPaise('1.2.3')).toBeNull();
    expect(rupeesInputToPaise('-5')).toBeNull();
  });

  it('enforces ₹1 minimum and ₹10 lakh maximum', () => {
    expect(checkPrice('')).toEqual({ ok: false, reason: 'empty' });
    expect(checkPrice('0.99')).toEqual({ ok: false, reason: 'tooLow' });
    expect(checkPrice('1')).toEqual({ ok: true, paise: 100 });
    expect(checkPrice('1000000')).toEqual({ ok: true, paise: 100_000_000 });
    expect(checkPrice('1000000.01')).toEqual({ ok: false, reason: 'tooHigh' });
    expect(checkPrice('ten')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('shows saved paise back as rupees', () => {
    expect(paiseToRupeesInput(150_000)).toBe('1500');
    expect(paiseToRupeesInput(150_050)).toBe('1500.50');
    expect(rupeesInputToPaise(paiseToRupeesInput(123_456))).toBe(123_456);
  });
});

function Harness({ initial = '' }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return <PriceInput testID="price" label="Price" value={v} onChange={setV} showError />;
}

describe('<PriceInput>', () => {
  it('previews the price in Indian format as the vendor types', async () => {
    await render(<Harness />);
    await fireEvent.changeText(screen.getByTestId('price'), '135000');
    expect(screen.getByText('Customers see ₹1,35,000')).toBeTruthy();
  });

  it('strips letters and explains a too-low price', async () => {
    await render(<Harness />);
    await fireEvent.changeText(screen.getByTestId('price'), '0.5x');
    expect(screen.getByTestId('price').props.value).toBe('0.5');
    expect(screen.getByText('The price must be at least ₹1.')).toBeTruthy();
  });
});
