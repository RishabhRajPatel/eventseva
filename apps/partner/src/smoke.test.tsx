import { render, screen } from '@testing-library/react-native';
import Home from './app/index';

test('renders shared formatting', async () => {
  await render(<Home />);
  expect(screen.getByText('₹1,500')).toBeTruthy();
});
