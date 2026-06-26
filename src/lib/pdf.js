import { jsPDF } from 'jspdf';

// Generate + download the Delivery Order PDF for a saved DO record.
// `doRec`   — row from shared_do_records (plot_1..5, breed_1..5, qty_1..5, total_qty, …)
// `al`      — matching shared_al_orders row (for customer/order context)
// `staff`   — name of the staff printing
// `sigDataUrl` — optional customer signature PNG data URL to embed
export function printDOPdf(doRec, al = {}, staff = '—', sigDataUrl = null) {
  const doc = new jsPDF();
  const now = new Date();
  const dateFmt = doRec.delivery_date ? new Date(doRec.delivery_date).toLocaleDateString('en-MY') : '—';

  // Header
  doc.setFillColor(6, 78, 59);
  doc.rect(0, 0, 210, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('DELIVERY ORDER', 105, 12, { align: 'center' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('MJM Nursery AI · Issue Collection DO', 105, 22, { align: 'center' });

  // DO + AL details
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('DO & Customer Details', 20, 42);
  doc.setDrawColor(16, 185, 129);
  doc.setLineWidth(0.4);
  doc.line(20, 44, 190, 44);

  const details = [
    ['DO Number', doRec.do_number || '—', 'AL Number', doRec.al_number || '—'],
    ['Customer', al.customer_name || doRec.remark || '—', 'Order No.', al.order_number || '—'],
    ['Delivery Date', dateFmt, 'Product', al.product_name || '—'],
    ['Qty Ordered', String(al.quantity_ordered ?? '—'), 'Balance After This DO', String(al.balance_quantity ?? 0)],
    ['Printed By', staff, 'Print Date', now.toLocaleDateString('en-MY')],
  ];
  doc.setFontSize(9);
  details.forEach(([l1, v1, l2, v2], i) => {
    const y = 53 + i * 9;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(l1 + ':', 20, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(String(v1), 58, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(l2 + ':', 112, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(String(v2), 150, y);
  });

  // Items table
  let y = 102;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('Items Collected', 20, y);
  doc.setDrawColor(16, 185, 129);
  doc.line(20, y + 2, 190, y + 2);

  doc.setFillColor(236, 253, 245);
  doc.rect(20, y + 5, 170, 9, 'F');
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(6, 78, 59);
  doc.text('#', 23, y + 12);
  doc.text('Nursery', 30, y + 12);
  doc.text('Breed / Plant', 85, y + 12);
  doc.text('Qty', 175, y + 12, { align: 'right' });

  y += 22;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9);

  const items = [];
  for (let i = 1; i <= 5; i++) {
    const nursery = doRec[`plot_${i}`];
    const breed = doRec[`breed_${i}`];
    const qty = doRec[`qty_${i}`];
    if (nursery || breed || qty) items.push({ nursery: nursery || '—', breed: breed || '—', qty: qty || 0 });
  }
  if (!items.length) items.push({ nursery: '—', breed: '—', qty: doRec.total_qty || 0 });

  items.forEach((it, i) => {
    doc.text(String(i + 1), 23, y);
    doc.text(doc.splitTextToSize(it.nursery, 50)[0], 30, y);
    doc.text(doc.splitTextToSize(it.breed, 80)[0], 85, y);
    doc.text(String(it.qty), 175, y, { align: 'right' });
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.line(20, y + 4, 190, y + 4);
    y += 10;
  });

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(6, 78, 59);
  doc.text('TOTAL QTY', 85, y + 2);
  doc.text(String(doRec.total_qty || 0), 175, y + 2, { align: 'right' });
  doc.setDrawColor(16, 185, 129);
  doc.setLineWidth(0.5);
  doc.line(20, y - 1, 190, y - 1);

  // Signature area
  y += 18;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('Customer Acknowledgement', 20, y);
  doc.setDrawColor(16, 185, 129);
  doc.setLineWidth(0.4);
  doc.line(20, y + 2, 190, y + 2);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('I acknowledge receipt of the above items in good condition.', 20, y + 10);

  y += 18;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.rect(20, y, 75, 30);
  doc.rect(115, y, 75, 30);

  if (sigDataUrl) {
    try {
      doc.addImage(sigDataUrl, 'PNG', 21, y + 1, 73, 28);
    } catch (e) {
      /* ignore bad image */
    }
  }

  doc.setFontSize(7.5);
  doc.setTextColor(150, 150, 150);
  doc.text('Customer Signature', 20, y + 34);
  doc.text(al.customer_name || doRec.remark || '—', 20, y + 39);
  doc.text('Staff Signature', 115, y + 34);
  doc.text(staff, 115, y + 39);

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(180, 180, 180);
  doc.text(
    'MJM Nursery AI · ' + (doRec.do_number || '') + ' · Printed ' + now.toISOString().slice(0, 19).replace('T', ' '),
    105,
    287,
    { align: 'center' },
  );

  doc.save((doRec.do_number || 'DO').replace(/[/\\]/g, '_') + '_' + now.toISOString().slice(0, 10) + '.pdf');
}
