/**
 * Automatic checkout emails, using SMTP.
 * Configure with: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, FROM_EMAIL.
 * If these are not set, sends are treated as no-ops.
 */
const nodemailer = require('nodemailer');

const FROM_EMAIL = process.env.FROM_EMAIL || 'support@emotohi.com';
const STORE_NAME = process.env.STORE_NAME || 'EmotoHI';

let transporter = null;

function getTransporter() {
    if (transporter !== null) return transporter;
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (host && user && pass) {
        transporter = nodemailer.createTransport({
            host,
            port: parseInt(process.env.SMTP_PORT || '587', 10),
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user, pass }
        });
        return transporter;
    }
    return null;
}

function formatAddress(addr) {
    if (!addr) return '';
    const parts = [
        addr.address1,
        addr.address2,
        [addr.city, addr.state, addr.zip].filter(Boolean).join(', '),
        addr.country
    ].filter(Boolean);
    return parts.join('\n');
}

function formatItems(items) {
    if (!Array.isArray(items) || items.length === 0) return 'No items listed.';
    return items.map((item) => {
        const name = String(item?.name || 'Item');
        const qty = Number(item?.quantity) || 0;
        const price = Number(item?.price) || 0;
        const lineTotal = Number(item?.total) || price * qty;
        const option = item?.option ? ` (${item.option})` : '';
        return `  • ${name}${option} x${qty} — $${lineTotal.toFixed(2)}`;
    }).join('\n');
}

/**
 * Send order confirmation to customer after payment is confirmed.
 */
async function sendOrderConfirmation(toEmail, options = {}) {
    const t = getTransporter();
    if (!t || !toEmail) return;

    const { receiptId = 'EMO-UNKNOWN', items = [], total, address, paymentMethod = 'Payment', shipping, discountUsd } = options;
    const itemBlock = formatItems(items);
    const addressBlock = formatAddress(address);

    const subject = `${STORE_NAME} – Order confirmed (${receiptId})`;
    const text = [
        `Thank you for your order!`,
        ``,
        `Order / Receipt: ${receiptId}`,
        `Payment: ${paymentMethod}`,
        ``,
        `Items:`,
        itemBlock,
        ``,
        discountUsd ? `Discount: -$${Number(discountUsd).toFixed(2)}` : null,
        shipping?.amount != null ? `Shipping: $${Number(shipping.amount).toFixed(2)}` : null,
        total != null ? `Total: $${Number(total).toFixed(2)}` : null,
        ``,
        `Shipping address:`,
        addressBlock || '(not provided)',
        ``,
        `We will follow up with shipping details. For questions, reply to this email or contact support@emotohi.com.`
    ].filter(Boolean).join('\n');

    const html = [
        `<p>Thank you for your order!</p>`,
        `<p><strong>Order / Receipt:</strong> ${receiptId}<br><strong>Payment:</strong> ${paymentMethod}</p>`,
        `<p><strong>Items:</strong></p><pre style="margin:0 0 1em;white-space:pre-wrap;">${itemBlock.replace(/</g, '&lt;')}</pre>`,
        discountUsd ? `<p>Discount: -$${Number(discountUsd).toFixed(2)}</p>` : '',
        shipping?.amount != null ? `<p>Shipping: $${Number(shipping.amount).toFixed(2)}</p>` : '',
        total != null ? `<p><strong>Total: $${Number(total).toFixed(2)}</strong></p>` : '',
        `<p><strong>Shipping address:</strong></p><pre style="margin:0 0 1em;white-space:pre-wrap;">${(addressBlock || '(not provided)').replace(/</g, '&lt;')}</pre>`,
        `<p>We will follow up with shipping details. For questions, reply to this email or contact support@emotohi.com.</p>`
    ].filter(Boolean).join('\n');

    try {
        await t.sendMail({
            from: `"${STORE_NAME}" <${FROM_EMAIL}>`,
            to: toEmail,
            subject,
            text,
            html
        });
        console.log('[email] Order confirmation sent to', toEmail);
    } catch (err) {
        console.error('[email] Order confirmation failed:', err.message);
    }
}

/**
 * Send a short "we received your request/details" email (checkout_saved, cash, gift card).
 */
async function sendCheckoutReceived(toEmail, options = {}) {
    const t = getTransporter();
    if (!t || !toEmail) return;

    const { receiptId = 'EMO-UNKNOWN', event, message } = options;
    const subject = `${STORE_NAME} – We received your ${event === 'checkout_saved' ? 'details' : 'request'} (${receiptId})`;
    const body = message || `We received your ${event === 'checkout_saved' ? 'shipping and contact details' : 'meetup request'}. We will be in touch. For questions, contact support@emotohi.com.`;

    try {
        await t.sendMail({
            from: `"${STORE_NAME}" <${FROM_EMAIL}>`,
            to: toEmail,
            subject,
            text: body,
            html: `<p>${body.replace(/\n/g, '<br>')}</p>`
        });
        console.log('[email] Checkout received sent to', toEmail);
    } catch (err) {
        console.error('[email] Checkout received failed:', err.message);
    }
}

module.exports = {
    sendOrderConfirmation,
    sendCheckoutReceived,
    isConfigured: () => !!getTransporter()
};
