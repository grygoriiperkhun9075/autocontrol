/**
 * PDF Генератор талонів на пальне
 * Створює PDF-документ з талоном обраного номіналу
 */

const PDFDocument = require('pdfkit');

class CouponPDF {
    /**
     * Генерує PDF-талон
     * @param {Object} options
     * @param {number} options.liters - Номінал в літрах
     * @param {string} options.companyName - Назва компанії
     * @param {string} options.couponNumber - Номер талону
     * @param {string} options.date - Дата видачі
     * @param {string} options.validUntil - Дійсний до
     * @param {string} options.fuelType - Тип пального
     * @returns {Promise<Buffer>} PDF як Buffer
     */
    static generate(options) {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({
                    size: [420, 595], // A5
                    margins: { top: 30, bottom: 30, left: 30, right: 30 }
                });

                const chunks = [];
                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                const width = 420;
                const centerX = width / 2;

                // ===== Фон — рамка =====
                doc.roundedRect(15, 15, width - 30, 565, 10)
                    .lineWidth(3)
                    .strokeColor('#6C3CE1')
                    .stroke();

                // Внутрішня рамка
                doc.roundedRect(20, 20, width - 40, 555, 8)
                    .lineWidth(1)
                    .strokeColor('#8B5CF6')
                    .stroke();

                // ===== Заголовок =====
                doc.fontSize(14)
                    .fillColor('#6C3CE1')
                    .text('ТАЛОН НА ПАЛЬНЕ', 30, 40, { align: 'center', width: width - 60 });

                // Назва компанії
                doc.fontSize(18)
                    .fillColor('#1a1a2e')
                    .font('Helvetica-Bold')
                    .text(options.companyName || 'AutoControl', 30, 65, { align: 'center', width: width - 60 });

                // Горизонтальна лінія
                doc.moveTo(40, 95).lineTo(width - 40, 95)
                    .lineWidth(1).strokeColor('#E0E0E0').stroke();

                // ===== Номінал — великий =====
                doc.fontSize(72)
                    .fillColor('#6C3CE1')
                    .font('Helvetica-Bold')
                    .text(`${options.liters}`, 30, 115, { align: 'center', width: width - 60 });

                doc.fontSize(24)
                    .fillColor('#4a4a6a')
                    .font('Helvetica')
                    .text('ЛІТРІВ', 30, 195, { align: 'center', width: width - 60 });

                // Тип пального
                doc.fontSize(16)
                    .fillColor('#6C3CE1')
                    .font('Helvetica-Bold')
                    .text(options.fuelType || 'ДП / А-95', 30, 230, { align: 'center', width: width - 60 });

                // Горизонтальна лінія
                doc.moveTo(40, 260).lineTo(width - 40, 260)
                    .lineWidth(1).strokeColor('#E0E0E0').stroke();

                // ===== Деталі =====
                const detailsY = 280;
                const labelX = 50;
                const valueX = 200;

                const details = [
                    ['Номер талону:', `#${options.couponNumber}`],
                    ['Дата видачі:', options.date],
                    ['Дійсний до:', options.validUntil],
                    ['Мережа АЗС:', options.station || 'OKKO'],
                ];

                details.forEach(([label, value], i) => {
                    const y = detailsY + (i * 30);
                    doc.fontSize(11)
                        .fillColor('#666')
                        .font('Helvetica')
                        .text(label, labelX, y);

                    doc.fontSize(12)
                        .fillColor('#1a1a2e')
                        .font('Helvetica-Bold')
                        .text(value, valueX, y);
                });

                // Горизонтальна лінія
                const lineY = detailsY + details.length * 30 + 15;
                doc.moveTo(40, lineY).lineTo(width - 40, lineY)
                    .lineWidth(1).strokeColor('#E0E0E0').stroke();

                // ===== Штрих-код (імітація) =====
                const barcodeY = lineY + 20;
                const barcodeWidth = 200;
                const barcodeX = centerX - barcodeWidth / 2;

                // Малюємо штрих-код із номера талону
                const code = options.couponNumber.toString();
                for (let i = 0; i < 40; i++) {
                    const barWidth = (i % 3 === 0) ? 3 : (i % 2 === 0) ? 2 : 1;
                    const x = barcodeX + i * 5;
                    if (i % 2 === 0) {
                        doc.rect(x, barcodeY, barWidth, 50)
                            .fillColor('#1a1a2e')
                            .fill();
                    }
                }

                // Номер під штрих-кодом
                doc.fontSize(10)
                    .fillColor('#666')
                    .font('Helvetica')
                    .text(code.padStart(12, '0'), 30, barcodeY + 55, { align: 'center', width: width - 60 });

                // ===== Підвал =====
                doc.fontSize(8)
                    .fillColor('#999')
                    .font('Helvetica')
                    .text('Талон дійсний для одноразового використання на мережі АЗС.', 30, 510, {
                        align: 'center', width: width - 60
                    });

                doc.fontSize(8)
                    .fillColor('#999')
                    .text('Згенеровано системою AutoControl', 30, 525, {
                        align: 'center', width: width - 60
                    });

                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }
}

module.exports = CouponPDF;
