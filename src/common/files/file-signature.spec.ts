import { contentMatchesType } from './file-signature';

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('contentMatchesType', () => {
  it('accepts real signatures', () => {
    expect(
      contentMatchesType(Buffer.from('%PDF-1.7\n...'), 'application/pdf'),
    ).toBe(true);
    expect(
      contentMatchesType(
        Buffer.concat([
          Buffer.from([0x50, 0x4b, 3, 4]),
          Buffer.from('[Content_Types].xml word/document.xml'),
        ]),
        DOCX,
      ),
    ).toBe(true);
    expect(
      contentMatchesType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
        'image/png',
      ),
    ).toBe(true);
    expect(
      contentMatchesType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'),
    ).toBe(true);
    expect(
      contentMatchesType(
        Buffer.from('# Leave policy\nÀ 20 days'),
        'text/markdown',
      ),
    ).toBe(true);
  });

  it('rejects content that does not match the declared type', () => {
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // "MZ" Windows executable
    expect(contentMatchesType(exe, 'application/pdf')).toBe(false);
    expect(contentMatchesType(exe, 'text/plain')).toBe(false); // NUL byte
    expect(contentMatchesType(Buffer.from('%PDF-1.7'), 'image/png')).toBe(
      false,
    );
    // a zip that isn't a Word document (e.g. a renamed archive)
    expect(
      contentMatchesType(
        Buffer.concat([
          Buffer.from([0x50, 0x4b, 3, 4]),
          Buffer.from('[Content_Types].xml xl/'),
        ]),
        DOCX,
      ),
    ).toBe(false);
    expect(contentMatchesType(Buffer.from([0xc3, 0x28]), 'text/csv')).toBe(
      false,
    ); // invalid UTF-8
    expect(
      contentMatchesType(Buffer.from('x'), 'application/x-msdownload'),
    ).toBe(false);
  });
});
