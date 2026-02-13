/**
 * PDF Генератор талонів на пальне OKKO
 * Ідентичний оригінальному дизайну OKKO:
 *  - Чорний верх з жовтим типом пального + OKKO лого
 *  - QR-код + Дійсний до + літри
 *  - Великий номер талону
 *  - Юридичний текст + гаряча лінія
 */

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('path');

// Шляхи до шрифтів з підтримкою кирилиці
const FONT_REGULAR = path.join(__dirname, 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf');

// Кольори OKKO
const OKKO_YELLOW = '#FFD200';
const OKKO_BLACK = '#1a1a1a';
const WHITE = '#FFFFFF';
const TEXT_DARK = '#1a1a1a';
const TEXT_GRAY = '#555555';
const LINE_COLOR = '#CCCCCC';

class CouponPDF {
    /**
     * Генерує PDF-талон, ідентичний оригіналу OKKO
     */
    static async generate(options) {
        const width = 420;
        const height = 650;

        const doc = new PDFDocument({
            size: [width, height],
            margins: { top: 0, bottom: 0, left: 0, right: 0 }
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

        // ================================================================
        // 1. ЧОРНИЙ ВЕРХНІЙ БЛОК (тип пального + OKKO лого)
        // ================================================================
        const headerHeight = 240;
        doc.rect(0, 0, width, headerHeight).fill(OKKO_BLACK);

        // Тип пального (великий жовтий текст зліва)
        const fuelType = options.fuelType || 'Дизельне паливо';
        const fuelLines = this._formatFuelType(fuelType);

        doc.fontSize(52)
            .fillColor(OKKO_YELLOW)
            .font('Bold');

        fuelLines.forEach((line, i) => {
            doc.text(line, 20, 30 + i * 58, { width: 200 });
        });

        // OKKO лого справа — жовте коло з хвилями
        this._drawOkkoLogo(doc, width - 130, 30, 100);

        // ================================================================
        // 2. БІЛИЙ СЕРЕДНІЙ БЛОК (QR + дата + літри)
        // ================================================================
        const midY = headerHeight + 15;

        // QR-код зліва
        const qrContent = options.qrData || options.couponNumber || '';
        if (qrContent) {
            try {
                const qrBuffer = await QRCode.toBuffer(qrContent, {
                    width: 120,
                    margin: 1,
                    errorCorrectionLevel: 'H',
                    color: { dark: '#000000', light: '#ffffff' }
                });
                doc.image(qrBuffer, 20, midY, { width: 110, height: 110 });
            } catch (err) {
                console.error('QR generation error:', err);
            }
        }

        // Дійсний до (справа від QR)
        const validDate = this._formatDate(options.validUntil);
        doc.fontSize(13)
            .fillColor(TEXT_DARK)
            .font('Bold')
            .text(`Дійсний до ${validDate} включно.`, 145, midY + 8, {
                width: 250
            });

        // Літри (великий текст справа від QR)
        doc.fontSize(56)
            .fillColor(TEXT_DARK)
            .font('Bold')
            .text(`${options.liters}`, 145, midY + 38, {
                width: 150,
                continued: false
            });

        doc.fontSize(28)
            .fillColor(TEXT_DARK)
            .font('Bold')
            .text('л', 145 + this._getNumberWidth(options.liters, 56) + 5, midY + 55);

        // ================================================================
        // 3. ГОРИЗОНТАЛЬНА ЛІНІЯ
        // ================================================================
        const lineY = midY + 120;
        doc.moveTo(15, lineY).lineTo(width - 15, lineY)
            .lineWidth(1).strokeColor(LINE_COLOR).stroke();

        // ================================================================
        // 4. ВЕЛИКИЙ НОМЕР ТАЛОНУ
        // ================================================================
        const numY = lineY + 12;
        doc.fontSize(24)
            .fillColor(TEXT_DARK)
            .font('Bold')
            .text(options.couponNumber || '', 15, numY, {
                align: 'center',
                width: width - 30
            });

        // ================================================================
        // 5. ЮРИДИЧНИЙ ТЕКСТ
        // ================================================================
        const legalY = numY + 40;

        doc.fontSize(8.5)
            .fillColor(TEXT_GRAY)
            .font('Regular');

        const legalText = `Перелік АЗК «ОККО», де приймаються талони:\nhttps://www.okko.ua/fuel-map\nОбміну, поверненню, повторній видачі не підлягає. Вартість протермінованого талону не повертається. Залишок невикористаного пального по талону не зберігається. На цей талон не поширюються знижки та спеціальні пропозиції, які діють на АЗК «ОККО».`;

        doc.text(legalText, 20, legalY, {
            width: width - 40,
            lineGap: 2
        });

        // Деталі + телефон
        const detailsY = legalY + 85;
        doc.fontSize(9)
            .fillColor(TEXT_GRAY)
            .font('Regular')
            .text('Деталі ', 20, detailsY, { continued: true });

        doc.fontSize(9)
            .fillColor(OKKO_YELLOW)
            .font('Bold')
            .text('0 800 501 101', { continued: false });

        doc.end();
        return finished;
    }

    /**
     * Малює лого OKKO — жовте коло з концентричними хвилями + текст OKKO
     */
    static _drawOkkoLogo(doc, x, y, size) {
        const centerX = x + size / 2;
        const centerY = y + size / 2;

        // Зовнішні хвилі (жовті дуги)
        for (let i = 0; i < 3; i++) {
            const radius = size / 2 + 15 - i * 8;
            doc.save()
                .lineWidth(5)
                .strokeColor(OKKO_YELLOW)
                .strokeOpacity(0.6 - i * 0.15);

            // Верхня дуга
            doc.path(`M ${centerX - radius * 0.7} ${centerY - radius * 0.7} A ${radius} ${radius} 0 0 1 ${centerX + radius * 0.7} ${centerY - radius * 0.7}`)
                .stroke();

            doc.restore();
        }

        // Жовте основне коло
        doc.circle(centerX, centerY, size / 2)
            .fill(OKKO_YELLOW);

        // Чорне внутрішнє коло (кільце)
        doc.circle(centerX, centerY, size / 2 - 12)
            .fill(OKKO_BLACK);

        // Жовте маленьке коло всередині
        doc.circle(centerX, centerY, size / 2 - 24)
            .fill(OKKO_YELLOW);

        // Чорне ядро
        doc.circle(centerX, centerY, size / 2 - 36)
            .fill(OKKO_BLACK);

        // Текст OKKO під колом
        doc.fontSize(22)
            .fillColor(WHITE)
            .font('Bold')
            .text('OKKO', x - 10, y + size + 20, {
                width: size + 20,
                align: 'center'
            });
    }

    /**
     * Форматує тип пального в рядки для відображення
     * "Дизельне паливо" → ["ДП", "ЄВРО"]
     * "PULLS Diesel" → ["PULLS", "DIESEL"]
     */
    static _formatFuelType(fuelType) {
        const ft = fuelType.toUpperCase();

        // Маппінг найпоширеніших типів OKKO
        if (ft.includes('ДИЗЕЛ') || ft.includes('ДП')) return ['ДП', 'ЄВРО'];
        if (ft.includes('PULLS') && ft.includes('95')) return ['PULLS', '95'];
        if (ft.includes('PULLS') && ft.includes('98')) return ['PULLS', '98'];
        if (ft.includes('PULLS') && ft.includes('DIESEL')) return ['PULLS', 'DIESEL'];
        if (ft.includes('PULLS')) return ['PULLS', '95'];
        if (ft.includes('95')) return ['A-95', 'ЄВРО'];
        if (ft.includes('92')) return ['A-92'];
        if (ft.includes('ГАЗ') || ft.includes('LPG')) return ['ГАЗ', 'LPG'];

        // Дефолт — розбиваємо на 2 рядки
        const words = ft.split(' ');
        if (words.length >= 2) {
            return [words.slice(0, Math.ceil(words.length / 2)).join(' '),
            words.slice(Math.ceil(words.length / 2)).join(' ')];
        }
        return [ft];
    }

    /**
     * Форматує дату з ISO в DD.MM.YYYY
     */
    static _formatDate(dateStr) {
        if (!dateStr) return '—';
        // Якщо вже у форматі DD.MM.YYYY
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) return dateStr;
        // ISO: 2045-08-31 → 31.08.2045
        const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) return `${match[3]}.${match[2]}.${match[1]}`;
        return dateStr;
    }

    /**
     * Приблизна ширина числа в пікселях для позиціонування "л"
     */
    static _getNumberWidth(num, fontSize) {
        const digits = String(num).length;
        return digits * fontSize * 0.55;
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
