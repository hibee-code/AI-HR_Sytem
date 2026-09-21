import PDFDocument from 'pdfkit';
import type { Payslip } from './entities/payslip.entity';
import { LineType } from './entities/salary-structure.entity';

export interface PayslipPdfInput {
  companyName: string;
  employeeName: string;
  employeeNumber: string;
  department: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  payslip: Pick<
    Payslip,
    'currency' | 'gross' | 'totalDeductions' | 'net' | 'lines'
  >;
}

/** Renders a one-page payslip. Kept deliberately plain; branding can be layered on later. */
export function renderPayslipPdf(input: PayslipPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const money = (n: number) =>
      `${input.payslip.currency} ${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    doc.fontSize(18).text(input.companyName, { align: 'left' });
    doc.fontSize(12).text('Payslip', { align: 'left' }).moveDown();

    doc.fontSize(10);
    doc.text(`Employee: ${input.employeeName} (${input.employeeNumber})`);
    doc.text(`Department: ${input.department}`);
    doc.text(`Period: ${input.periodStart} – ${input.periodEnd}`);
    doc.text(`Pay date: ${input.payDate}`).moveDown();

    const section = (title: string, type: LineType) => {
      doc.fontSize(11).text(title, { underline: true });
      doc.fontSize(10);
      for (const l of input.payslip.lines.filter((x) => x.type === type)) {
        doc
          .text(l.label, { continued: true })
          .text(money(l.amount), { align: 'right' });
      }
      doc.moveDown(0.5);
    };
    section('Earnings', LineType.EARNING);
    section('Deductions', LineType.DEDUCTION);

    doc.moveDown();
    doc
      .fontSize(10)
      .text('Gross', { continued: true })
      .text(money(input.payslip.gross), { align: 'right' });
    doc
      .text('Total deductions', { continued: true })
      .text(money(input.payslip.totalDeductions), { align: 'right' });
    doc
      .fontSize(12)
      .text('Net pay', { continued: true })
      .text(money(input.payslip.net), { align: 'right' });

    doc
      .moveDown(2)
      .fontSize(8)
      .fillColor('#666')
      .text('This payslip is confidential and generated automatically.');
    doc.end();
  });
}
