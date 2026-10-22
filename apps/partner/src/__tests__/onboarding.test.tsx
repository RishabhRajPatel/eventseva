import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '@eventseva/app-shared';
import { api } from '../lib/api';
import OnboardingSubmit from '../app/onboarding/submit';
import { renderScreen } from './render';
import { router } from './routerMock';

jest.mock('expo-router', () => require('./routerMock').expoRouterMock);
jest.mock('../lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() }, onSessionEnded: jest.fn() }));
jest.mock('../lib/session', () => ({ useSession: () => ({ me: { name: 'Ramesh' }, signOut: jest.fn() }) }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

const vendor = (over: object = {}) => ({
  id: 'v1',
  businessName: 'Raj DJ',
  status: 'draft',
  rejectReason: null,
  category: { id: 2, slug: 'dj', name: 'DJ' },
  city: { id: 1, name: 'Prayagraj' },
  area: 'Civil Lines',
  about: 'Ten years of weddings in Prayagraj.',
  services: [{ id: 's1' }],
  packages: [],
  media: [],
  missingForReview: ['photos'],
  ...over,
});

function mockApi(v: object) {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/partner/vendor') return v;
    if (path === '/v1/partner/documents') return { items: [{ id: 'd1', docType: 'aadhaar', last4: '4821', status: 'pending', rejectReason: null, createdAt: '' }] };
    throw new ApiError(404, 'NOT_FOUND', path);
  });
}

beforeEach(() => jest.clearAllMocks());

describe('onboarding checklist', () => {
  it('needs a photo before Submit and links to the photos screen', async () => {
    mockApi(vendor());
    await renderScreen(<OnboardingSubmit />);
    expect(await screen.findByText('At least one photo of your work')).toBeTruthy();
    expect(screen.getByTestId('submit').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('check-photos'));
    expect(router.push).toHaveBeenCalledWith('/photos');
    // Uploaded documents show their state; Aadhaar only by its last 4 digits.
    expect(await screen.findByText('XXXX XXXX 4821')).toBeTruthy();
  });

  it('shows the reject reason prominently and resubmits', async () => {
    mockApi(vendor({ status: 'rejected', rejectReason: 'Photos are blurry', missingForReview: [] }));
    post.mockResolvedValueOnce(vendor({ status: 'pending', missingForReview: [] }));
    await renderScreen(<OnboardingSubmit />);
    expect(await screen.findByText('Photos are blurry')).toBeTruthy();
    expect(screen.getByText('Your profile was not approved')).toBeTruthy();
    await fireEvent.press(screen.getByText('Send for review again'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/v1/partner/vendor/submit'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/pending'));
  });
});
