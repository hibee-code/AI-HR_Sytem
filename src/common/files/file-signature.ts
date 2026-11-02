/**
 * Does the file's content match the type the client declared? Browsers and
 * attackers both set Content-Type freely; the bytes are what we store and
 * later parse. Covers every type we accept — unknown types fail.
 */
export function contentMatchesType(buf: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'application/pdf':
      // The header may follow a little junk, which readers tolerate.
      return buf.subarray(0, 1024).includes('%PDF-');
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return isZip(buf) && buf.includes('word/');
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return isZip(buf) && buf.includes('xl/');
    case 'application/msword':
    case 'application/vnd.ms-excel':
      return startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // OLE2
    case 'image/png':
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case 'image/webp':
      return (
        buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
        buf.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    case 'text/plain':
    case 'text/csv':
    case 'text/markdown':
      return isUtf8Text(buf);
    default:
      return false;
  }
}

function startsWith(buf: Buffer, bytes: number[]): boolean {
  return buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);
}

function isZip(buf: Buffer): boolean {
  return (
    startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) &&
    buf.includes('[Content_Types].xml')
  );
}

/** Valid UTF-8 and no NUL bytes — rules out executables renamed to .txt. */
function isUtf8Text(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}
