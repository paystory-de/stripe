import { WebPlugin } from '@capacitor/core';
import { CardBrand, } from './definitions';
function flatten(json, prefix, omit) {
    let obj = {};
    for (const prop of Object.keys(json)) {
        if (typeof json[prop] !== 'undefined' &&
            json[prop] !== null &&
            (!Array.isArray(omit) || !omit.includes(prop))) {
            if (typeof json[prop] === 'object') {
                obj = Object.assign(Object.assign({}, obj), flatten(json[prop], prefix ? `${prefix}[${prop}]` : prop));
            }
            else {
                const key = prefix ? `${prefix}[${prop}]` : prop;
                obj[key] = json[prop];
            }
        }
    }
    return obj;
}
function stringify(json) {
    let str = '';
    json = flatten(json);
    for (const prop of Object.keys(json)) {
        const key = encodeURIComponent(prop);
        const val = encodeURIComponent(json[prop]);
        str += `${key}=${val}&`;
    }
    return str;
}
function formBody(json, prefix, omit) {
    json = flatten(json, prefix, omit);
    return stringify(json);
}
async function _callStripeAPI(fetchUrl, fetchOpts) {
    const res = await fetch(fetchUrl, fetchOpts);
    let parsed;
    try {
        parsed = await res.json();
    }
    catch (e) {
        parsed = await res.text();
    }
    if (res.ok) {
        return parsed;
    }
    else {
        throw parsed && parsed.error && parsed.error.message
            ? parsed.error.message
            : parsed;
    }
}
async function _stripePost(path, body, key, extraHeaders) {
    extraHeaders = extraHeaders || {};
    return _callStripeAPI(`https://api.stripe.com${path}`, {
        body: body,
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Authorization: `Bearer ${key}`, 'Stripe-version': '2020-03-02' }, extraHeaders),
    });
}
async function _stripeGet(path, key, extraHeaders) {
    extraHeaders = extraHeaders || {};
    return _callStripeAPI(`https://api.stripe.com${path}`, {
        method: 'GET',
        headers: Object.assign({ Accept: 'application/json', Authorization: `Bearer ${key}`, 'Stripe-version': '2020-03-02' }, extraHeaders),
    });
}
export class StripePluginWeb extends WebPlugin {
    constructor() {
        super({
            name: 'Stripe',
            platforms: ['web'],
        });
    }
    async setPublishableKey(opts) {
        if (typeof opts.key !== 'string' || opts.key.trim().length === 0) {
            throw new Error('you must provide a valid key');
        }
        const scriptEl = document.createElement('script');
        scriptEl.src = 'https://js.stripe.com/v3/';
        document.body.appendChild(scriptEl);
        this.publishableKey = opts.key;
        return new Promise((resolve, reject) => {
            scriptEl.addEventListener('error', (ev) => {
                document.body.removeChild(scriptEl);
                reject('Failed to load Stripe JS: ' + ev.message);
            }, { once: true });
            scriptEl.addEventListener('load', () => {
                try {
                    this.stripe = new window.Stripe(opts.key);
                    resolve();
                }
                catch (err) {
                    document.body.removeChild(scriptEl);
                    reject(err);
                }
            }, { once: true });
        });
    }
    async createCardToken(card) {
        const body = formBody(card, 'card', ['phone', 'email']);
        return _stripePost('/v1/tokens', body, this.publishableKey);
    }
    async createBankAccountToken(bankAccount) {
        const body = formBody(bankAccount, 'bank_account');
        return _stripePost('/v1/tokens', body, this.publishableKey);
    }
    async confirmPaymentIntent(opts) {
        if (opts.applePayOptions) {
            throw 'Apple Pay is not supported on web';
        }
        if (opts.googlePayOptions) {
            throw 'Google Pay is not supported on web';
        }
        if (!opts.clientSecret) {
            return Promise.reject('you must provide a client secret');
        }
        let confirmOpts;
        if (opts.paymentMethodId) {
            confirmOpts = {
                payment_method: opts.paymentMethodId,
            };
        }
        else if (opts.card) {
            const token = await this.createCardToken(opts.card);
            confirmOpts = {
                save_payment_method: opts.saveMethod,
                setup_future_usage: opts.setupFutureUsage,
                payment_method: {
                    billing_details: {
                        email: opts.card.email,
                        name: opts.card.name,
                        phone: opts.card.phone,
                        address: {
                            line1: opts.card.address_line1,
                            line2: opts.card.address_line2,
                            city: opts.card.address_city,
                            state: opts.card.address_state,
                            country: opts.card.address_country,
                            postal_code: opts.card.address_zip,
                        },
                    },
                    card: {
                        token: token.id,
                    },
                },
            };
        }
        return this.stripe
            .confirmCardPayment(opts.clientSecret, confirmOpts)
            .then((response) => response.paymentIntent || {});
    }
    async confirmSetupIntent(opts) {
        if (!opts.clientSecret) {
            return Promise.reject('you must provide a client secret');
        }
        return Promise.reject('Not supported on web');
    }
    async payWithApplePay(options) {
        throw 'Apple Pay is not supported on web';
    }
    async cancelApplePay() {
        throw 'Apple Pay is not supported on web';
    }
    async finalizeApplePayTransaction(opts) {
        throw 'Apple Pay is not supported on web';
    }
    async payWithGooglePay(opts) {
        throw 'Google Pay is not supported on web';
    }
    async createSourceToken(opts) {
        throw 'Not implemented';
    }
    async createPiiToken(opts) {
        const body = formBody({ id_number: opts.pii }, 'pii');
        return _stripePost('/v1/tokens', body, this.publishableKey);
    }
    async createAccountToken(account) {
        if (!account.legalEntity) {
            return Promise.reject('you must provide a legal entity');
        }
        let body = {};
        if (account.legalEntity.type === 'individual') {
            body.business_type = 'individual';
            body.individual = account.legalEntity;
            body.tos_shown_and_accepted = account.tosShownAndAccepted;
        }
        else {
            body.business_type = 'company';
            body.company = account.legalEntity;
        }
        delete account.legalEntity.type;
        return _stripePost('/v1/tokens', formBody({ account: body }), this.publishableKey);
    }
    async customizePaymentAuthUI(opts) {
        return;
    }
    async presentPaymentOptions() {
        return;
    }
    async isApplePayAvailable() {
        return { available: false };
    }
    async isGooglePayAvailable() {
        return { available: false };
    }
    async validateCardNumber(opts) {
        return {
            valid: opts.number.length > 0,
        };
    }
    async validateExpiryDate(opts) {
        let { exp_month, exp_year } = opts;
        if (exp_month < 1 || exp_month > 12) {
            return {
                valid: false,
            };
        }
        if (String(exp_year).length === 2) {
            exp_year = parseInt('20' + String(exp_year));
        }
        const currentYear = new Date().getFullYear();
        if (exp_year > currentYear) {
            return {
                valid: true,
            };
        }
        else if (exp_year === currentYear &&
            exp_month >= new Date().getMonth() + 1) {
            return {
                valid: true,
            };
        }
        else {
            return {
                valid: false,
            };
        }
    }
    async validateCVC(opts) {
        if (typeof opts.cvc !== 'string') {
            return { valid: false };
        }
        const len = opts.cvc.trim().length;
        return {
            valid: len > 0 && len < 4,
        };
    }
    async identifyCardBrand(opts) {
        return {
            brand: CardBrand.UNKNOWN,
        };
    }
    addCustomerSource(opts) {
        return this.cs.addSrc(opts.sourceId);
    }
    customerPaymentMethods() {
        return this.cs.listPm();
    }
    deleteCustomerSource(opts) {
        return undefined;
    }
    async initCustomerSession(opts) {
        this.cs = new CustomerSession(opts);
    }
    setCustomerDefaultSource(opts) {
        return this.cs.setDefaultSrc(opts.sourceId);
    }
}
class CustomerSession {
    constructor(key) {
        this.key = key;
        if (!key.secret ||
            !Array.isArray(key.associated_objects) ||
            !key.associated_objects.length ||
            !key.associated_objects[0].id) {
            throw new Error('you must provide a valid configuration');
        }
        this.customerId = key.associated_objects[0].id;
    }
    async listPm() {
        const res = await _stripeGet(`/v1/customers/${this.customerId}`, this.key.secret);
        return {
            paymentMethods: res.sources.data,
        };
    }
    async addSrc(id) {
        await _stripePost('/v1/customers/' + this.customerId, formBody({
            source: id,
        }), this.key.secret);
        return this.listPm();
    }
    async setDefaultSrc(id) {
        await _stripePost('/v1/customers/' + this.customerId, formBody({
            default_source: id,
        }), this.key.secret);
        return await this.listPm();
    }
}
// const StripePluginInstance = new StripePluginWeb();
// export { StripePluginInstance };
// registerPlugin(StripePluginInstance);
//# sourceMappingURL=web.js.map