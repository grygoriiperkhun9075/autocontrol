/**
 * PDF Генератор талонів на пальне OKKO
 * Створює PDF-документ максимально схожий на оригінальний талон OKKO
 * з Code128 штрих-кодом для сканування на АЗС
 */

const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');
const path = require('path');

// Шляхи до шрифтів з підтримкою кирилиці
const FONT_REGULAR = path.join(__dirname, 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf');

// Кольори OKKO
const OKKO_GREEN = '#89B82C';
const OKKO_DARK_GREEN = '#5A8A00';
const TEXT_DARK = '#1a1a1a';
const TEXT_GRAY = '#666666';
const TEXT_LIGHT = '#999999';
const BORDER_COLOR = '#E0E0E0';

class CouponPDF {
    /**
     * Генерує PDF-талон, ідентичний оригіналу OKKO
     * @param {Object} options
     * @param {number} options.liters - Номінал в літрах
     * @param {string} options.couponNumber - Номер талону (20 цифр)
     * @param {string} options.qrData - Дані для QR (якщо є)
     * @param {string} options.validUntil - Дійсний до
     * @param {string} options.fuelType - Тип пального
     * @returns {Promise<Buffer>} PDF як Buffer
     */
    static async generate(options) {
        const doc = new PDFDocument({
            size: [420, 595], // A5
            margins: { top: 25, bottom: 25, left: 25, right: 25 }
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
        const contentWidth = width - 50;

        // ===== Зовнішня рамка =====
        doc.roundedRect(10, 10, width - 20, 575, 8)
            .lineWidth(2).strokeColor(OKKO_GREEN).stroke();

        // ===== Верхня зелена смуга =====
        doc.rect(10, 10, width - 20, 50)
            .fill(OKKO_GREEN);

        // ===== Лого OKKO =====
        doc.fontSize(28)
            .fillColor('#FFFFFF')
            .font('Bold')
            .text('OKKO', 25, 20, { align: 'center', width: contentWidth });

        // ===== Підзаголовок — тип документа =====
        doc.fontSize(9)
            .fillColor('#FFFFFF')
            .font('Regular')
            .text('ТАЛОН НА ПАЛЬНЕ', 25, 44, { align: 'center', width: contentWidth });

        // ===== Тип пального =====
        const fuelType = options.fuelType || 'Дизельне паливо';
        doc.fontSize(16)
            .fillColor(OKKO_DARK_GREEN)
            .font('Bold')
            .text(fuelType.toUpperCase(), 25, 75, { align: 'center', width: contentWidth });

        // Горизонтальна лінія
        doc.moveTo(30, 100).lineTo(width - 30, 100)
            .lineWidth(1).strokeColor(BORDER_COLOR).stroke();

        // ===== Номінал (великий текст) =====
        doc.fontSize(72)
            .fillColor(OKKO_GREEN)
            .font('Bold')
            .text(`${options.liters}`, 25, 110, { align: 'center', width: contentWidth });

        doc.fontSize(18)
            .fillColor(TEXT_DARK)
            .font('Regular')
            .text('ЛІТРІВ', 25, 190, { align: 'center', width: contentWidth });

        // Горизонтальна лінія
        doc.moveTo(30, 220).lineTo(width - 30, 220)
            .lineWidth(1).strokeColor(BORDER_COLOR).stroke();

        // ===== Штрих-код Code128 =====
        const barcodeData = options.couponNumber || '';
        if (barcodeData) {
            try {
                const barcodeBuffer = await bwipjs.toBuffer({
                    bcid: 'code128',
                    text: barcodeData,
                    scale: 3,
                    height: 15,
                    includetext: false,
                    textxalign: 'center',
                });

                // Штрих-код по центру
                const barcodeWidth = 300;
                const barcodeHeight = 80;
                const barcodeX = (width - barcodeWidth) / 2;
                doc.image(barcodeBuffer, barcodeX, 235, {
                    width: barcodeWidth,
                    height: barcodeHeight
                });
            } catch (err) {
                console.error('❌ Barcode generation error:', err);
                // Fallback — показуємо номер великим текстом
                doc.fontSize(14).fillColor(TEXT_DARK).font('Bold')
                    .text(barcodeData, 25, 265, { align: 'center', width: contentWidth });
            }
        }

        // ===== Номер талону під штрих-кодом =====
        const formattedNum = this._formatNumber(options.couponNumber);
        doc.fontSize(11)
            .fillColor(TEXT_DARK)
            .font('Regular')
            .text(formattedNum, 25, 325, { align: 'center', width: contentWidth });

        // Горизонтальна лінія
        doc.moveTo(30, 350).lineTo(width - 30, 350)
            .lineWidth(1).strokeColor(BORDER_COLOR).stroke();

        // ===== QR-код (якщо є дані) =====
        const qrContent = options.qrData;
        if (qrContent) {
            try {
                const QRCode = require('qrcode');
                const qrBuffer = await QRCode.toBuffer(qrContent, {
                    width: 120,
                    margin: 1,
                    errorCorrectionLevel: 'H'
                });
                doc.image(qrBuffer, (width - 120) / 2, 360, { width: 120, height: 120 });
            } catch (err) {
                console.error('QR generation error:', err);
            }
        }

        // ===== Деталі =====
        const detailsY = qrContent ? 490 : 365;
        const labelX = 50;
        const valueX = 220;

        const details = [
            ['Номер талону:', formattedNum],
            ['Тип пального:', fuelType],
            ['Дійсний до:', options.validUntil || '—'],
        ];

        details.forEach(([label, value], i) => {
            const y = detailsY + (i * 22);
            doc.fontSize(9).fillColor(TEXT_GRAY).font('Regular')
                .text(label, labelX, y);
            doc.fontSize(10).fillColor(TEXT_DARK).font('Bold')
                .text(value, valueX, y);
        });

        // Горизонтальна лінія перед підвалом
        const footerLineY = detailsY + details.length * 22 + 10;
        doc.moveTo(30, footerLineY).lineTo(width - 30, footerLineY)
            .lineWidth(1).strokeColor(BORDER_COLOR).stroke();

        // ===== Підвал =====
        doc.fontSize(8)
            .fillColor(TEXT_GRAY)
            .font('Regular')
            .text('Талон дійсний для одноразового використання', 25, footerLineY + 10, {
                align: 'center', width: contentWidth
            });

        doc.fontSize(8)
            .fillColor(TEXT_GRAY)
            .text('на мережі АЗС OKKO. Покажіть штрих-код касиру.', 25, footerLineY + 22, {
                align: 'center', width: contentWidth
            });

        doc.fontSize(8)
            .fillColor(OKKO_GREEN)
            .font('Bold')
            .text('Гаряча лінія: 0 800 501 101  |  okko.ua', 25, footerLineY + 40, {
                align: 'center', width: contentWidth
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
