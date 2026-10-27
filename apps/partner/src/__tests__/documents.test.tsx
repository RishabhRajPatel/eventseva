import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import { DocumentsCard } from '../components/DocumentsCard';
import { uploadDocument } from '../lib/upload';
import { renderScreen } from './render';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('../lib/queries', () => ({ ...jest.requireActual('../lib/queries'), useDocuments: () => ({ data: [] }) }));
jest.mock('../lib/upload', () => ({ ...jest.requireActual('../lib/upload'), uploadDocument: jest.fn(async () => ({ id: 'd1' })) }));

const getDocument = DocumentPicker.getDocumentAsync as jest.Mock;

describe('documents', () => {
  it('PAN can be a PDF: it is picked from files and uploaded', async () => {
    getDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///e-pan.pdf', name: 'e-pan.pdf', size: 500_000, mimeType: 'application/pdf' }] });
    await renderScreen(<DocumentsCard />);
    await fireEvent.press(screen.getByTestId('upload-pan'));
    await fireEvent.press(screen.getByTestId('doc-source-pdf'));
    await waitFor(() => expect(uploadDocument).toHaveBeenCalled());
    expect((uploadDocument as jest.Mock).mock.calls[0].slice(0, 2)).toEqual([
      expect.objectContaining({ uri: 'file:///e-pan.pdf', mimeType: 'application/pdf', fileSize: 500_000 }),
      'pan',
    ]);
  });

  it('a shop photo goes straight to the photo picker (no PDF choice)', async () => {
    await renderScreen(<DocumentsCard />);
    await fireEvent.press(screen.getByTestId('upload-shop_photo'));
    expect(screen.queryByTestId('doc-source-pdf')).toBeNull();
  });
});
