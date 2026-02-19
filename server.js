const express = require('express');
const https = require('https');
const path = require('path');
const app = express();
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'https://discordapp.com/api/webhooks/1470551132450586705/_i4HvWyfBcIcDkIzAMhmENtkdN2oIS_sDyfYfHCW9ZvTZwv6II8R-Ca62htgIAH5ayVA';

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '1mb' }));

const CRYPTO_ADDRESSES = {
    btc: 'bc1qvcw6pctmmn940q3rrytt7hk6w467stsccqm54l',
    eth: '0xDee06F2d6534cB11febFE4926ED2A69E0c4497fD',
    ltc: 'LgFpBdKHw7nzoXrJR1aj9UKvizWzb2dBkW'
};

const CHAIN_CONFIG = {
    btc: { chain: 'bitcoin', decimals: 8, displayDecimals: 8, address: CRYPTO_ADDRESSES.btc },
    eth: { chain: 'ethereum', decimals: 18, displayDecimals: 6, address: CRYPTO_ADDRESSES.eth },
    ltc: { chain: 'litecoin', decimals: 8, displayDecimals: 8, address: CRYPTO_ADDRESSES.ltc }
};

const CONFIRMATIONS_REQUIRED = {
    btc: 1,
    eth: 12,
    ltc: 2
};

const CRYPTO_FEE_PCT = 0.05;
const orders = new Map();
const SHIPPING_ORIGIN = {
    label: '91-609 Puamaeole Street, #34 R, Kapolei, HI',
    lat: 21.3362,
    lon: -158.0846
};

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    if (res.statusCode && res.statusCode >= 400) {
                        return reject(new Error(`HTTP ${res.statusCode}`));
                    }
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', reject);
    });
}

function fetchJsonPost(url, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const request = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    if (res.statusCode && res.statusCode >= 400) {
                        return reject(new Error(`HTTP ${res.statusCode}`));
                    }
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(error);
                }
            });
        });

        request.on('error', reject);
        request.write(payload);
        request.end();
    });
}

function fetchJsonWithHeaders(url, headers) {
    return new Promise((resolve, reject) => {
        const options = new URL(url);
        const request = https.request({
            method: 'GET',
            hostname: options.hostname,
            path: options.pathname + options.search,
            headers
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    if (res.statusCode && res.statusCode >= 400) {
                        return reject(new Error(`HTTP ${res.statusCode}`));
                    }
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(error);
                }
            });
        });

        request.on('error', reject);
        request.end();
    });
}

function postDiscordWebhook(payload) {
    return new Promise((resolve, reject) => {
        if (!DISCORD_WEBHOOK_URL) {
            return resolve();
        }

        const data = JSON.stringify(payload);
        const webhookUrl = new URL(DISCORD_WEBHOOK_URL);
        const request = https.request({
            method: 'POST',
            hostname: webhookUrl.hostname,
            path: webhookUrl.pathname + webhookUrl.search,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            res.on('data', () => {});
            res.on('end', resolve);
        });

        request.on('error', reject);
        request.write(data);
        request.end();
    });
}

function buildBlockchairUrl(path) {
    const apiKey = process.env.BLOCKCHAIR_API_KEY;
    let url = `https://api.blockchair.com/${path}`;
    if (apiKey) {
        url += `?key=${encodeURIComponent(apiKey)}`;
    }
    return url;
}

async function fetchRateUsd(chain) {
    const coinbaseMap = {
        bitcoin: 'BTC',
        ethereum: 'ETH',
        litecoin: 'LTC'
    };

    const symbol = coinbaseMap[chain];
    if (!symbol) return null;

    try {
        const url = `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`;
        const data = await fetchJson(url);
        const amount = Number(data?.data?.amount);
        return Number.isFinite(amount) ? amount : null;
    } catch (error) {
        console.error(`[crypto] rate fetch failed for ${chain} via Coinbase:`, error.message);
        return null;
    }
}

async function fetchConfirmedBalance(chain, address) {
    if (chain === 'solana') {
        try {
            const data = await fetchJsonPost('https://api.mainnet-beta.solana.com', {
                jsonrpc: '2.0',
                id: 1,
                method: 'getBalance',
                params: [address, { commitment: 'finalized' }]
            });
            const lamports = data?.result?.value ?? 0;
            return BigInt(lamports);
        } catch (error) {
            console.error('[crypto] balance fetch failed for solana via RPC:', error.message);
            return 0n;
        }
    }

    const url = buildBlockchairUrl(`${chain}/dashboards/address/${address}`);
    try {
        const data = await fetchJson(url);
        const entry = data?.data?.[address];
        const addressInfo = entry?.address || entry;
        const balance = addressInfo?.balance ?? 0;
        return BigInt(balance);
    } catch (error) {
        console.error(`[crypto] balance fetch failed for ${chain}:`, error.message);
        return 0n;
    }
}

function toSmallestUnits(amount, decimals) {
    const fixed = amount.toFixed(decimals);
    const normalized = fixed.replace('.', '');
    return BigInt(normalized);
}

function formatSmallestUnits(amountSmallest, decimals) {
    const negative = amountSmallest < 0n;
    const value = negative ? -amountSmallest : amountSmallest;
    const raw = value.toString().padStart(decimals + 1, '0');
    const whole = raw.slice(0, -decimals);
    const fraction = raw.slice(-decimals).replace(/0+$/, '');
    const formatted = fraction ? `${whole}.${fraction}` : whole;
    return negative ? `-${formatted}` : formatted;
}

function toRadians(value) {
    return (value * Math.PI) / 180;
}

function haversineMiles(lat1, lon1, lat2, lon2) {
    const earthRadiusMiles = 3958.8;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusMiles * c;
}

function getShippingTier(distanceMiles) {
    if (distanceMiles <= 25) return 6;
    if (distanceMiles <= 100) return 12;
    if (distanceMiles <= 500) return 18;
    if (distanceMiles <= 1500) return 25;
    if (distanceMiles <= 3000) return 35;
    return 45;
}

// Routes
app.get('/', (req, res) => {
    res.render('index');
});

app.get('/products', (req, res) => {
    res.render('products');
});

app.get('/checkout', (req, res) => {
    res.render('checkout');
});

app.get('/gallery', (req, res) => {
    res.render('gallery');
});

app.get('/videos', (req, res) => {
    res.render('videos');
});

app.get('/contact', (req, res) => {
    res.render('contact');
});

app.post('/api/crypto/create-order', async (req, res) => {
    try {
        const items = Array.isArray(req.body.items) ? req.body.items : [];
        if (items.length === 0) {
            return res.status(400).json({ error: 'Cart is empty.' });
        }

        const discountUsdRaw = Number(req.body.discountUsd) || 0;
        const discountUsd = discountUsdRaw > 0 ? discountUsdRaw : 0;
        const promoCode = typeof req.body.promoCode === 'string' ? req.body.promoCode : '';

        const subtotal = items.reduce((sum, item) => {
            const price = Number(item.price) || 0;
            const quantity = Number(item.quantity) || 0;
            const total = Number(item.total) || price * quantity;
            return sum + total;
        }, 0);

        const shippingUsdRaw = Number(req.body.shippingUsd) || 0;
        const shippingUsd = shippingUsdRaw > 0 ? shippingUsdRaw : 0;

        const subtotalAfterDiscount = Math.max(0, subtotal - discountUsd) + shippingUsd;
        const usdSubtotal = Number(subtotalAfterDiscount.toFixed(2));
        const feeUsd = Number((usdSubtotal * CRYPTO_FEE_PCT).toFixed(2));
        const randomCents = Number(((Math.floor(Math.random() * 9) + 1) / 100).toFixed(2));
        const usdTotal = Number((usdSubtotal + feeUsd + randomCents).toFixed(2));

        const rateEntries = await Promise.all(Object.entries(CHAIN_CONFIG).map(async ([coin, config]) => {
            const rate = await fetchRateUsd(config.chain);
            return [coin, rate];
        }));

        const rates = Object.fromEntries(rateEntries);
        const missingRate = Object.entries(rates).find(([, rate]) => !rate);
        if (missingRate) {
            return res.status(502).json({
                error: `Unable to fetch live crypto rates for ${missingRate[0].toUpperCase()}. Try again.`
            });
        }

        const balanceEntries = await Promise.all(Object.entries(CHAIN_CONFIG).map(async ([coin, config]) => {
            const balance = await fetchConfirmedBalance(config.chain, config.address);
            return [coin, balance];
        }));

        const balances = Object.fromEntries(balanceEntries);

        const coins = {};
        Object.entries(CHAIN_CONFIG).forEach(([coin, config]) => {
            const rate = rates[coin];
            const amount = usdTotal / rate;
            const amountSmallest = toSmallestUnits(amount, config.decimals);
            coins[coin] = {
                address: config.address,
                amount: Number(amount.toFixed(config.displayDecimals)),
                amountSmallest: amountSmallest.toString(),
                startBalance: balances[coin].toString(),
                rate,
                decimals: config.decimals,
                displayDecimals: config.displayDecimals
            };
        });

        const orderId = `ord_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        orders.set(orderId, {
            id: orderId,
            items,
            discountUsd: Number(discountUsd.toFixed(2)),
            promoCode,
            usdSubtotal,
            feePct: CRYPTO_FEE_PCT,
            feeUsd,
            randomCents,
            usdTotal,
            coins,
            createdAt: Date.now()
        });

        const responseCoins = Object.fromEntries(Object.entries(coins).map(([coin, data]) => [
            coin,
            {
                address: data.address,
                amount: data.amount,
                displayDecimals: data.displayDecimals
            }
        ]));

        res.json({
            orderId,
            usdTotal,
            feePct: CRYPTO_FEE_PCT,
            feeUsd,
            randomCents,
            confirmations: CONFIRMATIONS_REQUIRED,
            coins: responseCoins
        });
    } catch (error) {
        console.error('[crypto] create-order failed:', error);
        res.status(500).json({ error: error.message || 'Unable to create crypto order.' });
    }
});

app.post('/api/checkout/webhook', async (req, res) => {
    try {
        const { email, items, total, event, client, receiptId, address, promoCode, discountUsd, mention, priority, paymentMethod, shipping } = req.body || {};
        const safeItems = Array.isArray(items) ? items.slice(0, 25) : [];
        const itemLines = safeItems.map((item) => {
            const name = String(item?.name || 'Item');
            const qty = Number(item?.quantity) || 0;
            const price = Number(item?.price) || 0;
            const option = item?.option ? ` (${item.option})` : '';
            return `${name}${option} x${qty} — $${price.toFixed(2)}`;
        });

        const statusMap = {
            checkout_saved: 'Unpaid (details saved)',
            checkout_pay: 'Payment started',
            payment_confirmed: 'Paid',
            cash_checkout: 'Cash (meetup request)',
            giftcard_checkout: 'Gift card (meetup request)'
        };

        const statusLabel = statusMap[event] || (event ? event.replace(/_/g, ' ') : 'checkout');
        const customerLines = [
            email ? `Email: ${email}` : 'Email: (none)',
            address?.name ? `Name: ${address.name}` : null,
            address?.phone ? `Phone: ${address.phone}` : null,
            `IP: ${req.ip || 'unknown'}`
        ].filter(Boolean);

        const shippingLines = address ? [
            address.address1 && `Address: ${address.address1}`,
            address.address2 && `Address 2: ${address.address2}`,
            address.city && address.state && address.zip && `City: ${address.city}, ${address.state} ${address.zip}`,
            address.country && `Country: ${address.country}`,
            address.notes && `Notes: ${address.notes}`
        ].filter(Boolean) : [];

        const orderLines = [
            receiptId ? `Receipt: ${receiptId}` : 'Receipt: EMO-UNKNOWN',
            promoCode ? `Promo: ${promoCode}` : null,
            discountUsd ? `Discount: -$${Number(discountUsd).toFixed(2)}` : null,
            shipping?.amount != null ? `Shipping: $${Number(shipping.amount).toFixed(2)}${shipping.distanceMiles ? ` (${Number(shipping.distanceMiles).toFixed(1)} mi)` : ''}` : null,
            total != null ? `Total: $${Number(total).toFixed(2)}` : 'Total: (unknown)'
        ].filter(Boolean);

        const embed = {
            title: paymentMethod ? `Checkout Update (${paymentMethod})` : 'Checkout Update',
            color: statusLabel.toLowerCase().includes('paid') ? 0x22c55e : 0xff6b00,
            fields: [
                {
                    name: 'Status',
                    value: statusLabel,
                    inline: true
                },
                {
                    name: 'Customer',
                    value: customerLines.join('\n').slice(0, 1024) || '(none)',
                    inline: true
                },
                {
                    name: 'Order',
                    value: orderLines.join('\n').slice(0, 1024),
                    inline: true
                }
            ],
            footer: {
                text: `UA: ${client?.userAgent || 'unknown'} | ${client?.platform || 'unknown'} | ${client?.language || 'unknown'} | ${client?.timezone || 'unknown'}`
            }
        };

        if (shippingLines.length) {
            embed.fields.push({
                name: 'Shipping',
                value: shippingLines.join('\n').slice(0, 1024)
            });
        }

        if (itemLines.length) {
            embed.fields.push({
                name: 'Items',
                value: itemLines.join('\n').slice(0, 1024)
            });
        }

        const contentParts = [];
        if (mention) contentParts.push(mention);
        if (priority) contentParts.push(priority);
        if (receiptId) contentParts.push(`Order: ${receiptId}`);

        await postDiscordWebhook({
            content: contentParts.join(' ').trim() || undefined,
            embeds: [embed]
        });
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: 'Unable to send webhook.' });
    }
});

app.post('/api/shipping/quote', async (req, res) => {
    try {
        const { address1, address2, city, state, zip, country } = req.body || {};
        if (!address1 || !city || !state || !zip || !country) {
            return res.status(400).json({ error: 'Missing address fields.' });
        }

        // Validate USA address
        const normalizedCountry = String(country).trim().toLowerCase();
        const normalizedZip = String(zip).trim();
        
        if (normalizedCountry !== 'united states' && normalizedCountry !== 'usa' && normalizedCountry !== 'us') {
            return res.status(400).json({ error: 'We currently only ship within the United States.' });
        }

        // Basic ZIP code validation (5 digits or 5+4 format)
        const zipPattern = /^\d{5}(-\d{4})?$/;
        if (!zipPattern.test(normalizedZip)) {
            return res.status(400).json({ error: 'Invalid USA ZIP code format.' });
        }

        const query = `${address1} ${address2 || ''}, ${city}, ${state} ${zip}, ${country}`.trim();
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
        const data = await fetchJsonWithHeaders(url, {
            'User-Agent': 'EmotoHI Checkout (shipping quote)'
        });

        const first = Array.isArray(data) ? data[0] : null;
        if (!first || !first.lat || !first.lon) {
            return res.status(400).json({ error: 'Unable to geocode address.' });
        }

        const lat = Number(first.lat);
        const lon = Number(first.lon);
        if (isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({ error: 'Invalid coordinates.' });
        }

        const distanceMiles = haversineMiles(SHIPPING_ORIGIN.lat, SHIPPING_ORIGIN.lon, lat, lon);
        const amount = getShippingTier(distanceMiles);

        res.json({
            amount,
            distanceMiles: Number(distanceMiles.toFixed(2)),
            origin: SHIPPING_ORIGIN.label
        });
    } catch (error) {
        res.status(500).json({ error: 'Unable to calculate shipping.' });
    }
});

app.get('/api/crypto/order/:orderId/:coin/status', async (req, res) => {
    try {
        const { orderId, coin } = req.params;
        const order = orders.get(orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found.' });
        }

        const coinData = order.coins[coin];
        const config = CHAIN_CONFIG[coin];
        if (!coinData || !config) {
            return res.status(400).json({ error: 'Unsupported coin.' });
        }

        const currentBalance = await fetchConfirmedBalance(config.chain, config.address);
        const startBalance = BigInt(coinData.startBalance);
        const required = BigInt(coinData.amountSmallest);
        let received = currentBalance - startBalance;
        if (received < 0n) received = 0n;

        const isPaid = received >= required;
        if (isPaid && !coinData.paidAt) {
            coinData.paidAt = Date.now();
        }

        res.json({
            status: isPaid ? 'paid' : 'pending',
            received: formatSmallestUnits(received, config.decimals),
            required: formatSmallestUnits(required, config.decimals),
            confirmationsRequired: CONFIRMATIONS_REQUIRED[coin]
        });
    } catch (error) {
        res.status(500).json({ error: 'Unable to check payment status.' });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`EmotoHI server running on http://localhost:${PORT}`);
});
