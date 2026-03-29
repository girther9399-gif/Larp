const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const https = require('https');
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

const NON_OAHU_FEE_USD = 7;
const OAHU_ZIPS_PAYPAL = new Set([
    '96701', '96706', '96707', '96709', '96712', '96717', '96730', '96731', '96734', '96744', '96759', '96762', '96782',
    '96786', '96789', '96791', '96792', '96795', '96797', '96801', '96802', '96803', '96804', '96805', '96806', '96807',
    '96808', '96809', '96810', '96811', '96812', '96813', '96814', '96815', '96816', '96817', '96818', '96819', '96820',
    '96821', '96822', '96823', '96824', '96825', '96826', '96828', '96830', '96836', '96837', '96838', '96839', '96840',
    '96841', '96843', '96844', '96846', '96847', '96848', '96849', '96850', '96853', '96854', '96857', '96858', '96859',
    '96860', '96861', '96863'
]);
const PAYPAL_PROMO_CODES = {
    EMOTO10: { type: 'percent', value: 10 },
    EMOTOHI10: { type: 'percent', value: 10 },
    EMO20: { type: 'flat', value: 20 }
};

function isOahuZipPaypal(zip) {
    if (!zip || typeof zip !== 'string') return false;
    const normalized = zip.trim().replace(/\s+/g, '');
    const five = normalized.length >= 5 ? normalized.slice(0, 5) : normalized;
    return OAHU_ZIPS_PAYPAL.has(five);
}

function paypalPromoDiscount(subtotal, promoCode) {
    const raw = String(promoCode || '').trim().toUpperCase();
    const promo = PAYPAL_PROMO_CODES[raw];
    if (!promo) return 0;
    let discount = promo.type === 'percent' ? subtotal * (promo.value / 100) : promo.value;
    return Math.min(discount, subtotal);
}

function paypalSubtotalFromItems(items) {
    return items.reduce((sum, item) => {
        const total = Number(item.total);
        if (Number.isFinite(total)) return sum + total;
        const price = Number(item.price) || 0;
        const quantity = Number(item.quantity) || 0;
        return sum + price * quantity;
    }, 0);
}

const NOMINATIM_UA = 'EmotoHI Checkout (shipping quote; support@emotohi.com)';

async function nominatimGeocodeFirst(query) {
    const q = String(query || '').trim().replace(/\s+/g, ' ');
    if (q.length < 3) return null;
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    try {
        const data = await fetchJsonWithHeaders(url, { 'User-Agent': NOMINATIM_UA });
        const first = Array.isArray(data) ? data[0] : null;
        if (!first || first.lat == null || first.lon == null) return null;
        const lat = Number(first.lat);
        const lon = Number(first.lon);
        if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
        return { lat, lon };
    } catch (e) {
        console.warn('[shipping] nominatim:', q.slice(0, 96), e.message);
        return null;
    }
}

/** When Nominatim cannot resolve the street, infer distance tier from ZIP/state so checkout still works. */
function shippingDistanceFallbackMiles(state, zipStr) {
    const stateUpper = String(state || '').trim().toUpperCase();
    const zip5 = String(zipStr || '')
        .trim()
        .replace(/\D/g, '')
        .slice(0, 5);
    if (isOahuZipPaypal(zipStr)) return 15;
    if (stateUpper === 'HI' || (zip5.length === 5 && zip5.startsWith('967')) || (zip5.length === 5 && zip5.startsWith('968'))) {
        return 160;
    }
    if (stateUpper === 'AK') return 3200;
    return 2800;
}

async function computeShippingQuote(address) {
    const { address1, address2, city, state, zip, country } = address || {};
    if (!address1 || !city || !state || !zip || !country) {
        const err = new Error('Missing address fields.');
        err.code = 'ADDRESS';
        throw err;
    }
    const normalizedCountry = String(country).trim().toLowerCase();
    if (normalizedCountry !== 'united states' && normalizedCountry !== 'usa' && normalizedCountry !== 'us') {
        const err = new Error('We currently only ship within the United States.');
        err.code = 'COUNTRY';
        throw err;
    }
    const normalizedZip = String(zip).trim();
    const zipPattern = /^\d{5}(-\d{4})?$/;
    if (!zipPattern.test(normalizedZip)) {
        const err = new Error('Invalid USA ZIP code format.');
        err.code = 'ZIP';
        throw err;
    }
    const stateTrim = String(state).trim();
    const countryTrim = String(country).trim();
    const queries = [
        `${address1} ${address2 || ''}, ${city}, ${stateTrim} ${normalizedZip}, ${countryTrim}`.trim(),
        `${city}, ${stateTrim} ${normalizedZip}, United States`,
        `${normalizedZip}, United States`,
        `${stateTrim} ${normalizedZip}, USA`
    ];
    let lat;
    let lon;
    for (let i = 0; i < queries.length; i++) {
        if (i > 0) {
            await new Promise((r) => setTimeout(r, 1050));
        }
        const coords = await nominatimGeocodeFirst(queries[i]);
        if (coords) {
            lat = coords.lat;
            lon = coords.lon;
            break;
        }
    }
    let distanceMiles;
    if (lat == null || lon == null) {
        distanceMiles = shippingDistanceFallbackMiles(stateTrim, normalizedZip);
    } else {
        distanceMiles = haversineMiles(SHIPPING_ORIGIN.lat, SHIPPING_ORIGIN.lon, lat, lon);
    }
    const amount = getShippingTier(distanceMiles);
    return {
        amount,
        distanceMiles: Number(distanceMiles.toFixed(2)),
        origin: SHIPPING_ORIGIN.label
    };
}

async function computePaypalOrderTotals(items, promoCode, address) {
    const subtotal = paypalSubtotalFromItems(items);
    const discount = paypalPromoDiscount(subtotal, promoCode);
    const ship = await computeShippingQuote(address);
    const nonOahuFee = !isOahuZipPaypal(address.zip) ? NON_OAHU_FEE_USD : 0;
    const total = Math.max(0, subtotal - discount + ship.amount + nonOahuFee);
    return {
        subtotal,
        discount,
        shippingAmount: ship.amount,
        nonOahuFee,
        total: Number(total.toFixed(2)),
        distanceMiles: ship.distanceMiles
    };
}

function paypalApiHostname() {
    return process.env.PAYPAL_MODE === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';
}

async function paypalAccessToken() {
    const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim();
    const secret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim();
    if (!clientId || !secret) {
        const err = new Error('PayPal is not configured.');
        err.code = 'PAYPAL_NOT_CONFIGURED';
        throw err;
    }
    const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
    const body = 'grant_type=client_credentials';
    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                hostname: paypalApiHostname(),
                path: '/v1/oauth2/token',
                method: 'POST',
                headers: {
                    Authorization: `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(body)
                }
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        if (res.statusCode && res.statusCode >= 400) {
                            return reject(new Error(`PayPal auth failed (${res.statusCode}).`));
                        }
                        const parsed = JSON.parse(data);
                        if (!parsed.access_token) {
                            return reject(new Error('PayPal auth response missing token.'));
                        }
                        resolve(parsed.access_token);
                    } catch (e) {
                        reject(e);
                    }
                });
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function paypalApiJson(method, pathOnly, accessToken, jsonBody) {
    const hostname = paypalApiHostname();
    const writeBody = method !== 'GET' && method !== 'HEAD';
    const bodyStr = writeBody ? JSON.stringify(jsonBody !== undefined ? jsonBody : {}) : '';
    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                hostname,
                path: pathOnly,
                method,
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    ...(writeBody
                        ? {
                              'Content-Type': 'application/json',
                              'Content-Length': Buffer.byteLength(bodyStr)
                          }
                        : {})
                }
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const parsed = data ? JSON.parse(data) : {};
                        if (res.statusCode && res.statusCode >= 400) {
                            const msg =
                                parsed.message ||
                                parsed.error_description ||
                                parsed.name ||
                                (typeof parsed.details === 'string' ? parsed.details : '') ||
                                data ||
                                `HTTP ${res.statusCode}`;
                            const er = new Error(typeof msg === 'string' ? msg : 'PayPal API error');
                            er.paypal = parsed;
                            er.status = res.statusCode;
                            return reject(er);
                        }
                        resolve(parsed);
                    } catch (e) {
                        reject(e);
                    }
                });
            }
        );
        req.on('error', reject);
        if (writeBody) req.write(bodyStr);
        req.end();
    });
}

/** Base URL for PayPal return/cancel (set PUBLIC_SITE_URL in production, e.g. https://www.emotohi.com) */
function publicSiteBase(req) {
    const fromEnv = process.env.PUBLIC_SITE_URL || process.env.BASE_URL;
    if (fromEnv) {
        return String(fromEnv).replace(/\/$/, '');
    }
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('host') || 'localhost:3000';
    return `${proto}://${host}`;
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
    res.redirect(301, '/');
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
            paypal_paid: 'Paid (PayPal)',
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
        const result = await computeShippingQuote(req.body || {});
        res.json(result);
    } catch (error) {
        const msg = error.message || 'Unable to calculate shipping.';
        res.status(400).json({ error: msg });
    }
});

app.post('/api/paypal/create-order', async (req, res) => {
    try {
        const { items, promoCode, address, email, receiptId } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Cart is empty.' });
        }
        const emailStr = String(email || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
            return res.status(400).json({ error: 'Valid email required.' });
        }
        if (!address || typeof address !== 'object') {
            return res.status(400).json({ error: 'Shipping address required.' });
        }

        let totals;
        try {
            totals = await computePaypalOrderTotals(items, promoCode, address);
        } catch (e) {
            return res.status(400).json({ error: e.message || 'Unable to compute order total.' });
        }

        if (totals.total < 0.01) {
            return res.status(400).json({ error: 'Order total is too small.' });
        }

        let accessToken;
        try {
            accessToken = await paypalAccessToken();
        } catch (e) {
            if (e.code === 'PAYPAL_NOT_CONFIGURED') {
                return res.status(503).json({ error: 'PayPal checkout is not configured on this server.' });
            }
            throw e;
        }

        const customId = String(receiptId || 'EMO').replace(/\s+/g, ' ').slice(0, 127);
        const base = publicSiteBase(req);
        const orderPayload = {
            intent: 'CAPTURE',
            purchase_units: [
                {
                    amount: {
                        currency_code: 'USD',
                        value: totals.total.toFixed(2)
                    },
                    description: 'EmotoHI parts order',
                    custom_id: customId,
                    soft_descriptor: 'EMOTOHI'
                }
            ],
            application_context: {
                brand_name: 'EmotoHI',
                landing_page: 'NO_PREFERENCE',
                user_action: 'PAY_NOW',
                shipping_preference: 'NO_SHIPPING',
                return_url: `${base}/paypal/return`,
                cancel_url: `${base}/paypal/cancel`
            }
        };

        const created = await paypalApiJson('POST', '/v2/checkout/orders', accessToken, orderPayload);
        if (!created.id) {
            return res.status(502).json({ error: 'PayPal did not return an order id.' });
        }
        const links = Array.isArray(created.links) ? created.links : [];
        const approve = links.find((l) => l && l.rel === 'approve' && l.href);
        const approveUrl = approve ? approve.href : null;
        if (!approveUrl) {
            return res.status(502).json({ error: 'PayPal did not return an approval URL.' });
        }
        res.json({ orderID: created.id, approveUrl });
    } catch (error) {
        console.error('[paypal] create-order', error.message);
        res.status(500).json({ error: error.message || 'Unable to create PayPal order.' });
    }
});

app.post('/api/paypal/capture-order', async (req, res) => {
    try {
        const { orderID } = req.body || {};
        if (!orderID || typeof orderID !== 'string') {
            return res.status(400).json({ error: 'Missing order ID.' });
        }
        const accessToken = await paypalAccessToken();
        const captured = await paypalApiJson(
            'POST',
            `/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`,
            accessToken,
            {}
        );
        const status = captured.status;
        if (status !== 'COMPLETED') {
            return res.status(400).json({ error: `Payment not completed (${status || 'unknown'}).` });
        }
        res.json({ ok: true, status, captureId: captured.id, payerEmail: captured.payer?.email_address });
    } catch (error) {
        console.error('[paypal] capture-order', error.message);
        res.status(500).json({ error: error.message || 'Capture failed.' });
    }
});

app.get('/paypal/return', async (req, res) => {
    try {
        const token = req.query.token;
        if (!token || typeof token !== 'string') {
            return res.redirect('/checkout?paypal=err&reason=missing_token');
        }
        let accessToken;
        try {
            accessToken = await paypalAccessToken();
        } catch (e) {
            return res.redirect('/checkout?paypal=err&reason=config');
        }

        let captured;
        try {
            captured = await paypalApiJson(
                'POST',
                `/v2/checkout/orders/${encodeURIComponent(token)}/capture`,
                accessToken,
                {}
            );
        } catch (err) {
            try {
                const order = await paypalApiJson('GET', `/v2/checkout/orders/${encodeURIComponent(token)}`, accessToken);
                if (order.status === 'COMPLETED') {
                    return res.redirect('/checkout?paypal=success');
                }
            } catch (e) {
                /* fall through */
            }
            console.error('[paypal] return capture', err.message);
            return res.redirect('/checkout?paypal=err&reason=capture');
        }

        if (captured.status !== 'COMPLETED') {
            return res.redirect('/checkout?paypal=err&reason=status');
        }

        const pu = captured.purchase_units && captured.purchase_units[0];
        const cap = pu && pu.payments && pu.payments.captures && pu.payments.captures[0];
        const val = cap && cap.amount && cap.amount.value;
        const email = captured.payer && captured.payer.email_address;
        const customId = pu && pu.custom_id;

        await postDiscordWebhook({
            content: '@everyone URGENT',
            embeds: [
                {
                    title: 'PayPal paid',
                    color: 0x22c55e,
                    fields: [
                        { name: 'Total', value: val ? `$${val} USD` : 'n/a', inline: true },
                        { name: 'Payer', value: (email || 'n/a').slice(0, 1024), inline: true },
                        { name: 'Receipt / custom', value: (customId || token).slice(0, 1024), inline: true }
                    ],
                    footer: { text: `PayPal capture ${captured.id || ''}`.trim() }
                }
            ]
        }).catch(() => {});

        return res.redirect('/checkout?paypal=success');
    } catch (error) {
        console.error('[paypal] return', error);
        return res.redirect('/checkout?paypal=err');
    }
});

app.get('/paypal/cancel', (req, res) => {
    res.redirect('/checkout?paypal=cancel');
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
