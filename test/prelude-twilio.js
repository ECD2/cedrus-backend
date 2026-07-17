// Prelude for the Twilio-signature bundle. Concatenated after reliability-core.js
// and before the stripped src/lib/twilio.js. Provides the callable `twilio`
// default export, `config`, and `toE164` that twilio.js imports. Deliberately
// does NOT define sendSms/logger (twilio.js defines its own sendSms).

let __validateResult = true;
let __lastArgs = null;

function twilio() {
  return { messages: { create: async () => ({ sid: 'SMx', status: 'queued' }) } };
}
twilio.validateRequest = function (token, sig, url, params) {
  __lastArgs = { token, sig, url, params };
  return __validateResult;
};
twilio.twiml = {
  MessagingResponse: function () { this.message = () => {}; this.toString = () => '<xml/>'; },
};

const config = {
  validateTwilioSignature: true,
  publicBaseUrl: 'https://cedrus.example',
  twilioAuthToken: 'authtok',
  twilioAccountSid: 'AC0000',
  twilioFromNumber: '+15550000000',
};

function toE164(p) { return '+' + String(p).replace(/\D/g, ''); }
