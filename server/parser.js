/**
 * Message Parser - Парсер повідомлень від водіїв
 */

class MessageParser {
    // Патерни для розпізнавання
    static patterns = {
        // Номер авто: AA 1234 BB, AA1234BB, АА 1234 ВВ
        plate: /([А-ЯІЇЄA-Z]{2})\s*(\d{4})\s*([А-ЯІЇЄA-Z]{2})/i,

        // Пробіг: 55000, пробіг 55000, 55000км, 55000 км
        mileage: /(?:пробіг|пробег|km|км)?\s*[:=]?\s*(\d{4,7})\s*(?:км|km)?/i,

        // Літри: 45л, 45.5 л, 45,5л, літрів 45
        liters: /(\d+[.,]?\d*)\s*(?:л|л\.|літр|литр|liters?)/i,

        // Ціна: 52.50, 52,50 грн, по 52.50, ціна 52.50
        price: /(?:по|ціна|цена|price|×|x|\*)?\s*(\d+[.,]\d{2})\s*(?:грн|uah)?/i,

        // АЗС: окко, wog, укрнафта
        station: /(?:азс|station)?\s*(окко|wog|укрнафта|shell|socar|авіас|брсм|motto)/i,

        // Повний бак
        fullTank: /(?:повний\s*бак|full\s*tank|до\s*повного)/i
    };

    /**
     * Парсинг повідомлення
     */
    static parse(text) {
        const result = {
            plate: null,
            mileage: null,
            liters: null,
            pricePerLiter: null,
            station: null,
            fullTank: false,
            rawText: text,
            parsed: false
        };

        if (!text || typeof text !== 'string') {
            return result;
        }

        // Нормалізація тексту
        const normalizedText = text
            .replace(/,/g, '.')
            .replace(/\s+/g, ' ')
            .trim();

        // Парсинг номера авто
        const plateMatch = normalizedText.match(this.patterns.plate);
        if (plateMatch) {
            result.plate = `${plateMatch[1].toUpperCase()} ${plateMatch[2]} ${plateMatch[3].toUpperCase()}`;
        }

        // Спочатку пробуємо комбінований шаблон: "Xл по Y.YY"
        const combinedMatch = normalizedText.match(/(\d+[.,]?\d*)\s*(?:л|літр|литр)\w*\s*(?:по|×|x|\*)\s*(\d+[.,]\d{1,2})/i);
        if (combinedMatch) {
            result.liters = parseFloat(combinedMatch[1].replace(',', '.'));
            result.pricePerLiter = parseFloat(combinedMatch[2].replace(',', '.'));
        } else {
            // Парсинг літрів окремо
            const litersMatch = normalizedText.match(this.patterns.liters);
            if (litersMatch) {
                result.liters = parseFloat(litersMatch[1].replace(',', '.'));
            }

            // Парсинг ціни — шукаємо "по X.XX" або "X.XX грн"
            // Спочатку шукаємо з обов'язковим "по"
            const priceWithPo = normalizedText.match(/(?:по|ціна|цена|price)\s*[:=]?\s*(\d+[.,]\d{1,2})/i);
            if (priceWithPo) {
                result.pricePerLiter = parseFloat(priceWithPo[1].replace(',', '.'));
            } else {
                // Потім шукаємо "X.XX грн" (з обов'язковим грн)
                const priceWithGrn = normalizedText.match(/(\d+[.,]\d{1,2})\s*(?:грн|uah)/i);
                if (priceWithGrn) {
                    result.pricePerLiter = parseFloat(priceWithGrn[1].replace(',', '.'));
                } else {
                    // Останній fallback: шукаємо десяткове число (XX.XX) що НЕ є частиною літрів
                    const priceMatch = normalizedText.match(this.patterns.price);
                    if (priceMatch) {
                        const priceVal = parseFloat(priceMatch[1].replace(',', '.'));
                        // Не використовуємо якщо це те ж число що й літри
                        if (!result.liters || Math.abs(priceVal - result.liters) > 0.01) {
                            result.pricePerLiter = priceVal;
                        }
                    }
                }
            }
        }

        // Парсинг пробігу - шукаємо числа від 4 до 7 цифр
        const numbers = normalizedText.match(/\d{4,7}/g);
        if (numbers) {
            // Вибираємо найбільше число як пробіг (виключаючи вже знайдені)
            const usedNumbers = [];
            if (plateMatch) usedNumbers.push(plateMatch[2]);

            const mileageCandidate = numbers.find(n => !usedNumbers.includes(n) && parseInt(n) > 1000);
            if (mileageCandidate) {
                result.mileage = parseInt(mileageCandidate);
            }
        }

        // Парсинг АЗС
        const stationMatch = normalizedText.match(this.patterns.station);
        if (stationMatch) {
            result.station = stationMatch[1].toUpperCase();
        }

        // Повний бак
        result.fullTank = this.patterns.fullTank.test(normalizedText);

        // Визначаємо чи успішно спарсили
        result.parsed = !!(result.plate || (result.liters && result.pricePerLiter));

        return result;
    }

    /**
     * Валідація даних заправки
     */
    static validateFuelData(data) {
        const errors = [];

        if (!data.plate) {
            errors.push('❌ Не вказано номер авто');
        }

        if (!data.liters || data.liters <= 0) {
            errors.push('❌ Не вказано кількість літрів');
        }

        if (!data.pricePerLiter || data.pricePerLiter <= 0) {
            errors.push('❌ Не вказано ціну за літр');
        }

        if (!data.mileage || data.mileage <= 0) {
            errors.push('❌ Не вказано пробіг');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Форматування підтвердження
     */
    static formatConfirmation(data) {
        const total = data.liters && data.pricePerLiter
            ? (data.liters * data.pricePerLiter).toFixed(2)
            : '?';

        return `
✅ *Заправка записана!*

🚗 Авто: \`${data.plate || 'Не вказано'}\`
📏 Пробіг: ${data.mileage ? data.mileage.toLocaleString() + ' км' : 'Не вказано'}
⛽ Паливо: ${data.liters || '?'} л × ${data.pricePerLiter || '?'} грн
💰 Сума: ${total} грн
${data.station ? '🏪 АЗС: ' + data.station : ''}
${data.fullTank ? '🔋 Повний бак' : ''}
        `.trim();
    }

    /**
     * Форматування помилки
     */
    static formatError(errors) {
        return `
⚠️ *Не вдалося розпізнати дані*

${errors.join('\n')}

📝 *Приклад правильного формату:*
\`AA 1234 BB 55500 45л 52.50\`

Або по рядках:
\`\`\`
AA 1234 BB
пробіг: 55500
45л по 52.50
\`\`\`
        `.trim();
    }
}

module.exports = MessageParser;
