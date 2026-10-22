// jest.mock factory for src/lib/api: every route is a jest.fn() the test sets up.
export function mockApiModule() {
  const names = [
    'sendOtp', 'verifyOtp', 'logout', 'logoutAll', 'me', 'updateMe', 'categories', 'vendors', 'vendor', 'reviews', 'availability',
    'events', 'event', 'createEvent', 'bookings', 'booking', 'createBooking', 'startPayment', 'verifyPayment', 'devPay',
    'cancelBooking', 'review', 'shortlist', 'save', 'unsave', 'startChat', 'conversations', 'messages', 'sendMessage',
    'complaints', 'createComplaint', 'notifications', 'markNotificationsRead',
  ];
  return {
    api: Object.fromEntries(names.map((n) => [n, jest.fn(() => new Promise(() => undefined))])),
    client: {},
    onSessionEnded: jest.fn(),
  };
}
