/**
 * PDF Генератор талонів на пальне OKKO
 * Створює PDF-документ з QR-кодом для сканування на АЗС
 * Використовує DejaVu Sans для повної підтримки кирилиці
 */

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('path');

// Шляхи до шрифтів з підтримкою кирилиці
const FONT_REGULAR = path.join(__dirname, 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf');

class CouponPDF {
    /**
     * Генерує PDF-талон з QR-кодом
     * @param {Object} options
     * @param {number} options.liters - Номінал в літрах
     * @param {string} options.couponNumber - Номер талону
     * @param {string} options.qrData - Дані для QR-коду (з OKKO)
     * @param {string} options.date - Дата видачі
     * @param {string} options.validUntil - Дійсний до
     * @param {string} options.fuelType - Тип пального
     * @returns {Promise<Buffer>} PDF як Buffer
     */
    static async generate(options) {
        const doc = new PDFDocument({
            size: [420, 595], // A5
            margins: { top: 30, bottom: 30, left: 30, right: 30 }
        });

        // Реєструємо шрифти з підтримкою кирилиці
        doc.registerFont('Regular', FONT_REGULAR);
        doc.registerFont('Bold', FONT_BOLD);

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));

        const finished = new Promise((resolve, reject) => {
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
        });

        const width = 420;

        // ===== Рамка =====
        doc.roundedRect(15, 15, width - 30, 565, 10)
            .lineWidth(3).strokeColor('#00843D').stroke();

        doc.roundedRect(20, 20, width - 40, 555, 8)
            .lineWidth(1).strokeColor('#4CAF50').stroke();

        // ===== Лого OKKO =====
        doc.fontSize(22)
            .fillColor('#00843D')
            .font('Bold')
            .text('OKKO', 30, 35, { align: 'center', width: width - 60 });

        doc.fontSize(10)
            .fillColor('#666')
            .font('Regular')
            .text('Мережа АЗС', 30, 60, { align: 'center', width: width - 60 });

        // Горизонтальна лінія
        doc.moveTo(40, 80).lineTo(width - 40, 80)
            .lineWidth(1).strokeColor('#E0E0E0').stroke();

        // ===== Заголовок =====
        doc.fontSize(14)
            .fillColor('#333')
            .font('Bold')
            .text('ТАЛОН НА ПАЛЬНЕ', 30, 90, { align: 'center', width: width - 60 });

        // ===== Номінал =====
        doc.fontSize(64)
            .fillColor('#00843D')
            .font('Bold')
            .text(`${options.liters}`, 30, 115, { align: 'center', width: width - 60 });

        doc.fontSize(20)
            .fillColor('#4a4a6a')
            .font('Regular')
            .text('ЛІТРІВ', 30, 185, { align: 'center', width: width - 60 });

        // Тип пального
        doc.fontSize(14)
            .fillColor('#00843D')
            .font('Bold')
            .text(options.fuelType || 'Дизельне паливо', 30, 215, { align: 'center', width: width - 60 });

        // Горизонтальна лінія
        doc.moveTo(40, 240).lineTo(width - 40, 240)
            .lineWidth(1).strokeColor('#E0E0E0').stroke();

        // ===== QR-код =====
        if (options.qrData) {
            try {
                const qrBuffer = await QRCode.toBuffer(options.qrData, {
                    width: 160,
                    margin: 1,
                    errorCorrectionLevel: 'M'
                });
                doc.image(qrBuffer, (width - 160) / 2, 250, { width: 160, height: 160 });
            } catch (err) {
                console.error('QR generation error:', err);
                doc.fontSize(8).fillColor('#999').font('Regular')
                    .text('QR-код недоступний', 30, 320, { align: 'center', width: width - 60 });
            }
        } else {
            // Якщо немає QR-даних — показуємо номер талону великим
            doc.fontSize(12).fillColor('#333').font('Bold')
                .text('Номер талону:', 30, 270, { align: 'center', width: width - 60 });
            doc.fontSize(14).fillColor('#00843D').font('Bold')
                .text(options.couponNumber, 30, 290, { align: 'center', width: width - 60 });
        }

        // ===== Деталі =====
        const detailsY = 425;
        const labelX = 60;
        const valueX = 210;

        const details = [
            ['Номер талону:', this._formatNumber(options.couponNumber)],
            ['Дійсний до:', options.validUntil || '—'],
        ];

        details.forEach(([label, value], i) => {
            const y = detailsY + (i * 25);
            doc.fontSize(10).fillColor('#666').font('Regular')
                .text(label, labelX, y);
            doc.fontSize(11).fillColor('#1a1a2e').font('Bold')
                .text(value, valueX, y);
        });

        // Горизонтальна лінія
        doc.moveTo(40, detailsY + details.length * 25 + 10).lineTo(width - 40, detailsY + details.length * 25 + 10)
            .lineWidth(1).strokeColor('#E0E0E0').stroke();

        // ===== Підвал =====
        doc.fontSize(7)
            .fillColor('#999')
            .font('Regular')
            .text('Талон дійсний для одноразового використання на мережі АЗС OKKO.', 30, 500, {
                align: 'center', width: width - 60
            });

        doc.fontSize(7)
            .fillColor('#999')
            .text('Покажіть QR-код касиру для списання палива.', 30, 515, {
                align: 'center', width: width - 60
            });

        doc.fontSize(7)
            .fillColor('#bbb')
            .text('Згенеровано системою AutoControl', 30, 535, {
                align: 'center', width: width - 60
            });

        doc.end();
        return finished;
    }

    /**
     * Форматує номер талону: 99999600000021017335 → 999996 0000002101 7335
     */
    static _formatNumber(num) {
        if (!num) return '—';
        const s = num.toString().replace(/\s/g, '');
        if (s.length === 20) {
            return `${s.slice(0, 6)} ${s.slice(6, 16)} ${s.slice(16)}`;
        }
        return num;
    }
}

module.exports = CouponPDF;
