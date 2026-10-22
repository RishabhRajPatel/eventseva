// Tests run at phone size (390×844) unless a test sets another size with setWindowSize().
const size = { width: 390, height: 844, scale: 2, fontScale: 1 };

export function setWindowSize(width: number, height: number) {
  size.width = width;
  size.height = height;
}

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ ...size }),
}));
